/**
 * SceneGroupController — index-based scene groups.
 *
 * A "scene group" is a complete look: which clips are on the balls AND which
 * effects (trails, connections, spacetime, sincwaves) are active and how they
 * are configured. One value — `activeGroup` — indexes through them.
 *
 * Two config forms are supported:
 *
 *   1. clipGroups (media only — legacy):
 *        clipGroups: [
 *          ["streamA", "streamB", "streamC"],   // group 0
 *          ["streamD", "streamE"],              // group 1
 *        ],
 *        activeGroup: 0,
 *
 *   2. sceneGroups (media + effects — full look per index):
 *        sceneGroups: [
 *          {
 *            streams: ["streamA", "streamB", "streamC"],
 *            ballConnections: { enabled: true, mode: "mesh", color: 0x00ffff },
 *            ballTrails:      { enabled: true, count: 5 },
 *          },
 *          {
 *            streams: ["streamD", "streamE", "streamF"],
 *            ballTrails: { enabled: true, count: 12, sides: 3 },
 *            // no ballConnections → connections OFF in this group
 *          },
 *          {
 *            // no streams → balls carry no video, but effects still run
 *            ballSincWaves: { enabled: true },
 *          },
 *        ],
 *        activeGroup: 0,
 *
 * Semantics:
 *   - `streams` maps positionally to balls (index 0 → ball_0, ...).
 *   - `streams` absent/empty → balls carry no media; effects still render
 *     off tracked positions.
 *   - An effect block present → that effect ON with those params.
 *   - An effect block ABSENT → that effect OFF for this group. Each index is
 *     a complete, self-contained look.
 *
 * Mechanics: applyToConfig() mutates the config IN PLACE before the sequence
 * loads — it writes the synthesized `routing` block and overlays the active
 * group's effect blocks. The existing loadConfig / applyAllEffects path then
 * does the media swap and effect application unchanged.
 */

// Effect config-block keys the controller manages. Anything in this list that
// a group omits is removed from the config, so applyAllEffects disables it.
const EFFECT_KEYS = ['ballTrails', 'ballConnections', 'ballSpacetime', 'ballSincWaves', 'ballCaptions'];

export class SceneGroupController {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.groups = [];          // normalized: array of {streams, effects:{...}}
    this.activeGroupRaw = 0;   // number or expression string, as authored
    this.resolvedGroup = 0;    // last resolved integer index
  }

  /** True if the config uses either group form. */
  static configUsesGroups(config) {
    return Array.isArray(config.clipGroups) || Array.isArray(config.sceneGroups);
  }

  /**
   * Normalize whichever group form the config uses into a common shape:
   *   { streams: string[], effects: { ballTrails?: {...}, ... } }
   */
  _normalizeGroups(config) {
    if (Array.isArray(config.sceneGroups)) {
      return config.sceneGroups.map((g) => {
        const effects = {};
        for (const key of EFFECT_KEYS) {
          if (g[key] !== undefined) effects[key] = g[key];
        }
        return { streams: Array.isArray(g.streams) ? g.streams : [], effects };
      });
    }
    if (Array.isArray(config.clipGroups)) {
      // Legacy media-only form — no effect blocks per group.
      return config.clipGroups.map((streams) => ({
        streams: Array.isArray(streams) ? streams : [],
        effects: {},
      }));
    }
    return [];
  }

  /**
   * Build the active group's routing + effect blocks and write them onto the
   * config IN PLACE. Call before SequenceConfig.loadFromObject(config).
   * Returns the resolved integer group index.
   */
  applyToConfig(config) {
    this.groups = this._normalizeGroups(config);
    this.activeGroupRaw = config.activeGroup ?? 0;

    const idx = this._resolveGroupIndex(this.activeGroupRaw, this.groups.length);
    this.resolvedGroup = idx;

    const group = this.groups[idx] || { streams: [], effects: {} };

    // --- Media: positional stream → ball routing ---
    const routing = {};
    group.streams.forEach((streamName, i) => {
      routing[`ball_${i}`] = { stream: streamName, offset: 0 };
    });
    config.routing = routing;

    // --- Effects: overlay this group's blocks, clear the rest ---
    // Only touch keys this controller manages, so unrelated config is left
    // alone. A managed key absent from the group is deleted → effect OFF.
    for (const key of EFFECT_KEYS) {
      if (group.effects[key] !== undefined) {
        config[key] = group.effects[key];
      } else {
        delete config[key];
      }
    }

    return idx;
  }

  /**
   * Hide balls the active group's stream list doesn't cover. Effects still
   * run on those balls' positions — only their media mesh is hidden.
   */
  hideUnusedBalls(maxBalls = 16) {
    const group = this.groups[this.resolvedGroup] || { streams: [] };
    for (let i = group.streams.length; i < maxBalls; i++) {
      this.sceneManager.ballManager.media.setVisible(String(i), false);
    }
  }

  /** Dispose pooled clips the active group no longer references. */
  pruneMediaPool() {
    const config = this.sceneManager.sequenceConfig;
    if (!config) return;
    const pool = this.sceneManager.mediaPool;

    const group = this.groups[this.resolvedGroup] || { streams: [] };
    const liveClipIds = new Set();
    for (const streamName of group.streams) {
      const clipId = this._firstClipOfStream(streamName);
      if (clipId) liveClipIds.add(clipId);
    }

    for (const clipId of [...pool.media.keys()]) {
      if (!liveClipIds.has(clipId)) pool.removeMedia(clipId);
    }
  }

  /** Resolve activeGroup (number or expression string) to a clamped integer. */
  _resolveGroupIndex(value, groupCount) {
    if (groupCount === 0) return 0;

    let n = typeof value === 'string' ? this._evalExpression(value) : Number(value);
    if (!Number.isFinite(n)) n = 0;

    return Math.max(0, Math.min(groupCount - 1, Math.floor(n)));
  }

  /** Evaluate an expression string for activeGroup (supports MIDI vars). */
  _evalExpression(expr) {
    const sm = this.sceneManager;
    if (sm?.evaluator?.isExpression && sm.evaluator.isExpression(expr)) {
      try {
        const t = sm.getTime ? sm.getTime() : 0;
        const result = sm.evaluator.evaluate(expr, { time: t, t });
        if (Number.isFinite(result)) return result;
      } catch (e) {
        /* fall through */
      }
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

  /** First clip token referenced by a stream pattern (e.g. "A{...}" → "A"). */
  _firstClipOfStream(streamName) {
    const config = this.sceneManager.sequenceConfig;
    const pattern = config?.getStream(streamName);
    if (!pattern) return null;
    const refs = config.extractClipReferences(pattern);
    return refs[0] || null;
  }

  clear() {
    this.groups = [];
    this.activeGroupRaw = 0;
    this.resolvedGroup = 0;
  }
}