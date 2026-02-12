/**
 * BallSpiderweb - Organic web-like connections between balls
 * 
 * Creates curved, organic-looking connections between balls
 * Like spider silk, neural networks, or organic tissue
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { MaterialBuilder } from '../rendering/material-factory.js';

export class BallSpiderweb extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    this.config = {
      mode: 'mesh',            // 'mesh' (all-to-all) or 'nearest' (limited connections)
      maxConnections: 3,       // Max connections per ball (for 'nearest' mode)
      maxDistance: 10,         // Max distance to connect
      
      // Curve properties
      curvature: 0.3,          // How much the line curves (0 = straight, 1 = very curved)
      curvePoints: 12,         // Smoothness of curve
      
      // Visual
      color: 0xffffff,
      opacity: 0.6,
      lineWidth: 0.05,         // Thickness of web strands
      zIndex: 0.04,
      
      // Animation
      animate: false,          // Animate curve movement
      animSpeed: 0.02,
      
      // Tension visualization
      showTension: false,      // Color by distance (closer = different color)
      tensionColorClose: 0x00ff00,
      tensionColorFar: 0xff0000,
      
      // Per-connection variation
      randomCurvature: 0.2,    // Random variation in curve amount
      
      // Gradient along strand
      gradient: false          // Fade opacity along strand
    };
    
    this.animationOffset = 0;
  }
  
  createGeometry(id, { p1, p2, curvature, colorOverride }) {
    // Calculate curve control point
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    
    // Perpendicular offset for curve
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Normalize perpendicular
    const perpX = -dy / dist;
    const perpY = dx / dist;
    
    // Control point offset (creates the curve)
    const offset = dist * curvature;
    const controlX = midX + perpX * offset;
    const controlY = midY + perpY * offset;
    
    // Create quadratic bezier curve
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(p1.x, p1.y, 0),
      new THREE.Vector3(controlX, controlY, 0),
      new THREE.Vector3(p2.x, p2.y, 0)
    );
    
    // Create tube geometry along curve
    const geometry = new THREE.TubeGeometry(
      curve, 
      this.config.curvePoints, 
      this.config.lineWidth, 
      6, 
      false
    );
    
    // Determine color
    let color = colorOverride || this.config.color;
    if (this.config.showTension && !colorOverride) {
      const normalizedDist = Math.min(dist / this.config.maxDistance, 1);
      color = this._interpolateColor(
        this.config.tensionColorClose,
        this.config.tensionColorFar,
        normalizedDist
      );
    }
    
    const material = new MaterialBuilder()
      .color(color)
      .opacity(this.config.opacity)
      .doubleSided()
      .build();
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = this.config.zIndex;
    
    return { 
      mesh, 
      geometry, 
      material, 
      lastPos: { p1, p2 },
      curvature,
      baseCurvature: curvature,
      distance: dist
    };
  }
  
  updateGeometry(id, { p1, p2 }) {
    const obj = this.get(id);
    if (!obj) return;
    
    // Check if moved significantly
    const threshold = 0.01;
    const moved = Math.abs(p1.x - obj.lastPos.p1.x) > threshold ||
                  Math.abs(p1.y - obj.lastPos.p1.y) > threshold ||
                  Math.abs(p2.x - obj.lastPos.p2.x) > threshold ||
                  Math.abs(p2.y - obj.lastPos.p2.y) > threshold;
    
    if (moved) {
      // Recreate with updated positions
      this.add(id, { 
        p1, 
        p2, 
        curvature: obj.baseCurvature,
        colorOverride: this.config.showTension ? null : obj.material.color.getHex()
      });
    } else if (this.config.animate) {
      // Animate curvature
      const animatedCurvature = obj.baseCurvature + 
        Math.sin(this.animationOffset + obj.distance) * 0.1;
      
      if (Math.abs(animatedCurvature - obj.curvature) > 0.01) {
        this.add(id, { 
          p1, 
          p2, 
          curvature: animatedCurvature,
          colorOverride: this.config.showTension ? null : obj.material.color.getHex()
        });
      }
    }
  }
  
  /**
   * Update connections between balls
   * Called from BallTrackingManager
   */
  updateConnections(positions) {
    if (this.config.animate) {
      this.animationOffset += this.config.animSpeed;
    }
    
    const ids = Object.keys(positions);
    
    if (this.config.mode === 'mesh') {
      this._updateMesh(positions, ids);
    } else if (this.config.mode === 'nearest') {
      this._updateNearest(positions, ids);
    }
  }
  
  _updateMesh(positions, ids) {
    const validConnIds = new Set();
    
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `web-${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        
        const dist = Math.sqrt(
          Math.pow(p2.x - p1.x, 2) + 
          Math.pow(p2.y - p1.y, 2)
        );
        
        // Only connect if within max distance
        if (dist <= this.config.maxDistance) {
          const curvature = this.config.curvature + 
            (Math.random() - 0.5) * this.config.randomCurvature;
          
          if (this.has(connId)) {
            this.update(connId, { p1, p2 });
          } else {
            this.add(connId, { p1, p2, curvature });
          }
          validConnIds.add(connId);
        }
      }
    }
    
    // Remove invalid connections
    for (const id of this.objects.keys()) {
      if (!validConnIds.has(id)) this.remove(id);
    }
  }
  
  _updateNearest(positions, ids) {
    const validConnIds = new Set();
    
    for (let i = 0; i < ids.length; i++) {
      const ballId = ids[i];
      const p1 = this.sceneManager.mapCameraToWorld(positions[ballId].x, positions[ballId].y);
      
      // Find nearest neighbors
      const neighbors = [];
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        
        const otherId = ids[j];
        const p2 = this.sceneManager.mapCameraToWorld(positions[otherId].x, positions[otherId].y);
        
        const dist = Math.sqrt(
          Math.pow(p2.x - p1.x, 2) + 
          Math.pow(p2.y - p1.y, 2)
        );
        
        if (dist <= this.config.maxDistance) {
          neighbors.push({ id: otherId, p2, dist });
        }
      }
      
      // Sort by distance and take closest N
      neighbors.sort((a, b) => a.dist - b.dist);
      const closest = neighbors.slice(0, this.config.maxConnections);
      
      // Create connections to closest
      closest.forEach(neighbor => {
        const connId = `web-${ballId}-${neighbor.id}`;
        const curvature = this.config.curvature + 
          (Math.random() - 0.5) * this.config.randomCurvature;
        
        if (this.has(connId)) {
          this.update(connId, { p1, p2: neighbor.p2 });
        } else {
          this.add(connId, { p1, p2: neighbor.p2, curvature });
        }
        validConnIds.add(connId);
      });
    }
    
    // Remove invalid connections
    for (const id of this.objects.keys()) {
      if (!validConnIds.has(id)) this.remove(id);
    }
  }
  
  removeBall(ballId) {
    // Remove all connections involving this ball
    const toRemove = [];
    for (const id of this.objects.keys()) {
      if (id.includes(`web-${ballId}-`) || id.includes(`-${ballId}`)) {
        toRemove.push(id);
      }
    }
    toRemove.forEach(id => this.remove(id));
  }
  
  _interpolateColor(color1, color2, t) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    return c1.lerp(c2, t).getHex();
  }
  
  setConfig(config) {
    const needsRecreate = 
      config.curvature !== undefined ||
      config.curvePoints !== undefined ||
      config.lineWidth !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      this.clear();
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      let color = this.config.color;
      
      if (this.config.showTension) {
        const normalizedDist = Math.min(obj.distance / this.config.maxDistance, 1);
        color = this._interpolateColor(
          this.config.tensionColorClose,
          this.config.tensionColorFar,
          normalizedDist
        );
      }
      
      obj.material.color.setHex(color);
      obj.material.opacity = this.config.opacity;
      obj.material.transparent = this.config.opacity < 1.0;
    }
  }
  
  clear() {
    super.clear();
    this.animationOffset = 0;
  }
}