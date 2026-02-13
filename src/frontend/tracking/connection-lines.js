/**
 * ConnectionLines - Draws lines between balls
 * Mesh mode: all-to-all, Sequential mode: loop through sorted IDs
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialFactory } from '../rendering/material-factory.js';

export class ConnectionLines extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    this.config = {
      color: 0xffffff,
      opacity: 1.0,
      lineWidth: 0.1,
      zIndex: 0.05
    };
  }
  
  createGeometry(id, { p1, p2 }) {
    const geometry = GeometryPrimitives.tube(
      new THREE.Vector3(p1.x, p1.y, 0),
      new THREE.Vector3(p2.x, p2.y, 0),
      this.config.lineWidth,
      8
    );
    
    const material = MaterialFactory.basic({
      color: this.config.color,
      opacity: this.config.opacity,
      transparent: this.config.opacity < 1.0
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = this.config.zIndex;
    
    return { mesh, geometry, material, lastPos: { p1, p2 } };
  }
  
  updateGeometry(id, { p1, p2 }) {
    const obj = this.get(id);
    if (!obj) return;
    
    const threshold = 0.01;
    const moved = Math.abs(p1.x - obj.lastPos.p1.x) > threshold ||
                  Math.abs(p1.y - obj.lastPos.p1.y) > threshold ||
                  Math.abs(p2.x - obj.lastPos.p2.x) > threshold ||
                  Math.abs(p2.y - obj.lastPos.p2.y) > threshold;
    
    if (moved) this.add(id, { p1, p2 });
  }
  
  /**
   * Update all-to-all mesh connections from ball positions
   */
  updateMesh(positions) {
    const ids = Object.keys(positions);
    const validConnIds = new Set();
    
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        
        if (this.has(connId)) {
          this.update(connId, { p1, p2 });
        } else {
          this.add(connId, { p1, p2 });
        }
        validConnIds.add(connId);
      }
    }
    
    for (const id of this.objects.keys()) {
      if (!validConnIds.has(id)) this.remove(id);
    }
  }
  
  /**
   * Update sequential (loop) connections from ball positions
   */
  updateSequential(positions) {
    const ids = Object.keys(positions);
    if (ids.length < 2) {
      this.clear();
      return;
    }
    
    const sorted = ids.sort();
    const validConnIds = new Set();
    
    for (let i = 0; i < sorted.length; i++) {
      const next = (i + 1) % sorted.length;
      const connId = `${sorted[i]}-${sorted[next]}`;
      const p1 = this.sceneManager.mapCameraToWorld(positions[sorted[i]].x, positions[sorted[i]].y);
      const p2 = this.sceneManager.mapCameraToWorld(positions[sorted[next]].x, positions[sorted[next]].y);
      
      if (this.has(connId)) {
        this.update(connId, { p1, p2 });
      } else {
        this.add(connId, { p1, p2 });
      }
      validConnIds.add(connId);
    }
    
    for (const id of this.objects.keys()) {
      if (!validConnIds.has(id)) this.remove(id);
    }
  }
  
  setConfig(config) {
    const needsRecreate = config.lineWidth !== undefined && 
                          Math.abs(config.lineWidth - this.config.lineWidth) > 0.01;
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      const snapshot = Array.from(this.objects.entries()).map(([id, obj]) => ({
        id, p1: obj.lastPos.p1, p2: obj.lastPos.p2
      }));
      this.clear();
      snapshot.forEach(s => this.add(s.id, { p1: s.p1, p2: s.p2 }));
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      obj.material.color.setHex(this.config.color);
      obj.material.opacity = this.config.opacity;
      obj.material.transparent = this.config.opacity < 1.0;
    }
  }
  
  clear() {
    super.clear();
  }
}