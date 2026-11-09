import * as THREE from 'three';

// Licht fast senkrecht von oben, damit der Schatten unter dem Modell liegt.
const LIGHT_DIR = new THREE.Vector3(0.25, 1, 0.15).normalize();
const OPACITY = 0.38;
const SURFACE_OFFSET = 0.002; // Meter über der Fläche, gegen Z-Fighting
const SHADOW_INTERVAL = 2; // Shadow-Map bei Bewegung nur jeden n-ten Frame

const _tan = Math.hypot(LIGHT_DIR.x, LIGHT_DIR.z) / LIGHT_DIR.y;

/**
 * Schatten des Modells auf einer realen Fläche (AR).
 *
 * Eine unsichtbare Ebene mit `ShadowMaterial` zeigt nur den Schatten – im
 * Passthrough wirkt er, als fiele er auf Boden oder Tisch. Das Schattenlicht
 * folgt dem Modell, damit die Shadow-Map es immer eng umschließt.
 */
export class GroundShadow {
  constructor(renderer, scene, light) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Die Shadow-Map rendert das ganze Modell ein zweites Mal – nur neu
    // berechnen, wenn sich etwas geändert hat (siehe update()).
    renderer.shadowMap.autoUpdate = false;
    this.renderer = renderer;
    this._lastMatrix = new THREE.Matrix4();
    this._lastSurfaceY = NaN;
    this._lastContent = null;
    this._pending = true;
    this._frame = 0;

    this.light = light;
    this.lightHome = light.position.clone();
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.02;
    scene.add(light.target);

    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: OPACITY, depthWrite: false }),
    );
    this.plane.receiveShadow = true;
    this.plane.visible = false;
    scene.add(this.plane);

    this.enabled = false;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.light.castShadow = enabled;
    this._pending = true;
    if (!enabled) {
      this.plane.visible = false;
      this.light.position.copy(this.lightHome);
      this.light.target.position.set(0, 0, 0);
    }
  }

  /**
   * @param {THREE.Vector3} center Weltmittelpunkt des Modells
   * @param {number} radius        Radius der umschließenden Kugel (m)
   * @param {number} surfaceY      Höhe der Fläche unter dem Modell
   * @param {{ content?: THREE.Object3D, matrix?: THREE.Matrix4, animated?: boolean }} state
   *        Wird verglichen, um die Shadow-Map nur bei Änderungen neu zu rendern.
   */
  update(center, radius, surfaceY, { content = null, matrix = null, animated = false } = {}) {
    if (!this.enabled || !(radius > 0)) {
      this.plane.visible = false;
      return;
    }

    const changed =
      animated ||
      content !== this._lastContent ||
      surfaceY !== this._lastSurfaceY ||
      !matrix ||
      !this._lastMatrix.equals(matrix);
    if (changed) {
      this._lastContent = content;
      this._lastSurfaceY = surfaceY;
      if (matrix) this._lastMatrix.copy(matrix);
      this._pending = true;
    }

    // Während fortlaufender Bewegung nur jeden 2. Frame, beim Stillstand sofort.
    this._frame++;
    if (this._pending && (!changed || this._frame % SHADOW_INTERVAL === 0)) {
      this.renderer.shadowMap.needsUpdate = true;
      this._pending = false;
    }

    const height = Math.max(0, center.y - surfaceY);
    const distance = radius + 1;
    this.light.position.copy(center).addScaledVector(LIGHT_DIR, distance);
    this.light.target.position.copy(center);

    const extent = radius * 1.1;
    const cam = this.light.shadow.camera;
    cam.left = cam.bottom = -extent;
    cam.right = cam.top = extent;
    cam.near = 0.01;
    cam.far = distance + radius + height / LIGHT_DIR.y + 0.5;
    cam.updateProjectionMatrix();

    this.plane.position.set(center.x, surfaceY + SURFACE_OFFSET, center.z);
    this.plane.scale.setScalar(2 * (extent + height * _tan) + 0.2);
    this.plane.visible = true;
  }
}
