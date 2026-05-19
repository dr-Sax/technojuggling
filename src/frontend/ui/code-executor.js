/**
 * Code Executor - parses and executes user code, routing it to the
 * SceneManager's loadConfig (full reload) or updateConfig (light update).
 *
 * Scene groups: a change to the `clipGroups` or `sceneGroups` array is
 * structural (full reload). A change to only `activeGroup` falls through to
 * updateConfig(), which detects the group switch and reloads internally.
 */

export class CodeExecutor {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
  }

  async execute(code, isFirstRun, lastConfig) {
    const trimmed = code.trim();
    const config = eval(`(${trimmed})`);

    if (!config.clips && !config.streams && !config.routing &&
        !config.clipGroups && !config.sceneGroups) {
      console.warn('No sequence properties found in config');
      return lastConfig;
    }

    if (isFirstRun) {
      await this.sceneManager.loadConfig(config);
    } else if (this.hasStructuralChanges(lastConfig, config)) {
      await this.sceneManager.loadConfig(config);
    } else {
      await this.sceneManager.updateConfig(config);
    }

    return config;
  }

  hasStructuralChanges(oldConfig, newConfig) {
  if (!oldConfig) return true;

  const oldClips = Object.keys(oldConfig.clips || {}).sort();
  const newClips = Object.keys(newConfig.clips || {}).sort();

  if (oldClips.length !== newClips.length || oldClips.some((c, i) => c !== newClips[i])) {
    return true;
  }

  for (const clipName of newClips) {
    const oldClip = oldConfig.clips[clipName];
    const newClip = newConfig.clips[clipName];
    if (oldClip.url !== newClip.url || oldClip.start !== newClip.start || oldClip.end !== newClip.end) {
      return true;
    }
  }

  if (JSON.stringify(oldConfig.streams || {}) !== JSON.stringify(newConfig.streams || {})) {
    return true;
  }

  if (JSON.stringify(oldConfig.routing || {}) !== JSON.stringify(newConfig.routing || {})) {
    return true;
  }

  // Groups: structural if the group COUNT, per-group STREAMS, or the SET of
  // effect blocks present changes. A change to a numeric value *inside* an
  // effect block is NOT structural — it falls through to updateConfig(),
  // which applies effect params live via applyAllEffects() without reloading
  // clips. This is what makes MIDI knob tweaks cheap.
  if (this.groupsStructurallyDiffer(oldConfig.clipGroups, newConfig.clipGroups)) {
    return true;
  }
  if (this.groupsStructurallyDiffer(oldConfig.sceneGroups, newConfig.sceneGroups)) {
    return true;
  }

  if (oldConfig.showCamera !== newConfig.showCamera) {
    return true;
  }

  return false;
}

/**
 * Compare two group arrays for STRUCTURAL difference, ignoring the parameter
 * values inside effect blocks.
 *
 * Structural = different group count, different `streams` array on any group,
 * or a different set of effect-block keys on any group (e.g. ballTrails added
 * or removed). NOT structural = same shape, only numbers/colors changed inside
 * an effect block — those are handled live by updateConfig → applyAllEffects.
 */
groupsStructurallyDiffer(oldGroups, newGroups) {
  const a = oldGroups || [];
  const b = newGroups || [];
  if (a.length !== b.length) return true;

  for (let i = 0; i < a.length; i++) {
    const ga = a[i] || {};
    const gb = b[i] || {};

    // streams array: compared by value — a routing change IS structural.
    if (JSON.stringify(ga.streams || null) !== JSON.stringify(gb.streams || null)) {
      return true;
    }

    // Effect-block keys present on each group, e.g. ['ballTrails','ballSincWaves'].
    // 'streams' is excluded — handled above. We compare which blocks EXIST,
    // not their contents.
    const keysA = Object.keys(ga).filter(k => k !== 'streams').sort();
    const keysB = Object.keys(gb).filter(k => k !== 'streams').sort();
    if (keysA.length !== keysB.length || keysA.some((k, j) => k !== keysB[j])) {
      return true;
    }

    // One more guard: an effect block flipping enabled true<->false is
    // structural enough to want a clean rebuild (enable/disable paths differ
    // per effect). Param-only changes still fall through.
    for (const k of keysA) {
      const ea = ga[k], eb = gb[k];
      if (ea && eb && typeof ea === 'object' && typeof eb === 'object') {
        if (!!ea.enabled !== !!eb.enabled) return true;
      }
    }
  }
  return false;
}
}