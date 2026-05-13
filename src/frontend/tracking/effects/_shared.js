/**
 * Effects Framework — Shared base classes and utilities
 *
 * Used by all effects in this folder (trails, connections, spacetime, sincwaves).
 *
 * Adding a new effect:
 *   1. Pick a base class (PerBallEffect or GlobalEffect)
 *   2. Define static defaults = { ... }
 *   3. Override 1-2 methods (createGeometry + animate*)
 *   4. Register it with effectRegistry at the bottom of the file
 *   5. Import the new file from ball-tracking.js
 */


// ============================================================================
// GeometryBase — THREE.js object lifecycle
// ============================================================================

export class GeometryBase {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getWebGLScene();
    this.objects = new Map(); // id -> {mesh, material, geometry, ...}
  }

  // Override these in subclasses
  createGeometry(id, params) { throw new Error('Must implement createGeometry'); }
  updateGeometry(id, params) { throw new Error('Must implement updateGeometry'); }

  add(id, params) {
    this.remove(id);
    const obj = this.createGeometry(id, params);
    if (obj) {
      this.scene.add(obj.mesh);
      this.objects.set(id, obj);
    }
    return obj;
  }

  update(id, params) {
    if (this.objects.get(id)) this.updateGeometry(id, params);
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.material?.map?.dispose();
    this.objects.delete(id);
  }

  clear() {
    for (const id of this.objects.keys()) this.remove(id);
  }

  get(id) { return this.objects.get(id); }
  getAll() { return Array.from(this.objects.values()); }
  has(id) { return this.objects.has(id); }
}


// ============================================================================
// GeometryPrimitives — 2D shape generators (circle, ring, polygon, tube)
// ============================================================================

export class GeometryPrimitives {
  /** Filled circle (or polygon if low segments) with optional white perimeter */
  static circle(radius, segments = 32, perimeterWidth = 0) {
    const fill = new THREE.CircleGeometry(radius, segments);
    const perimeter = perimeterWidth > 0
      ? new THREE.RingGeometry(Math.max(0.01, radius - perimeterWidth), radius, segments)
      : null;
    return { fill, perimeter };
  }

  /** Hollow ring (annulus) */
  static ring(innerRadius, outerRadius, segments = 32) {
    return new THREE.RingGeometry(innerRadius, outerRadius, segments);
  }

  /** Regular polygon — circle with low segment count */
  static polygon(radius, sides, perimeterWidth = 0) {
    return this.circle(radius, sides, perimeterWidth);
  }

  /** Tube between two points (used for connection lines) */
  static tube(p1, p2, width, radialSegments = 8) {
    const path = new THREE.LineCurve3(p1, p2);
    return new THREE.TubeGeometry(path, 1, width, radialSegments, false);
  }
}


// ============================================================================
// MaterialBuilder — Fluent builder for THREE.MeshBasicMaterial
// ============================================================================
//
// Usage: new MaterialBuilder().color(0xff0000).opacity(0.8).doubleSided().additive().build()
//
// Only the chain methods actually used by current effects are exposed.

export class MaterialBuilder {
  constructor() {
    this.config = {
      color: 0xffffff,
      opacity: 1.0,
      transparent: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
  }

  color(value)    { this.config.color = value; return this; }
  opacity(value)  { this.config.opacity = value; this.config.transparent = value < 1.0; return this; }
  doubleSided()   { this.config.side = THREE.DoubleSide; return this; }
  additive()      { this.config.blending = THREE.AdditiveBlending; this.config.transparent = true; return this; }

  build() {
    return new THREE.MeshBasicMaterial({ ...this.config });
  }
}


// ============================================================================
// ColorUtils — Color helpers (only interpolate is used)
// ============================================================================

export class ColorUtils {
  /** Linear interpolation between two hex colors */
  static interpolate(color1, color2, factor) {
    const r1 = (color1 >> 16) & 0xff, g1 = (color1 >> 8) & 0xff, b1 = color1 & 0xff;
    const r2 = (color2 >> 16) & 0xff, g2 = (color2 >> 8) & 0xff, b2 = color2 & 0xff;
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    return (r << 16) | (g << 8) | b;
  }
}


// ============================================================================
// resolveColor — Color lookup honoring per-ball colors + gradients
// ============================================================================

export function resolveColor(config, ballId, t = 0) {
  // Per-ball colors take priority
  if (config.perBallColors && config.ballColors) {
    const ballColor = config.ballColors[ballId] ?? config.ballColors[String(ballId)];
    if (ballColor !== undefined) {
      if (Array.isArray(ballColor) && ballColor.length === 2) {
        return ColorUtils.interpolate(ballColor[0], ballColor[1], t);
      }
      return Array.isArray(ballColor) ? ballColor[0] : ballColor;
    }
  }

  // Global gradient
  if (config.gradient && Array.isArray(config.color) && config.color.length === 2) {
    return ColorUtils.interpolate(config.color[0], config.color[1], t);
  }

  // Plain color (or first of array)
  return Array.isArray(config.color) ? config.color[0] : (config.color ?? 0xffffff);
}


// ============================================================================
// EffectBase — Abstract foundation for all effects
// ============================================================================

export class EffectBase extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    this.config = { ...this.constructor.defaults };
  }

  setConfig(config) {
    const prev = { ...this.config };
    Object.assign(this.config, config);
    this._onConfigChange(config, prev);
  }

  _onConfigChange(changed, prev) {
    const keys = this.constructor.recreateKeys || [];
    const needsRecreate = keys.some(k => changed[k] !== undefined && changed[k] !== prev[k]);
    if (needsRecreate) {
      this.clear();
    } else {
      this._updateMaterials();
    }
  }

  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = resolveColor(this.config, obj.ballId, obj._colorT ?? 0);
      if (obj.material?.color) obj.material.color.setHex(color);
      if (obj.material && this.config.opacity !== undefined) {
        obj.material.opacity = this.config.opacity;
        obj.material.transparent = this.config.opacity < 1.0;
      }
    }
  }

  createGeometry(id, params) { return null; }
  updateGeometry(id, params) {}
}


