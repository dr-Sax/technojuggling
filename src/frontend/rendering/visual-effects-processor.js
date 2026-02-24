/**
 * Visual Effects Processor - OPTIMIZED VERSION
 * WebGL Shader-based effects with early exits and reduced texture sampling
 */

export class VisualEffectsProcessor {
  constructor() {
    this.videos = new Map(); // videoId → { canvas, texture, material, uniforms }
    this.initialized = false;
    this.TARGET_VIDEO_FPS = 30; // Texture upload rate for ball videos (saves GPU bandwidth)
    this.textureUpdateInterval = 1000 / this.TARGET_VIDEO_FPS;
  }
  
  initialize() {
    this.initialized = true;
    console.log('✓ Visual effects processor initialized (OPTIMIZED)');
  }
  
  /**
   * Add a video element to shader processing
   */
  addVideo(videoElement, videoId) {
    if (!this.initialized) {
      this.initialize();
    }
    
    // Remove existing if already added
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
      
      // Create shader material with all effects
      const uniforms = {
        videoTexture: { value: texture },
        time: { value: 0 },
        
        // Distortion effects
        chromatic: { value: 0.0 },
        distortion: { value: 0.0 },
        rgbShift: { value: 0.0 },
        fisheye: { value: 0.0 },
        
        // Pixelation/stylization
        pixelate: { value: 0.0 },
        kaleidoscope: { value: 0 },
        posterize: { value: 0 },
        halftone: { value: 0.0 },
        
        // Post-processing
        bloom: { value: 0.0 },
        filmGrain: { value: 0.0 },
        vignette: { value: 0.0 },
        crt: { value: 0.0 },
        echo: { value: 0.0 },
        
        // Glitch
        glitch: { value: 0.0 },
        glitchSeed: { value: Math.random() },
        
        // Opacity
        opacity: { value: 1.0 }
      };
      
      const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        transparent: true
      });
      
      this.videos.set(videoId, {
        texture: texture,
        material: material,
        uniforms: uniforms,
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
   * Apply visual effect parameters to a video
   */
  applyParameters(videoId, params, time = 0) {
    const video = this.videos.get(videoId);
    if (!video) return;
    
    try {
      const u = video.uniforms;
      
      // Update time
      u.time.value = time;
      
      // Update all parameters
      u.chromatic.value = Math.max(0, Math.min(50, params.chromatic || 0)) / 1000;
      u.distortion.value = Math.max(0, Math.min(100, params.distortion || 0)) / 100;
      u.rgbShift.value = Math.max(0, Math.min(100, params.rgbShift || 0)) / 1000;
      u.fisheye.value = Math.max(0, Math.min(100, params.fisheye || 0)) / 100;
      u.pixelate.value = Math.max(0, Math.min(50, params.pixelate || 0));
      u.kaleidoscope.value = Math.floor(Math.max(0, Math.min(12, params.kaleidoscope || 0)));
      u.posterize.value = Math.floor(Math.max(0, Math.min(32, params.posterize || 0)));
      u.halftone.value = Math.max(0, Math.min(50, params.halftone || 0));
      u.bloom.value = Math.max(0, Math.min(100, params.bloom || 0)) / 100;
      u.filmGrain.value = Math.max(0, Math.min(100, params.filmGrain || 0)) / 100;
      u.vignette.value = Math.max(0, Math.min(100, params.vignette || 0)) / 100;
      u.crt.value = Math.max(0, Math.min(100, params.crt || 0)) / 100;
      u.echo.value = Math.max(0, Math.min(100, params.echo || 0)) / 100;
      u.glitch.value = Math.max(0, Math.min(100, params.glitch || 0)) / 100;
      
      // Update glitch seed occasionally
      if (u.glitch.value > 0 && Math.random() < 0.1) {
        u.glitchSeed.value = Math.random();
      }
      
      // Opacity
      u.opacity.value = Math.max(0, Math.min(1, params.opacity ?? 1.0));
      
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
        // Only update if video is actually playing and has data
        if (video.element && video.element.readyState >= 2 && !video.element.paused) {
          video.texture.needsUpdate = true;
          video.lastTextureUpdate = now;
        }
      }
    }
  }
  
  /**
   * Vertex shader
   */
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
   * Fragment shader - OPTIMIZED with early exits
   */
  getFragmentShader() {
    return `
      uniform sampler2D videoTexture;
      uniform float time;
      uniform float chromatic;
      uniform float distortion;
      uniform float rgbShift;
      uniform float fisheye;
      uniform float pixelate;
      uniform int kaleidoscope;
      uniform int posterize;
      uniform float halftone;
      uniform float bloom;
      uniform float filmGrain;
      uniform float vignette;
      uniform float crt;
      uniform float echo;
      uniform float glitch;
      uniform float glitchSeed;
      uniform float opacity;
      
      varying vec2 vUv;
      
      #define PI 3.14159265359
      
      // Hash function for noise (only used if needed)
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      
      // Kaleidoscope - ONLY if segments > 0
      vec2 kaleidoscopeUV(vec2 uv, int segments) {
        vec2 center = vec2(0.5);
        vec2 delta = uv - center;
        float angle = atan(delta.y, delta.x);
        float radius = length(delta);
        float segmentAngle = 6.28318 / float(segments);
        angle = mod(angle, segmentAngle);
        if (mod(floor(atan(delta.y, delta.x) / segmentAngle), 2.0) > 0.5) {
          angle = segmentAngle - angle;
        }
        return center + radius * vec2(cos(angle), sin(angle));
      }
      
      // Distortion - ONLY if amount > 0
      vec2 distortUV(vec2 uv, float amount) {
        vec2 center = vec2(0.5);
        vec2 delta = uv - center;
        float dist = length(delta);
        return uv + delta * amount * sin(dist * 10.0 + time);
      }
      
      // Fisheye - ONLY if amount > 0
      vec2 fisheyeUV(vec2 uv, float amount) {
        vec2 center = vec2(0.5);
        vec2 delta = uv - center;
        float r = length(delta);
        float theta = atan(delta.y, delta.x);
        float r2 = r * (1.0 + amount * r * r);
        return center + r2 * vec2(cos(theta), sin(theta));
      }
      
      // Pixelation - ONLY if pixelSize > 1
      vec2 pixelateUV(vec2 uv, float pixelSize) {
        return floor(uv * (100.0 / pixelSize)) / (100.0 / pixelSize);
      }
      
      // Posterize - ONLY if levels > 1
      vec3 posterizeColor(vec3 color, int levels) {
        float levelsFloat = float(levels);
        return floor(color * levelsFloat) / levelsFloat;
      }
      
      // Halftone - ONLY if size > 0
      float halftonePattern(vec2 uv, float size) {
        vec2 grid = fract(uv * (100.0 / size));
        float dist = length(grid - 0.5);
        return smoothstep(0.5, 0.0, dist);
      }
      
      void main() {
        vec2 uv = vUv;
        
        // OPTIMIZATION: Check if ANY UV-modifying effects are active
        bool hasUVEffects = kaleidoscope > 0 || fisheye > 0.01 || 
                            distortion > 0.01 || crt > 0.01 || 
                            pixelate > 0.5 || glitch > 0.01;
        
        // EARLY EXIT: If no effects at all, just sample and return
        bool hasColorEffects = posterize > 1 || halftone > 0.5 || bloom > 0.01 || 
                               filmGrain > 0.01 || vignette > 0.01 || echo > 0.01;
        bool hasRGBSplit = rgbShift > 0.001 || chromatic > 0.001;
        
        if (!hasUVEffects && !hasColorEffects && !hasRGBSplit) {
          vec4 earlyColor = texture2D(videoTexture, uv);
          earlyColor.a *= opacity;
          gl_FragColor = earlyColor;
          return;
        }
        
        // Apply UV transformations ONLY if needed
        if (kaleidoscope > 0) {
          uv = kaleidoscopeUV(uv, kaleidoscope);
        }
        
        if (fisheye > 0.01) {
          uv = fisheyeUV(uv, fisheye);
        }
        
        if (distortion > 0.01) {
          uv = distortUV(uv, distortion * 0.1);
        }
        
        if (crt > 0.01) {
          // CRT curve (simplified)
          vec2 centered = uv * 2.0 - 1.0;
          float r2 = dot(centered, centered);
          centered *= 1.0 + r2 * crt * 0.1;
          uv = centered * 0.5 + 0.5;
        }
        
        if (pixelate > 0.5) {
          uv = pixelateUV(uv, pixelate);
        }
        
        if (glitch > 0.01) {
          float glitchLine = step(0.99, hash(vec2(floor(uv.y * 100.0), glitchSeed)));
          uv.x += (hash(vec2(glitchLine, time)) - 0.5) * glitch * 0.1;
        }
        
        // Sample video texture
        vec4 color;
        
        // OPTIMIZATION: Only do multi-sampling if RGB split is active
        if (rgbShift > 0.001) {
          // RGB Shift - 3 texture samples
          vec2 rShift = vec2(rgbShift * cos(time), rgbShift * sin(time));
          vec2 gShift = vec2(rgbShift * cos(time + 2.09), rgbShift * sin(time + 2.09));
          vec2 bShift = vec2(rgbShift * cos(time + 4.19), rgbShift * sin(time + 4.19));
          
          color = vec4(
            texture2D(videoTexture, uv + rShift).r,
            texture2D(videoTexture, uv + gShift).g,
            texture2D(videoTexture, uv + bShift).b,
            1.0
          );
        } else if (chromatic > 0.001) {
          // Chromatic aberration - 3 texture samples
          color = vec4(
            texture2D(videoTexture, uv + vec2(chromatic, 0.0)).r,
            texture2D(videoTexture, uv).g,
            texture2D(videoTexture, uv - vec2(chromatic, 0.0)).b,
            1.0
          );
        } else {
          // Normal - 1 texture sample
          color = texture2D(videoTexture, uv);
        }
        
        // EARLY EXIT: If no color effects, return now
        if (!hasColorEffects) {
          color.a *= opacity;
          gl_FragColor = color;
          return;
        }
        
        // Apply color effects ONLY if active
        if (posterize > 1) {
          color.rgb = posterizeColor(color.rgb, posterize);
        }
        
        if (halftone > 0.5) {
          float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          float pattern = halftonePattern(vUv, halftone);
          color.rgb = vec3(step(pattern, brightness));
        }
        
        if (bloom > 0.01) {
          color.rgb += color.rgb * bloom;
        }
        
        if (filmGrain > 0.01) {
          float grain = hash(uv + time * 0.1) - 0.5;
          color.rgb += grain * filmGrain * 0.3;
        }
        
        if (vignette > 0.01) {
          vec2 center = vUv - 0.5;
          float dist = length(center);
          float vig = smoothstep(0.8, 0.2, dist * (1.0 + vignette));
          color.rgb *= vig;
        }
        
        if (crt > 0.01) {
          float scanline = sin(uv.y * 800.0) * 0.04 * crt;
          color.rgb -= scanline;
        }
        
        if (echo > 0.01) {
          color.rgb = mix(color.rgb, color.rgb * 0.8, echo * 0.5);
        }
        
        color.a *= opacity;
        gl_FragColor = color;
      }
    `;
  }
  
  /**
   * Clear all videos
   */
  clearAll() {
    for (const videoId of this.videos.keys()) {
      this.removeVideo(videoId);
    }
  }
}