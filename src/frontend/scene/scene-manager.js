/**
 * Scene Manager - Core scene loading and parameter management
 */
import { CONFIG } from '../core/config.js';
import { ParameterAnimator } from './parameter-animator.js';
import { SequenceManager } from './sequence-manager.js';
import { BallConnectionsAnimator } from './ball-connections-animator.js';

export class SceneManager {
  constructor(handManager, ballManager, wsClient) {
    this.handManager = handManager;
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    this.scenes = [];
    this.currentSceneIndex = 0;
    this.parameterValues = {};
    this.animator = new ParameterAnimator();
    this.connectionsAnimator = new BallConnectionsAnimator();
    
    this.sequenceManager = new SequenceManager(
      this,
      handManager,
      ballManager,
      this.animator
    );
  }
  
  registerScene(id, name, config) {
    this.scenes.push({ id, name, config });
  }
  
  clearScenes() {
    this.scenes = [];
    this.currentSceneIndex = 0;
  }
  
  async loadScene(index) {
    if (index < 0 || index >= this.scenes.length) return;
    
    const sceneData = this.scenes[index];
    this.currentSceneIndex = index;
    console.log(`Loading scene: ${sceneData.name}`);
    
    if (sceneData.config.clips || sceneData.config.streams || sceneData.config.routing) {
      await this.loadSequenceScene(sceneData);
    } else {
      await this.loadTraditionalScene(sceneData);
    }
    
    return sceneData;
  }
  
  async loadSequenceScene(sceneData) {
    this.handManager.clearAll();
    this.ballManager.clearAll();
    this.sequenceManager.clear();
    
    await this.sequenceManager.loadSequence(sceneData.config);
    
    const showCamera = sceneData.config.showCamera !== undefined ? sceneData.config.showCamera : true;
    this.handManager.sceneManager.setCameraVisible(showCamera);
    
    if (sceneData.config.ballConnections) {
      this.applyBallConnectionSettings(sceneData.config.ballConnections);
    }
    
    this.animator.resetTime();
    this.connectionsAnimator.resetTime();
  }
  
  async loadTraditionalScene(sceneData) {
    this.sequenceManager.clear();
    this.handManager.clearAll();
    this.ballManager.clearAll();
    
    if (sceneData.config.hands) {
      if (sceneData.config.hands.right) {
        await this.loadHandVideo('right', sceneData.config.hands.right);
      }
      if (sceneData.config.hands.left) {
        await this.loadHandVideo('left', sceneData.config.hands.left);
      }
    }
    
    if (sceneData.config.balls) {
      for (const [ballId, ballConfig] of Object.entries(sceneData.config.balls)) {
        await this.loadBallVideo(ballId, ballConfig);
      }
    }
    
    const showCamera = sceneData.config.showCamera !== undefined ? sceneData.config.showCamera : true;
    this.handManager.sceneManager.setCameraVisible(showCamera);
    
    if (sceneData.config.ballConnections) {
      this.applyBallConnectionSettings(sceneData.config.ballConnections);
    }
    
    this.initializeSceneParameters(sceneData);
    this.animator.registerScene(sceneData.config);
    this.animator.resetTime();
    this.connectionsAnimator.resetTime();
  }
  
