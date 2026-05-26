/**
 * BallSpacetime - Tubes mode
 *
 * Each ball traces a tube through Z (the time axis). New positions push
 * the head of a ring buffer; the tube geometry is rebuilt every
 * `rebuildEvery` frames from the captured worldline.
 *
 * Camera orbits the present (currentZ) on a sphere defined by
 * theta/phi/radius. The camera-feed plane trails behind by feedPlaneOffset.
 *
 * Config values may be numbers or live-expression strings (e.g. "sin(t)").
 * Strings have access to: t (time in seconds), fmx/fmy/fmvx/fmvy (foot
 * mouse — falls back to 0 if not present), and standard Math.* functions.
 *
 * Live-code config example:
 *
 *   ballSpacetime: {
 *     enabled: true,
 *     zStep: 0.01,
 *     maxHistory: 50,
 *     tubeRadius: 0.25,
 *     tubeSegments: 6,
 *     rebuildEvery: 1,
 *     theta:  "sin(t * 0.3)",   // string → live expression
 *     phi:    1.0,              // number → used directly
 *     radius: 20.0,
 *     feedPlaneOffset: 100,
 *     perBallColors: true,
 *     ballColors: { 0: 0xff4444, 1: 0x44ff44, 2: 0xffff44, 3: 0x44aaff },
 *     showGrid: true
 *   }
 */

import { GeometryBase } from './_shared.js';
import { effectRegistry } from '../effect-registry.js';


