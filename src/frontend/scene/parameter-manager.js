/**
 * ParameterManager - Single source of truth for all object parameters
 * Handles both static values and dynamic expressions
 */
import { ExpressionEvaluator } from './expression-evaluator.js';

export class ParameterManager {
  constructor() {
    this.evaluator = new ExpressionEvaluator();
    
    // Current complete parameter sets for each object
    this.parameters = {}; // objectId -> { scale: 10, rotation: "sin(time*10)*10", ... }
    
    // Track which parameters have expressions (for optimization)
    this.expressionParams = {}; // objectId -> Set(['rotation', 'opacity'])
  }
  
  /**
   * Set the complete parameter set for an object
   * Called when clip changes or config updates
   */
  setParameters(objectId, params) {
    this.parameters[objectId] = { ...params };
    
    // Identify which params have expressions
    const expressions = new Set();
    for (const [key, value] of Object.entries(params)) {
      if (this.evaluator.isExpression(value)) {
        expressions.add(key);
      }
    }
    this.expressionParams[objectId] = expressions;
    
    // Compact logging - only show the essentials
    const paramSummary = Object.entries(params)
      .map(([k, v]) => {
        if (this.evaluator.isExpression(v)) {
          return `${k}=expr`;  // Mark expressions
        } else if (typeof v === 'number') {
          return `${k}=${v}`;
        } else {
          return `${k}="${v}"`;
        }
      })
      .join(', ');
    
    
    if (expressions.size > 0) {
    }
  }
  
  /**
   * Get current parameters for an object with expressions evaluated
   * Always returns a COMPLETE parameter set
   */
  getParameters(objectId, time, ballData = {}) {
    const params = this.parameters[objectId];
    if (!params) return null;
    
    // Start with all parameters
    const result = { ...params };
    
    // Evaluate expressions in place
    const expressions = this.expressionParams[objectId];
    if (expressions && expressions.size > 0) {
      const context = { time, ...ballData };
      
      for (const key of expressions) {
        const expression = params[key];
        if (this.evaluator.isExpression(expression)) {
          result[key] = this.evaluator.evaluate(expression, context);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Get updates for all objects (for updateFrame)
   * Returns complete parameter sets with evaluated expressions
   */
  getAllUpdates(time, ballData = {}) {
    const updates = [];
    
    for (const objectId of Object.keys(this.parameters)) {
      // Only include objects that have expressions (others don't change per frame)
      if (this.expressionParams[objectId]?.size > 0) {
        const params = this.getParameters(objectId, time, ballData);
        updates.push({ objectId, params });
      }
    }
    
    return updates;
  }
  
  /**
   * Check if any objects have expressions that need per-frame updates
   */
  hasExpressions() {
    return Object.values(this.expressionParams).some(set => set.size > 0);
  }
  
  /**
   * Clear all parameters for an object
   */
  clear(objectId) {
    delete this.parameters[objectId];
    delete this.expressionParams[objectId];
  }
  
  /**
   * Clear all parameters
   */
  clearAll() {
    this.parameters = {};
    this.expressionParams = {};
  }
  
  /**
   * Get raw parameters (without evaluating expressions)
   * Useful for debugging
   */
  getRawParameters(objectId) {
    return this.parameters[objectId] ? { ...this.parameters[objectId] } : null;
  }
}