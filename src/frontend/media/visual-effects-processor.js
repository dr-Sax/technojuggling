/**
 * Visual Effects Processor - PASSTHROUGH VERSION
 *
 * Slim shader pipeline that handles video texture sampling and opacity only.
 * The flashy effects (chromatic, glitch, kaleidoscope, halftone, etc.) were
 * stripped out — they weren't used in performance and added shader complexity.
 *
 * IMPORTANT: this shader is composed with MaskShader via addToShader(), which
 * does regex-based string injection. The shader code below MUST contain:
 *   - "uniform sampler2D videoTexture;"
 *   - "void main() {"
 *   - "gl_FragColor = color;"
 * Don't reformat those lines or MaskShader's regex injections will silently
 * fail to apply ball masking.
 */

export class VisualEffectsProcessor {
  constructor() {
    this.videos = new Map(); // videoId → { texture, material, uniforms, element, lastTextureUpdate }
    this.initialized = false;
    this.TARGET_VIDEO_FPS = 30; // Texture upload rate for ball videos (saves GPU bandwidth)
    this.textureUpdateInterval = 1000 / this.TARGET_VIDEO_FPS;
  }

  initialize() {
    this.initialized = true;
    console.log('✓ Visual effects processor initialized (passthrough)');
  }

  /**
   * Add a video element to shader processing
   */
  addVideo(videoElement, videoId) {
    if (!this.initialized) {
      this.initialize();
    }

    if (this.videos.has(videoId)) {
      this.removeVideo(videoId);
    }

    try {
      // Use regular Texture instead of VideoTexture for manual update control.
      // VideoTexture updates every render frame (~60fps), which is wasteful
      // for small masked ball videos. We throttle to TARGET_VIDEO_FPS instead.
      const texture = new THREE.Texture(videoElement);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      const uniforms = {
        videoTexture: { value: texture },
        opacity:      { value: 1.0 }
      };

      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader:   this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        transparent:    true
      });

      this.videos.set(videoId, {
        texture,
        material,
        uniforms,
        element: videoElement,
        lastTextureUpdate: 0
      });

      console.log(`✓ Visual FX added for ${videoId}`);
      return texture;

    } catch (error) {
      console.error(`Failed to add visual FX for ${videoId}:`, error);
      return null;
    }
  }

  /**
   * Remove video from processing
   */
  removeVideo(videoId) {
    const video = this.videos.get(videoId);
    if (!video) return;

    try {
      video.texture.dispose();
      video.material.dispose();
      this.videos.delete(videoId);
      console.log(`Removed visual FX for ${videoId}`);
    } catch (error) {
      console.error(`Error removing visual FX for ${videoId}:`, error);
    }
  }

  /**
   * Apply parameters to a video.
   *
   * Now only handles `opacity` — all the legacy
   * effect params (chromatic, glitch, etc.) are silently ignored.
   *
   * Signature kept (videoId, params, time) for backwards compatibility with
   * media-object.js which still passes a time argument.
   */
  applyParameters(videoId, params, _time = 0) {
    const video = this.videos.get(videoId);
    if (!video) return;

    try {
      video.uniforms.opacity.value = Math.max(0, Math.min(1, params.opacity ?? 1.0));
    } catch (error) {
      console.error(`Error applying visual FX to ${videoId}:`, error);
    }
  }

  /**
   * Get the material for a video
   */
  getMaterial(videoId) {
    const video = this.videos.get(videoId);
    return video ? video.material : null;
  }

  /**
   * Throttled texture update — call from render loop.
   * Only uploads video frames to GPU at TARGET_VIDEO_FPS instead of every render frame.
   */
  updateTextures() {
    const now = performance.now();
    for (const video of this.videos.values()) {
      if (now - video.lastTextureUpdate >= this.textureUpdateInterval) {
        if (video.element && video.element.readyState >= 2 && !video.element.paused) {
          video.texture.needsUpdate = true;
          video.lastTextureUpdate = now;
        }
      }
    }
  }

  getVertexShader() {
    return `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  }

  /**
   * Passthrough fragment shader. MaskShader.addToShader() will rewrite the
   * `gl_FragColor = color;` line to apply mask alpha — do not change that
   * pattern without updating MaskShader's regex.
   */
  getFragmentShader() {
    return `
      uniform sampler2D videoTexture;
      uniform float opacity;

      varying vec2 vUv;

      void main() {
        vec4 color = texture2D(videoTexture, vUv);
        color.a *= opacity;
        gl_FragColor = color;
      }
    `;
  }

  clearAll() {
    for (const videoId of this.videos.keys()) {
      this.removeVideo(videoId);
    }
  }
}