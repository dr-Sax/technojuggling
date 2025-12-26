/**
 * Scene management - loading, switching, and parameter control
 */
import { CONFIG } from './config.js';

export class SceneManager {
  constructor(handManager, ballManager, wsClient) {
    this.handManager = handManager;
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    
    this.scenes = [];
    this.currentSceneIndex = 0;
    this.parameterValues = {};
    this.footPosition = { x: 0, y: 0 };
  }
  
  // Register a scene (called from user code)
  registerScene(id, name, config) {
    this.scenes.push({ id, name, config });
  }
  
  // Clear all scenes
  clearScenes() {
    this.scenes = [];
    this.currentSceneIndex = 0;
  }
  
  // Load a scene by index
  async loadScene(index) {
    if (index < 0 || index >= this.scenes.length) {
      console.warn('Invalid scene index:', index);
      return;
    }
    
    const sceneData = this.scenes[index];
    this.currentSceneIndex = index;
    
    console.log(`Loading scene: ${sceneData.name}`);
    
    // Clear existing videos
    this.handManager.clearAll();
    this.ballManager.clearAll();
    
    // Load hands
    if (sceneData.config.hands) {
      if (sceneData.config.hands.right) {
        await this.loadHandVideo('right', sceneData.config.hands.right);
      }
      if (sceneData.config.hands.left) {
        await this.loadHandVideo('left', sceneData.config.hands.left);
      }
    }
    
    // Load balls
    if (sceneData.config.balls) {
      for (const [ballId, ballConfig] of Object.entries(sceneData.config.balls)) {
        await this.loadBallVideo(ballId, ballConfig);
      }
    }
    
    // Handle camera visibility (access ThreeSceneManager through handManager)
    if (sceneData.config.showCamera !== undefined) {
      this.handManager.sceneManager.setCameraVisible(sceneData.config.showCamera);
    } else {
      // Default: show camera
      this.handManager.sceneManager.setCameraVisible(true);
    }
    
    // Initialize parameters
    this.initializeSceneParameters(sceneData);
    
    return sceneData;
  }
  
  // Load hand video
  async loadHandVideo(hand, config) {
    try {
      // Request video URL from server
      const data = await this.wsClient.requestVideoUrl(config.url);
      
      if (!data.success) {
        console.error(`Failed to get video URL for ${hand} hand:`, data.error);
        return;
      }
      
      const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
      
      // Display video
      this.handManager.displayHandVideo(
        hand,
        data.url,
        config.start || 0,
        config.end || null,
        zIndex
      );
      
      // Apply parameters
      const params = { ...CONFIG.DEFAULTS, ...config };
      this.handManager.applyParameters(hand, params);
      
      console.log(`✓ Loaded ${hand} hand video`);
      
    } catch (error) {
      console.error(`Error loading ${hand} hand video:`, error);
    }
  }
  
  // Load ball video
  async loadBallVideo(ballId, config) {
    try {
      // Request video URL from server
      const data = await this.wsClient.requestVideoUrl(config.url);
      
      if (!data.success) {
        console.error(`Failed to get video URL for ball ${ballId}:`, data.error);
        return;
      }
      
      const locked = config.locked || false;
      const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
      
      // Display video
      this.ballManager.displayBallVideo(
        ballId,
        data.url,
        config.start || 0,
        config.end || null,
        locked,
        zIndex
      );
      
      // Apply parameters
      const params = { ...CONFIG.DEFAULTS, ...config };
      this.ballManager.applyParameters(ballId, params);
      
      console.log(`✓ Loaded ball ${ballId} video`);
      
    } catch (error) {
      console.error(`Error loading ball ${ballId} video:`, error);
    }
  }
  
  // Reload specific video (for URL changes without clearing others)
  async reloadVideo(type, id, config) {
    if (type === 'hand') {
      console.log(`Reloading ${id} hand video...`);
      await this.loadHandVideo(id, config);
    } else if (type === 'ball') {
      console.log(`Reloading ball ${id} video...`);
      await this.loadBallVideo(id, config);
    }
  }
  
  // Initialize scene parameters
  initializeSceneParameters(scene) {
    this.parameterValues = {};
    
    if (scene.config.balls) {
      Object.keys(scene.config.balls).forEach(ballId => {
        const ball = scene.config.balls[ballId];
        const key = `ball-${ballId}`;
        this.parameterValues[key] = { ...CONFIG.DEFAULTS, ...ball };
      });
    }
    
    if (scene.config.hands) {
      ['right', 'left'].forEach(hand => {
        if (scene.config.hands[hand]) {
          const key = `hand-${hand}`;
          this.parameterValues[key] = { ...CONFIG.DEFAULTS, ...scene.config.hands[hand] };
        }
      });
    }
  }
  
