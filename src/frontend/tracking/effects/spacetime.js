/**
 * BallSpacetime - Spacetime diagram mode
 *
 * Two modes controlled by config.mode:
 *
 *  'tubes'   — each ball traces a helical tube through Z (time axis)
 *  'circles' — each frame, one circle per ball-pair is drawn at the
 *              current Z slice. Circle lies flat in the XY plane,
 *              diameter = distance between the two balls,
 *              center = midpoint of the two balls.
 *              Old slices accumulate behind as Z advances.
 *  'ribbons' — a ruled surface (quad strip) connecting each pair of
 *              ball worldlines. Each frame appends two vertices and two
 *              triangles, building a continuous ribbon that twists and
 *              stretches with the juggling pattern. Where balls cross,
 *              the ribbon pinches to a line and flips.
 *
 * Live-code config example:
 *
 *   ballSpacetime: {
 *     enabled: true,
 *     mode: 'circles',    // 'tubes' | 'circles'
 *     zStep: 0.03,
 *
 *     // --- tubes params ---
 *     maxHistory: 500,
 *     tubeRadius: 0.05,   // @param float 0.01 0.5  0.01
 *     tubeSegments: 6,    // @param int   3   16   1
 *     rebuildEvery: 3,
 *
 *     // --- circles params ---
 *     circleSegments: 32, // @param int 8 64 4
 *     circleOpacity: 0.6, // @param float 0.1 1.0 0.05
 *     maxCircleSlices: 2000, // how many Z slices to keep
 *
 *     // --- camera (shared) ---
 *     theta: 0.8,         // @param float 0.0 6.28 0.05
 *     phi:   1.0,         // @param float 0.1  2.5  0.05
 *     radius: 25.0,       // @param float 5.0  80.0 1.0
 *
 *     opacity: 0.9,
 *     perBallColors: true,
 *     ballColors: { 0: 0xff4444, 1: 0x44ff44, 2: 0xffff44, 3: 0x44aaff },
 *     showGrid: true
 *   }
 */

import { GeometryBase, MaterialFactory } from './_shared.js';
import { effectRegistry } from '../effect-registry.js';

// All unique pairs from n balls
function pairs(ids) {
  const result = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      result.push([ids[i], ids[j]]);
  return result;
}

// Build a flat filled circle (triangle fan) at given center/z
function circleFillGeometry(cx, cy, z, radius, segments) {
  // Triangle fan: center vertex + segments+1 perimeter vertices
  const positions = new Float32Array((segments + 2) * 3);
  // Center
  positions[0] = cx;
  positions[1] = cy;
  positions[2] = z;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions[(i + 1) * 3]     = cx + Math.cos(angle) * radius;
    positions[(i + 1) * 3 + 1] = cy + Math.sin(angle) * radius;
    positions[(i + 1) * 3 + 2] = z;
  }
  // Build index array for triangle fan
  const indices = new Uint16Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    indices[i * 3]     = 0;
    indices[i * 3 + 1] = i + 1;
    indices[i * 3 + 2] = i + 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

