/**
 * BallTrackingManager - Uses EffectRegistry for extensible ball effects
 * 
 * Adding a new effect:
 * 1. Import the effect class
 * 2. Register it with effectRegistry.register()
 * 3. Done! No other code changes needed.
 */
import { BallMedia } from './ball-media.js';
import { ConnectionLines } from './connection-lines.js';
import { ConnectionCircles } from './connection-circles.js';
import { BallTrails } from './ball-trails.js';
import { BallRipples } from './ball-ripples.js';
import { BallParticles } from './ball-particles.js';
import { Ball3DShapes } from './ball-3d-shapes.js';
import { Ball3DTrails } from './ball-3d-trails.js';
import { Ball3DShapesThick } from './ball-3d-shapes-thick.js';
import { BallSpiderweb } from './ball-spiderweb.js';
import { Ball3DField } from './ball-3d-field.js';
import { BallVortex } from './ball-vortex.js';
import { VectorField } from './vector-field.js';
import { BallSincWaves } from './ball-sinc-waves.js';
import { effectRegistry } from './effect-registry.js';

// ============================================================================
// REGISTER ALL EFFECTS HERE — this is the ONLY place you need to add new ones
// ============================================================================

effectRegistry.register('trails', BallTrails, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('ripples', BallRipples, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('particles', BallParticles, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3Dshapes', Ball3DShapes, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3Dtrails', Ball3DTrails, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3DShapesThick', Ball3DShapesThick, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('spiderweb', BallSpiderweb, {
  updateMethod: null, clearMethod: 'clear'
});
effectRegistry.register('3DField', Ball3DField, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('vortex', BallVortex, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('vectorField', VectorField, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});
effectRegistry.register('sincwaves', BallSincWaves, {
  updateMethod: 'updateBall', requiresWorldPos: true,
  hasEnabled: true, hasConfig: true,
  clearMethod: 'clear', removeBallMethod: 'removeBall'
});

// ============================================================================

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;
    
    // Core media and connections (not in registry — special behavior)
    this.media = new BallMedia(sceneManager, audioProcessor, visualFX);
    this.lines = new ConnectionLines(sceneManager);
    this.circles = new ConnectionCircles(sceneManager, this.media);
    
    // Initialize all registered effects
    effectRegistry.initialize(sceneManager, audioProcessor, visualFX);
    
    // Track which effects are enabled
    this.enabledEffects = new Set();
    
    // Connection mode (special case — not an effect)
    this.connectionMode = 'none';
    
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
    this.lines.clear();
    this.circles.clear();
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
        
        // Update all enabled effects
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

    // Update connections (delegated to connection classes)
    this._updateConnections(positions);

    // Special-case effects that need all positions at once
    if (this.enabledEffects.has('spiderweb')) {
      const spiderweb = effectRegistry.get('spiderweb');
      if (spiderweb) spiderweb.updateConnections(positions);
    }
    if (this.enabledEffects.has('vectorField')) {
      const vectorField = effectRegistry.get('vectorField');
      if (vectorField) vectorField.updateField(positions);
    }
  }
  
  _updateConnections(positions) {
    if (this.connectionMode === 'mesh') {
      this.lines.updateMesh(positions);
    } else if (this.connectionMode === 'sequential') {
      this.lines.updateSequential(positions);
    } else if (this.connectionMode === 'circles') {
      this.circles.updateFromPositions(positions);
    }
  }
  
  // ============================================================================
  // CONNECTION CONTROL
  // ============================================================================
  
  setConnectionsEnabled(enabled) {
    if (!enabled) {
      this.connectionMode = 'none';
      this.lines.clear();
      this.circles.clear();
      this.media.setAllVisible(true);
    }
  }
  
  setConnectionMode(mode) {
    this.connectionMode = mode;
    this.lines.clear();
    this.circles.clear();
    
    if (mode === 'circles' && this.circles.config.filled) {
      this.media.setAllVisible(false);
    } else {
      this.media.setAllVisible(true);
    }
  }
  
  setConnectionParameters(params) {
    if (this.connectionMode === 'circles') {
      this.circles.setConfig(params);
      if (params.filled !== undefined) {
        this.media.setAllVisible(!params.filled);
      }
    } else {
      this.lines.setConfig(params);
    }
  }
  
  setConnectionRouting(routing, streams) {
    this.circles.setRouting(routing);
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