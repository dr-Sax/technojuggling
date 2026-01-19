/**
 * VideoObject - WebGL shader-based video rendering
 */
import { MediaObject } from './media-object.js';
import { MaskShader } from './mask-shader.js';

export class VideoObject extends MediaObject {
  constructor(sceneManager, audioProcessor, visualFX, objectId) {
    super(sceneManager, audioProcessor, visualFX, objectId);
    this.videoElement = null;
  }
  
  createVideo(videoUrl, startTime = 0, endTime = null, zIndex = 0.1, scale = 1.0, timeOffset = 0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    if (this.mesh) {
      webglScene.remove(this.mesh);
      this.audioProcessor.removeVideo(this.objectId);
      this.visualFX.removeVideo(this.objectId);
    }
    
    this.videoElement = this._createVideoElement(videoUrl, startTime, endTime, timeOffset);
    this.element = this.videoElement;
    
    this.visualFX.addVideo(this.videoElement, this.objectId);
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
    const width = finalScale * 16;
    const height = finalScale * 9;
    
    const geometry = new THREE.PlaneGeometry(width, height);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, zIndex);
    
    webglScene.add(this.mesh);
    this.audioProcessor.addVideo(this.videoElement, this.objectId);
    
    this.visible = true;
    return this.videoElement;
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
  
  applyParameters(params, perspectiveScale = 1.0) {
    if (!this.element || !this.mesh || !this.videoElement) return;
    
    // Update time bounds
    if (params.start !== undefined && this.videoElement._startTime !== params.start) {
      this.videoElement._startTime = params.start;
      if (this.videoElement.currentTime < params.start) {
        this.videoElement.currentTime = params.start;
      }
    }
    
    if (params.end !== undefined) {
      this.videoElement._endTime = params.end;
    }
    
    if (params.speed !== undefined) {
      this.videoElement.playbackRate = Math.max(0.25, Math.min(4.0, params.speed));
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
    this.videoElement.style.filter = filters.join(' ');
    
    this.audioProcessor.applyParameters(this.objectId, params);
    this.visualFX.applyParameters(this.objectId, params, Date.now() / 1000);
    
    this._applyTransforms(params, perspectiveScale);
  }
  
  _applyTransforms(params, perspectiveScale) {
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    const finalScale = baseScale * perspectiveScale * (params.scale || 1.0);
    const width = finalScale * 16;
    const height = finalScale * 9;
    
    this.mesh.scale.set(width / (baseScale * 16), height / (baseScale * 9), 1);
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
  
  _cleanupElement() {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }
  }
}