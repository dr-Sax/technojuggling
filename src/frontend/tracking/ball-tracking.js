import { MediaObject } from '../media/media-object.js';
import { effectRegistry } from './effect-registry.js';
import './effects/index.js';  // registers all effects

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.media = {};
    this.ballData = {};
    this._lastWorldPos = new Map();
    this._lastFrameTime = performance.now() / 1000;

    effectRegistry.initialize(sceneManager);

    // Connections needs ball media for video-textured circles
    const conn = effectRegistry.get('connections');
    if (conn) {
      conn.setBallMedia(this);
      conn.onVisibilityChange?.((visible) => this.setAllMediaVisible(visible));
    }
  }

  // ─── Ball media ────────────────────────────────────────────────────────────

  async displayBallMedia(ballId, poolMedia, config = {}) {
    if (this.media[ballId]) this.media[ballId].dispose();
    const obj = new MediaObject(this.sceneManager, this.audioProcessor, `ball-${ballId}`);
    await obj.attachElement(poolMedia.element, poolMedia.type, {
      ...config,
      animated: poolMedia.animated || false,
    });
    obj.setVisible(false);
    this.media[ballId] = obj;
    return obj;
  }

  applyParameters(ballId, params) {
    this.media[ballId]?.applyParameters({ scale: 3, ...params }, 1.0);
  }

  setMediaVisible(ballId, visible) { this.media[ballId]?.setVisible(visible); }
  setAllMediaVisible(visible) {
    for (const m of Object.values(this.media)) m.setVisible(visible);
  }
  getMediaElement(ballId) { return this.media[ballId]?.element || null; }

  tickTextures() {
    for (const m of Object.values(this.media)) m.tickTexture();
  }

  clearBall(ballId) {
    if (this.media[ballId]) {
      this.media[ballId].dispose();
      delete this.media[ballId];
    }
    effectRegistry.removeBall(ballId);
    delete this.ballData[`ball_${ballId}`];
    this._lastWorldPos.delete(ballId);
  }

  clearAll() {
    for (const m of Object.values(this.media)) m.dispose();
    this.media = {};
    effectRegistry.disposeAll();
    this.ballData = {};
    this._lastWorldPos.clear();
  }

  // ─── Per-frame tracking ────────────────────────────────────────────────────

  processBallData(data) {
    if (!data.balls || data.balls.length === 0) return;

    const positions = new Map();

    for (const ball of data.balls) {
      this._updateMediaPosition(ball.id, ball.x, ball.y);

      const mediaObj = this.media[ball.id];
      const pos = mediaObj?.getPosition?.();
      if (pos) {
        this.ballData[`ball_${ball.id}`] = {
          x: pos.y, y: 1 - pos.x,
          vx: ball.vx || 0, vy: ball.vy || 0
        };
      }

      const worldPos = (mediaObj && mediaObj.mesh)
        ? { x: mediaObj.mesh.position.x, y: mediaObj.mesh.position.y }
        : this.sceneManager.mapCameraToWorld(ball.x, ball.y);

      if (worldPos) {
        positions.set(ball.id, worldPos);
        this._lastWorldPos.set(ball.id, worldPos);
      } else if (this._lastWorldPos.has(ball.id)) {
        positions.set(ball.id, this._lastWorldPos.get(ball.id));
      }
    }

    const sceneMgr = this.sceneManager.sceneManagerRef;  // the real SceneManager
    const now = performance.now() / 1000;
    const dt = Math.max(0, now - this._lastFrameTime);
    this._lastFrameTime = now;

    effectRegistry.tick(positions, {
      time: sceneMgr ? sceneMgr.getTime() : now,
      dt,
      expr: (s) => sceneMgr ? sceneMgr.evaluateParam(s, sceneMgr.getBallContext()) : 0,
    });
  }

  _updateMediaPosition(ballId, x, y) {
    const m = this.media[ballId];
    if (!m) return;
    const world = this.sceneManager.mapCameraToWorld(x, y);
    m.setPosition(world.x, world.y);
    if (!m.visible) m.setVisible(true);
  }

  getBallData() { return { ...this.ballData }; }
}