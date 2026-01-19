/**
 * MediaObject - Base class for video and image rendering
 */
import { CONFIG } from '../core/config.js';
import { MaskShader } from './mask-shader.js';

export class MediaObject {
  constructor(sceneManager, audioProcessor, visualFX, objectId) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.visualFX = visualFX;
    this.objectId = objectId;
    
    this.element = null;
    this.mesh = null;
    this.material = null;
    this.texture = null;
    this.visible = false;
    this.locked = false;
    this.lastPosition = { x: 0, y: 0 };
    
    // Single source of truth for parameter defaults
    this.defaults = {
      scale: 1.0,
      rotation: 0,
      opacity: 1.0,
      zIndex: 0.1,
      hue: 0,
      saturation: 100,
      brightness: 100,
      contrast: 100,
      blur: 0,
      grayscale: 0,
      sepia: 0
    };
  }
  
  /**
   * Validate and merge parameters with defaults
   * Returns complete parameter set with all values defined
   */
  validateParameters(params) {
    const validated = { ...this.defaults, ...params };
    
    // Validate numeric ranges
    if (typeof validated.scale === 'number') {
      if (validated.scale < 0 || validated.scale > 100) {
        console.warn(`[${this.objectId}] Scale out of range: ${validated.scale}, clamping to 0-100`);
        validated.scale = Math.max(0, Math.min(100, validated.scale));
      }
    }
    
    if (typeof validated.opacity === 'number') {
      if (validated.opacity < 0 || validated.opacity > 1) {
        console.warn(`[${this.objectId}] Opacity out of range: ${validated.opacity}, clamping to 0-1`);
        validated.opacity = Math.max(0, Math.min(1, validated.opacity));
      }
    }
    
    // Check for string expressions that should be evaluated
    for (const [key, value] of Object.entries(validated)) {
      if (typeof value === 'string' && !isNaN(parseFloat(value))) {
        console.warn(`[${this.objectId}] Parameter '${key}' is string "${value}" but looks like a number - did you forget to evaluate it?`);
      }
    }
    
    return validated;
  }
  
  setPosition(worldX, worldY) {
    if (!this.mesh || this.locked) return;
    this.lastPosition = { x: worldX, y: worldY };
    this.mesh.position.set(worldX, worldY, this.mesh.position.z);
  }
  
  getPosition() {
    if (!this.mesh) return null;
    
    const position = this.mesh.position;
    const planeWidth = CONFIG.PLANE_WIDTH;
    const planeHeight = CONFIG.PLANE_HEIGHT;
    
    const normalizedY = -(position.x / planeWidth) + 0.5;
    const normalizedX = -(position.y / planeHeight) + 0.5;
    
    return {
      x: Math.max(0, Math.min(1, normalizedX)),
      y: Math.max(0, Math.min(1, normalizedY))
    };
  }
  
  setLocked(locked) {
    this.locked = locked;
  }
  
  setVisible(visible) {
    if (this.mesh) {
      this.mesh.visible = visible;
      this.visible = visible;
    }
  }
  
  updateMaskPoints(points) {
    MaskShader.updatePoints(this.material, points);
  }
  
  dispose() {
    if (this.mesh) {
      const webglScene = this.sceneManager.getWebGLScene();
      webglScene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.mesh.material) {
        this.mesh.material.dispose();
      }
    }
    
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    
    if (this.element) {
      this._cleanupElement();
      this.element = null;
    }
    
    this.audioProcessor.removeVideo(this.objectId);
    this.visualFX.removeVideo(this.objectId);
    
    this.mesh = null;
    this.material = null;
    this.visible = false;
  }
  
  _cleanupElement() {
    // Override in subclasses
  }
  
  _createMesh(zIndex, scale) {
    // Override in subclasses
  }
  
  applyParameters(params, perspectiveScale = 1.0) {
    // Override in subclasses
  }
}