/**
 * MidiState - Single source of truth for current MIDI control values.
 *
 * Values are exposed via getScope() and merged into the ExpressionEvaluator
 * scope. This means any string parameter in the live-code config that uses
 * a CC variable (e.g. `scale: "cc1 * 10"`) reads it for free, every frame.
 *
 * Naming convention (auto-available, no config required):
 *   cc1   ... cc127    Control change values, normalized 0..1
 *   ccRaw1 ... ccRaw127 Raw MIDI values 0..127 (if you want unscaled)
 *   note0 ... note127  Note-on velocity 0..1 (0 if not pressed)
 *   noteHeld0 ... noteHeld127  1 while held, 0 otherwise
 *   pitchBend          -1..1
 *   chPressure         0..1 (channel aftertouch)
 *
 * Joystick mapping is handled by the controller — most controllers send
 * the joystick as two CC numbers, so it shows up as cc<N> like anything else.
 */

export class MidiState {
  constructor() {
    // Initialize all 128 CCs to 0 (normalized) so expressions never see undefined
    this.cc = new Float32Array(128);
    this.ccRaw = new Uint8Array(128);
    this.note = new Float32Array(128);       // velocity 0..1 (latched on note-on, 0 on note-off)
    this.noteHeld = new Uint8Array(128);     // 1 while held
    this.pitchBend = 0;                      // -1..1
    this.chPressure = 0;                     // 0..1

    // Listeners for "value changed" — used by editor bridge to know when to rewrite text
    this.listeners = new Set();

    // Cached scope object, rebuilt only when shape changes (which is never after init)
    this._scope = this._buildScope();
  }

  _buildScope() {
    const scope = {};
    for (let i = 0; i < 128; i++) {
      Object.defineProperty(scope, `cc${i}`, {
        get: () => this.cc[i],
        enumerable: true
      });
      Object.defineProperty(scope, `ccRaw${i}`, {
        get: () => this.ccRaw[i],
        enumerable: true
      });
      Object.defineProperty(scope, `note${i}`, {
        get: () => this.note[i],
        enumerable: true
      });
      Object.defineProperty(scope, `noteHeld${i}`, {
        get: () => this.noteHeld[i],
        enumerable: true
      });
    }
    Object.defineProperty(scope, 'pitchBend', {
      get: () => this.pitchBend,
      enumerable: true
    });
    Object.defineProperty(scope, 'chPressure', {
      get: () => this.chPressure,
      enumerable: true
    });
    return scope;
  }

  /** Returns an object whose property reads always reflect current values. */
  getScope() {
    return this._scope;
  }

  setCC(num, rawValue) {
    if (num < 0 || num > 127) return;
    this.ccRaw[num] = rawValue;
    this.cc[num] = rawValue / 127;
    this._emit({ type: 'cc', num, raw: rawValue, value: this.cc[num] });
  }

  setNoteOn(num, velocity) {
    if (num < 0 || num > 127) return;
    this.note[num] = velocity / 127;
    this.noteHeld[num] = 1;
    this._emit({ type: 'noteOn', num, velocity: this.note[num] });
  }

  setNoteOff(num) {
    if (num < 0 || num > 127) return;
    this.note[num] = 0;
    this.noteHeld[num] = 0;
    this._emit({ type: 'noteOff', num });
  }

  setPitchBend(value14bit) {
    // 0..16383, center 8192
    this.pitchBend = (value14bit - 8192) / 8192;
    this._emit({ type: 'pitchBend', value: this.pitchBend });
  }

  setChannelPressure(rawValue) {
    this.chPressure = rawValue / 127;
    this._emit({ type: 'chPressure', value: this.chPressure });
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch (e) { console.error('MidiState listener error:', e); }
    }
  }
}