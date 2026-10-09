import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/';

// Größte Kantenlänge eines Modells nach dem Laden (in Metern).
const TARGET_SIZE = 0.5;

/**
 * Lädt die Modell-Liste aus models/models.json und die GLB-Dateien selbst.
 * Geladene Modelle werden zentriert, auf TARGET_SIZE normalisiert und in
 * `root` eingehängt. `root` selbst bleibt frei für die Nutzer-Transformation.
 */
export class ModelManager {
  constructor(renderer, root, onChange = () => {}) {
    this.root = root;
    this.onChange = onChange;
    this.models = [];
    this.index = -1;
    this.content = null;
    this.mixer = null;
    this.actions = [];
    this.animationPaused = false;
    this._loadToken = 0;
    this._lastState = { status: 'empty' };

    const draco = new DRACOLoader().setDecoderPath(`${THREE_CDN}libs/draco/gltf/`);
    const ktx2 = new KTX2Loader().setTranscoderPath(`${THREE_CDN}libs/basis/`).detectSupport(renderer);

    this.loader = new GLTFLoader()
      .setDRACOLoader(draco)
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder);
  }

  async loadManifest(url = 'models/models.json') {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url} konnte nicht geladen werden (${res.status})`);

    const data = await res.json();
    const entries = Array.isArray(data) ? data : data.models ?? [];

    this.models = entries
      .filter((m) => m && (m.file || m.url))
      .map((m) => {
        const src = m.url ?? `models/${m.file.split('/').map(encodeURIComponent).join('/')}`;
        const fallbackName = (m.file ?? m.url).split('/').pop().replace(/\.glb$/i, '');
        return { name: m.name || fallbackName, url: src };
      });

    return this.models;
  }

  /**
   * Hängt lokal geöffnete Dateien (`{ id, name, blob }`) an die Liste an.
   * Gibt den Index des ersten neuen Eintrags zurück.
   */
  addModels(entries) {
    const first = this.models.length;
    for (const { id, name, blob } of entries) {
      this.models.push({ name, url: URL.createObjectURL(blob), local: true, localId: id });
    }
    return first;
  }

  /** Entfernt einen lokalen Eintrag; war er aktiv, wird das nächste Modell geladen. */
  removeModel(index) {
    const model = this.models[index];
    if (!model) return;
    if (model.local) URL.revokeObjectURL(model.url);
    this.models.splice(index, 1);

    if (index === this.index) {
      this._loadToken++; // laufenden Ladevorgang verwerfen
      this._clear();
      if (this.models.length) {
        this.load(Math.min(index, this.models.length - 1));
      } else {
        this.index = -1;
        this._emit({ status: 'empty' });
      }
    } else {
      if (index < this.index) this.index--;
      this.emitState(); // Position (x/n) in der Anzeige aktualisieren
    }
  }

  /** Faktor für `root.scale`, mit dem das Modell in Originalgröße (1 Einheit = 1 m) erscheint. */
  get realScale() {
    return this.content ? 1 / this.content.scale.x : 1;
  }

  /** Maßstab relativ zur Originalgröße bei gegebener `root.scale`. */
  scaleRatio(rootScale) {
    return this.content ? rootScale * this.content.scale.x : 1;
  }

  /** Radius der umschließenden Kugel bei gegebener `root.scale` (in Metern). */
  boundingRadius(rootScale) {
    const size = this.content?.userData.size;
    return size ? (size.length() / 2) * this.scaleRatio(rootScale) : 0;
  }

  /** Abstand vom Modell-Mittelpunkt zur Unterseite bei gegebener `root.scale` (in Metern). */
  bottomOffset(rootScale) {
    const height = this.content?.userData.size.y ?? 0;
    return (height / 2) * this.scaleRatio(rootScale);
  }

  get current() {
    return this.models[this.index] ?? null;
  }

  next() {
    if (this.models.length) this.load((this.index + 1) % this.models.length);
  }

  prev() {
    if (this.models.length) this.load((this.index - 1 + this.models.length) % this.models.length);
  }

  async load(index) {
    const model = this.models[index];
    if (!model) return;

    const token = ++this._loadToken;
    this.index = index;
    this._emit({ status: 'loading', progress: 0 });

    let gltf;
    try {
      gltf = await this.loader.loadAsync(model.url, (e) => {
        if (token === this._loadToken && e.total) {
          this._emit({ status: 'loading', progress: e.loaded / e.total });
        }
      });
    } catch (err) {
      if (token !== this._loadToken) return;
      console.error(err);
      this._emit({ status: 'error', message: `Fehler beim Laden: ${err.message ?? err}` });
      return;
    }

    // Inzwischen wurde ein anderes Modell angefordert.
    if (token !== this._loadToken) {
      disposeObject(gltf.scene);
      return;
    }

    this._clear();
    gltf.scene.traverse((node) => {
      if (node.isMesh) node.castShadow = true;
    });
    this.content = normalize(gltf.scene);
    this.root.add(this.content);

    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(gltf.scene);
      this.actions = [this.mixer.clipAction(gltf.animations[0])];
      this.actions[0].play();
      this.animationPaused = false;
    }

    this._emit({ status: 'ready', hasAnimation: this.actions.length > 0 });
  }

  toggleAnimation() {
    if (!this.actions.length) return false;
    this.animationPaused = !this.animationPaused;
    for (const action of this.actions) action.paused = this.animationPaused;
    return true;
  }

  update(dt) {
    this.mixer?.update(dt);
  }

  _clear() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.actions = [];

    if (this.content) {
      this.root.remove(this.content);
      disposeObject(this.content);
      this.content = null;
    }
  }

  /** Meldet den letzten Zustand erneut, z. B. um die Anzeige aufzufrischen. */
  emitState() {
    this._emit(this._lastState);
  }

  _emit(state) {
    this._lastState = state;
    this.onChange({ index: this.index, model: this.current, ...state });
  }
}

/**
 * Zentriert das Modell im Ursprung und skaliert es auf TARGET_SIZE.
 * Die Originalmaße landen in `wrapper.userData.size`.
 */
function normalize(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const wrapper = new THREE.Group();
  wrapper.add(object);
  wrapper.userData.size = new THREE.Vector3();

  if (box.isEmpty()) return wrapper;

  const size = box.getSize(wrapper.userData.size);
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  object.position.sub(center);
  wrapper.scale.setScalar(TARGET_SIZE / maxDim);
  return wrapper;
}

function disposeObject(object) {
  object.traverse((node) => {
    if (!node.isMesh && !node.isPoints && !node.isLine) return;
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose();
      }
      material.dispose();
    }
  });
}
