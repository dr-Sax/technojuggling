/**
 * BallRipples - Example of creating a new effect with the framework
 * 
 * Creates expanding ring ripples that emanate from each ball position
 * Demonstrates:
 * - Using GeometryPrimitives.ring()
 * - Using MaterialBuilder with opacity fade
 * - Time-based animation
 * - Per-ball state management
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialBuilder, ColorUtils } from '../rendering/material-factory.js';

export class BallRipples extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      maxRipples: 3,           // Max concurrent ripples per ball
      rippleInterval: 0.5,      // Seconds between ripples
      expansionSpeed: 2.0,      // Units per second
      maxRadius: 5.0,           // Max radius before fade out
      ringWidth: 0.1,           // Width of ring
      color: 0x00ffff,
      segments: 32,
      zIndex: 0.01,
      gradient: false,          // Gradient from color to transparent
      perBallColors: false,
      ballColors: {}
    };
    
    // Track when last ripple was created for each ball
    this.lastRippleTime = new Map(); // ballId -> timestamp
    this.rippleData = new Map();     // rippleId -> {ballId, birthTime, startPos}
  }
  
  createGeometry(id, { ballId, position, birthTime }) {
    const color = this._getColorForBall(ballId);
    
    // Start with small ring
    const innerRadius = 0.01;
    const outerRadius = this.config.ringWidth;
    const geometry = GeometryPrimitives.ring(
      innerRadius, 
      outerRadius, 
      this.config.segments
    );
    
    // Start fully opaque
    const material = new MaterialBuilder()
      .color(color)
      .opacity(1.0)
      .doubleSided()
      .additive() // Additive blending for glow effect
      .build();
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position.x, position.y, this.config.zIndex);
    
    return {
      mesh,
      geometry,
      material,
      ballId,
      birthTime,
      startPos: { ...position }
    };
  }
  
  updateGeometry(id, { currentTime }) {
    const obj = this.get(id);
    if (!obj) return;
    
    const age = currentTime - obj.birthTime;
    const radius = age * this.config.expansionSpeed;
    
    // Check if ripple should be removed
    if (radius >= this.config.maxRadius) {
      this.remove(id);
      this.rippleData.delete(id);
      return;
    }
    
    // Calculate opacity fade
    const fadeFactor = 1.0 - (radius / this.config.maxRadius);
    obj.material.opacity = fadeFactor;
    
    // Recreate geometry with new radius
    const innerRadius = Math.max(0.01, radius - this.config.ringWidth);
    const outerRadius = radius;
    
    // Dispose old geometry
    obj.geometry.dispose();
    
    // Create new ring geometry
    obj.geometry = GeometryPrimitives.ring(
      innerRadius,
      outerRadius,
      this.config.segments
    );
    
    // Update mesh
    obj.mesh.geometry = obj.geometry;
  }
  
  /**
   * Update ripples for a ball at a given position
   */
  updateBall(ballId, worldPos) {
    const now = Date.now() / 1000;
    
    // Check if it's time to create a new ripple
    const lastTime = this.lastRippleTime.get(ballId) || 0;
    if (now - lastTime >= this.config.rippleInterval) {
      // Count existing ripples for this ball
      const existingCount = Array.from(this.rippleData.values())
        .filter(data => data.ballId === ballId).length;
      
      // Only create if under max
      if (existingCount < this.config.maxRipples) {
        const rippleId = `${ballId}-ripple-${now}`;
        this.add(rippleId, {
          ballId,
          position: worldPos,
          birthTime: now
        });
        this.rippleData.set(rippleId, { ballId, birthTime: now, startPos: worldPos });
        this.lastRippleTime.set(ballId, now);
      }
    }
    
    // Update all existing ripples
    for (const [rippleId, data] of this.rippleData.entries()) {
      if (this.has(rippleId)) {
        this.update(rippleId, { currentTime: now });
      }
    }
  }
  
  /**
   * Remove all ripples for a ball
   */
  removeBall(ballId) {
    const toRemove = [];
    for (const [rippleId, data] of this.rippleData.entries()) {
      if (data.ballId === ballId) {
        toRemove.push(rippleId);
      }
    }
    
    toRemove.forEach(id => {
      this.remove(id);
      this.rippleData.delete(id);
    });
    
    this.lastRippleTime.delete(ballId);
  }
  
  /**
   * Determine color for a ball's ripples
   */
  _getColorForBall(ballId) {
    if (this.config.perBallColors && this.config.ballColors) {
      const ballColor = this.config.ballColors[ballId] || 
                        this.config.ballColors[String(ballId)];
      if (ballColor !== undefined) {
        return Array.isArray(ballColor) ? ballColor[0] : ballColor;
      }
    }
    
    return Array.isArray(this.config.color) 
      ? this.config.color[0] 
      : this.config.color;
  }
  
  setConfig(config) {
    Object.assign(this.config, config);
    
    // If colors changed, update materials
    if (config.color || config.perBallColors || config.ballColors) {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = this._getColorForBall(obj.ballId);
      obj.material.color.setHex(color);
    }
  }
  
  clear() {
    super.clear();
    // Reset all tracking state
    this.lastRippleTime.clear();
    this.rippleData.clear();
  }
}