/**
 * UI Controller - handles code execution and calibration
 */

export class UIController {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.codeEditor = document.getElementById('code-editor');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.calibrationComplete = false;
    this.lastExecutedCode = '';
    this.lastScenes = [];
  }
  
  initialize() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.executeCode();
      }
    });
    console.log('✓ UI controller initialized');
  }
  
  async executeCode() {
    const newCode = this.codeEditor.value;
    const isFirstRun = this.lastExecutedCode === '';
    
    try {
      // Simple check: look for first non-whitespace character
      const trimmed = newCode.trim();
      
      console.log('Code starts with:', trimmed.substring(0, 50));
      
      // Check if it starts with { (after removing leading whitespace/newlines)
      const isSequenceFormat = trimmed.startsWith('{');
      
      console.log('Detected format:', isSequenceFormat ? 'SEQUENCE' : 'SCENE');
      
      if (isSequenceFormat) {
        // Parse as sequence configuration
        await this.executeSequenceConfig(trimmed, isFirstRun);
      } else {
        // Parse as traditional scene() function calls
        await this.executeSceneConfig(newCode, isFirstRun);
      }
      
      this.lastExecutedCode = newCode;
      
    } catch (error) {
      console.error('Code execution error:', error);
      this.showError(error.message);
    }
  }
  
  async executeSequenceConfig(code, isFirstRun) {
    console.log('Executing sequence config...');
    
    try {
      // Just wrap and eval - no comment stripping
      console.log('Evaluating code (first 100 chars):', code.substring(0, 100));
      const config = eval(`(${code})`);
      
      console.log('Config parsed successfully:', config);
      
      // Validate it has sequence properties
      if (!config.clips && !config.streams && !config.routing) {
        console.warn('No sequence properties found in config');
        return;
      }
      
      console.log('Loading sequence configuration with clips:', Object.keys(config.clips || {}));
      
      // Create a pseudo-scene for the sequence system
      const scene = {
        id: 1,
        name: 'Sequence Scene',
        config: config
      };
      
      if (isFirstRun) {
        // Initial load - full reload
        console.log('First run - full sequence load');
        this.sceneManager.clearScenes();
        this.sceneManager.registerScene(scene.id, scene.name, scene.config);
        await this.sceneManager.loadScene(0);
      } else {
        // Update - check if structural changes or just parameter changes
        console.log('Update - checking for changes');
        const oldScene = this.lastScenes[0];
        
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
      
      this.lastScenes = [scene];
      
    } catch (error) {
      console.error('Error in executeSequenceConfig:', error);
      console.error('Code that failed:', code.substring(0, 200));
      throw error;
    }
  }
  
  hasSequenceStructuralChanges(oldScene, newScene) {
    const oldConfig = oldScene.config;
    const newConfig = newScene.config;
    
    // Check if clips changed (URLs)
    const oldClips = Object.keys(oldConfig.clips || {}).sort();
    const newClips = Object.keys(newConfig.clips || {}).sort();
    if (oldClips.length !== newClips.length || oldClips.some((c, i) => c !== newClips[i])) {
      console.log('Clip keys changed');
      return true;
    }
    
    for (const clipName of newClips) {
      const oldClip = oldConfig.clips[clipName];
      const newClip = newConfig.clips[clipName];
      if (oldClip.url !== newClip.url || oldClip.start !== newClip.start || oldClip.end !== newClip.end) {
        console.log(`Clip ${clipName} URL or timing changed`);
        return true;
      }
    }
    
    // Check if streams changed (patterns)
    const oldStreams = JSON.stringify(oldConfig.streams || {});
    const newStreams = JSON.stringify(newConfig.streams || {});
    if (oldStreams !== newStreams) {
      console.log('Stream patterns changed');
      return true;
    }
    
    // Check if routing changed
    const oldRouting = JSON.stringify(oldConfig.routing || {});
    const newRouting = JSON.stringify(newConfig.routing || {});
    if (oldRouting !== newRouting) {
      console.log('Routing changed');
      return true;
    }
    
    // Check if camera visibility changed
    if (oldConfig.showCamera !== newConfig.showCamera) {
      console.log('Camera visibility changed');
      return true;
    }
    
    // Only preset effects changed - no structural change
    return false;
  }
  
  async executeSceneConfig(code, isFirstRun) {
    // Capture scenes from user code (traditional scene() function)
    const newScenes = [];
    window.scene = (id, name, config) => newScenes.push({ id, name, config });
    eval(code);
    
    if (newScenes.length === 0) return;
    
    if (isFirstRun) {
      console.log('First run - loading all scenes');
      this.sceneManager.clearScenes();
      newScenes.forEach(s => this.sceneManager.registerScene(s.id, s.name, s.config));
      await this.sceneManager.loadScene(0);
    } else {
      await this.applyDifferentialUpdate(newScenes);
    }
    
    this.lastScenes = JSON.parse(JSON.stringify(newScenes));
  }
  
  async applyDifferentialUpdate(newScenes) {
    console.log('Applying differential update...');
    
    const currentSceneIndex = this.sceneManager.currentSceneIndex;
    const oldScenes = this.lastScenes;
    
    for (let i = 0; i < newScenes.length; i++) {
      const newScene = newScenes[i];
      const oldScene = oldScenes[i];
      
      if (!oldScene) {
        console.log(`Scene ${i}: Added`);
        this.sceneManager.registerScene(newScene.id, newScene.name, newScene.config);
        continue;
      }
      
      const changes = this.detectSceneChanges(oldScene, newScene);
      
      if (changes.urlChanges.length > 0 && i === currentSceneIndex) {
        console.log(`Scene ${i}: URL changes - reloading specific videos:`, changes.urlChanges);
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
  
  detectSceneChanges(oldScene, newScene) {
    const result = { structuralChange: false, parametersOnly: false, urlChanges: [] };
    
    const oldHands = Object.keys(oldScene.config.hands || {});
    const newHands = Object.keys(newScene.config.hands || {});
    const oldBalls = Object.keys(oldScene.config.balls || {});
    const newBalls = Object.keys(newScene.config.balls || {});
    
    if (oldHands.length !== newHands.length || oldBalls.length !== newBalls.length) {
      result.structuralChange = true;
      return result;
    }
    
    // Check URL changes
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
  
  hideLoadingScreen() {
    this.loadingOverlay.classList.add('hidden');
  }
  
  showError(message) {
    const loadingText = this.loadingOverlay.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
      loadingText.style.color = '#ff4444';
    }
  }
  
  onCalibrationComplete() {
    this.calibrationComplete = true;
    this.hideLoadingScreen();
    this.executeCode();
  }
  
  onConnectionChange(connected, message) {
    if (!connected && message) {
      this.showError(message);
    }
  }
}