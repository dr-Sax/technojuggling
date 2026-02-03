/**
 * Sequence Core - Configuration and parsing for video sequences
 * Replaces: sequence-parser.js + sequence-config.js
 */

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