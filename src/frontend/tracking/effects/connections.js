import { Effect, makeMaterial, makeTube, makeDisc, makeRing, disposeMesh } from './_shared.js';

export class Connections extends Effect {
  static defaults = {
    mode: 'none',  // 'none' | 'mesh' | 'sequential' | 'circles'
    color: 0x00ffff,
    opacity: 1.0,
    lineWidth: 0.1,
    zIndex: 0.05,
    segments: 32,
    filled: false,
    perCircleColors: false,
    circleContents: [0xff0000, 0x00ff00, 0x0000ff],
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.pairs = new Map();   // pairId → { mesh, perimeter?, p1, p2, color }
    this._onVisibilityChange = null;
    this._ballMedia = null;
  }

  /** Wire dependencies for video-textured circles. */
  setBallMedia(bm) { this._ballMedia = bm; }
  onVisibilityChange(fn) { this._onVisibilityChange = fn; }

  configure(config) {
    const modeChanged = config.mode !== undefined && config.mode !== this.config.mode;
    const filledChanged = config.filled !== undefined && config.filled !== this.config.filled;
    const rebuild = modeChanged || filledChanged ||
      (config.lineWidth !== undefined && config.lineWidth !== this.config.lineWidth) ||
      (config.segments !== undefined && config.segments !== this.config.segments);

    Object.assign(this.config, config);

    if (rebuild) this._disposeAll();
    else this._restyleAll();

    if (this._onVisibilityChange) {
      this._onVisibilityChange(!(this.config.mode === 'circles' && this.config.filled));
    }
  }

  update(positions, ctx) {
    if (this.config.mode === 'none' || positions.size < 2) return;

    const ids = [...positions.keys()];
    const pairList = this._computePairs(ids);
    const seen = new Set();

    pairList.forEach(([idA, idB], index) => {
      const p1 = positions.get(idA);
      const p2 = positions.get(idB);
      const pairId = `${idA}-${idB}`;
      seen.add(pairId);

      const existing = this.pairs.get(pairId);
      if (!existing || this._moved(existing, p1, p2)) {
        if (existing) this._disposePair(pairId);
        this._createPair(pairId, p1, p2, index);
      }
    });

    // Drop stale pairs
    for (const pairId of [...this.pairs.keys()]) {
      if (!seen.has(pairId)) this._disposePair(pairId);
    }

    if (this.config.mode === 'circles') this._layerCircles();
  }

  dispose() {
    this._disposeAll();
    if (this._onVisibilityChange) this._onVisibilityChange(true);
  }

  _computePairs(ids) {
    if (this.config.mode === 'sequential') {
      const sorted = [...ids].sort();
      return sorted.map((id, i) => [id, sorted[(i + 1) % sorted.length]]);
    }
    const pairs = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        pairs.push([ids[i], ids[j]]);
    return pairs;
  }

  _moved(obj, p1, p2) {
    return Math.abs(p1.x - obj.p1.x) > 0.01 || Math.abs(p1.y - obj.p1.y) > 0.01 ||
           Math.abs(p2.x - obj.p2.x) > 0.01 || Math.abs(p2.y - obj.p2.y) > 0.01;
  }

  _createPair(pairId, p1, p2, index) {
    const mode = this.config.mode;
    if (mode === 'circles') this._createCircle(pairId, p1, p2, index);
    else                    this._createLine(pairId, p1, p2);
  }

  _createLine(pairId, p1, p2) {
    const geom = makeTube(
      { x: p1.x, y: p1.y, z: 0 },
      { x: p2.x, y: p2.y, z: 0 },
      this.config.lineWidth, 8
    );
    const mat = makeMaterial({ color: this.config.color, opacity: this.config.opacity });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.z = this.config.zIndex;
    this.scene.add(mesh);
    this.pairs.set(pairId, { mesh, p1: { ...p1 }, p2: { ...p2 }, color: this.config.color });
  }

  _createCircle(pairId, p1, p2, index) {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
    const content = this.config.perCircleColors
      ? this.config.circleContents[index % this.config.circleContents.length]
      : this.config.color;

    let geom, mat, perimeter = null;
    if (this.config.filled) {
      geom = makeDisc(radius, this.config.segments);
      mat = makeMaterial({ color: content, opacity: this.config.opacity, additive: true });
      // optional white perimeter ring
      if (this.config.lineWidth > 0) {
        const pGeom = makeRing(Math.max(0.01, radius - this.config.lineWidth), radius, this.config.segments);
        const pMat = makeMaterial({ color: 0xffffff });
        perimeter = new THREE.Mesh(pGeom, pMat);
        perimeter.position.set(cx, cy, 0.001);
        this.scene.add(perimeter);
      }
    } else {
      geom = makeRing(Math.max(0.01, radius - this.config.lineWidth), radius, this.config.segments);
      mat = makeMaterial({ color: content, opacity: this.config.opacity, additive: true });
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cx, cy, 0);
    this.scene.add(mesh);

    this.pairs.set(pairId, {
      mesh, perimeter, radius,
      p1: { ...p1 }, p2: { ...p2 },
      color: content,
    });
  }

  _layerCircles() {
    [...this.pairs.values()]
      .filter(p => p.radius !== undefined)
      .sort((a, b) => b.radius - a.radius)
      .forEach((p, i) => { p.mesh.position.z = this.config.zIndex - i * 0.01; });
  }

  _restyleAll() {
    for (const pair of this.pairs.values()) {
      pair.mesh.material.color.setHex(pair.color);
      pair.mesh.material.opacity = this.config.opacity;
    }
  }

  _disposePair(pairId) {
    const pair = this.pairs.get(pairId);
    if (!pair) return;
    disposeMesh(this.scene, pair.mesh);
    if (pair.perimeter) disposeMesh(this.scene, pair.perimeter);
    this.pairs.delete(pairId);
  }

  _disposeAll() {
    for (const id of [...this.pairs.keys()]) this._disposePair(id);
  }
}