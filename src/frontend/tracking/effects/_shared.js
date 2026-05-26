/**
 * Effect framework — the entire API surface for writing a new effect.
 *
 * To add an effect:
 *   1. Create effects/youreffect.js, export a class extending Effect
 *   2. Add it to effects/index.js
 *   3. Reference it as `youreffect: { enabled: true, ... }` in your scene config
 *
 * Read the Effect class below, then look at trails.js for a simple example
 * or spacetime.js for a complex one.
 */

// ─── The one base class ──────────────────────────────────────────────────────

export class Effect {
  constructor(sceneManager) {
    this.threeScene = sceneManager;
    this.sceneManager = sceneManager.sceneManagerRef ?? sceneManager;
    this.scene = sceneManager.getWebGLScene();
    this.config = { ...this.constructor.defaults };
    this.enabled = false;
  }

  /**
   * Called every frame the effect is enabled.
   *   positions: Map<ballId, {x, y}>     ball world positions
   *   ctx.time:   seconds since scene start
   *   ctx.dt:     seconds since last frame
   *   ctx.expr(s): evaluate a live expression string against the current ball scope
   */
  update(positions, ctx) {}

  /**
   * Called on initial load and whenever this effect's config block changes.
   * Default: shallow-merge into this.config. Override to rebuild on key changes.
   */
  configure(config) {
    Object.assign(this.config, config);
  }

  /** Tear down all THREE objects. Called on disable, scene switch, shutdown. */
  dispose() {}

  /** Called when a specific ball is removed (optional). */
  removeBall(ballId) {}
}

// ─── Helper functions ────────────────────────────────────────────────────────

export function makeMaterial({ color = 0xffffff, opacity = 1, additive = false } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    opacity,
    transparent: opacity < 1 || additive,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export function makeDisc(radius, sides = 32) {
  return new THREE.CircleGeometry(radius, sides);
}

export function makeRing(innerRadius, outerRadius, sides = 32) {
  return new THREE.RingGeometry(innerRadius, outerRadius, sides);
}

export function makeTube(p1, p2, radius = 0.1, segments = 8) {
  const v1 = p1.isVector3 ? p1 : new THREE.Vector3(p1.x, p1.y, p1.z ?? 0);
  const v2 = p2.isVector3 ? p2 : new THREE.Vector3(p2.x, p2.y, p2.z ?? 0);
  return new THREE.TubeGeometry(new THREE.LineCurve3(v1, v2), 1, radius, segments, false);
}

export function lerpColor(colorA, colorB, t) {
  const ra = (colorA >> 16) & 0xff, ga = (colorA >> 8) & 0xff, ba = colorA & 0xff;
  const rb = (colorB >> 16) & 0xff, gb = (colorB >> 8) & 0xff, bb = colorB & 0xff;
  const r = Math.round(ra + (rb - ra) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const b = Math.round(ba + (bb - ba) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Pick a color for a ball, honoring config.ballColors and config.gradient.
 *   config.ballColors: { 0: 0xff0000, 1: 0x00ff00 }   per-ball
 *   config.color:      0x00ffff                       single
 *   config.color:      [a, b], gradient: true         gradient (t=0..1)
 */
export function colorFor(config, ballId, t = 0) {
  if (config.ballColors && config.ballColors[ballId] !== undefined) {
    const c = config.ballColors[ballId];
    return Array.isArray(c) ? lerpColor(c[0], c[1], t) : c;
  }
  if (config.gradient && Array.isArray(config.color)) {
    return lerpColor(config.color[0], config.color[1], t);
  }
  return Array.isArray(config.color) ? config.color[0] : (config.color ?? 0xffffff);
}

export function disposeMesh(scene, mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry?.dispose();
  mesh.material?.map?.dispose();
  mesh.material?.dispose();
}