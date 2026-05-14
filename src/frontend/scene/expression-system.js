/**
 * Expression System - Expression evaluation for dynamic parameters
 *
 * Single class: ExpressionEvaluator. The former ParameterAnimator class
 * has been absorbed into SceneManager directly.
 *
 * MIDI integration: call setMidiState(midiState) to make MIDI variables
 * (cc1..cc127, note0..note127, noteHeld0..noteHeld127, pitchBend, chPressure)
 * available inside any expression string. e.g. scale: "cc1 * 10"
 */

export class ExpressionEvaluator {
  constructor() {
    this.midiState = null;

    this.mathFunctions = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      abs: Math.abs,
      sqrt: Math.sqrt,
      pow: Math.pow,
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      PI: Math.PI,
      E: Math.E
    };
  }

  /**
   * Attach a MidiState. Its values become live variables in every evaluate() call.
   * cc1..cc127       — normalized 0..1
   * ccRaw1..ccRaw127 — raw 0..127
   * note0..note127   — last note-on velocity (0 if released)
   * noteHeld0..noteHeld127 — 1 while held, 0 otherwise
   * pitchBend        — -1..1
   * chPressure       — 0..1
   */
  setMidiState(midiState) {
    this.midiState = midiState;
  }

  evaluate(expression, context = {}) {
    try {
      const { time = 0, ...ballData } = context;

      const scope = {
        time,
        t: time,
        ...this.mathFunctions
      };

      // Merge MIDI variables into scope (cc1..cc127, note0..note127, etc.)
      if (this.midiState) {
        Object.assign(scope, this.midiState.getScope());
      }

      // Flatten ball positions into scope: ball_0_x, ball_0_y, ball_0_vx, ball_0_vy
      // Also expose as b0x, b0y etc for brevity
      for (const [key, val] of Object.entries(ballData)) {
        if (val && typeof val === 'object') {
          scope[key] = val; // keep full object e.g. ball_0
          const idx = key.match(/\d+/)?.[0] ?? '';
          scope[`${key}_x`]  = val.x  ?? 0;
          scope[`${key}_y`]  = val.y  ?? 0;
          scope[`${key}_vx`] = val.vx ?? 0;
          scope[`${key}_vy`] = val.vy ?? 0;
          scope[`b${idx}x`]  = val.x  ?? 0;
          scope[`b${idx}y`]  = val.y  ?? 0;
        } else {
          scope[key] = val;
        }
      }

      const paramNames = Object.keys(scope);
      const paramValues = Object.values(scope);

      const func = new Function(
        ...paramNames,
        `"use strict"; return (${expression});`
      );

      return func(...paramValues);

    } catch (error) {
      console.error(`Expression evaluation error: ${error.message}`, expression);
      return 0;
    }
  }

  isExpression(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return false;
    }

    const stringEnums = ['triangle', 'circle', 'rectangle', 'polygon'];
    if (stringEnums.includes(value.toLowerCase())) {
      return false;
    }

    const hasOperators = /[+\-*/%()]/.test(value);
    const hasFunctions = /\b(sin|cos|tan|abs|sqrt|pow|min|max|floor|ceil|round|PI|E)\b/.test(value);
    const hasTimeVar = /\btime\b|\bt\b/.test(value);
    const hasBallVar = /\bball_\d+\b|\bb\d+[xy]\b/.test(value);
    // Detect MIDI variables: cc1, ccRaw5, note36, noteHeld36, pitchBend, chPressure
    const hasMidiVar = /\bcc(Raw)?\d+\b|\bnote(Held)?\d+\b|\bpitchBend\b|\bchPressure\b/.test(value);

    return hasOperators || hasFunctions || hasTimeVar || hasBallVar || hasMidiVar;
  }

  validate(expression) {
    try {
      const testContext = {
        time: 0,
        ball_0: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        ball_1: { x: 0.5, y: 0.5, vx: 0, vy: 0 },
        ball_2: { x: 0.5, y: 0.5, vx: 0, vy: 0 }
      };
      this.evaluate(expression, testContext);
      return true;
    } catch (error) {
      return false;
    }
  }
}