export class BallSpacetime extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);

    this.config = {
      zStep: 0.03,

      // tube geometry
      maxHistory: 500,
      tubeRadius: 0.05,
      tubeSegments: 6,
      rebuildEvery: 3,

      // camera orbit
      theta: 0.8,
      phi: 1.0,
      radius: 25.0,
      feedPlaneOffset: 10,

      // appearance
      opacity: 0.9,
      perBallColors: true,
      ballColors: {
        0: 0xff4444,
        1: 0x44ff44,
        2: 0xffff44,
        3: 0x44aaff,
      },
      color: 0x00ffff,
      showGrid: true,
      gridColor: 0x333333,
    };

    this.histories = new Map(); // ballId → entry { buf, head, count, framesSinceRebuild, mesh, material }
    this.currentZ  = 0;
    this.active    = false;
    this._camera   = null;
    this._gridMesh = null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  enable(camera, threeScene) {
    if (this.active) return;
    this.active      = true;
    this.currentZ    = 0;
    this._camera     = camera;
    this._threeScene = threeScene ?? null;

    if (this.config.showGrid) this._buildGrid();
    this._updateCameraOrbit();
  }

  disable(camera) {
    if (!this.active) return;

    if (this._threeScene) this._threeScene.setCameraFeedZ(0);

    this.active      = false;
    this._camera     = null;
    this._threeScene = null;

    this._removeGrid();
    this.clear();

    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.far = 1000;
    camera.updateProjectionMatrix();
  }

  // ─── Per-frame ────────────────────────────────────────────────────────────

  updateBall(ballId, worldPos) {
    if (!this.active) return;
    this._updateTube(ballId, worldPos);
  }

  tick() {
    if (!this.active) return;
    this.currentZ += this.config.zStep;
    this._updateCameraOrbit();
    this._updateFeedPlane();
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  setConfig(config) {
    Object.assign(this.config, config);

    // Update existing tube materials to reflect color/opacity changes
    for (const [ballId, entry] of this.histories) {
      entry.material.color.setHex(this._colorFor(ballId));
      entry.material.opacity = this.config.opacity;
    }

    if (config.theta !== undefined || config.phi !== undefined || config.radius !== undefined) {
      this._updateCameraOrbit();
    }

    if (config.showGrid !== undefined) {
      if (config.showGrid) this._buildGrid();
      else                 this._removeGrid();
    }
  }

  // ─── Removal ──────────────────────────────────────────────────────────────

  removeBall(ballId) {
    const entry = this.histories.get(ballId);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.material.dispose();
    this.histories.delete(ballId);
    this.objects.delete(`spacetime-${ballId}`);
  }

  clear() {
    for (const entry of this.histories.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.histories.clear();
    this.objects.clear();
    this.currentZ = 0;
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  _updateCameraOrbit() {
    if (!this._camera) return;

    const theta  = this._resolveParam(this.config.theta,  this.config.theta);
    const phi    = this._resolveParam(this.config.phi,    this.config.phi);
    const radius = this._resolveParam(this.config.radius, this.config.radius);
    const targetZ = this.currentZ;

    const dx = radius * Math.sin(phi) * Math.cos(theta);
    const dy = radius * Math.sin(phi) * Math.sin(theta);
    const dz = radius * Math.cos(phi);

    this._camera.position.set(dx, dy, targetZ + dz);
    this._camera.lookAt(0, 0, targetZ);

    this._camera.far = this.config.maxHistory * this.config.zStep + radius + 100;
    this._camera.updateProjectionMatrix();
  }

  _updateFeedPlane() {
    if (!this._threeScene) return;
    const offset = this._resolveParam(this.config.feedPlaneOffset, 10);
    this._threeScene.setCameraFeedZ(this.currentZ - offset);
  }

  /**
   * Resolve a config value that may be a live expression string.
   * Supports foot mouse aliases (fmx, fmy, fmvx, fmvy), time/t,
   * and standard math functions. Falls back to `fallback` on error or NaN.
   */
   _resolveParam(value, fallback) {
    if (typeof value !== 'string') return value;
    const sm = this.sceneManager;
    if (!sm?.evaluator?.isExpression?.(value)) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    try {
      const ctx = sm.getBallContext ? sm.getBallContext()
                                    : { time: sm.getTime(), t: sm.getTime() };
      const r = sm.evaluator.evaluate(value, ctx);
      return (typeof r === 'number' && Number.isFinite(r)) ? r : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // ─── Tubes ────────────────────────────────────────────────────────────────

  _updateTube(ballId, worldPos) {
    if (!this.histories.has(ballId)) this._initTubeEntry(ballId);

    const entry = this.histories.get(ballId);
    const cap   = this.config.maxHistory;

    const base = entry.head * 3;
    entry.buf[base]     = worldPos.x;
    entry.buf[base + 1] = worldPos.y;
    entry.buf[base + 2] = this.currentZ;

    entry.head = (entry.head + 1) % cap;
    if (entry.count < cap) entry.count++;

    entry.framesSinceRebuild++;
    if (entry.framesSinceRebuild >= this.config.rebuildEvery) {
      entry.framesSinceRebuild = 0;
      this._rebuildTube(ballId, entry);
    }
  }

  _initTubeEntry(ballId) {
    const cap     = this.config.maxHistory;
    const color   = this._colorFor(ballId);
    const useTube = this.config.tubeRadius > 0;

    const material = useTube
      ? new THREE.MeshBasicMaterial({
          color,
          transparent: this.config.opacity < 1,
          opacity: this.config.opacity,
          side: THREE.DoubleSide,
        })
      : new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: this.config.opacity,
        });

    const mesh = useTube
      ? new THREE.Mesh(new THREE.BufferGeometry(), material)
      : new THREE.Line(new THREE.BufferGeometry(), material);

    this.scene.add(mesh);

    const entry = {
      buf:                new Float32Array(cap * 3),
      head:               0,
      count:              0,
      framesSinceRebuild: 0,
      mesh,
      material,
    };

    this.histories.set(ballId, entry);
    this.objects.set(`spacetime-${ballId}`, { mesh, geometry: mesh.geometry, material });
  }

  _rebuildTube(ballId, entry) {
    const { buf, head, count } = entry;
    const cap = this.config.maxHistory;
    const n   = Math.min(count, cap);
    if (n < 2) return;

    const MAX_CURVE_POINTS = 500;
    const step   = n <= MAX_CURVE_POINTS ? 1 : Math.ceil(n / MAX_CURVE_POINTS);
    const points = [];

    for (let i = 0; i < n; i += step) {
      const idx = count < cap ? i : (head + i) % cap;
      points.push(new THREE.Vector3(buf[idx * 3], buf[idx * 3 + 1], buf[idx * 3 + 2]));
    }

    // Always include the latest point
    const lastIdx = count < cap ? n - 1 : (head + n - 1) % cap;
    const last = new THREE.Vector3(buf[lastIdx * 3], buf[lastIdx * 3 + 1], buf[lastIdx * 3 + 2]);
    if (!points[points.length - 1].equals(last)) points.push(last);
    if (points.length < 2) return;

    entry.mesh.geometry.dispose();

    if (this.config.tubeRadius > 0) {
      const curve = new THREE.CatmullRomCurve3(points);
      entry.mesh.geometry = new THREE.TubeGeometry(
        curve,
        points.length - 1,
        this.config.tubeRadius,
        this.config.tubeSegments,
        false
      );
    } else {
      const positions = new Float32Array(points.length * 3);
      for (let i = 0; i < points.length; i++) {
        positions[i * 3]     = points[i].x;
        positions[i * 3 + 1] = points[i].y;
        positions[i * 3 + 2] = points[i].z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      entry.mesh.geometry = geo;
    }
  }

  // ─── Grid ─────────────────────────────────────────────────────────────────

  _buildGrid() {
    if (this._gridMesh) return;
    const helper = new THREE.GridHelper(30, 20, this.config.gridColor, this.config.gridColor);
    helper.rotation.x = Math.PI / 2;
    helper.position.z = 0;
    this.scene.add(helper);
    this._gridMesh = helper;
  }

  _removeGrid() {
    if (!this._gridMesh) return;
    this.scene.remove(this._gridMesh);
    this._gridMesh.geometry?.dispose();
    this._gridMesh.material?.dispose();
    this._gridMesh = null;
  }

  // ─── Color ────────────────────────────────────────────────────────────────

  _colorFor(ballId) {
    if (this.config.perBallColors && this.config.ballColors) {
      const c = this.config.ballColors[ballId] ?? this.config.ballColors[String(ballId)];
      if (c !== undefined) return c;
    }
    return this.config.color;
  }
}


effectRegistry.register('spacetime', BallSpacetime);