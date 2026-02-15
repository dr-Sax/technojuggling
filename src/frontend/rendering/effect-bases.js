/**
 * Effect Base Classes - The Tell-A-Vision Effect Framework
 * 
 * Three base classes that handle all the boilerplate so new effects
 * can focus purely on what makes them unique.
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │  EffectBase (abstract)                                      │
 * │  - config management, color helpers, setConfig/clear/etc    │
 * │                                                             │
 * │  ├── PerBallEffect                                          │
 * │  │   One or more Three.js objects track each ball           │
 * │  │   → shapes, trails, vortex, field, 3d-trails, etc       │
 * │  │                                                          │
 * │  ├── SpawnEffect                                            │
 * │  │   Objects spawn on a timer, animate, then die            │
 * │  │   → ripples, particles, bursts                           │
 * │  │                                                          │
 * │  └── GlobalEffect                                           │
 * │      Receives ALL ball positions at once                    │
 * │      → spiderweb, vector field, interference patterns       │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * CREATING A NEW EFFECT:
 * 
 *   1. Pick the right base class
 *   2. Define static defaults = { ... }  (your config)
 *   3. Override 1-2 methods (the creative part)
 *   4. Register in ball-tracking.js
 *   5. Done — typically 20-50 lines
 * 
 * See effects/ folder for examples.
 */

import { GeometryBase } from './geometry-base.js';
import { GeometryPrimitives } from './geometry-primitives.js';
import { MaterialBuilder, ColorUtils } from './material-factory.js';

// Re-export utilities so effects can import from one place
export { GeometryPrimitives, MaterialBuilder, ColorUtils };


// ============================================================================
// SHARED COLOR HELPERS (eliminates the _getColorForBall duplication)
// ============================================================================

/**
 * Resolve a color from config, supporting per-ball colors, gradients, arrays.
 * 
 * @param {object} config - The effect's config object
 * @param {string|number} ballId - Ball identifier
 * @param {number} [t=0] - Interpolation factor (0-1) for gradients
 * @returns {number} Hex color
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
 * Interpolate two hex colors. Convenience wrapper.
 */
export function lerpColor(color1, color2, t) {
  const c1 = new THREE.Color(color1);
  const c2 = new THREE.Color(color2);
  return c1.lerp(c2, t).getHex();
}


// ============================================================================
// EffectBase - Abstract foundation for all effects
// ============================================================================

export class EffectBase extends GeometryBase {
  /**
   * Subclasses define their default config as a static property:
   * 
   *   static defaults = { color: 0x00ffff, opacity: 0.6, ... };
   * 
   * Config is auto-merged in the constructor.
   */
  constructor(sceneManager) {
    super(sceneManager);
    // Merge class-level defaults into a mutable config
    this.config = { ...this.constructor.defaults };
  }

  /**
   * Apply partial config. Calls _onConfigChange so subclasses can
   * decide whether to recreate or just update materials.
   */
  setConfig(config) {
    const prev = { ...this.config };
    Object.assign(this.config, config);
    this._onConfigChange(config, prev);
  }

  /**
   * Override to control what happens when config changes.
   * Default: check if any key in `recreateKeys` changed → clear & rebuild,
   * otherwise just update materials.
   */
  _onConfigChange(changed, prev) {
    const keys = this.constructor.recreateKeys || [];
    const needsRecreate = keys.some(k => changed[k] !== undefined && changed[k] !== prev[k]);

    if (needsRecreate) {
      this.clear();
      // Objects will be recreated on next updateBall / updateField call
    } else {
      this._updateMaterials();
    }
  }

  /**
   * Default material updater — sets color + opacity on all objects.
   * Override for more complex material updates.
   */
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
// PerBallEffect - Objects that track individual balls
// ============================================================================

/**
 * Base class for effects that create/manage Three.js objects per ball.
 * 
 * Handles:
 *   - Automatic create-on-first-see, update-on-subsequent
 *   - Position history for trail-style effects
 *   - Rotation state management
 *   - removeBall / clear lifecycle
 * 
 * Override ONE of these patterns:
 * 
 *   A) Simple (one object per ball):
 *      createForBall(ballId, worldPos) → { mesh, geometry, material, ... }
 *      animateForBall(obj, ballId, worldPos, dt)
 * 
 *   B) Multi-object (N objects per ball, like trails or vortex):
 *      getObjectCount()  → number
 *      createObjectForBall(ballId, index, worldPos) → { mesh, geometry, material, ... }
 *      animateAllForBall(ballId, worldPos, dt)
 */
export class PerBallEffect extends EffectBase {

  constructor(sceneManager) {
    super(sceneManager);
    this._ballIds = new Set();      // Track which balls we know about
    this._posHistory = new Map();   // ballId → [{pos, time, rotation?}]
    this._rotState = new Map();     // ballId → {x, y, z}
    this._time = 0;
  }

