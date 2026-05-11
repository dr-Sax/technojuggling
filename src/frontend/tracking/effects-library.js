/**
 * ═══════════════════════════════════════════════════════════════
 *  Tell-A-Vision Effects Library
 * ═══════════════════════════════════════════════════════════════
 *
 *  Only the effects in active use:
 *    - Trails     (ballTrails config)
 *    - Connections (ballConnections config — mesh, sequential, circles modes)
 *
 *  Other ball effects live in their own files:
 *    - BallSpacetime  — ball-spacetime.js
 *    - BallSincWaves  — ball-sinc-waves.js
 *
 *  Registration happens at the bottom of this file (trails, connections).
 *  Spacetime and sincwaves register from ball-tracking.js.
 * ═══════════════════════════════════════════════════════════════
 */

import {
  PerBallEffect,
  GlobalEffect,
  GeometryPrimitives,
  MaterialBuilder
} from '../rendering/effect-bases.js';

import { effectRegistry } from './effect-registry.js';
import { BallSpacetime } from './ball-spacetime.js';


// ════════════════════════════════════════════════════════════════
//  TRAILS — Delayed polygon copies trailing behind each ball
// ════════════════════════════════════════════════════════════════

export class Trails extends PerBallEffect {
  static defaults = {
    count: 5,
    maxDelay: 0.5,
    radiusRange: [0.5, 2.0],
    sides: 6,
    color: 0x00ffff,
    opacity: 0.6,
    zIndex: 0.02,
    perimeterWidth: 0.1,
    perBallColors: false,
    ballColors: {},
    gradient: false
  };
  static usesHistory = true;
  static recreateKeys = ['count', 'sides', 'radiusRange', 'perimeterWidth'];
  static idPrefix = 'trail';

  getObjectCount() { return this.config.count; }

  animateAllForBall(ballId, worldPos, dt) {
    const now = Date.now() / 1000;
    for (let i = 1; i < this.config.count; i++) {
      const delay = (i / (this.config.count - 1)) * this.config.maxDelay;
      const pos = this.getPositionAtTime(ballId, now - delay);
      const id = `${ballId}-trail-${i}`;

      if (this.has(id)) {
        const obj = this.get(id);
        obj.mesh.position.set(pos.x, pos.y, obj.mesh.position.z);
        if (obj.perimeterMesh) obj.perimeterMesh.position.set(pos.x, pos.y, obj.perimeterMesh.position.z);
      } else {
        this.add(id, { ballId, index: i, position: pos });
      }
    }
  }

  createGeometry(id, { ballId, index, position }) {
    const t = index / (this.config.count - 1);
    const radius = this.config.radiusRange[0] + (this.config.radiusRange[1] - this.config.radiusRange[0]) * t;
    const color = this.colorFor(ballId, t);

    const geoms = GeometryPrimitives.polygon(radius, this.config.sides, this.config.perimeterWidth);
    const material = new MaterialBuilder().color(color).opacity(this.config.opacity * (1 - t * 0.5)).doubleSided().build();
    const mesh = new THREE.Mesh(geoms.fill, material);
    mesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001);

    let perimeterMesh = null;
    if (geoms.perimeter) {
      const pMat = new MaterialBuilder().color(0xffffff).doubleSided().build();
      perimeterMesh = new THREE.Mesh(geoms.perimeter, pMat);
      perimeterMesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001 + 0.0001);
      this.scene.add(perimeterMesh);
    }

    return { mesh, geometry: geoms.fill, material, perimeterMesh, perimeterGeometry: geoms.perimeter, perimeterMaterial: perimeterMesh?.material, ballId, index, _colorT: t };
  }

  updateGeometry() {} // Handled in animateAllForBall

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    this.objects.delete(id);
  }
}


// ════════════════════════════════════════════════════════════════
//  CONNECTIONS — Lines and circles between balls (unified)
// ════════════════════════════════════════════════════════════════
// Wraps the former ConnectionLines + ConnectionCircles into a single
// GlobalEffect so the connection system participates in the registry
// like everything else. Supports 3 modes: mesh, sequential, circles.

