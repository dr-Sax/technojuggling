/**
 * Ball3DTrails - Delayed 3D wireframe shapes following balls
 * 
 * Like ballTrails but with 3D shapes instead of 2D polygons
 * Creates a trail of rotating 3D shapes behind each ball
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';

export class Ball3DTrails extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      shape: 'cube',           // Shape for trail objects
      count: 5,                // Number of trail shapes
      maxDelay: 0.5,           // Time span in seconds
      sizeRange: [0.5, 1.5],   // [smallest, largest] size
      color: 0x00ffff,
      opacity: 0.6,
      zIndex: 0.03,
      
      // Rotation (inherited from current rotation)
      inheritRotation: true,   // Copy rotation from main shape
      rotateX: 0,              // Additional rotation
      rotateY: 0,
      rotateZ: 0,
      
      // Shape settings
      segments: 8,
      
      // Per-ball colors
      perBallColors: false,
      ballColors: {},
      
      // Gradient
      gradient: false          // Fade opacity along trail
    };
    
    this.positionHistory = new Map();  // ballId -> [{pos, time, rotation}]
    this.rotationState = new Map();     // ballId -> {x, y, z}
  }
  
  createGeometry(id, { ballId, index, position, rotation }) {
    const sizeFactor = index / (this.config.count - 1);
    const size = this.config.sizeRange[0] + 
                 (this.config.sizeRange[1] - this.config.sizeRange[0]) * sizeFactor;
    
    const color = this._getColorForBall(ballId);
    const geometry = this._createWireframeGeometry(size);
    
    // Calculate opacity with gradient
    let opacity = this.config.opacity;
    if (this.config.gradient) {
      opacity *= (1 - sizeFactor * 0.7);  // Fade out towards smallest
    }
    
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: opacity,
      linewidth: 1
    });
    
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001);
    
    // Set rotation
    if (rotation) {
      mesh.rotation.x = rotation.x;
      mesh.rotation.y = rotation.y;
      mesh.rotation.z = rotation.z;
    }
    
    return { 
      mesh, 
      geometry, 
      material, 
      ballId,
      index,
      size,
      rotation: rotation || { x: 0, y: 0, z: 0 }
    };
  }
  
  _createWireframeGeometry(size) {
    const segments = this.config.segments;
    
    switch (this.config.shape) {
      case 'cube':
        return GeometryPrimitives.wireframeCube(size);
      case 'sphere':
        return GeometryPrimitives.wireframeSphere(size * 0.5, segments, Math.floor(segments * 0.75));
      case 'cone':
        return GeometryPrimitives.wireframeCone(size * 0.5, size, segments);
      case 'cylinder':
        return GeometryPrimitives.wireframeCylinder(size * 0.5, size * 0.5, size, segments);
      case 'torus':
        return GeometryPrimitives.wireframeTorus(size * 0.4, size * 0.15, 8, segments);
      case 'tetrahedron':
        return GeometryPrimitives.wireframeTetrahedron(size * 0.5);
      case 'octahedron':
        return GeometryPrimitives.wireframeOctahedron(size * 0.5);
      case 'icosahedron':
        return GeometryPrimitives.wireframeIcosahedron(size * 0.5);
      case 'dodecahedron':
        return GeometryPrimitives.wireframeDodecahedron(size * 0.5);
      default:
        return GeometryPrimitives.wireframeCube(size);
    }
  }
  
  updateGeometry(id, { ballId, index, position, rotation }) {
    const obj = this.get(id);
    if (obj) {
      obj.mesh.position.set(position.x, position.y, obj.mesh.position.z);
      
      if (rotation) {
        obj.mesh.rotation.x = rotation.x;
        obj.mesh.rotation.y = rotation.y;
        obj.mesh.rotation.z = rotation.z;
      }
    }
  }
  
  updateBall(ballId, worldPos, currentRotation) {
    const now = Date.now() / 1000;
    
    // Update rotation state
    if (!this.rotationState.has(ballId)) {
      this.rotationState.set(ballId, { x: 0, y: 0, z: 0 });
    }
    
    const rot = this.rotationState.get(ballId);
    rot.x += this.config.rotateX;
    rot.y += this.config.rotateY;
    rot.z += this.config.rotateZ;
    
    // Add to history
    if (!this.positionHistory.has(ballId)) {
      this.positionHistory.set(ballId, []);
    }
    
    const history = this.positionHistory.get(ballId);
    history.push({ 
      pos: { ...worldPos }, 
      time: now,
      rotation: this.config.inheritRotation && currentRotation 
        ? { ...currentRotation } 
        : { ...rot }
    });
    
    // Maintain history window
    while (history.length > 0 && history[0].time < now - this.config.maxDelay) {
      history.shift();
    }
    
    // Create/update trail shapes (skip index 0 - that's current position)
    for (let i = 1; i < this.config.count; i++) {
      const delay = (i / (this.config.count - 1)) * this.config.maxDelay;
      const targetTime = now - delay;
      const state = this._getStateAtTime(history, targetTime);
      
      const trailId = `${ballId}-3dtrail-${i}`;
      if (this.has(trailId)) {
        this.update(trailId, { 
          ballId, 
          index: i, 
          position: state.position,
          rotation: state.rotation
        });
      } else {
        this.add(trailId, { 
          ballId, 
          index: i, 
          position: state.position,
          rotation: state.rotation
        });
      }
    }
  }
  
  _getStateAtTime(history, targetTime) {
    if (history.length === 0) {
      return { 
        position: { x: 0, y: 0 },
        rotation: { x: 0, y: 0, z: 0 }
      };
    }
    if (history.length === 1) {
      return { 
        position: history[0].pos,
        rotation: history[0].rotation
      };
    }
    
    // Interpolate position and rotation
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].time <= targetTime && history[i + 1].time >= targetTime) {
        const t = (targetTime - history[i].time) / (history[i + 1].time - history[i].time);
        
        return {
          position: {
            x: history[i].pos.x + (history[i + 1].pos.x - history[i].pos.x) * t,
            y: history[i].pos.y + (history[i + 1].pos.y - history[i].pos.y) * t
          },
          rotation: {
            x: history[i].rotation.x + (history[i + 1].rotation.x - history[i].rotation.x) * t,
            y: history[i].rotation.y + (history[i + 1].rotation.y - history[i].rotation.y) * t,
            z: history[i].rotation.z + (history[i + 1].rotation.z - history[i].rotation.z) * t
          }
        };
      }
    }
    
    return { 
      position: history[history.length - 1].pos,
      rotation: history[history.length - 1].rotation
    };
  }
  
  removeBall(ballId) {
    for (let i = 0; i < this.config.count; i++) {
      this.remove(`${ballId}-3dtrail-${i}`);
    }
    this.positionHistory.delete(ballId);
    this.rotationState.delete(ballId);
  }
  
  _getColorForBall(ballId) {
    if (this.config.perBallColors && this.config.ballColors) {
      const color = this.config.ballColors[ballId] || this.config.ballColors[String(ballId)];
      if (color !== undefined) return color;
    }
    return this.config.color;
  }
  
  setConfig(config) {
    const needsRecreate = 
      config.shape !== undefined ||
      config.count !== undefined ||
      config.sizeRange !== undefined ||
      config.segments !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      this.clear();
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = this._getColorForBall(obj.ballId);
      obj.material.color.setHex(color);
      
      const sizeFactor = obj.index / (this.config.count - 1);
      let opacity = this.config.opacity;
      if (this.config.gradient) {
        opacity *= (1 - sizeFactor * 0.7);
      }
      obj.material.opacity = opacity;
    }
  }
  
  clear() {
    super.clear();
    this.positionHistory.clear();
    this.rotationState.clear();
  }
}