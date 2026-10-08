import * as THREE from 'three';

const MIN_UP = 0.7; // nur annähernd waagerechte Flächen (Boden, Tisch)
const MAX_FLOOR_DISTANCE = 15; // Meter, Rückfall-Strahl auf den Boden

const _matrix = new THREE.Matrix4();
const _normal = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Sucht mit dem Zeigestrahl eines Controllers eine reale Fläche.
 *
 * Nutzt WebXR-Hit-Test (Raum-Mesh der Quest 3). Ohne Hit-Test oder ohne
 * Treffer dient der Boden (y = 0 im "local-floor"-Raum) als Fläche.
 * Ein Ring markiert die gefundene Stelle.
 */
export class Placement {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.active = false;
    this.hand = null;
    this.source = null;
    this.hasHit = false;
    this.point = new THREE.Vector3();

    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.reticle.renderOrder = 20;
    this.reticle.visible = false;
    scene.add(this.reticle);
  }

  async start(hand) {
    this.stop();
    this.active = true;
    this.hand = hand;

    const session = this.renderer.xr.getSession();
    if (!session?.requestHitTestSource || !hand.inputSource) return;
    try {
      const source = await session.requestHitTestSource({ space: hand.inputSource.targetRaySpace });
      if (this.active && this.hand === hand) this.source = source;
      else source.cancel();
    } catch (err) {
      console.warn('Hit-Test nicht verfügbar, nutze den Boden:', err);
    }
  }

  stop() {
    this.active = false;
    this.hand = null;
    this.source?.cancel();
    this.source = null;
    this.hasHit = false;
    this.reticle.visible = false;
  }

  update(frame) {
    if (!this.active) return;
    this.hasHit = this._hitTest(frame) || this._hitFloor();
    this.reticle.visible = this.hasHit;
    if (this.hasHit) this.reticle.position.copy(this.point);
  }

  _hitTest(frame) {
    const space = this.renderer.xr.getReferenceSpace();
    if (!this.source || !frame || !space) return false;

    for (const result of frame.getHitTestResults(this.source)) {
      const pose = result.getPose(space);
      if (!pose) continue;
      _matrix.fromArray(pose.transform.matrix);
      _normal.set(0, 1, 0).transformDirection(_matrix);
      if (_normal.y < MIN_UP) continue;
      this.point.setFromMatrixPosition(_matrix);
      return true;
    }
    return false;
  }

  _hitFloor() {
    _raycaster.setFromXRController(this.hand.controller);
    const { ray } = _raycaster;
    if (!ray.intersectPlane(_floor, this.point)) return false;
    return this.point.distanceTo(ray.origin) <= MAX_FLOOR_DISTANCE;
  }
}
