/**
 * MidiEditorBridge - Routes MIDI events to live-code-editor actions.
 *
 * Responsibilities:
 *   1. Joystick X (default CC 16) → step cursor through number tokens (prev/next)
 *   2. Joystick Y (default CC 17) → step cursor up/down lines
 *   3. CC1 → rewrite the numeric value under the cursor
 *   4. Pad (default note 36, MPK kick pad) → trigger Ctrl-Enter (re-execute code)
 *
 * Mapping is loaded from the live config's `midi` block on each execute,
 * so the user can change which CCs/notes do what by editing code:
 *
 *   midi: {
 *     joystickX: 16,         // CC for joystick X (default 16)
 *     joystickY: 17,         // CC for joystick Y (default 17)
 *     valueKnob: 1,          // CC that rewrites value at cursor (default 1)
 *     executePad: 36,        // note that triggers re-execute (default 36)
 *     joyDeadzone: 0.15,     // joystick centered region treated as 0
 *     joyRepeatHz: 8         // how many cursor steps per second at full deflection
 *   }
 *
 * Key insight: the joystick is *continuous* (a centered knob), but cursor nav
 * is *discrete* (step to next/prev token). So we convert continuous deflection
 * into a repeating "tick" stream — like keyboard auto-repeat — whose rate
 * scales with how far the stick is pushed. Stick at rest = no movement.
 */

const DEFAULTS = {
  joystickX: 16,
  joystickY: 17,
  valueKnob: 1,
  executePad: 36,
  joyDeadzone: 0.15,
  joyRepeatHz: 8,
};

export class MidiEditorBridge {
  /**
   * @param {LiveCodeEditor} liveCodeEditor - has .editor (CodeMirror instance)
   * @param {() => void} onExecute - called to trigger re-execute (same as Ctrl-Enter)
   */
  constructor(liveCodeEditor, onExecute) {
    this.liveCodeEditor = liveCodeEditor;
    this.onExecute = onExecute;
    this.config = { ...DEFAULTS };

    // Joystick continuous state (normalized -1..1, where 0 = centered)
    this.joyX = 0;
    this.joyY = 0;

    // Pickup mode: knob doesn't take effect until physical position crosses current value.
    // Map of CC# -> { matched: bool, lastValue: 0..1 }
    this.knobPickup = new Map();

    // Currently selected numeric token, if any
    this.currentToken = null;  // { from: {line,ch}, to: {line,ch}, text: string, value: number }

    // RAF loop for joystick auto-repeat
    this._rafId = null;
    this._lastTick = performance.now();
    this._stepAccumX = 0;
    this._stepAccumY = 0;

    this._startLoop();
  }

  /** Update mapping from a fresh config object. Call this on every execute. */
  updateMapping(midiConfig) {
    this.config = { ...DEFAULTS, ...(midiConfig || {}) };
  }

  // ─────────────────────────────────────────────────────────────────────
  // MIDI event handlers (called by MidiController)
  // ─────────────────────────────────────────────────────────────────────

  onCC(num, rawValue, _channel) {
    const norm = rawValue / 127;

    if (num === this.config.joystickX) {
      // Most joysticks center at 64 (~0.5). Convert to -1..1.
      this.joyX = this._centerNormalize(norm);
      return;
    }
    if (num === this.config.joystickY) {
      this.joyY = this._centerNormalize(norm);
      return;
    }
    if (num === this.config.valueKnob) {
      this._handleValueKnob(num, norm);
      return;
    }
    // Other CCs: ignored here (they still update MidiState for expressions)
  }

  onNoteOn(num, _velocity, _channel) {
    if (num === this.config.executePad) {
      this._triggerExecute();
    }
  }

  onNoteOff(_num, _channel) { /* no-op for now */ }

  onPitchBend(_value, _channel) { /* no-op */ }

  onProgramChange(_num, _channel) { /* no-op */ }

  // ─────────────────────────────────────────────────────────────────────
  // Joystick: convert centered CC (0..1, center 0.5) to deflection (-1..1)
  // ─────────────────────────────────────────────────────────────────────

  _centerNormalize(norm) {
    const d = (norm - 0.5) * 2;  // -1..1
    if (Math.abs(d) < this.config.joyDeadzone) return 0;
    // Re-scale so the usable range maps to full -1..1
    const sign = Math.sign(d);
    const magnitude = (Math.abs(d) - this.config.joyDeadzone) / (1 - this.config.joyDeadzone);
    return sign * magnitude;
  }