// ============================================================================
// PerBallEffect — One or more objects tracking each ball
// ============================================================================

export class PerBallEffect extends EffectBase {
  constructor(sceneManager) {
    super(sceneManager);
    this._ballIds = new Set();
    this._posHistory = new Map();
    this._rotState = new Map();
    this._time = 0;
  }

  updateBall(ballId, worldPos) {
    const dt = 0.016;
    this._time += dt;

    if (this.constructor.usesHistory) this._recordHistory(ballId, worldPos);
    if (this.constructor.usesRotation) this._updateRotation(ballId);

    this._ballIds.add(ballId);

    const count = this.getObjectCount();

    if (count === 1) {
      const objId = `${ballId}-${this.constructor.idPrefix || 'obj'}`;
      if (this.has(objId)) {
        this.animateForBall(this.get(objId), ballId, worldPos, dt);
      } else {
        const result = this.createForBall(ballId, worldPos);
        if (result) {
          this.scene.add(result.mesh);
          result.ballId = ballId;
          this.objects.set(objId, result);
        }
      }
    } else {
      this.animateAllForBall(ballId, worldPos, dt);
    }
  }

  removeBall(ballId) {
    this._ballIds.delete(ballId);
    this._posHistory.delete(ballId);
    this._rotState.delete(ballId);

    const prefix = `${ballId}-`;
    const toRemove = [];
    for (const id of this.objects.keys()) {
      if (id.startsWith(prefix)) toRemove.push(id);
    }
    toRemove.forEach(id => this.remove(id));
  }

  clear() {
    super.clear();
    this._ballIds.clear();
    this._posHistory.clear();
    this._rotState.clear();
    this._time = 0;
  }

  // --- Override points ---
  getObjectCount() { return 1; }
  createForBall(ballId, worldPos) { return null; }
  animateForBall(obj, ballId, worldPos, dt) {
    obj.mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex ?? 0.03);
  }
  animateAllForBall(ballId, worldPos, dt) {}

  // --- Helpers for subclasses ---

  getHistory(ballId) {
    return this._posHistory.get(ballId) || [];
  }

  getPositionAtTime(ballId, targetTime) {
    const history = this.getHistory(ballId);
    if (history.length === 0) return { x: 0, y: 0 };
    if (history.length === 1) return { ...history[0].pos };

    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].time <= targetTime && history[i + 1].time >= targetTime) {
        const t = (targetTime - history[i].time) / (history[i + 1].time - history[i].time);
        return {
          x: history[i].pos.x + (history[i + 1].pos.x - history[i].pos.x) * t,
          y: history[i].pos.y + (history[i + 1].pos.y - history[i].pos.y) * t
        };
      }
    }
    return { ...history[history.length - 1].pos };
  }

  get time() { return this._time; }

  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  // --- Internal ---

  _recordHistory(ballId, worldPos) {
    const now = Date.now() / 1000;
    if (!this._posHistory.has(ballId)) this._posHistory.set(ballId, []);
    const history = this._posHistory.get(ballId);
    const rotation = this._rotState.get(ballId);
    history.push({ pos: { ...worldPos }, time: now, rotation: rotation ? { ...rotation } : null });

    const maxDelay = this.config.maxDelay ?? 2.0;
    while (history.length > 0 && history[0].time < now - maxDelay) history.shift();
  }

  _updateRotation(ballId) {
    if (!this._rotState.has(ballId)) this._rotState.set(ballId, { x: 0, y: 0, z: 0 });
    const rot = this._rotState.get(ballId);
    rot.x += this.config.rotateX ?? 0;
    rot.y += this.config.rotateY ?? 0;
    rot.z += this.config.rotateZ ?? 0;
  }
}


// ============================================================================
// GlobalEffect — Operates on all ball positions at once
// ============================================================================

export class GlobalEffect extends EffectBase {
  constructor(sceneManager) {
    super(sceneManager);
    this._time = 0;
  }

  get time() { return this._time; }

  /** Override this — main entry point. positions = { ballId: { x, y }, ... } */
  updateField(positions) {}

  tick(dt = 0.016) { this._time += dt; }

  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  clear() {
    super.clear();
    this._time = 0;
  }
}