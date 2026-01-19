/**
 * Sequence Configuration - Storage and validation for video sequences
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
    // Validate clips have required fields
    for (const [name, clip] of Object.entries(this.clips)) {
      if (!clip.url) {
        console.warn(`Clip ${name} missing url`);
      }
      if (clip.start === undefined || clip.end === undefined) {
        console.warn(`Clip ${name} missing start/end times`);
      }
    }

    // Validate streams reference existing clips
    for (const [streamName, pattern] of Object.entries(this.streams)) {
      const clipRefs = this.extractClipReferences(pattern);
      for (const clipRef of clipRefs) {
        if (!this.clips[clipRef]) {
          console.warn(`Stream ${streamName} references unknown clip: ${clipRef}`);
        }
      }
    }

    // Validate routing references existing streams
    for (const [objectId, routeConfig] of Object.entries(this.routing)) {
      const streamName = typeof routeConfig === 'string' ? routeConfig : routeConfig.stream;
      if (!this.streams[streamName]) {
        console.warn(`Routing for ${objectId} references unknown stream: ${streamName}`);
      }
    }
  }

  extractClipReferences(pattern) {
    // Extract clip names from pattern like "A{heavy} B*2 C"
    const matches = pattern.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    return [...new Set(matches.filter(m => this.clips[m]))];
  }

  getRoutingConfig(objectId) {
    const config = this.routing[objectId];
    if (!config) return null;

    // Normalize to object format
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