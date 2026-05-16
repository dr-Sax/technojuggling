/**
 * Connections - Lines and circles between balls
 *
 * A GlobalEffect that draws geometry *between* tracked balls rather than on
 * them. Every frame it receives all ball positions and connects them by pairs.
 *
 * Three modes:
 *   - mesh        every ball connected to every other ball with a tube
 *   - sequential  balls connected in a ring (sorted order, last → first)
 *   - circles     a circle spanning each ball pair (its diameter)
 *
 * Circles can be hollow rings or filled discs. Filled discs may be tinted per
 * pair (perCircleColors + circleContents) or mapped with a ball's video
 * texture when circleContents holds a stream name and routing is wired up.
 *
 * Geometry uses a recreate-on-move pattern: a connection is only rebuilt when
 * its endpoints actually shift, so a still scene does no per-frame work.
 *
 * Live-code config example:
 *
 *   ballConnections: {
 *     enabled: true,            // on/off for this scene group
 *     mode: "circles",          // "none" | "mesh" | "sequential" | "circles"
 *     color: 0x00ffff,          // line color / circle color when not per-circle
 *     opacity: 0.9,             // 0..1 material opacity
 *     lineWidth: 0.08,          // tube radius (mesh/sequential) or ring thickness
 *     zIndex: 0.05,             // base draw depth; circles fan out behind this
 *     segments: 32,             // circle smoothness (low = polygonal)
 *     filled: true,             // circles only: filled disc vs hollow ring
 *     perCircleColors: true,    // circles only: color each pair from circleContents
 *     circleContents: [0xff0000, 0x00ff00, 0x0000ff]
 *                               // per-pair colors, or stream names for video fill
 *   }
 *
 * Notes:
 *   - An absent `ballConnections` block (or mode "none") turns the effect off.
 *   - circleContents indexes by pair, wrapping if there are more pairs than
 *     entries.
 */

import {
  GlobalEffect,
  GeometryPrimitives,
  MaterialBuilder
} from './_shared.js';

import { effectRegistry } from '../effect-registry.js';


export class Connections extends GlobalEffect {
  static defaults = {
    mode: 'none',
    color: 0xffffff,
    opacity: 1.0,
    lineWidth: 0.1,
    zIndex: 0.05,
    segments: 32,
    filled: false,
    perCircleColors: false,
    circleContents: [0xff0000, 0x00ff00, 0x0000ff]
  };
  // Changing any of these needs geometry rebuilt, not just recolored.
  static recreateKeys = ['lineWidth', 'segments', 'filled'];

  constructor(sceneManager) {
    super(sceneManager);
    this._ballMedia = null;
    this._routing = {};
    this._onVisibilityChange = null;
    this._intendedMode = null;
  }

  /** Wire up the media dependency (used for video-textured circles). */
  setBallMedia(ballMedia) { this._ballMedia = ballMedia; }

  /** Callback fired when filled-circle mode needs ball media hidden/shown. */
  onVisibilityChange(fn) { this._onVisibilityChange = fn; }

  /** Routing map (ballId → stream name) for texture-mapped circles. */
  setRouting(routing) { this._routing = routing; }

  // --- Mode / enable control ----------------------------------------------

  setMode(mode) {
    // Remember the last real mode so a disable→enable cycle (which happens on
    // every hot-reload) can restore it instead of staying stranded at 'none'.
    if (mode && mode !== 'none') this._intendedMode = mode;
    if (mode === this.config.mode) return;
    this.clear();
    this.config.mode = mode;
    this._syncMediaVisibility();
  }

  setEnabled(enabled) {
    if (!enabled) {
      // Full off: forget the intended mode too, or updateConnections' self-heal
      // would resurrect the effect in a group that turned it off.
      this.config.mode = 'none';
      this._intendedMode = null;
      this.clear();
      if (this._onVisibilityChange) this._onVisibilityChange(true);
    } else if (this.config.mode === 'none' && this._intendedMode) {
      // Re-enabled after a disable: restore the last requested mode.
      this.setMode(this._intendedMode);
    }
  }

