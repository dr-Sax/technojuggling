/**
 * MaskShader - GLSL shader code for dynamic video masking
 * Supports triangle, circle, rectangle, and polygon masks
 */

export class MaskShader {
  static getUniforms() {
    return `
      uniform int maskShape;
      uniform float maskPoints[6];
      uniform float maskRadius;
      uniform vec2 maskCenter;
      uniform vec2 maskSize;
      uniform int maskSides;
      uniform float maskRotation;
      uniform float maskMorph;
      uniform float useMask;
    `;
  }
  
  static getFunctions() {
    return `
      float pointInTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
        float area = 0.5 * (-p1.y * p2.x + p0.y * (-p1.x + p2.x) + p0.x * (p1.y - p2.y) + p1.x * p2.y);
        float s = 1.0 / (2.0 * area) * (p0.y * p2.x - p0.x * p2.y + (p2.y - p0.y) * p.x + (p0.x - p2.x) * p.y);
        float t = 1.0 / (2.0 * area) * (p0.x * p1.y - p0.y * p1.x + (p0.y - p1.y) * p.x + (p1.x - p0.x) * p.y);
        return (s >= 0.0 && t >= 0.0 && (s + t) <= 1.0) ? 1.0 : 0.0;
      }
      
      float circleAlpha(vec2 uv, vec2 center, float radius) {
        float dist = distance(uv, center);
        return smoothstep(radius + 0.01, radius - 0.01, dist);
      }
      
      float rectangleAlpha(vec2 uv, vec2 center, vec2 size, float rotation) {
        vec2 p = uv - center;
        float c = cos(rotation);
        float s = sin(rotation);
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        vec2 d = abs(p) - size * 0.5;
        return smoothstep(0.01, -0.01, max(d.x, d.y));
      }
      
      float polygonAlpha(vec2 uv, vec2 center, float radius, int sides, float rotation) {
        vec2 p = uv - center;
        float angle = atan(p.y, p.x) + rotation;
        float r = length(p);
        float a = 6.28318 / float(sides);
        float segment = floor(angle / a + 0.5) * a;
        float d = r * cos(angle - segment) - radius * cos(a * 0.5);
        return smoothstep(0.01, -0.01, d);
      }
      
      float getMaskAlpha(vec2 uv) {
        if (useMask < 0.5) return 1.0;
        
        float alpha = 1.0;
        
        if (maskShape == 0) {
          vec2 p0 = vec2(maskPoints[0], maskPoints[1]);
          vec2 p1 = vec2(maskPoints[2], maskPoints[3]);
          vec2 p2 = vec2(maskPoints[4], maskPoints[5]);
          alpha = pointInTriangle(uv, p0, p1, p2);
        } else if (maskShape == 1) {
          float dist = distance(uv, maskCenter);
          alpha = smoothstep(maskRadius + 0.01, maskRadius - 0.01, dist);
        } else if (maskShape == 2) {
          alpha = rectangleAlpha(uv, maskCenter, maskSize, maskRotation);
        } else if (maskShape == 3) {
          alpha = polygonAlpha(uv, maskCenter, maskRadius, maskSides, maskRotation);
        }
        
        return alpha;
      }
    `;
  }
  
