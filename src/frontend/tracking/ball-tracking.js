/**
 * BallTrackingManager - Uses EffectRegistry for ALL visual effects
 *
 * Active effects: trails, connections, spacetime, sincwaves
 * (trails/connections/spacetime register in effects-library.js,
 *  sincwaves registers here below).
 */

// Import the effects library — this triggers all registrations
import './effects-library.js';

// BallMedia is still special (manages video elements on tracked balls)
import { BallMedia } from './ball-media.js';
import { BallSincWaves } from './ball-sinc-waves.js';
import { effectRegistry } from './effect-registry.js';

// Register sincwaves here (custom shader, too unique for base classes)
effectRegistry.register('sincwaves', BallSincWaves, {
  updateMethod: 'updateBall', requiresWorldPos: true,
  hasEnabled: true, hasConfig: true,
  clearMethod: 'clear', removeBallMethod: 'removeBall'
});

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
  }

  clearAll() {
    this.media.clear();
    effectRegistry.clearAll();
    this.ballData = {};
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
        positions[ball.id] = pos;

        this.ballData[`ball_${ball.id}`] = {
          x: pos.y, y: 1 - pos.x,
          vx: ball.vx || 0, vy: ball.vy || 0
        };

        // Update all enabled per-ball effects
        const mediaObj = this.media.media[ball.id];
        if (mediaObj && mediaObj.mesh) {
          const worldPos = {
            x: mediaObj.mesh.position.x,
            y: mediaObj.mesh.position.y
          };
          effectRegistry.updateBall(ball.id, worldPos, this.enabledEffects);
        }
      }
    });

    // Update global effects that need all positions
    this._updateGlobalEffects(positions);
  }

  _updateGlobalEffects(positions) {
    // Connections (the only registered global effect after cleanup)
    if (this.enabledEffects.has('connections')) {
      const connections = effectRegistry.get('connections');
      if (connections) connections.updateConnections(positions);
    }
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
      if (effect && effect.clear) effect.clear();
    }
  }

  // ============================================================================
  // DATA ACCESS
  // ============================================================================

  getBallData() {
    return { ...this.ballData };
  }
}