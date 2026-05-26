import { Effect, makeMaterial, colorFor, disposeMesh } from './_shared.js';

export class Trails extends Effect {
  static defaults = {
    count: 5,
    maxDelay: 0.5,
    radiusRange: [0.5, 2.0],
    sides: 6,
    color: 0x00ffff,
    opacity: 0.6,
    zIndex: 0.02,
    ballColors: {},
    gradient: false,
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.history = new Map();   // ballId → [{ pos, time }]
    this.polygons = new Map();  // ballId → mesh[]
  }

  update(positions, ctx) {
    for (const [ballId, pos] of positions) {
      this._recordHistory(ballId, pos, ctx.time);
      this._ensurePolygons(ballId);
      this._animatePolygons(ballId, ctx.time);
    }
  }

  configure(config) {
    const rebuild =
      (config.count !== undefined && config.count !== this.config.count) ||
      (config.sides !== undefined && config.sides !== this.config.sides) ||
      (config.radiusRange !== undefined);
    Object.assign(this.config, config);
    if (rebuild) this._disposeAll();
    else this._restyleAll();
  }

  dispose() {
    this._disposeAll();
    this.history.clear();
  }

  removeBall(ballId) {
    this._disposeBall(ballId);
    this.history.delete(ballId);
  }

  _recordHistory(ballId, pos, now) {
    if (!this.history.has(ballId)) this.history.set(ballId, []);
    const hist = this.history.get(ballId);
    hist.push({ pos: { x: pos.x, y: pos.y }, time: now });
    while (hist.length > 0 && hist[0].time < now - this.config.maxDelay) hist.shift();
  }

  _ensurePolygons(ballId) {
    if (this.polygons.has(ballId)) return;
    const meshes = [];
    const { count, sides, radiusRange, zIndex, opacity } = this.config;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1);
      const radius = radiusRange[0] + (radiusRange[1] - radiusRange[0]) * t;
      const geom = new THREE.CircleGeometry(radius, sides);
      const mat = makeMaterial({
        color: colorFor(this.config, ballId, t),
        opacity: opacity * (1 - t * 0.5),
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.z = zIndex - i * 0.001;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    this.polygons.set(ballId, meshes);
  }

  _animatePolygons(ballId, now) {
    const meshes = this.polygons.get(ballId);
    const { count, maxDelay } = this.config;
    for (let i = 0; i < count; i++) {
      const delay = count === 1 ? 0 : (i / (count - 1)) * maxDelay;
      const { x, y } = this._positionAt(ballId, now - delay);
      meshes[i].position.x = x;
      meshes[i].position.y = y;
    }
  }

  _positionAt(ballId, targetTime) {
    const hist = this.history.get(ballId) || [];
    if (hist.length === 0) return { x: 0, y: 0 };
    if (hist.length === 1 || targetTime >= hist[hist.length - 1].time) return hist[hist.length - 1].pos;
    for (let i = 0; i < hist.length - 1; i++) {
      if (hist[i].time <= targetTime && hist[i + 1].time >= targetTime) {
        const span = hist[i + 1].time - hist[i].time;
        const t = span > 0 ? (targetTime - hist[i].time) / span : 0;
        return {
          x: hist[i].pos.x + (hist[i + 1].pos.x - hist[i].pos.x) * t,
          y: hist[i].pos.y + (hist[i + 1].pos.y - hist[i].pos.y) * t,
        };
      }
    }
    return hist[0].pos;
  }

  _restyleAll() {
    const { count, opacity } = this.config;
    for (const [ballId, meshes] of this.polygons) {
      for (let i = 0; i < meshes.length; i++) {
        const t = count === 1 ? 0 : i / (count - 1);
        meshes[i].material.color.setHex(colorFor(this.config, ballId, t));
        meshes[i].material.opacity = opacity * (1 - t * 0.5);
      }
    }
  }

  _disposeBall(ballId) {
    const meshes = this.polygons.get(ballId);
    if (!meshes) return;
    for (const m of meshes) disposeMesh(this.scene, m);
    this.polygons.delete(ballId);
  }

  _disposeAll() {
    for (const ballId of [...this.polygons.keys()]) this._disposeBall(ballId);
  }
}