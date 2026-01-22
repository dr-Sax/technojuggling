/**
 * Scene Differ - detects changes and applies differential updates to scenes
 */

export class SceneDiffer {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }
  
  async applyDifferentialUpdate(newScenes, oldScenes) {
    console.log('Applying differential update...');
    
    const currentSceneIndex = this.sceneManager.currentSceneIndex;
    
    for (let i = 0; i < newScenes.length; i++) {
      const newScene = newScenes[i];
      const oldScene = oldScenes[i];
      
      if (!oldScene) {
        console.log(`Scene ${i}: Added`);
        this.sceneManager.registerScene(newScene.id, newScene.name, newScene.config);
        continue;
      }
      
      const changes = this.detectChanges(oldScene, newScene);
      
      if (changes.urlChanges.length > 0 && i === currentSceneIndex) {
        console.log(`Scene ${i}: URL changes - reloading specific videos`);
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
        
        for (const change of changes.urlChanges) {
          await this.sceneManager.reloadVideo(change.type, change.id, change.config);
        }
        this.sceneManager.updateSceneParameters(newScene.config);
        
      } else if (changes.structuralChange && i === currentSceneIndex) {
        console.log(`Scene ${i}: Structural change - full reload`);
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
        await this.sceneManager.loadScene(i);
        
      } else if (changes.parametersOnly) {
        console.log(`Scene ${i}: Parameters only - updating`);
        this.sceneManager.scenes[i].config = newScene.config;
        if (i === currentSceneIndex) {
          this.sceneManager.updateSceneParameters(newScene.config);
        }
      } else {
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
      }
    }
    
    if (newScenes.length < oldScenes.length) {
      this.sceneManager.scenes = this.sceneManager.scenes.slice(0, newScenes.length);
    }
  }
  
  detectChanges(oldScene, newScene) {
    const result = { structuralChange: false, parametersOnly: false, urlChanges: [] };
    
    const oldHands = Object.keys(oldScene.config.hands || {});
    const newHands = Object.keys(newScene.config.hands || {});
    const oldBalls = Object.keys(oldScene.config.balls || {});
    const newBalls = Object.keys(newScene.config.balls || {});
    
    if (oldHands.length !== newHands.length || oldBalls.length !== newBalls.length) {
      result.structuralChange = true;
      return result;
    }
    
    for (const hand of newHands) {
      if (oldScene.config.hands[hand] && newScene.config.hands[hand] &&
          oldScene.config.hands[hand].url !== newScene.config.hands[hand].url) {
        result.urlChanges.push({ type: 'hand', id: hand, config: newScene.config.hands[hand] });
      }
    }
    
    for (const ball of newBalls) {
      if (oldScene.config.balls[ball] && newScene.config.balls[ball] &&
          oldScene.config.balls[ball].url !== newScene.config.balls[ball].url) {
        result.urlChanges.push({ type: 'ball', id: ball, config: newScene.config.balls[ball] });
      }
    }
    
    if (oldScene.config.showCamera !== newScene.config.showCamera) {
      result.structuralChange = true;
      return result;
    }
    
    if (result.urlChanges.length > 0) return result;
    
    result.parametersOnly = true;
    return result;
  }
}