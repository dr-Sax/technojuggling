/**
 * Cursor Navigation Handler
 * Handles foot mouse navigation (line/segment) and param scrubbing.
 * Param scrub is delegated to ParamScrubHandler via the param-scrub module.
 */

import { ParamScrubHandler } from './param-scrub.js';
import { FootMouseTracker } from './foot-mouse-tracker.js';

export class CursorNavigationHandler {
  constructor(liveCodeEditor, websocketClient) {
    this.editor = liveCodeEditor;
    this.wsClient = websocketClient;
    this.currentLine = 0;
    this.currentSegmentIndex = 0;
    this.currentLineSegments = [];

    // Param scrub handler (kept for backwards compat but no longer triggered by foot mouse)
    this.paramScrub = new ParamScrubHandler(liveCodeEditor);

    // Foot mouse tracker — accumulates trackball deltas into window.footMouse
    this.footMouseTracker = new FootMouseTracker();

    // Mode: 'nav' | 'fm'
    // 'nav' — trackball moves cursor through live code (default)
    // 'fm'  — trackball feeds window.footMouse, cursor frozen to foot input
    this.mode = 'nav';

    // Wire WebSocket callbacks
    // scrub_mode_toggle is reused as the NAV <-> FM toggle:
    //   active: true  → FM mode
    //   active: false → NAV mode
    this.wsClient.onCursorNavigate  = (data) => this._handleNavigation(data);
    this.wsClient.onCursorClick     = (data) => this.handleClick(data);
    this.wsClient.onParamScrub      = (data) => { /* scrub retired — no-op */ };
    this.wsClient.onScrubModeToggle = (data) => this._onModeToggle(data.active);
    this.wsClient.onFootMouseMove   = (data) => this.footMouseTracker.onMove(data.dx, data.dy);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _handleNavigation(data) {
    // In FM mode: route trackball ticks directly into window.footMouse
    // cursor_navigate carries nav_type ('line' = Y axis, 'segment' = X axis)
    if (this.mode === 'fm') {
      // 'line' = trackball Y axis (horizontal roll) → fmx
      // 'segment' = trackball X axis (vertical roll) → fmy
      // Swap these if your trackball axes feel inverted.
      if (data.nav_type === 'line') {
        this.footMouseTracker.onMove(data.direction, 0);
      } else if (data.nav_type === 'segment') {
        this.footMouseTracker.onMove(0, data.direction);
      }
      return;
    }

    if (data.nav_type === 'line') {
      this.navigateLine(data.direction);
    } else if (data.nav_type === 'segment') {
      this.navigateSegment(data.direction);
    }
  }

  handleClick(data) {
    if (data.click_type === 'double_click') {
      this.selectCurrentSegment();
    }
  }

  navigateLine(direction) {
    const editor = this.editor.editor;
    if (!editor) return;

    const lineCount = editor.lineCount();
    this.currentLine += direction;

    if (this.currentLine < 0) {
      this.currentLine = lineCount - 1;
    } else if (this.currentLine >= lineCount) {
      this.currentLine = 0;
    }

    this.currentLineSegments = this.findSegments(this.currentLine);
    this.currentSegmentIndex = 0;

    const ch = this.currentLineSegments.length > 0 ? this.currentLineSegments[0].start : 0;
    editor.setCursor({ line: this.currentLine, ch });
    editor.focus();
  }

  navigateSegment(direction) {
    const editor = this.editor.editor;
    if (!editor) return;

    if (this.currentLineSegments.length === 0) {
      const cursor = editor.getCursor();
      this.currentLine = cursor.line;
      this.currentLineSegments = this.findSegments(this.currentLine);
      this.currentSegmentIndex = this.findCurrentSegmentIndex(cursor.ch);
    }

    if (this.currentLineSegments.length === 0) return;

    this.currentSegmentIndex += direction;

    if (this.currentSegmentIndex < 0) {
      this.navigateLine(-1);
      this.currentSegmentIndex = Math.max(0, this.currentLineSegments.length - 1);
    } else if (this.currentSegmentIndex >= this.currentLineSegments.length) {
      this.navigateLine(1);
      this.currentSegmentIndex = 0;
    }

    const segment = this.currentLineSegments[this.currentSegmentIndex];
    if (segment) {
      editor.setCursor({ line: this.currentLine, ch: segment.start });
      editor.focus();
    }
  }

  findSegments(lineNum) {
    const editor = this.editor.editor;
    if (!editor) return [];

    const line = editor.getLine(lineNum);
    if (!line) return [];

    const segments = [];
    const segmentRegex = /\b\w+\b|"[^"]*"|'[^']*'|\d+\.?\d*/g;

    let match;
    while ((match = segmentRegex.exec(line)) !== null) {
      const text = match[0];
      if (!text.match(/^[,:{}()\[\]]+$/)) {
        segments.push({
          text:  text,
          start: match.index,
          end:   match.index + text.length,
        });
      }
    }

    return segments;
  }

