/**
 * Param Scrub - @param annotation parser and hot-patch engine
 *
 * Annotation syntax (add to any line in your live-code scripts):
 *
 *   let speed = 1.0;           // @param float 0.0 5.0 0.05
 *   let count = 4;             // @param int 1 16 1
 *   let blendMode = "add";     // @param string add subtract multiply screen
 *   let active = true;         // @param bool
 *
 * Format: @param <type> <...args>
 *   float  → min max step
 *   int    → min max step
 *   string → space-separated list of allowed values (cycles on scrub)
 *   bool   → no args (any scrub direction toggles)
 *
 * To use a scrubbed value in your rendering code, read from window.liveParams:
 *   const s = window.liveParams?.speed ?? speed;
 *
 * The ?? fallback means the script works normally before any scrubbing occurs.
 */

export class ParamScrubHandler {
  constructor(liveCodeEditor) {
    this.liveEditor = liveCodeEditor;

    // Set by UIController after construction - triggers a lightweight updateConfig()
    this.onAfterScrub = null;

    if (!window.liveParams) window.liveParams = {};
  }

  scrub(direction) {
    const cm = this.liveEditor?.editor;
    if (!cm) return;

    const param = this._getParamAtCursor(cm);
    if (!param) return;

    const newValue = this._computeNewValue(param, direction);
    if (newValue === null) return;

    // 1. Hot-patch global store
    window.liveParams[param.name] = newValue;

    // 2. Mirror back into editor so text stays in sync
    this._patchEditorLine(cm, param, newValue);

    // 3. Tell UIController to push the updated config to the scene
    if (this.onAfterScrub) this.onAfterScrub(param.name);
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  _getParamAtCursor(cm) {
    const cursor   = cm.getCursor();
    const lineText = cm.getLine(cursor.line);
    if (!lineText) return null;

    const annotation = this._parseAnnotation(lineText);
    if (!annotation) return null;

    // Value pattern: number, quoted string, true/false
    const VALUE = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|true|false|[+-]?[\\d.]+(?:[eE][+-]?\\d+)?)`;

    // Try 1: object property  →  key: value,
    let m = lineText.match(new RegExp(`(\\b(\\w+)\\s*:\\s*)${VALUE}`));
    if (m) {
      return { name: m[2], rawValue: m[3], lineNumber: cursor.line, syntax: 'property', ...annotation };
    }

    // Try 2: variable assignment  →  let/const/var name = value
    m = lineText.match(new RegExp(`(?:let|const|var)\\s+(\\w+)\\s*=\\s*${VALUE}`));
    if (m) {
      return { name: m[1], rawValue: m[2], lineNumber: cursor.line, syntax: 'assignment', ...annotation };
    }

    return null;
  }

  _parseAnnotation(line) {
    const match = line.match(/@param\s+(\w+)\s*(.*)/);
    if (!match) return null;

    const type = match[1].toLowerCase();
    const args = match[2].trim().split(/\s+/).filter(Boolean);

    switch (type) {
      case 'float':
        if (args.length < 3) return null;
        return {
          type: 'float',
          min:  parseFloat(args[0]),
          max:  parseFloat(args[1]),
          step: parseFloat(args[2]),
        };

      case 'int':
        if (args.length < 3) return null;
        return {
          type: 'int',
          min:  parseInt(args[0], 10),
          max:  parseInt(args[1], 10),
          step: parseInt(args[2], 10),
        };

      case 'string':
        if (args.length < 2) return null;
        return { type: 'string', values: args };

      case 'bool':
        return { type: 'bool' };

      default:
        return null;
    }
  }

  // ── Value computation ──────────────────────────────────────────────────────

  _computeNewValue(param, direction) {
    // Live store takes precedence over editor text (they should be in sync,
    // but this handles the first scrub before any patch has occurred)
    const live = window.liveParams[param.name];

    switch (param.type) {
      case 'float': {
        const current = live ?? parseFloat(param.rawValue);
        const next    = current + direction * param.step;
        const clamped = Math.min(param.max, Math.max(param.min, next));
        // Round to the same decimal precision as the step to avoid float drift
        const decimals = this._decimalPlaces(param.step);
        return parseFloat(clamped.toFixed(decimals));
      }

      case 'int': {
        const current = live ?? parseInt(param.rawValue, 10);
        return Math.min(param.max, Math.max(param.min, current + direction * param.step));
      }

      case 'string': {
        const current = live ?? param.rawValue.replace(/^["']|["']$/g, '');
        const idx  = param.values.indexOf(current);
        // Handle -1 (value not in list yet) gracefully
        const base = idx === -1 ? 0 : idx;
        const next = (base + direction + param.values.length * 1000) % param.values.length;
        return param.values[next];
      }

      case 'bool': {
        const current = live ?? (param.rawValue === 'true');
        return !current;
      }

      default:
        return null;
    }
  }

  // ── Editor patching ────────────────────────────────────────────────────────

  _patchEditorLine(cm, param, newValue) {
    const lineText = cm.getLine(param.lineNumber);

    // Build display string preserving original quote style for strings
    let display;
    if (param.type === 'string') {
      const quote = param.rawValue.startsWith('"') ? '"' : "'";
      display = `${quote}${newValue}${quote}`;
    } else {
      display = String(newValue);
    }

    // Escape display string for use in regex replacement
    const escapedOld = param.rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const VALUE_RE = new RegExp(`(\\b${param.name}\\s*[=:]\\s*)${escapedOld}`);
    const patched = lineText.replace(VALUE_RE, `$1${display}`);

    if (patched === lineText) return;  // no change - avoid spurious cursor jump

    cm.replaceRange(
      patched,
      { line: param.lineNumber, ch: 0 },
      { line: param.lineNumber, ch: lineText.length }
    );
  }

  // ── Utility ────────────────────────────────────────────────────────────────

  _decimalPlaces(num) {
    const s   = String(num);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }
}