  // Update scene parameters without reloading (for differential updates)
  updateSceneParameters(config) {
    console.log('Updating scene parameters without reload');
    
    // Update hand parameters
    if (config.hands) {
      ['right', 'left'].forEach(hand => {
        if (config.hands[hand]) {
          const key = `hand-${hand}`;
          this.parameterValues[key] = { ...CONFIG.DEFAULTS, ...config.hands[hand] };
          
          // Apply immediately
          this.handManager.applyParameters(hand, this.parameterValues[key]);
        }
      });
    }
    
    // Update ball parameters
    if (config.balls) {
      Object.keys(config.balls).forEach(ballId => {
        const ball = config.balls[ballId];
        const key = `ball-${ballId}`;
        this.parameterValues[key] = { ...CONFIG.DEFAULTS, ...ball };
        
        // Apply immediately
        this.ballManager.applyParameters(ballId, this.parameterValues[key]);
      });
    }
    
    // Update camera visibility if changed
    if (config.showCamera !== undefined) {
      this.handManager.sceneManager.setCameraVisible(config.showCamera);
    }
  }
  
  // Navigate to next scene
  async nextScene() {
    if (this.scenes.length === 0) return;
    this.currentSceneIndex = (this.currentSceneIndex + 1) % this.scenes.length;
    await this.loadScene(this.currentSceneIndex);
  }
  
  // Navigate to previous scene
  async previousScene() {
    if (this.scenes.length === 0) return;
    this.currentSceneIndex = (this.currentSceneIndex - 1 + this.scenes.length) % this.scenes.length;
    await this.loadScene(this.currentSceneIndex);
  }
  
  // Update foot control
  updateFootControl() {
    const scene = this.scenes[this.currentSceneIndex];
    if (!scene) return;
    
    const footX = this.footPosition.x;
    const footY = this.footPosition.y;
    
    // Global foot control
    if (scene.config.global_foot) {
      Object.keys(scene.config.balls || {}).forEach(ballId => {
        const key = `ball-${ballId}`;
        this.applyFootMapping(key, scene.config.global_foot.x, scene.config.global_foot.y, footX, footY);
      });
    }
    
    // Per-ball foot control
    if (scene.config.balls) {
      Object.keys(scene.config.balls).forEach(ballId => {
        const ball = scene.config.balls[ballId];
        if (ball.foot) {
          const key = `ball-${ballId}`;
          this.applyFootMapping(key, ball.foot.x, ball.foot.y, footX, footY);
        }
      });
    }
  }
  
  // Apply foot mapping to parameter
  applyFootMapping(key, xMapping, yMapping, footX, footY) {
    if (!this.parameterValues[key]) return;
    
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    
    if (xMapping) {
      const normalized = (footX + 1) / 2;
      const range = xMapping.range[1] - xMapping.range[0];
      const sensitivity = xMapping.sensitivity || 1.0;
      const value = xMapping.range[0] + (normalized * range * sensitivity);
      
      this.parameterValues[key][xMapping.param] = clamp(value, xMapping.range[0], xMapping.range[1]);
      this.sendParameterUpdate(key);
    }
    
    if (yMapping) {
      const normalized = (footY + 1) / 2;
      const range = yMapping.range[1] - yMapping.range[0];
      const sensitivity = yMapping.sensitivity || 1.0;
      const value = yMapping.range[0] + (normalized * range * sensitivity);
      
      this.parameterValues[key][yMapping.param] = clamp(value, yMapping.range[0], yMapping.range[1]);
      this.sendParameterUpdate(key);
    }
  }
  
  // Send parameter update to video
  sendParameterUpdate(key) {
    const params = this.parameterValues[key];
    
    if (key.startsWith('hand-')) {
      const hand = key.replace('hand-', '');
      this.handManager.applyParameters(hand, params);
    } else if (key.startsWith('ball-')) {
      const ballId = key.replace('ball-', '');
      this.ballManager.applyParameters(ballId, params);
    }
  }
  
  // Getters
  getSceneCount() {
    return this.scenes.length;
  }
  
  getCurrentScene() {
    return this.scenes[this.currentSceneIndex];
  }
  
  getCurrentSceneName() {
    const scene = this.getCurrentScene();
    return scene ? scene.name : '';
  }
}