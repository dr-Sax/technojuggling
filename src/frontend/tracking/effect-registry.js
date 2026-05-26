/**
 * EffectRegistry — manages effect instances and dispatches per-frame updates.
 *
 * Effects implement the Effect class interface: update(), configure(),
 * dispose(), removeBall().
 */

export class EffectRegistry {
  constructor() {
    this.classes = new Map();    // name → Effect class
    this.instances = new Map();  // name → Effect instance
  }

  register(name, EffectClass) {
    this.classes.set(name, EffectClass);
  }

  initialize(sceneManager) {
    for (const [name, EffectClass] of this.classes) {
      this.instances.set(name, new EffectClass(sceneManager));
    }
  }

  get(name)         { return this.instances.get(name) ?? null; }
  has(name)         { return this.instances.has(name); }
  getAllNames()     { return Array.from(this.classes.keys()); }

  /** Apply a config block. Handles enabled toggle + dispose-on-disable. */
  applyConfig(name, config) {
    const effect = this.get(name);
    if (!effect) return;

    const wasEnabled = effect.enabled;
    const willBeEnabled = config.enabled !== false;

    if (wasEnabled && !willBeEnabled) {
      effect.dispose();
      effect.enabled = false;
      return;
    }

    effect.enabled = willBeEnabled;
    const { enabled, ...params } = config;
    effect.configure(params);
  }

  /** Per-frame: dispatch update() to every enabled effect. */
  tick(positions, ctx) {
    for (const effect of this.instances.values()) {
      if (effect.enabled) effect.update(positions, ctx);
    }
  }

  removeBall(ballId) {
    for (const effect of this.instances.values()) {
      effect.removeBall(ballId);
    }
  }

  disposeAll() {
    for (const effect of this.instances.values()) {
      if (effect.enabled) {
        effect.dispose();
        effect.enabled = false;
      }
    }
  }
}

export const effectRegistry = new EffectRegistry();