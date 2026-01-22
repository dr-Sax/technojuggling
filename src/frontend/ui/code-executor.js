/**
 * Code Executor - parses and executes user code (sequence or scene format)
 */

export class CodeExecutor {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }
  
  async execute(code, isFirstRun, lastScenes) {
    const trimmed = code.trim();
    const isSequenceFormat = trimmed.startsWith('{');
    
    console.log('Detected format:', isSequenceFormat ? 'SEQUENCE' : 'SCENE');
    
    if (isSequenceFormat) {
      return await this.executeSequence(trimmed, isFirstRun, lastScenes);
    } else {
      return await this.executeScene(code, isFirstRun);
    }
  }
  
  async executeSequence(code, isFirstRun, lastScenes) {
    const config = eval(`(${code})`);
    
    if (!config.clips && !config.streams && !config.routing) {
      console.warn('No sequence properties found in config');
      return lastScenes;
    }
    
    console.log('Loading sequence configuration with clips:', Object.keys(config.clips || {}));
    
    const scene = {
      id: 1,
      name: 'Sequence Scene',
      config: config
    };
    
    if (isFirstRun) {
      console.log('First run - full sequence load');
      this.sceneManager.clearScenes();
      this.sceneManager.registerScene(scene.id, scene.name, scene.config);
      await this.sceneManager.loadScene(0);
    } else {
      const oldScene = lastScenes[0];
      
      if (this.hasSequenceStructuralChanges(oldScene, scene)) {
        console.log('Structural changes detected - full reload');
        this.sceneManager.clearScenes();
        this.sceneManager.registerScene(scene.id, scene.name, scene.config);
        await this.sceneManager.loadScene(0);
      } else {
        console.log('Parameter-only changes - updating without reload');
        this.sceneManager.scenes[0] = scene;
        this.sceneManager.updateSequenceParameters(scene.config);
      }
    }
    
    return [scene];
  }
  
  hasSequenceStructuralChanges(oldScene, newScene) {
    const oldConfig = oldScene.config;
    const newConfig = newScene.config;
    
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
    
    const oldStreams = JSON.stringify(oldConfig.streams || {});
    const newStreams = JSON.stringify(newConfig.streams || {});
    if (oldStreams !== newStreams) {
      return true;
    }
    
    const oldRouting = JSON.stringify(oldConfig.routing || {});
    const newRouting = JSON.stringify(newConfig.routing || {});
    if (oldRouting !== newRouting) {
      return true;
    }
    
    if (oldConfig.showCamera !== newConfig.showCamera) {
      return true;
    }
    
    return false;
  }
  
  async executeScene(code, isFirstRun) {
    const newScenes = [];
    window.scene = (id, name, config) => newScenes.push({ id, name, config });
    eval(code);
    
    if (newScenes.length === 0) return [];
    
    if (isFirstRun) {
      console.log('First run - loading all scenes');
      this.sceneManager.clearScenes();
      newScenes.forEach(s => this.sceneManager.registerScene(s.id, s.name, s.config));
      await this.sceneManager.loadScene(0);
    }
    
    return JSON.parse(JSON.stringify(newScenes));
  }
}