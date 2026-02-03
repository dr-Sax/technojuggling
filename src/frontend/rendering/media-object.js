/**
 * MediaObject - Unified video and image rendering with WebGL shaders
 * Replaces: VideoObject, ImageObject, base MediaObject
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
    this.mediaType = null; // 'video' | 'image'
    this.visible = false;
    this.locked = false;
    this.lastPosition = { x: 0, y: 0 };
    
    // Parameter defaults
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
   * Detect media type from URL
   */
  getMediaType(url) {
    const extension = url.split('.').pop().toLowerCase().split('?')[0];
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
    
    if (imageExtensions.includes(extension)) {
      return 'image';
    }
    return 'video';
  }
  
  /**
   * Create media (video or image) - auto-detects type
   */
  async createMedia(url, startTime = 0, endTime = null, zIndex = 0.1, scale = 1.0, timeOffset = 0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    // Clean up existing
    if (this.mesh) {
      webglScene.remove(this.mesh);
      this.disposeMedia();
    }
    
    this.mediaType = this.getMediaType(url);
    
    if (this.mediaType === 'video') {
      return this.createVideo(url, startTime, endTime, zIndex, scale, timeOffset);
    } else {
      return this.createImage(url, zIndex, scale);
    }
  }
  
  /**
   * Create video element and mesh
   */
  createVideo(videoUrl, startTime = 0, endTime = null, zIndex = 0.1, scale = 1.0, timeOffset = 0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    this.element = this._createVideoElement(videoUrl, startTime, endTime, timeOffset);
    
    // Wait for video metadata to get actual dimensions
    this.element.addEventListener('loadedmetadata', () => {
      const videoWidth = this.element.videoWidth || 1920;
      const videoHeight = this.element.videoHeight || 1080;
      const aspect = videoWidth / videoHeight;
      
      this.visualFX.addVideo(this.element, this.objectId);
      const baseMaterial = this.visualFX.getMaterial(this.objectId);
      
      const fragmentShader = MaskShader.addToShader(baseMaterial.fragmentShader);
      
      this.material = new THREE.ShaderMaterial({
        uniforms: baseMaterial.uniforms,
        vertexShader: baseMaterial.vertexShader,
        fragmentShader: fragmentShader,
        transparent: true
      });
      
      MaskShader.initUniforms(this.material);
      
      const baseScale = this.sceneManager.getPlaneHeight() / 480;
      const finalScale = baseScale * scale;
      const refHeight = finalScale * 9;
      const width = refHeight * aspect;
      const height = refHeight;
      
      const geometry = new THREE.PlaneGeometry(width, height);
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.position.set(0, 0, zIndex);
      
      webglScene.add(this.mesh);
      this.audioProcessor.addVideo(this.element, this.objectId);
      
      this.visible = true;
    });
    
    return this.element;
  }
  
  /**
   * Create image element and mesh
   */
  createImage(imageUrl, zIndex = 0.1, scale = 1.0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.crossOrigin = 'anonymous';
      img.style.imageRendering = 'high-quality';
      
      this.element = img;
      
      img.onload = () => {
        const imgWidth = img.naturalWidth || img.width || 1920;
        const imgHeight = img.naturalHeight || img.height || 1080;
        const aspect = imgWidth / imgHeight;
        
        this.texture = new THREE.Texture(img);
        this.texture.needsUpdate = true;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        
        const baseUniforms = {
          videoTexture: { value: this.texture },
          time: { value: 0 }
        };
        
        const vertexShader = `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `;
        
        const baseFragmentShader = `
          uniform sampler2D videoTexture;
          varying vec2 vUv;
          void main() {
            vec4 color = texture2D(videoTexture, vUv);
            gl_FragColor = color;
          }
        `;
        
        const fragmentShader = MaskShader.addToShader(baseFragmentShader);
        
        this.material = new THREE.ShaderMaterial({
          uniforms: baseUniforms,
          vertexShader: vertexShader,
          fragmentShader: fragmentShader,
          transparent: true
        });
        
        MaskShader.initUniforms(this.material);
        
        const baseScale = this.sceneManager.getPlaneHeight() / 480;
        const finalScale = baseScale * scale;
        const refHeight = finalScale * 9;
        const width = refHeight * aspect;
        const height = refHeight;
        
        const geometry = new THREE.PlaneGeometry(width, height);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.set(0, 0, zIndex);
        
        webglScene.add(this.mesh);
        this.visible = true;
        
        resolve();
      };
      
      img.onerror = () => {
        console.error(`Failed to load image: ${imageUrl}`);
        reject(new Error(`Failed to load image: ${imageUrl}`));
      };
    });
  }
  
  /**
   * Apply parameters (works for both video and image)
   */
  applyParameters(params, perspectiveScale = 1.0) {
    if (!this.element || !this.mesh) return;
    
    const validated = this.validateParameters(params);
    
    if (this.mediaType === 'video') {
      this._applyVideoParameters(validated, perspectiveScale);
    } else {
      this._applyImageParameters(validated, perspectiveScale);
    }
  }
  
  _applyVideoParameters(params, perspectiveScale) {
    // Update time bounds
    if (params.start !== undefined && this.element._startTime !== params.start) {
      this.element._startTime = params.start;
      if (this.element.currentTime < params.start) {
        this.element.currentTime = params.start;
      }
    }
    
    if (params.end !== undefined) {
      this.element._endTime = params.end;
    }
    
    // Update playback speed
    if (params.speed !== undefined) {
      this.element.playbackRate = Math.max(0.25, Math.min(4.0, params.speed));
    }
    
    // CSS filters
    const filters = [];
    if (params.hue !== undefined) filters.push(`hue-rotate(${params.hue}deg)`);
    if (params.saturation !== undefined) filters.push(`saturate(${params.saturation}%)`);
    if (params.brightness !== undefined) filters.push(`brightness(${params.brightness}%)`);
    if (params.contrast !== undefined) filters.push(`contrast(${params.contrast}%)`);
    if (params.blur !== undefined && params.blur > 0) filters.push(`blur(${params.blur}px)`);
    if (params.grayscale !== undefined && params.grayscale > 0) filters.push(`grayscale(${params.grayscale}%)`);
    if (params.sepia !== undefined && params.sepia > 0) filters.push(`sepia(${params.sepia}%)`);
    this.element.style.filter = filters.join(' ');
    
    // Audio effects
    this.audioProcessor.applyParameters(this.objectId, params);
    
    // Visual effects
    this.visualFX.applyParameters(this.objectId, params, Date.now() / 1000);
    
    // Transform
    this._applyTransforms(params, perspectiveScale);
  }
  
  _applyImageParameters(params, perspectiveScale) {
    // Images don't have time-based params, just transforms
    this._applyTransforms(params, perspectiveScale);
    
    // Mask shader parameters
    if (this.material && this.material.uniforms) {
      MaskShader.applyParameters(this.material, params);
    }
  }
  
  _applyTransforms(params, perspectiveScale) {
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    const finalScale = baseScale * perspectiveScale * (params.scale || 1.0);
    
    // Get original geometry dimensions
    const originalWidth = this.mesh.geometry.parameters.width;
    const originalHeight = this.mesh.geometry.parameters.height;
    
    // Calculate aspect-aware scaling
    let width, height;
    if (this.mediaType === 'video') {
      width = finalScale * 16;
      height = finalScale * 9;
    } else {
      const img = this.element;
      const imgWidth = img.naturalWidth || img.width || 1920;
      const imgHeight = img.naturalHeight || img.height || 1080;
      const aspect = imgWidth / imgHeight;
      const refHeight = finalScale * 9;
      width = refHeight * aspect;
      height = refHeight;
    }
    
    this.mesh.scale.set(width / originalWidth, height / originalHeight, 1);
    this.mesh.position.z = params.zIndex !== undefined ? params.zIndex : 0.1;
    
    if (params.rotation !== undefined) {
      this.mesh.rotation.z = params.rotation * (Math.PI / 180);
    }
    
    if (this.material) {
      this.material.opacity = params.opacity !== undefined ? params.opacity : 1.0;
      this.material.transparent = this.material.opacity < 1.0;
      
      if (this.material.uniforms) {
        MaskShader.applyParameters(this.material, params);
      }
    }
  }
  
  /**
   * Validate and merge parameters with defaults
   */
  validateParameters(params) {
    const validated = { ...this.defaults, ...params };
    
    if (typeof validated.scale === 'number') {
      if (validated.scale < 0 || validated.scale > 100) {
        validated.scale = Math.max(0, Math.min(100, validated.scale));
      }
    }
    
    if (typeof validated.opacity === 'number') {
      if (validated.opacity < 0 || validated.opacity > 1) {
        validated.opacity = Math.max(0, Math.min(1, validated.opacity));
      }
    }
    
    return validated;
  }
  
  _createVideoElement(videoUrl, startTime, endTime, timeOffset) {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop = false;
    video.muted = false;
    video.playsInline = true;
    video.src = videoUrl;
    
    video._startTime = startTime;
    video._endTime = endTime;
    video._timeOffset = timeOffset;
    video._hasSeenData = false;
    
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = startTime + timeOffset;
    });
    
    video.addEventListener('loadeddata', () => {
      if (!video._hasSeenData) {
        video._hasSeenData = true;
        const targetTime = startTime + timeOffset;
        
        if (Math.abs(video.currentTime - targetTime) > 0.1) {
          video.currentTime = targetTime;
        }
        
        video.play().catch(err => console.warn('Video play failed:', err));
      }
    });
    
    video.ontimeupdate = () => {
      if (endTime !== null) {
        const effectiveEnd = endTime + video._timeOffset;
        if (video.currentTime >= effectiveEnd) {
          video.currentTime = video._startTime + video._timeOffset;
        }
      }
    };
    
    return video;
  }
  
  setPosition(worldX, worldY) {
    if (!this.mesh || this.locked) return;
    this.lastPosition = { x: worldX, y: worldY };
    this.mesh.position.set(worldX, worldY, this.mesh.position.z);
  }
  
  getPosition() {
    if (!this.mesh) return null;
    
    const position = this.mesh.position;
    const normalizedY = -(position.x / CONFIG.PLANE_HEIGHT) + 0.5;
    const normalizedX = -(position.y / CONFIG.PLANE_WIDTH) + 0.5;
    
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
  
  disposeMedia() {
    if (this.mediaType === 'video' && this.element) {
      this.element.pause();
      this.element.src = '';
    }
    
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
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
    
    this.disposeMedia();
    this.element = null;
    
    this.audioProcessor.removeVideo(this.objectId);
    this.visualFX.removeVideo(this.objectId);
    
    this.mesh = null;
    this.material = null;
    this.visible = false;
  }
}