/**
 * Code Executor - parses and executes user code, routing it to the
 * SceneManager's loadConfig (full reload) or updateConfig (light update).
 *
 * Scene groups: a change to the `clipGroups` or `sceneGroups` array is
 * structural (full reload). A change to only `activeGroup` falls through to
 * updateConfig(), which detects the group switch and reloads internally.
 */

export class CodeExecutor {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  async execute(code, isFirstRun, lastConfig) {
    const trimmed = code.trim();
    const config = eval(`(${trimmed})`);

    if (!config.clips && !config.streams && !config.routing &&
        !config.clipGroups && !config.sceneGroups) {
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

    if (JSON.stringify(oldConfig.streams || {}) !== JSON.stringify(newConfig.streams || {})) {
      return true;
    }

    if (JSON.stringify(oldConfig.routing || {}) !== JSON.stringify(newConfig.routing || {})) {
      return true;
    }

    // A change to the groups array itself is structural (full reload). This
    // also catches edits to an effect block inside a group. Changing only
    // activeGroup is NOT flagged here — it falls through to updateConfig(),
    // which detects the group switch and reloads internally.
    if (JSON.stringify(oldConfig.clipGroups || []) !== JSON.stringify(newConfig.clipGroups || [])) {
      return true;
    }
    if (JSON.stringify(oldConfig.sceneGroups || []) !== JSON.stringify(newConfig.sceneGroups || [])) {
      return true;
    }

    if (oldConfig.showCamera !== newConfig.showCamera) {
      return true;
    }

    return false;
  }
}