/**
 * Three.js scene setup and management
 * Updated to remove CSS3DRenderer (WebGL only)
 */
import { CONFIG } from '../core/config.js';
import { effectRegistry } from '../tracking/effect-registry.js';

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
    this._decoding = false;      // true while createImageBitmap is in flight
    this._pendingBlob = null;    // newest frame that arrived during a decode
    
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
    // Drop incoming frame if a decode is already in flight — we'll pick up
    // the next one. This gives us backpressure without ever queuing stale frames.
    if (this._decoding) {
      // Keep only the very latest blob so we never fall more than 1 frame behind
      this._pendingBlob = blob;
      return;
    }

    this._decoding = true;
    this._pendingBlob = null;

    createImageBitmap(blob).then((bitmap) => {
      // Release previous ImageBitmap from GPU memory
      if (this.cameraTexture.image && this.cameraTexture.image.close) {
        this.cameraTexture.image.close();
      }
      this.cameraTexture.image = bitmap;
      this.cameraTexture.needsUpdate = true;
      this.frameUpdateCount++;
      this.lastFrameTime = Date.now();
      this._decoding = false;

      // If a newer frame arrived while we were decoding, process it now
      if (this._pendingBlob) {
        const next = this._pendingBlob;
        this._pendingBlob = null;
        this._processBlob(next);
      }
    }).catch(() => {
      this._decoding = false;
      if (this._pendingBlob) {
        const next = this._pendingBlob;
        this._pendingBlob = null;
        this._processBlob(next);
      }
    });
  }

  updateCameraFrame(frameData) {
    // frameData is either a Blob (binary path) or a string URL (legacy)
    if (frameData instanceof Blob) {
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

  /**
   * Move the camera feed plane to a specific Z position.
   * Called each frame by BallSpacetime so the feed trails behind
   * the advancing spacetime front by a configurable depth.
   */
  setCameraFeedZ(z) {
    if (this.cameraFeedPlane) {
      this.cameraFeedPlane.position.z = z;
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

      // Advance spacetime Z and keep camera locked to present
      const spacetime = effectRegistry.get('spacetime');
      if (spacetime?.active) spacetime.tick();
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
    const worldX = (normalizedY - 0.5) * CONFIG.PLANE_HEIGHT;
    const worldY = -(normalizedX - 0.5) * CONFIG.PLANE_WIDTH;
    return { x: worldX, y: worldY };
  }
  
  // Getters for other modules
  getWebGLScene() {
    return this.threeScene;
  }

  getCamera() {
    return this.camera;
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