/**
 * BallTrackingManager - Uses EffectRegistry for ALL visual effects
 *
 * Active effects: trails, connections, spacetime, sincwaves
 * Each effect file in ./effects/ registers itself with the registry on import.
 */

// Side-effect imports — each file registers its effect with the registry
import './effects/trails.js';
import './effects/connections.js';
import './effects/spacetime.js';
import './effects/sincwaves.js';

// BallMedia is still special (manages video elements on tracked balls)
import { BallMedia } from './ball-media.js';
import { effectRegistry } from './effect-registry.js';

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;

    // Core media (manages video/image elements on tracked balls)
    this.media = new BallMedia(sceneManager, audioProcessor, visualFX);

    // Initialize all registered effects (including connections)
    effectRegistry.initialize(sceneManager, audioProcessor, visualFX);

    // Wire up the Connections effect with its dependencies
    const connections = effectRegistry.get('connections');
    if (connections) {
      connections.setBallMedia(this.media);
      connections.onVisibilityChange((visible) => this.media.setAllVisible(visible));
    }

    // Track which effects are enabled
    this.enabledEffects = new Set();

    // Data for external consumers
    this.ballData = {};

    // Last known world position per ball id. Survives mesh dispose/recreate
    // during reloads and media-visibility toggles, so global effects
    // (connections) always have a stable position to read.
    this._lastWorldPos = {};
  }

  // ============================================================================
  // BALL MEDIA
  // ============================================================================

  async displayBallMedia(ballId, poolMedia, config = {}) {
    return await this.media.attachFromPool(ballId, poolMedia, config);
  }

  applyParameters(ballId, params) {
    this.media.applyParams(ballId, params);
  }

  setBallLocked(ballId, locked) {
    const m = this.media.media[ballId];
    if (m) m.setLocked(locked);
  }

  clearBall(ballId) {
    this.media.remove(ballId);
    effectRegistry.removeBall(ballId);
    delete this.ballData[`ball_${ballId}`];
    delete this._lastWorldPos[ballId];
  }

  clearAll() {
    this.media.clear();
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
      this.media.updatePosition(ball.id, ball.x, ball.y);

      const pos = this.media.getPosition(ball.id);
      if (pos) {
        this.ballData[`ball_${ball.id}`] = {
          x: pos.y, y: 1 - pos.x,
          vx: ball.vx || 0, vy: ball.vy || 0
        };
      }

      // World position for effects.
      //
      // Preferred source: the media object's mesh. When a ball carries media,
      // its mesh position is the authoritative world coordinate.
      //
      // Fallback source: the raw tracker coords mapped to world space. A scene
      // group with no `streams` attaches no media, so `this.media.media[id]`
      // is undefined and there is no mesh.
      //
      // Either way we end up with a valid worldPos, and ALL effects — per-ball
      // (trails) and registry-driven (sincWaves) — are fed from it via the
      // single updateBall call below. Gating updateBall on the media mesh used
      // to silently strand sincWaves whenever `streams` was removed; routing
      // it off worldPos unconditionally fixes that, the same way the global
      // `positions` map already keeps connections alive without media.
      const mediaObj = this.media.media[ball.id];
      let worldPos = null;

      if (mediaObj && mediaObj.mesh) {
        worldPos = {
          x: mediaObj.mesh.position.x,
          y: mediaObj.mesh.position.y
        };
      } else {
        // No media for this ball — map the raw tracker coords directly.
        worldPos = this.sceneManager.mapCameraToWorld(ball.x, ball.y);
      }

      if (worldPos) {
        effectRegistry.updateBall(ball.id, worldPos, this.enabledEffects);
        this._lastWorldPos[ball.id] = worldPos;
        positions[ball.id] = worldPos;
      } else if (this._lastWorldPos[ball.id]) {
        // Couldn't resolve a position this frame — reuse the cached one so
        // connections don't flicker through a transient gap.
        positions[ball.id] = this._lastWorldPos[ball.id];
      }
    });

    // Drive connections every frame, like trails. The effect's own `mode`
    // ('none' vs mesh/sequential/circles) is the on/off switch — no external
    // enabled-set gate, so a reload can't silently strand it.
    this._updateGlobalEffects(positions);
  }

  _updateGlobalEffects(positions) {
    // Connections (the only registered global effect). Called unconditionally;
    // updateConnections() returns early when mode === 'none'.
    const connections = effectRegistry.get('connections');
    if (connections) connections.updateConnections(positions);
  }

  // ============================================================================
  // CONNECTION CONTROL (delegates to the Connections effect in the registry)
  // ============================================================================

  setConnectionsEnabled(enabled) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setEnabled(enabled);
    if (enabled) {
      this.enabledEffects.add('connections');
    } else {
      this.enabledEffects.delete('connections');
    }
  }

  setConnectionMode(mode) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setMode(mode);
  }

  setConnectionParameters(params) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setConfig(params);
  }

  setConnectionRouting(routing, streams) {
    const connections = effectRegistry.get('connections');
    if (connections) connections.setRouting(routing);
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
        // setEnabled(false) lets an effect fully turn itself off (connections
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