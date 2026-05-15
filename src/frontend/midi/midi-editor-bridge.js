/**
 * MidiEditorBridge - Routes MIDI events to live-code-editor actions.
 *
 * Two knobs + one pad:
 *   cursorKnob (CC 70) → absolute position over all numeric tokens in the
 *                        buffer. Knob at 0 = first token, 127 = last, linear.
 *                        Same physical position always lands on the same token.
 *   valueKnob  (CC 71) → rewrite the value under the cursor and live-execute
 *                        the code (throttled). No Ctrl-Enter needed.
 *   executePad (note 36) → manual re-execute (Ctrl-Enter equivalent).
 *
 * Config overrides via the live config's `midi` block:
 *   midi: { cursorKnob: 70, valueKnob: 71, executePad: 36,
 *           liveExecuteMs: 33, liveExecute: true }
 *
 * Range comments tell the value knob how to map 0..1 onto the highlighted
 * number. Five forms, placed in a // comment after the number:
 *
 *   scale: 5          //0,100              decimal range
 *   opacity: 0.5      //0,1                decimal range
 *   color: 0x00ffff   //hue                sweep hue, preserve S/L
 *   color: 0x00ffff   //hex                sweep raw 0x000000..0xffffff
 *   color: 0x00ffff   //0x000000,0x00ffff  explicit hex range
 *   zStep: 0.00       //[-1, 0, 1]         discrete picks, equal-width bands
 *   zStep: 0.00       //[-1, 0, 1], 11     anchors as hard stops, N total
 *
 * Without a comment, the bridge infers a sensible range from the current
 * value (0..1, -1..1, contextual for larger numbers, full 24-bit for hex).
 *
 * Decimal formatting preserves the original text's style: "0.00" stays
 * 2-decimal, "5" stays integer, ".5" stays without leading zero. Hex
 * preserves width and reformats to `0xRRGGBB` on color sweeps.
 */

const DEFAULTS = {
  cursorKnob: 70,
  valueKnob: 71,
  executePad: 36,
  liveExecuteMs: 33,
  liveExecute: true,
};

export class MidiEditorBridge {
  /**
   * @param {LiveCodeEditor} liveCodeEditor - has .editor (CodeMirror instance)
   * @param {() => void} onExecute - called to trigger re-execute (Ctrl-Enter)
   */
  constructor(liveCodeEditor, onExecute) {
    this.liveCodeEditor = liveCodeEditor;
    this.onExecute = onExecute;
    this.config = { ...DEFAULTS };

    this.currentToken = null;       // { from, to, text, value }
    this._lastCursorSlot = -1;      // last token slot the cursor knob selected
    this._pickup = null;            // { matched, lastValue } for value knob
    this._hueBaseline = null;       // { s, l } captured at hex-token select

    // Trailing-edge throttle state for live re-execute
    this._lastExecuteAt = 0;
    this._pendingExecuteTimer = null;
  }

  updateMapping(midiConfig) {
    this.config = { ...DEFAULTS, ...(midiConfig || {}) };
  }

  // ─────────────────────────────────────────────────────────────────────
  // MIDI event handlers (called by MidiController)
  // ─────────────────────────────────────────────────────────────────────

  onCC(num, rawValue, _channel) {
    if (num === this.config.cursorKnob) return this._handleCursorKnob(rawValue);
    if (num === this.config.valueKnob)  return this._handleValueKnob(rawValue / 127);
  }

  onNoteOn(num, _velocity, _channel) {
    if (num === this.config.executePad) this._triggerExecute();
  }
  onNoteOff()       { /* no-op */ }
  onPitchBend()     { /* no-op */ }
  onProgramChange() { /* no-op */ }

  // ─────────────────────────────────────────────────────────────────────
  // Cursor knob — absolute knob position maps to slot index over tokens
  // ─────────────────────────────────────────────────────────────────────

