/**
 * BallSincWaves - Real-time sinc wave interference patterns
 * 
 * Creates 2D sinc function interference patterns centered at each ball position.
 * Inspired by scipy sinc wave animations with RGB channel manipulation.
 * 
 * Mathematical basis:
 * - Each ball generates: sinc(x) * sinc(y) where sinc(t) = sin(πt) / (πt)
 * - Multiple sincs sum together creating interference patterns
 * - RGB channels can be scaled/offset independently for glitchy effects
 */

import { GeometryBase } from './_shared.js';
import { effectRegistry } from '../effect-registry.js';

export class BallSincWaves extends GeometryBase {
  constructor(sceneManager) {
    super(sceneManager);
    
    // Configuration
    this.config = {
      amplitude: 1.0,        // Overall wave amplitude
      frequency: 1.0,        // Spatial frequency (like tau_x/tau_y in your code)
      xStretch: 1.0,         // X-axis stretching
      yStretch: 1.0,         // Y-axis stretching
      decay: 0.5,            // How quickly waves decay with distance
      
      // RGB channel manipulation (for glitchy effects)
      rScale: 1.0,           // Red channel multiplier
      gScale: 1.0,           // Green channel multiplier  
      bScale: 1.0,           // Blue channel multiplier
      rPhase: 0.0,           // Red channel phase offset
      gPhase: 2.094,         // Green channel phase offset (4π/6)
      bPhase: 4.189,         // Blue channel phase offset (8π/6)
      
      // Animation
      rotation: 0.0,         // Global rotation (like phi in your code)
      autoRotate: true,      // Auto-increment rotation
      rotationSpeed: 0.01,   // Rotation speed per frame
      
      // Rendering
      planeSize: 20.0,       // Size of the interference plane
      resolution: 512        // Texture resolution (higher = more detail)
    };
    
    // Track ball positions for shader
    this.ballPositions = new Map(); // ballId -> {x, y, worldPos}
    
    // Create the interference plane
    this.createInterferencePlane();
    
    console.log('[BallSincWaves] Initialized');
  }
  
