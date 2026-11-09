import * as THREE from 'three';
import { mergeGeometries, deinterleaveGeometry } from 'three/addons/utils/BufferGeometryUtils.js';

// Größere Texturen kosten auf der Quest viel Speicherbandbreite, ohne in
// der Brille sichtbar schärfer zu sein.
const MAX_TEXTURE_SIZE = 2048;

const _inverse = new THREE.Matrix4();

/**
 * Bereitet ein geladenes Modell für flüssiges Rendern auf der Quest vor.
 *
 * - Statische Meshes mit gleichem Material werden zu einem Mesh verschmolzen
 *   (CAD-/Architekturmodelle haben oft Tausende Einzelteile = Draw Calls).
 * - Leere Knoten werden entfernt, Matrizen statischer Knoten eingefroren.
 * - Transmission (Glas) wird durch einfache Transparenz ersetzt – sonst
 *   rendert three.js die Szene pro Frame ein weiteres Mal.
 * - Texturen über MAX_TEXTURE_SIZE werden verkleinert.
 *
 * @param {THREE.Object3D} root  gltf.scene (noch nicht in der Szene)
 * @param {{ animated: boolean }} options
 */
export async function optimizeModel(root, { animated }) {
  const stats = { meshesBefore: countMeshes(root), meshesAfter: 0, texturesResized: 0, glassMaterials: 0 };

  if (!animated) {
    mergeStaticMeshes(root);
    pruneEmptyNodes(root);
    freezeMatrices(root);
  }
  stats.glassMaterials = replaceTransmission(root);
  stats.texturesResized = await downscaleTextures(root);
  stats.meshesAfter = countMeshes(root);
  return stats;
}

function countMeshes(root) {
  let n = 0;
  root.traverse((node) => node.isMesh && n++);
  return n;
}

function materialsOf(node) {
  return Array.isArray(node.material) ? node.material : [node.material];
}

function isVisibleWithin(node, root) {
  for (let n = node; n && n !== root; n = n.parent) if (!n.visible) return false;
  return true;
}

function isFloat(attribute) {
  const array = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
  return array instanceof Float32Array && !attribute.normalized;
}

/** Signatur, die gleich sein muss, damit Geometrien verschmolzen werden können. */
function mergeKey(node) {
  const g = node.geometry;
  const attributes = Object.keys(g.attributes)
    .sort()
    .map((name) => {
      const a = g.attributes[name];
      const array = a.isInterleavedBufferAttribute ? a.data.array : a.array;
      return `${name}:${a.itemSize}:${a.normalized}:${array.constructor.name}`;
    });
  return [node.material.uuid, g.index ? 'i' : 'n', node.castShadow, node.receiveShadow, node.renderOrder, ...attributes].join('|');
}

function canMerge(node, root) {
  if (!node.isMesh || node.isSkinnedMesh || node.isInstancedMesh || node.isBatchedMesh) return false;
  if (Array.isArray(node.material) || !node.material) return false;
  const g = node.geometry;
  if (!g?.attributes.position || g.groups.length > 1 || Object.keys(g.morphAttributes).length) return false;
  // Quantisierte Positionen/Normalen lassen sich nicht verlustfrei transformieren.
  for (const name of ['position', 'normal', 'tangent']) {
    if (g.attributes[name] && !isFloat(g.attributes[name])) return false;
  }
  return isVisibleWithin(node, root);
}

function mergeStaticMeshes(root) {
  root.updateMatrixWorld(true);
  _inverse.copy(root.matrixWorld).invert();

  const groups = new Map();
  root.traverse((node) => {
    if (!canMerge(node, root)) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(_inverse, node.matrixWorld);
    // Gespiegelte Teile würden nach dem Einbacken mit falscher Windung gerendert.
    if (matrix.determinant() < 0) return;
    const key = mergeKey(node);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ node, matrix });
  });

  for (const items of groups.values()) {
    if (items.length < 2) continue;

    const geometries = items.map(({ node, matrix }) => {
      const g = node.geometry.clone();
      deinterleaveGeometry(g);
      return g.applyMatrix4(matrix);
    });

    let merged = null;
    try {
      merged = mergeGeometries(geometries, false);
    } catch (err) {
      console.warn('Meshes konnten nicht verschmolzen werden:', err);
    }
    for (const g of geometries) g.dispose();
    if (!merged) continue;

    const first = items[0].node;
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `${first.material.name || 'merged'} (${items.length})`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    root.add(mesh);

    for (const { node } of items) node.removeFromParent();
  }
}

/** Entfernt Knoten ohne Inhalt (übrig nach dem Verschmelzen). */
function pruneEmptyNodes(root) {
  const isEmpty = (n) =>
    n.children.length === 0 && !n.isMesh && !n.isLight && !n.isCamera && !n.isBone && !n.isPoints && !n.isLine && !n.isSprite;

  const visit = (node) => {
    for (const child of [...node.children]) {
      visit(child);
      if (isEmpty(child)) child.removeFromParent();
    }
  };
  visit(root);
}

/** Statische Knoten müssen ihre lokale Matrix nicht jeden Frame neu berechnen. */
function freezeMatrices(root) {
  root.traverse((node) => {
    if (node === root) return;
    node.updateMatrix();
    node.matrixAutoUpdate = false;
  });
}

function replaceTransmission(root) {
  const done = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    for (const m of materialsOf(node)) {
      if (!m?.isMeshPhysicalMaterial || !(m.transmission > 0) || done.has(m)) continue;
      m.opacity = Math.min(m.opacity, 1 - 0.65 * m.transmission);
      m.transmission = 0;
      m.transparent = true;
      m.depthWrite = false;
      m.needsUpdate = true;
      done.add(m);
    }
  });
  return done.size;
}

async function downscaleTextures(root) {
  const textures = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    for (const m of materialsOf(node)) {
      if (!m) continue;
      for (const value of Object.values(m)) {
        if (value?.isTexture && !value.isCompressedTexture && value.image) textures.add(value);
      }
    }
  });

  let resized = 0;
  await Promise.all(
    [...textures].map(async (texture) => {
      const image = texture.image;
      const largest = Math.max(image.width ?? 0, image.height ?? 0);
      if (!(largest > MAX_TEXTURE_SIZE)) return;

      const f = MAX_TEXTURE_SIZE / largest;
      const width = Math.max(1, Math.round(image.width * f));
      const height = Math.max(1, Math.round(image.height * f));
      try {
        texture.image = await createImageBitmap(image, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'high',
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        });
        image.close?.();
        texture.needsUpdate = true;
        resized++;
      } catch (err) {
        console.warn('Textur konnte nicht verkleinert werden:', err);
      }
    }),
  );
  return resized;
}
