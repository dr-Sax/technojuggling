/**
 * EffectRegistry - Central registry for ball effects
 * 
 * Effects register themselves with metadata, and the registry handles
 * all the plumbing automatically. No need to modify scene-manager or
 * ball-tracking when adding new effects.
 */

export class EffectRegistry {
  constructor() {
    this.effects = new Map(); // effectName -> {class, instance, metadata}
  }
  
  /**
   * Register an effect
   * @param {string} name - Effect name (e.g., 'trails', 'ripples')
   * @param {class} EffectClass - The effect class
   * @param {object} metadata - Configuration metadata
   */
  register(name, EffectClass, metadata = {}) {
    this.effects.set(name, {
      name,
      class: EffectClass,
      instance: null,
      metadata: {
        updateMethod: metadata.updateMethod || 'updateBall', // Method to call per ball
        requiresWorldPos: metadata.requiresWorldPos !== false, // Needs world coordinates
        hasEnabled: metadata.hasEnabled !== false, // Has enabled/disabled state
        hasConfig: metadata.hasConfig !== false, // Has setConfig method
        clearMethod: metadata.clearMethod || 'clear', // Method to clear all
        removeBallMethod: metadata.removeBallMethod || 'removeBall', // Method per ball removal
        ...metadata
      }
    });
    
    console.log(`[EffectRegistry] Registered effect: ${name}`);
  }
  
  /**
   * Initialize all registered effects
   */
  initialize(sceneManager, ...additionalArgs) {
    for (const [name, effect] of this.effects.entries()) {
      effect.instance = new effect.class(sceneManager, ...additionalArgs);
      console.log(`[EffectRegistry] Initialized: ${name}`);
    }
  }
  
  /**
   * Get effect instance
   */
  get(name) {
    const effect = this.effects.get(name);
    return effect ? effect.instance : null;
  }
  
  /**
   * Get effect metadata
   */
  getMetadata(name) {
    const effect = this.effects.get(name);
    return effect ? effect.metadata : null;
  }
  
  /**
   * Check if effect is registered
   */
  has(name) {
    return this.effects.has(name);
  }
  
  /**
   * Get all effect names
   */
  getAllNames() {
    return Array.from(this.effects.keys());
  }
  
  /**
   * Clear all effects
   */
  clearAll() {
    for (const [name, effect] of this.effects.entries()) {
      if (effect.instance && effect.metadata.clearMethod) {
        effect.instance[effect.metadata.clearMethod]();
      }
    }
  }
  
  /**
   * Update a ball across all enabled effects
   */
  updateBall(ballId, worldPos, enabledEffects) {
    for (const [name, effect] of this.effects.entries()) {
      if (!enabledEffects.has(name) || !effect.instance) continue;
      
      const metadata = effect.metadata;
      if (metadata.updateMethod) {
        effect.instance[metadata.updateMethod](ballId, worldPos);
      }
    }
  }
  
  /**
   * Remove a ball from all effects
   */
  removeBall(ballId) {
    for (const [name, effect] of this.effects.entries()) {
      if (effect.instance && effect.metadata.removeBallMethod) {
        effect.instance[effect.metadata.removeBallMethod](ballId);
      }
    }
  }
  
  /**
   * Apply configuration to an effect
   */
  applyConfig(name, config) {
    const effect = this.effects.get(name);
    if (!effect || !effect.instance) {
      console.warn(`[EffectRegistry] Effect not found: ${name}`);
      return;
    }
    
    const metadata = effect.metadata;
    
    // Handle enabled state
    if (config.enabled !== undefined && metadata.hasEnabled) {
      // Effects track their own enabled state or we track it externally
      if (effect.instance.setEnabled) {
        effect.instance.setEnabled(config.enabled);
      }
    }
    
    // Handle configuration
    if (metadata.hasConfig && effect.instance.setConfig) {
      // Extract just the config params (not 'enabled')
      const { enabled, ...params } = config;
      if (Object.keys(params).length > 0) {
        effect.instance.setConfig(params);
      }
    }
  }
  
  /**
   * Get debug info from all effects
   */
  getDebugInfo() {
    const info = {};
    for (const [name, effect] of this.effects.entries()) {
      info[name] = {
        registered: true,
        initialized: !!effect.instance,
        objectCount: effect.instance?.objects?.size || 0
      };
    }
    return info;
  }
}

// Global singleton instance
export const effectRegistry = new EffectRegistry();