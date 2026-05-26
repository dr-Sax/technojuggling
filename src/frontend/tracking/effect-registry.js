/**
 * EffectRegistry — central registry for ball effects.
 *
 * Effects implement a standard interface:
 *   updateBall(ballId, worldPos)   — per-ball update (optional for global effects)
 *   removeBall(ballId)             — per-ball cleanup (optional)
 *   clear()                        — clear all state
 *   setConfig(params)              — apply config params
 *   setEnabled(bool)               — toggle (optional; spacetime uses enable/disable instead)
 */

export class EffectRegistry {
  constructor() {
    this.effects = new Map(); // name -> { class, instance }
  }

  register(name, EffectClass) {
    this.effects.set(name, { name, class: EffectClass, instance: null });
    console.log(`[EffectRegistry] Registered effect: ${name}`);
  }

  initialize(sceneManager, ...additionalArgs) {
    for (const [name, effect] of this.effects.entries()) {
      effect.instance = new effect.class(sceneManager, ...additionalArgs);
      console.log(`[EffectRegistry] Initialized: ${name}`);
    }
  }

  get(name) {
    return this.effects.get(name)?.instance ?? null;
  }

  has(name) {
    return this.effects.has(name);
  }

  getAllNames() {
    return Array.from(this.effects.keys());
  }

  /** Clear every effect's state (called on full reload). */
  clearAll() {
    for (const { instance } of this.effects.values()) {
      if (instance && typeof instance.clear === 'function') {
        instance.clear();
      }
    }
  }

  /** Per-frame: push a ball position to every enabled per-ball effect. */
  updateBall(ballId, worldPos, enabledEffects) {
    for (const [name, { instance }] of this.effects.entries()) {
      if (!enabledEffects.has(name) || !instance) continue;
      if (typeof instance.updateBall === 'function') {
        instance.updateBall(ballId, worldPos);
      }
    }
  }

  /** Remove a ball from every effect that tracks per-ball state. */
  removeBall(ballId) {
    for (const { instance } of this.effects.values()) {
      if (instance && typeof instance.removeBall === 'function') {
        instance.removeBall(ballId);
      }
    }
  }

  /** Apply a config block to one effect. Handles enabled + setConfig. */
  applyConfig(name, config) {
    const instance = this.get(name);
    if (!instance) {
      console.warn(`[EffectRegistry] Effect not found: ${name}`);
      return;
    }

    if (config.enabled !== undefined && typeof instance.setEnabled === 'function') {
      instance.setEnabled(config.enabled);
    }

    if (typeof instance.setConfig === 'function') {
      const { enabled, ...params } = config;
      if (Object.keys(params).length > 0) {
        instance.setConfig(params);
      }
    }
  }

  getDebugInfo() {
    const info = {};
    for (const [name, { instance }] of this.effects.entries()) {
      info[name] = {
        registered: true,
        initialized: !!instance,
        objectCount: instance?.objects?.size || 0,
      };
    }
    return info;
  }
}

export const effectRegistry = new EffectRegistry();