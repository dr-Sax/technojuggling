/**
 * Foot Mouse Tracker
 *
 * Accumulates raw trackball delta events from the server into a global
 * window.footMouse object that live-code expressions can reference freely,
 * without needing cursor focus on any particular line.
 *
 * Server message expected:
 *   { type: "foot_mouse_move", dx: <number>, dy: <number> }
 *
 * Values exposed on window.footMouse:
 *   .x   — accumulated horizontal position  (unbounded, can be negative)
 *   .y   — accumulated vertical position    (unbounded, can be negative)
 *   .vx  — instantaneous horizontal velocity (delta per event, decays to 0)
 *   .vy  — instantaneous vertical velocity
 *   .reset() — zero out x/y (useful to call from live code)
 *
 * Usage in expressions:
 *   rotation: "fmx * 0.5"
 *   scale:    "1 + abs(fmy) * 0.02"
 *   hue:      "fmx % 360"
 *
 * Short aliases available in expression scope (expression-system.js):
 *   fmx  → footMouse.x
 *   fmy  → footMouse.y
 *   fmvx → footMouse.vx
 *   fmvy → footMouse.vy
 *
 * Sensitivity can be tuned per-axis. Default 1.0 means 1 unit per raw delta
 * tick. Typical trackball sends integer deltas of 1–5 per physical movement.
 */

const DEFAULT_SENSITIVITY_X = 1.0;
const DEFAULT_SENSITIVITY_Y = 1.0;

// Velocity decays toward zero each animation frame (0 = instant decay, 1 = no decay).
// 0.85 gives a comfortable ~10-frame tail at 60fps.
const VELOCITY_DECAY = 0.85;

export class FootMouseTracker {
  constructor(sensitivityX = DEFAULT_SENSITIVITY_X, sensitivityY = DEFAULT_SENSITIVITY_Y) {
    this.sensitivityX = sensitivityX;
    this.sensitivityY = sensitivityY;

    // Initialize the global immediately so live code never sees undefined
    if (!window.footMouse) {
      window.footMouse = {
        x:  0,
        y:  0,
        vx: 0,
        vy: 0,
        reset() {
          this.x  = 0;
          this.y  = 0;
          this.vx = 0;
          this.vy = 0;
        },
        // Optional per-axis reset
        resetX() { this.x = 0; this.vx = 0; },
        resetY() { this.y = 0; this.vy = 0; },
      };
    }

    // Kick off the velocity decay loop
    this._startDecayLoop();
  }

  /**
   * Called by CursorNavigationHandler when a foot_mouse_move message arrives.
   * dx/dy are raw integer trackball deltas from the server.
   */
  onMove(dx, dy) {
    const scaledDx = dx * this.sensitivityX;
    const scaledDy = dy * this.sensitivityY;

    window.footMouse.x  += scaledDx;
    window.footMouse.y  += scaledDy;
    window.footMouse.vx  = scaledDx;   // instantaneous; decayed by loop below
    window.footMouse.vy  = scaledDy;
  }

  /**
   * rAF loop that decays velocity smoothly when the trackball is idle.
   * Runs independently of the Three.js render loop so it works even when
   * the scene manager isn't ticking.
   */
  _startDecayLoop() {
    const decay = () => {
      const fm = window.footMouse;
      if (fm) {
        fm.vx *= VELOCITY_DECAY;
        fm.vy *= VELOCITY_DECAY;
        // Snap to zero below floating-point noise floor
        if (Math.abs(fm.vx) < 0.001) fm.vx = 0;
        if (Math.abs(fm.vy) < 0.001) fm.vy = 0;
      }
      requestAnimationFrame(decay);
    };
    requestAnimationFrame(decay);
  }
}