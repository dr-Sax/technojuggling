/**
 * Scene Manager - Unified scene loading, sequence playback, and parameter evaluation
 * 
 * Merges the former SceneManager + SequenceManager into one class.
 * Single expression evaluation path via ExpressionEvaluator + ParameterManager.
 * No more "scene array" abstraction — there's always one active config.
 */
import { CONFIG } from '../core/config.js';
import { ExpressionEvaluator } from './expression-system.js';
import { SequenceConfig, SequencePlayer } from './sequence.js';
import { MediaPool } from './media-pool.js';
import { ParameterManager } from './parameter-manager.js';
import { effectRegistry } from '../tracking/effect-registry.js';

export class SceneManager {
  constructor(ballManager, wsClient) {
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    this.threeSceneRef = null;
    this.audioProcessorRef = null;
    
    // Current active config (replaces this.scenes array)
    this.activeConfig = null;
    
    // Single expression evaluator (replaces ParameterAnimator)
    this.evaluator = new ExpressionEvaluator();
    this.startTime = performance.now() / 1000;
    
    // Sequence playback (formerly in SequenceManager)
    this.sequenceConfig = null;
    this.sequencePlayer = null;
    this.mediaPool = new MediaPool();
    this.parameterManager = new ParameterManager();
    this.sequenceActive = false;
  }
  
  // ============================================================================
  // CONFIG LOADING (replaces registerScene/clearScenes/loadScene)
  // ============================================================================
  
  /**
   * Load a new configuration (full reload — clears everything)
   */
  async loadConfig(config) {
    this.ballManager.clearAll();
    this.clearSequence();
    
    this.activeConfig = config;
    
    // Load sequence (clips/streams/routing)
    await this.loadSequence(config);
    
    // Camera visibility
    const showCamera = config.showCamera !== undefined ? config.showCamera : true;
    this.setCameraVisible(showCamera);
    
    // Pass routing and streams to ball connections if available
    if (config.routing && config.streams) {
      this.ballManager.setConnectionRouting(config.routing, config.streams);
    }

    // Apply ball connections (special case — not in registry)
    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }
    
    // Auto-apply all registered effects
    this.applyAllEffects(config);
    
