/**
 * Sequence - Configuration, parsing, and playback for video sequences
 *
 * Merged from sequence-core.js + sequence-player.js.
 *
 * Exports:
 *   SequenceConfig  — holds clips/presets/streams/routing, validates references
 *   SequenceParser  — turns a stream pattern string into a timeline
 *   SequencePlayer  — drives the central clock and emits 'clipChange' events
 *
 * StreamPlayer stays module-internal (only used by SequencePlayer).
 */


// ============================================================================
// SequenceConfig — schema holder + lookup helpers
// ============================================================================

export class SequenceConfig {
  constructor() {
    this.clips = {};
    this.presets = {};
    this.streams = {};
    this.routing = {};
  }

  loadFromObject(config) {
    this.clips = config.clips || {};
    this.presets = config.presets || {};
    this.streams = config.streams || {};
    this.routing = config.routing || {};
    
    this.validate();
  }

  validate() {
    for (const [name, clip] of Object.entries(this.clips)) {
      if (!clip.url) {
        console.warn(`Clip ${name} missing url`);
      }
      if (clip.start === undefined || clip.end === undefined) {
        console.warn(`Clip ${name} missing start/end times`);
      }
    }

    for (const [streamName, pattern] of Object.entries(this.streams)) {
      const clipRefs = this.extractClipReferences(pattern);
      for (const clipRef of clipRefs) {
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
    return [...new Set(matches.filter(m => this.clips[m]))];
  }

  getRoutingConfig(objectId) {
    const config = this.routing[objectId];
    if (!config) return null;

    if (typeof config === 'string') {
      return { stream: config, offset: 0 };
    }
    return { stream: config.stream, offset: config.offset || 0 };
  }

  getClip(clipName) {
    return this.clips[clipName];
  }

  getPreset(presetName) {
    return this.presets[presetName];
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
          effectsString: token.effectsString
        });
        currentTime += clipDuration;
      }
    }

    return {
      timeline,
      totalDuration: currentTime
    };
  }

  tokenize(patternString) {
    const regex = /([A-Z])(?:\*(\d+))?(?:\{([^}]+)\})?/g;
    const tokens = [];
    let match;

    while ((match = regex.exec(patternString)) !== null) {
      tokens.push({
        clipName: match[1],
        repeat: match[2] ? parseInt(match[2]) : 1,
        effectsString: match[3] || ''
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
    
    const parser = new SequenceParser(config);
    const parsed = parser.parsePattern(pattern);
    this.timeline = parsed.timeline;
    this.totalDuration = parsed.totalDuration;
  }
  
  // Resolve effects string to actual values using current presets
  resolveEffects(effectsString) {
    if (!effectsString) return {};
    
    const effects = {};
    // Split on commas that are NOT inside parentheses
    const parts = this._splitEffectsParts(effectsString);
    
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx !== -1) {
        // Direct param:value format — split only on first colon
        const key = part.slice(0, colonIdx).trim();
        const value = part.slice(colonIdx + 1).trim();
        // Try to parse as number; keep as string if not (could be expression or enum)
        const num = parseFloat(value);
        effects[key] = !isNaN(num) && String(num) === value ? num : value;
      } else {
        // Preset reference — resolve from current config
        const preset = this.config.getPreset(part.trim());
        if (preset) {
          Object.assign(effects, preset);
        } else if (part.trim()) {
          console.warn(`Unknown preset: ${part.trim()}`);
        }
      }
    }
    
    return effects;
  }

  // Split on commas that are outside parentheses
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
    
    // Apply offset
    const localTime = globalTime - this.offset;
    if (localTime < 0) return null;
    
    // Loop the pattern
    const loopedTime = localTime % this.totalDuration;
    
    // Find current clip
    for (let i = 0; i < this.timeline.length; i++) {
      const clip = this.timeline[i];
      if (loopedTime >= clip.startTime && loopedTime < clip.endTime) {
        // Resolve effects at runtime using current preset values
        return { 
          ...clip, 
          index: i,
          effects: this.resolveEffects(clip.effectsString)
        };
      }
    }
    
    return null;
  }

  getNextClip(currentClipIndex) {
    if (this.timeline.length === 0) return null;
    const nextIndex = (currentClipIndex + 1) % this.timeline.length;
    const clip = this.timeline[nextIndex];
    // Resolve effects at runtime
    return { 
      ...clip, 
      index: nextIndex,
      effects: this.resolveEffects(clip.effectsString)
    };
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
    // Create stream players (one per stream, shared by multiple objects)
    for (const [streamName, pattern] of Object.entries(this.config.streams)) {
      this.streamPlayers.set(streamName, 
        new StreamPlayer(streamName, pattern, this.config, 0)
      );
    }

    // Set up object routing (each object tracks its own currentClipIndex)
    for (const objectId of Object.keys(this.config.routing)) {
      const routeConfig = this.config.getRoutingConfig(objectId);
      if (routeConfig) {
        const streamPlayer = this.streamPlayers.get(routeConfig.stream);
        if (streamPlayer) {
          // Store object-specific assignment with its own state
          this.objectAssignments.set(objectId, {
            streamPlayer: streamPlayer,
            offset: routeConfig.offset,
            currentClipIndex: -1  // Track per-object, not per-stream!
          });
        }
      }
    }
    
    console.log('Sequence player initialized with objects:', Array.from(this.objectAssignments.keys()));
  }
  
  /**
   * Trigger initial clip loads for all objects
   */
  triggerInitialClips() {
    const currentTime = this.getCurrentTime();
    console.log('Triggering initial clips at time:', currentTime);
    
    for (const [objectId, assignment] of this.objectAssignments) {
      const currentClip = assignment.streamPlayer.getClipAtTime(currentTime + assignment.offset);
      
      if (currentClip) {
        assignment.currentClipIndex = currentClip.index;
        console.log(`Initial clip for ${objectId}:`, currentClip.clipName);
        this.emit('clipChange', {
          objectId,
          clipData: currentClip,
          nextClip: assignment.streamPlayer.getNextClip(currentClip.index)
        });
      } else {
        console.warn(`No initial clip found for ${objectId} at time ${currentTime}`);
      }
    }
  }

  getCurrentTime() {
    return (performance.now() / 1000) - this.startTime;
  }

  update() {
    const currentTime = this.getCurrentTime();
    
    for (const [objectId, assignment] of this.objectAssignments) {
      const adjustedTime = currentTime + assignment.offset;
      const currentClip = assignment.streamPlayer.getClipAtTime(adjustedTime);
      
      if (currentClip && currentClip.index !== assignment.currentClipIndex) {
        // Clip changed for this object
        console.log(`[${objectId}] Clip change at t=${currentTime.toFixed(2)}s: index ${assignment.currentClipIndex} → ${currentClip.index} (${currentClip.clipName})`);
        assignment.currentClipIndex = currentClip.index;
        this.emit('clipChange', {
          objectId,
          clipData: currentClip,
          nextClip: assignment.streamPlayer.getNextClip(currentClip.index)
        });
      }
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => cb(data));
    }
  }

  getStreamPlayer(objectId) {
    const assignment = this.objectAssignments.get(objectId);
    return assignment ? assignment.streamPlayer : null;
  }
}