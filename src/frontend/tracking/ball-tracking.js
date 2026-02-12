/**
 * BallTrackingManager (Refactored) - Uses EffectRegistry
 * 
 * Now adding a new effect is simple:
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

// Auto-debug flag
const AUTO_DEBUG = true;

function log(...args) {
  if (AUTO_DEBUG) console.log('[BallTracking DEBUG]', ...args);
}

// ============================================================================
// REGISTER ALL EFFECTS HERE
// ============================================================================
// This is the ONLY place you need to add new effects!

effectRegistry.register('trails', BallTrails, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});

effectRegistry.register('ripples', BallRipples, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});

effectRegistry.register('particles', BallParticles, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});

effectRegistry.register('3Dshapes', Ball3DShapes, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});

effectRegistry.register('3Dtrails', Ball3DTrails, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});
effectRegistry.register('3DShapesThick', Ball3DShapesThick, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});
effectRegistry.register('spiderweb', BallSpiderweb, {
  updateMethod: null,  // We'll handle this manually
  clearMethod: 'clear'
});
effectRegistry.register('3DField', Ball3DField, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});
effectRegistry.register('vortex', BallVortex, {
  updateMethod: 'updateBall',
  removeBallMethod: 'removeBall',
  clearMethod: 'clear'
});
effectRegistry.register('vectorField', VectorField, {
  updateMethod: null,        // We handle manually
  clearMethod: 'clear',
  removeBallMethod: null     // Doesn't need per-ball removal
});
effectRegistry.register('sincwaves', BallSincWaves, {
    updateMethod: 'updateBall',
    requiresWorldPos: true,
    hasEnabled: true,
    hasConfig: true,
    clearMethod: 'clear',
    removeBallMethod: 'removeBall'
  });

// Add more effects here in the future - that's it!
// effectRegistry.register('particles', BallParticles);
// effectRegistry.register('aura', BallAura);

// ============================================================================

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    log('Constructor called');
    
    this.sceneManager = sceneManager;
    
    // Core media and connections (not in registry - special behavior)
    this.media = new BallMedia(sceneManager, audioProcessor, visualFX);
    this.lines = new ConnectionLines(sceneManager);
    this.circles = new ConnectionCircles(sceneManager, this.media);
    
    // Initialize all registered effects
    effectRegistry.initialize(sceneManager, audioProcessor, visualFX);
    
    log('All geometry classes initialized');
    
    // Track which effects are enabled
    this.enabledEffects = new Set(); // Set of effect names
    
    // Connection mode (special case - not an effect)
    this.connectionMode = 'none';
    
    // Data for external consumers
    this.ballData = {};
    
    // Auto-print debug
    this.debugInterval = setInterval(() => {
      this.autoPrintDebug();
    }, 3000);
    
    log('Initialization complete');
    
    // Expose to window
    if (typeof window !== 'undefined') {
      window.ballTrackingManager = this;
      window.effectRegistry = effectRegistry;
      log('Exposed to window.ballTrackingManager and window.effectRegistry');
    }
  }
  
  autoPrintDebug() {
    const info = this.getDebugInfo();
    
    console.log('╔════════════════════════════════════════════════╗');
    console.log('║        BALL TRACKING AUTO-DEBUG                ║');
    console.log('╠════════════════════════════════════════════════╣');
    console.log('║ Connection Mode:', info.connectionMode.padEnd(30), '║');
    console.log('║ Enabled Effects:', Array.from(this.enabledEffects).join(', ').padEnd(29), '║');
    console.log('║ Ball Count:', String(info.ballCount).padEnd(35), '║');
    
    // Show effect object counts
    for (const [name, effectInfo] of Object.entries(info.effects)) {
      const label = `${name} Objects:`;
      console.log('║', label.padEnd(15), String(effectInfo.objectCount).padEnd(32), '║');
    }
    
    console.log('║ Line Objects:', String(info.lineCount).padEnd(33), '║');
    console.log('║ Circle Objects:', String(info.circleCount).padEnd(30), '║');
    console.log('╚════════════════════════════════════════════════╝');
  }
  
  // ============================================================================
  // BALL MEDIA (unchanged)
  // ============================================================================
  
  async displayBallMedia(ballId, mediaUrl, config = {}) {
    log(`displayBallMedia(${ballId}, ${mediaUrl})`);
    const result = await this.media.attach(ballId, mediaUrl, config);
    log(`✓ Ball ${ballId} media attached`);
    return result;
  }
  
  applyParameters(ballId, params) {
    log(`applyParameters(${ballId})`, params);
    this.media.applyParams(ballId, params);
  }
  
  setBallLocked(ballId, locked) {
    log(`setBallLocked(${ballId}, ${locked})`);
    const m = this.media.media[ballId];
    if (m) m.setLocked(locked);
  }
  
  clearBall(ballId) {
    log(`clearBall(${ballId})`);
    this.media.remove(ballId);
    effectRegistry.removeBall(ballId); // Auto-removes from all effects
    delete this.ballData[`ball_${ballId}`];
  }
  
  clearAll() {
    log('clearAll()');
    this.media.clear();
    this.lines.clear();
    this.circles.clear();
    effectRegistry.clearAll(); // Auto-clears all effects
    this.ballData = {};
  }
  
  // ============================================================================
  // TRACKING DATA
  // ============================================================================
  
  processBallData(data) {
    if (!data.balls || data.balls.length === 0) return;
    
    const positions = {};
    
    // Update each ball
    data.balls.forEach(ball => {
      // Update media position
      this.media.updatePosition(ball.id, ball.x, ball.y);
      
      // Get normalized position from media
      const pos = this.media.getPosition(ball.id);
      if (pos) {
        positions[ball.id] = pos;
        
        // Store data
        this.ballData[`ball_${ball.id}`] = {
          x: pos.y,
          y: 1 - pos.x,
          vx: ball.vx || 0,
          vy: ball.vy || 0
        };
        
        // Update all enabled effects automatically
        const mediaObj = this.media.media[ball.id];
        if (mediaObj && mediaObj.mesh) {
          const worldPos = {
            x: mediaObj.mesh.position.x,
            y: mediaObj.mesh.position.y
          };
          
          // Registry handles updating all enabled effects
          effectRegistry.updateBall(ball.id, worldPos, this.enabledEffects);
        }
      }
    });
    // Update connections (still special case)
    this._updateConnections(positions);
    if (this.enabledEffects.has('spiderweb')) {
      const spiderweb = effectRegistry.get('spiderweb');
      if (spiderweb) {
        spiderweb.updateConnections(positions);
      }
    }
    
    // ← ADD THIS
    // Update vector field if enabled
    if (this.enabledEffects.has('vectorField')) {
      const vectorField = effectRegistry.get('vectorField');
      if (vectorField) {
        vectorField.updateField(positions);
      }
    }
  }
  
  _updateConnections(positions) {
    const ids = Object.keys(positions);
    
    if (this.connectionMode === 'mesh') {
      this._updateMesh(positions, ids);
    } else if (this.connectionMode === 'sequential') {
      this._updateSequential(positions, ids);
    } else if (this.connectionMode === 'circles') {
      this._updateCircles(positions, ids);
    }
  }
  
  _updateMesh(positions, ids) {
    const validConnIds = new Set();
    
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        
        if (this.lines.has(connId)) {
          this.lines.update(connId, { p1, p2 });
        } else {
          this.lines.add(connId, { p1, p2 });
        }
        validConnIds.add(connId);
      }
    }
    
    for (const id of this.lines.objects.keys()) {
      if (!validConnIds.has(id)) this.lines.remove(id);
    }
  }
  
  _updateSequential(positions, ids) {
    if (ids.length < 2) {
      this.lines.clear();
      return;
    }
    
    const sorted = ids.sort();
    const validConnIds = new Set();
    
    for (let i = 0; i < sorted.length; i++) {
      const next = (i + 1) % sorted.length;
      const connId = `${sorted[i]}-${sorted[next]}`;
      const p1 = this.sceneManager.mapCameraToWorld(positions[sorted[i]].x, positions[sorted[i]].y);
      const p2 = this.sceneManager.mapCameraToWorld(positions[sorted[next]].x, positions[sorted[next]].y);
      
      if (this.lines.has(connId)) {
        this.lines.update(connId, { p1, p2 });
      } else {
        this.lines.add(connId, { p1, p2 });
      }
      validConnIds.add(connId);
    }
    
    for (const id of this.lines.objects.keys()) {
      if (!validConnIds.has(id)) this.lines.remove(id);
    }
  }
  
  _updateCircles(positions, ids) {
    if (ids.length < 2) {
      this.circles.clear();
      return;
    }
    
    const pairs = [];
    let index = 0;
    
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `circle-${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        const content = this.circles.config.perCircleColors 
          ? this.circles.config.circleContents[index % this.circles.config.circleContents.length]
          : this.circles.config.color;
        
        if (this.circles.has(connId)) {
          this.circles.update(connId, { p1, p2, content, index });
        } else {
          this.circles.add(connId, { p1, p2, content, index });
        }
        
        const obj = this.circles.get(connId);
        if (obj) pairs.push({ id: connId, radius: obj.radius });
        index++;
      }
    }
    
    this.circles.layerByRadius();
    
    const validIds = new Set(ids);
    for (const id of this.circles.objects.keys()) {
      const parts = id.replace('circle-', '').split('-');
      if (!validIds.has(parts[0]) || !validIds.has(parts[1])) {
        this.circles.remove(id);
      }
    }
  }
  
  // ============================================================================
  // MODE CONTROL (connections - still special)
  // ============================================================================
  
  setConnectionsEnabled(enabled) {
    log('setConnectionsEnabled:', enabled);
    if (!enabled) {
      this.connectionMode = 'none';
      this.lines.clear();
      this.circles.clear();
      this.media.setAllVisible(true);
    }
  }
  
  setConnectionMode(mode) {
    log('setConnectionMode:', mode);
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
    log('setConnectionParameters:', params);
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
    log('setConnectionRouting:', { routing, streams });
    this.circles.setRouting(routing);
  }
  
  // ============================================================================
  // GENERIC EFFECT CONTROL - Works for ANY registered effect!
  // ============================================================================
  
  /**
   * Enable/disable any effect by name
   */
  setEffectEnabled(effectName, enabled) {
    console.log(`╔═══════════════════════════════════════╗`);
    console.log(`║  ${effectName.toUpperCase()} ENABLED:`, enabled ? 'TRUE ✅' : 'FALSE ❌'.padEnd(19), '║');
    console.log(`╚═══════════════════════════════════════╝`);
    
    if (enabled) {
      this.enabledEffects.add(effectName);
    } else {
      this.enabledEffects.delete(effectName);
      // Clear the effect when disabled
      const effect = effectRegistry.get(effectName);
      if (effect && effect.clear) {
        effect.clear();
      }
    }
  }
  
  /**
   * Set parameters for any effect
   */
  setEffectParameters(effectName, params) {
    console.log(`╔═══════════════════════════════════════╗`);
    console.log(`║  ${effectName.toUpperCase()} PARAMETERS SET`.padEnd(41), '║');
    console.log(`╚═══════════════════════════════════════╝`);
    
    effectRegistry.applyConfig(effectName, params);
  }
  
  // ============================================================================
  // LEGACY COMPATIBILITY - Keep old method names working
  // ============================================================================
  
  setTrailsEnabled(enabled) {
    this.setEffectEnabled('trails', enabled);
  }
  
  setTrailParameters(params) {
    this.setEffectParameters('trails', params);
  }
  
  setRipplesEnabled(enabled) {
    this.setEffectEnabled('ripples', enabled);
  }
  
  setRippleParameters(params) {
    this.setEffectParameters('ripples', params);
  }
  
  // ============================================================================
  // DATA ACCESS
  // ============================================================================
  
  getAllBallPositions() {
    const positions = {};
    for (const [ballId, mediaObj] of Object.entries(this.media.media)) {
      const pos = mediaObj.getPosition();
      if (pos) positions[ballId] = pos;
    }
    return positions;
  }
  
  getBallData() {
    return { ...this.ballData };
  }
  
  // ============================================================================
  // DEBUG INFO
  // ============================================================================
  
  getDebugInfo() {
    return {
      connectionMode: this.connectionMode,
      enabledEffects: Array.from(this.enabledEffects),
      ballCount: Object.keys(this.media.media).length,
      lineCount: this.lines.objects.size,
      circleCount: this.circles.objects.size,
      effects: effectRegistry.getDebugInfo()
    };
  }
  
  stopAutoDebug() {
    if (this.debugInterval) {
      clearInterval(this.debugInterval);
      this.debugInterval = null;
      console.log('[BallTracking DEBUG] Auto-debug stopped');
    }
  }
  
  startAutoDebug() {
    if (!this.debugInterval) {
      this.debugInterval = setInterval(() => {
        this.autoPrintDebug();
      }, 3000);
      console.log('[BallTracking DEBUG] Auto-debug started');
    }
  }
  
  // Legacy compatibility
  hideBallVideos() { this.media.setAllVisible(false); }
  showBallVideos() { this.media.setAllVisible(true); }
  get ballVideos() { return this.media.media; }
}