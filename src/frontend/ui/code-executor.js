/**
 * Code Executor - parses and executes user code (sequence format only)
 * Updated to use SceneManager's simplified loadConfig/updateConfig API
 */

export class CodeExecutor {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }
  
  async execute(code, isFirstRun, lastConfig) {
    const trimmed = code.trim();
    const config = eval(`(${trimmed})`);
    
    if (!config.clips && !config.streams && !config.routing) {
      console.warn('No sequence properties found in config');
      return lastConfig;
    }
    
    if (isFirstRun) {
      await this.sceneManager.loadConfig(config);
    } else {
      if (this.hasStructuralChanges(lastConfig, config)) {
        await this.sceneManager.loadConfig(config);
      } else {
        this.sceneManager.updateConfig(config);
      }
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
    
    if (oldConfig.showCamera !== newConfig.showCamera) {
      return true;
    }
    
    return false;
  }
}