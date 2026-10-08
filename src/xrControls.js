import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

const DEADZONE = 0.15;
const ROTATE_SPEED = 2.0; // rad/s bei vollem Stick-Ausschlag
const MOVE_SPEED = 1.0; // m/s
const SCALE_SPEED = 1.2; // exponentiell pro Sekunde
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const MIN_DISTANCE = 0.15;
const POINTER_LENGTH = 1.5; // Meter, Länge des Zeigestrahls ohne Treffer

// Button-Indizes im "xr-standard"-Gamepad-Mapping der Quest-Controller.
const BTN_STICK = 3;
const BTN_A_X = 4;
const BTN_B_Y = 5;

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _raycaster = new THREE.Raycaster();

/**
 * Controller-Steuerung für das Ziel-Objekt im WebXR-Modus.
 *
 * - Grip (oder Pinch bei Hand-Tracking) greift das Objekt; es folgt der Hand.
 * - Zwei Grips: Skalieren über den Abstand, Drehen um die Hochachse, Verschieben.
 * - Thumbsticks und A/B/X/Y lösen Aktionen aus (siehe README).
 * - Der rechte Controller hat einen Zeigestrahl: Trigger drückt den anvisierten
 *   Knopf (`pointerTargets`, Callbacks in `userData`) oder ruft `onTrigger` auf.
 * - Während `placing` ist Greifen gesperrt; nur die Drehung um die Hochachse bleibt.
 */
