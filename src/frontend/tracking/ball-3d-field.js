/**
 * Ball3DField - Vector field visualization around balls
 * 
 * Shows a force field around each ball with 3D arrows/cones
 * indicating direction and strength of influence
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';

export class Ball3DField extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      type: 'radial',          // 'radial', 'orbital', 'vortex', 'grid'
      
      // Field density
      rings: 3,                // Number of rings around ball
      pointsPerRing: 8,        // Points per ring
      radius: 2.0,             // Field radius
      
      // Arrow/cone properties
      arrowSize: 0.3,          // Size of arrows
      arrowShape: 'cone',      // 'cone', 'arrow', 'line'
      color: 0x00ffff,
      opacity: 0.7,
      zIndex: 0.03,
      
      // Animation
      rotate: true,            // Rotate field
      rotateSpeed: 0.02,
      pulse: false,            // Pulse arrows
      pulseSpeed: 0.05,
      
      // Force direction
      inward: false,           // Point toward or away from ball
      
      // Color by distance
      colorByDistance: false,
      colorClose: 0x00ff00,
      colorFar: 0xff0000,
      
      // Per-ball colors
      perBallColors: false,
      ballColors: {}
    };
    
    this.rotationOffset = 0;
    this.pulseOffset = 0;
  }
  
  createGeometry(id, { ballId, position, angle, distance, ringIndex }) {
    const color = this._getColorForBall(ballId, distance);
    
    // Create arrow/cone geometry
    const geometry = this._createArrowGeometry();
    
    const material = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: this.config.opacity,
      linewidth: 1
    });
    
    let mesh;
    if (this.config.arrowShape === 'line') {
      mesh = new THREE.LineSegments(geometry, material);
    } else {
      // For cone/arrow, use mesh with basic material
      const solidMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: this.config.opacity,
        side: THREE.DoubleSide
      });
      mesh = new THREE.Mesh(geometry, solidMaterial);
    }
    
    // Position and orient
    mesh.position.set(position.x, position.y, this.config.zIndex);
    
    // Orient arrow based on field type
    this._orientArrow(mesh, position, angle, distance);
    
    return {
      mesh,
      geometry,
      material: mesh.material,
      ballId,
      angle,
      distance,
      ringIndex,
      basePosition: { ...position },
      baseAngle: angle
    };
  }
  
  _createArrowGeometry() {
    const size = this.config.arrowSize;
    
    if (this.config.arrowShape === 'cone') {
      return GeometryPrimitives.cone(size * 0.3, size, 6);
    } else if (this.config.arrowShape === 'arrow') {
      // Simple arrow made of cone + cylinder
      return GeometryPrimitives.cone(size * 0.4, size * 0.6, 6);
    } else {
      // Line arrow (wireframe cone)
      return GeometryPrimitives.wireframeCone(size * 0.3, size, 6);
    }
  }
  
  _orientArrow(mesh, position, angle, distance) {
    const ballPos = this.sceneManager.mapCameraToWorld(0, 0); // Assuming ball at origin for now
    
    switch (this.config.type) {
      case 'radial':
        // Point away from (or toward) center
        const radialAngle = this.config.inward ? angle + Math.PI : angle;
        mesh.rotation.z = radialAngle - Math.PI / 2;
        break;
        
      case 'orbital':
        // Point tangent to circle (orbital motion)
        mesh.rotation.z = angle + (this.config.inward ? -Math.PI : 0);
        break;
        
      case 'vortex':
        // Spiral pattern
        const spiralAngle = angle + distance * 2;
        mesh.rotation.z = spiralAngle - Math.PI / 2;
        break;
        
      case 'grid':
        // All point same direction
        mesh.rotation.z = this.config.inward ? Math.PI : 0;
        break;
    }
  }
  
  updateGeometry(id, { ballId, position, angle, distance }) {
    const obj = this.get(id);
    if (!obj) return;
    
    // Update position
    obj.mesh.position.set(position.x, position.y, this.config.zIndex);
    
    // Reorient if needed
    this._orientArrow(obj.mesh, position, angle, distance);
    
    // Pulse effect
    if (this.config.pulse) {
      const scale = 1 + Math.sin(this.pulseOffset + angle) * 0.3;
      obj.mesh.scale.set(scale, scale, scale);
    }
  }
  
  updateBall(ballId, worldPos) {
    if (this.config.rotate) {
      this.rotationOffset += this.config.rotateSpeed;
    }
    
    if (this.config.pulse) {
      this.pulseOffset += this.config.pulseSpeed;
    }
    
    // Generate field points around ball
    const points = this._generateFieldPoints(worldPos);
    
    // Update each arrow
    points.forEach((point, index) => {
      const arrowId = `${ballId}-field-${index}`;
      
      if (this.has(arrowId)) {
        this.update(arrowId, {
          ballId,
          position: point.position,
          angle: point.angle,
          distance: point.distance
        });
      } else {
        this.add(arrowId, {
          ballId,
          position: point.position,
          angle: point.angle,
          distance: point.distance,
          ringIndex: point.ringIndex
        });
      }
    });
    
    // Remove old arrows if field changed
    const validIds = new Set(points.map((p, i) => `${ballId}-field-${i}`));
    for (const id of this.objects.keys()) {
      if (id.startsWith(`${ballId}-field-`) && !validIds.has(id)) {
        this.remove(id);
      }
    }
  }
  
  _generateFieldPoints(centerPos) {
    const points = [];
    const spacing = this.config.radius / this.config.rings;
    
    for (let ring = 1; ring <= this.config.rings; ring++) {
      const ringRadius = ring * spacing;
      const pointsInRing = this.config.pointsPerRing;
      
      for (let i = 0; i < pointsInRing; i++) {
        const angle = (i / pointsInRing) * Math.PI * 2 + this.rotationOffset;
        
        const x = centerPos.x + Math.cos(angle) * ringRadius;
        const y = centerPos.y + Math.sin(angle) * ringRadius;
        
        points.push({
          position: { x, y },
          angle: angle,
          distance: ringRadius,
          ringIndex: ring
        });
      }
    }
    
    return points;
  }
  
  removeBall(ballId) {
    const toRemove = [];
    for (const id of this.objects.keys()) {
      if (id.startsWith(`${ballId}-field-`)) {
        toRemove.push(id);
      }
    }
    toRemove.forEach(id => this.remove(id));
  }
  
  _getColorForBall(ballId, distance) {
    // Color by distance takes precedence
    if (this.config.colorByDistance) {
      const t = distance / this.config.radius;
      return this._interpolateColor(this.config.colorClose, this.config.colorFar, t);
    }
    
    // Per-ball colors
    if (this.config.perBallColors && this.config.ballColors) {
      const color = this.config.ballColors[ballId] || this.config.ballColors[String(ballId)];
      if (color !== undefined) return color;
    }
    
    return this.config.color;
  }
  
  _interpolateColor(color1, color2, t) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, t).getHex();
  }
  
  setConfig(config) {
    const needsRecreate = 
      config.rings !== undefined ||
      config.pointsPerRing !== undefined ||
      config.radius !== undefined ||
      config.arrowSize !== undefined ||
      config.arrowShape !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      this.clear();
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = this._getColorForBall(obj.ballId, obj.distance);
      obj.material.color.setHex(color);
      obj.material.opacity = this.config.opacity;
      obj.material.transparent = this.config.opacity < 1.0;
    }
  }
  
  clear() {
    super.clear();
    this.rotationOffset = 0;
    this.pulseOffset = 0;
  }
}