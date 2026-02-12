/**
 * BallTrails (Refactored) - Using GeometryPrimitives and MaterialFactory
 * 
 * Demonstrates cleaner separation:
 * - GeometryPrimitives handles shape creation
 * - MaterialFactory/Builder handles material creation
 * - This class focuses only on the trail logic and positioning
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialBuilder, ColorUtils } from '../rendering/material-factory.js';

export class BallTrails extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    this.config = {
      count: 5,
      maxDelay: 0.5,
      radiusRange: [0.5, 2.0],
      sides: 6,
      color: 0x00ffff,
      opacity: 0.6,
      zIndex: 0.02,
      perimeterWidth: 0.1,
      perBallColors: false,
      ballColors: {},
      gradient: false
    };
    this.positionHistory = new Map();
  }
  
  createGeometry(id, { ballId, index, position }) {
    const radiusFactor = index / (this.config.count - 1);
    const radius = this.config.radiusRange[0] + 
                   (this.config.radiusRange[1] - this.config.radiusRange[0]) * radiusFactor;
    
    // Determine color using ColorUtils
    const color = this._getColorForTrail(ballId, radiusFactor);
    
    // Use GeometryPrimitives to create polygon with perimeter
    const geometries = GeometryPrimitives.polygon(
      radius, 
      this.config.sides, 
      this.config.perimeterWidth
    );
    
    // Use MaterialBuilder for the fill
    const material = new MaterialBuilder()
      .color(color)
      .opacity(this.config.opacity * (1 - radiusFactor * 0.5))
      .doubleSided()
      .build();
    
    const mesh = new THREE.Mesh(geometries.fill, material);
    mesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001);
    
    // Create white perimeter if exists
    let perimeterMesh = null;
    if (geometries.perimeter) {
      const perimeterMaterial = new MaterialBuilder()
        .color(0xffffff)
        .doubleSided()
        .build();
      
      perimeterMesh = new THREE.Mesh(geometries.perimeter, perimeterMaterial);
      perimeterMesh.position.set(
        position.x, 
        position.y, 
        this.config.zIndex - index * 0.001 + 0.0001
      );
      this.scene.add(perimeterMesh);
    }
    
    return { 
      mesh, 
      geometry: geometries.fill,
      material, 
      perimeterMesh,
      perimeterGeometry: geometries.perimeter,
      perimeterMaterial: perimeterMesh?.material,
      ballId, 
      index, 
      radius 
    };
  }
  
  /**
   * Extract color determination logic
   */
  _getColorForTrail(ballId, radiusFactor) {
    // Per-ball colors take precedence
    if (this.config.perBallColors && this.config.ballColors) {
      const ballColorConfig = this.config.ballColors[ballId] || 
                              this.config.ballColors[String(ballId)];
      
      if (ballColorConfig !== undefined) {
        // Gradient per ball
        if (Array.isArray(ballColorConfig) && ballColorConfig.length === 2) {
          return ColorUtils.interpolate(
            ballColorConfig[0], 
            ballColorConfig[1], 
            radiusFactor
          );
        }
        // Single color per ball
        return ballColorConfig;
      }
    }
    
    // Global gradient
    if (this.config.gradient && 
        Array.isArray(this.config.color) && 
        this.config.color.length === 2) {
      return ColorUtils.interpolate(
        this.config.color[0], 
        this.config.color[1], 
        radiusFactor
      );
    }
    
    // Default color
    return this.config.color;
  }
  
  updateGeometry(id, { ballId, index, position }) {
    const obj = this.get(id);
    if (obj) {
      obj.mesh.position.set(position.x, position.y, obj.mesh.position.z);
      if (obj.perimeterMesh) {
        obj.perimeterMesh.position.set(position.x, position.y, obj.perimeterMesh.position.z);
      }
    }
  }
  
  updateBall(ballId, worldPos) {
    const now = Date.now() / 1000;
    
    if (!this.positionHistory.has(ballId)) {
      this.positionHistory.set(ballId, []);
    }
    
    const history = this.positionHistory.get(ballId);
    history.push({ pos: { ...worldPos }, time: now });
    
    // Maintain history window
    while (history.length > 0 && history[0].time < now - this.config.maxDelay) {
      history.shift();
    }
    
    // Create/update trail polygons (skip index 0)
    for (let i = 1; i < this.config.count; i++) {
      const delay = (i / (this.config.count - 1)) * this.config.maxDelay;
      const targetTime = now - delay;
      const position = this._getPositionAtTime(history, targetTime);
      
      const trailId = `${ballId}-trail-${i}`;
      if (this.has(trailId)) {
        this.update(trailId, { ballId, index: i, position });
      } else {
        this.add(trailId, { ballId, index: i, position });
      }
    }
  }
  
  _getPositionAtTime(history, targetTime) {
    if (history.length === 0) return { x: 0, y: 0 };
    if (history.length === 1) return history[0].pos;
    
    for (let i = 0; i < history.length - 1; i++) {
      if (history[i].time <= targetTime && history[i + 1].time >= targetTime) {
        const t = (targetTime - history[i].time) / (history[i + 1].time - history[i].time);
        return {
          x: history[i].pos.x + (history[i + 1].pos.x - history[i].pos.x) * t,
          y: history[i].pos.y + (history[i + 1].pos.y - history[i].pos.y) * t
        };
      }
    }
    
    return history[history.length - 1].pos;
  }
  
  removeBall(ballId) {
    for (let i = 0; i < this.config.count; i++) {
      this.remove(`${ballId}-trail-${i}`);
    }
    this.positionHistory.delete(ballId);
  }
  
  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    
    this.objects.delete(id);
  }
  
  setConfig(config) {
    const needsRecreate = config.count !== undefined || 
                          config.sides !== undefined ||
                          config.radiusRange !== undefined ||
                          config.perimeterWidth !== undefined;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      const ballIds = new Set();
      for (const obj of this.getAll()) ballIds.add(obj.ballId);
      this.clear();
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      const radiusFactor = obj.index / (this.config.count - 1);
      const color = this._getColorForTrail(obj.ballId, radiusFactor);
      
      obj.material.color.setHex(color);
      obj.material.opacity = this.config.opacity * (1 - radiusFactor * 0.5);
    }
  }

  clear() {
    super.clear();
    this.positionHistory.clear();
  }
}  
