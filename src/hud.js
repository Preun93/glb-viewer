import * as THREE from 'three';

const WIDTH = 512;
const HEIGHT = 256;
const PANEL_W = 0.16;
const PANEL_H = 0.08;

const BUTTON_W = 0.077;
const BUTTON_H = 0.026;
const BUTTON_PX_W = 308;
const BUTTON_PX_H = 104;

const HELP = [
  'Grip: greifen  ·  2× Grip: skalieren',
  'R-Stick: drehen  ·  L-Stick: Abstand/Größe',
  'A/B: Modell  ·  X: Reset  ·  Y: Animation',
  'Knöpfe: rechts zielen + Trigger',
];

const HELP_PLACING = [
  'Rechts auf Boden oder Tisch zielen',
  'Trigger: dort abstellen (100 %)',
  'R-Stick ↔: drehen  ·  X: abbrechen',
];

const PLACE_LABEL = 'Auf Fläche · 1:1';

/**
 * Info-Panel über dem linken Controller, darunter zwei Knöpfe
 * („AR beenden“, „Auf Fläche · 1:1“), die mit dem rechten Zeigestrahl
 * und Trigger ausgelöst werden.
 */
export class Hud {
  constructor({ onExit, onPlace } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W, PANEL_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    panel.position.y = 0.02;
    panel.renderOrder = 10;

    this.exitButton = new HudButton('AR beenden', onExit, '#c0392b');
    this.exitButton.mesh.position.set(-(BUTTON_W / 2 + 0.003), -0.04, 0);
    this.placeButton = new HudButton(PLACE_LABEL, onPlace, '#2f6fe0');
    this.placeButton.mesh.position.set(BUTTON_W / 2 + 0.003, -0.04, 0);

    this.mesh = new THREE.Group();
    this.mesh.add(panel, this.exitButton.mesh, this.placeButton.mesh);
    this.mesh.position.set(0, 0.07, 0.01);
    this.mesh.rotation.x = -Math.PI / 4;

    /** Meshes, die der Zeigestrahl treffen kann. */
    this.buttons = [this.exitButton.mesh, this.placeButton.mesh];

    this.title = '';
    this.status = '';
    this.scale = '';
    this.placing = false;
    this._draw();
  }

  set(title, status = '') {
    if (title === this.title && status === this.status) return;
    this.title = title;
    this.status = status;
    this._draw();
  }

  /** Maßstab relativ zur Originalgröße, z. B. 100 → „100 %“. */
  setScale(percent) {
    const text = percent == null ? '' : `${percent} %`;
    if (text === this.scale) return;
    this.scale = text;
    this._draw();
  }

  setPlacing(placing) {
    if (placing === this.placing) return;
    this.placing = placing;
    this.placeButton.setLabel(placing ? 'Abbrechen' : PLACE_LABEL);
    this._draw();
  }

  _draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = 'rgba(16, 19, 25, 0.82)';
    roundRect(ctx, 0, 0, WIDTH, HEIGHT, 28);
    ctx.fill();

    ctx.textBaseline = 'top';
    let titleWidth = WIDTH - 48;
    if (this.scale) {
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillStyle = '#7fb0ff';
      ctx.textAlign = 'right';
      ctx.fillText(this.scale, WIDTH - 24, 28);
      ctx.textAlign = 'left';
      titleWidth -= ctx.measureText(this.scale).width + 16;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, this.title || 'GLB Viewer', titleWidth), 24, 22);

    ctx.fillStyle = '#7fb0ff';
    ctx.font = '26px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, this.status, WIDTH - 48), 24, 72);

    ctx.fillStyle = '#b8bfcc';
    ctx.font = '21px system-ui, sans-serif';
    (this.placing ? HELP_PLACING : HELP).forEach((line, i) => ctx.fillText(line, 24, 122 + i * 31));

    this.texture.needsUpdate = true;
  }
}

/** Ein Knopf im HUD; `mesh.userData` enthält onClick/onHover für den Zeigestrahl. */
class HudButton {
  constructor(label, onClick, color) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = BUTTON_PX_W;
    this.canvas.height = BUTTON_PX_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(BUTTON_W, BUTTON_H),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 11;
    this.mesh.userData.onClick = () => onClick?.();
    this.mesh.userData.onHover = (hover) => {
      if (hover === this.hover) return;
      this.hover = hover;
      this._draw();
    };

    this.label = label;
    this.color = color;
    this.hover = false;
    this._draw();
  }

  setLabel(label) {
    this.label = label;
    this._draw();
  }

  _draw() {
    const { ctx } = this;
    ctx.clearRect(0, 0, BUTTON_PX_W, BUTTON_PX_H);
    ctx.fillStyle = this.color;
    ctx.globalAlpha = this.hover ? 1 : 0.78;
    roundRect(ctx, 0, 0, BUTTON_PX_W, BUTTON_PX_H, 22);
    ctx.fill();
    if (this.hover) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6;
      roundRect(ctx, 3, 3, BUTTON_PX_W - 6, BUTTON_PX_H - 6, 20);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(ctx, this.label, BUTTON_PX_W - 24), BUTTON_PX_W / 2, BUTTON_PX_H / 2 + 2);
    this.texture.needsUpdate = true;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}
