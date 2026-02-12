/**
 * Ball3DShapesThick - 3D shapes with THICK wireframes
 * 
 * Works around WebGL lineWidth limitation by using tube geometry
 * for each edge. More expensive but gives you controllable thickness!
 */
import { GeometryBase } from '../rendering/geometry-base.js';

export class Ball3DShapesThick extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      shape: 'cube',
      size: 1.5,
      thickness: 0.05,         // Edge thickness (this actually works!)
      color: 0xffffff,
      opacity: 1.0,
      zIndex: 0.03,
      emissive: 0x000000,      // Glow color
      emissiveIntensity: 0,    // Glow strength (0-1)
      
      // Rotation
      rotateX: 0.01,
      rotateY: 0.02,
      rotateZ: 0.01,
      
      // Per-ball settings
      perBallShapes: false,
      ballShapes: {},
      perBallColors: false,
      ballColors: {}
    };
  }
  
  createGeometry(id, { ballId, position }) {
    const shape = this._getShapeForBall(ballId);
    const color = this._getColorForBall(ballId);
    
    // Create thick wireframe using tubes
    const group = this._createThickWireframe(shape);
    group.position.set(position.x, position.y, this.config.zIndex);
    
    // Store all materials and meshes
    const materials = [];
    const meshes = [];
    group.traverse((child) => {
      if (child.isMesh && child.material) {  // ← Add material check
        child.material.color.setHex(color);
        child.material.transparent = this.config.opacity < 1.0;
        child.material.opacity = this.config.opacity;
        
        // Only set emissive if it exists
        if (child.material.emissive) {
          child.material.emissive.setHex(this.config.emissive);
          child.material.emissiveIntensity = this.config.emissiveIntensity;
        }
        
        materials.push(child.material);
        meshes.push(child);
      }
    });
    
    return {
      mesh: group,
      materials,
      meshes,
      ballId,
      shape,
      rotation: { x: 0, y: 0, z: 0 }
    };
  }
  
  _createThickWireframe(shape) {
    const group = new THREE.Group();
    const size = this.config.size;
    const thickness = this.config.thickness;
    
    // Get vertices and edges for the shape
    const { vertices, edges } = this._getShapeEdges(shape, size);
    
    // Create tube for each edge
    edges.forEach(([i, j]) => {
      const v1 = vertices[i];
      const v2 = vertices[j];
      
      const path = new THREE.LineCurve3(v1, v2);
      const geometry = new THREE.TubeGeometry(path, 1, thickness, 8, false);
      const material = new THREE.MeshBasicMaterial({
        color: this.config.color,
        transparent: this.config.opacity < 1.0,
        opacity: this.config.opacity
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
    });
    
    return group;
  }
  
  _getShapeEdges(shape, size) {
    switch (shape) {
      case 'cube':
        return this._getCubeEdges(size);
      case 'tetrahedron':
        return this._getTetrahedronEdges(size);
      case 'octahedron':
        return this._getOctahedronEdges(size);
      default:
        return this._getCubeEdges(size);  // Fallback
    }
  }
  
  _getCubeEdges(size) {
    const s = size / 2;
    const vertices = [
      new THREE.Vector3(-s, -s, -s), // 0
      new THREE.Vector3( s, -s, -s), // 1
      new THREE.Vector3( s,  s, -s), // 2
      new THREE.Vector3(-s,  s, -s), // 3
      new THREE.Vector3(-s, -s,  s), // 4
      new THREE.Vector3( s, -s,  s), // 5
      new THREE.Vector3( s,  s,  s), // 6
      new THREE.Vector3(-s,  s,  s)  // 7
    ];
    
    const edges = [
      // Bottom face
      [0, 1], [1, 2], [2, 3], [3, 0],
      // Top face
      [4, 5], [5, 6], [6, 7], [7, 4],
      // Vertical edges
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    
    return { vertices, edges };
  }
  
  _getTetrahedronEdges(size) {
    const r = size / 2;
    const vertices = [
      new THREE.Vector3( r,  r,  r),
      new THREE.Vector3(-r, -r,  r),
      new THREE.Vector3(-r,  r, -r),
      new THREE.Vector3( r, -r, -r)
    ];
    
    const edges = [
      [0, 1], [0, 2], [0, 3],
      [1, 2], [1, 3], [2, 3]
    ];
    
    return { vertices, edges };
  }
  
  _getOctahedronEdges(size) {
    const r = size / 2;
    const vertices = [
      new THREE.Vector3( 0,  r,  0), // top
      new THREE.Vector3( 0, -r,  0), // bottom
      new THREE.Vector3( r,  0,  0), // right
      new THREE.Vector3(-r,  0,  0), // left
      new THREE.Vector3( 0,  0,  r), // front
      new THREE.Vector3( 0,  0, -r)  // back
    ];
    
    const edges = [
      // Top pyramid
      [0, 2], [0, 3], [0, 4], [0, 5],
      // Bottom pyramid
      [1, 2], [1, 3], [1, 4], [1, 5],
      // Middle square
      [2, 4], [4, 3], [3, 5], [5, 2]
    ];
    
    return { vertices, edges };
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
    const shapeId = `${ballId}-thickshape`;
    
    if (this.has(shapeId)) {
      this.update(shapeId, { ballId, position: worldPos });
    } else {
      this.add(shapeId, { ballId, position: worldPos });
    }
  }
  
  removeBall(ballId) {
    this.remove(`${ballId}-thickshape`);
  }
  
  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    
    // Dispose of group and all children
    obj.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    
    this.scene.remove(obj.mesh);
    this.objects.delete(id);
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
      config.shape !== undefined ||
      config.size !== undefined ||
      config.thickness !== undefined;
    
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
      
      if (obj.materials && obj.materials.length > 0) {
        obj.materials.forEach(mat => {
          if (mat && mat.color) {
            mat.color.setHex(color);
            mat.opacity = this.config.opacity;
            mat.transparent = this.config.opacity < 1.0;
            
            // Only set emissive if the material supports it
            if (mat.emissive) {
              mat.emissive.setHex(this.config.emissive);
            }
            if (mat.emissiveIntensity !== undefined) {
              mat.emissiveIntensity = this.config.emissiveIntensity;
            }
          }
        });
      }
    }
  }
  
  clear() {
    super.clear();
  }
}