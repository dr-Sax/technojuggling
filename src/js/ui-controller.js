/**
 * UI Controller - handles DOM interactions and user input
 */

export class UIController {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    
    // DOM elements
    this.codeEditor = document.getElementById('code-editor');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    
    this.calibrationComplete = false;
    this.lastExecutedCode = '';  // Store previous code for differential updates
    this.lastScenes = [];  // Store previous scene configs
  }
  
  initialize() {
    // Button click handlers
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    
    console.log('âœ“ UI controller initialized');
  }
  
  handleKeyboard(e) {
    // Ctrl+Enter to execute code
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      this.executeCode();
      return;
    }
    
    // Don't handle shortcuts if typing in code editor
    if (document.activeElement === this.codeEditor) return;
    
    // Space to next scene
    if (e.key === ' ') {
      e.preventDefault();
      this.nextScene();
    }
    // 'B' to previous scene
    else if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      this.previousScene();
    }
  }
  
  async executeCode() {
    this.setStatus('executing...');
    
    const newCode = this.codeEditor.value;
    const isFirstRun = this.lastExecutedCode === '';
    
    try {
      // Make scene() function available to user code
      const newScenes = [];
      window.scene = (id, name, config) => {
        newScenes.push({ id, name, config });
      };
      
      // Execute user code to capture scenes
      eval(newCode);
      
      if (newScenes.length === 0) {
        this.setStatus('no scenes');
        return;
      }
      
      // Determine update strategy
      if (isFirstRun) {
        // First run: clear and load everything
        console.log('First run - loading all scenes');
        this.sceneManager.clearScenes();
        newScenes.forEach(s => this.sceneManager.registerScene(s.id, s.name, s.config));
      } else {
        // Differential update
        await this.applyDifferentialUpdate(newScenes);
      }
      
      // Store current state
      this.lastExecutedCode = newCode;
      this.lastScenes = JSON.parse(JSON.stringify(newScenes));  // Deep copy
      
      const sceneCount = this.sceneManager.getSceneCount();
      this.setStatus(`loaded ${sceneCount} scenes`);
      
      // Load first scene if first run
      if (isFirstRun) {
        await this.sceneManager.loadScene(0);
        this.updateSceneLabel();
      }
      
      this.setStatus('ready');
      
    } catch (error) {
      console.error('Code execution error:', error);
      this.setStatus('error');
      alert(`Error: ${error.message}`);
    }
  }
  
  async applyDifferentialUpdate(newScenes) {
    console.log('Applying differential update...');
    
    const currentSceneIndex = this.sceneManager.currentSceneIndex;
    const oldScenes = this.lastScenes;
    
    // Compare each scene
    for (let i = 0; i < newScenes.length; i++) {
      const newScene = newScenes[i];
      const oldScene = oldScenes[i];
      
      if (!oldScene) {
        // New scene added
        console.log(`Scene ${i}: Added`);
        this.sceneManager.registerScene(newScene.id, newScene.name, newScene.config);
        continue;
      }
      
      // Check what changed
      const changes = this.detectSceneChanges(oldScene, newScene);
      
      if (changes.urlChanges.length > 0 && i === currentSceneIndex) {
        // Specific URLs changed in current scene - reload only those
        console.log(`Scene ${i}: URL changes - reloading specific videos:`, changes.urlChanges);
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
        
        for (const change of changes.urlChanges) {
          await this.sceneManager.reloadVideo(change.type, change.id, change.config);
        }
        
        // Update parameters for unchanged items
        this.sceneManager.updateSceneParameters(newScene.config);
        
      } else if (changes.structuralChange && i === currentSceneIndex) {
        // Major structural change (hands/balls added/removed)
        console.log(`Scene ${i}: Structural change - full reload`);
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
        await this.sceneManager.loadScene(i);
        
      } else if (changes.parametersOnly) {
        // Only parameters changed
        console.log(`Scene ${i}: Parameters only - updating`);
        this.sceneManager.scenes[i].config = newScene.config;
        
        // Update parameters if it's the current scene
        if (i === currentSceneIndex) {
          this.sceneManager.updateSceneParameters(newScene.config);
        }
      } else {
        // No changes or not current scene
        console.log(`Scene ${i}: No changes or not current`);
        this.sceneManager.scenes[i] = { id: newScene.id, name: newScene.name, config: newScene.config };
      }
    }
    
    // Handle removed scenes
    if (newScenes.length < oldScenes.length) {
      console.log(`Removed ${oldScenes.length - newScenes.length} scenes`);
      this.sceneManager.scenes = this.sceneManager.scenes.slice(0, newScenes.length);
    }
  }
  
  detectSceneChanges(oldScene, newScene) {
    const result = {
      structuralChange: false,
      parametersOnly: false,
      urlChanges: []  // Track which specific URLs changed
    };
    
    // Check for structural changes (hand/ball existence)
    const oldHands = Object.keys(oldScene.config.hands || {});
    const newHands = Object.keys(newScene.config.hands || {});
    
    const oldBalls = Object.keys(oldScene.config.balls || {});
    const newBalls = Object.keys(newScene.config.balls || {});
    
    // Check if hands/balls were added or removed
    if (oldHands.length !== newHands.length || oldBalls.length !== newBalls.length) {
      result.structuralChange = true;
      return result;
    }
    
    // Check which specific video URLs changed
    for (const hand of newHands) {
      if (oldScene.config.hands[hand] && newScene.config.hands[hand] &&
          oldScene.config.hands[hand].url !== newScene.config.hands[hand].url) {
        result.urlChanges.push({
          type: 'hand',
          id: hand,
          config: newScene.config.hands[hand]
        });
      }
    }
    
    for (const ball of newBalls) {
      if (oldScene.config.balls[ball] && newScene.config.balls[ball] &&
          oldScene.config.balls[ball].url !== newScene.config.balls[ball].url) {
        result.urlChanges.push({
          type: 'ball',
          id: ball,
          config: newScene.config.balls[ball]
        });
      }
    }
    
    // Check showCamera
    if (oldScene.config.showCamera !== newScene.config.showCamera) {
      result.structuralChange = true;
      return result;
    }
    
    // If URLs changed, that's what we need to handle
    if (result.urlChanges.length > 0) {
      return result;
    }
    
    // If we got here, only parameters changed
    result.parametersOnly = true;
    return result;
  }
  
  async nextScene() {
    await this.sceneManager.nextScene();
    this.updateSceneLabel();
  }
  
  async previousScene() {
    await this.sceneManager.previousScene();
    this.updateSceneLabel();
  }
  
  updateSceneLabel() {
    // No-op: scene label UI removed
  }
  
  setStatus(text) {
    // No-op: status text UI removed
  }
  
  hideLoadingScreen() {
    this.loadingOverlay.classList.add('hidden');
  }
  
  showLoadingScreen() {
    this.loadingOverlay.classList.remove('hidden');
  }
  
  showError(message) {
    const loadingText = this.loadingOverlay.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
      loadingText.style.color = '#ff4444';
    }
    this.setStatus('error');
  }
  
  onCalibrationComplete() {
    this.calibrationComplete = true;
    this.hideLoadingScreen();
    this.executeCode();
  }
  
  onConnectionChange(connected, message) {
    if (connected) {
      this.setStatus('connected');
      // DON'T hide loading screen yet - wait for calibration
    } else {
      this.setStatus('disconnected');
      if (message) {
        this.showError(message);
      }
    }
  }
}