/**
 * Code Executor - parses and executes user code, routing it to the
 * SceneManager's loadConfig (full reload) or updateConfig (light update).
 *
 * Schema: { clips, channels, scenes, activeScene } — see SceneManager.
 *
 * A change to a scene's clip assignments, channel keys, or which effect
 * blocks a scene declares is structural (full reload). A change to only
 * `activeScene`, channel param values, or numeric values inside an effect
 * block falls through to updateConfig() for live application.
 */

export class CodeExecutor {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  async execute(code, isFirstRun, lastConfig) {
    const trimmed = code.trim();
    const config = eval(`(${trimmed})`);

    if (!config.clips && !config.scenes) {
      console.warn('No sequence properties found in config');
      return lastConfig;
    }

    if (isFirstRun) {
      await this.sceneManager.loadConfig(config);
    } else if (this.hasStructuralChanges(lastConfig, config)) {
      await this.sceneManager.loadConfig(config);
    } else {
      await this.sceneManager.updateConfig(config);
    }

    return config;
  }

  hasStructuralChanges(oldConfig, newConfig) {
    if (!oldConfig) return true;

    // --- Clip library: any change to the set of clips, or any clip's url /
    // start / end, is structural. Optional fields (label, dwell, tags) are
    // metadata only and don't force a reload.
    const oldClips = Object.keys(oldConfig.clips || {}).sort();
    const newClips = Object.keys(newConfig.clips || {}).sort();

    if (oldClips.length !== newClips.length || oldClips.some((c, i) => c !== newClips[i])) {
      return true;
    }

    for (const clipName of newClips) {
      const oldClip = oldConfig.clips[clipName];
      const newClip = newConfig.clips[clipName];
      if (oldClip.url !== newClip.url || oldClip.start !== newClip.start || oldClip.end !== newClip.end) {
        return true;
      }
    }

    // --- Channels: only the SET of channel keys is structural.
    // Per-channel param value changes (scale, volume, mask, etc.) get
    // re-applied to live balls on the light-update path without disturbing
    // playback.
    if (this.channelsStructurallyDiffer(oldConfig.channels, newConfig.channels)) {
      return true;
    }

    // --- Scenes: scene count, per-scene clip assignments, and the set of
    // effect-block keys per scene are structural. Numeric values inside
    // effect blocks fall through to updateConfig → applyAllEffects.
    if (this.scenesStructurallyDiffer(oldConfig.scenes, newConfig.scenes)) {
      return true;
    }

    if (oldConfig.showCamera !== newConfig.showCamera) {
      return true;
    }

    return false;
  }

  /**
   * Channels structurally differ only when the set of channel keys changes.
   * Per-channel param changes fall through and apply live via updateConfig.
   */
  channelsStructurallyDiffer(oldChannels, newChannels) {
    const a = Object.keys(oldChannels || {}).sort();
    const b = Object.keys(newChannels || {}).sort();
    if (a.length !== b.length) return true;
    return a.some((k, i) => k !== b[i]);
  }

  /**
   * Scenes structurally differ when: scene count changes, any scene's clip
   * assignment dict differs (ball-to-clip mapping), or the set of effect
   * blocks present on a scene changes (enable/disable of an effect type).
   * Numeric values inside effect blocks are NOT compared here.
   */
  scenesStructurallyDiffer(oldScenes, newScenes) {
    const a = oldScenes || [];
    const b = newScenes || [];
    if (a.length !== b.length) return true;
    if (a.length === 0) return false;

    for (let i = 0; i < a.length; i++) {
      const sa = a[i] || {};
      const sb = b[i] || {};

      // Clip assignment dict compared by value.
      if (JSON.stringify(sa.clips || null) !== JSON.stringify(sb.clips || null)) {
        return true;
      }

      // Set of effect blocks present (not their values).
      const keysA = Object.keys(sa).filter(k => k !== 'clips').sort();
      const keysB = Object.keys(sb).filter(k => k !== 'clips').sort();
      if (keysA.length !== keysB.length || keysA.some((k, j) => k !== keysB[j])) {
        return true;
      }

      // enabled flag flip on any block is structural.
      for (const k of keysA) {
        const ea = sa[k], eb = sb[k];
        if (ea && eb && typeof ea === 'object' && typeof eb === 'object') {
          if (!!ea.enabled !== !!eb.enabled) return true;
        }
      }
    }
    return false;
  }
}