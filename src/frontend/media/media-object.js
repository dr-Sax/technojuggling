/**
 * MediaObject - Unified video and image rendering on tracked balls.
 * 
 * Accepts a pre-loaded DOM element (from MediaPool) via attachElement(),
 * or can create its own from a URL via createMedia() as fallback.
 * One creation path — no double-creation.
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
    this.mediaType = null;
    this.visible = false;
    this.locked = false;
    this.lastPosition = { x: 0, y: 0 };
  }
  
  /**
   * Primary creation path: attach a pre-loaded element from MediaPool.
   * Configures playback (start/end/loop) and builds the Three.js mesh.
   */
  async attachElement(element, type, config = {}) {
    this.dispose();
    
    this.mediaType = type; // 'video' | 'image'
    this.element = element;
    
    const { startTime = 0, endTime = null, zIndex = 0.1, scale = 1.0, timeOffset = 0 } = config;
    
    if (type === 'video') {
      this._configureVideoPlayback(element, startTime, endTime, timeOffset);
      
      // If metadata already loaded, create mesh immediately
      if (element.readyState >= 1) {
        this._createMesh(element.videoWidth || 1920, element.videoHeight || 1080, zIndex, scale, true);
        this.visible = true;
      } else {
        await new Promise((resolve) => {
          element.addEventListener('loadedmetadata', () => {
            this._createMesh(element.videoWidth || 1920, element.videoHeight || 1080, zIndex, scale, true);
            this.visible = true;
            resolve();
          }, { once: true });
        });
      }
    } else {
      // Image — should already be loaded from MediaPool
      if (element.complete && element.naturalWidth) {
        this._createMesh(element.naturalWidth || 1920, element.naturalHeight || 1080, zIndex, scale, false);
        this.visible = true;
      } else {
        await new Promise((resolve, reject) => {
          element.onload = () => {
            this._createMesh(element.naturalWidth || 1920, element.naturalHeight || 1080, zIndex, scale, false);
            this.visible = true;
            resolve();
          };
          element.onerror = () => reject(new Error(`Failed to load image`));
        });
      }
    }
  }
  
  /**
   * Configure video playback: start/end times, looping, offset.
   * Applied to an existing video element (from MediaPool).
   */
  _configureVideoPlayback(v, start, end, offset) {
    v.muted = false;
    v._startTime = start;
    v._endTime = end;
    v._timeOffset = offset;
    
    // Loop within video file's start/end — these are absolute video timestamps,
    // independent of the clock offset
    v.ontimeupdate = () => {
      if (end !== null && v.currentTime >= end) {
        v.currentTime = start;
      }
    };
    
    // Initial seek: start at videoStart, then shift by offset within the clip window.
    // offset shifts WHEN in the loop we start (clock phase), not WHERE in the file.
    const doSeek = () => {
      const clipDuration = end - start;
      const offsetIntoClip = clipDuration > 0
        ? ((offset % clipDuration) + clipDuration) % clipDuration
        : 0;
      v.currentTime = start + offsetIntoClip;
      v.play().catch(() => {});
    };

    if (v.readyState >= 2) {
      doSeek();
    } else {
      v.addEventListener('loadeddata', doSeek, { once: true });
    }
  }
  
  _createMesh(width, height, zIndex, scale, isVideo) {
    const aspect = width / height;
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    const finalScale = baseScale * scale;
    const w = finalScale * 9 * aspect;
    const h = finalScale * 9;
    
    if (isVideo) {
      this.visualFX.addVideo(this.element, this.objectId);
      const baseMat = this.visualFX.getMaterial(this.objectId);
      this.material = new THREE.ShaderMaterial({
        uniforms: baseMat.uniforms,
        vertexShader: baseMat.vertexShader,
        fragmentShader: MaskShader.addToShader(baseMat.fragmentShader),
        transparent: true
      });
      this.audioProcessor.addVideo(this.element, this.objectId);
    } else {
      this.texture = new THREE.Texture(this.element);
      this.texture.needsUpdate = true;
      this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
      this.material = new THREE.ShaderMaterial({
        uniforms: { 
          videoTexture: { value: this.texture }, 
          time: { value: 0 },
          opacity: { value: 1.0 }
        },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: MaskShader.addToShader(
          `uniform sampler2D videoTexture;
           uniform float opacity;
           varying vec2 vUv;
           void main() {
             vec2 uv = vUv;
             vec4 color = texture2D(videoTexture, uv);
             color.a *= opacity;
             gl_FragColor = color;
           }`
        ),
        transparent: true
      });
    }
    
    MaskShader.initUniforms(this.material);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material);
    this.mesh.position.set(0, 0, zIndex);
    this.sceneManager.getWebGLScene().add(this.mesh);
  }
  
  applyParameters(params, perspectiveScale = 1.0) {
    if (!this.element || !this.mesh) return;
    
    if (this.mediaType === 'video') {
      if (params.start !== undefined) {
        this.element._startTime = params.start;
        if (this.element.currentTime < params.start) this.element.currentTime = params.start;
      }
      if (params.end !== undefined) this.element._endTime = params.end;
      if (params.speed !== undefined) this.element.playbackRate = Math.max(0.25, Math.min(4.0, params.speed));
      
      const filters = [];
      if (params.hue) filters.push(`hue-rotate(${params.hue}deg)`);
      if (params.saturation) filters.push(`saturate(${params.saturation}%)`);
      if (params.brightness) filters.push(`brightness(${params.brightness}%)`);
      if (params.contrast) filters.push(`contrast(${params.contrast}%)`);
      if (params.blur > 0) filters.push(`blur(${params.blur}px)`);
      if (params.grayscale > 0) filters.push(`grayscale(${params.grayscale}%)`);
      if (params.sepia > 0) filters.push(`sepia(${params.sepia}%)`);
      this.element.style.filter = filters.join(' ');
      
      this.audioProcessor.applyParameters(this.objectId, params);
      this.visualFX.applyParameters(this.objectId, params, Date.now() / 1000);
    }
    
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    const finalScale = baseScale * perspectiveScale * (params.scale || 1.0);
    const aspect = (this.mediaType === 'video') ? 16/9 : (this.element.naturalWidth || this.element.width || 1920) / (this.element.naturalHeight || this.element.height || 1080);
    const w = finalScale * 9 * aspect;
    const h = finalScale * 9;
    const origW = this.mesh.geometry.parameters.width;
    const origH = this.mesh.geometry.parameters.height;
    
    this.mesh.scale.set(w / origW, h / origH, 1);
    this.mesh.position.z = params.zIndex ?? 0.1;
    if (params.rotation !== undefined) this.mesh.rotation.z = params.rotation * (Math.PI / 180);
    
    this.material.opacity = params.opacity ?? 1.0;
    if (this.material.uniforms) {
      // Set opacity uniform for ShaderMaterials (both video and image)
      if (this.material.uniforms.opacity) {
        this.material.uniforms.opacity.value = params.opacity ?? 1.0;
      }
      MaskShader.applyParameters(this.material, params);
    }
    const hasMask = this.material.uniforms?.useMask?.value > 0.5;
    this.material.transparent = this.material.opacity < 1.0 || hasMask;
  }
  
  setPosition(worldX, worldY) {
    if (this.mesh && !this.locked) {
      this.lastPosition = { x: worldX, y: worldY };
      this.mesh.position.set(worldX, worldY, this.mesh.position.z);
    }
  }
  
  getPosition() {
    if (!this.mesh) return null;
    const pos = this.mesh.position;
    return {
      x: Math.max(0, Math.min(1, -(pos.y / CONFIG.PLANE_WIDTH) + 0.5)),
      y: Math.max(0, Math.min(1, -(pos.x / CONFIG.PLANE_HEIGHT) + 0.5))
    };
  }
  
  setVisible(visible) {
    if (this.mesh) {
      this.mesh.visible = visible;
      this.visible = visible;
    }
  }
  
  setLocked(locked) { this.locked = locked; }
  
  updateMaskPoints(points) {
    if (this.material) MaskShader.updatePoints(this.material, points);
  }
  
  dispose() {
    const scene = this.sceneManager.getWebGLScene();
    if (this.mesh) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material?.dispose();
      this.mesh = null;
    }
    if (this.mediaType === 'video' && this.element) {
      this.element.pause();
      this.element.ontimeupdate = null;
      this.element.src = '';
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.element = null;
    this.material = null;
    this.visible = false;
    this.audioProcessor.removeVideo(this.objectId);
    this.visualFX.removeVideo(this.objectId);
  }
}