import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ModelManager } from './modelManager.js';
import { XRControls } from './xrControls.js';
import { Hud } from './hud.js';
import { Placement } from './placement.js';
import { GroundShadow } from './shadow.js';
import { listLocalModels, saveLocalModel, deleteLocalModel } from './localModels.js';

const DESKTOP_BACKGROUND = new THREE.Color(0x1b1e24);
const DESKTOP_CAMERA_POSITION = new THREE.Vector3(0, 0.25, 1);
const PLACE_DISTANCE = 1.0; // Meter vor dem Nutzer
const PLACE_BELOW_EYES = 0.25; // Meter unter Augenhöhe

// --- Renderer, Szene, Kamera ----------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = DESKTOP_BACKGROUND;

// Die Leuchtflächen der RoomEnvironment (Intensität 17–100) spiegeln sich auf
// glänzenden Materialien als ausgebrannte weiße Flecken. Gedimmt bleiben die
// Reflexionen erhalten, aber mit Zeichnung statt Überstrahlung.
const ENV_LIGHTBOX_SCALE = 0.25;
const HEMI_INTENSITY = 0.15; // nur leichte Aufhellung, die Umgebung leuchtet bereits
const SUN_INTENSITY = 1.0;

const room = new RoomEnvironment();
room.traverse((node) => {
  if (node.isMesh && node.material.isMeshBasicMaterial) node.material.color.multiplyScalar(ENV_LIGHTBOX_SCALE);
});
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(room, 0.04).texture;
pmrem.dispose();
room.dispose();

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, HEMI_INTENSITY));
const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
sun.position.set(1, 3, 2);
scene.add(sun);

const shadow = new GroundShadow(renderer, scene, sun);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.copy(DESKTOP_CAMERA_POSITION);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0, 0);
orbit.update();

// Container für das Modell: wird gegriffen, gedreht, verschoben, skaliert.
const modelRoot = new THREE.Group();
modelRoot.name = 'modelRoot';
scene.add(modelRoot);

// --- UI ---------------------------------------------------------------------

const listEl = document.getElementById('model-list');
const statusEl = document.getElementById('status');
const hud = new Hud({
  onExit: () => renderer.xr.getSession()?.end(),
  onPlace: () => (placement.active ? cancelPlacement() : startPlacement()),
});

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function renderModelList() {
  listEl.replaceChildren(
    ...manager.models.map((model, i) => {
      const button = document.createElement('button');
      button.classList.toggle('active', i === manager.index);
      button.addEventListener('click', () => manager.load(i));

      const label = document.createElement('span');
      label.className = 'name';
      label.textContent = model.name;
      button.append(label);

      if (model.local) {
        const tag = document.createElement('span');
        tag.className = 'local';
        tag.textContent = 'lokal';

        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.title = 'Aus der Liste entfernen';
        remove.setAttribute('role', 'button');
        remove.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteLocalModel(model.localId);
          manager.removeModel(manager.models.indexOf(model));
          renderModelList();
        });

        button.append(tag, remove);
      }
      return button;
    }),
  );
}

function onModelChange(state) {
  const name = state.model?.name ?? '';
  const position = manager.models.length > 1 ? ` (${state.index + 1}/${manager.models.length})` : '';
  let status = '';

  if (state.status === 'loading') {
    status = state.progress ? `Lädt… ${Math.round(state.progress * 100)} %` : 'Lädt…';
  } else if (state.status === 'error') {
    status = state.message;
  } else if (state.status === 'ready') {
    status = state.hasAnimation ? 'Animation läuft' : 'Bereit';
    applyRealSize();
  } else if (state.status === 'empty') {
    setStatus('Keine Modelle – öffne eine eigene GLB-Datei.');
    hud.set('Kein Modell', '');
    renderModelList();
    return;
  }

  setStatus(`${name}${position}: ${status}`, state.status === 'error');
  hud.set(`${name}${position}`, status);
  renderModelList();
}

// --- Modelle & Steuerung --------------------------------------------------

const manager = new ModelManager(renderer, modelRoot, onModelChange);

const controls = new XRControls(renderer, scene, modelRoot, {
  onNext: () => manager.next(),
  onPrev: () => manager.prev(),
  onReset: () => {
    controls.releaseAll();
    stopPlacement();
    realSize = null;
    placeInFrontOfUser();
  },
  onTrigger: () => {
    if (placement.active && placement.hasHit) finishPlacement();
  },
  onToggleAnimation: () => {
    if (manager.toggleAnimation()) {
      hud.set(hud.title, manager.animationPaused ? 'Animation pausiert' : 'Animation läuft');
    }
  },
  onConnected: (hand) => {
    if (hand.handedness === 'left') hand.grip.add(hud.mesh);
  },
  onDisconnected: (hand) => {
    if (hud.mesh.parent === hand.grip) hand.grip.remove(hud.mesh);
  },
});

controls.pointerTargets = hud.buttons;

// --- Originalgröße & Platzieren auf Flächen ---------------------------------

const placement = new Placement(renderer, scene);

/** Gesetzt, solange das Modell in Originalgröße auf einer Fläche steht. */
let realSize = null; // { floorY }

function startPlacement() {
  const hand = controls.hands.find((h) => h.handedness === 'right' && h.inputSource && !h.inputSource.hand);
  if (!manager.content || !hand) return;

  controls.releaseAll();
  controls.placing = true;
  realSize = null;

  // Originalgröße, aufrecht – nur die Drehung um die Hochachse bleibt.
  const yaw = new THREE.Euler().setFromQuaternion(modelRoot.quaternion, 'YXZ').y;
  modelRoot.rotation.set(0, yaw, 0);
  modelRoot.scale.setScalar(manager.realScale);

  hud.setPlacing(true);
  placement.start(hand);
}