  /**
   * Create a full-screen plane with shader material
   */
  createInterferencePlane() {
    const geometry = new THREE.PlaneGeometry(
      this.config.planeSize,
      this.config.planeSize,
      1, 1
    );
    
    // Custom shader material
    const material = new THREE.ShaderMaterial({
      uniforms: {
        // Ball positions (up to 16 balls)
        ballPositions: { value: new Float32Array(16 * 2) }, // x,y pairs
        numBalls: { value: 0 },
        
        // Sinc parameters
        amplitude: { value: this.config.amplitude },
        frequency: { value: this.config.frequency },
        xStretch: { value: this.config.xStretch },
        yStretch: { value: this.config.yStretch },
        decay: { value: this.config.decay },
        
        // RGB channel manipulation
        rScale: { value: this.config.rScale },
        gScale: { value: this.config.gScale },
        bScale: { value: this.config.bScale },
        rPhase: { value: this.config.rPhase },
        gPhase: { value: this.config.gPhase },
        bPhase: { value: this.config.bPhase },
        
        // Animation
        rotation: { value: this.config.rotation },
        time: { value: 0.0 }
      },
      
      vertexShader: `
        varying vec2 vUv;
        
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      
      fragmentShader: `
        #define PI 3.14159265359
        #define MAX_BALLS 16
        
        uniform vec2 ballPositions[MAX_BALLS];
        uniform int numBalls;
        
        uniform float amplitude;
        uniform float frequency;
        uniform float xStretch;
        uniform float yStretch;
        uniform float decay;
        
        uniform float rScale;
        uniform float gScale;
        uniform float bScale;
        uniform float rPhase;
        uniform float gPhase;
        uniform float bPhase;
        
        uniform float rotation;
        uniform float time;
        
        varying vec2 vUv;
        
        /**
         * 2D sinc function: sinc(x) = sin(πx) / (πx)
         * Handles singularity at x=0
         */
        float sinc(float x) {
          float px = PI * x;
          if (abs(px) < 0.001) return 1.0;
          return sin(px) / px;
        }
        
        /**
         * 2D sinc pattern centered at (cx, cy)
         * Returns amplitude of wave at point (x, y)
         */
        float sincPattern(vec2 pos, vec2 center, float rot) {
          // Translate to center
          vec2 delta = pos - center;
          
          // Apply rotation
          float cosR = cos(rot);
          float sinR = sin(rot);
          vec2 rotated = vec2(
            delta.x * cosR - delta.y * sinR,
            delta.x * sinR + delta.y * cosR
          );
          
          // Apply stretching
          float x = rotated.x * xStretch * frequency;
          float y = rotated.y * yStretch * frequency;
          
          // Distance-based decay
          float dist = length(delta);
          float decayFactor = exp(-decay * dist);
          
          // 2D sinc: sinc(x) * sinc(y)
          return amplitude * sinc(x) * sinc(y) * decayFactor;
        }
        
        void main() {
          // Convert UV to world space (-planeSize/2 to +planeSize/2)
          vec2 worldPos = (vUv - 0.5) * 20.0; // matches planeSize
          
          // Accumulate interference from all balls
          float interference = 0.0;
          
          for (int i = 0; i < MAX_BALLS; i++) {
            if (i >= numBalls) break;
            
            vec2 ballPos = ballPositions[i];
            
            // Each ball gets a slight phase offset based on index
            float ballRotation = rotation + float(i) * 0.3;
            
            interference += sincPattern(worldPos, ballPos, ballRotation);
          }
          
          // Better normalization for visibility
          // Sinc functions can range quite a bit, so we'll use a more aggressive mapping
          float normalized = interference * 0.3 + 0.5; // Scale and center
          normalized = clamp(normalized, 0.0, 1.0);
          
          // RGB channel manipulation with phase offsets
          // This creates the "glitchy" color effects from your original
          float r = normalized * rScale * (cos(time * 0.5 + rPhase) * 0.4 + 0.6);
          float g = normalized * gScale * (cos(time * 0.5 + gPhase) * 0.4 + 0.6);
          float b = normalized * bScale * (cos(time * 0.5 + bPhase) * 0.4 + 0.6);
          
          // Clamp to valid range
          r = clamp(r, 0.0, 1.0);
          g = clamp(g, 0.0, 1.0);
          b = clamp(b, 0.0, 1.0);
          
          gl_FragColor = vec4(r, g, b, 1.0);
        }
      `,
      
      transparent: false,
      side: THREE.DoubleSide
    });
    
    this.interferencePlane = new THREE.Mesh(geometry, material);
    this.interferencePlane.position.z = 0; // Same depth as balls
    this.interferencePlane.renderOrder = -1; // Render before other objects
    this.scene.add(this.interferencePlane);
    
    console.log('[BallSincWaves] Created interference plane at z=0');
  }
  
  /**
   * Update ball position
   */
  updateBall(ballId, worldPos) {
    // Debug: log first few updates
    if (this.ballPositions.size < 3) {
      console.log(`[BallSincWaves] updateBall ${ballId}:`, worldPos);
    }
    
    this.ballPositions.set(ballId, {
      x: worldPos.x,
      y: worldPos.y,
      worldPos: worldPos // Store reference (no need to clone)
    });
    
    this.updateShaderUniforms();
  }
  
  /**
   * Remove ball
   */
  removeBall(ballId) {
    this.ballPositions.delete(ballId);
    this.updateShaderUniforms();
  }
  
  /**
   * Update shader uniforms with current ball positions
   */
  updateShaderUniforms() {
    const material = this.interferencePlane.material;
    const positions = Array.from(this.ballPositions.values());
    
    // Pack positions into Float32Array
    const posArray = material.uniforms.ballPositions.value;
    for (let i = 0; i < 16; i++) {
      if (i < positions.length) {
        posArray[i * 2] = positions[i].x;
        posArray[i * 2 + 1] = positions[i].y;
      } else {
        posArray[i * 2] = 0;
        posArray[i * 2 + 1] = 0;
      }
    }
    
    material.uniforms.numBalls.value = positions.length;
    material.uniforms.ballPositions.needsUpdate = true;
    
    // Debug: log when we have balls
    if (positions.length > 0 && positions.length <= 3) {
      console.log(`[BallSincWaves] Updated shader: ${positions.length} balls`, 
        positions.map(p => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`));
    }
  }
  
  /**
   * Animation update (call every frame)
   */
  update(deltaTime = 0.016) {
    if (!this.interferencePlane) return;
    
    const material = this.interferencePlane.material;
    
    // Auto-rotate
    if (this.config.autoRotate) {
      this.config.rotation += this.config.rotationSpeed;
      material.uniforms.rotation.value = this.config.rotation;
    }
    
    // Update time for RGB animation
    material.uniforms.time.value += deltaTime;
  }
  
  /**
   * Set configuration
   */
  setConfig(config) {
    Object.assign(this.config, config);
    
    if (!this.interferencePlane) return;
    
    const uniforms = this.interferencePlane.material.uniforms;
    
    // Update shader uniforms
    if (config.amplitude !== undefined) uniforms.amplitude.value = config.amplitude;
    if (config.frequency !== undefined) uniforms.frequency.value = config.frequency;
    if (config.xStretch !== undefined) uniforms.xStretch.value = config.xStretch;
    if (config.yStretch !== undefined) uniforms.yStretch.value = config.yStretch;
    if (config.decay !== undefined) uniforms.decay.value = config.decay;
    
    if (config.rScale !== undefined) uniforms.rScale.value = config.rScale;
    if (config.gScale !== undefined) uniforms.gScale.value = config.gScale;
    if (config.bScale !== undefined) uniforms.bScale.value = config.bScale;
    if (config.rPhase !== undefined) uniforms.rPhase.value = config.rPhase;
    if (config.gPhase !== undefined) uniforms.gPhase.value = config.gPhase;
    if (config.bPhase !== undefined) uniforms.bPhase.value = config.bPhase;
    
    if (config.rotation !== undefined) {
      this.config.rotation = config.rotation;
      uniforms.rotation.value = config.rotation;
    }
    
    if (config.autoRotate !== undefined) {
      this.config.autoRotate = config.autoRotate;
    }
    
    if (config.rotationSpeed !== undefined) {
      this.config.rotationSpeed = config.rotationSpeed;
    }
    
    // Resize plane if needed
    if (config.planeSize !== undefined && config.planeSize !== this.config.planeSize) {
      this.config.planeSize = config.planeSize;
      this.scene.remove(this.interferencePlane);
      this.interferencePlane.geometry.dispose();
      this.interferencePlane.material.dispose();
      this.createInterferencePlane();
      this.updateShaderUniforms();
    }
  }
  
  /**
   * Clear all
   */
  clear() {
    this.ballPositions.clear();
    this.updateShaderUniforms();
  }
  
  /**
   * Cleanup
   */
  dispose() {
    if (this.interferencePlane) {
      this.scene.remove(this.interferencePlane);
      this.interferencePlane.geometry.dispose();
      this.interferencePlane.material.dispose();
    }
  }
  
  // GeometryBase interface (not used, but required)
  createGeometry(id, params) { return null; }
  updateGeometry(id, params) {}
}

// Registration
effectRegistry.register('sincwaves', BallSincWaves, {
    updateMethod: 'updateBall', requiresWorldPos: true,
    hasEnabled: true, hasConfig: true,
    clearMethod: 'clear', removeBallMethod: 'removeBall'
});