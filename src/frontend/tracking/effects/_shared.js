/**
 * Effects Framework — Shared base classes and utilities
 *
 * Merged from the former rendering/ framework files:
 *   - geometry-base.js          → GeometryBase
 *   - geometry-primitives.js    → GeometryPrimitives
 *   - material-factory.js       → MaterialFactory, MaterialBuilder, ColorUtils
 *   - effect-bases.js           → EffectBase, PerBallEffect, SpawnEffect,
 *                                 GlobalEffect, resolveColor, lerpColor
 *
 * All effects in this folder (trails, connections, spacetime, sincwaves)
 * import from here. Adding a new effect:
 *
 *   1. Pick a base class (PerBallEffect, SpawnEffect, GlobalEffect)
 *   2. Define static defaults = { ... }
 *   3. Override 1-2 methods
 *   4. Register it with effectRegistry
 *   5. Import the new file from ball-tracking.js
 */


// ============================================================================
// GeometryBase — THREE.js object lifecycle
// ============================================================================

export class GeometryBase {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getWebGLScene();
    this.objects = new Map(); // id -> {mesh, material, geometry, data}
  }
  
  // Override these in subclasses
  createGeometry(id, params) { throw new Error('Must implement createGeometry'); }
  updateGeometry(id, params) { throw new Error('Must implement updateGeometry'); }
  
  // Common lifecycle - no need to override
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
    const obj = this.objects.get(id);
    if (obj) this.updateGeometry(id, params);
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
// GeometryPrimitives — Reusable shape generators
// ============================================================================

export class GeometryPrimitives {
  /**
   * Create a filled circle with optional white perimeter
   */
  static circle(radius, segments = 32, perimeterWidth = 0) {
    const fillGeometry = new THREE.CircleGeometry(radius, segments);
    
    let perimeterGeometry = null;
    if (perimeterWidth > 0) {
      const innerRadius = Math.max(0.01, radius - perimeterWidth);
      perimeterGeometry = new THREE.RingGeometry(innerRadius, radius, segments);
    }
    
    return { fill: fillGeometry, perimeter: perimeterGeometry };
  }
  
  static ring(innerRadius, outerRadius, segments = 32) {
    return new THREE.RingGeometry(innerRadius, outerRadius, segments);
  }
  
  static polygon(radius, sides, perimeterWidth = 0) {
    return this.circle(radius, sides, perimeterWidth);
  }
  
  static tube(p1, p2, width, radialSegments = 8) {
    const path = new THREE.LineCurve3(p1, p2);
    return new THREE.TubeGeometry(path, 1, width, radialSegments, false);
  }
  
  static rectangle(width, height) {
    return new THREE.PlaneGeometry(width, height);
  }
  
  static starShape(outerRadius, innerRadius, points = 5) {
    const shape = new THREE.Shape();
    
    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }
  