  /**
   * Add mask code to fragment shader.
   * Uses regex replacements to be whitespace-tolerant.
   */
  static addToShader(fragmentShader) {
    let shader = fragmentShader;
    
    // 1. Insert uniforms after 'uniform sampler2D videoTexture;'
    shader = shader.replace(
      /uniform\s+sampler2D\s+videoTexture\s*;/,
      'uniform sampler2D videoTexture;\n' + MaskShader.getUniforms()
    );
    
    // 2. Insert helper functions before 'void main()'
    shader = shader.replace(
      /void\s+main\s*\(\s*\)\s*\{/,
      MaskShader.getFunctions() + '\nvoid main() {'
    );
    
    // 3. Apply mask in early exit path:
    //    gl_FragColor = texture2D(videoTexture, uv); return;
    //    → add mask alpha before return
    shader = shader.replace(
      /gl_FragColor\s*=\s*texture2D\s*\(\s*videoTexture\s*,\s*uv\s*\)\s*;\s*return\s*;/,
      `vec4 _earlyColor = texture2D(videoTexture, uv);
          _earlyColor.a *= getMaskAlpha(vUv);
          gl_FragColor = _earlyColor;
          return;`
    );
    
    // 4. Apply mask to ALL remaining 'gl_FragColor = color;' lines
    shader = shader.replaceAll(
      /gl_FragColor\s*=\s*color\s*;/g,
      'color.a *= getMaskAlpha(vUv);\ngl_FragColor = color;'
    );
    
    return shader;
  }
  
  static initUniforms(material) {
    material.uniforms.maskShape = { value: 0 };
    material.uniforms.maskPoints = { value: [0.5, 0.05, 0.0, 1.0, 1.0, 1.0] };
    material.uniforms.maskRadius = { value: 0.25 };
    material.uniforms.maskCenter = { value: new THREE.Vector2(0.5, 0.5) };
    material.uniforms.maskSize = { value: new THREE.Vector2(0.3, 0.3) };
    material.uniforms.maskSides = { value: 6 };
    material.uniforms.maskRotation = { value: 0.0 };
    material.uniforms.maskMorph = { value: 0.0 };
    material.uniforms.useMask = { value: 0.0 };
  }
  
  static applyParameters(material, params) {
    const u = material.uniforms;
    
    if (params.maskShape !== undefined) {
      const shapeMap = { triangle: 0, circle: 1, rectangle: 2, polygon: 3 };
      const shapeValue = typeof params.maskShape === 'string' ? 
        (shapeMap[params.maskShape] || 0) : params.maskShape;
      u.maskShape.value = Math.floor(Math.max(0, Math.min(3, shapeValue)));
    }
    
    if (params.maskRadius !== undefined && !isNaN(params.maskRadius)) {
      u.maskRadius.value = Math.max(0.01, Math.min(2.0, params.maskRadius));
    }
    
    if (params.maskCenterX !== undefined && !isNaN(params.maskCenterX)) {
      u.maskCenter.value.x = Math.max(0, Math.min(1, params.maskCenterX));
    }
    if (params.maskCenterY !== undefined && !isNaN(params.maskCenterY)) {
      u.maskCenter.value.y = Math.max(0, Math.min(1, params.maskCenterY));
    }
    
    if (params.maskWidth !== undefined && !isNaN(params.maskWidth)) {
      u.maskSize.value.x = Math.max(0.1, Math.min(2.0, params.maskWidth));
    }
    if (params.maskHeight !== undefined && !isNaN(params.maskHeight)) {
      u.maskSize.value.y = Math.max(0.1, Math.min(2.0, params.maskHeight));
    }
    
    if (params.maskSides !== undefined && !isNaN(params.maskSides)) {
      u.maskSides.value = Math.floor(Math.max(3, Math.min(12, params.maskSides)));
    }
    
    if (params.maskRotation !== undefined && !isNaN(params.maskRotation)) {
      u.maskRotation.value = params.maskRotation;
    }
    
    if (params.maskMorph !== undefined && !isNaN(params.maskMorph)) {
      u.maskMorph.value = Math.max(0, Math.min(1, params.maskMorph));
    }
    
    if (params.useMask !== undefined && !isNaN(params.useMask)) {
      u.useMask.value = params.useMask;
    }
  }
  
  static updatePoints(material, points) {
    if (material && material.uniforms && material.uniforms.maskPoints) {
      material.uniforms.maskPoints.value = points;
      if (material.uniforms.useMask) {
        material.uniforms.useMask.value = 1.0;
      }
    }
  }
}