/**
 * Expression Evaluator - Parse and evaluate mathematical expressions
 * with context (time, ball_0.x, ball_1.y, etc.) for dynamic parameter animation
 */

export class ExpressionEvaluator {
  constructor() {
    // Math functions available in expressions
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
  
  /**
   * Evaluate an expression with given context
   * @param {string} expression - The expression to evaluate
   * @param {Object} context - Variables available: { time, ball_0: {x, y, vx, vy}, ball_1: {...}, ... }
   * @returns {number} - Evaluated result
   */
  evaluate(expression, context = {}) {
    try {
      // Extract time and ball data from context
      const { time = 0, ...ballData } = context;
      
      // Build a safe scope with ball objects and math functions
      const scope = {
        time,
        t: time,
        ...ballData, // ball_0, ball_1, etc.
        ...this.mathFunctions
      };
      
      // Create function with all scope variables as parameters
      const paramNames = Object.keys(scope);
      const paramValues = Object.values(scope);
      
      const func = new Function(
        ...paramNames,
        `"use strict"; return (${expression});`
      );
      
      // Call with all scope values
      return func(...paramValues);
      
    } catch (error) {
      console.error(`Expression evaluation error: ${error.message}`, expression);
      return 0; // Return safe default on error
    }
  }
  
  /**
   * Check if a value is an expression string
   * @param {*} value - Value to check
   * @returns {boolean}
   */
  isExpression(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return false;
    }
    
    // Exclude string enum values (shape names, etc.)
    const stringEnums = ['triangle', 'circle', 'rectangle', 'polygon'];
    if (stringEnums.includes(value.toLowerCase())) {
      return false;
    }
    
    // If it contains math operators or function calls, it's likely an expression
    const hasOperators = /[+\-*/%()]/.test(value);
    const hasFunctions = /\b(sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|PI|E|time|ball_\d+)\b/.test(value);
    
    return hasOperators || hasFunctions;
  }
  
  /**
   * Validate an expression (check if it can be parsed)
   * @param {string} expression - Expression to validate
   * @returns {boolean}
   */
  validate(expression) {
    try {
      // Test with sample ball data
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