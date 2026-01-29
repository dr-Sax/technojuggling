/**
 * ImageObject - WebGL shader-based image rendering
 */
import { MediaObject } from './media-object.js';
import { MaskShader } from './mask-shader.js';

export class ImageObject extends MediaObject {
  createImage(imageUrl, zIndex = 0.1, scale = 1.0) {
    const webglScene = this.sceneManager.getWebGLScene();
    
    if (this.mesh) {
      webglScene.remove(this.mesh);
      this.audioProcessor.removeVideo(this.objectId);
      this.visualFX.removeVideo(this.objectId);
    }
    
    // Return a promise that resolves when the image is fully loaded and ready
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.crossOrigin = 'anonymous';
      img.style.imageRendering = 'high-quality';
      
      this.element = img;
      
      img.onload = () => {
        // Get actual image dimensions
        const imgWidth = img.naturalWidth || img.width || 1920;
        const imgHeight = img.naturalHeight || img.height || 1080;
        
        
        // Validate dimensions
        if (!imgWidth || !imgHeight || isNaN(imgWidth) || isNaN(imgHeight)) {
          console.error('[ImageObject] Invalid image dimensions:', imgWidth, imgHeight);
          reject(new Error('Invalid image dimensions'));
          return;
        }
        
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
            vec2 uv = vUv;
            vec4 color = texture2D(videoTexture, uv);
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
        
        // Use actual image aspect ratio
        const aspect = imgWidth / imgHeight;
        
        const baseScale = this.sceneManager.getPlaneHeight() / 480;
        const finalScale = baseScale * scale;
        
        // Calculate dimensions maintaining aspect ratio
        // Use a reference height and scale width by aspect ratio
        const refHeight = finalScale * 9;  // Base height (same as video)
        const width = refHeight * aspect;   // Width based on actual aspect ratio
        const height = refHeight;
        
        
        // Validate geometry dimensions
        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
          console.error('[ImageObject] Invalid geometry dimensions:', width, height);
          reject(new Error('Invalid geometry dimensions'));
          return;
        }
        
        const geometry = new THREE.PlaneGeometry(width, height);
        this.mesh = new THREE.Mesh(geometry, this.material);
        this.mesh.position.set(0, 0, zIndex);
        
        webglScene.add(this.mesh);
        this.visible = true;
        
        console.log('[ImageObject] Successfully created and added to scene');
        
        // Resolve the promise - image is ready!
        resolve();
      };
      
      img.onerror = () => {
        console.error(`Failed to load image: ${imageUrl}`);
        reject(new Error(`Failed to load image: ${imageUrl}`));
      };
    });
  }
  
  applyParameters(params, perspectiveScale = 1.0) {
    if (!this.element || !this.mesh) {
      return;
    }
    
    // Validate and merge with defaults
    const validated = this.validateParameters(params);
    
    
    // Apply scale - get the base geometry size and apply current scale
    if (validated.scale !== undefined) {
      const img = this.element;
      const imgWidth = img.naturalWidth || img.width || 1920;
      const imgHeight = img.naturalHeight || img.height || 1080;
      const aspect = imgWidth / imgHeight;
      
      const baseScale = this.sceneManager.getPlaneHeight() / 480;
      const finalScale = baseScale * validated.scale;
      
      const refHeight = finalScale * 9;
      const width = refHeight * aspect;
      const height = refHeight;
      
      // Get original geometry dimensions (from creation)
      const originalWidth = this.mesh.geometry.parameters.width;
      const originalHeight = this.mesh.geometry.parameters.height;
      
      const scaleX = width / originalWidth;
      const scaleY = height / originalHeight;
      
      // Apply scale relative to original size
      this.mesh.scale.set(scaleX, scaleY, 1);
      
    }
    
    if (validated.rotation !== undefined) {
      this.mesh.rotation.z = validated.rotation * (Math.PI / 180);
    }
    
    if (validated.zIndex !== undefined) {
      this.mesh.position.z = validated.zIndex;
    }
    
    if (validated.opacity !== undefined && this.material) {
      this.material.opacity = validated.opacity;
      this.material.transparent = validated.opacity < 1.0;
    }
    
    // Apply mask shader parameters (same as VideoObject)
    if (this.material && this.material.uniforms) {
      MaskShader.applyParameters(this.material, validated);
    }
  }
  
  _cleanupElement() {
    // Images don't need special cleanup
  }
}