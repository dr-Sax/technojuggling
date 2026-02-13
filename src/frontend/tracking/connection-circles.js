/**
 * ConnectionCircles - Draws circles at midpoints between balls
 */
import { GeometryBase } from '../rendering/geometry-base.js';
import { GeometryPrimitives } from '../rendering/geometry-primitives.js';
import { MaterialFactory, MaterialBuilder } from '../rendering/material-factory.js';

export class ConnectionCircles extends GeometryBase {
  constructor(sceneManager, ballMedia = null) {
    super(sceneManager);
    this.ballMedia = ballMedia;
    this.routing = {};
    this.config = {
      color: 0xffffff,
      opacity: 1.0,
      lineWidth: 0.1,
      zIndex: 0.05,
      segments: 32,
      filled: false,
      perCircleColors: false,
      circleContents: [0xff0000, 0x00ff00, 0x0000ff]
    };
  }
  
  createGeometry(id, { p1, p2, content, index }) {
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const radius = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) / 2;
    
    if (this.config.filled) {
      return this._createFilled(cx, cy, radius, content, p1, p2, index);
    } else {
      return this._createRing(cx, cy, radius, content, p1, p2, index);
    }
  }
  
  _createFilled(cx, cy, radius, content, p1, p2, index) {
    const fillMat = this._getMaterial(content);
    const geometries = GeometryPrimitives.circle(radius, this.config.segments, this.config.lineWidth);
    
    const fillMesh = new THREE.Mesh(geometries.fill, fillMat);
    fillMesh.position.set(cx, cy, 0);
    this.scene.add(fillMesh);
    
    let perimMesh = null;
    if (geometries.perimeter) {
      const perimMat = MaterialFactory.basic({ color: 0xffffff, side: THREE.DoubleSide });
      perimMesh = new THREE.Mesh(geometries.perimeter, perimMat);
      perimMesh.position.set(cx, cy, 0.001);
      this.scene.add(perimMesh);
    }
    
    return {
      mesh: fillMesh, geometry: geometries.fill, material: fillMat,
      perimeterMesh: perimMesh, perimeterGeometry: geometries.perimeter,
      perimeterMaterial: perimMesh?.material,
      lastPos: { p1, p2 }, radius, content, index
    };
  }
  
  _createRing(cx, cy, radius, content, p1, p2, index) {
    const innerRad = Math.max(0.01, radius - this.config.lineWidth);
    const geo = GeometryPrimitives.ring(innerRad, radius, this.config.segments);
    
    const color = typeof content === 'number' ? content : this.config.color;
    const mat = new MaterialBuilder()
      .color(color)
      .opacity(this.config.opacity)
      .doubleSided()
      .additive()
      .build();
    
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, 0);
    
    return { mesh, geometry: geo, material: mat, lastPos: { p1, p2 }, radius, content, index };
  }
  
  _getMaterial(content) {
    if (typeof content === 'string' && this.ballMedia) {
      const element = this._getElementForStream(content);
      if (element) {
        try {
          return MaterialFactory.texture(element, {
            opacity: this.config.opacity,
            blending: THREE.AdditiveBlending
          });
        } catch (e) {
          console.warn('[ConnectionCircles] Failed to create texture material:', e);
        }
      }
    }
    
    const color = typeof content === 'number' ? content : this.config.color;
    return new MaterialBuilder()
      .color(color)
      .opacity(this.config.opacity)
      .doubleSided()
      .additive()
      .build();
  }
  
  _getElementForStream(streamName) {
    for (const [ballId, stream] of Object.entries(this.routing)) {
      if (stream === streamName) {
        const key = ballId.replace('ball_', '');
        return this.ballMedia.getElement(key);
      }
    }
    return null;
  }
  
  updateGeometry(id, { p1, p2, content, index }) {
    const obj = this.get(id);
    if (!obj) return;
    
    const threshold = 0.01;
    const moved = Math.abs(p1.x - obj.lastPos.p1.x) > threshold ||
                  Math.abs(p1.y - obj.lastPos.p1.y) > threshold ||
                  Math.abs(p2.x - obj.lastPos.p2.x) > threshold ||
                  Math.abs(p2.y - obj.lastPos.p2.y) > threshold;
    
    if (moved) this.add(id, { p1, p2, content, index });
  }
  
  /**
   * Update circle connections from ball positions
   */
  updateFromPositions(positions) {
    const ids = Object.keys(positions);
    if (ids.length < 2) {
      this.clear();
      return;
    }
    
    let index = 0;
    
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `circle-${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        const content = this.config.perCircleColors 
          ? this.config.circleContents[index % this.config.circleContents.length]
          : this.config.color;
        
        if (this.has(connId)) {
          this.update(connId, { p1, p2, content, index });
        } else {
          this.add(connId, { p1, p2, content, index });
        }
        index++;
      }
    }
    
    this.layerByRadius();
    
    // Remove circles for balls that no longer exist
    const validIds = new Set(ids);
    for (const id of this.objects.keys()) {
      const parts = id.replace('circle-', '').split('-');
      if (!validIds.has(parts[0]) || !validIds.has(parts[1])) {
        this.remove(id);
      }
    }
  }
  
  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.material?.map?.dispose();
    
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    
    this.objects.delete(id);
  }
  
  setConfig(config) {
    const needsRecreate = (config.filled !== undefined && config.filled !== this.config.filled) ||
                          (config.lineWidth !== undefined && Math.abs(config.lineWidth - this.config.lineWidth) > 0.01) ||
                          (config.segments !== undefined && config.segments !== this.config.segments);
    
    Object.assign(this.config, config);
    
    if (needsRecreate) {
      const snapshot = Array.from(this.objects.entries()).map(([id, obj]) => ({
        id, p1: obj.lastPos.p1, p2: obj.lastPos.p2, content: obj.content, index: obj.index
      }));
      this.clear();
      snapshot.forEach(s => this.add(s.id, { p1: s.p1, p2: s.p2, content: s.content, index: s.index }));
    } else {
      this._updateMaterials();
    }
  }
  
  _updateMaterials() {
    for (const obj of this.getAll()) {
      if (!this.config.perCircleColors && !obj.material.map && typeof obj.content === 'number') {
        obj.material.color.setHex(this.config.color);
      }
      obj.material.opacity = this.config.opacity;
      obj.material.transparent = this.config.opacity < 1.0;
    }
  }
  
  setRouting(routing) {
    this.routing = routing;
  }
  
  layerByRadius() {
    const objs = Array.from(this.objects.entries())
      .map(([id, obj]) => ({ id, obj }))
      .sort((a, b) => b.obj.radius - a.obj.radius);
    
    objs.forEach(({ obj }, i) => {
      obj.mesh.position.z = this.config.zIndex - (i * 0.01);
    });
  }
  
  clear() {
    super.clear();
    this.routing = {};
  }
}