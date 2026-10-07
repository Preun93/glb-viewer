import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ModelManager } from './modelManager.js';
import { XRControls } from './xrControls.js';
import { Hud } from './hud.js';

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

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 3, 2);
scene.add(sun);

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
const hud = new Hud();

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function renderModelList() {
  listEl.replaceChildren(
    ...manager.models.map((model, i) => {
      const button = document.createElement('button');
      button.textContent = model.name;
      button.classList.toggle('active', i === manager.index);
      button.addEventListener('click', () => manager.load(i));
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
    placeInFrontOfUser();
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
  needsPlacement = true;
  placementFrames = 0;
});

renderer.xr.addEventListener('sessionend', () => {
  controls.releaseAll();
  scene.background = DESKTOP_BACKGROUND;
  resetDesktopView();
});

document.body.appendChild(
  ARButton.createButton(renderer, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking'],
  }),
);

// --- Loop -------------------------------------------------------------------

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (renderer.xr.isPresenting) {
    controls.update(dt);
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

// --- Start ------------------------------------------------------------------

try {
  await manager.loadManifest();
  renderModelList();
  if (manager.models.length) {
    manager.load(0);
  } else {
    setStatus('Keine Modelle in models/models.json gefunden.', true);
  }
} catch (err) {
  console.error(err);
  setStatus(err.message, true);
}
