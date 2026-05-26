/**
 * Scene Manager - Owns the active config, manages ball-to-clip assignments,
 * applies per-frame parameter updates, and applies effect blocks.
 *
 * Authored schema:
 *
 *   clips:        { A: {url, start, end, label?, dwell?, tags?}, ... }
 *   channels:     { ball0: {scale, opacity, mask*, volume, ...}, ... }
 *   scenes:       [ { clips: {ball0: "A"}, ballTrails: {...}, ... }, ... ]
 *   activeScene:  0   // or expression string
 *
 * Each scene declares which clip goes on which ball channel, plus a set of
 * effect blocks (ballTrails, ballConnections, ballSpacetime, ballSincWaves,
 * ballCaptions). Channels are persistent transform state — MIDI knobs
 * modify them and the values stick across scene changes.
 *
 * Two reload paths:
 *
 *   loadConfig   (full reload) — clears balls, assigns scene's clips,
 *                                applies channel params + effect blocks.
 *                                Called on first run and structural changes.
 *
 *   updateConfig (light update) — channel params change, scene index stays.
 *                                Pushes new params to live balls WITHOUT
 *                                touching their video elements (no seek-back,
 *                                no reload). Effect-block param changes
 *                                also apply live via applyAllEffects.
 *
 * The structural-vs-light decision lives in CodeExecutor.
 *
 * MIDI: setMidiState() forwards state to the expression evaluator, so MIDI
 * vars (cc1, ...) work in expressions.
 *
 * Live expressions: any numeric param in any effect block or channel param
 * may be a string expression like "sin(time)*20" or "b0y*5". These are
 * evaluated each frame against a shared context built by getBallContext()
 * — see updateDynamicParameters().
 */
import { CONFIG } from '../core/config.js';
import { ExpressionEvaluator } from './expression-system.js';
import { MediaPool } from './media-pool.js';
import { effectRegistry } from '../tracking/effect-registry.js';

const EFFECT_KEYS = ['ballTrails', 'ballConnections', 'ballSpacetime', 'ballSincWaves', 'ballCaptions'];
const MAX_BALLS = 16;

export class SceneManager {
  constructor(ballManager, wsClient) {
    this.ballManager = ballManager;
    this.wsClient = wsClient;
    this.threeSceneRef = null;
    this.audioProcessorRef = null;
    this.midiState = null;

    this.activeConfig = null;
    this.activeSceneIndex = 0;

    // Map<ballIndex (number), clipKey (string)> — what's currently on each ball.
    // Used by the light-update path to find each ball's channel params and
    // to know which clips are live (for prune).
    this.ballAssignments = new Map();

    // Map<ballIndex (number), channelParams (object)> — last-applied channel
    // params per ball. Per-frame expression evaluation walks this map and
    // re-evaluates any string-valued params against the current context.
    this.ballParams = new Map();

    this.evaluator = new ExpressionEvaluator();
    this.startTime = performance.now() / 1000;

    this.mediaPool = new MediaPool(wsClient);
  }

  // ============================================================================
  // CONFIG LOADING
  // ============================================================================

  /** Load a new configuration (full reload — clears everything). */
  async loadConfig(config) {
    this.ballManager.clearAll();
    this._clearAssignments();

    this.activeConfig = config;
    this.activeSceneIndex = this._resolveSceneIndex(
      config.activeScene,
      Array.isArray(config.scenes) ? config.scenes.length : 0
    );

    const scene = this._currentScene();

    // Resolve captions.autoFromClipLabel here, before effects apply.
    this._applyAutoCaptions(scene);

    // Assign each scene-declared clip to its ball channel.
    await this._assignSceneClips(scene);

    // Hide balls the scene doesn't use.
    this._hideUnusedBalls(scene);

    // Drop pooled clips the scene doesn't reference.
    this._pruneMediaPool(scene);

    const showCamera = config.showCamera !== undefined ? config.showCamera : true;
    this.setCameraVisible(showCamera);

    if (scene.ballConnections) {
      this.applyBallConnectionSettings(scene.ballConnections);
    }

    this._applyAllEffectsFromScene(scene);

    this.resetTime();
  }