// Build a flat circle outline (LineLoop) at given center/z
function circleRingGeometry(cx, cy, z, radius, segments) {
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions[i * 3]     = cx + Math.cos(angle) * radius;
    positions[i * 3 + 1] = cy + Math.sin(angle) * radius;
    positions[i * 3 + 2] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

export class BallSpacetime extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);

    this.config = {
      mode: 'tubes',          // 'tubes' | 'circles' | 'ribbons'

      zStep: 0.03,

      // tubes
      maxHistory: 500,
      tubeRadius: 0.05,
      tubeSegments: 6,
      rebuildEvery: 3,

      // circles
      circleSegments: 32,
      circleOpacity: 0.6,
      circleFillOpacity: 0.08,
      maxCircleSlices: 2000,

      // ribbons
      ribbonOpacity: 0.4,       // @param float 0.05 1.0 0.05
      ribbonFillOpacity: 0.15,  // @param float 0.01 0.5 0.01  (additive fill)
      maxRibbonSlices: 1000,    // max quad-rows per ribbon before rolling

      // camera
      theta: 0.8,
      phi: 1.0,
      radius: 25.0,
      feedPlaneOffset: 10,   // @param float 0.0 50.0 1.0  — units behind present Z

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

    // tubes state
    this.histories  = new Map(); // ballId → entry

    // circles state
    this._currentPositions = new Map(); // ballId → {x, y}
    this._circleSlices  = [];
    this._sliceHead     = 0;
    this._sliceCount    = 0;

    // ribbons state
    // _ribbons: Map of pairKey → ribbon entry
    // _prevPositions: last frame's ball positions for ribbon edge
    this._ribbons       = new Map(); // pairKey → ribbon entry
    this._prevPositions = new Map(); // ballId → {x, y, z}

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
    window._spacetime = this;

    if (this.config.showGrid) this._buildGrid();
    this._updateCameraOrbit();
    console.log(`[BallSpacetime] enabled — mode: ${this.config.mode}`);
  }

  disable(camera) {
    if (!this.active) return;

    // Reset feed plane to origin before clearing the reference
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

    console.log('[BallSpacetime] disabled');
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  updateBall(ballId, worldPos) {
    if (!this.active) return;

    if (this.config.mode === 'tubes') {
      this._updateTube(ballId, worldPos);
    } else if (this.config.mode === 'ribbons') {
      // Accumulate positions; ribbons are extended in tick()
      this._currentPositions.set(ballId, { x: worldPos.x, y: worldPos.y });
    } else {
      // circles
      this._currentPositions.set(ballId, { x: worldPos.x, y: worldPos.y });
    }
  }

  tick() {
    if (!this.active) return;

    if (this.config.mode === 'circles') {
      this._emitCircleSlice();
    } else if (this.config.mode === 'ribbons') {
      this._extendRibbons();
    }

    this.currentZ += this.config.zStep;
    this._updateCameraOrbit();
    this._updateFeedPlane();
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  setConfig(config) {
    const prev = { ...this.config };
    Object.assign(this.config, config);

    // If mode changed, clear everything and start fresh
    if (config.mode !== undefined && config.mode !== prev.mode) {
      this._clearTubes();
      this._clearCircles();
      this._clearRibbons();
      console.log(`[BallSpacetime] mode → ${config.mode}`);
      return;
    }

    if (this.config.mode === 'tubes') {
      for (const [ballId, entry] of this.histories) {
        entry.material.color.setHex(this._colorFor(ballId));
        entry.material.opacity = this.config.opacity;
      }
    } else if (this.config.mode === 'ribbons') {
      for (const entry of this._ribbons.values()) {
        if (entry.wireMat) entry.wireMat.opacity = this.config.ribbonOpacity;
        if (entry.wireLineB?.material) entry.wireLineB.material.opacity = this.config.ribbonOpacity;
      }
    } else {
      // Update circle object materials
      for (const slice of this._circleSlices) {
        if (!slice) continue;
        for (const obj of slice.objects) {
          if (obj.material) obj.material.opacity = obj.isMesh
            ? this.config.circleFillOpacity
            : this.config.circleOpacity;
        }
      }
    }

    if (
      config.theta  !== undefined ||
      config.phi    !== undefined ||
      config.radius !== undefined
    ) {
      this._updateCameraOrbit();
    }

    if (config.showGrid !== undefined && config.showGrid !== prev.showGrid) {
      if (config.showGrid) this._buildGrid();
      else                 this._removeGrid();
    }
  }

  // ─── Removal ──────────────────────────────────────────────────────────────

  removeBall(ballId) {
    // tubes
    const entry = this.histories.get(ballId);
    if (entry) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
      this.histories.delete(ballId);
      this.objects.delete(`spacetime-${ballId}`);
    }
    // circles — just stop including this ball; existing slices stay
    this._currentPositions.delete(ballId);
  }

  clear() {
    this._clearTubes();
    this._clearCircles();
    this._clearRibbons();
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

    const historyDepth = (this.config.mode === 'tubes'
      ? this.config.maxHistory
      : this.config.mode === 'ribbons'
        ? this.config.maxRibbonSlices
        : this.config.maxCircleSlices
    ) * this.config.zStep;

    this._camera.far = historyDepth + radius + 100;
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
    try {
      const fm = window.footMouse ?? { x: 0, y: 0, vx: 0, vy: 0 };
      const t  = performance.now() / 1000;
      const fn = new Function(
        'fmx', 'fmy', 'fmvx', 'fmvy', 'time', 't',
        'sin', 'cos', 'tan', 'abs', 'sqrt', 'pow', 'min', 'max',
        'floor', 'ceil', 'round', 'PI',
        '"use strict"; return (' + value + ');'
      );
      const result = fn(
        fm.x, fm.y, fm.vx, fm.vy, t, t,
        Math.sin, Math.cos, Math.tan, Math.abs, Math.sqrt, Math.pow,
        Math.min, Math.max, Math.floor, Math.ceil, Math.round, Math.PI
      );
      return (typeof result === 'number' && isFinite(result)) ? result : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  TUBES MODE
  // ═════════════════════════════════════════════════════════════════════════

  _updateTube(ballId, worldPos) {
    if (!this.histories.has(ballId)) {
      this._initTubeEntry(ballId);
    }

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
    const cap      = this.config.maxHistory;
    const color    = this._colorFor(ballId);
    const useTube  = this.config.tubeRadius > 0;

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
      points.push(new THREE.Vector3(
        buf[idx * 3],
        buf[idx * 3 + 1],
        buf[idx * 3 + 2]
      ));
    }

    // Always include the latest point
    const lastIdx = count < cap ? n - 1 : (head + n - 1) % cap;
    const last = new THREE.Vector3(
      buf[lastIdx * 3],
      buf[lastIdx * 3 + 1],
      buf[lastIdx * 3 + 2]
    );
    if (!points[points.length - 1].equals(last)) points.push(last);
    if (points.length < 2) return;

    entry.mesh.geometry.dispose();

    if (this.config.tubeRadius > 0) {
      const curve  = new THREE.CatmullRomCurve3(points);
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

  _clearTubes() {
    for (const ballId of Array.from(this.histories.keys())) {
      const entry = this.histories.get(ballId);
      if (entry) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.material.dispose();
      }
    }
    this.histories.clear();
    this.objects.clear();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  CIRCLES MODE
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Called once per tick. Takes the current ball positions accumulated
   * this frame via updateBall(), draws one circle per pair at currentZ,
   * and stores them in a ring buffer so old slices persist.
   */
  _emitCircleSlice() {
    const positions = this._currentPositions;
    if (positions.size < 2) return;

    const ids  = Array.from(positions.keys());
    const ballPairs = pairs(ids);
    if (ballPairs.length === 0) return;

    const cap          = this.config.maxCircleSlices;
    const z            = this.currentZ;
    const segs         = this.config.circleSegments;
    const opacity      = this.config.circleOpacity;
    const fillOpacity  = this.config.circleFillOpacity;

    // If the ring buffer slot is occupied, remove the old slice first
    if (this._sliceCount >= cap) {
      const old = this._circleSlices[this._sliceHead];
      if (old) {
        for (const obj of old.objects) {
          this.scene.remove(obj);
          obj.geometry.dispose();
          obj.material.dispose();
        }
      }
    }

    // Build fill mesh + outline for each pair
    const objects = [];
    for (const [idA, idB] of ballPairs) {
      const a = positions.get(idA);
      const b = positions.get(idB);
      if (!a || !b) continue;

      const cx     = (a.x + b.x) / 2;
      const cy     = (a.y + b.y) / 2;
      const dx     = b.x - a.x;
      const dy     = b.y - a.y;
      const radius = Math.sqrt(dx * dx + dy * dy) / 2;

      if (radius < 0.001) continue;

      const colorA = this._colorFor(idA);
      const colorB = this._colorFor(idB);
      const color  = this._blendColors(colorA, colorB);

      // Filled circle — additive blending so overlapping pairs glow brighter
      const fillGeo = circleFillGeometry(cx, cy, z, radius, segs);
      const fillMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: fillOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      this.scene.add(fillMesh);
      objects.push(fillMesh);

      // Outline ring on top
      const ringGeo = circleRingGeometry(cx, cy, z + 0.0001, radius, segs);
      const ringMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.LineLoop(ringGeo, ringMat);
      this.scene.add(ring);
      objects.push(ring);
    }

    // Store in ring buffer
    this._circleSlices[this._sliceHead] = { objects };
    this._sliceHead = (this._sliceHead + 1) % cap;
    if (this._sliceCount < cap) this._sliceCount++;

    // Clear current positions so next frame starts fresh
    this._currentPositions.clear();
  }

  _clearCircles() {
    for (const slice of this._circleSlices) {
      if (!slice) continue;
      for (const obj of slice.objects) {
        this.scene.remove(obj);
        obj.geometry.dispose();
        obj.material.dispose();
      }
    }
    this._circleSlices  = [];
    this._sliceHead     = 0;
    this._sliceCount    = 0;
    this._currentPositions.clear();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  RIBBONS MODE
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Ribbon entry shape:
   *   pairKey      — 'idA:idB' string
   *   idA, idB     — the two ball ids
   *   color        — blended hex color
   *
   *   Geometry uses pre-allocated Float32Array buffers.
   *   Each "row" adds 2 vertices (one per ball) and 2 triangles.
   *   When maxRibbonSlices is reached, oldest row is overwritten (ring).
   *
   *   posBuf       — Float32Array[ maxSlices * 2 * 3 ]  (2 verts × xyz)
   *   idxBuf       — Uint32Array [ maxSlices * 2 * 3 ]  (2 tris × 3 idx)
   *   head         — next row write index
   *   count        — rows written so far (saturates at maxSlices)
   *
   *   fillMesh, wireMesh — Three.js objects
   *   fillMat, wireMat   — materials
   *   fillGeo, wireGeo   — geometries (BufferGeometry, LINE_STRIP mode)
   */
  _extendRibbons() {
    const cur = this._currentPositions;
    if (cur.size < 2) return;

    const ids      = Array.from(cur.keys());
    const ballPairs = pairs(ids);
    const z        = this.currentZ;

    for (const [idA, idB] of ballPairs) {
      const a = cur.get(idA);
      const b = cur.get(idB);
      if (!a || !b) continue;

      const key = `${idA}:${idB}`;
      if (!this._ribbons.has(key)) {
        this._initRibbon(key, idA, idB);
      }

      const entry = this._ribbons.get(key);
      const cap   = this.config.maxRibbonSlices;
      const row   = entry.head;

      // Write 2 vertices for this row: left = ball A, right = ball B
      const vBase = row * 6; // 2 verts × 3 floats
      entry.posBuf[vBase]     = a.x;
      entry.posBuf[vBase + 1] = a.y;
      entry.posBuf[vBase + 2] = z;
      entry.posBuf[vBase + 3] = b.x;
      entry.posBuf[vBase + 4] = b.y;
      entry.posBuf[vBase + 5] = z;

      const prevRow = (row - 1 + cap) % cap;
      entry.head = (row + 1) % cap;
      if (entry.count < cap) entry.count++;

      // We need at least 2 rows to form quads
      if (entry.count < 2) continue;

      this._uploadRibbon(entry);
    }

    // Store current as previous for next frame
    for (const [id, pos] of cur) {
      this._prevPositions.set(id, { ...pos, z });
    }
    this._currentPositions.clear();
  }

  _initRibbon(key, idA, idB) {
    const cap    = this.config.maxRibbonSlices;
    const colorA = this._colorFor(idA);
    const colorB = this._colorFor(idB);
    const color  = this._blendColors(colorA, colorB);

    // Extract RGB [0..1] for vertex color writes
    const cr = ((color >> 16) & 0xff) / 255;
    const cg = ((color >>  8) & 0xff) / 255;
    const cb = ( color        & 0xff) / 255;

    // Position buffer: cap rows x 2 verts x 3 floats (interleaved A/B)
    const posBuf = new Float32Array(cap * 2 * 3);

    // Per-worldline buffers: positions + vertex colors (RGB per vertex)
    const wireBufA = new Float32Array(cap * 3);
    const wireBufB = new Float32Array(cap * 3);
    const wireColA = new Float32Array(cap * 3);
    const wireColB = new Float32Array(cap * 3);

    // vertexColors: true lets us fade oldest->newest along the line
    const wireMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.config.ribbonOpacity,
      depthWrite: false,
    });

    const wireGeoA = new THREE.BufferGeometry();
    wireGeoA.setAttribute('position', new THREE.BufferAttribute(wireBufA, 3));
    wireGeoA.setAttribute('color',    new THREE.BufferAttribute(wireColA, 3));
    wireGeoA.setDrawRange(0, 0);

    const wireGeoB = new THREE.BufferGeometry();
    wireGeoB.setAttribute('position', new THREE.BufferAttribute(wireBufB, 3));
    wireGeoB.setAttribute('color',    new THREE.BufferAttribute(wireColB, 3));
    wireGeoB.setDrawRange(0, 0);

    const wireLineA = new THREE.Line(wireGeoA, wireMat);
    const wireLineB = new THREE.Line(wireGeoB, wireMat.clone());
    this.scene.add(wireLineA);
    this.scene.add(wireLineB);

    const entry = {
      key, idA, idB, color, cr, cg, cb,
      posBuf,
      wireBufA, wireBufB,
      wireColA, wireColB,
      wireGeoA, wireGeoB,
      wireLineA, wireLineB,
      wireMat,
      head:  0,
      count: 0,
    };

    this._ribbons.set(key, entry);
  }

  /**
   * Linearise the circular position buffer in chronological order,
   * write vertex colors that fade from black (oldest) to full color
   * (newest), then upload to GPU.
   *
   * No fill mesh — just the two worldline edges with age-fade colors.
   * This eliminates the overlap/white-out problem entirely.
   */
  _uploadRibbon(entry) {
    const { posBuf, head, count } = entry;
    const cap = this.config.maxRibbonSlices;
    const n   = Math.min(count, cap);
    if (n < 2) return;

    // Lazy-allocate scratch buffers once
    if (!entry.lbA) {
      entry.lbA = new Float32Array(cap * 3);
      entry.lbB = new Float32Array(cap * 3);
    }
    const { lbA, lbB, wireColA, wireColB, cr, cg, cb } = entry;

    for (let i = 0; i < n; i++) {
      const srcRow  = count < cap ? i : (head + i) % cap;
      const srcBase = srcRow * 6;
      const dst3    = i * 3;

      // Positions
      lbA[dst3]     = posBuf[srcBase];
      lbA[dst3 + 1] = posBuf[srcBase + 1];
      lbA[dst3 + 2] = posBuf[srcBase + 2];
      lbB[dst3]     = posBuf[srcBase + 3];
      lbB[dst3 + 1] = posBuf[srcBase + 4];
      lbB[dst3 + 2] = posBuf[srcBase + 5];

      // Vertex color: fade from 0 (oldest, i=0) to full (newest, i=n-1)
      // Use a power curve so the bright tip is more pronounced
      const t   = i / (n - 1);          // 0..1 oldest..newest
      const lum = t * t;                 // quadratic — dim tail, bright head
      wireColA[dst3]     = cr * lum;
      wireColA[dst3 + 1] = cg * lum;
      wireColA[dst3 + 2] = cb * lum;
      wireColB[dst3]     = cr * lum;
      wireColB[dst3 + 1] = cg * lum;
      wireColB[dst3 + 2] = cb * lum;
    }

    // Upload line A
    const attrPosA = entry.wireGeoA.attributes.position;
    const attrColA = entry.wireGeoA.attributes.color;
    attrPosA.array.set(lbA.subarray(0, n * 3));
    attrColA.array.set(wireColA.subarray(0, n * 3));
    attrPosA.needsUpdate = true;
    attrColA.needsUpdate = true;
    entry.wireGeoA.setDrawRange(0, n);
    entry.wireGeoA.computeBoundingSphere();

    // Upload line B
    const attrPosB = entry.wireGeoB.attributes.position;
    const attrColB = entry.wireGeoB.attributes.color;
    attrPosB.array.set(lbB.subarray(0, n * 3));
    attrColB.array.set(wireColB.subarray(0, n * 3));
    attrPosB.needsUpdate = true;
    attrColB.needsUpdate = true;
    entry.wireGeoB.setDrawRange(0, n);
    entry.wireGeoB.computeBoundingSphere();
  }

  _clearRibbons() {
    for (const entry of this._ribbons.values()) {
      this.scene.remove(entry.wireLineA);
      this.scene.remove(entry.wireLineB);
      entry.wireGeoA.dispose();
      entry.wireGeoB.dispose();
      entry.wireMat.dispose();
      if (entry.wireLineB.material !== entry.wireMat) {
        entry.wireLineB.material.dispose();
      }
    }
    this._ribbons.clear();
    this._prevPositions.clear();
    this._currentPositions.clear();
  }

  // ─── Grid ─────────────────────────────────────────────────────────────────

  _buildGrid() {
    if (this._gridMesh) return;
    const helper = new THREE.GridHelper(
      30, 20,
      this.config.gridColor,
      this.config.gridColor
    );
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

  // ─── Colour helpers ───────────────────────────────────────────────────────

  _colorFor(ballId) {
    if (this.config.perBallColors && this.config.ballColors) {
      const c = this.config.ballColors[ballId] ?? this.config.ballColors[String(ballId)];
      if (c !== undefined) return c;
    }
    return this.config.color;
  }

  _blendColors(hexA, hexB) {
    const r = (((hexA >> 16) & 0xff) + ((hexB >> 16) & 0xff)) >> 1;
    const g = (((hexA >>  8) & 0xff) + ((hexB >>  8) & 0xff)) >> 1;
    const b = (( hexA        & 0xff) + ( hexB        & 0xff)) >> 1;
    return (r << 16) | (g << 8) | b;
  }
}

effectRegistry.register('spacetime', BallSpacetime, {
     updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
   });