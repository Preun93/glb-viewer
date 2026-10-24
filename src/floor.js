const DEFAULT_EYE_HEIGHT = 1.6; // Meter, Schätzung bis ein Treffer vorliegt
const MIN_UP = 0.7;

/**
 * Ermittelt die Bodenhöhe im aktuellen Referenzraum.
 *
 * Ohne "local-floor" ist y = 0 nicht der Boden. Daher wird einmalig ein
 * Hit-Test-Strahl von der Kopfposition senkrecht nach unten geschickt; bis
 * zum ersten Treffer gilt Augenhöhe minus DEFAULT_EYE_HEIGHT.
 */
export class FloorEstimator {
  constructor(renderer) {
    this.renderer = renderer;
    this.y = 0;
    this.known = false;
    this.source = null;
    this._session = null;
  }

  /** @param {THREE.Vector3} eye Kopfposition im Referenzraum */
  async start(eye) {
    this.stop();
    this.y = eye.y - DEFAULT_EYE_HEIGHT;

    const session = this.renderer.xr.getSession();
    const base = this.renderer.xr.getReferenceSpace();
    this._session = session;
    if (!session?.requestHitTestSource || !base) return;

    try {
      const space = base.getOffsetReferenceSpace(new XRRigidTransform({ x: eye.x, y: eye.y, z: eye.z }));
      const offsetRay = new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -1, z: 0, w: 0 });
      const source = await session.requestHitTestSource({ space, offsetRay });
      if (this._session === session && !this.known) this.source = source;
      else source.cancel();
    } catch (err) {
      console.warn('Bodenhöhe per Hit-Test nicht verfügbar, nutze Schätzung:', err);
    }
  }

  stop() {
    this.source?.cancel();
    this.source = null;
    this._session = null;
    this.known = false;
  }

  update(frame) {
    const space = this.renderer.xr.getReferenceSpace();
    if (!this.source || !frame || !space) return;

    for (const result of frame.getHitTestResults(this.source)) {
      const pose = result.getPose(space);
      if (!pose) continue;
      // Normale = lokale y-Achse der Trefferpose; nur waagerechte Flächen.
      const { x, z } = pose.transform.orientation;
      const upY = 1 - 2 * (x * x + z * z);
      if (upY < MIN_UP) continue;

      this.y = pose.transform.position.y;
      this.known = true;
      this.source.cancel();
      this.source = null;
      return;
    }
  }
}
