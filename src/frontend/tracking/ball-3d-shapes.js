/**
 * Ball3DShapes - 3D wireframe shapes attached to balls
 * 
 * Creates rotating 3D wireframe objects (cubes, spheres, cones, etc.)
 * that follow ball positions and can rotate in 3D space
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';

export class Ball3DShapes extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      shape: 'cube',           // 'cube', 'sphere', 'cone', 'cylinder', 'torus', 
                               // 'tetrahedron', 'octahedron', 'icosahedron', 'dodecahedron'
      size: 1.5,               // Overall size
      color: 0xffffff,
      opacity: 1.0,
      zIndex: 0.03,
      lineWidth: 1,            // Line thickness (note: may not work on all platforms)
      
      // Rotation
      rotateX: 0.01,           // Rotation speed X axis
      rotateY: 0.02,           // Rotation speed Y axis
      rotateZ: 0.01,           // Rotation speed Z axis
      
      // Shape-specific params
      segments: 8,             // For sphere, cone, cylinder, torus
      
      // Per-ball settings
      perBallShapes: false,    // Different shape per ball
      ballShapes: {},          // { 0: 'cube', 1: 'sphere', ... }
      perBallColors: false,
      ballColors: {}
    };
  }
  
  createGeometry(id, { ballId, position }) {
    const shape = this._getShapeForBall(ballId);
    const color = this._getColorForBall(ballId);
    
    // Create wireframe geometry based on shape type
    const geometry = this._createWireframeGeometry(shape);
    
    // Use LineBasicMaterial for wireframes (not MeshBasicMaterial)
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: this.config.opacity < 1.0,
      opacity: this.config.opacity,
      linewidth: this.config.lineWidth // Note: may not work on all platforms
    });
    
    // Use LineSegments instead of Mesh for wireframes
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.position.set(position.x, position.y, this.config.zIndex);
    
    return { 
      mesh, 
      geometry, 
      material, 
      ballId,
      shape,
      rotation: { x: 0, y: 0, z: 0 }
    };
  }
  
  _createWireframeGeometry(shape) {
    const size = this.config.size;
    const segments = this.config.segments;
    
    switch (shape) {
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
  
  updateGeometry(id, { ballId, position }) {
    const obj = this.get(id);
    if (!obj) return;
    
    // Update position
    obj.mesh.position.set(position.x, position.y, this.config.zIndex);
    
    // Apply rotation
    obj.rotation.x += this.config.rotateX;
    obj.rotation.y += this.config.rotateY;
    obj.rotation.z += this.config.rotateZ;
    
    obj.mesh.rotation.x = obj.rotation.x;
    obj.mesh.rotation.y = obj.rotation.y;
    obj.mesh.rotation.z = obj.rotation.z;
  }
  
  updateBall(ballId, worldPos) {
    const shapeId = `${ballId}-shape`;
    
    if (this.has(shapeId)) {
      this.update(shapeId, { ballId, position: worldPos });
    } else {
      this.add(shapeId, { ballId, position: worldPos });
    }
  }
  
  removeBall(ballId) {
    this.remove(`${ballId}-shape`);
  }
  
  _getShapeForBall(ballId) {
    if (this.config.perBallShapes && this.config.ballShapes) {
      const shape = this.config.ballShapes[ballId] || this.config.ballShapes[String(ballId)];
      if (shape) return shape;
    }
    return this.config.shape;
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
      config.shape !== undefined && config.shape !== this.config.shape ||
      config.size !== undefined && Math.abs(config.size - this.config.size) > 0.01 ||
      config.segments !== undefined && config.segments !== this.config.segments ||
      config.perBallShapes !== undefined && config.perBallShapes !== this.config.perBallShapes ||
      config.ballShapes !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      // Recreate all shapes
      const ballIds = new Set();
      for (const obj of this.getAll()) ballIds.add(obj.ballId);
      this.clear();
      // Shapes will be recreated on next updateBall
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = this._getColorForBall(obj.ballId);
      obj.material.color.setHex(color);
      obj.material.opacity = this.config.opacity;
      obj.material.transparent = this.config.opacity < 1.0;
    }
  }
  
  clear() {
    super.clear();
  }
}