  static spiralPath(innerRadius, outerRadius, turns = 2, segments = 100) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * turns * Math.PI * 2;
      const radius = innerRadius + (outerRadius - innerRadius) * t;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }
  
  static bezierCurve(start, control1, control2, end) {
    return new THREE.CubicBezierCurve3(start, control1, control2, end);
  }
  
  static arcPath(radius, startAngle, endAngle, segments = 32) {
    const points = [];
    const angleRange = endAngle - startAngle;
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * angleRange;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }
  
  // ========================================================================
  // 3D PRIMITIVES
  // ========================================================================
  
  static box(width, height, depth, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    return new THREE.BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments);
  }
  
  static sphere(radius, widthSegments = 16, heightSegments = 12) {
    return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  }
  
  static cone(radius, height, radialSegments = 8, heightSegments = 1, openEnded = false) {
    return new THREE.ConeGeometry(radius, height, radialSegments, heightSegments, openEnded);
  }
  
  static cylinder(radiusTop, radiusBottom, height, radialSegments = 8, heightSegments = 1) {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments);
  }
  
  static torus(radius, tube, radialSegments = 8, tubularSegments = 16) {
    return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
  }
  
  static tetrahedron(radius, detail = 0) {
    return new THREE.TetrahedronGeometry(radius, detail);
  }
  
  static octahedron(radius, detail = 0) {
    return new THREE.OctahedronGeometry(radius, detail);
  }
  
  static icosahedron(radius, detail = 0) {
    return new THREE.IcosahedronGeometry(radius, detail);
  }
  
  static dodecahedron(radius, detail = 0) {
    return new THREE.DodecahedronGeometry(radius, detail);
  }
  
  // ========================================================================
  // WIREFRAME HELPERS
  // ========================================================================
  
  static wireframeCube(size = 1) {
    const geometry = new THREE.BoxGeometry(size, size, size);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeSphere(radius = 1, widthSegments = 8, heightSegments = 6) {
    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeCone(radius = 1, height = 2, radialSegments = 8) {
    const geometry = new THREE.ConeGeometry(radius, height, radialSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeCylinder(radiusTop = 1, radiusBottom = 1, height = 2, radialSegments = 8) {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeTorus(radius = 1, tube = 0.4, radialSegments = 8, tubularSegments = 12) {
    const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeOctahedron(radius = 1) {
    const geometry = new THREE.OctahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeTetrahedron(radius = 1) {
    const geometry = new THREE.TetrahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeIcosahedron(radius = 1) {
    const geometry = new THREE.IcosahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  static wireframeDodecahedron(radius = 1) {
    const geometry = new THREE.DodecahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
}


// ============================================================================
// MaterialFactory — Builder pattern for THREE.js materials
// ============================================================================

export class MaterialFactory {
  static basic(config = {}) {
    const defaults = {
      color: 0xffffff,
      opacity: 1.0,
      transparent: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    
    const settings = { ...defaults, ...config };
    settings.transparent = settings.transparent || settings.opacity < 1.0;
    
    return new THREE.MeshBasicMaterial(settings);
  }
  
  static texture(element, config = {}) {
    let texture;
    
    if (element instanceof HTMLVideoElement) {
      texture = new THREE.VideoTexture(element);
      if (element.paused) {
        element.play().catch(() => {});
      }
    } else if (element instanceof HTMLImageElement) {
      texture = new THREE.Texture(element);
      texture.needsUpdate = true;
    } else {
      throw new Error('Element must be HTMLVideoElement or HTMLImageElement');
    }
    
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    
    const defaults = {
      map: texture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    
    return new THREE.MeshBasicMaterial({ ...defaults, ...config });
  }
  
  static additive(config = {}) {
    return this.basic({
      ...config,
      blending: THREE.AdditiveBlending,
      transparent: true
    });
  }
  
  static multiply(config = {}) {
    return this.basic({
      ...config,
      blending: THREE.MultiplyBlending,
      transparent: true
    });
  }
  
  static dispose(material) {
    if (!material) return;
    if (material.map) material.map.dispose();
    material.dispose();
  }
}


// ============================================================================
// MaterialBuilder — Fluent builder interface
// ============================================================================

export class MaterialBuilder {
  constructor() {
    this.config = {
      color: 0xffffff,
      opacity: 1.0,
      transparent: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    this._texture = null;
  }
  
  color(value) {
    this.config.color = value;
    return this;
  }
  
  opacity(value) {
    this.config.opacity = value;
    this.config.transparent = value < 1.0;
    return this;
  }
  
  transparent(value = true) {
    this.config.transparent = value;
    return this;
  }
  
  side(value) {
    this.config.side = value;
    return this;
  }
  
  doubleSided() {
    this.config.side = THREE.DoubleSide;
    return this;
  }
  
  frontSided() {
    this.config.side = THREE.FrontSide;
    return this;
  }
  
  backSided() {
    this.config.side = THREE.BackSide;
    return this;
  }
  
  additive() {
    this.config.blending = THREE.AdditiveBlending;
    this.config.transparent = true;
    return this;
  }
  
  multiply() {
    this.config.blending = THREE.MultiplyBlending;
    this.config.transparent = true;
    return this;
  }
  
  subtractive() {
    this.config.blending = THREE.SubtractiveBlending;
    this.config.transparent = true;
    return this;
  }
  
  texture(element) {
    this._texture = element;
    return this;
  }
  
  build() {
    if (this._texture) {
      return MaterialFactory.texture(this._texture, this.config);
    }
    return MaterialFactory.basic(this.config);
  }
}


// ============================================================================
// ColorUtils — Color manipulation helpers
// ============================================================================

export class ColorUtils {
  static interpolate(color1, color2, factor) {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;
    
    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return (r << 16) | (g << 8) | b;
  }
  
  static gradient(colors, steps) {
    if (colors.length < 2) return colors;
    
    const result = [];
    const segmentSteps = Math.floor(steps / (colors.length - 1));
    
    for (let i = 0; i < colors.length - 1; i++) {
      for (let j = 0; j < segmentSteps; j++) {
        const factor = j / segmentSteps;
        result.push(this.interpolate(colors[i], colors[i + 1], factor));
      }
    }
    
    result.push(colors[colors.length - 1]);
    return result;
  }
  
  static rgbToHex(r, g, b) {
    return (r << 16) | (g << 8) | b;
  }
  
  static hexToRgb(hex) {
    return {
      r: (hex >> 16) & 0xff,
      g: (hex >> 8) & 0xff,
      b: hex & 0xff
    };
  }
}


// ============================================================================
// Shared color helpers
// ============================================================================

/**
 * Resolve a color from config, supporting per-ball colors, gradients, arrays.
 */
export function resolveColor(config, ballId, t = 0) {
  // Per-ball colors take priority
  if (config.perBallColors && config.ballColors) {
    const ballColor = config.ballColors[ballId] ?? config.ballColors[String(ballId)];
    if (ballColor !== undefined) {
      // Gradient pair per ball: [colorA, colorB]
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

/**
 * Interpolate two hex colors via THREE.Color. Convenience wrapper.
 */
export function lerpColor(color1, color2, t) {
  const c1 = new THREE.Color(color1);
  const c2 = new THREE.Color(color2);
  return c1.lerp(c2, t).getHex();
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
      if (obj.material?.color) {
        obj.material.color.setHex(color);
      }
      if (obj.material && this.config.opacity !== undefined) {
        obj.material.opacity = this.config.opacity;
        obj.material.transparent = this.config.opacity < 1.0;
      }
    }
  }

  // GeometryBase requires these — subclasses override
  createGeometry(id, params) { return null; }
  updateGeometry(id, params) {}
}


// ============================================================================
// PerBallEffect — Objects that track individual balls
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

    if (this.constructor.usesHistory) {
      this._recordHistory(ballId, worldPos);
    }

    if (this.constructor.usesRotation) {
      this._updateRotation(ballId);
    }

    this._ballIds.add(ballId);

    const count = this.getObjectCount();

    if (count === 1) {
      // Simple mode: one object per ball
      const objId = `${ballId}-${this.constructor.idPrefix || 'obj'}`;
      if (this.has(objId)) {
        const obj = this.get(objId);
        this.animateForBall(obj, ballId, worldPos, dt);
      } else {
        const result = this.createForBall(ballId, worldPos);
        if (result) {
          this.scene.add(result.mesh);
          result.ballId = ballId;
          this.objects.set(objId, result);
        }
      }
    } else {
      // Multi mode: N objects per ball
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

  // --- OVERRIDE POINTS ---

  getObjectCount() { return 1; }
  createForBall(ballId, worldPos) { return null; }

  animateForBall(obj, ballId, worldPos, dt) {
    obj.mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex ?? 0.03);
  }

  animateAllForBall(ballId, worldPos, dt) {}

  // --- HELPERS available to subclasses ---

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

  getRotation(ballId) {
    return this._rotState.get(ballId) || { x: 0, y: 0, z: 0 };
  }

  get time() { return this._time; }

  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  addOrUpdate(id, params) {
    if (this.has(id)) {
      this.update(id, params);
    } else {
      this.add(id, params);
    }
  }

  // --- INTERNAL ---

  _recordHistory(ballId, worldPos) {
    const now = Date.now() / 1000;
    if (!this._posHistory.has(ballId)) {
      this._posHistory.set(ballId, []);
    }
    const history = this._posHistory.get(ballId);
    const rotation = this._rotState.get(ballId);
    history.push({ pos: { ...worldPos }, time: now, rotation: rotation ? { ...rotation } : null });

    const maxDelay = this.config.maxDelay ?? 2.0;
    while (history.length > 0 && history[0].time < now - maxDelay) {
      history.shift();
    }
  }

  _updateRotation(ballId) {
    if (!this._rotState.has(ballId)) {
      this._rotState.set(ballId, { x: 0, y: 0, z: 0 });
    }
    const rot = this._rotState.get(ballId);
    rot.x += this.config.rotateX ?? 0;
    rot.y += this.config.rotateY ?? 0;
    rot.z += this.config.rotateZ ?? 0;
  }
}


// ============================================================================
// SpawnEffect — Timed spawn → animate → die lifecycle
// ============================================================================

export class SpawnEffect extends EffectBase {

  constructor(sceneManager) {
    super(sceneManager);
    this._lastSpawnTime = new Map();
    this._spawnData = new Map();
  }

  updateBall(ballId, worldPos) {
    const now = Date.now() / 1000;
    const dt = 0.016;

    const interval = this.config.spawnInterval ?? this.config.rippleInterval ?? 0.5;
    const lastTime = this._lastSpawnTime.get(ballId) ?? 0;

    if (now - lastTime >= interval) {
      const spawns = this.spawnForBall(ballId, worldPos, now);
      if (spawns && spawns.length > 0) {
        for (const spawn of spawns) {
          this.add(spawn.id, spawn);
          this._spawnData.set(spawn.id, { ballId, birthTime: now, ...spawn });
        }
        this._lastSpawnTime.set(ballId, now);
      }
    }

    const toRemove = [];
    for (const [id, data] of this._spawnData) {
      const obj = this.get(id);
      if (!obj) { toRemove.push(id); continue; }

      const age = now - data.birthTime;
      const alive = this.animateSpawned(obj, age, dt, data);
      if (alive === false) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this.remove(id);
      this._spawnData.delete(id);
    }
  }

  removeBall(ballId) {
    const toRemove = [];
    for (const [id, data] of this._spawnData) {
      if (data.ballId === ballId) toRemove.push(id);
    }
    toRemove.forEach(id => {
      this.remove(id);
      this._spawnData.delete(id);
    });
    this._lastSpawnTime.delete(ballId);
  }

  clear() {
    super.clear();
    this._lastSpawnTime.clear();
    this._spawnData.clear();
  }

  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  // --- OVERRIDE POINTS ---

  spawnForBall(ballId, worldPos, now) { return []; }
  animateSpawned(obj, age, dt, data) { return true; }
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

  /**
   * Override this — your main entry point.
   * @param {object} positions - { ballId: { x, y }, ... } in normalized camera coords
   */
  updateField(positions) {}

  tick(dt = 0.016) {
    this._time += dt;
  }

  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  clear() {
    super.clear();
    this._time = 0;
  }
}