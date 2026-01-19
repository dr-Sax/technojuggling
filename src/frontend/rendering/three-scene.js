/**
 * Three.js scene setup and management
 */
import { CONFIG } from '../core/config.js';

export class ThreeSceneManager {
  constructor() {
    this.threeScene = null;
    this.cssScene = null;
    this.camera = null;
    this.renderer = null;
    this.cssRenderer = null;
    this.cameraFeedPlane = null;
    this.cameraTexture = null;
    this.animating = false;
    
    // Reference to scene manager (set externally)
    this.sceneManagerRef = null;
  }
  
  initialize() {
    // WebGL scene
    this.threeScene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.z = 12;
    
    // WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    
    document.getElementById('webgl-container').appendChild(this.renderer.domElement);
    
    // CSS3D scene
    this.cssScene = new THREE.Scene();
    this.cssRenderer = new THREE.CSS3DRenderer();
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
    
    document.getElementById('css3d-container').appendChild(this.cssRenderer.domElement);
    
    // Camera feed background
    this.setupCameraFeed();
    
    // Window resize handler
    window.addEventListener('resize', () => this.handleResize());
    
    console.log('✓ Three.js scenes initialized');
  }
  
  setupCameraFeed() {
    const img = document.createElement('img');
    
    // Debugging counters
    this.frameUpdateCount = 0;
    this.lastFrameTime = Date.now();
    this.imageLoading = false;
    this.pendingFrame = null;
    
    // Set up onload handler once during setup
    img.onload = () => {
      this.cameraTexture.needsUpdate = true;
      this.frameUpdateCount++;
      this.imageLoading = false;
      
      const now = Date.now();
      const timeSinceLastFrame = now - this.lastFrameTime;
      

      this.lastFrameTime = now;
      
      // If there's a pending frame, load it now
      if (this.pendingFrame) {
        const pending = this.pendingFrame;
        this.pendingFrame = null;
        this.cameraTexture.image.src = pending;
        this.imageLoading = true;
      }
    };
    
    img.onerror = (e) => {
      console.error('Camera image load error:', e);
      this.imageLoading = false;
    };
    
    this.cameraTexture = new THREE.Texture(img);
    this.cameraTexture.minFilter = THREE.LinearFilter;
    this.cameraTexture.magFilter = THREE.LinearFilter;
    
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
    
    // Rotate 90° counter-clockwise for portrait mode
    this.cameraFeedPlane.rotation.z = -Math.PI / 2;
    this.cameraFeedPlane.position.z = 0;
    this.threeScene.add(this.cameraFeedPlane);
    
  }
  
  updateCameraFrame(base64Image) {
    const dataUrl = 'data:image/jpeg;base64,' + base64Image;
    
    // If image is currently loading, store as pending
    if (this.imageLoading) {
      this.pendingFrame = dataUrl;
      return;
    }
    
    // Otherwise load immediately
    this.cameraTexture.image.src = dataUrl;
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
      //console.log('[ANIMATE] Calling updateDynamicParameters');
      this.sceneManagerRef.updateDynamicParameters();
    }
    
    this.renderer.render(this.threeScene, this.camera);
    this.cssRenderer.render(this.cssScene, this.camera);
  }
  
  stopAnimation() {
    this.animating = false;
  }
  
  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
  }
  
  // Coordinate mapping
  mapCameraToWorld(normalizedX, normalizedY) {
    const worldX = -(normalizedY - 0.5) * CONFIG.PLANE_WIDTH;
    const worldY = -(normalizedX - 0.5) * CONFIG.PLANE_HEIGHT;
    return { x: worldX, y: worldY };
  }
  
  // Getters for other modules
  getCssScene() {
    return this.cssScene;
  }
  
  getWebGLScene() {
    return this.threeScene;
  }
  
  getPlaneHeight() {
    return CONFIG.PLANE_HEIGHT;
  }
  
  setSceneManager(sceneManager) {
    this.sceneManagerRef = sceneManager;
  }
}