  // ─────────────────────────────────────────────────────────────────────
  // RAF loop: convert joystick deflection into cursor-step ticks
  // ─────────────────────────────────────────────────────────────────────

  _startLoop() {
    const tick = (now) => {
      const dt = (now - this._lastTick) / 1000;
      this._lastTick = now;

      // Accumulate "steps owed" — full deflection = joyRepeatHz steps/sec
      this._stepAccumX += this.joyX * this.config.joyRepeatHz * dt;
      this._stepAccumY += this.joyY * this.config.joyRepeatHz * dt;

      // Fire off whole steps
      while (this._stepAccumX >= 1) {
        this._stepAccumX -= 1;
        this._jumpToken(+1);
      }
      while (this._stepAccumX <= -1) {
        this._stepAccumX += 1;
        this._jumpToken(-1);
      }
      while (this._stepAccumY >= 1) {
        this._stepAccumY -= 1;
        this._jumpLine(+1);
      }
      while (this._stepAccumY <= -1) {
        this._stepAccumY += 1;
        this._jumpLine(-1);
      }

      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Token navigation (joystick X)
  // ─────────────────────────────────────────────────────────────────────

  _editor() {
    return this.liveCodeEditor?.editor || null;
  }

  /**
   * Find the next/previous numeric token from the current cursor position.
   * Moves the cursor to it and selects it (for visual feedback + value editing).
   */
  _jumpToken(direction) {
    const cm = this._editor();
    if (!cm) return;

    const cursor = cm.getCursor();
    const tokens = this._collectNumberTokens();
    if (tokens.length === 0) return;

    // Find current cursor position in flat ordering
    const cursorPos = this._posToOffset(cm, cursor);

    let target = null;
    if (direction > 0) {
      // First token whose start > cursor
      target = tokens.find(t => this._posToOffset(cm, t.from) > cursorPos);
      if (!target) target = tokens[0];  // wrap to start
    } else {
      // Last token whose end < cursor
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (this._posToOffset(cm, tokens[i].to) < cursorPos) {
          target = tokens[i];
          break;
        }
      }
      if (!target) target = tokens[tokens.length - 1];  // wrap to end
    }

    if (target) {
      this._selectToken(target);
    }
  }

  /**
   * Move cursor down/up a line, then snap to the first/closest number on that line.
   */
  _jumpLine(direction) {
    const cm = this._editor();
    if (!cm) return;

    const cursor = cm.getCursor();
    const lastLine = cm.lastLine();
    let targetLine = cursor.line + direction;
    if (targetLine < 0) targetLine = lastLine;
    if (targetLine > lastLine) targetLine = 0;

    // Find first number token on the target line
    const tokens = this._collectNumberTokens().filter(t => t.from.line === targetLine);

    if (tokens.length > 0) {
      // Pick token closest in column to current cursor column
      let best = tokens[0];
      let bestDist = Math.abs(tokens[0].from.ch - cursor.ch);
      for (const t of tokens) {
        const d = Math.abs(t.from.ch - cursor.ch);
        if (d < bestDist) { best = t; bestDist = d; }
      }
      this._selectToken(best);
    } else {
      // No number on that line — just move cursor and clear selection
      cm.setCursor({ line: targetLine, ch: 0 });
      this.currentToken = null;
    }
  }

  /**
   * Walk the CodeMirror tokenizer to find every numeric token in the buffer.
   * Returns sorted-by-position array of { from, to, text, value }.
   *
   * Handles:
   *   - integers and decimals: 10, 0.5, .5
   *   - negative numbers (preceded by '-' as part of value)
   *   - hex literals: 0x00ffff (treated as numbers — important for color params)
   */
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
        let to = { line, ch: tok.end };
        let text = tok.string;

        // Look back for unary minus: previous non-whitespace token is '-' AND
        // the token before *that* is an operator or punctuation (so it's unary, not binary).
        // Simple heuristic: if prev token is '-' and the one before is ':' '(' ',' '[' or absent.
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
        if (!Number.isNaN(value)) {
          tokens.push({ from, to, text, value });
        }
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

    // Reset pickup mode for the value knob — fresh token, knob must re-match
    const pickup = this.knobPickup.get(this.config.valueKnob);
    if (pickup) pickup.matched = false;
  }

