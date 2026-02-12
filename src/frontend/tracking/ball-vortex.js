/**
 * BallVortex - Swirling spiral particles around balls
 * 
 * Creates particles that spiral into or out of ball positions
 * Like water going down a drain or energy vortexes
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialBuilder } from '../rendering/material-factory.js';

export class BallVortex extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      particleCount: 20,       // Particles per vortex
      radius: 2.0,             // Vortex radius
      spiralTightness: 0.5,    // How tight the spiral (0.1-2.0)
      particleSize: 0.1,
      
      // Direction
      inward: true,            // True = spiral in, false = spiral out
      
      // Speed
      rotationSpeed: 0.05,     // How fast particles orbit
      radialSpeed: 0.02,       // How fast particles move in/out
      
      // Visual
      color: 0x00ffff,
      opacity: 0.7,
      zIndex: 0.04,
      
      // Particle lifecycle
      fadeEdges: true,         // Fade at edges
      colorGradient: false,    // Color changes along spiral
      colorStart: 0x00ffff,
      colorEnd: 0xff00ff,
      
      // Animation
      pulseSpeed: 0,           // 0 = no pulse, >0 = pulsing vortex
      
      // Per-ball colors
      perBallColors: false,
      ballColors: {}
    };
    
    this.time = 0;
  }
  
  createGeometry(id, { ballId, index, angle, distance }) {
    const color = this._getColorForParticle(ballId, distance);
    
    // Create particle (small circle)
    const { fill } = GeometryPrimitives.circle(this.config.particleSize, 8);
    
    const material = new MaterialBuilder()
      .color(color)
      .opacity(this._getOpacity(distance))
      .additive()
      .build();
    
    const mesh = new THREE.Mesh(fill, material);
    mesh.position.z = this.config.zIndex;
    
    return {
      mesh,
      geometry: fill,
      material,
      ballId,
      index,
      angle,
      distance,
      baseAngle: angle,
      baseDistance: distance
    };
  }
  
  updateGeometry(id, { ballId, centerPos, angle, distance }) {
    const obj = this.get(id);
    if (!obj) return;
    
    // Calculate spiral position
    const x = centerPos.x + Math.cos(angle) * distance;
    const y = centerPos.y + Math.sin(angle) * distance;
    
    obj.mesh.position.set(x, y, this.config.zIndex);
    
    // Update visual properties
    const color = this._getColorForParticle(ballId, distance);
    obj.material.color.setHex(color);
    obj.material.opacity = this._getOpacity(distance);
    
    // Store current state
    obj.angle = angle;
    obj.distance = distance;
  }
  
  updateBall(ballId, worldPos) {
    this.time += 0.016; // Approximate frame time
    
    // Calculate particles for this vortex
    for (let i = 0; i < this.config.particleCount; i++) {
      const particleId = `${ballId}-vortex-${i}`;
      
      // Calculate particle's position in the spiral
      const t = i / this.config.particleCount;
      
      // Distance from center (0 = center, 1 = edge)
      let distance;
      if (this.config.inward) {
        // Spiral inward: starts at edge, moves to center
        distance = (1 - t) * this.config.radius;
      } else {
        // Spiral outward: starts at center, moves to edge
        distance = t * this.config.radius;
      }
      
      // Apply pulse if enabled
      if (this.config.pulseSpeed > 0) {
        distance *= 1 + Math.sin(this.time * this.config.pulseSpeed + i * 0.5) * 0.2;
      }
      
      // Angle: combines rotation speed with spiral tightness
      const spiralAngle = t * Math.PI * 2 * this.config.spiralTightness;
      const rotationAngle = this.time * this.config.rotationSpeed;
      const angle = spiralAngle + rotationAngle;
      
      // Update or create particle
      if (this.has(particleId)) {
        this.update(particleId, {
          ballId,
          centerPos: worldPos,
          angle,
          distance
        });
      } else {
        // Calculate initial position
        const x = worldPos.x + Math.cos(angle) * distance;
        const y = worldPos.y + Math.sin(angle) * distance;
        
        this.add(particleId, {
          ballId,
          index: i,
          angle,
          distance
        });
        
        // Set initial position
        const obj = this.get(particleId);
        if (obj) {
          obj.mesh.position.set(x, y, this.config.zIndex);
        }
      }
    }
  }
  
  removeBall(ballId) {
    for (let i = 0; i < this.config.particleCount; i++) {
      this.remove(`${ballId}-vortex-${i}`);
    }
  }
  
  _getColorForParticle(ballId, distance) {
    // Per-ball colors take priority
    if (this.config.perBallColors && this.config.ballColors) {
      const color = this.config.ballColors[ballId] || this.config.ballColors[String(ballId)];
      if (color !== undefined) {
        // If gradient is enabled, interpolate
        if (this.config.colorGradient && Array.isArray(color)) {
          const t = this.config.inward ? (distance / this.config.radius) : (1 - distance / this.config.radius);
          return this._interpolateColor(color[0], color[1], t);
        }
        return Array.isArray(color) ? color[0] : color;
      }
    }
    
    // Use gradient if enabled
    if (this.config.colorGradient) {
      const t = this.config.inward ? (distance / this.config.radius) : (1 - distance / this.config.radius);
      return this._interpolateColor(this.config.colorStart, this.config.colorEnd, t);
    }
    
    return this.config.color;
  }
  
  _getOpacity(distance) {
    let opacity = this.config.opacity;
    
    if (this.config.fadeEdges) {
      if (this.config.inward) {
        // Fade as particles reach center
        const t = distance / this.config.radius;
        opacity *= Math.max(0.2, t);
      } else {
        // Fade as particles reach edge
        const t = 1 - (distance / this.config.radius);
        opacity *= Math.max(0.2, t);
      }
    }
    
    return opacity;
  }
  
  _interpolateColor(color1, color2, t) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, t).getHex();
  }
  
  _getColorForBall(ballId) {
    if (this.config.perBallColors && this.config.ballColors) {
      const color = this.config.ballColors[ballId] || this.config.ballColors[String(ballId)];
      if (color !== undefined) {
        return Array.isArray(color) ? color[0] : color;
      }
    }
    return this.config.color;
  }
  
  setConfig(config) {
    const needsRecreate = 
      config.particleCount !== undefined && config.particleCount !== this.config.particleCount ||
      config.particleSize !== undefined && config.particleSize !== this.config.particleSize;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      this.clear();
    } else {
      // Just update visuals
      for (const obj of this.getAll()) {
        const color = this._getColorForParticle(obj.ballId, obj.distance);
        obj.material.color.setHex(color);
        obj.material.opacity = this._getOpacity(obj.distance);
      }
    }
  }
  
  clear() {
    super.clear();
    this.time = 0;
  }
}