  /** Ball media is hidden only under filled-circle mode (the disc covers it). */
  _syncMediaVisibility() {
    if (!this._onVisibilityChange) return;
    this._onVisibilityChange(!(this.config.mode === 'circles' && this.config.filled));
  }

  // --- Per-frame update ----------------------------------------------------
  // positions = { ballId: { x, y }, ... } in world coordinates.

  updateConnections(positions) {
    // Self-heal a mode stranded at 'none' across a hot-reload.
    if (this.config.mode === 'none' && this._intendedMode && this._intendedMode !== 'none') {
      this.setMode(this._intendedMode);
    }
    if (this.config.mode === 'none') return;

    const ids = Object.keys(positions);
    // Need at least one pair. During a reload gap fewer balls may report in;
    // leave existing geometry alone and wait rather than tearing it down.
    if (ids.length < 2) return;

    const pairs = this._pairsFor(ids);
    const validIds = new Set();

    pairs.forEach(([idA, idB], index) => {
      const isCircle = this.config.mode === 'circles';
      const connId = `${isCircle ? 'circle' : 'line'}-${idA}-${idB}`;
      const p1 = positions[idA];
      const p2 = positions[idB];

      // Recreate only when an endpoint actually moved (or doesn't exist yet).
      if (!this.has(connId) || this._moved(this.get(connId), p1, p2)) {
        this.add(connId, {
          p1, p2,
          type: isCircle ? 'circle' : 'line',
          content: this._contentFor(index),
          index
        });
      }
      validIds.add(connId);
    });

    if (this.config.mode === 'circles') this._layerCircles();

    // Drop connections for pairs that no longer exist.
    for (const id of this.objects.keys()) {
      if (!validIds.has(id)) this.remove(id);
    }
  }

  /** Pair list for the active mode. */
  _pairsFor(ids) {
    if (this.config.mode === 'sequential') {
      const sorted = [...ids].sort();
      return sorted.map((id, i) => [id, sorted[(i + 1) % sorted.length]]);
    }
    // mesh and circles both connect every unique pair.
    const pairs = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        pairs.push([ids[i], ids[j]]);
    return pairs;
  }

  /** Color/texture key for the pair at this index. */
  _contentFor(index) {
    if (this.config.mode === 'circles' && this.config.perCircleColors) {
      const list = this.config.circleContents;
      return list[index % list.length];
    }
    return this.config.color;
  }

  /** True if either endpoint has shifted enough to warrant a rebuild. */
  _moved(obj, p1, p2) {
    return Math.abs(p1.x - obj._p1.x) > 0.01 || Math.abs(p1.y - obj._p1.y) > 0.01 ||
           Math.abs(p2.x - obj._p2.x) > 0.01 || Math.abs(p2.y - obj._p2.y) > 0.01;
  }

  /** Stack circles biggest-behind-smallest so small ones stay visible. */
  _layerCircles() {
    Array.from(this.objects.values())
      .filter(o => o._radius !== undefined)
      .sort((a, b) => (b._radius || 0) - (a._radius || 0))
      .forEach((obj, i) => { obj.mesh.position.z = this.config.zIndex - i * 0.01; });
  }

  // --- Geometry creation ---------------------------------------------------

  createGeometry(id, { p1, p2, type, content, index }) {
    return type === 'circle'
      ? this._createCircle(p1, p2, content, index)
      : this._createLine(p1, p2);
  }

  _createLine(p1, p2) {
    const geometry = GeometryPrimitives.tube(
      new THREE.Vector3(p1.x, p1.y, 0),
      new THREE.Vector3(p2.x, p2.y, 0),
      this.config.lineWidth, 8
    );
    const material = new MaterialBuilder()
      .color(this.config.color)
      .opacity(this.config.opacity)
      .build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = this.config.zIndex;
    // `content` is stored so _updateMaterials can recolor without resolveColor.
    return { mesh, geometry, material, content: this.config.color, _p1: { ...p1 }, _p2: { ...p2 } };
  }

