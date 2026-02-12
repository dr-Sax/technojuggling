/**
 * GeometryBase - Handles all THREE.js object lifecycle
 * Inherit from this to create new geometric visualizations
 */
export class GeometryBase {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.scene = sceneManager.getWebGLScene();
    this.objects = new Map(); // id -> {mesh, material, geometry, data}
  }
  
  // Override these in subclasses
  createGeometry(id, params) { throw new Error('Must implement createGeometry'); }
  updateGeometry(id, params) { throw new Error('Must implement updateGeometry'); }
  
  // Common lifecycle - no need to override
  add(id, params) {
    this.remove(id);
    const obj = this.createGeometry(id, params);
    if (obj) {
      this.scene.add(obj.mesh);
      this.objects.set(id, obj);
    }
    return obj;
  }
  
  update(id, params) {
    const obj = this.objects.get(id);
    if (obj) this.updateGeometry(id, params);
  }
  
  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.material?.map?.dispose();
    this.objects.delete(id);
  }
  
  clear() {
    for (const id of this.objects.keys()) this.remove(id);
  }
  
  get(id) { return this.objects.get(id); }
  getAll() { return Array.from(this.objects.values()); }
  has(id) { return this.objects.has(id); }
}