/**
 * Three.js scene setup and management
 * Updated to remove CSS3DRenderer (WebGL only)
 */
import { CONFIG } from '../core/config.js';

export class ThreeSceneManager {
  constructor() {
    this.threeScene = null;
    this.camera = null;
    this.renderer = null;
    this.cameraFeedPlane = null;
    this.cameraTexture = null;
    this.animating = false;
    
    // Reference to scene manager (set externally)
    this.sceneManagerRef = null;
    // Reference to visual effects processor for throttled texture updates
    this.visualFXRef = null;
  }
  
  initialize() {
    // WebGL scene
    this.threeScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      90,  // Wider FOV to show full frame
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 12;
    
    // Add lighting for 3D models (if needed in future)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.threeScene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 7.5);
    this.threeScene.add(directionalLight);
    
    // WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    
    document.getElementById('webgl-container').appendChild(this.renderer.domElement);
    
    // Camera feed background
    this.setupCameraFeed();
    
    // Window resize handler
    window.addEventListener('resize', () => this.handleResize());
    
    console.log('✓ Three.js scene initialized (WebGL only)');
  }
  
  setupCameraFeed() {
    this.frameUpdateCount = 0;
    this.lastFrameTime = Date.now();
    this.imageLoading = false;
    this.pendingBlob = null;
    
    // Start with a 1x1 placeholder so Three.js never sees an incomplete texture
    const placeholder = document.createElement('canvas');
    placeholder.width = 1;
    placeholder.height = 1;
    
    this.cameraTexture = new THREE.Texture(placeholder);
    this.cameraTexture.minFilter = THREE.LinearFilter;
    this.cameraTexture.magFilter = THREE.LinearFilter;
    this.cameraTexture.needsUpdate = true;
    
    const planeGeometry = new THREE.PlaneGeometry(
      CONFIG.PLANE_WIDTH,
      CONFIG.PLANE_HEIGHT
    );
    
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: this.cameraTexture,
      transparent: false,
      opacity: 1.0
    });
    
    this.cameraFeedPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.cameraFeedPlane.rotation.z = -Math.PI / 2;
    this.cameraFeedPlane.position.z = 0;
    this.threeScene.add(this.cameraFeedPlane);
  }
  
  _processBlob(blob) {
    this.imageLoading = true;
    createImageBitmap(blob).then((bitmap) => {
      // Swap the texture image to the GPU-ready bitmap
      if (this.cameraTexture.image && this.cameraTexture.image.close) {
        this.cameraTexture.image.close(); // Release previous ImageBitmap
      }
      this.cameraTexture.image = bitmap;
      this.cameraTexture.needsUpdate = true;
      this.frameUpdateCount++;
      this.imageLoading = false;
      this.lastFrameTime = Date.now();
      
      // Process pending blob if any
      if (this.pendingBlob) {
        const pending = this.pendingBlob;
        this.pendingBlob = null;
        this._processBlob(pending);
      }
    }).catch(() => {
      this.imageLoading = false;
      if (this.pendingBlob) {
        const pending = this.pendingBlob;
        this.pendingBlob = null;
        this._processBlob(pending);
      }
    });
  }
  
  updateCameraFrame(frameData) {
    // frameData is either a Blob (binary path) or a string URL (legacy)
    if (frameData instanceof Blob) {
      if (this.imageLoading) {
        this.pendingBlob = frameData;
        return;
      }
      this._processBlob(frameData);
    } else {
      // Legacy: string URL (data URL or blob URL)
      this._loadLegacyFrame(frameData);
    }
  }
  
  _loadLegacyFrame(url) {
    // Fallback for string URLs
    if (!this._legacyImg) {
      this._legacyImg = document.createElement('img');
      this._legacyImg.onload = () => {
        if (this._legacyImg.complete && this._legacyImg.naturalWidth > 0) {
          this.cameraTexture.image = this._legacyImg;
          this.cameraTexture.needsUpdate = true;
        }
        this.imageLoading = false;
      };
      this._legacyImg.onerror = () => { this.imageLoading = false; };
    }
    if (this.imageLoading) return;
    this._legacyImg.src = url;
    this.imageLoading = true;
  }
  
  // Toggle camera feed visibility
  setCameraVisible(visible) {
    if (this.cameraFeedPlane) {
      this.cameraFeedPlane.visible = visible;
      console.log(`Camera feed: ${visible ? 'visible' : 'hidden'}`);
    }
  }
  
  startAnimation() {
    if (this.animating) return;
    this.animating = true;
    this.animate();
  }
  
  animate() {
    if (!this.animating) return;
    
    requestAnimationFrame(() => this.animate());
    
    // Update dynamic parameters if scene manager is available
    if (this.sceneManagerRef) {
      this.sceneManagerRef.updateDynamicParameters();
    }
    
    // Throttled video texture uploads (20fps instead of 60fps)
    if (this.visualFXRef) {
      this.visualFXRef.updateTextures();
    }
    
    this.renderer.render(this.threeScene, this.camera);
  }
  
  stopAnimation() {
    this.animating = false;
  }
  
  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  // Coordinate mapping
  mapCameraToWorld(normalizedX, normalizedY) {
    // Since plane is rotated 90° counter-clockwise:
    // - Camera's X (0 to 1, left to right) maps to world Y (bottom to top after rotation)
    // - Camera's Y (0 to 1, top to bottom) maps to world X (right to left after rotation)
    const worldX = -(normalizedY - 0.5) * CONFIG.PLANE_HEIGHT;
    const worldY = -(normalizedX - 0.5) * CONFIG.PLANE_WIDTH;
    return { x: worldX, y: worldY };
  }
  
  // Getters for other modules
  getWebGLScene() {
    return this.threeScene;
  }
  
  getPlaneHeight() {
    return CONFIG.PLANE_HEIGHT;
  }
  
  setSceneManager(sceneManager) {
    this.sceneManagerRef = sceneManager;
    sceneManager.setThreeSceneRef(this);
  }
  
  setVisualFX(visualFX) {
    this.visualFXRef = visualFX;
  }
}