  // --- PUBLIC API (called by EffectRegistry / BallTrackingManager) ---

  updateBall(ballId, worldPos) {
    const dt = 0.016; // ~60fps assumed
    this._time += dt;

    // Record history if subclass uses trails
    if (this.constructor.usesHistory) {
      this._recordHistory(ballId, worldPos);
    }

    // Record rotation state if subclass uses rotation
    if (this.constructor.usesRotation) {
      this._updateRotation(ballId);
    }

    this._ballIds.add(ballId);

    const count = this.getObjectCount();

    if (count === 1) {
      // ---- Simple mode: one object per ball ----
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
      // ---- Multi mode: N objects per ball ----
      this.animateAllForBall(ballId, worldPos, dt);
    }
  }

  removeBall(ballId) {
    this._ballIds.delete(ballId);
    this._posHistory.delete(ballId);
    this._rotState.delete(ballId);

    // Remove all objects for this ball
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

  // --- OVERRIDE POINTS (the creative part) ---

  /** How many objects per ball? Default 1. Override for trails, vortex, etc. */
  getObjectCount() { return 1; }

  /** 
   * Create the Three.js object(s) for a ball. Return { mesh, geometry, material, ...extra }.
   * Only called for simple (count=1) effects.
   */
  createForBall(ballId, worldPos) { return null; }

  /** 
   * Animate an existing object. Called every frame for simple effects.
   * `obj` is whatever you returned from createForBall.
   */
  animateForBall(obj, ballId, worldPos, dt) {
    // Default: just follow the ball
    obj.mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex ?? 0.03);
  }

  /**
   * For multi-object effects: manage all N objects for this ball.
   * Use this.addOrUpdate(id, params) and this.getHistory(ballId) as helpers.
   */
  animateAllForBall(ballId, worldPos, dt) {}

  // --- HELPERS available to subclasses ---

  /** Get position history for trail effects */
  getHistory(ballId) {
    return this._posHistory.get(ballId) || [];
  }

  /** Get interpolated position at a past time */
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

  /** Get rotation state for a ball */
  getRotation(ballId) {
    return this._rotState.get(ballId) || { x: 0, y: 0, z: 0 };
  }

  /** Current effect time (seconds) */
  get time() { return this._time; }

  /** Resolve color from config with per-ball support */
  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  /**
   * Add-or-update helper for multi-object effects.
   * If the object exists, calls updateGeometry. Otherwise calls createGeometry + adds to scene.
   */
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

    // Trim old entries
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
// SpawnEffect - Timed spawn → animate → die lifecycle
// ============================================================================

/**
 * Base class for effects that periodically spawn objects which then
 * animate and eventually expire (ripples, particles, bursts).
 * 
 * Override:
 *   spawnForBall(ballId, worldPos, now) → [ { id, ...createParams }, ... ]
 *   animateSpawned(obj, age, dt)  (return false to kill the object)
 */
export class SpawnEffect extends EffectBase {

  constructor(sceneManager) {
    super(sceneManager);
    this._lastSpawnTime = new Map();  // ballId → timestamp
    this._spawnData = new Map();      // objectId → { ballId, birthTime, ... }
  }

  updateBall(ballId, worldPos) {
    const now = Date.now() / 1000;
    const dt = 0.016;

    // Check spawn interval
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

    // Animate all existing spawned objects
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

    // Clean up dead objects
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

  /** Resolve color from config */
  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  // --- OVERRIDE POINTS ---

  /**
   * Called when it's time to spawn. Return array of { id, ...createGeometryParams }.
   * Each item gets passed to createGeometry(id, params).
   */
  spawnForBall(ballId, worldPos, now) { return []; }

  /**
   * Called every frame for each spawned object.
   * Return false to kill the object.
   * `data` is the spawn data you returned from spawnForBall.
   */
  animateSpawned(obj, age, dt, data) { return true; }
}


// ============================================================================
// GlobalEffect - Operates on all ball positions at once
// ============================================================================

/**
 * Base class for effects that need ALL ball positions simultaneously
 * (spiderweb connections, vector fields, interference patterns).
 * 
 * Override:
 *   updateField(positions)  — positions is { ballId: {x, y}, ... }
 */
export class GlobalEffect extends EffectBase {

  constructor(sceneManager) {
    super(sceneManager);
    this._time = 0;
  }

  /** Current effect time */
  get time() { return this._time; }

  /**
   * Called with all ball positions each frame.
   * Override this — it's your main entry point.
   * @param {object} positions - { ballId: { x, y }, ... } in normalized camera coords
   */
  updateField(positions) {}

  /**
   * Advance internal time. Called externally if needed.
   */
  tick(dt = 0.016) {
    this._time += dt;
  }

  /** Resolve color from config */
  colorFor(ballId, t = 0) {
    return resolveColor(this.config, ballId, t);
  }

  clear() {
    super.clear();
    this._time = 0;
  }
}