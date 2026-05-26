import { Effect } from './_shared.js';

export class Captions extends Effect {
  static defaults = {
    text: '',
    texts: {},
    fontStyle: 'normal',
    fontFamily: 'Arial',
    fontSize: 48,
    color: 0xffffff,
    bgColor: null,
    opacity: 1.0,
    offsetX: 0,
    offsetY: 2.0,
    zIndex: 1,
    padding: 8,
    scale: 0.05,
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.labels = new Map();  // ballId → { mesh, texture, text, canvasW, canvasH }
  }

  update(positions, ctx) {
    for (const [ballId, pos] of positions) {
      this._ensureLabel(ballId);
      this._updateLabel(ballId, pos, ctx);
    }
  }

  configure(config) {
    const rebuild =
      (config.fontStyle !== undefined) ||
      (config.fontFamily !== undefined) ||
      (config.fontSize !== undefined) ||
      (config.padding !== undefined) ||
      (config.bgColor !== undefined);
    Object.assign(this.config, config);
    if (rebuild) this._disposeAll();
    else this._restyleAll();
  }

  dispose() {
    this._disposeAll();
  }

  removeBall(ballId) {
    this._disposeLabel(ballId);
  }

  _ensureLabel(ballId) {
    if (this.labels.has(ballId)) return;
    const text = this._textFor(ballId);
    const { canvas, width, height } = this._rasterize(text);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: this.config.color,
      transparent: true,
      opacity: this.config.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const scale = this._eval(this.config.scale);
    const geometry = new THREE.PlaneGeometry(width * scale, height * scale);
    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);

    this.labels.set(ballId, { mesh, texture, text, canvasW: width, canvasH: height });
  }

  _updateLabel(ballId, pos, ctx) {
    const label = this.labels.get(ballId);
    const wanted = this._textFor(ballId);

    if (wanted !== label.text) {
      const { canvas, width, height } = this._rasterize(wanted);
      label.texture.dispose();
      label.texture = new THREE.CanvasTexture(canvas);
      label.texture.minFilter = label.texture.magFilter = THREE.LinearFilter;
      label.mesh.material.map = label.texture;
      label.mesh.material.needsUpdate = true;
      label.text = wanted;
      label.canvasW = width;
      label.canvasH = height;
    }

    const scale = this._eval(this.config.scale);
    const wantW = label.canvasW * scale;
    const wantH = label.canvasH * scale;
    if (Math.abs(label.mesh.geometry.parameters.width - wantW) > 1e-4 ||
        Math.abs(label.mesh.geometry.parameters.height - wantH) > 1e-4) {
      label.mesh.geometry.dispose();
      label.mesh.geometry = new THREE.PlaneGeometry(wantW, wantH);
    }

    const ox = this._eval(this.config.offsetX);
    const oy = this._eval(this.config.offsetY);
    label.mesh.position.set(pos.x + ox, pos.y + oy, this.config.zIndex);
    label.mesh.material.opacity = this._eval(this.config.opacity);
  }

  _textFor(ballId) {
    const t = this.config.texts;
    if (t) {
      const idx = String(ballId).replace(/^ball_/, '');
      if (t[idx] !== undefined) return String(t[idx]);
      if (t[ballId] !== undefined) return String(t[ballId]);
    }
    return String(this.config.text ?? '');
  }

  _eval(value) {
    if (typeof value === 'number') return value;
    const sm = this.sceneManager;
    if (typeof value === 'string' && sm?.evaluator?.isExpression?.(value)) {
      try {
        const ctx = sm.getBallContext ? sm.getBallContext() : { time: sm.getTime() };
        const r = sm.evaluator.evaluate(value, ctx);
        return Number.isFinite(r) ? r : 0;
      } catch { return 0; }
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  _rasterize(text) {
    const cfg = this.config;
    const fontSize = Math.max(1, this._eval(cfg.fontSize));
    const padding = Math.max(0, cfg.padding | 0);
    const fontSpec = `${cfg.fontStyle} ${fontSize}px ${cfg.fontFamily}`;

    const probe = document.createElement('canvas').getContext('2d');
    probe.font = fontSpec;
    const lines = String(text === '' ? ' ' : text).split('\n');
    let maxW = 0;
    for (const line of lines) maxW = Math.max(maxW, probe.measureText(line).width);
    const lineH = fontSize * 1.2;
    const width = Math.max(1, Math.ceil(maxW + padding * 2));
    const height = Math.max(1, Math.ceil(lineH * lines.length + padding * 2));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (cfg.bgColor != null) {
      ctx.fillStyle = '#' + (cfg.bgColor & 0xffffff).toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = fontSpec;
    ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], padding, padding + i * lineH);

    return { canvas, width, height };
  }

  _restyleAll() {
    for (const label of this.labels.values()) {
      label.mesh.material.color.setHex(this.config.color);
      label.mesh.material.opacity = this.config.opacity;
    }
  }

  _disposeLabel(ballId) {
    const label = this.labels.get(ballId);
    if (!label) return;
    this.scene.remove(label.mesh);
    label.mesh.geometry.dispose();
    label.mesh.material.dispose();
    label.texture.dispose();
    this.labels.delete(ballId);
  }

  _disposeAll() {
    for (const id of [...this.labels.keys()]) this._disposeLabel(id);
  }
}