function stopPlacement() {
  placement.stop();
  controls.placing = false;
  hud.setPlacing(false);
}

function cancelPlacement() {
  stopPlacement();
  placeInFrontOfUser();
  manager.emitState();
}

function finishPlacement() {
  realSize = { floorY: placement.point.y };
  stopPlacement();
  hud.set(hud.title, 'Steht in Originalgröße');
}

/** Hält das Modell beim Platzieren am Ring bzw. nach Modellwechsel auf der Fläche. */
function applyRealSize() {
  if (placement.active) {
    modelRoot.scale.setScalar(manager.realScale);
  } else if (realSize) {
    modelRoot.scale.setScalar(manager.realScale);
    modelRoot.position.y = realSize.floorY + manager.bottomOffset(modelRoot.scale.x);
  }
}

const _center = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** Schatten auf die Fläche unter dem Modell legen (nur in AR). */
function updateShadow() {
  if (!manager.content) {
    shadow.update(_center, 0, 0);
    return;
  }
  modelRoot.getWorldPosition(_center);
  const rootScale = modelRoot.getWorldScale(_scale).x;
  const bottom = _center.y - manager.bottomOffset(rootScale);

  // Fläche: beim Platzieren der Ring, nach dem Abstellen die Tischhöhe
  // (solange das Modell nicht darunter bewegt wurde), sonst der Boden.
  let surfaceY = 0;
  if (placement.active && placement.hasHit) surfaceY = placement.point.y;
  else if (realSize && bottom >= realSize.floorY - 0.05) surfaceY = realSize.floorY;

  shadow.update(_center, manager.boundingRadius(rootScale), surfaceY);
}

/** Setzt das Modell 1 m vor den Nutzer, Vorderseite zum Nutzer gedreht. */
function placeInFrontOfUser() {
  const xrCamera = renderer.xr.getCamera();
  const eye = xrCamera.getWorldPosition(new THREE.Vector3());
  const dir = xrCamera.getWorldDirection(new THREE.Vector3());
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();

  modelRoot.position.copy(eye).addScaledVector(dir, PLACE_DISTANCE);
  modelRoot.position.y = Math.max(0.2, eye.y - PLACE_BELOW_EYES);
  modelRoot.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
  modelRoot.scale.setScalar(1);
}

function resetDesktopView() {
  modelRoot.position.set(0, 0, 0);
  modelRoot.rotation.set(0, 0, 0);
  modelRoot.scale.setScalar(1);

  camera.position.copy(DESKTOP_CAMERA_POSITION);
  camera.fov = 50;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  orbit.target.set(0, 0, 0);
  orbit.update();
}

// --- WebXR-Session ----------------------------------------------------------

let needsPlacement = false;
let placementFrames = 0;

renderer.xr.addEventListener('sessionstart', () => {
  scene.background = null; // transparent → Passthrough sichtbar
  shadow.setEnabled(true);
  needsPlacement = true;
  placementFrames = 0;
});

renderer.xr.addEventListener('sessionend', () => {
  controls.releaseAll();
  stopPlacement();
  realSize = null;
  shadow.setEnabled(false);
  scene.background = DESKTOP_BACKGROUND;
  resetDesktopView();
});

document.body.appendChild(
  ARButton.createButton(renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'hit-test'],
  }),
);

// --- Loop -------------------------------------------------------------------

const clock = new THREE.Clock();

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (renderer.xr.isPresenting) {
    controls.update(dt);

    if (placement.active) {
      placement.update(frame);
      if (placement.hasHit && manager.content) {
        modelRoot.position.copy(placement.point);
        modelRoot.position.y += manager.bottomOffset(modelRoot.scale.x);
      }
      hud.set(hud.title, placement.hasHit ? 'Trigger: hier abstellen' : 'Auf eine Fläche zielen…');
    }
    updateShadow();
    hud.setScale(manager.content ? Math.round(manager.scaleRatio(modelRoot.scale.x) * 100) : null);
  } else {
    orbit.update();
  }

  manager.update(dt);
  renderer.render(scene, camera);

  // Die XR-Kamera hat erst nach einigen gerenderten Frames eine gültige Pose.
  if (needsPlacement && renderer.xr.isPresenting && ++placementFrames >= 3) {
    needsPlacement = false;
    placeInFrontOfUser();
  }
});

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Eigene Dateien öffnen -------------------------------------------------

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');

async function handleFiles(fileList) {
  const files = [...fileList];
  const glbs = files.filter((f) => /\.glb$/i.test(f.name));
  if (!glbs.length) {
    if (files.length) setStatus('Nur .glb-Dateien werden unterstützt.', true);
    return;
  }

  const saved = await Promise.all(glbs.map(saveLocalModel));
  const first = manager.addModels(saved);
  manager.load(first);

  const skipped = files.length - glbs.length;
  if (skipped) console.warn(`${skipped} Datei(en) ohne .glb-Endung übersprungen.`);
}

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = ''; // dieselbe Datei erneut wählbar
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropZone.classList.add('visible');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropZone.classList.remove('visible');
  }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('visible');
  if (e.dataTransfer?.files.length) handleFiles(e.dataTransfer.files);
});

// --- Start ------------------------------------------------------------------

try {
  await manager.loadManifest();
} catch (err) {
  console.error(err);
  setStatus(err.message, true);
}

manager.addModels(await listLocalModels());
renderModelList();
if (manager.models.length) {
  manager.load(0);
} else if (!statusEl.classList.contains('error')) {
  setStatus('Keine Modelle – öffne eine eigene GLB-Datei.');
}