  findCurrentSegmentIndex(ch) {
    for (let i = 0; i < this.currentLineSegments.length; i++) {
      const seg = this.currentLineSegments[i];
      if (ch >= seg.start && ch <= seg.end) return i;
    }

    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < this.currentLineSegments.length; i++) {
      const seg  = this.currentLineSegments[i];
      const dist = Math.min(Math.abs(ch - seg.start), Math.abs(ch - seg.end));
      if (dist < minDist) { minDist = dist; nearest = i; }
    }
    return nearest;
  }

  selectCurrentSegment() {
    const editor = this.editor.editor;
    if (!editor) return;

    const cursor = editor.getCursor();
    this.currentLine = cursor.line;
    this.currentLineSegments = this.findSegments(this.currentLine);

    if (this.currentLineSegments.length === 0) return;

    this.currentSegmentIndex = this.findCurrentSegmentIndex(cursor.ch);
    const segment = this.currentLineSegments[this.currentSegmentIndex];

    if (segment) {
      let startCh = segment.start;
      let endCh   = segment.end;

      const text = segment.text;
      if ((text.startsWith('"') && text.endsWith('"')) ||
          (text.startsWith("'") && text.endsWith("'"))) {
        startCh += 1;
        endCh   -= 1;
      }

      editor.setSelection(
        { line: this.currentLine, ch: startCh },
        { line: this.currentLine, ch: endCh }
      );
      editor.focus();
    }
  }

  // ── Mode toggle & indicator ───────────────────────────────────────────────

  _onModeToggle(fmActive) {
    this.mode = fmActive ? 'fm' : 'nav';
    this._updateModeIndicator();
  }

  _updateModeIndicator() {
    let el = document.getElementById('foot-mode-indicator');

    if (!el) {
      el = document.createElement('div');
      el.id = 'foot-mode-indicator';
      Object.assign(el.style, {
        position:      'fixed',
        bottom:        '14px',
        right:         '14px',
        padding:       '4px 12px',
        borderRadius:  '4px',
        fontFamily:    "'Courier New', monospace",
        fontSize:      '13px',
        fontWeight:    'bold',
        letterSpacing: '0.08em',
        zIndex:        '9999',
        pointerEvents: 'none',
        transition:    'background 0.15s, color 0.15s',
        userSelect:    'none',
      });
      document.body.appendChild(el);
    }

    if (this.mode === 'fm') {
      el.textContent      = '\u25CF FM';          // ● FM
      el.style.background = '#7b2fff';
      el.style.color      = '#fff';
      el.style.opacity    = '1';
    } else {
      el.textContent      = '\u2195 NAV';          // ↕ NAV
      el.style.background = 'rgba(20,20,40,0.85)';
      el.style.color      = 'rgba(255,255,255,0.6)';
      el.style.opacity    = '0.85';
    }
  }
}