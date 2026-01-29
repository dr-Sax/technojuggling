/**
 * Parameter Animator - Apply dynamic expressions to object parameters
 */
import { ExpressionEvaluator } from './expression-evaluator.js';

export class ParameterAnimator {
  constructor() {
    this.evaluator = new ExpressionEvaluator();
    this.expressionCache = new Map();
    this.startTime = performance.now() / 1000;
  }
  
  registerScene(sceneConfig) {
    this.expressionCache.clear();
    
    if (sceneConfig.hands) {
      for (const [hand, config] of Object.entries(sceneConfig.hands)) {
        this.scanConfig(`hand-${hand}`, config);
      }
    }
    
    if (sceneConfig.balls) {
      for (const [ballId, config] of Object.entries(sceneConfig.balls)) {
        this.scanConfig(`ball-${ballId}`, config);
      }
    }
  }
  
  registerSequence(sequenceConfig, objectIds) {
    this.expressionCache.clear();
    
    const expressionParams = new Set();
    
    if (sequenceConfig.presets) {
      for (const [presetName, presetEffects] of Object.entries(sequenceConfig.presets)) {
        for (const [param, value] of Object.entries(presetEffects)) {
          if (this.evaluator.isExpression(value)) {
            expressionParams.add(param);
          }
        }
      }
    }
    
    for (const objectId of objectIds) {
      if (expressionParams.size > 0) {
        const expressions = {};
        
        for (const param of expressionParams) {
          expressions[param] = true;
        }
        
        this.expressionCache.set(objectId, expressions);
      }
    }
  }
  
  scanConfig(objectKey, config) {
    const expressions = {};
    
    const animatableParams = [
      'scale', 'speed', 'blur', 'brightness', 'contrast',
      'saturation', 'hue', 'opacity', 'rotation',
      'volume', 'pan', 'lowpass', 'highpass', 'pitch',
      'reverb', 'delay', 'delayTime', 'delayFeedback',
      'chromatic', 'distortion', 'pixelate', 'kaleidoscope',
      'bloom', 'filmGrain', 'vignette', 'crt', 'glitch',
      'rgbShift', 'fisheye', 'posterize', 'halftone', 'echo',
      'maskRadius', 'maskCenterX', 'maskCenterY',
      'maskWidth', 'maskHeight', 'maskSides', 'maskRotation', 'maskMorph', 'useMask'
    ];
    
    for (const param of animatableParams) {
      if (config[param] !== undefined && this.evaluator.isExpression(config[param])) {
        expressions[param] = config[param];
      }
    }
    
    if (Object.keys(expressions).length > 0) {
      this.expressionCache.set(objectKey, expressions);
    }
  }
  
  updateFrame(positions, parameterValues, ballData = {}) {
    const updates = [];
    const time = (performance.now() / 1000) - this.startTime;
       
    for (const [objectKey, expressions] of this.expressionCache.entries()) {
      const position = this.getPosition(objectKey, positions);
      if (!position) continue;
      
      const context = {
        time,
        t: time,
        ...ballData  // Add ball_0: {x, y, vx, vy}, ball_1: {...}, etc.
      };
      
      const currentParams = parameterValues[objectKey] || {};
      const updatedParams = {};
      let hasUpdates = false;
      
      for (const [param, expression] of Object.entries(expressions)) {
        const actualExpression = typeof expression === 'string' ? expression : currentParams[param];
        
        if (!currentParams.hasOwnProperty(param)) continue;
        
        if (actualExpression && this.evaluator.isExpression(actualExpression)) {
          const value = this.evaluator.evaluate(actualExpression, context);
          updatedParams[param] = value;
          hasUpdates = true;
        }
      }
      
      if (hasUpdates) {
        const [type, id] = this.parseObjectKey(objectKey);
        updates.push({ type, id, params: updatedParams });
      }
    }
    
    return updates;
  }
  
  getPosition(objectKey, positions) {
    if (objectKey.startsWith('hand-') || objectKey.endsWith('_hand')) {
      const hand = objectKey.replace('hand-', '').replace('_hand', '');
      return positions.hands?.[hand] || null;
    } else if (objectKey.startsWith('ball-') || objectKey.startsWith('ball_')) {
      const ballId = objectKey.replace('ball-', '').replace('ball_', '');
      return positions.balls?.[ballId] || null;
    }
    return null;
  }
  
  parseObjectKey(objectKey) {
    if (objectKey.startsWith('hand-')) {
      return ['hand', objectKey.replace('hand-', '')];
    } else if (objectKey.endsWith('_hand')) {
      return ['hand', objectKey.replace('_hand', '')];
    } else if (objectKey.startsWith('ball-')) {
      return ['ball', objectKey.replace('ball-', '')];
    } else if (objectKey.startsWith('ball_')) {
      return ['ball', objectKey.replace('ball_', '')];
    }
    return [null, null];
  }
  
  resetTime() {
    this.startTime = performance.now() / 1000;
  }
  
  hasExpressions() {
    return this.expressionCache.size > 0;
  }
}