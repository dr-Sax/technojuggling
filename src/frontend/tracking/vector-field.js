/**
 * VectorField - Full-screen vector field visualization
 * 
 * Creates a grid of arrows/lines across the entire scene showing
 * the vector field created by balls acting as charged particles or masses.
 * Like electric field lines or gravitational field visualization.
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';

export class VectorField extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      // Grid properties
      gridWidth: 20,             // Number of points horizontally
      gridHeight: 15,            // Number of points vertically
      
      // Arrow/line properties
      arrowSize: 0.3,            // Size of arrows
      arrowShape: 'line',        // 'line', 'arrow', 'cone'
      lineLength: 0.5,           // Length multiplier
      normalizeVectors: true,    // Same length arrows (shows direction only)
      
      // Field type
      fieldType: 'electric',     // 'electric', 'gravity', 'flow'
      
      // Visual
      color: 0xffffff,
      opacity: 0.6,
      zIndex: 0.01,              // Behind most effects
      
      // Color by magnitude
      colorByMagnitude: true,
      colorWeak: 0x0000ff,       // Blue for weak field
      colorStrong: 0xff0000,     // Red for strong field
      
      // Animation
      animate: false,            // Animate field lines
      animSpeed: 0.02,
      
      // Ball charges/masses (can be positive or negative)
      ballCharges: {
        0: 1.0,                  // Positive charge/mass
        1: 1.0,
        2: 1.0
      },
      
      // Field strength
      strength: 5.0,             // Overall field strength multiplier
      
      // Culling
      minMagnitude: 0.01,        // Don't show very weak fields
      maxDistance: 15.0          // Max distance to consider
    };
    
    this.animationOffset = 0;
    this.ballPositions = new Map(); // ballId -> {x, y, charge}
  }
  
  createGeometry(id, { gridX, gridY, vector, magnitude }) {
    // Normalize vector for direction
    const len = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    if (len < 0.001) {
      vector = { x: 0, y: 1 }; // Default up
    } else {
      vector = { x: vector.x / len, y: vector.y / len };
    }
    
    // Calculate color based on magnitude
    const color = this._getColorForMagnitude(magnitude);
    
    // Create arrow/line geometry
    const geometry = this._createArrowGeometry();
    
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: this.config.opacity,
      linewidth: 1
    });
    
    const mesh = new THREE.LineSegments(geometry, material);
    
    // Calculate world position
    const worldPos = this._gridToWorld(gridX, gridY);
    mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);
    
    // Orient based on vector
    const angle = Math.atan2(vector.y, vector.x);
    mesh.rotation.z = angle - Math.PI / 2; // Arrows point up by default
    
    // Scale by magnitude (if not normalized)
    if (!this.config.normalizeVectors) {
      const scale = Math.min(magnitude * this.config.lineLength, 2.0);
      mesh.scale.set(scale, scale, 1);
    } else {
      mesh.scale.set(this.config.lineLength, this.config.lineLength, 1);
    }
    
    return {
      mesh,
      geometry,
      material,
      gridX,
      gridY,
      vector,
      magnitude
    };
  }
  
  updateGeometry(id, { gridX, gridY, vector, magnitude }) {
    const obj = this.get(id);
    if (!obj) return;
    
    // Normalize vector
    const len = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    if (len > 0.001) {
      vector = { x: vector.x / len, y: vector.y / len };
    }
    
    // Update color
    const color = this._getColorForMagnitude(magnitude);
    obj.material.color.setHex(color);
    
    // Update orientation
    const angle = Math.atan2(vector.y, vector.x);
    obj.mesh.rotation.z = angle - Math.PI / 2;
    
    // Update scale
    if (!this.config.normalizeVectors) {
      const scale = Math.min(magnitude * this.config.lineLength, 2.0);
      obj.mesh.scale.set(scale, scale, 1);
    }
    
    obj.vector = vector;
    obj.magnitude = magnitude;
  }
  
  _createArrowGeometry() {
    const size = this.config.arrowSize;
    
    if (this.config.arrowShape === 'cone') {
      return GeometryPrimitives.wireframeCone(size * 0.3, size, 6);
    } else if (this.config.arrowShape === 'arrow') {
      // Simple line with arrowhead
      const points = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, size, 0),
        // Arrowhead
        new THREE.Vector3(-size * 0.2, size * 0.8, 0),
        new THREE.Vector3(0, size, 0),
        new THREE.Vector3(size * 0.2, size * 0.8, 0),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      return geometry;
    } else {
      // Just a line
      const points = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, size, 0)
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      return geometry;
    }
  }
  
  /**
   * Update field based on all ball positions
   */
  updateField(ballPositions) {
    // Store ball positions with charges
    this.ballPositions.clear();
    for (const [ballId, pos] of Object.entries(ballPositions)) {
      const worldPos = this.sceneManager.mapCameraToWorld(pos.x, pos.y);
      const charge = this._getChargeForBall(ballId);
      this.ballPositions.set(ballId, { x: worldPos.x, y: worldPos.y, charge });
    }
    
    if (this.config.animate) {
      this.animationOffset += this.config.animSpeed;
    }
    
    // Update all grid points
    const validIds = new Set();
    
    for (let gy = 0; gy < this.config.gridHeight; gy++) {
      for (let gx = 0; gx < this.config.gridWidth; gx++) {
        const arrowId = `field-${gx}-${gy}`;
        
        const worldPos = this._gridToWorld(gx, gy);
        const field = this._calculateFieldAt(worldPos.x, worldPos.y);
        
        // Skip if field is too weak
        if (field.magnitude < this.config.minMagnitude) {
          continue;
        }
        
        if (this.has(arrowId)) {
          this.update(arrowId, {
            gridX: gx,
            gridY: gy,
            vector: field.vector,
            magnitude: field.magnitude
          });
        } else {
          this.add(arrowId, {
            gridX: gx,
            gridY: gy,
            vector: field.vector,
            magnitude: field.magnitude
          });
        }
        
        validIds.add(arrowId);
      }
    }
    
    // Remove arrows that are no longer needed
    for (const id of this.objects.keys()) {
      if (!validIds.has(id)) {
        this.remove(id);
      }
    }
  }
  
  _calculateFieldAt(x, y) {
    let totalX = 0;
    let totalY = 0;
    
    for (const [ballId, ball] of this.ballPositions.entries()) {
      const dx = x - ball.x;
      const dy = y - ball.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);
      
      // Skip if too far or too close
      if (dist > this.config.maxDistance || dist < 0.1) continue;
      
      let fieldStrength;
      
      if (this.config.fieldType === 'electric') {
        // Coulomb's law: F = k * q / r^2
        // Field points away from positive charges, toward negative
        fieldStrength = this.config.strength * ball.charge / distSq;
      } else if (this.config.fieldType === 'gravity') {
        // Gravitational: F = G * m / r^2
        // Always attractive (toward mass)
        fieldStrength = -this.config.strength * Math.abs(ball.charge) / distSq;
      } else if (this.config.fieldType === 'flow') {
        // Flow field: strength decreases linearly
        fieldStrength = this.config.strength * ball.charge / dist;
      }
      
      // Direction: unit vector from ball to point (or opposite for attraction)
      const dirX = dx / dist;
      const dirY = dy / dist;
      
      totalX += fieldStrength * dirX;
      totalY += fieldStrength * dirY;
    }
    
    const magnitude = Math.sqrt(totalX * totalX + totalY * totalY);
    
    return {
      vector: { x: totalX, y: totalY },
      magnitude: magnitude
    };
  }
  
  _gridToWorld(gridX, gridY) {
    // Map grid coordinates to world space
    // Assume world space is roughly -10 to 10 in both directions
    const worldWidth = 20;
    const worldHeight = 15;
    
    const x = (gridX / (this.config.gridWidth - 1)) * worldWidth - worldWidth / 2;
    const y = (gridY / (this.config.gridHeight - 1)) * worldHeight - worldHeight / 2;
    
    return { x, y };
  }
  
  _getChargeForBall(ballId) {
    const charge = this.config.ballCharges[ballId] || this.config.ballCharges[String(ballId)];
    return charge !== undefined ? charge : 1.0;
  }
  
  _getColorForMagnitude(magnitude) {
    if (!this.config.colorByMagnitude) {
      return this.config.color;
    }
    
    // Normalize magnitude to 0-1 range (logarithmic scale works better)
    const normalized = Math.min(Math.log(magnitude + 1) / Math.log(10), 1);
    
    const c1 = new THREE.Color(this.config.colorWeak);
    const c2 = new THREE.Color(this.config.colorStrong);
    return c1.lerp(c2, normalized).getHex();
  }
  
  setConfig(config) {
    const needsRecreate = 
      config.gridWidth !== undefined ||
      config.gridHeight !== undefined ||
      config.arrowShape !== undefined ||
      config.arrowSize !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      this.clear();
    } else {
      // Update existing arrows
      for (const obj of this.getAll()) {
        const worldPos = this._gridToWorld(obj.gridX, obj.gridY);
        const field = this._calculateFieldAt(worldPos.x, worldPos.y);
        
        if (field.magnitude >= this.config.minMagnitude) {
          this.update(`field-${obj.gridX}-${obj.gridY}`, {
            gridX: obj.gridX,
            gridY: obj.gridY,
            vector: field.vector,
            magnitude: field.magnitude
          });
        }
      }
    }
  }
  
  clear() {
    super.clear();
    this.ballPositions.clear();
    this.animationOffset = 0;
  }
}