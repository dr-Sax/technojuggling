/**
 * Three.js scene setup and management
 */
import { CONFIG } from './config.js';

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
    this.cameraTexture = new THREE.Texture(img);
    this.cameraTexture.minFilter = THREE.LinearFilter;
    this.cameraTexture.magFilter = THREE.LinearFilter;
    
    // Crop camera feed to 8:9 aspect ratio (960:1080)
    // Camera is 320x240 (4:3), need to crop width to 213px centered
    // UV offset: (320 - 213) / 2 / 320 = 0.167
    // UV scale: 213 / 320 = 0.666
    this.cameraTexture.offset.set(0.167, 0);
    this.cameraTexture.repeat.set(0.666, 1.0);
    
    const planeGeometry = new THREE.PlaneGeometry(
      CONFIG.PLANE_WIDTH,
      CONFIG.PLANE_HEIGHT
    );
    
    const planeMaterial = new THREE.MeshBasicMaterial({
      map: this.cameraTexture,
      transparent: true,
      opacity: 1.0
    });
    
    this.cameraFeedPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    this.cameraFeedPlane.position.z = 0;
    this.threeScene.add(this.cameraFeedPlane);
  }
  
  updateCameraFrame(base64Image) {
    const img = this.cameraTexture.image;
    img.src = 'data:image/jpeg;base64,' + base64Image;
    this.cameraTexture.needsUpdate = true;
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
    const worldX = (normalizedX - 0.5) * CONFIG.PLANE_WIDTH;
    const worldY = -(normalizedY - 0.5) * CONFIG.PLANE_HEIGHT;
    return { x: worldX, y: worldY };
  }
  
  // Getters for other modules
  getCssScene() {
    return this.cssScene;
  }
  
  getPlaneHeight() {
    return CONFIG.PLANE_HEIGHT;
  }
}