  _handleCursorKnob(rawValue) {
    const tokens = this._collectNumberTokens();
    if (tokens.length === 0) return;

    const clamped = Math.max(0, Math.min(127, rawValue));
    const slot = tokens.length === 1
      ? 0
      : Math.round((clamped / 127) * (tokens.length - 1));

    if (slot === this._lastCursorSlot) return;
    this._lastCursorSlot = slot;
    this._selectToken(tokens[slot]);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Token collection
  // ─────────────────────────────────────────────────────────────────────

  _editor() { return this.liveCodeEditor?.editor || null; }

  _collectNumberTokens() {
    const cm = this._editor();
    if (!cm) return [];

    const tokens = [];
    const lineCount = cm.lineCount();

    for (let line = 0; line < lineCount; line++) {
      const lineTokens = cm.getLineTokens(line, true);
      for (let i = 0; i < lineTokens.length; i++) {
        const tok = lineTokens[i];
        if (tok.type !== 'number') continue;

        let from = { line, ch: tok.start };
        const to = { line, ch: tok.end };
        let text = tok.string;

        // Capture unary minus as part of the value (e.g. `-30` not `30`)
        if (i >= 1 && lineTokens[i - 1].string === '-') {
          const prevPrev = i >= 2 ? lineTokens[i - 2] : null;
          const isUnary = !prevPrev ||
            /^[:(\[,=+\-*/%]$/.test(prevPrev.string.trim()) ||
            prevPrev.string.trim() === '';
          if (isUnary) {
            from = { line, ch: lineTokens[i - 1].start };
            text = '-' + text;
          }
        }

        const value = Number(text);
        if (!Number.isNaN(value)) tokens.push({ from, to, text, value });
      }
    }
    return tokens;
  }

  _selectToken(token) {
    const cm = this._editor();
    if (!cm) return;
    cm.setSelection(token.from, token.to);
    cm.scrollIntoView({ from: token.from, to: token.to }, 50);
    this.currentToken = token;

    // Reset pickup mode — new token, knob must re-match before editing
    if (this._pickup) this._pickup.matched = false;

    // Capture S/L baseline for //hue tokens so sweeping preserves character
    this._hueBaseline = null;
    if (this._isHexText(token.text)) {
      const range = this._parseRangeComment(token);
      if (range && range.kind === 'hue') {
        const { s, l } = this._rgbToHsl(token.value);
        // Greys (s≈0) have no defined hue → fall back to vivid sweep
        this._hueBaseline = s < 0.02 ? { s: 1, l: 0.5 } : { s, l };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Value knob — rewrite the selected number and live-execute
  // ─────────────────────────────────────────────────────────────────────

  _handleValueKnob(norm) {
    if (!this.currentToken) return;
    const cm = this._editor();
    if (!cm) return;

    const range = this._resolveRange(this.currentToken);

    // Pickup mode (skipped for list-kind, where every position is a slot).
    // The knob doesn't take effect until its 0..1 position crosses the
    // current value's normalized position — avoids jumps when selecting
    // a fresh token mid-knob-travel.
    if (range.kind !== 'list') {
      const currentNorm = this._clamp(
        this._valueToNorm(this.currentToken.value, range),
        0, 1
      );
      if (!this._pickup) this._pickup = { matched: false, lastValue: norm };

      if (!this._pickup.matched) {
        const crossed =
          (this._pickup.lastValue <= currentNorm && norm >= currentNorm) ||
          (this._pickup.lastValue >= currentNorm && norm <= currentNorm);
        this._pickup.lastValue = norm;
        if (!crossed) return;
        this._pickup.matched = true;
      }
      this._pickup.lastValue = norm;
    }

    const formatted = this._normToFormatted(norm, range, this.currentToken.text);
    if (formatted === this.currentToken.text) return;  // idempotent

    const { from } = this.currentToken;
    cm.replaceRange(formatted, from, this.currentToken.to, '+midi');
    const newTo = { line: from.line, ch: from.ch + formatted.length };
    cm.setSelection(from, newTo);
    this.currentToken = { from, to: newTo, text: formatted, value: Number(formatted) };

    this._scheduleLiveExecute();
  }

  /**
   * Trailing-edge throttle: first turn fires immediately; subsequent turns
   * within the window coalesce into one trailing call so the final value
   * always lands without flooding the executor.
   */
  _scheduleLiveExecute() {
    if (!this.config.liveExecute || !this.onExecute) return;
    const now = performance.now();
    const elapsed = now - this._lastExecuteAt;
    const window = Math.max(1, this.config.liveExecuteMs);

    if (elapsed >= window) {
      this._lastExecuteAt = now;
      this._triggerExecute();
      return;
    }
    if (this._pendingExecuteTimer) return;
    this._pendingExecuteTimer = setTimeout(() => {
      this._pendingExecuteTimer = null;
      this._lastExecuteAt = performance.now();
      this._triggerExecute();
    }, window - elapsed);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Range descriptors:
  //   { kind: 'decimal', min, max }         linear in value
  //   { kind: 'hex',     min, max }         linear, formatted as 0xRRGGBB
  //   { kind: 'hue' }                       0..360° at preserved S/L
  //   { kind: 'list',    values: [...] }    discrete picks, equal-width bins
  // ─────────────────────────────────────────────────────────────────────

  _resolveRange(token) {
    return this._parseRangeComment(token) || this._inferRange(token);
  }

  _parseRangeComment(token) {
    const cm = this._editor();
    if (!cm) return null;
    const line = cm.getLine(token.to.line);
    if (!line) return null;
    const tail = line.slice(token.to.ch);

    // //hue — sweep hue, hex tokens only
    if (/^\s*\/\/\s*hue\b/i.test(tail)) {
      return this._isHexText(token.text) ? { kind: 'hue' } : null;
    }

    // //hex — full 24-bit raw sweep, hex tokens only
    if (/^\s*\/\/\s*hex\b/i.test(tail)) {
      return this._isHexText(token.text)
        ? { kind: 'hex', min: 0, max: 0xffffff }
        : null;
    }

    // //0xMIN,0xMAX — explicit hex range
    const hex = tail.match(/\/\/\s*0x([0-9a-f]+)\s*,\s*0x([0-9a-f]+)/i);
    if (hex) {
      const a = parseInt(hex[1], 16);
      const b = parseInt(hex[2], 16);
      return this._makeRange('hex', a, b);
    }

    // //[a, b, c] or //[a, b, c], N — discrete list, optionally with anchor expansion
    const list = tail.match(/\/\/\s*\[([^\]]+)\]\s*(?:,\s*(\d+))?/);
    if (list) {
      const anchors = list[1].split(',')
        .map(s => Number(s.trim()))
        .filter(Number.isFinite);
      if (anchors.length < 2) return null;
      anchors.sort((a, b) => a - b);
      const count = list[2] ? parseInt(list[2], 10) : null;
      const values = count ? this._expandAnchorsToStops(anchors, count) : anchors;
      return { kind: 'list', values };
    }

    // //min,max — decimal range
    const dec = tail.match(/\/\/\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (dec) return this._makeRange('decimal', Number(dec[1]), Number(dec[2]));

    return null;
  }

  /** Build a 2-endpoint range, ordered min..max, rejecting degenerate cases. */
  _makeRange(kind, a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
    return a < b ? { kind, min: a, max: b } : { kind, min: b, max: a };
  }

  _inferRange(token) {
    if (this._isHexText(token.text)) return { kind: 'hex', min: 0, max: 0xffffff };
    const v = token.value;
    if (v >=  0 && v <= 1) return { kind: 'decimal', min:  0, max: 1 };
    if (v >= -1 && v <= 1) return { kind: 'decimal', min: -1, max: 1 };
    const span = Math.max(Math.abs(v) * 2, 10);
    return v < 0
      ? { kind: 'decimal', min: -span, max: span }
      : { kind: 'decimal', min: 0,     max: span };
  }

  _isHexText(text) { return text.startsWith('0x') || text.startsWith('0X'); }

  /**
   * Expand sorted anchors into ~targetCount stops, keeping every anchor as
   * a hard stop. Interior stops are spread across gaps proportionally to
   * span using largest-remainder apportionment to avoid rounding drift.
   */
  _expandAnchorsToStops(anchors, targetCount) {
    if (targetCount <= anchors.length) return anchors.slice();

    const remaining = targetCount - anchors.length;
    const gapCount = anchors.length - 1;
    const totalSpan = anchors[anchors.length - 1] - anchors[0];

    const shares = [];
    for (let i = 0; i < gapCount; i++) {
      const span = anchors[i + 1] - anchors[i];
      const share = totalSpan > 0
        ? remaining * (span / totalSpan)
        : remaining / gapCount;
      shares.push({ floor: Math.floor(share), frac: share - Math.floor(share) });
    }

    // Largest-remainder: distribute leftover units to the biggest fractions
    const allocated = shares.reduce((sum, s) => sum + s.floor, 0);
    const leftover = remaining - allocated;
    const byFrac = shares.slice().sort((a, b) => b.frac - a.frac);
    for (let i = 0; i < leftover; i++) byFrac[i % byFrac.length].floor += 1;

    const stops = [];
    for (let i = 0; i < gapCount; i++) {
      const lo = anchors[i], hi = anchors[i + 1];
      stops.push(lo);
      for (let k = 1; k <= shares[i].floor; k++) {
        stops.push(lo + (hi - lo) * (k / (shares[i].floor + 1)));
      }
    }
    stops.push(anchors[anchors.length - 1]);
    return stops;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Value <-> normalized 0..1 knob position
  // ─────────────────────────────────────────────────────────────────────

  _valueToNorm(value, range) {
    if (range.kind === 'hue') return this._rgbToHsl(value).h / 360;
    if (range.kind === 'list') {
      // Closest list index, normalized
      let bestIdx = 0, bestDist = Math.abs(range.values[0] - value);
      for (let i = 1; i < range.values.length; i++) {
        const d = Math.abs(range.values[i] - value);
        if (d < bestDist) { bestIdx = i; bestDist = d; }
      }
      return range.values.length <= 1 ? 0 : bestIdx / (range.values.length - 1);
    }
    return (value - range.min) / (range.max - range.min);
  }

  _normToFormatted(norm, range, originalText) {
    if (range.kind === 'hue') {
      const s = this._hueBaseline ? this._hueBaseline.s : 1;
      const l = this._hueBaseline ? this._hueBaseline.l : 0.5;
      return this._formatHex(this._hslToHex(norm * 360, s, l), originalText);
    }
    if (range.kind === 'hex') {
      const raw = Math.round(range.min + norm * (range.max - range.min));
      return this._formatHex(raw, originalText);
    }
    if (range.kind === 'list') {
      const n = range.values.length;
      const slot = Math.min(n - 1, Math.floor(this._clamp(norm, 0, 1) * n));
      // Build a synthetic range so decimal formatting picks int vs float
      // based on the value extremes, just like a real decimal range would.
      const minV = Math.min(...range.values);
      const maxV = Math.max(...range.values);
      return this._formatDecimal(range.values[slot], originalText,
                                 { min: minV, max: maxV });
    }
    return this._formatDecimal(range.min + norm * (range.max - range.min),
                               originalText, range);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Output formatting
  // ─────────────────────────────────────────────────────────────────────

  _formatHex(intVal, originalText) {
    const clamped = this._clamp(Math.round(intVal), 0, 0xffffff);
    // Preserve original width but expand to full 6 for proper RGB
    const width = Math.max(originalText.length - 2, 6);
    return '0x' + clamped.toString(16).padStart(width, '0');
  }

  _formatDecimal(value, originalText, range) {
    const stripped = originalText.replace(/^-/, '');
    const rangeIsInteger = Number.isInteger(range.min) && Number.isInteger(range.max);

    if (!stripped.includes('.') && rangeIsInteger) {
      return Math.round(value).toString();
    }
    if (stripped.includes('.')) {
      const decimals = Math.max(1, Math.min((stripped.split('.')[1] || '').length, 4));
      let out = value.toFixed(decimals);
      // Preserve ".5" rather than "0.5" if the original had no leading zero
      if (stripped.startsWith('.')) {
        if (out.startsWith('0.'))       out = out.slice(1);
        else if (out.startsWith('-0.')) out = '-' + out.slice(2);
      }
      return out;
    }
    return Math.round(value).toString();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Color math
  // ─────────────────────────────────────────────────────────────────────

  /** 24-bit RGB int → { h: 0..360, s: 0..1, l: 0..1 } */
  _rgbToHsl(rgbInt) {
    const r = ((rgbInt >> 16) & 0xff) / 255;
    const g = ((rgbInt >> 8)  & 0xff) / 255;
    const b = ( rgbInt        & 0xff) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    if (d === 0) return { h: 0, s: 0, l };

    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if      (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
    return { h: h < 0 ? h + 360 : h, s, l };
  }

  /** HSL (h:0..360, s:0..1, l:0..1) → 24-bit RGB int */
  _hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1, g1, b1;
    if      (h < 60)  [r1, g1, b1] = [c, x, 0];
    else if (h < 120) [r1, g1, b1] = [x, c, 0];
    else if (h < 180) [r1, g1, b1] = [0, c, x];
    else if (h < 240) [r1, g1, b1] = [0, x, c];
    else if (h < 300) [r1, g1, b1] = [x, 0, c];
    else              [r1, g1, b1] = [c, 0, x];
    return (Math.round((r1 + m) * 255) << 16) |
           (Math.round((g1 + m) * 255) <<  8) |
            Math.round((b1 + m) * 255);
  }

  _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  _triggerExecute() { if (this.onExecute) this.onExecute(); }

  stop() {
    if (this._pendingExecuteTimer) {
      clearTimeout(this._pendingExecuteTimer);
      this._pendingExecuteTimer = null;
    }
  }
}
