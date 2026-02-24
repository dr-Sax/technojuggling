/**
 * Expression System - Expression evaluation for dynamic parameters
 * 
 * Single class: ExpressionEvaluator. The former ParameterAnimator class
 * has been absorbed into SceneManager directly.
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
        ...this.mathFunctions
      };

      // Flatten ball positions into scope: ball_0_x, ball_0_y, ball_0_vx, ball_0_vy
      // Also expose as b0x, b0y etc for brevity
      for (const [key, val] of Object.entries(ballData)) {
        if (val && typeof val === 'object') {
          scope[key] = val; // keep full object e.g. ball_0
          const idx = key.match(/\d+/)?.[0] ?? '';
          scope[`${key}_x`]  = val.x  ?? 0;
          scope[`${key}_y`]  = val.y  ?? 0;
          scope[`${key}_vx`] = val.vx ?? 0;
          scope[`${key}_vy`] = val.vy ?? 0;
          scope[`b${idx}x`]  = val.x  ?? 0;
          scope[`b${idx}y`]  = val.y  ?? 0;
        } else {
          scope[key] = val;
        }
      }
      
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
    const hasFunctions = /\b(sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|PI|E)\b/.test(value);
    const hasTimeVar = /\btime\b|\bt\b/.test(value);
    const hasBallVar = /\bball_\d+\b|\bb\d+[xy]\b/.test(value);
    
    return hasOperators || hasFunctions || hasTimeVar || hasBallVar;
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