/**
 * ModelBall - 3D model (.glb) rendering for ball tracking
 */
import { MediaObject } from './media-object.js';

export class ModelBall extends MediaObject {
  constructor(sceneManager, audioProcessor, visualFX, objectId) {
    super(sceneManager, audioProcessor, visualFX, objectId);
    this.model = null;
    this.loader = new THREE.GLTFLoader();
  }
  
  async createModel(modelUrl, zIndex = 0.1, scale = 1.0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    // Clean up existing model
    if (this.mesh) {
      webglScene.remove(this.mesh);
      this.disposeModel();
    }
    
    console.log(`[ModelBall] Loading ${this.objectId}: ${modelUrl}`);
    
    return new Promise((resolve, reject) => {
      this.loader.load(
        modelUrl,
        (gltf) => {
          this.model = gltf.scene;
          
          // Create container mesh for positioning
          this.mesh = new THREE.Group();
          this.mesh.add(this.model);
          this.mesh.position.set(0, 0, zIndex);
          
          // Apply initial scale
          this.model.scale.set(scale, scale, scale);
          
          webglScene.add(this.mesh);
          this.visible = true;
          
          console.log(`[ModelBall] ${this.objectId} loaded successfully`);
          resolve();
        },
        (progress) => {
          const percent = (progress.loaded / progress.total * 100).toFixed(0);
          console.log(`[ModelBall] ${this.objectId} loading: ${percent}%`);
        },
        (error) => {
          console.error(`[ModelBall] Failed to load ${this.objectId}:`, error);
          reject(error);
        }
      );
    });
  }
  
  applyParameters(params, perspectiveScale = 1.0) {
    if (!this.mesh || !this.model) return;
    
    // Validate and merge with defaults
    const validated = this.validateParameters(params);
    
    // Scale
    const finalScale = (validated.scale || 1.0) * perspectiveScale;
    this.model.scale.set(finalScale, finalScale, finalScale);
    
    // Z-index (depth)
    if (validated.zIndex !== undefined) {
      this.mesh.position.z = validated.zIndex;
    }
    
    // Rotation (Z-axis only for now)
    if (validated.rotation !== undefined) {
      this.model.rotation.z = validated.rotation * (Math.PI / 180);
    }
    
    // Opacity (traverse all materials in the model)
    if (validated.opacity !== undefined && validated.opacity < 1.0) {
      this.model.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.transparent = true;
          child.material.opacity = validated.opacity;
        }
      });
    }
    
    // Visibility
    this.mesh.visible = this.visible;
  }
  
  disposeModel() {
    if (this.model) {
      this.model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      this.model = null;
    }
  }
  
  dispose() {
    if (this.mesh) {
      const webglScene = this.sceneManager.getWebGLScene();
      webglScene.remove(this.mesh);
    }
    
    this.disposeModel();
    
    this.mesh = null;
    this.visible = false;
    
    console.log(`[ModelBall] ${this.objectId} disposed`);
  }
  
  _cleanupElement() {
    // No media element for 3D models
  }
}