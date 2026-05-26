/**
 * BallTrackingManager — owns ball media (video/image/GIF on tracked balls)
 * AND runs the effects pipeline via EffectRegistry.
 *
 * Each frame: receives ball positions from WebSocket → updates each ball's
 * MediaObject mesh → feeds world positions to per-ball effects (trails,
 * sincWaves, captions, spacetime) and global effects (connections).
 *
 * Active effects: trails, connections, spacetime, sincwaves, captions.
 * Each file in ./effects/ registers itself with the registry on import.
 */

// Side-effect imports — each file registers its effect with the registry
import './effects/trails.js';
import './effects/connections.js';
import './effects/spacetime.js';
import './effects/sincwaves.js';
import './effects/captions.js';

import { MediaObject } from '../media/media-object.js';
import { effectRegistry } from './effect-registry.js';

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;

    // ballId (string) → MediaObject
    this.media = {};

    // Initialize all registered effects.
    effectRegistry.initialize(sceneManager, audioProcessor);

    // Connections is the one effect that needs to reach back for ball media
    // (video-textured circles + filled-circle visibility toggle).
    const connections = effectRegistry.get('connections');
    if (connections) {
      connections.setBallMedia(this);
      connections.onVisibilityChange((visible) => this.setAllMediaVisible(visible));
    }

    // Which effects are currently enabled (per-frame dispatch gate).
    this.enabledEffects = new Set();

    // Per-ball normalized data exposed to expression scope (b0x, b0y, ...).
    this.ballData = {};

    // Last known world position per ball id. Survives mesh dispose/recreate
    // during reloads, so global effects (connections) always have a stable
    // position to read.
    this._lastWorldPos = {};
  }

  // ============================================================================
  // BALL MEDIA — attaching, applying, removing
  // ============================================================================

  /**
   * Attach a pre-loaded media element from MediaPool to a ball. Replaces any
   * existing media for that ball.
   */
  async displayBallMedia(ballId, poolMedia, config = {}) {
    if (this.media[ballId]) this.media[ballId].dispose();

    const mediaObj = new MediaObject(this.sceneManager, this.audioProcessor, `ball-${ballId}`);
    // Forward the `animated` flag (set for GIFs by MediaPool) so MediaObject
    // knows to decode + advance the GIF rather than treat it as a static image.
    await mediaObj.attachElement(poolMedia.element, poolMedia.type, {
      ...config,
      animated: poolMedia.animated || false,
    });
    mediaObj.setLocked(config.locked || false);
    mediaObj.setVisible(false);

    this.media[ballId] = mediaObj;
    return mediaObj;
  }

  applyParameters(ballId, params) {
    if (this.media[ballId]) {
      this.media[ballId].applyParameters({ scale: 3, ...params }, 1.0);
    }
  }

  setBallLocked(ballId, locked) {
    if (this.media[ballId]) this.media[ballId].setLocked(locked);
  }

  setMediaVisible(ballId, visible) {
    if (this.media[ballId]) this.media[ballId].setVisible(visible);
  }

  setAllMediaVisible(visible) {
    for (const m of Object.values(this.media)) m.setVisible(visible);
  }

  /** Returns the DOM element (<video> or <img>) for a ball, or null. */
  getMediaElement(ballId) {
    return this.media[ballId]?.element || null;
  }

  /**
   * Per-frame animated-GIF texture refresh. No-op for videos (handled by
   * videoTextureUploader) and static images (uploaded once). Safe to call
   * for every ball unconditionally.
   */
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
    delete this._lastWorldPos[ballId];
  }

  clearAll() {
    for (const m of Object.values(this.media)) m.dispose();
    this.media = {};
    effectRegistry.clearAll();
    this.ballData = {};
    this._lastWorldPos = {};
  }

  // ============================================================================
  // TRACKING DATA
  // ============================================================================

  processBallData(data) {
    if (!data.balls || data.balls.length === 0) return;

    const positions = {};

    data.balls.forEach(ball => {
      this._updateMediaPosition(ball.id, ball.x, ball.y);

      const mediaObj = this.media[ball.id];
      const pos = mediaObj?.getPosition?.() || null;
      if (pos) {
        this.ballData[`ball_${ball.id}`] = {
          x: pos.y, y: 1 - pos.x,
          vx: ball.vx || 0, vy: ball.vy || 0
        };
      }

      // World position for effects.
      //
      // Preferred source: the media object's mesh position (the authoritative
      // world coordinate when a ball carries media). Fallback: raw tracker
      // coords mapped to world space, for balls that have no media attached.
      let worldPos = null;
      if (mediaObj && mediaObj.mesh) {
        worldPos = { x: mediaObj.mesh.position.x, y: mediaObj.mesh.position.y };
      } else {
        worldPos = this.sceneManager.mapCameraToWorld(ball.x, ball.y);
      }

      if (worldPos) {
        effectRegistry.updateBall(ball.id, worldPos, this.enabledEffects);
        this._lastWorldPos[ball.id] = worldPos;
        positions[ball.id] = worldPos;
      } else if (this._lastWorldPos[ball.id]) {
        // Reuse cached position so connections don't flicker through a gap.
        positions[ball.id] = this._lastWorldPos[ball.id];
      }
    });

    // Drive global effects (connections) every frame. The effect's own `mode`
    // is the on/off switch; we don't gate on enabledEffects here.
    const connections = effectRegistry.get('connections');
    if (connections) connections.updateConnections(positions);
  }

  /** Move a ball's media mesh to the world position for its tracked coords. */
  _updateMediaPosition(ballId, x, y) {
    const m = this.media[ballId];
    if (!m) return;
    const world = this.sceneManager.mapCameraToWorld(x, y);
    m.setPosition(world.x, world.y);
    if (!m.visible) m.setVisible(true);
  }

  // ============================================================================
  // CONNECTION CONTROL (thin pass-through to the Connections effect)
  // ============================================================================

  setConnectionsEnabled(enabled) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setEnabled(enabled);
    if (enabled) this.enabledEffects.add('connections');
    else         this.enabledEffects.delete('connections');
  }

  setConnectionMode(mode) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setMode(mode);
  }

  setConnectionParameters(params) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setConfig(params);
  }

  // ============================================================================
  // GENERIC EFFECT CONTROL — works for ANY registered effect
  // ============================================================================

  setEffectEnabled(effectName, enabled) {
    if (enabled) {
      this.enabledEffects.add(effectName);
    } else {
      this.enabledEffects.delete(effectName);
      const effect = effectRegistry.get(effectName);
      if (effect) {
        // setEnabled(false) lets effects fully turn off (e.g. connections
        // sets mode → 'none'). Fall back to clear() for effects without it.
        if (typeof effect.setEnabled === 'function') {
          effect.setEnabled(false);
        } else if (effect.clear) {
          effect.clear();
        }
      }
    }
  }

  // ============================================================================
  // DATA ACCESS
  // ============================================================================

  getBallData() {
    return { ...this.ballData };
  }
}