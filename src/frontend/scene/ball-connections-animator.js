/**
 * Ball Connections Animator - Handles dynamic expressions for ball connections
 */
import { ExpressionEvaluator } from './expression-evaluator.js';

export class BallConnectionsAnimator {
  constructor() {
    this.evaluator = new ExpressionEvaluator();
    this.startTime = performance.now() / 1000;
  }
  
  resetTime() {
    this.startTime = performance.now() / 1000;
  }
  
  getTime() {
    return (performance.now() / 1000) - this.startTime;
  }
  
  evaluateParameters(connectionConfig) {
    if (!connectionConfig || !connectionConfig.enabled) {
      return null;
    }
    
    const time = this.getTime();
    const context = { time, t: time };
    const params = {};
    
    if (connectionConfig.lineWidth !== undefined) {
      params.lineWidth = this.evaluateParam(connectionConfig.lineWidth, context);
    }
    
    if (connectionConfig.opacity !== undefined) {
      params.opacity = this.evaluateParam(connectionConfig.opacity, context);
    }
    
    if (connectionConfig.zIndex !== undefined) {
      params.zIndex = this.evaluateParam(connectionConfig.zIndex, context);
    }
    
    if (connectionConfig.color !== undefined) {
      params.color = this.evaluateColor(connectionConfig.color, context);
    }
    
    // New circle-specific parameters (pass through as-is, no evaluation needed)
    if (connectionConfig.filled !== undefined) {
      params.filled = connectionConfig.filled;
    }
    
    if (connectionConfig.perCircleColors !== undefined) {
      params.perCircleColors = connectionConfig.perCircleColors;
    }
    
    if (connectionConfig.circleContents !== undefined) {
      params.circleContents = connectionConfig.circleContents;
    }
    
    if (connectionConfig.colorMode !== undefined) {
      params.colorMode = connectionConfig.colorMode;
    }
    
    if (connectionConfig.segments !== undefined) {
      params.segments = connectionConfig.segments;
    }
    
    return Object.keys(params).length > 0 ? params : null;
  }
  
  evaluateParam(value, context) {
    if (this.evaluator.isExpression(value)) {
      return this.evaluator.evaluate(value, context);
    }
    return value;
  }
  
  evaluateColor(colorValue, context) {
    if (typeof colorValue === 'number') {
      return colorValue;
    }
    
    if (typeof colorValue === 'object') {
      if (colorValue.hue !== undefined) {
        const hue = this.evaluateParam(colorValue.hue, context);
        const saturation = colorValue.saturation !== undefined 
          ? this.evaluateParam(colorValue.saturation, context) 
          : 1.0;
        const lightness = colorValue.lightness !== undefined 
          ? this.evaluateParam(colorValue.lightness, context) 
          : 0.5;
        return this.hslToHex(hue % 360, saturation, lightness);
      }
      
      if (colorValue.r !== undefined) {
        const r = this.evaluateParam(colorValue.r, context);
        const g = colorValue.g !== undefined 
          ? this.evaluateParam(colorValue.g, context) 
          : 0;
        const b = colorValue.b !== undefined 
          ? this.evaluateParam(colorValue.b, context) 
          : 0;
        return this.rgbToHex(r, g, b);
      }
    }
    
    return 0xffffff;
  }
  
  hslToHex(h, s, l) {
    h = h / 360;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const r = Math.round(f(0) * 255);
    const g = Math.round(f(8) * 255);
    const b = Math.round(f(4) * 255);
    return (r << 16) | (g << 8) | b;
  }
  
  rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(1, r));
    g = Math.max(0, Math.min(1, g));
    b = Math.max(0, Math.min(1, b));
    
    const ri = Math.round(r * 255);
    const gi = Math.round(g * 255);
    const bi = Math.round(b * 255);
    return (ri << 16) | (gi << 8) | bi;
  }
  
  hasExpressions(connectionConfig) {
    if (!connectionConfig) return false;
    
    const checkValue = (value) => {
      if (typeof value === 'string') {
        return this.evaluator.isExpression(value);
      }
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(v => 
          typeof v === 'string' && this.evaluator.isExpression(v)
        );
      }
      return false;
    };
    
    return checkValue(connectionConfig.lineWidth) ||
           checkValue(connectionConfig.opacity) ||
           checkValue(connectionConfig.zIndex) ||
           checkValue(connectionConfig.color);
  }
}