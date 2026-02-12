/**
 * MaterialFactory - Builder pattern for creating THREE.js materials
 * Inspired by the Stemkoski/Pascale graphics framework approach
 * 
 * Philosophy: Centralize material creation with consistent defaults
 * Handles video/image textures, colors, transparency, blending
 */

export class MaterialFactory {
  /**
   * Create a basic colored material
   * @param {object} config - {color, opacity, transparent, side, blending}
   * @returns {THREE.MeshBasicMaterial}
   */
  static basic(config = {}) {
    const defaults = {
      color: 0xffffff,
      opacity: 1.0,
      transparent: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    
    const settings = { ...defaults, ...config };
    settings.transparent = settings.transparent || settings.opacity < 1.0;
    
    return new THREE.MeshBasicMaterial(settings);
  }
  
  /**
   * Create a textured material from video or image element
   * @param {HTMLVideoElement|HTMLImageElement} element - Media element
   * @param {object} config - Additional material properties
   * @returns {THREE.MeshBasicMaterial}
   */
  static texture(element, config = {}) {
    let texture;
    
    if (element instanceof HTMLVideoElement) {
      texture = new THREE.VideoTexture(element);
      // Auto-play if paused
      if (element.paused) {
        element.play().catch(() => {});
      }
    } else if (element instanceof HTMLImageElement) {
      texture = new THREE.Texture(element);
      texture.needsUpdate = true;
    } else {
      throw new Error('Element must be HTMLVideoElement or HTMLImageElement');
    }
    
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    
    const defaults = {
      map: texture,
      transparent: true,
      opacity: 1.0,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    
    return new THREE.MeshBasicMaterial({ ...defaults, ...config });
  }
  
  /**
   * Create material with additive blending (good for glowing effects)
   * @param {object} config - Material properties
   * @returns {THREE.MeshBasicMaterial}
   */
  static additive(config = {}) {
    return this.basic({
      ...config,
      blending: THREE.AdditiveBlending,
      transparent: true
    });
  }
  
  /**
   * Create material with multiply blending
   * @param {object} config - Material properties
   * @returns {THREE.MeshBasicMaterial}
   */
  static multiply(config = {}) {
    return this.basic({
      ...config,
      blending: THREE.MultiplyBlending,
      transparent: true
    });
  }
  
  /**
   * Dispose of a material and its textures properly
   * @param {THREE.Material} material - Material to dispose
   */
  static dispose(material) {
    if (!material) return;
    
    if (material.map) {
      material.map.dispose();
    }
    material.dispose();
  }
}

/**
 * MaterialBuilder - Fluent builder interface for complex materials
 * 
 * Example usage:
 *   const mat = new MaterialBuilder()
 *     .color(0xff0000)
 *     .opacity(0.8)
 *     .additive()
 *     .build();
 */
export class MaterialBuilder {
  constructor() {
    this.config = {
      color: 0xffffff,
      opacity: 1.0,
      transparent: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending
    };
    this._texture = null;
  }
  
  color(value) {
    this.config.color = value;
    return this;
  }
  
  opacity(value) {
    this.config.opacity = value;
    this.config.transparent = value < 1.0;
    return this;
  }
  
  transparent(value = true) {
    this.config.transparent = value;
    return this;
  }
  
  side(value) {
    this.config.side = value;
    return this;
  }
  
  doubleSided() {
    this.config.side = THREE.DoubleSide;
    return this;
  }
  
  frontSided() {
    this.config.side = THREE.FrontSide;
    return this;
  }
  
  backSided() {
    this.config.side = THREE.BackSide;
    return this;
  }
  
  additive() {
    this.config.blending = THREE.AdditiveBlending;
    this.config.transparent = true;
    return this;
  }
  
  multiply() {
    this.config.blending = THREE.MultiplyBlending;
    this.config.transparent = true;
    return this;
  }
  
  subtractive() {
    this.config.blending = THREE.SubtractiveBlending;
    this.config.transparent = true;
    return this;
  }
  
  texture(element) {
    this._texture = element;
    return this;
  }
  
  build() {
    if (this._texture) {
      return MaterialFactory.texture(this._texture, this.config);
    }
    return MaterialFactory.basic(this.config);
  }
}

/**
 * ColorUtils - Helper utilities for color manipulation
 */
export class ColorUtils {
  /**
   * Interpolate between two colors
   * @param {number} color1 - First color (hex)
   * @param {number} color2 - Second color (hex)
   * @param {number} factor - Interpolation factor (0-1)
   * @returns {number} Interpolated color
   */
  static interpolate(color1, color2, factor) {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;
    
    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;
    
    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);
    
    return (r << 16) | (g << 8) | b;
  }
  
  /**
   * Create gradient array between colors
   * @param {number[]} colors - Array of hex colors
   * @param {number} steps - Number of steps in gradient
   * @returns {number[]} Array of interpolated colors
   */
  static gradient(colors, steps) {
    if (colors.length < 2) return colors;
    
    const result = [];
    const segmentSteps = Math.floor(steps / (colors.length - 1));
    
    for (let i = 0; i < colors.length - 1; i++) {
      for (let j = 0; j < segmentSteps; j++) {
        const factor = j / segmentSteps;
        result.push(this.interpolate(colors[i], colors[i + 1], factor));
      }
    }
    
    result.push(colors[colors.length - 1]);
    return result;
  }
  
  /**
   * Convert RGB to hex
   * @param {number} r - Red (0-255)
   * @param {number} g - Green (0-255)
   * @param {number} b - Blue (0-255)
   * @returns {number} Hex color
   */
  static rgbToHex(r, g, b) {
    return (r << 16) | (g << 8) | b;
  }
  
  /**
   * Convert hex to RGB
   * @param {number} hex - Hex color
   * @returns {{r: number, g: number, b: number}}
   */
  static hexToRgb(hex) {
    return {
      r: (hex >> 16) & 0xff,
      g: (hex >> 8) & 0xff,
      b: hex & 0xff
    };
  }
}