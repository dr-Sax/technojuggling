/**
 * Expression System - Unified expression evaluation and parameter animation
 * Replaces: expression-evaluator.js + ball-connections-animator.js
 */

export class ExpressionEvaluator {
  constructor() {
    this.mathFunctions = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs,
      sqrt: Math.sqrt,
      pow: Math.pow,
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      PI: Math.PI,
      E: Math.E
    };
  }
  
  evaluate(expression, context = {}) {
    try {
      const { time = 0, ...ballData } = context;
      
      const scope = {
        time,
        t: time,
        ...ballData,
        ...this.mathFunctions
      };
      
      const paramNames = Object.keys(scope);
      const paramValues = Object.values(scope);
      
      const func = new Function(
        ...paramNames,
        `"use strict"; return (${expression});`
      );
      
      return func(...paramValues);
      
    } catch (error) {
      console.error(`Expression evaluation error: ${error.message}`, expression);
      return 0;
    }
  }
  
  isExpression(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return false;
    }
    
    const stringEnums = ['triangle', 'circle', 'rectangle', 'polygon'];
    if (stringEnums.includes(value.toLowerCase())) {
      return false;
    }
    
    const hasOperators = /[+\-*/%()]/.test(value);
    const hasFunctions = /\b(sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|PI|E|time|ball_\d+)\b/.test(value);
    
    return hasOperators || hasFunctions;
  }
  
  validate(expression) {
    try {
      const testContext = {
        time: 0,
        ball_0: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        ball_1: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        ball_2: { x: 0.5, y: 0.5, vx: 0, vy: 0 }
      };
      this.evaluate(expression, testContext);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export class ParameterAnimator {
  constructor() {
    this.evaluator = new ExpressionEvaluator();
    this.expressionCache = new Map();
    this.startTime = performance.now() / 1000;
  }
  
  resetTime() {
    this.startTime = performance.now() / 1000;
  }
  
  getTime() {
    return (performance.now() / 1000) - this.startTime;
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
  
  evaluateParameter(value, context) {
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
        const hue = this.evaluateParameter(colorValue.hue, context);
        const saturation = colorValue.saturation !== undefined 
          ? this.evaluateParameter(colorValue.saturation, context) 
          : 1.0;
        const lightness = colorValue.lightness !== undefined 
          ? this.evaluateParameter(colorValue.lightness, context) 
          : 0.5;
        return this.hslToHex(hue % 360, saturation, lightness);
      }
      
      if (colorValue.r !== undefined) {
        const r = this.evaluateParameter(colorValue.r, context);
        const g = colorValue.g !== undefined 
          ? this.evaluateParameter(colorValue.g, context) 
          : 0;
        const b = colorValue.b !== undefined 
          ? this.evaluateParameter(colorValue.b, context) 
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
  
  hasExpressions(config) {
    if (!config) return false;
    
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
    
    return Object.values(config).some(value => checkValue(value));
  }
}