export class XRControls {
  constructor(renderer, scene, target, actions = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.target = target;
    this.actions = actions;
    this.hands = [];
    this.twoHand = null;
    this.placing = false;
    this.pointerTargets = [];
    this.hovered = null;

    const factory = new XRControllerModelFactory();

    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      grip.add(factory.createControllerModel(grip));
      scene.add(controller, grip);

      const pointer = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }),
      );
      pointer.visible = false;
      controller.add(pointer);

      const hand = { controller, grip, pointer, inputSource: null, handedness: null, grabbing: false, prevButtons: [] };
      this.hands.push(hand);

      controller.addEventListener('connected', (e) => {
        hand.inputSource = e.data;
        hand.handedness = e.data.handedness;
        hand.prevButtons = [];
        this.actions.onConnected?.(hand);
      });
      controller.addEventListener('disconnected', () => {
        this._endGrab(hand);
        hand.pointer.visible = false;
        if (this._isPointer(hand)) this._setHovered(null);
        this.actions.onDisconnected?.(hand);
        hand.inputSource = null;
        hand.handedness = null;
      });

      controller.addEventListener('squeezestart', () => this._startGrab(hand));
      controller.addEventListener('squeezeend', () => this._endGrab(hand));
      // Hand-Tracking: Pinch (select) greift ebenfalls. Controller: Trigger.
      controller.addEventListener('selectstart', () => {
        if (hand.inputSource?.hand) this._startGrab(hand);
        else this._trigger(hand);
      });
      controller.addEventListener('selectend', () => hand.inputSource?.hand && this._endGrab(hand));
    }
  }

  /** Lässt das Objekt los, ohne seine Weltlage zu verändern. */
  releaseAll() {
    for (const hand of this.hands) hand.grabbing = false;
    this._updateGrabMode();
  }

  update(dt) {
    if (this.twoHand) this._updateTwoHand();
    this._updatePointer();

    const camera = this.renderer.xr.getCamera();
    const free = this.target.parent === this.scene && !this.twoHand;

    for (const hand of this.hands) {
      const gamepad = hand.inputSource?.gamepad;
      if (!gamepad) continue;

      this._handleButtons(hand, gamepad);
      if (!free) continue;

      const x = deadzone(gamepad.axes[2] ?? 0);
      const y = deadzone(gamepad.axes[3] ?? 0);
      if (!x && !y) continue;

      if (hand.handedness === 'right') {
        if (x) this.target.rotateOnWorldAxis(UP, -x * ROTATE_SPEED * dt);
        if (y && !this.placing) {
          camera.getWorldDirection(_dir);
          _right.crossVectors(_dir, UP).normalize();
          this.target.rotateOnWorldAxis(_right, y * ROTATE_SPEED * dt);
        }
      } else if (hand.handedness === 'left' && !this.placing) {
        if (y) this._moveAlongView(camera, -y * MOVE_SPEED * dt);
        if (x) this._scaleBy(Math.exp(x * SCALE_SPEED * dt));
      }
    }
  }

  // --- Greifen -------------------------------------------------------------

  _startGrab(hand) {
    if (hand.grabbing || this.placing) return;
    hand.grabbing = true;
    this._updateGrabMode();
  }

  _endGrab(hand) {
    if (!hand.grabbing) return;
    hand.grabbing = false;
    this._updateGrabMode();
  }

  _updateGrabMode() {
    const active = this.hands.filter((h) => h.grabbing);

    // Erst in die Szene zurückhängen (Weltlage bleibt erhalten) ...
    this.scene.attach(this.target);
    this.twoHand = null;

    // ... dann je nach Anzahl greifender Hände neu verbinden.
    if (active.length === 1) {
      active[0].controller.attach(this.target);
    } else if (active.length >= 2) {
      this.twoHand = this._initTwoHand(active[0], active[1]);
    }
  }

  _initTwoHand(a, b) {
    a.controller.getWorldPosition(_pa);
    b.controller.getWorldPosition(_pb);
    return {
      a,
      b,
      distance0: Math.max(_pa.distanceTo(_pb), 0.01),
      mid0: _pa.clone().add(_pb).multiplyScalar(0.5),
      angle0: Math.atan2(_pb.x - _pa.x, _pb.z - _pa.z),
      position0: this.target.position.clone(),
      quaternion0: this.target.quaternion.clone(),
      scale0: this.target.scale.x,
    };
  }

  _updateTwoHand() {
    const s = this.twoHand;
    s.a.controller.getWorldPosition(_pa);
    s.b.controller.getWorldPosition(_pb);
    _mid.addVectors(_pa, _pb).multiplyScalar(0.5);

    const scale = clampScale(s.scale0 * (_pa.distanceTo(_pb) / s.distance0));
    const ratio = scale / s.scale0;
    const delta = Math.atan2(_pb.x - _pa.x, _pb.z - _pa.z) - s.angle0;
    _q.setFromAxisAngle(UP, delta);

    this.target.position
      .copy(s.position0)
      .sub(s.mid0)
      .applyQuaternion(_q)
      .multiplyScalar(ratio)
      .add(_mid);
    this.target.quaternion.copy(s.quaternion0).premultiply(_q);
    this.target.scale.setScalar(scale);
  }

  // --- Zeigestrahl -------------------------------------------------------

  _isPointer(hand) {
    return hand.handedness === 'right' && hand.inputSource && !hand.inputSource.hand;
  }

  _updatePointer() {
    let hovered = null;
    for (const hand of this.hands) {
      hand.pointer.visible = Boolean(this._isPointer(hand));
      if (!hand.pointer.visible) continue;

      let length = POINTER_LENGTH;
      const targets = this.pointerTargets.filter((m) => m.parent && isVisible(m));
      if (targets.length) {
        _raycaster.setFromXRController(hand.controller);
        const hit = _raycaster.intersectObjects(targets, false)[0];
        if (hit) {
          hovered = hit.object;
          length = hit.distance;
        }
      }
      hand.pointer.scale.z = length;
    }
    this._setHovered(hovered);
  }

  _setHovered(mesh) {
    if (mesh === this.hovered) return;
    this.hovered?.userData.onHover?.(false);
    this.hovered = mesh;
    mesh?.userData.onHover?.(true);
  }

  _trigger(hand) {
    if (this._isPointer(hand) && this.hovered) {
      this.hovered.userData.onClick?.();
    } else {
      this.actions.onTrigger?.(hand);
    }
  }

  // --- Sticks & Buttons ----------------------------------------------------

  _moveAlongView(camera, amount) {
    camera.getWorldPosition(_camPos);
    _dir.subVectors(this.target.position, _camPos);
    const distance = _dir.length();
    if (distance < 1e-4) return;
    _dir.divideScalar(distance);
    this.target.position.copy(_camPos).addScaledVector(_dir, Math.max(MIN_DISTANCE, distance + amount));
  }

  _scaleBy(factor) {
    this.target.scale.setScalar(clampScale(this.target.scale.x * factor));
  }

  _handleButtons(hand, gamepad) {
    const pressed = gamepad.buttons.map((b) => b.pressed);
    const down = (i) => pressed[i] && !hand.prevButtons[i];
    const a = this.actions;

    if (hand.handedness === 'right') {
      if (down(BTN_A_X)) a.onNext?.();
      if (down(BTN_B_Y)) a.onPrev?.();
    } else if (hand.handedness === 'left') {
      if (down(BTN_A_X)) a.onReset?.();
      if (down(BTN_B_Y)) a.onToggleAnimation?.();
    }
    if (down(BTN_STICK)) a.onReset?.();

    hand.prevButtons = pressed;
  }
}

function deadzone(v) {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

function isVisible(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function clampScale(s) {
  return THREE.MathUtils.clamp(s, MIN_SCALE, MAX_SCALE);
}
