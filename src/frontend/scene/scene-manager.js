/**
 * Scene Manager - Unified scene loading, sequence playback, and parameter evaluation
 *
 * Owns the single active config. Drives sequence playback (clips/streams/
 * routing), per-frame parameter evaluation, and effect application.
 *
 * Scene groups: when the config has `clipGroups` (media only) or `sceneGroups`
 * (media + effects), SceneGroupController synthesizes the `routing` block and
 * overlays the active group's effect blocks onto the config before it loads.
 * Switching `activeGroup` via hot-reload re-binds every ball and re-applies
 * the group's effects.
 *
 * MIDI: setMidiState() forwards state to both this evaluator and the
 * ParameterManager's evaluator, so MIDI vars (cc1, ...) work in expressions.
 */
import { CONFIG } from '../core/config.js';
import { ExpressionEvaluator } from './expression-system.js';
import { SequenceConfig, SequencePlayer } from './sequence.js';
import { MediaPool } from './media-pool.js';
import { ParameterManager } from './parameter-manager.js';
import { SceneGroupController } from './scene-groups.js';
import { effectRegistry } from '../tracking/effect-registry.js';

export class SceneManager {
  constructor(ballManager, wsClient) {
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    this.threeSceneRef = null;
    this.audioProcessorRef = null;
    this.midiState = null;

    this.activeConfig = null;

    this.evaluator = new ExpressionEvaluator();
    this.startTime = performance.now() / 1000;

    this.sequenceConfig = null;
    this.sequencePlayer = null;
    this.mediaPool = new MediaPool(wsClient);
    this.parameterManager = new ParameterManager();
    this.sequenceActive = false;

    this.sceneGroups = new SceneGroupController(this);
  }

  // ============================================================================
  // CONFIG LOADING
  // ============================================================================

  /** Load a new configuration (full reload — clears everything). */
  async loadConfig(config) {
    this.ballManager.clearAll();
    this.clearSequence();

    // Scene groups → synthesize routing + overlay effect blocks before load.
    const usesGroups = SceneGroupController.configUsesGroups(config);
    if (usesGroups) {
      this.sceneGroups.applyToConfig(config);
    }

    this.activeConfig = config;

    await this.loadSequence(config);

    // Hide balls the active group doesn't cover; drop unused clips.
    if (usesGroups) {
      this.sceneGroups.hideUnusedBalls();
      this.sceneGroups.pruneMediaPool();
    }

    const showCamera = config.showCamera !== undefined ? config.showCamera : true;
    this.setCameraVisible(showCamera);

    if (config.routing && config.streams) {
      this.ballManager.setConnectionRouting(config.routing, config.streams);
    }

    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }

    this.applyAllEffects(config);

    this.resetTime();
  }

  /**
   * Hot-reload from the editor. If scene groups are in use and the resolved
   * group index changed, do a full reload; otherwise apply a light update.
   */
  async updateConfig(config) {
    if (SceneGroupController.configUsesGroups(config)) {
      const prevGroup = this.sceneGroups.resolvedGroup;
      this.sceneGroups.applyToConfig(config);
      if (this.sceneGroups.resolvedGroup !== prevGroup) {
        await this.loadConfig(config);
        return;
      }
    }

    this.activeConfig = config;

    this.updateSequenceParameters(config);

    if (config.ballConnections) {
      this.applyBallConnectionSettings(config.ballConnections);
    }

    this.applyAllEffects(config);
  }

  // ============================================================================
  // SEQUENCE PLAYBACK
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

    // offset shifts clock phase — WHERE in the clip loop we start.
    const routeConfig = this.sequenceConfig.getRoutingConfig(objectId);
    const timeOffset = routeConfig ? routeConfig.offset : 0;

    this.ballManager.clearBall(objectName);

    await this.ballManager.displayBallMedia(objectName, media, {
      startTime: clipData.videoStart,
      endTime: clipData.videoEnd,
      locked: false,
      zIndex: clipData.effects.zIndex || 0.1,
      scale: 1.0,
      timeOffset,
    });

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
    if (this.sceneGroups) this.sceneGroups.clear();
    this.sequenceActive = false;
    this.sequenceConfig = null;
    this.sequencePlayer = null;
  }

  // ============================================================================
  // EXPRESSION EVALUATION
  // ============================================================================

  resetTime() {
    this.startTime = performance.now() / 1000;
  }

  getTime() {
    return performance.now() / 1000 - this.startTime;
  }

  evaluateParam(value, context) {
    if (this.evaluator.isExpression(value)) {
      return this.evaluator.evaluate(value, context);
    }
    return value;
  }

  /** Resolve a color value. Configs use plain hex ints; expressions allowed. */
  evaluateColor(colorValue, context) {
    if (typeof colorValue === 'number') return colorValue;
    if (typeof colorValue === 'string') {
      const v = this.evaluateParam(colorValue, context);
      return typeof v === 'number' ? v : 0xffffff;
    }
    return 0xffffff;
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
    for (const effectName of effectRegistry.getAllNames()) {
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

    // Spacetime manages its own camera + scene objects via enable/disable.
    if (effectName === 'spacetime') {
      const effect = effectRegistry.get('spacetime');
      const camera = this.threeSceneRef ? this.threeSceneRef.getCamera() : null;
      if (effect && camera) {
        if (settings.enabled && !effect.active) {
          effect.enable(camera, this.threeSceneRef);
        } else if (settings.enabled === false && effect.active) {
          effect.disable(camera);
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
    return this.threeSceneRef ? this.threeSceneRef.getWebGLScene() : null;
  }

  getPlaneHeight() {
    return this.threeSceneRef ? this.threeSceneRef.getPlaneHeight() : CONFIG.PLANE_HEIGHT;
  }

  getCamera() {
    return this.threeSceneRef ? this.threeSceneRef.getCamera() : null;
  }

  setThreeSceneRef(threeScene) {
    this.threeSceneRef = threeScene;
  }

  setAudioProcessor(audioProcessor) {
    this.audioProcessorRef = audioProcessor;
  }

  /** Wire MIDI state into both expression evaluators (this one + parameterManager's). */
  setMidiState(midiState) {
    this.midiState = midiState;
    this.evaluator.setMidiState(midiState);
    if (this.parameterManager && this.parameterManager.evaluator) {
      this.parameterManager.evaluator.setMidiState(midiState);
    }
  }
}