  /**
   * Hot-reload from the editor. If the resolved scene index changed, do a
   * full reload; otherwise apply a light update.
   *
   * Light updates push new channel params and effect-block params to live
   * balls WITHOUT touching their video elements. The currently playing
   * video keeps its currentTime/_startTime/_endTime intact — only its
   * render/audio params (scale, opacity, mask, volume, ...) move.
   */
  async updateConfig(config) {
    const newIdx = this._resolveSceneIndex(
      config.activeScene,
      Array.isArray(config.scenes) ? config.scenes.length : 0
    );

    if (newIdx !== this.activeSceneIndex) {
      await this.loadConfig(config);
      return;
    }

    this.activeConfig = config;

    // Re-resolve captions.autoFromClipLabel so the active scene's caption
    // block reflects the assignment (idempotent on the existing texts).
    const scene = this._currentScene();
    this._applyAutoCaptions(scene);

    this._applyLightChannelUpdate(config);

    if (scene.ballConnections) {
      this.applyBallConnectionSettings(scene.ballConnections);
    }

    this._applyAllEffectsFromScene(scene);
  }

  // ============================================================================
  // SCENE STATE
  // ============================================================================

  _currentScene() {
    const scenes = this.activeConfig?.scenes;
    if (!Array.isArray(scenes) || scenes.length === 0) return {};
    return scenes[this.activeSceneIndex] || {};
  }

  /** Resolve activeScene (number or expression string) to a clamped integer. */
  _resolveSceneIndex(value, sceneCount) {
    if (sceneCount === 0) return 0;
    let n = typeof value === 'string' ? this._evalSceneExpression(value) : Number(value);
    if (!Number.isFinite(n)) n = 0;
    return Math.max(0, Math.min(sceneCount - 1, Math.floor(n)));
  }

  _evalSceneExpression(expr) {
    if (this.evaluator?.isExpression?.(expr)) {
      try {
        const t = this.getTime();
        const r = this.evaluator.evaluate(expr, { time: t, t });
        if (Number.isFinite(r)) return r;
      } catch (e) { /* fall through */ }
    }
    try {
      const t = performance.now() / 1000;
      const fn = new Function(
        't', 'time',
        'sin', 'cos', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'PI',
        '"use strict"; return (' + expr + ');'
      );
      const r = fn(
        t, t,
        Math.sin, Math.cos, Math.abs, Math.floor, Math.ceil, Math.round,
        Math.min, Math.max, Math.PI
      );
      return Number.isFinite(r) ? r : 0;
    } catch (e) {
      return 0;
    }
  }

  /** Iterate ball<N> keys in numeric order. Returns [ballIdx, clipKey] pairs. */
  _sceneClipAssignments(scene) {
    const sceneClips = (scene.clips && typeof scene.clips === 'object') ? scene.clips : {};
    return Object.keys(sceneClips)
      .filter(k => /^ball\d+$/.test(k) && sceneClips[k])
      .map(k => [parseInt(k.slice(4), 10), sceneClips[k]])
      .sort((a, b) => a[0] - b[0]);
  }

  /** Channel params for a given ball index (object or empty object). */
  _channelParams(ballIdx) {
    const ch = this.activeConfig?.channels?.[`ball${ballIdx}`];
    return (ch && typeof ch === 'object') ? ch : {};
  }

  _clipDef(clipKey) {
    return this.activeConfig?.clips?.[clipKey] || null;
  }

  // ============================================================================
  // CLIP ASSIGNMENT
  // ============================================================================

  /**
   * Assign each scene-declared clip to its ball channel. Loads the media,
   * builds the ball mesh, and applies the channel's transform params.
   * Called once per full reload.
   */
  async _assignSceneClips(scene) {
    for (const [ballIdx, clipKey] of this._sceneClipAssignments(scene)) {
      await this._assignClipToBall(ballIdx, clipKey);
    }
  }

  async _assignClipToBall(ballIdx, clipKey) {
    const clip = this._clipDef(clipKey);
    if (!clip) {
      console.warn(`[SceneManager] Scene references unknown clip: ${clipKey}`);
      return;
    }

    const objectId = `ball_${ballIdx}`;
    const objectName = String(ballIdx);

    // Don't pass clip.start as videoStart here. MediaPool would pre-seek
    // the cloned <video> element before handing it off, and then
    // MediaObject._configureVideoPlayback would immediately seek again to
    // the same time and call play(). On streaming URLs (YouTube etc.)
    // those back-to-back seeks race — the second seek often fires while
    // the first hasn't settled, and Chrome drops the play() call silently.
    // Symptom: clips with start > 0 don't play. Letting _configureVideoPlayback
    // be the only seeker eliminates the race.
    const media = await this.mediaPool.assignClipToObject(
      objectId, clipKey, clip.url, 0
    );

    this.ballManager.clearBall(objectName);

    const channelParams = this._channelParams(ballIdx);
    await this.ballManager.displayBallMedia(objectName, media, {
      startTime: clip.start || 0,
      endTime: clip.end ?? null,
      locked: false,
      zIndex: channelParams.zIndex ?? 0.1,
      scale: 1.0,
      timeOffset: 0,
    });

    // Stash channel params so the per-frame expression evaluator can
    // re-evaluate any string-expression params each frame.
    this.ballParams.set(ballIdx, channelParams);
    this.ballManager.applyParameters(objectName, channelParams);

    this.ballAssignments.set(ballIdx, clipKey);
  }