export class Connections extends GlobalEffect {
  static defaults = {
    mode: 'none',         // 'none', 'mesh', 'sequential', 'circles'
    color: 0xffffff,
    opacity: 1.0,
    lineWidth: 0.1,
    zIndex: 0.05,
    segments: 32,         // For circle mode
    filled: false,        // For circle mode: filled disc vs ring
    perCircleColors: false,
    circleContents: [0xff0000, 0x00ff00, 0x0000ff]
  };
  static recreateKeys = ['lineWidth', 'segments', 'filled'];

  constructor(sceneManager, audioProcessor, visualFX) {
    super(sceneManager);
    this._ballMedia = null;   // Set externally via setBallMedia()
    this._routing = {};
    this._onVisibilityChange = null; // callback: (visible) => {}
  }

  /** Called by BallTrackingManager to wire up the media dependency */
  setBallMedia(ballMedia) { this._ballMedia = ballMedia; }

  /** Callback for when circle fill mode needs to toggle ball media visibility */
  onVisibilityChange(fn) { this._onVisibilityChange = fn; }

  /** Set routing for texture-mapped circles */
  setRouting(routing) { this._routing = routing; }

  // --- Mode control ---

  setMode(mode) {
    if (mode === this.config.mode) return;
    this.clear();
    this.config.mode = mode;
    // When switching to filled circles, hide ball media
    if (this._onVisibilityChange) {
      this._onVisibilityChange(!(mode === 'circles' && this.config.filled));
    }
  }

  setEnabled(enabled) {
    if (!enabled) {
      this.config.mode = 'none';
      this.clear();
      if (this._onVisibilityChange) this._onVisibilityChange(true);
    }
  }

  // --- Main update: receives all ball positions each frame ---

  updateConnections(positions) {
    const mode = this.config.mode;
    if (mode === 'none') return;

    const ids = Object.keys(positions);
    if (ids.length < 2) { this.clear(); return; }

    if (mode === 'mesh') {
      this._updateLines(positions, ids, 'mesh');
    } else if (mode === 'sequential') {
      this._updateLines(positions, ids, 'sequential');
    } else if (mode === 'circles') {
      this._updateCircles(positions, ids);
    }
  }

  // --- Line modes (mesh / sequential) ---