  _createCircle(p1, p2, content, index) {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const radius = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;

    const filled = this.config.filled;
    const geometry = filled
      ? GeometryPrimitives.circle(radius, this.config.segments, this.config.lineWidth)
      : GeometryPrimitives.ring(Math.max(0.01, radius - this.config.lineWidth), radius, this.config.segments);

    // Filled discs may carry a video texture; rings are always a flat color.
    const fillGeom = filled ? geometry.fill : geometry;
    const material = filled
      ? this._circleMaterial(content)
      : new MaterialBuilder()
          .color(typeof content === 'number' ? content : this.config.color)
          .opacity(this.config.opacity).doubleSided().additive().build();

    const mesh = new THREE.Mesh(fillGeom, material);
    mesh.position.set(cx, cy, 0);

    const obj = {
      mesh, geometry: fillGeom, material,
      content, index, _radius: radius, _p1: { ...p1 }, _p2: { ...p2 }
    };

    // Optional white perimeter ring around a filled disc.
    if (filled && geometry.perimeter) {
      const pMat = new MaterialBuilder().color(0xffffff).doubleSided().build();
      const perimeterMesh = new THREE.Mesh(geometry.perimeter, pMat);
      perimeterMesh.position.set(cx, cy, 0.001);
      this.scene.add(perimeterMesh);
      obj.perimeterMesh = perimeterMesh;
      obj.perimeterGeometry = geometry.perimeter;
      obj.perimeterMaterial = pMat;
    }

    return obj;
  }

  /** Material for a filled circle: video texture if routed, else flat color. */
  _circleMaterial(content) {
    if (typeof content === 'string' && this._ballMedia) {
      for (const [ballId, stream] of Object.entries(this._routing)) {
        if (stream !== content) continue;
        const el = this._ballMedia.getElement(ballId.replace('ball_', ''));
        if (!el) continue;
        try {
          const texture = new THREE.Texture(el);
          texture.minFilter = THREE.LinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.needsUpdate = true;
          return new THREE.MeshBasicMaterial({
            map: texture, transparent: true, opacity: this.config.opacity,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending
          });
        } catch (e) { /* fall through to flat color */ }
      }
    }
    const color = typeof content === 'number' ? content : this.config.color;
    return new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().additive().build();
  }

  updateGeometry() {} // Unused — geometry is recreated on move, never mutated.

  /**
   * Recolor/re-opacity existing objects for a params-only config change.
   *
   * Overrides EffectBase._updateMaterials(), which resolves color via
   * resolveColor(config, obj.ballId, ...). Connection objects have no
   * `ballId`, so the base version would collapse every line and circle to the
   * default `config.color` and wipe out perCircleColors. Here each object is
   * recolored from its own stored `content` instead. Texture-mapped circles
   * keep their texture; transparency is never forced off (additive and
   * textured materials require it).
   */
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const mat = obj.material;
      if (!mat) continue;

      if (mat.color && !mat.map) {
        mat.color.setHex(typeof obj.content === 'number' ? obj.content : this.config.color);
      }
      if (this.config.opacity !== undefined) {
        mat.opacity = this.config.opacity;
        if (this.config.opacity < 1.0 || mat.map || mat.blending === THREE.AdditiveBlending) {
          mat.transparent = true;
        }
      }
    }
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.material?.map?.dispose();
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    this.objects.delete(id);
  }

  // --- Config plumbing -----------------------------------------------------

  setConfig(config) {
    // A `mode` key must route through setMode() for intended-mode tracking and
    // the visibility side-effect; the base class handles every other key.
    if (config && config.mode !== undefined) {
      const { mode, ...rest } = config;
      this.setMode(mode);
      super.setConfig(rest);
    } else {
      super.setConfig(config);
    }
  }

  _onConfigChange(changed, prev) {
    if (changed.filled !== undefined && this._onVisibilityChange) {
      this._onVisibilityChange(!changed.filled);
    }
    // updateBallConnections() re-feeds the whole config every frame; skip all
    // work when nothing actually changed so a steady scene stays untouched.
    if (!Object.keys(changed).some(k => changed[k] !== prev[k])) return;
    super._onConfigChange(changed, prev);
  }
}


// Registration
effectRegistry.register('connections', Connections, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});