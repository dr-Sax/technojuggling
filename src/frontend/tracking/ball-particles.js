/**
 * BallParticles - Particle effect emanating from balls
 * 
 * Spawns particles that fly outward from ball positions
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialBuilder, ColorUtils } from '../rendering/material-factory.js';

export class BallParticles extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      particleCount: 10,      // Particles per spawn
      spawnInterval: 0.1,     // How often to spawn (seconds)
      lifespan: 2.0,          // How long particles live (seconds)
      speed: 1.0,             // Initial speed
      size: 0.1,              // Particle size
      color: 0xffffff,
      zIndex: 0.05,
      gravity: 0,             // Optional gravity effect
      fadeOut: true           // Fade as they age
    };
    
    // Track when last particle burst was spawned for each ball
    this.lastSpawnTime = new Map(); // ballId -> timestamp
    this.particles = new Map();     // particleId -> {ballId, birthTime, velocity}
  }
  
  createGeometry(id, { position, velocity, birthTime }) {
    const geometries = GeometryPrimitives.circle(this.config.size, 8, 0);
    
    const material = new MaterialBuilder()
      .color(this.config.color)
      .opacity(1.0)
      .additive()
      .build();
    
    const mesh = new THREE.Mesh(geometries.fill, material);
    mesh.position.set(position.x, position.y, this.config.zIndex);
    
    return { 
      mesh, 
      geometry: geometries.fill, 
      material, 
      birthTime, 
      velocity,
      startPosition: { ...position }
    };
  }
  
  updateGeometry(id, { currentTime }) {
    const obj = this.get(id);
    if (!obj) return;
    
    const age = currentTime - obj.birthTime;
    
    // Remove if expired
    if (age >= this.config.lifespan) {
      this.remove(id);
      this.particles.delete(id);
      return;
    }
    
    // Update position based on velocity
    const dt = 0.016; // Assume ~60fps
    obj.mesh.position.x += obj.velocity.x * dt;
    obj.mesh.position.y += obj.velocity.y * dt;
    
    // Apply gravity if configured
    if (this.config.gravity !== 0) {
      obj.velocity.y -= this.config.gravity * dt;
    }
    
    // Fade out if configured
    if (this.config.fadeOut) {
      obj.material.opacity = 1.0 - (age / this.config.lifespan);
    }
  }
  
  updateBall(ballId, worldPos) {
    const now = Date.now() / 1000;
    
    // Check if it's time to spawn particles
    const lastTime = this.lastSpawnTime.get(ballId) || 0;
    if (now - lastTime >= this.config.spawnInterval) {
      this._spawnParticles(ballId, worldPos, now);
      this.lastSpawnTime.set(ballId, now);
    }
    
    // Update all existing particles
    for (const [particleId] of this.particles) {
      if (this.has(particleId)) {
        this.update(particleId, { currentTime: now });
      }
    }
  }
  
  _spawnParticles(ballId, worldPos, now) {
    for (let i = 0; i < this.config.particleCount; i++) {
      const particleId = `${ballId}-particle-${now}-${i}`;
      
      // Random direction
      const angle = Math.random() * Math.PI * 2;
      const velocity = {
        x: Math.cos(angle) * this.config.speed,
        y: Math.sin(angle) * this.config.speed
      };
      
      this.add(particleId, {
        position: worldPos,
        velocity,
        birthTime: now
      });
      
      this.particles.set(particleId, { ballId, birthTime: now, velocity });
    }
  }
  
  removeBall(ballId) {
    const toRemove = [];
    for (const [particleId, data] of this.particles.entries()) {
      if (data.ballId === ballId) {
        toRemove.push(particleId);
      }
    }
    
    toRemove.forEach(id => {
      this.remove(id);
      this.particles.delete(id);
    });
    
    this.lastSpawnTime.delete(ballId);
  }
  
  setConfig(config) {
    // Store old config values that might need recreation
    const oldSize = this.config.size;
    const oldColor = this.config.color;
    
    // Update config
    Object.assign(this.config, config);
    
    // If size changed, we need to recreate geometries
    // For now, just clear and let them respawn
    if (config.size !== undefined && config.size !== oldSize) {
      console.log('[BallParticles] Size changed, clearing particles');
      this.clear();
      this.particles.clear();
      this.lastSpawnTime.clear();
    }
    
    // If color changed, update existing particles
    if (config.color !== undefined && config.color !== oldColor) {
      this._updateMaterials();
    }
    
    console.log('[BallParticles] Config updated:', this.config);
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      obj.material.color.setHex(this.config.color);
    }
  }
  
  clear() {
    super.clear();
    this.particles.clear();
    this.lastSpawnTime.clear();
  }
}