    this.resetTime();
  }
  
  /**
   * Update parameters without reloading sequences (hot-reload from editor)
   */
  updateConfig(config) {
    this.activeConfig = config;
    
    this.updateSequenceParameters(config);
    
    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }
    
    // Auto-update all registered effects
    this.applyAllEffects(config);
  }

  // ============================================================================
  // SEQUENCE PLAYBACK (absorbed from SequenceManager)
  // ============================================================================
  
  async loadSequence(config) {
    this.sequenceConfig = new SequenceConfig();
    this.sequenceConfig.loadFromObject(config);
    
    this.sequencePlayer = new SequencePlayer(this.sequenceConfig);
    
    this.sequencePlayer.on('clipChange', async (event) => {
      await this.handleClipChange(event);
    });
    
    this.sequencePlayer.triggerInitialClips();
    this.sequenceActive = true;
  }
  
  async handleClipChange(event) {
    const { objectId, clipData, nextClip } = event;
    
    const currentClipId = this.mediaPool.getAssignment(objectId);
    const newClipId = clipData.clipName;
    
    if (currentClipId === newClipId) return;
    
    const media = await this.mediaPool.assignClipToObject(objectId, newClipId, clipData.url);
    
    const objectName = objectId.replace('ball_', '');
    
    // timeOffset comes from routing config (e.g. ball_1: {stream: "streamD", offset: 5})
    // This shifts clock phase — WHERE in the clip loop we start — not the video file position
    const routeConfig = this.sequenceConfig.getRoutingConfig(objectId);
    const timeOffset = routeConfig ? routeConfig.offset : 0;
    
    this.ballManager.clearBall(objectName);
    
    const mediaConfig = {
      startTime: clipData.videoStart,
      endTime: clipData.videoEnd,
      locked: false,
      zIndex: clipData.effects.zIndex || 0.1,
      scale: 1.0,
      timeOffset: timeOffset
    };
    
    await this.ballManager.displayBallMedia(objectName, media, mediaConfig);
    
    const mergedParams = { ...clipData.effects };
    this.parameterManager.setParameters(objectId, mergedParams);
    this.ballManager.applyParameters(objectName, mergedParams);
    
    if (nextClip) {
      this.mediaPool.preloadNext(objectId, nextClip);
    }
  }
  
  updateSequenceParameters(config) {
    if (!this.sequenceActive) return;
    
    this.sequenceConfig.loadFromObject(config);
    
    const currentTime = this.sequencePlayer.getCurrentTime();
    const objectIds = Object.keys(this.parameterManager.parameters);
    
    for (const objectId of objectIds) {
      const assignment = this.sequencePlayer.objectAssignments.get(objectId);
      if (!assignment) continue;
      
      const currentClip = assignment.streamPlayer.getClipAtTime(currentTime);
      if (!currentClip) continue;
      
      this.parameterManager.setParameters(objectId, currentClip.effects);
    }
    
    for (const objectId of objectIds) {
      const objectName = objectId.replace('ball_', '');
      
      const params = this.parameterManager.getRawParameters(objectId);
      this.ballManager.applyParameters(objectName, params);
    }
  }
  
  clearSequence() {
    this.mediaPool.clear();
    this.parameterManager.clearAll();
    this.sequenceActive = false;
    this.sequenceConfig = null;
    this.sequencePlayer = null;
  }

  // ============================================================================
  // EXPRESSION EVALUATION (single path, replaces ParameterAnimator)
  // ============================================================================
  
  resetTime() {
    this.startTime = performance.now() / 1000;
  }
  
  getTime() {
    return (performance.now() / 1000) - this.startTime;
  }
  
  evaluateParam(value, context) {
    if (this.evaluator.isExpression(value)) {
      return this.evaluator.evaluate(value, context);
    }
    return value;
  }
  
  evaluateColor(colorValue, context) {
    if (typeof colorValue === 'number') return colorValue;
    
    if (typeof colorValue === 'object') {
      if (colorValue.hue !== undefined) {
        const hue = this.evaluateParam(colorValue.hue, context);
        const saturation = colorValue.saturation !== undefined 
          ? this.evaluateParam(colorValue.saturation, context) : 1.0;
        const lightness = colorValue.lightness !== undefined 
          ? this.evaluateParam(colorValue.lightness, context) : 0.5;
        return hslToHex(hue % 360, saturation, lightness);
      }
      
      if (colorValue.r !== undefined) {
        const r = this.evaluateParam(colorValue.r, context);
        const g = colorValue.g !== undefined ? this.evaluateParam(colorValue.g, context) : 0;
        const b = colorValue.b !== undefined ? this.evaluateParam(colorValue.b, context) : 0;
        return rgbToHex(r, g, b);
      }
    }
    
    return 0xffffff;
  }
  
  hasExpressions(config) {
    if (!config) return false;
    const checkValue = (value) => {
      if (typeof value === 'string') return this.evaluator.isExpression(value);
      if (typeof value === 'object' && value !== null) {
        return Object.values(value).some(v => 
          typeof v === 'string' && this.evaluator.isExpression(v)
        );
      }
      return false;
    };
    return Object.values(config).some(value => checkValue(value));
  }

  // ============================================================================
  // PER-FRAME UPDATE (called from animation loop)
  // ============================================================================
  
  updateDynamicParameters() {
    const ballData = this.ballManager.getBallData();
    
    if (this.sequenceActive) {
      this.updateSequenceDynamicParameters(ballData);
    }
    
    this.updateBallConnections();
  }
  
  updateSequenceDynamicParameters(ballData = {}) {
    if (!this.sequenceActive) return;
    
    this.sequencePlayer.update();
    
    if (!this.parameterManager.hasExpressions()) return;
    
    const time = this.sequencePlayer.getCurrentTime();
    const updates = this.parameterManager.getAllUpdates(time, ballData);
    
    for (const update of updates) {
      const objectName = update.objectId.replace('ball_', '');
      this.ballManager.applyParameters(objectName, update.params);
    }
  }
  
  // ============================================================================
  // BALL CONNECTIONS
  // ============================================================================
  
  updateBallConnections() {
    if (!this.activeConfig || !this.activeConfig.ballConnections) return;
    
    const connections = this.activeConfig.ballConnections;
    if (!connections.enabled) return;
    
    const params = this.evaluateConnectionParameters(connections);
    if (params) {
      this.ballManager.setConnectionParameters(params);
    }
  }
  
  evaluateConnectionParameters(connectionConfig) {
    if (!connectionConfig || !connectionConfig.enabled) return null;
    
    const time = this.getTime();
    const context = { time, t: time };
    const params = {};
    
    if (connectionConfig.lineWidth !== undefined) {
      params.lineWidth = this.evaluateParam(connectionConfig.lineWidth, context);
    }
    if (connectionConfig.opacity !== undefined) {
      params.opacity = this.evaluateParam(connectionConfig.opacity, context);
    }
    if (connectionConfig.zIndex !== undefined) {
      params.zIndex = this.evaluateParam(connectionConfig.zIndex, context);
    }
    if (connectionConfig.color !== undefined) {
      params.color = this.evaluateColor(connectionConfig.color, context);
    }
    
    // Pass-through non-expression parameters
    for (const key of ['filled', 'perCircleColors', 'circleContents', 'colorMode', 'segments']) {
      if (connectionConfig[key] !== undefined) {
        params[key] = connectionConfig[key];
      }
    }
    
    return Object.keys(params).length > 0 ? params : null;
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

  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  applyAllEffects(config) {
    const effectNames = effectRegistry.getAllNames();
    
    for (const effectName of effectNames) {
      const configKey = `ball${effectName.charAt(0).toUpperCase() + effectName.slice(1)}`;
      const settings = config[configKey] || config[effectName];
      
      if (settings) {
        this.applyEffectSettings(effectName, settings);
      } else {
        this.ballManager.setEffectEnabled(effectName, false);
      }
    }
  }
  
  applyEffectSettings(effectName, settings) {
    if (settings.enabled !== undefined) {
      this.ballManager.setEffectEnabled(effectName, settings.enabled);
    }

    // Spacetime mode: call enable/disable to manage camera and scene objects
    if (effectName === 'spacetime') {
      const effect = effectRegistry.get('spacetime');
      if (effect) {
        const camera = this.threeSceneRef ? this.threeSceneRef.getCamera() : null;
        if (camera) {
          if (settings.enabled && !effect.active) {
            effect.enable(camera, this.threeSceneRef);
          } else if (settings.enabled === false && effect.active) {
            effect.disable(camera);
          }
        }
      }
    }

    if (effectRegistry.has(effectName)) {
      effectRegistry.applyConfig(effectName, settings);
    }
  }
  
  // ============================================================================
  // THREE.JS SCENE DELEGATION
  // ============================================================================
  
  setCameraVisible(visible) {
    if (this.threeSceneRef) this.threeSceneRef.setCameraVisible(visible);
  }
  
  mapCameraToWorld(normalizedX, normalizedY) {
    if (this.threeSceneRef) return this.threeSceneRef.mapCameraToWorld(normalizedX, normalizedY);
    return { x: 0, y: 0 };
  }
  
  getWebGLScene() {
    if (this.threeSceneRef) return this.threeSceneRef.getWebGLScene();
    return null;
  }
  
  getPlaneHeight() {
    if (this.threeSceneRef) return this.threeSceneRef.getPlaneHeight();
    return CONFIG.PLANE_HEIGHT;
  }
  
  getCamera() {
    if (this.threeSceneRef) return this.threeSceneRef.getCamera();
    return null;
  }

  setThreeSceneRef(threeScene) {
    this.threeSceneRef = threeScene;
  }
  
  setAudioProcessor(audioProcessor) {
    this.audioProcessorRef = audioProcessor;
  }
}

// ============================================================================
// Color conversion helpers (standalone functions)
// ============================================================================

function hslToHex(h, s, l) {
  h = h / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

function rgbToHex(r, g, b) {
  r = Math.max(0, Math.min(1, r));
  g = Math.max(0, Math.min(1, g));
  b = Math.max(0, Math.min(1, b));
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}