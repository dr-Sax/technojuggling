/**
 * Sequence - Configuration, parsing, and playback for video sequences
 *
 * Exports:
 *   SequenceConfig  — holds clips/streams/routing, validates references
 *   SequenceParser  — turns a stream pattern string into a timeline
 *   SequencePlayer  — drives the central clock and emits 'clipChange' events
 *
 * StreamPlayer is module-internal (only used by SequencePlayer).
 *
 * A stream pattern looks like:  "A{scale: 20, opacity: .5}"
 *   - clip letter, optional *N repeat, optional {…} effects string
 * Effects strings are plain `key: value` pairs; values may be numbers,
 * enums, or live expressions (evaluated later by the parameter system).
 */


// ============================================================================
// SequenceConfig — schema holder + lookup helpers
// ============================================================================

export class SequenceConfig {
  constructor() {
    this.clips = {};
    this.streams = {};
    this.routing = {};
  }

  loadFromObject(config) {
    this.clips = config.clips || {};
    this.streams = config.streams || {};
    this.routing = config.routing || {};

    this.validate();
  }

  validate() {
    for (const [name, clip] of Object.entries(this.clips)) {
      if (!clip.url) console.warn(`Clip ${name} missing url`);
      if (clip.start === undefined || clip.end === undefined) {
        console.warn(`Clip ${name} missing start/end times`);
      }
    }

    for (const [streamName, pattern] of Object.entries(this.streams)) {
      for (const clipRef of this.extractClipReferences(pattern)) {
        if (!this.clips[clipRef]) {
          console.warn(`Stream ${streamName} references unknown clip: ${clipRef}`);
        }
      }
    }

    for (const [objectId, routeConfig] of Object.entries(this.routing)) {
      const streamName = typeof routeConfig === 'string' ? routeConfig : routeConfig.stream;
      if (!this.streams[streamName]) {
        console.warn(`Routing for ${objectId} references unknown stream: ${streamName}`);
      }
    }
  }

  extractClipReferences(pattern) {
    const matches = pattern.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    return [...new Set(matches.filter((m) => this.clips[m]))];
  }

  getRoutingConfig(objectId) {
    const config = this.routing[objectId];
    if (!config) return null;
    if (typeof config === 'string') return { stream: config, offset: 0 };
    return { stream: config.stream, offset: config.offset || 0 };
  }

  getClip(clipName) {
    return this.clips[clipName];
  }

  getStream(streamName) {
    return this.streams[streamName];
  }
}


// ============================================================================
// SequenceParser — pattern string → timeline
// ============================================================================

export class SequenceParser {
  constructor(config) {
    this.config = config;
  }

  parsePattern(patternString) {
    const tokens = this.tokenize(patternString);
    const timeline = [];
    let currentTime = 0;

    for (const token of tokens) {
      const clip = this.config.getClip(token.clipName);
      if (!clip) {
        console.warn(`Unknown clip: ${token.clipName}`);
        continue;
      }

      const clipDuration = clip.end - clip.start;
      const repeatCount = token.repeat || 1;

      for (let i = 0; i < repeatCount; i++) {
        timeline.push({
          clipName: token.clipName,
          url: clip.url,
          videoStart: clip.start,
          videoEnd: clip.end,
          duration: clipDuration,
          startTime: currentTime,
          endTime: currentTime + clipDuration,
          effectsString: token.effectsString,
        });
        currentTime += clipDuration;
      }
    }

    return { timeline, totalDuration: currentTime };
  }

  tokenize(patternString) {
    const regex = /([A-Z])(?:\*(\d+))?(?:\{([^}]+)\})?/g;
    const tokens = [];
    let match;

    while ((match = regex.exec(patternString)) !== null) {
      tokens.push({
        clipName: match[1],
        repeat: match[2] ? parseInt(match[2]) : 1,
        effectsString: match[3] || '',
      });
    }

    if (tokens.length === 0) {
      console.warn('No clips found in pattern:', patternString);
    }

    return tokens;
  }
}


// ============================================================================
// StreamPlayer — internal, one per stream
// ============================================================================

class StreamPlayer {
  constructor(streamName, pattern, config, offset = 0) {
    this.streamName = streamName;
    this.offset = offset;
    this.config = config;

    const parsed = new SequenceParser(config).parsePattern(pattern);
    this.timeline = parsed.timeline;
    this.totalDuration = parsed.totalDuration;
  }

