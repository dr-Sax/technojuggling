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