  _clearAssignments() {
    this.mediaPool.clear();
    this.ballParams.clear();
    this.ballAssignments.clear();
  }

  _hideUnusedBalls(scene) {
    const assigned = new Set(this._sceneClipAssignments(scene).map(([idx]) => String(idx)));
    for (let i = 0; i < MAX_BALLS; i++) {
      if (!assigned.has(String(i))) {
        this.ballManager.setMediaVisible(String(i), false);
      }
    }
  }

  _pruneMediaPool(scene) {
    const liveClipIds = new Set(this._sceneClipAssignments(scene).map(([, k]) => k));
    for (const clipId of [...this.mediaPool.media.keys()]) {
      if (!liveClipIds.has(clipId)) this.mediaPool.removeMedia(clipId);
    }
  }

  // ============================================================================
  // LIGHT UPDATE — channel params change but clip identity does not
  // ============================================================================

  /**
   * Push new channel params to each currently-assigned ball, WITHOUT
   * touching the video element. This is the MIDI-knob path: the channel's
   * volume/scale/opacity/mask values shift live, but the playing video
   * keeps its currentTime intact.
   */
  _applyLightChannelUpdate(config) {
    for (const [ballIdx] of this.ballAssignments) {
      const channelParams = this._channelParams(ballIdx);
      this.ballParams.set(ballIdx, channelParams);
      this.ballManager.applyParameters(String(ballIdx), channelParams);
    }
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

  /**
   * Build the per-frame expression scope.
   * Single source of truth — connections, captions, spacetime, trails,
   * sincwaves, and channel params all evaluate against this.
   *
   *   time, t                 — seconds since resetTime()
   *   ball_0, ball_1, ...     — { x, y, vx, vy } objects
   *   ball_0_x/_y/_vx/_vy ... — flattened scalar accessors
   *   b0x, b0y, b1x, b1y, ... — short aliases (positions only)
   *   cc1..cc127, note0..., pitchBend, chPressure  — via MIDI state
   */
  getBallContext() {
    const time = this.getTime();
    const ballData = this.ballManager?.getBallData?.() || {};
    return { time, t: time, ...ballData };
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

  /**
   * Evaluate every expression-typed field in a flat effect-config object.
   * - Numbers / booleans / arrays / nested objects pass through unchanged.
   * - Strings are evaluated only if isExpression() (so enums like "mesh",
   *   "circle", "triangle" survive).
   * - The `color` / `gridColor` keys get the color-aware path so hex ints
   *   don't get parsed as expressions.
   * - Returns a shallow copy — does NOT mutate the input.
   */
  evaluateEffectConfig(rawConfig, context) {
    if (!rawConfig || typeof rawConfig !== 'object') return rawConfig;
    const out = {};
    for (const [key, value] of Object.entries(rawConfig)) {
      if (key === 'color' || key === 'gridColor') {
        out[key] = this.evaluateColor(value, context);
      } else if (typeof value === 'string' && this.evaluator.isExpression(value)) {
        const r = this.evaluator.evaluate(value, context);
        out[key] = Number.isFinite(r) ? r : value;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * True if any value in a flat effect-config object is an expression string.
   * Used to decide whether an effect block needs per-frame re-evaluation.
   */
  configHasExpressions(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') return false;
    for (const value of Object.values(rawConfig)) {
      if (typeof value === 'string' && this.evaluator.isExpression(value)) {
        return true;
      }
    }
    return false;
  }

  // ============================================================================
  // PER-FRAME UPDATE (called from animation loop)
  // ============================================================================

  updateDynamicParameters() {
    const context = this.getBallContext();

    // 1. Per-ball channel params (scale, rotation, opacity, ...) that are
    //    expressions — re-evaluate and re-apply.
    this._updateBallExpressions(context);

    // 2. Effect-block params with expressions — re-evaluate and push.
    this._updateEffectExpressions(context);
  }

  /**
   * Walk each ball's channel params. If any value is a string expression,
   * evaluate it against the current frame's context and re-apply. Balls
   * whose params contain no expressions are skipped — no per-frame cost.
   */
  _updateBallExpressions(context) {
    for (const [ballIdx, params] of this.ballParams) {
      let evaluated = null;
      for (const [key, value] of Object.entries(params)) {
        if (this.evaluator.isExpression(value)) {
          if (!evaluated) evaluated = { ...params };
          evaluated[key] = this.evaluator.evaluate(value, context);
        }
      }
      if (evaluated) {
        this.ballManager.applyParameters(String(ballIdx), evaluated);
      }
    }
  }

  /**
   * For each scene effect with expressions in its raw config block,
   * evaluate the block against the current frame's context and push the
   * result through the effect's setConfig (via the registry). Effects
   * whose config has no expressions are skipped — no per-frame cost.
   */
  _updateEffectExpressions(context) {
    const scene = this._currentScene();

    for (const effectName of effectRegistry.getAllNames()) {
      const configKey = `ball${effectName.charAt(0).toUpperCase() + effectName.slice(1)}`;
      const raw = scene[configKey] || scene[effectName];
      if (!raw || raw.enabled === false) continue;
      if (!this.configHasExpressions(raw)) continue;

      const evaluated = this.evaluateEffectConfig(raw, context);
      const { enabled, ...params } = evaluated;
      effectRegistry.applyConfig(effectName, params);
    }
  }

  // ============================================================================
  // BALL CONNECTIONS
  // ============================================================================

  applyBallConnectionSettings(settings) {
    if (settings.enabled !== undefined) {
      this.ballManager.setConnectionsEnabled(settings.enabled);
    }
    if (settings.mode !== undefined) {
      this.ballManager.setConnectionMode(settings.mode);
    }
    // Apply non-expression keys once now (and the current snapshot of any
    // expression keys); per-frame re-evaluation of expressions is handled
    // by _updateEffectExpressions().
    const context = this.getBallContext();
    const evaluated = this.evaluateEffectConfig(settings, context);
    const { enabled, mode, ...params } = evaluated;
    if (Object.keys(params).length > 0) {
      this.ballManager.setConnectionParameters(params);
    }
  }

  // ============================================================================
  // EFFECTS
  // ============================================================================

  /**
   * Walk every registered effect and either apply this scene's block for
   * that effect, or apply { enabled: false } so the effect tears down
   * cleanly when the scene omits it.
   */
  _applyAllEffectsFromScene(scene) {
    for (const effectName of effectRegistry.getAllNames()) {
      const configKey = `ball${effectName.charAt(0).toUpperCase() + effectName.slice(1)}`;
      const settings = scene[configKey] || scene[effectName];

      // Always route through applyEffectSettings so per-effect teardown
      // (e.g. spacetime.disable → camera reset, feed-Z reset) runs on
      // scene switches that drop the block entirely.
      this.applyEffectSettings(effectName, settings || { enabled: false });
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
      // Apply the raw config once on (re)load — strings live in this.config
      // until _updateEffectExpressions() overwrites them per-frame with
      // evaluated values. Non-expression keys settle here and stay put.
      effectRegistry.applyConfig(effectName, settings);
    }
  }

  // ============================================================================
  // CAPTIONS auto-from-label
  // ============================================================================

  /**
   * If ballCaptions has autoFromClipLabel: true, populate texts from each
   * assigned clip's label. Mutates scene.ballCaptions IN PLACE — the live
   * config object — so per-frame effect expression evaluation reads the
   * generated texts.
   */
  _applyAutoCaptions(scene) {
    const captions = scene.ballCaptions;
    if (!captions || !captions.autoFromClipLabel) return;

    const texts = { ...(captions.texts || {}) };
    for (const [ballIdx, clipKey] of this._sceneClipAssignments(scene)) {
      // Honor an explicit per-ball entry already in texts.
      if (texts[ballIdx] !== undefined || texts[String(ballIdx)] !== undefined) continue;
      const clip = this._clipDef(clipKey);
      if (!clip) continue;
      texts[ballIdx] = clip.label || clipKey;
    }
    scene.ballCaptions = { ...captions, texts };
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

  /** Wire MIDI state into the expression evaluator. */
  setMidiState(midiState) {
    this.midiState = midiState;
    this.evaluator.setMidiState(midiState);
  }
}