  _posToOffset(cm, pos) {
    return cm.indexFromPos(pos);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Value knob (CC1): rewrite the selected number
  // ─────────────────────────────────────────────────────────────────────

  _handleValueKnob(ccNum, norm) {
    if (!this.currentToken) return;
    const cm = this._editor();
    if (!cm) return;

    // Pickup logic: ignore knob until physical position crosses the token's current value
    // (mapped into the knob's 0..1 space using the token's inferred range).
    const range = this._inferRange(this.currentToken);
    const currentNorm = this._clamp((this.currentToken.value - range.min) / (range.max - range.min), 0, 1);

    let pickup = this.knobPickup.get(ccNum);
    if (!pickup) {
      pickup = { matched: false, lastValue: norm };
      this.knobPickup.set(ccNum, pickup);
    }

    if (!pickup.matched) {
      // Did we cross the current value?
      const crossed =
        (pickup.lastValue <= currentNorm && norm >= currentNorm) ||
        (pickup.lastValue >= currentNorm && norm <= currentNorm);
      pickup.lastValue = norm;
      if (!crossed) return;
      pickup.matched = true;
    }
    pickup.lastValue = norm;

    // Map knob position into the token's range and format
    const newValue = range.min + norm * (range.max - range.min);
    const formatted = this._formatNumber(newValue, this.currentToken.text);

    // Rewrite the token in the editor — and update currentToken to reflect new bounds
    const from = this.currentToken.from;
    const to = this.currentToken.to;

    // Replace in editor (suppress history grouping per-tick so undo is one operation per token)
    cm.replaceRange(formatted, from, to, '+midi');

    // Recompute new token bounds (length may have changed)
    const newTo = { line: from.line, ch: from.ch + formatted.length };
    cm.setSelection(from, newTo);
    this.currentToken = { from, to: newTo, text: formatted, value: newValue };
  }

  /**
   * Infer a sensible knob range from the token's current text/value.
   * Heuristics:
   *   - 0..1 if current value is between 0 and 1 (opacity, normalized params)
   *   - -1..1 if current value is between -1 and 1
   *   - 0..N*2 where N = max(current value * 2, 10) otherwise — gives headroom both ways
   *   - hex literals (0x...): treat as 0..0xffffff for colors
   */
  _inferRange(token) {
    if (token.text.startsWith('0x') || token.text.startsWith('0X')) {
      return { min: 0, max: 0xffffff };
    }
    const v = Math.abs(token.value);
    if (token.value >= 0 && token.value <= 1) return { min: 0, max: 1 };
    if (token.value >= -1 && token.value <= 1) return { min: -1, max: 1 };
    // Otherwise give 2x headroom on both sides of current value
    const span = Math.max(v * 2, 10);
    if (token.value < 0) return { min: -span, max: span };
    return { min: 0, max: span };
  }

  /**
   * Format a number to match the precision/style of the original text.
   * "10" → "13" (integer)
   * "0.5" → "0.73" (2 decimals)
   * ".5" → ".73" (preserve leading-dot style)
   * "0x00ffff" → "0x00aabb" (hex with same width)
   */
  _formatNumber(value, originalText) {
    if (originalText.startsWith('0x') || originalText.startsWith('0X')) {
      const intVal = Math.round(this._clamp(value, 0, 0xffffff));
      const hexWidth = originalText.length - 2;
      return '0x' + intVal.toString(16).padStart(hexWidth, '0');
    }

    // Negative sign handling
    const stripped = originalText.replace(/^-/, '');

    if (stripped.includes('.')) {
      const decimalPart = stripped.split('.')[1] || '';
      const decimals = Math.max(1, Math.min(decimalPart.length, 4));
      // Preserve leading-dot style (.5 not 0.5)
      let out = value.toFixed(decimals);
      if (stripped.startsWith('.') && out.startsWith('0.')) {
        out = out.slice(1);  // "0.73" → ".73"
      } else if (stripped.startsWith('.') && out.startsWith('-0.')) {
        out = '-' + out.slice(2);
      }
      return out;
    }
    // Integer original — round to integer
    return Math.round(value).toString();
  }

  _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ─────────────────────────────────────────────────────────────────────
  // Pad → execute
  // ─────────────────────────────────────────────────────────────────────

  _triggerExecute() {
    if (this.onExecute) this.onExecute();
  }
}