  async loadHandVideo(hand, config) {
    try {
      let videoUrl = config.url;
      
      if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
        videoUrl = `../../assets/videos/${videoUrl}`;
      }
      
      this.handManager.displayHandVideo(
        hand,
        videoUrl,
        config.start || 0,
        config.end || null,
        config.zIndex !== undefined ? config.zIndex : 0.1
      );
      
      this.handManager.applyParameters(hand, { ...CONFIG.DEFAULTS, ...config });
    } catch (error) {
      console.error(`Error loading ${hand} hand video:`, error);
    }
  }
  
  async loadBallVideo(ballId, config) {
    try {
      let videoUrl = config.url;
      
      if (!videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {
        videoUrl = `../../assets/videos/${videoUrl}`;
      }
      
      this.ballManager.displayBallVideo(
        ballId,
        videoUrl,
        config.start || 0,
        config.end || null,
        config.locked || false,
        config.zIndex !== undefined ? config.zIndex : 0.1
      );
      
      this.ballManager.applyParameters(ballId, { ...CONFIG.DEFAULTS, ...config });
    } catch (error) {
      console.error(`Error loading ball ${ballId} video:`, error);
    }
  }
  
  async reloadVideo(type, id, config) {
    if (type === 'hand') {
      await this.loadHandVideo(id, config);
    } else if (type === 'ball') {
      await this.loadBallVideo(id, config);
    }
  }
  
  initializeSceneParameters(sceneData) {
    this.parameterValues = {};
    
    if (sceneData.config.hands) {
      for (const [hand, config] of Object.entries(sceneData.config.hands)) {
        this.parameterValues[`hand-${hand}`] = { ...CONFIG.DEFAULTS, ...config };
      }
    }
    
    if (sceneData.config.balls) {
      for (const [ballId, config] of Object.entries(sceneData.config.balls)) {
        this.parameterValues[`ball-${ballId}`] = { ...CONFIG.DEFAULTS, ...config };
      }
    }
  }
  
  updateDynamicParameters() {
    // Get current ball data from ball manager
    const ballData = this.ballManager.getBallData();
    
    if (this.sequenceManager.isActive) {
      this.sequenceManager.updateDynamicParameters(ballData);
      this.updateBallConnections();
      return;
    }
    
    if (!this.animator.hasExpressions() && !this.hasConnectionExpressions()) {
      this.updateBallConnections();
      return;
    }
    
    const positions = {
      hands: {
        right: this.handManager.getHandPosition('right'),
        left: this.handManager.getHandPosition('left')
      },
      balls: this.ballManager.getAllBallPositions()
    };
    
    const updates = this.animator.updateFrame(positions, this.parameterValues, ballData);
    
    for (const update of updates) {
      const manager = update.type === 'hand' ? this.handManager : this.ballManager;
      manager.applyParameters(update.id, update.params);
    }
    
    this.updateBallConnections();
  }
  
  hasConnectionExpressions() {
    const sceneData = this.scenes[this.currentSceneIndex];
    if (!sceneData || !sceneData.config.ballConnections) return false;
    return this.connectionsAnimator.hasExpressions(sceneData.config.ballConnections);
  }
  
  updateBallConnections() {
    const sceneData = this.scenes[this.currentSceneIndex];
    if (!sceneData || !sceneData.config.ballConnections) return;
    
    const connections = sceneData.config.ballConnections;
    if (!connections.enabled) return;
    
    const params = this.connectionsAnimator.evaluateParameters(connections);
    
    if (params) {
      this.ballManager.setConnectionParameters(params);
    }
  }
  
  updateSceneParameters(config) {
    if (config.hands) {
      for (const [hand, handConfig] of Object.entries(config.hands)) {
        const params = { ...CONFIG.DEFAULTS, ...handConfig };
        this.handManager.applyParameters(hand, params);
        this.parameterValues[`hand-${hand}`] = params;
      }
    }
    
    if (config.balls) {
      for (const [ballId, ballConfig] of Object.entries(config.balls)) {
        const params = { ...CONFIG.DEFAULTS, ...ballConfig };
        this.ballManager.applyParameters(ballId, params);
        this.parameterValues[`ball-${ballId}`] = params;
      }
    }
    
    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }
  }
  
  updateSequenceParameters(config) {
    this.sequenceManager.updateParameters(config);
    
    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }
  }
  
  applyBallConnectionSettings(settings) {
    if (settings.enabled !== undefined) {
      this.ballManager.setConnectionsEnabled(settings.enabled);
    }
    
    if (settings.mode !== undefined) {
      this.ballManager.setConnectionMode(settings.mode);
    }
    
    const params = this.connectionsAnimator.evaluateParameters(settings);
    if (params) {
      this.ballManager.setConnectionParameters(params);
    }
  }
  
  mapCameraToWorld(normalizedX, normalizedY) {
    return this.handManager.sceneManager.mapCameraToWorld(normalizedX, normalizedY);
  }
  
  getWebGLScene() {
    return this.handManager.sceneManager.getWebGLScene();
  }
  
  getPlaneHeight() {
    return this.handManager.sceneManager.getPlaneHeight();
  }
  
  getSceneCount() {
    return this.scenes.length;
  }
}