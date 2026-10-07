import * as THREE from 'three';

const WIDTH = 512;
const HEIGHT = 256;

const HELP = [
  'Grip: greifen  ·  2× Grip: skalieren',
  'R-Stick: drehen  ·  L-Stick: Abstand/Größe',
  'A/B: Modell  ·  X: Reset  ·  Y: Animation',
];

/** Kleines Info-Panel, das über dem linken Controller schwebt. */
export class Hud {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.08),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.mesh.position.set(0, 0.07, 0.01);
    this.mesh.rotation.x = -Math.PI / 4;
    this.mesh.renderOrder = 10;

    this.title = '';
    this.status = '';
    this._draw();
  }

  set(title, status = '') {
    if (title === this.title && status === this.status) return;
    this.title = title;
    this.status = status;
    this._draw();
  }

  _draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = 'rgba(16, 19, 25, 0.82)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, WIDTH, HEIGHT, 28);
    else ctx.rect(0, 0, WIDTH, HEIGHT);
    ctx.fill();

    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, this.title || 'GLB Viewer', WIDTH - 48), 24, 22);

    ctx.fillStyle = '#7fb0ff';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, this.status, WIDTH - 48), 24, 72);

    ctx.fillStyle = '#b8bfcc';
    ctx.font = '22px system-ui, sans-serif';
    HELP.forEach((line, i) => ctx.fillText(line, 24, 134 + i * 34));

    this.texture.needsUpdate = true;
  }
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}
