/**
 * Expression Evaluator - Parse and evaluate mathematical expressions
 * with context (time, x, y) for dynamic parameter animation
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
   * @param {Object} context - Variables available: { time, x, y }
   * @returns {number} - Evaluated result
   */
  evaluate(expression, context = {}) {
    try {
      // Create a safe evaluation context
      const { time = 0, x = 0, y = 0 } = context;
      
      // Build function with math functions and context variables
      const func = new Function(
        'time', 'x', 'y',
        ...Object.keys(this.mathFunctions),
        `"use strict"; return (${expression});`
      );
      
      // Call with context values and math functions
      return func(
        time, x, y,
        ...Object.values(this.mathFunctions)
      );
      
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
    const hasFunctions = /\b(sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|PI|E|time|x|y)\b/.test(value);
    
    return hasOperators || hasFunctions;
  }
  
  /**
   * Validate an expression (check if it can be parsed)
   * @param {string} expression - Expression to validate
   * @returns {boolean}
   */
  validate(expression) {
    try {
      this.evaluate(expression, { time: 0, x: 0, y: 0 });
      return true;
    } catch (error) {
      return false;
    }
  }
}