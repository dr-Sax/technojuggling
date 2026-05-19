/**
 * BallSincWaves - Real-time sinc wave interference patterns
 *
 * Creates 2D sinc function interference patterns centered at each ball position.
 * Inspired by scipy sinc wave animations.
 *
 * Mathematical basis:
 * - Each ball generates: sinc(x) * sinc(y) where sinc(t) = sin(πt) / (πt)
 * - Multiple sincs sum together creating interference patterns
 *
 * Color model:
 * - The summed interference value is mapped into the viridis colormap (the
 *   same colormap matplotlib's plt.imsave applied by default in the original
 *   Python pipeline), producing a normalized RGB image.
 * - That image is then multiplied per-channel by colorMultR / colorMultG /
 *   colorMultB and wrapped with fract(). This reproduces the uint8 mod-256
 *   overflow glitch from the original: each channel folds at its own rate,
 *   so a smooth interference ramp becomes three sawtooths beating against
 *   each other. Multipliers of (1,1,1) give clean viridis with no glitch.
 *
 * Note vs. the Python original: matplotlib autoscaled each frame to its own
 * min/max before colormapping. This shader uses a fixed interference->[0,1]
 * mapping (intensityScale / intensityBias below), so it is stable frame to
 * frame rather than re-normalizing per frame. Tune those two constants to
 * place the pattern within the viridis ramp.
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

      // Color glitch model.
      //
      // The interference field is run through the viridis colormap, then each
      // RGB channel is multiplied by its own integer and wrapped (fract). This
      // is the uint8-overflow glitch from the Python version, where each frame
      // JPG was multiplied per-channel and allowed to overflow mod 256.
      //
      // colorMultR/G/B correspond to the (r, g, b) integers in the Python
      // vid_generator loop (e.g. sinc11_4_6_4 used 4, 6, 4). Use (1, 1, 1)
      // for clean viridis with no folding.
      colorMultR: 4.0,
      colorMultG: 6.0,
      colorMultB: 4.0,

      // Where the interference field sits within the viridis ramp.
      // value = clamp(interference * intensityScale + intensityBias, 0, 1)
      //   intensityScale — contrast of the pattern in the colormap
      //   intensityBias  — pushes the background up/down the viridis ramp
      intensityScale: 0.3,
      intensityBias: 0.5,

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

        // Per-channel glitch multipliers, packed as a vec3 for the shader.
        channelMult: {
          value: new THREE.Vector3(
            this.config.colorMultR,
            this.config.colorMultG,
            this.config.colorMultB
          )
        },

        // Viridis ramp placement
        intensityScale: { value: this.config.intensityScale },
        intensityBias: { value: this.config.intensityBias },

        // World-space size the shader maps UVs across. Must track config.planeSize
        // so the interference pattern stays aligned with ball world coordinates.
        planeSize: { value: this.config.planeSize }
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

        uniform vec3 channelMult;
        uniform float intensityScale;
        uniform float intensityBias;

        uniform float planeSize;

        varying vec2 vUv;

        // Viridis colormap polynomial approximation.
        // Matt Zucker's public-domain fit; matches matplotlib viridis closely.
        vec3 viridis(float t) {
          const vec3 c0 = vec3(0.2777273272234177,  0.005407344544966578, 0.3340998053353061);
          const vec3 c1 = vec3(0.1050930431085774,  1.404613529898575,    1.384590162594685);
          const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213,    0.09509516302823659);
          const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585,  -19.33244095627987);
          const vec3 c4 = vec3(6.228269936347081,  14.17993336680509,    56.69055260068105);
          const vec3 c5 = vec3(4.776384997670288, -13.74514537774601,   -65.35303263337234);
          const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535,    26.3124352495832);
          t = clamp(t, 0.0, 1.0);
          return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
        }

        // 2D sinc function: sinc(x) = sin(PI x) / (PI x). Handles x=0.
        float sinc(float x) {
          float px = PI * x;
          if (abs(px) < 0.001) return 1.0;
          return sin(px) / px;
        }

        // 2D sinc pattern centered at (center). Returns wave amplitude at pos.
        float sincPattern(vec2 pos, vec2 center) {
          vec2 delta = pos - center;

          // Apply stretching
          float x = delta.x * xStretch * frequency;
          float y = delta.y * yStretch * frequency;

          // Distance-based decay
          float dist = length(delta);
          float decayFactor = exp(-decay * dist);

          // 2D sinc: sinc(x) * sinc(y)
          return amplitude * sinc(x) * sinc(y) * decayFactor;
        }

        void main() {
          // Convert UV to world space (-planeSize/2 to +planeSize/2)
          vec2 worldPos = (vUv - 0.5) * planeSize;

          // Accumulate interference from all balls
          float interference = 0.0;
          for (int i = 0; i < MAX_BALLS; i++) {
            if (i >= numBalls) break;
            interference += sincPattern(worldPos, ballPositions[i]);
          }

          // Map interference into the viridis ramp, the way plt.imsave's
          // default colormap mapped the raw sinc float array.
          float v = clamp(interference * intensityScale + intensityBias, 0.0, 1.0);
          vec3 img = viridis(v);

          // The uint8-overflow glitch: multiply each channel by its integer
          // and wrap mod 1.0. fract(x * mult) is the normalized-float
          // equivalent of (uint8 * mult) % 256. Multipliers of (1,1,1)
          // leave viridis untouched.
          vec3 col = fract(img * channelMult);

          gl_FragColor = vec4(col, 1.0);
        }
      `,

      transparent: false,
      side: THREE.DoubleSide
    });

    this.interferencePlane = new THREE.Mesh(geometry, material);
    this.interferencePlane.position.z = 0;   // Same depth as balls
    this.interferencePlane.renderOrder = -1;  // Render before other objects
    this.scene.add(this.interferencePlane);

    console.log('[BallSincWaves] Created interference plane at z=0');
  }

  /**
   * Update ball position
   */
  updateBall(ballId, worldPos) {
    this.ballPositions.set(ballId, {
      x: worldPos.x,
      y: worldPos.y,
      worldPos: worldPos
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
  }

  /**
   * Animation update (call every frame). Kept for the GeometryBase interface;
   * the effect is fully static now (no time-based animation).
   */
  update(deltaTime = 0.016) {
    // No per-frame work — pattern is driven entirely by ball positions.
  }

  /**
   * Set configuration
   */
  setConfig(config) {
    // Capture values compared against the OLD config BEFORE Object.assign
    // overwrites this.config. planeSize is gated on an old-vs-new comparison,
    // so it must be read here — afterwards this.config.planeSize already
    // equals the new value and the comparison would always be false.
    const prevPlaneSize = this.config.planeSize;

    Object.assign(this.config, config);

    if (!this.interferencePlane) return;

    const uniforms = this.interferencePlane.material.uniforms;

    // Sinc parameters
    if (config.amplitude !== undefined) uniforms.amplitude.value = config.amplitude;
    if (config.frequency !== undefined) uniforms.frequency.value = config.frequency;
    if (config.xStretch !== undefined) uniforms.xStretch.value = config.xStretch;
    if (config.yStretch !== undefined) uniforms.yStretch.value = config.yStretch;
    if (config.decay !== undefined) uniforms.decay.value = config.decay;

    // Per-channel glitch multipliers. Each is exposed independently in the
    // livecoder; any subset may be present in a given setConfig call, so each
    // is checked separately and written into the shared channelMult vec3.
    if (config.colorMultR !== undefined) uniforms.channelMult.value.x = config.colorMultR;
    if (config.colorMultG !== undefined) uniforms.channelMult.value.y = config.colorMultG;
    if (config.colorMultB !== undefined) uniforms.channelMult.value.z = config.colorMultB;

    // Viridis ramp placement
    if (config.intensityScale !== undefined) uniforms.intensityScale.value = config.intensityScale;
    if (config.intensityBias !== undefined) uniforms.intensityBias.value = config.intensityBias;

    // Resize plane if needed.
    //
    // The plane mesh geometry is planeSize x planeSize, AND the shader maps
    // UVs across planeSize world units — both must update together. We swap
    // the geometry in place and update the uniform, rather than tearing down
    // and rebuilding the whole material (which recompiles the shader and is
    // far more expensive). Ball positions in the shader are untouched.
    if (config.planeSize !== undefined && config.planeSize !== prevPlaneSize) {
      // this.config.planeSize is already the new value (Object.assign above).
      const oldGeometry = this.interferencePlane.geometry;
      this.interferencePlane.geometry = new THREE.PlaneGeometry(
        this.config.planeSize,
        this.config.planeSize,
        1, 1
      );
      oldGeometry.dispose();

      uniforms.planeSize.value = this.config.planeSize;
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
//
// Registered as 'sincWaves' (capital W) — NOT 'sincwaves'. scene-manager's
// applyAllEffects() derives the config key by capitalizing the first letter
// only: ball + Name. 'sincwaves' -> wrong key 'ballSincwaves'; 'sincWaves' ->
// correct key 'ballSincWaves', which is what SceneGroupController writes.
effectRegistry.register('sincWaves', BallSincWaves, {
    updateMethod: 'updateBall', requiresWorldPos: true,
    hasEnabled: true, hasConfig: true,
    clearMethod: 'clear', removeBallMethod: 'removeBall'
});