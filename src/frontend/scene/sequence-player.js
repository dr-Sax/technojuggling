/**
 * Sequence Player - Manages playback of video sequences with central clock
 */
import { SequenceParser } from './sequence-parser.js';

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
    const parts = effectsString.split(',').map(s => s.trim());
    
    for (const part of parts) {
      if (part.includes(':')) {
        // Direct param:value format
        const [key, value] = part.split(':').map(s => s.trim());
        // Try to parse as number
        const num = parseFloat(value);
        effects[key] = !isNaN(num) ? num : value;
      } else {
        // Preset reference - resolve from current config
        const preset = this.config.getPreset(part);
        if (preset) {
          Object.assign(effects, preset);
        } else {
          console.warn(`Unknown preset: ${part}`);
        }
      }
    }
    
    return effects;
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
      
      // Debug: Log every 3 seconds to see what's happening
      if (Math.floor(currentTime) % 3 === 0 && currentTime % 1 < 0.05) {
        console.log(`[${objectId}] t=${currentTime.toFixed(2)}s, currentClip=${currentClip ? currentClip.index + ':' + currentClip.clipName : 'null'}, stored=${assignment.currentClipIndex}`);
      }
      
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