  _updateLines(positions, ids, style) {
    const pairs = style === 'sequential' ? this._sequentialPairs(ids) : this._meshPairs(ids);
    const validIds = new Set();

    for (const [idA, idB] of pairs) {
      const connId = `line-${idA}-${idB}`;
      const p1 = this.sceneManager.mapCameraToWorld(positions[idA].x, positions[idA].y);
      const p2 = this.sceneManager.mapCameraToWorld(positions[idB].x, positions[idB].y);

      if (this.has(connId)) {
        const obj = this.get(connId);
        const moved = Math.abs(p1.x - obj._p1.x) > 0.01 || Math.abs(p1.y - obj._p1.y) > 0.01 ||
                      Math.abs(p2.x - obj._p2.x) > 0.01 || Math.abs(p2.y - obj._p2.y) > 0.01;
        if (moved) this.add(connId, { p1, p2, type: 'line' });
      } else {
        this.add(connId, { p1, p2, type: 'line' });
      }
      validIds.add(connId);
    }
    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  _meshPairs(ids) {
    const pairs = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        pairs.push([ids[i], ids[j]]);
    return pairs;
  }

  _sequentialPairs(ids) {
    const sorted = [...ids].sort();
    return sorted.map((id, i) => [id, sorted[(i + 1) % sorted.length]]);
  }

  // --- Circle mode ---

  _updateCircles(positions, ids) {
    const validIds = new Set();
    let index = 0;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `circle-${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        const content = this.config.perCircleColors
          ? this.config.circleContents[index % this.config.circleContents.length]
          : this.config.color;

        if (this.has(connId)) {
          const obj = this.get(connId);
          const moved = Math.abs(p1.x - obj._p1.x) > 0.01 || Math.abs(p1.y - obj._p1.y) > 0.01 ||
                        Math.abs(p2.x - obj._p2.x) > 0.01 || Math.abs(p2.y - obj._p2.y) > 0.01;
          if (moved) this.add(connId, { p1, p2, type: 'circle', content, index });
        } else {
          this.add(connId, { p1, p2, type: 'circle', content, index });
        }
        validIds.add(connId);
        index++;
      }
    }

    // Layer by radius (biggest behind smallest)
    const sorted = Array.from(this.objects.entries())
      .filter(([id]) => id.startsWith('circle-'))
      .sort(([, a], [, b]) => (b._radius || 0) - (a._radius || 0));
    sorted.forEach(([, obj], i) => { obj.mesh.position.z = this.config.zIndex - i * 0.01; });

    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  // --- Geometry creation ---

  createGeometry(id, { p1, p2, type, content, index }) {
    if (type === 'line') return this._createLine(p1, p2);
    if (type === 'circle') return this._createCircle(p1, p2, content, index);
    return null;
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
    return { mesh, geometry, material, _p1: { ...p1 }, _p2: { ...p2 } };
  }

  _createCircle(p1, p2, content, index) {
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
    const radius = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) / 2;

    if (this.config.filled) {
      return this._createFilledCircle(cx, cy, radius, content, p1, p2, index);
    }
    return this._createRingCircle(cx, cy, radius, content, p1, p2, index);
  }

  _createFilledCircle(cx, cy, radius, content, p1, p2, index) {
    const material = this._circleContentMaterial(content);
    const geoms = GeometryPrimitives.circle(radius, this.config.segments, this.config.lineWidth);
    const mesh = new THREE.Mesh(geoms.fill, material);
    mesh.position.set(cx, cy, 0);

    let perimeterMesh = null;
    if (geoms.perimeter) {
      const pMat = new MaterialBuilder().color(0xffffff).doubleSided().build();
      perimeterMesh = new THREE.Mesh(geoms.perimeter, pMat);
      perimeterMesh.position.set(cx, cy, 0.001);
      this.scene.add(perimeterMesh);
    }

    return {
      mesh, geometry: geoms.fill, material,
      perimeterMesh, perimeterGeometry: geoms.perimeter, perimeterMaterial: perimeterMesh?.material,
      _p1: { ...p1 }, _p2: { ...p2 }, _radius: radius, content, index
    };
  }

  _createRingCircle(cx, cy, radius, content, p1, p2, index) {
    const innerRad = Math.max(0.01, radius - this.config.lineWidth);
    const geometry = GeometryPrimitives.ring(innerRad, radius, this.config.segments);
    const color = typeof content === 'number' ? content : this.config.color;
    const material = new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().additive().build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, 0);
    return { mesh, geometry, material, _p1: { ...p1 }, _p2: { ...p2 }, _radius: radius, content, index };
  }

  _circleContentMaterial(content) {
    // Try to use video texture from ball media routing
    if (typeof content === 'string' && this._ballMedia) {
      for (const [ballId, stream] of Object.entries(this._routing)) {
        if (stream === content) {
          const el = this._ballMedia.getElement(ballId.replace('ball_', ''));
          if (el) {
            try {
              const texture = new THREE.Texture(el);
              texture.minFilter = THREE.LinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.needsUpdate = true;
              return new THREE.MeshBasicMaterial({
                map: texture, transparent: true, opacity: this.config.opacity,
                side: THREE.DoubleSide, blending: THREE.AdditiveBlending
              });
            } catch (e) { /* fall through to color */ }
          }
        }
      }
    }
    const color = typeof content === 'number' ? content : this.config.color;
    return new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().additive().build();
  }

  updateGeometry() {} // Handled by recreate-on-move pattern

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

  _onConfigChange(changed, prev) {
    // Handle filled toggle visibility side-effect
    if (changed.filled !== undefined && this._onVisibilityChange) {
      this._onVisibilityChange(!changed.filled);
    }
    super._onConfigChange(changed, prev);
  }
}


// ════════════════════════════════════════════════════════════════
//  Registration
// ════════════════════════════════════════════════════════════════

effectRegistry.register('trails', Trails, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});

effectRegistry.register('connections', Connections, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});

effectRegistry.register('spacetime', BallSpacetime, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});