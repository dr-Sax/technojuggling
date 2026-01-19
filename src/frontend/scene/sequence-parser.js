/**
 * Sequence Parser - Parse pattern strings into timeline structures
 */

export class SequenceParser {
  constructor(config) {
    this.config = config;
  }

  parsePattern(patternString) {
    // Parse pattern like "A{heavy} B*2{glitch:0.5} C"
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
          effectsString: token.effectsString  // Store raw effect string, not resolved values
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
    // Match patterns like: A, A*3, A{preset}, A{param:value,param2:value2}, A*2{preset,param:value}
    // Now handles both "A B" and "AB" (with and without spaces)
    // Match single uppercase letter followed by optional multiplier and effects
    const regex = /([A-Z])(?:\*(\d+))?(?:\{([^}]+)\})?/g;
    const tokens = [];
    let match;

    while ((match = regex.exec(patternString)) !== null) {
      tokens.push({
        clipName: match[1],
        repeat: match[2] ? parseInt(match[2]) : 1,
        effectsString: match[3] || ''  // Store raw string instead of parsing
      });
    }
    
    if (tokens.length === 0) {
      console.warn('No clips found in pattern:', patternString);
    }

    return tokens;
  }

  parseEffects(effectString) {
    // Parse "preset1,param:value,param2:value2" or "preset1" or "param:value"
    const effects = {};
    const parts = effectString.split(',').map(s => s.trim());

    for (const part of parts) {
      if (part.includes(':')) {
        // param:value format
        const [key, value] = part.split(':').map(s => s.trim());
        effects[key] = this.parseValue(value);
      } else {
        // Preset reference
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

  parseValue(valueString) {
    // Try to parse as number, otherwise return as string (for expressions)
    const num = parseFloat(valueString);
    if (!isNaN(num)) return num;
    
    // Check if it's a quoted string
    if (valueString.startsWith("'") && valueString.endsWith("'")) {
      return valueString.slice(1, -1);
    }
    
    return valueString;
  }

  resolveEffects(effectsObj) {
    // Effects are already resolved during parsing (presets expanded)
    return effectsObj;
  }
}