  /** Parse an effects string ("scale: 20, opacity: .5") into a params object. */
  resolveEffects(effectsString) {
    if (!effectsString) return {};

    const effects = {};
    for (const part of this._splitEffectsParts(effectsString)) {
      const colonIdx = part.indexOf(':');
      if (colonIdx === -1) continue;

      const key = part.slice(0, colonIdx).trim();
      let value = part.slice(colonIdx + 1).trim();

      // Strip surrounding quotes if present — stream effects authored as
      //   A{scale: "sin(time)*20"}
      // arrive here with the literal quote characters still attached, which
      // prevents the expression evaluator from parsing them correctly.
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Numeric if it round-trips cleanly; otherwise keep as string
      // (could be an enum like `circle` or a live expression).
      const num = parseFloat(value);
      effects[key] = !isNaN(num) && String(num) === value ? num : value;
    }
    return effects;
  }

  /** Split on commas that are outside parentheses (so func(a,b) survives). */
  _splitEffectsParts(str) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  getClipAtTime(globalTime) {
    if (this.timeline.length === 0) return null;

    const localTime = globalTime - this.offset;
    if (localTime < 0) return null;

    const loopedTime = localTime % this.totalDuration;

    for (let i = 0; i < this.timeline.length; i++) {
      const clip = this.timeline[i];
      if (loopedTime >= clip.startTime && loopedTime < clip.endTime) {
        return { ...clip, index: i, effects: this.resolveEffects(clip.effectsString) };
      }
    }
    return null;
  }

  getNextClip(currentClipIndex) {
    if (this.timeline.length === 0) return null;
    const nextIndex = (currentClipIndex + 1) % this.timeline.length;
    const clip = this.timeline[nextIndex];
    return { ...clip, index: nextIndex, effects: this.resolveEffects(clip.effectsString) };
  }
}


// ============================================================================
// SequencePlayer — central clock, emits 'clipChange' to listeners
// ============================================================================

export class SequencePlayer {
  constructor(config) {
    this.config = config;
    this.streamPlayers = new Map();
    this.objectAssignments = new Map(); // objectId -> {streamPlayer, offset, currentClipIndex}
    this.startTime = performance.now() / 1000;
    this.listeners = new Map();

    this.initialize();
  }

  initialize() {
    // One StreamPlayer per stream, shared by any objects routed to it.
    for (const [streamName, pattern] of Object.entries(this.config.streams)) {
      this.streamPlayers.set(streamName, new StreamPlayer(streamName, pattern, this.config));
    }

    // Each object tracks its own currentClipIndex.
    for (const objectId of Object.keys(this.config.routing)) {
      const routeConfig = this.config.getRoutingConfig(objectId);
      if (!routeConfig) continue;

      const streamPlayer = this.streamPlayers.get(routeConfig.stream);
      if (streamPlayer) {
        this.objectAssignments.set(objectId, {
          streamPlayer,
          offset: routeConfig.offset,
          currentClipIndex: -1,
        });
      }
    }

    console.log(
      'Sequence player initialized with objects:',
      Array.from(this.objectAssignments.keys())
    );
  }

  /** Fire an initial clipChange for every routed object. */
  triggerInitialClips() {
    const currentTime = this.getCurrentTime();

    for (const [objectId, assignment] of this.objectAssignments) {
      const currentClip = assignment.streamPlayer.getClipAtTime(currentTime + assignment.offset);
      if (currentClip) {
        assignment.currentClipIndex = currentClip.index;
        this.emit('clipChange', {
          objectId,
          clipData: currentClip,
          nextClip: assignment.streamPlayer.getNextClip(currentClip.index),
        });
      } else {
        console.warn(`No initial clip found for ${objectId} at time ${currentTime}`);
      }
    }
  }

  getCurrentTime() {
    return performance.now() / 1000 - this.startTime;
  }

  /** Per-frame: emit clipChange for any object whose clip rolled over. */
  update() {
    const currentTime = this.getCurrentTime();

    for (const [objectId, assignment] of this.objectAssignments) {
      const currentClip = assignment.streamPlayer.getClipAtTime(currentTime + assignment.offset);

      if (currentClip && currentClip.index !== assignment.currentClipIndex) {
        assignment.currentClipIndex = currentClip.index;
        this.emit('clipChange', {
          objectId,
          clipData: currentClip,
          nextClip: assignment.streamPlayer.getNextClip(currentClip.index),
        });
      }
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) callbacks.forEach((cb) => cb(data));
  }
}