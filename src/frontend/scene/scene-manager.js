/**
 * Scene Manager - Core scene loading and parameter management
 * Updated to use expression-system.js only
 */
import { CONFIG } from '../core/config.js';
import { ParameterAnimator } from './expression-system.js';
import { SequenceManager } from './sequence-manager.js';

export class SceneManager {
  constructor(ballManager, wsClient) {
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    this.scenes = [];
    this.currentSceneIndex = 0;
    this.animator = new ParameterAnimator();
    this.threeSceneRef = null;
    
    this.sequenceManager = new SequenceManager(
      this,
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
    
    // Always load as sequence
    await this.loadSequenceScene(sceneData);
    
    return sceneData;
  }
  
  async loadSequenceScene(sceneData) {
    this.ballManager.clearAll();
    this.sequenceManager.clear();
    
    await this.sequenceManager.loadSequence(sceneData.config);
    
    const showCamera = sceneData.config.showCamera !== undefined ? sceneData.config.showCamera : true;
    this.setCameraVisible(showCamera);
    
    // Pass routing and streams to ball connections if available
    if (sceneData.config.routing && sceneData.config.streams) {
      this.ballManager.setConnectionRouting(sceneData.config.routing, sceneData.config.streams);
    }

    if (sceneData.config.ballConnections) {
      this.applyBallConnectionSettings(sceneData.config.ballConnections);
    }
    
    this.animator.resetTime();
  }
  
  updateDynamicParameters() {
    // Get current ball data from ball manager
    const ballData = this.ballManager.getBallData();
    
    if (this.sequenceManager.isActive) {
      this.sequenceManager.updateDynamicParameters(ballData);
      this.updateBallConnections();
      return;
    }
    
    this.updateBallConnections();
  }
  
  hasConnectionExpressions() {
    const sceneData = this.scenes[this.currentSceneIndex];
    if (!sceneData || !sceneData.config.ballConnections) return false;
    return this.animator.hasExpressions(sceneData.config.ballConnections);
  }
  
  updateBallConnections() {
    const sceneData = this.scenes[this.currentSceneIndex];
    if (!sceneData || !sceneData.config.ballConnections) return;
    
    const connections = sceneData.config.ballConnections;
    if (!connections.enabled) return;
    
    const params = this.evaluateConnectionParameters(connections);
    
    if (params) {
      this.ballManager.setConnectionParameters(params);
    }
  }
  
  evaluateConnectionParameters(connectionConfig) {
    if (!connectionConfig || !connectionConfig.enabled) {
      return null;
    }
    
    const time = this.animator.getTime();
    const context = { time, t: time };
    const params = {};
    
    if (connectionConfig.lineWidth !== undefined) {
      params.lineWidth = this.animator.evaluateParameter(connectionConfig.lineWidth, context);
    }
    
    if (connectionConfig.opacity !== undefined) {
      params.opacity = this.animator.evaluateParameter(connectionConfig.opacity, context);
    }
    
    if (connectionConfig.zIndex !== undefined) {
      params.zIndex = this.animator.evaluateParameter(connectionConfig.zIndex, context);
    }
    
    if (connectionConfig.color !== undefined) {
      params.color = this.animator.evaluateColor(connectionConfig.color, context);
    }
    
    // Pass through non-expression parameters
    if (connectionConfig.filled !== undefined) {
      params.filled = connectionConfig.filled;
    }
    
    if (connectionConfig.perCircleColors !== undefined) {
      params.perCircleColors = connectionConfig.perCircleColors;
    }
    
    if (connectionConfig.circleContents !== undefined) {
      params.circleContents = connectionConfig.circleContents;
    }
    
    if (connectionConfig.colorMode !== undefined) {
      params.colorMode = connectionConfig.colorMode;
    }
    
    if (connectionConfig.segments !== undefined) {
      params.segments = connectionConfig.segments;
    }
    
    return Object.keys(params).length > 0 ? params : null;
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
    
    const params = this.evaluateConnectionParameters(settings);
    if (params) {
      this.ballManager.setConnectionParameters(params);
    }
  }
  
  setCameraVisible(visible) {
    // Delegate to ThreeSceneManager
    if (this.threeSceneRef) {
      this.threeSceneRef.setCameraVisible(visible);
    }
  }
  
  mapCameraToWorld(normalizedX, normalizedY) {
    // Delegate to ThreeSceneManager
    if (this.threeSceneRef) {
      return this.threeSceneRef.mapCameraToWorld(normalizedX, normalizedY);
    }
    return { x: 0, y: 0 };
  }
  
  getWebGLScene() {
    if (this.threeSceneRef) {
      return this.threeSceneRef.getWebGLScene();
    }
    return null;
  }
  
  getPlaneHeight() {
    if (this.threeSceneRef) {
      return this.threeSceneRef.getPlaneHeight();
    }
    return CONFIG.PLANE_HEIGHT;
  }
  
  setThreeSceneRef(threeScene) {
    this.threeSceneRef = threeScene;
  }
  
  getSceneCount() {
    return this.scenes.length;
  }
}