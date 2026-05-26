import { Effect, makeMaterial } from './_shared.js';

export class Spacetime extends Effect {
  static defaults = {
    zStep: 0.03,
    maxHistory: 500,
    tubeRadius: 0.05,
    tubeSegments: 6,
    rebuildEvery: 3,
    theta: 0.8,
    phi: 1.0,
    radius: 25.0,
    feedPlaneOffset: 10,
    opacity: 0.9,
    color: 0x00ffff,
    ballColors: {},
    showGrid: true,
    gridColor: 0x333333,
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.histories = new Map();  // ballId → { buf, head, count, framesSinceRebuild, mesh, material }
    this.currentZ = 0;
    this._gridMesh = null;
  }

  configure(config) {
    Object.assign(this.config, config);

    if (this.enabled) {
      this._updateCameraOrbit();
      if (this.config.showGrid && !this._gridMesh) this._buildGrid();
      else if (!this.config.showGrid && this._gridMesh) this._removeGrid();
    }

    // Restyle existing tubes
    for (const [ballId, entry] of this.histories) {
      entry.material.color.setHex(this._colorFor(ballId));
      entry.material.opacity = this.config.opacity;
    }
  }

  update(positions, ctx) {
    if (!this._initialized) {
      this._initialized = true;
      this.currentZ = 0;
      if (this.config.showGrid) this._buildGrid();
      this._updateCameraOrbit();
    }

    for (const [ballId, pos] of positions) {
      this._updateTube(ballId, pos);
    }

    this.currentZ += this.config.zStep;
    this._updateCameraOrbit();
    this._updateFeedPlane();
  }

  dispose() {
    const camera = this.sceneManager.getCamera();
    if (camera) {
      camera.position.set(0, 0, 12);
      camera.lookAt(0, 0, 0);
      camera.far = 1000;
      camera.updateProjectionMatrix();
    }
    const threeScene = this.sceneManager.threeSceneRef;
    if (threeScene) threeScene.setCameraFeedZ(0);

    this._removeGrid();
    for (const entry of this.histories.values()) {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    }
    this.histories.clear();
    this.currentZ = 0;
    this._initialized = false;
  }

  removeBall(ballId) {
    const entry = this.histories.get(ballId);
    if (!entry) return;
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.material.dispose();
    this.histories.delete(ballId);
  }

  // ─── Camera orbit ──────────────────────────────────────────────────────────

  _updateCameraOrbit() {
    const camera = this.sceneManager.getCamera();
    if (!camera) return;

    const theta  = this._resolve(this.config.theta);
    const phi    = this._resolve(this.config.phi);
    const radius = this._resolve(this.config.radius);
    const targetZ = this.currentZ;

    const dx = radius * Math.sin(phi) * Math.cos(theta);
    const dy = radius * Math.sin(phi) * Math.sin(theta);
    const dz = radius * Math.cos(phi);

    camera.position.set(dx, dy, targetZ + dz);
    camera.lookAt(0, 0, targetZ);
    camera.far = this.config.maxHistory * this.config.zStep + radius + 100;
    camera.updateProjectionMatrix();
  }

  _updateFeedPlane() {
    const threeScene = this.sceneManager.threeSceneRef;
    if (!threeScene) return;
    const offset = this._resolve(this.config.feedPlaneOffset);
    threeScene.setCameraFeedZ(this.currentZ - offset);
  }

  _resolve(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return Number(value) || 0;
    const sm = this.sceneManager;
    if (sm?.evaluator?.isExpression?.(value)) {
      try {
        const ctx = sm.getBallContext ? sm.getBallContext() : { time: sm.getTime() };
        const r = sm.evaluator.evaluate(value, ctx);
        return Number.isFinite(r) ? r : 0;
      } catch { return 0; }
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  // ─── Tubes ─────────────────────────────────────────────────────────────────

  _updateTube(ballId, pos) {
    if (!this.histories.has(ballId)) this._initEntry(ballId);
    const entry = this.histories.get(ballId);
    const cap = this.config.maxHistory;

    const base = entry.head * 3;
    entry.buf[base]     = pos.x;
    entry.buf[base + 1] = pos.y;
    entry.buf[base + 2] = this.currentZ;
    entry.head = (entry.head + 1) % cap;
    if (entry.count < cap) entry.count++;

    entry.framesSinceRebuild++;
    if (entry.framesSinceRebuild >= this.config.rebuildEvery) {
      entry.framesSinceRebuild = 0;
      this._rebuildTube(entry);
    }
  }

  _initEntry(ballId) {
    const cap = this.config.maxHistory;
    const material = makeMaterial({
      color: this._colorFor(ballId),
      opacity: this.config.opacity,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.scene.add(mesh);

    this.histories.set(ballId, {
      buf: new Float32Array(cap * 3),
      head: 0,
      count: 0,
      framesSinceRebuild: 0,
      mesh,
      material,
    });
  }

  _rebuildTube(entry) {
    const { buf, head, count } = entry;
    const cap = this.config.maxHistory;
    const n = Math.min(count, cap);
    if (n < 2) return;

    const MAX = 500;
    const step = n <= MAX ? 1 : Math.ceil(n / MAX);
    const points = [];
    for (let i = 0; i < n; i += step) {
      const idx = count < cap ? i : (head + i) % cap;
      points.push(new THREE.Vector3(buf[idx * 3], buf[idx * 3 + 1], buf[idx * 3 + 2]));
    }
    const lastIdx = count < cap ? n - 1 : (head + n - 1) % cap;
    const last = new THREE.Vector3(buf[lastIdx * 3], buf[lastIdx * 3 + 1], buf[lastIdx * 3 + 2]);
    if (!points[points.length - 1].equals(last)) points.push(last);
    if (points.length < 2) return;

    entry.mesh.geometry.dispose();
    const curve = new THREE.CatmullRomCurve3(points);
    entry.mesh.geometry = new THREE.TubeGeometry(
      curve, points.length - 1, this.config.tubeRadius, this.config.tubeSegments, false
    );
  }

  _colorFor(ballId) {
    const bc = this.config.ballColors;
    if (bc && bc[ballId] !== undefined) return bc[ballId];
    if (bc && bc[String(ballId)] !== undefined) return bc[String(ballId)];
    return this.config.color;
  }

  // ─── Grid ──────────────────────────────────────────────────────────────────

  _buildGrid() {
    if (this._gridMesh) return;
    const helper = new THREE.GridHelper(30, 20, this.config.gridColor, this.config.gridColor);
    helper.rotation.x = Math.PI / 2;
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
}