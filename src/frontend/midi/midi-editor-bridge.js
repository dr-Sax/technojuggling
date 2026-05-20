/**
 * MidiEditorBridge - Routes MIDI events to live-code-editor actions.
 *
 * Eight knob/pad CHANNELS. Each channel = one knob + one pad.
 *
 *   knob, lock OFF  → absolute position over all numeric tokens in the
 *                     buffer. Knob at 0 = first token, 127 = last, linear.
 *                     The token is highlighted with CodeMirror's native
 *                     text selection (the grey .CodeMirror-selected band) —
 *                     exactly the original two-knob mechanism.
 *   pad             → toggles the lock for that channel. Tap = lock,
 *                     tap again = unlock.
 *   knob, lock ON   → rewrites the value of the channel's selected token
 *                     and live-executes (throttled). The knob no longer
 *                     moves the cursor while locked.
 *
 * On native selection: CodeMirror shows ONE selection at a time, so the
 * visible highlight is always the channel you last touched. Every channel
 * still tracks its own token independently and edits it correctly when
 * locked; only the *visible* highlight is shared. When a channel acts
 * (cursor move, value rewrite, or lock toggle) it re-asserts its own
 * token as the visible selection, so "what you see" always matches "the
 * knob you just used".
 *
 * Default knob/pad mapping (first keyboard row, then second):
 *   CC 70 ↔ note 40   CC 71 ↔ note 41   CC 72 ↔ note 42   CC 73 ↔ note 43
 *   CC 74 ↔ note 36   CC 75 ↔ note 37   CC 76 ↔ note 38   CC 77 ↔ note 39
 *
 * Config overrides via the live config's `midi` block:
 *   midi: {
 *     channels: [
 *       { knob: 70, pad: 40 }, { knob: 71, pad: 41 },
 *       { knob: 72, pad: 42 }, { knob: 73, pad: 43 },
 *       { knob: 74, pad: 36 }, { knob: 75, pad: 37 },
 *       { knob: 76, pad: 38 }, { knob: 77, pad: 39 },
 *     ],
 *     executePad: 44,        // optional manual re-execute pad
 *     liveExecuteMs: 33, liveExecute: true,
 *   }
 *
 * Range comments tell a locked knob how to map 0..1 onto the highlighted
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

// Default eight channels — first keyboard row then second, per the
// requested knob/pad pairing.
const DEFAULT_CHANNELS = [
  { knob: 70, pad: 40 },
  { knob: 71, pad: 41 },
  { knob: 72, pad: 42 },
  { knob: 73, pad: 43 },
  { knob: 74, pad: 36 },
  { knob: 75, pad: 37 },
  { knob: 76, pad: 38 },
  { knob: 77, pad: 39 },
];

const DEFAULTS = {
  channels: DEFAULT_CHANNELS,
  executePad: null,        // optional: a pad that just re-executes
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

    // One state object per channel. Index === channel number 0..7.
    //   knob, pad    — MIDI numbers for this channel
    //   locked       — true while the pad has toggled it into value mode
    //   token        — { from, to, text, value } this channel is on
    //   lastSlot     — last token slot index the cursor knob picked
    //   pickup       — { matched, lastValue } pickup-mode state (locked only)
    //   hueBaseline  — { s, l } captured when a //hue hex token is selected
    this.channels = [];

    // Trailing-edge throttle state for live re-execute (shared)
    this._lastExecuteAt = 0;
    this._pendingExecuteTimer = null;

    this._rebuildChannels(this.config.channels);
  }

  updateMapping(midiConfig) {
    this.config = { ...DEFAULTS, ...(midiConfig || {}) };
    if (!Array.isArray(this.config.channels) || this.config.channels.length === 0) {
      this.config.channels = DEFAULT_CHANNELS;
    }
    // UIController calls updateMapping() on EVERY successful execute — and a
    // locked knob triggers an execute on every turn. Rebuilding channels
    // here unconditionally would wipe every channel's token/lock state on
    // each knob turn. So rebuild ONLY when the knob/pad layout changed.
    if (this._channelLayoutChanged(this.config.channels)) {
      this._rebuildChannels(this.config.channels);
    }
  }

  /** True if the knob/pad numbers differ from the current channels. */
  _channelLayoutChanged(channelDefs) {
    if (!this.channels || this.channels.length !== channelDefs.length) return true;
    for (let i = 0; i < channelDefs.length; i++) {
      if (this.channels[i].knob !== channelDefs[i].knob ||
          this.channels[i].pad  !== channelDefs[i].pad) {
        return true;
      }
    }
    return false;
  }

  /** (Re)build per-channel state. Only called on a genuine layout change. */
  _rebuildChannels(channelDefs) {
    this.channels = channelDefs.map((def, i) => ({
      index: i,
      knob: def.knob,
      pad: def.pad,
      locked: false,
      token: null,
      lastSlot: -1,
      pickup: null,
      hueBaseline: null,
    }));
  }

  /** Find the channel owning a given knob CC number, or null. */
  _channelByKnob(cc) {
    for (const ch of this.channels) if (ch.knob === cc) return ch;
    return null;
  }

  /** Find the channel owning a given pad note number, or null. */
  _channelByPad(note) {
    for (const ch of this.channels) if (ch.pad === note) return ch;
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // MIDI event handlers (called by MidiController)
  // ─────────────────────────────────────────────────────────────────────

  onCC(num, rawValue, _channel) {
    const ch = this._channelByKnob(num);
    if (!ch) return;
    if (ch.locked) this._handleValueKnob(ch, rawValue / 127);
    else           this._handleCursorKnob(ch, rawValue);
  }

  onNoteOn(num, _velocity, _channel) {
    // Manual execute pad takes priority if configured.
    if (this.config.executePad != null && num === this.config.executePad) {
      this._triggerExecute();
      return;
    }
    const ch = this._channelByPad(num);
    if (ch) this._toggleLock(ch);
  }
  onNoteOff()       { /* no-op */ }
  onPitchBend()     { /* no-op */ }
  onProgramChange() { /* no-op */ }

  // ─────────────────────────────────────────────────────────────────────
  // Lock toggle — pad press flips a channel between cursor and value mode
  // ─────────────────────────────────────────────────────────────────────

  _toggleLock(ch) {
    ch.locked = !ch.locked;

    if (ch.locked) {
      // Entering value mode. Re-arm pickup so the parameter doesn't jump
      // to the knob's current physical position the instant we lock —
      // the knob must first sweep through the value's normalized position.
      ch.pickup = { matched: false, lastValue: null };
    } else {
      // Leaving value mode. Force the next cursor move to re-select even
      // if the knob hasn't physically moved.
      ch.lastSlot = -1;
      ch.pickup = null;
    }
    // Make this channel's token the visible selection so you can see what
    // you just locked / unlocked.
    if (ch.token) this._showSelection(ch.token);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Cursor knob — absolute knob position maps to slot index over tokens
  // ─────────────────────────────────────────────────────────────────────

  _handleCursorKnob(ch, rawValue) {
    const tokens = this._collectNumberTokens();
    if (tokens.length === 0) return;

    const clamped = Math.max(0, Math.min(127, rawValue));
    const slot = tokens.length === 1
      ? 0
      : Math.round((clamped / 127) * (tokens.length - 1));

    if (slot === ch.lastSlot) return;  // ignore jitter within a slot
    ch.lastSlot = slot;
    this._selectToken(ch, tokens[slot]);
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

  /**
   * Show a token as CodeMirror's native text selection — the exact
   * mechanism the original two-knob bridge used. The grey highlight is
   * the editor's existing .CodeMirror-selected style; no custom CSS.
   */
  _showSelection(token) {
    const cm = this._editor();
    if (!cm) return;
    cm.setSelection(token.from, token.to);
    cm.scrollIntoView({ from: token.from, to: token.to }, 50);
  }

  _selectToken(ch, token) {
    ch.token = token;
    this._showSelection(token);

    // Reset pickup mode — new token, knob must re-match before editing.
    if (ch.pickup) ch.pickup.matched = false;

    // Capture S/L baseline for //hue tokens so sweeping preserves character.
    ch.hueBaseline = null;
    if (this._isHexText(token.text)) {
      const range = this._parseRangeComment(token);
      if (range && range.kind === 'hue') {
        const { s, l } = this._rgbToHsl(token.value);
        // Greys (s≈0) have no defined hue → fall back to vivid sweep.
        ch.hueBaseline = s < 0.02 ? { s: 1, l: 0.5 } : { s, l };
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Value knob — rewrite the channel's selected number and live-execute
  // ─────────────────────────────────────────────────────────────────────

  _handleValueKnob(ch, norm) {
    if (!ch.token) return;
    const cm = this._editor();
    if (!cm) return;

    const range = this._resolveRange(ch.token);

    // Pickup mode (skipped for list-kind, where every position is a slot).
    // The knob doesn't take effect until its 0..1 position crosses the
    // current value's normalized position — avoids jumps when locking a
    // channel mid-knob-travel.
    if (range.kind !== 'list') {
      const currentNorm = this._clamp(
        this._valueToNorm(ch.token.value, range),
        0, 1
      );
      if (!ch.pickup) ch.pickup = { matched: false, lastValue: norm };
      if (ch.pickup.lastValue == null) ch.pickup.lastValue = norm;

      if (!ch.pickup.matched) {
        const crossed =
          (ch.pickup.lastValue <= currentNorm && norm >= currentNorm) ||
          (ch.pickup.lastValue >= currentNorm && norm <= currentNorm);
        ch.pickup.lastValue = norm;
        if (!crossed) return;
        ch.pickup.matched = true;
      }
      ch.pickup.lastValue = norm;
    }

    const formatted = this._normToFormatted(ch, norm, range, ch.token.text);
    if (formatted === ch.token.text) return;  // idempotent — skip no-ops

    const { from } = ch.token;
    cm.replaceRange(formatted, from, ch.token.to, '+midi');
    const newTo = { line: from.line, ch: from.ch + formatted.length };
    ch.token = { from, to: newTo, text: formatted, value: Number(formatted) };

    // Re-assert this channel's token as the visible selection so the
    // highlight tracks the rewritten text.
    this._showSelection(ch.token);

    this._scheduleLiveExecute();
  }

  /**
   * Trailing-edge throttle: first turn fires immediately; subsequent turns
   * within the window coalesce into one trailing call so the final value
   * always lands without flooding the executor. Shared across all channels.
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

  _normToFormatted(ch, norm, range, originalText) {
    if (range.kind === 'hue') {
      const s = ch.hueBaseline ? ch.hueBaseline.s : 1;
      const l = ch.hueBaseline ? ch.hueBaseline.l : 0.5;
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