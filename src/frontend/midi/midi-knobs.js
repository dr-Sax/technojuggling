/**
 * MidiKnobs — MIDI control for the live-code editor (Akai MPK Mini).
 *
 * 8 channels, each one knob (CC) paired with one pad (note):
 *   knob, unlocked  → cursor: sweeps the highlight across every value that has
 *                     a range comment, scrolling it into view.
 *   pad             → lock / unlock the channel.
 *   knob, locked    → rewrites the highlighted value and re-runs the buffer.
 *
 * Range comments, written in a // right after the value:
 *   scale: 5        //0,50              continuous, integer  (token has no '.')
 *   gain:  0.50     //0,1               continuous, float    (token has a '.')
 *   step:  0.0      //[0,1], 11         11 evenly-spaced discrete values
 *   shape: "circle" //["circle","box"]  pick from a string set
 *
 * A value is reachable only when its type matches its comment — numbers take
 * numeric ranges, strings take string-set ranges. So an expression such as
 * `scale: "b0x*20" //[0,50],51` is ignored and never overwritten.
 *
 * INITIAL CONDITIONS (cc tags):
 *   A taggable value may carry a knob tag at the end of its range comment to
 *   bind a knob to it when the script loads:
 *     scale:   10   //[0,50],51 cc70    position knob 70's cursor here (unlocked)
 *     opacity: 0.8  //[0,1],100 cc71!   position AND lock knob 71 on load
 *   The `!` suffix locks on load, so the knob controls the value immediately
 *   (with sweep-to-pickup, so it won't jump on the first move).
 *
 *   Tags are re-applied on initial load and on every manual refresh (Ctrl-Enter)
 *   — so pasting in a new script and hitting Ctrl-Enter re-binds the knobs. A
 *   knob's own value rewrites do NOT re-seed, so live tweaks are preserved.
 *
 *   Because the tag lives in the comment (never rewritten by the knob) and rides
 *   along with the line it's on, it can't desync from its parameter. Only literal
 *   numbers (and strlist strings) are taggable — the same constraint as cursor
 *   reachability — and the tag must follow a range comment.
 */

const CHANNELS = [
  { knob: 70, pad: 40 }, { knob: 71, pad: 41 },
  { knob: 72, pad: 42 }, { knob: 73, pad: 43 },
  { knob: 74, pad: 36 }, { knob: 75, pad: 37 },
  { knob: 76, pad: 38 }, { knob: 77, pad: 39 },
];

const EXECUTE_THROTTLE_MS = 33;
const USE_PICKUP = true;   // a locked knob must sweep through the value's current
                           // position before taking over (no jump). false = grab.

export class MidiKnobs {
  constructor(liveCodeEditor, onExecute) {
    this.cm = liveCodeEditor.editor;
    this.onExecute = onExecute;
    this.inputs = new Map();
    this.channels = CHANNELS.map((c, i) => ({
      index: i, knob: c.knob, pad: c.pad,
      locked: false,
      token: null,     // { from, to, text, type, range, cc, lockOnLoad }
      slot: -1,        // token index the cursor last landed on
      marker: null,    // CodeMirror highlight + live position source
      armed: false,    // true while a locked channel awaits pickup
      pickup: null,    // last knob position seen while arming
    }));
    this._lastExec = 0;
    this._execTimer = null;

    // Ctrl-Enter re-seeds knob→param mappings from cc tags, then runs the
    // normal execute. Knob-driven executes don't pass through here, so they
    // never disturb live channel state. This keymap takes precedence over the
    // editor's own Ctrl-Enter, so we invoke execute ourselves to keep it firing once.
    this._refreshKeyMap = {
      'Ctrl-Enter': () => {
        this.applyInitialMappings();
        this.onExecute?.();
      },
    };
    this.cm.addKeyMap(this._refreshKeyMap);
  }

  // ── Connection ──────────────────────────────────────────────────────────
  async connect() {
    if (!navigator.requestMIDIAccess) { console.warn('Web MIDI unavailable.'); return false; }
    const access = await navigator.requestMIDIAccess({ sysex: false });
    const attach = (input) => {
      if (this.inputs.has(input.id)) return;
      input.onmidimessage = (m) => this._route(m.data);
      this.inputs.set(input.id, input);
      console.log(`\u2713 MIDI input: ${input.name}`);
    };
    for (const input of access.inputs.values()) attach(input);
    access.onstatechange = (e) => {
      if (e.port.type === 'input' && e.port.state === 'connected') attach(e.port);
    };
    console.log(`\u2713 MidiKnobs connected — ${this.inputs.size} input(s)`);
    return true;
  }

  // ── Routing ─────────────────────────────────────────────────────────────
  _route([status, d1, d2]) {
    const cmd = status & 0xf0;
    if (cmd === 0xb0) {                                  // control change = knob
      const ch = this.channels.find((c) => c.knob === d1);
      if (ch) ch.locked ? this._setValue(ch, d2 / 127) : this._moveCursor(ch, d2);
    } else if (cmd === 0x90 && d2 > 0) {                 // note on = pad
      const ch = this.channels.find((c) => c.pad === d1);
      if (ch) this._toggleLock(ch);
    }
  }

  // ── Initial conditions (cc tags) ────────────────────────────────────────────
  // Seed each channel from `cc<N>` / `cc<N>!` tags in the live-code comments.
  // Called on initial load and on every manual refresh (Ctrl-Enter). A knob's
  // own value rewrites never call this, so live performance state is preserved.
  applyInitialMappings() {
    const tokens = this._scanTokens();

    // Map knob CC → { token, slot }. First tag wins on duplicates.
    const byCc = new Map();
    tokens.forEach((tok, i) => {
      if (tok.cc == null) return;
      if (byCc.has(tok.cc)) {
        console.warn(`MidiKnobs: duplicate cc${tok.cc} tag — keeping the first`);
        return;
      }
      byCc.set(tok.cc, { tok, slot: i });
    });

    for (const ch of this.channels) {
      const hit = byCc.get(ch.knob);
      if (!hit) {
        // No tag for this knob: reset it to an idle, unlocked cursor.
        ch.marker?.clear();
        ch.marker = null;
        ch.locked = false;
        ch.token  = null;
        ch.slot   = -1;
        ch.armed  = false;
        ch.pickup = null;
        continue;
      }
      ch.token  = hit.tok;
      ch.slot   = hit.slot;
      ch.locked = hit.tok.lockOnLoad;
      ch.armed  = ch.locked && USE_PICKUP;  // sweep-to-pickup so it won't jump
      ch.pickup = null;
      this._highlight(ch, false);           // no scroll during bulk seeding
    }
  }

  // ── Cursor mode ───────────────────────────────────────────────────────────
  _moveCursor(ch, raw) {
    const tokens = this._scanTokens();
    if (!tokens.length) return;
    const slot = tokens.length === 1
      ? 0
      : Math.round((Math.min(127, Math.max(0, raw)) / 127) * (tokens.length - 1));
    if (slot === ch.slot) return;            // still inside the same token
    ch.slot = slot;
    ch.token = tokens[slot];
    this._highlight(ch);
  }

  // ── Lock toggle (pad) ──────────────────────────────────────────────────────
  _toggleLock(ch) {
    if (!ch.token) return;
    ch.locked = !ch.locked;
    if (ch.locked) { ch.armed = USE_PICKUP; ch.pickup = null; }
    else           { ch.slot = -1; }         // force re-pick on next cursor move
    this._highlight(ch);
  }

  // ── Value mode (locked knob rewrites the highlighted value) ────────────────
  _setValue(ch, knob) {
    if (!ch.token || !ch.marker) return;
    const { range } = ch.token;

    // Pickup guard: until the knob sweeps through the value's current position,
    // ignore it — so locking mid-travel doesn't jump the value.
    if (ch.armed && range.kind === 'range') {
      const here = (Number(ch.token.text) - range.min) / (range.max - range.min);
      if (ch.pickup === null) { ch.pickup = knob; return; }
      const crossed = (ch.pickup <= here && knob >= here) || (ch.pickup >= here && knob <= here);
      ch.pickup = knob;
      if (!crossed) return;
      ch.armed = false;
    }

    const text = this._format(ch.token, knob);
    if (text === ch.token.text) return;      // no change

    const pos = ch.marker.find();            // marker tracks the live position
    if (!pos) return;
    this.cm.replaceRange(text, pos.from, pos.to, '+midi');
    ch.token = {
      ...ch.token, text,
      from: pos.from,
      to: { line: pos.from.line, ch: pos.from.ch + text.length },
    };
    this._highlight(ch);
    this._executeSoon();
  }

  // ── Highlight (and keep the value in view) ─────────────────────────────────
  _highlight(ch, scroll = true) {
    ch.marker?.clear();
    ch.marker = null;
    if (!ch.token) return;
    const cls = `midi-ch-${ch.index}${ch.locked ? ' midi-locked' : ''}`;
    ch.marker = this.cm.markText(ch.token.from, ch.token.to, { className: cls });
    if (scroll) this.cm.scrollIntoView({ from: ch.token.from, to: ch.token.to }, 80);
  }

  // ── Token scanning ──────────────────────────────────────────────────────────
  // Every number/string token carrying a matching range comment, in document
  // order. These are the only values a knob can land on. Each token also carries
  // its cc tag (if any), parsed from the trailing comment.
  _scanTokens() {
    const out = [];
    for (let line = 0; line < this.cm.lineCount(); line++) {
      const toks = this.cm.getLineTokens(line, true);
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i];
        if (tok.type !== 'number' && tok.type !== 'string') continue;

        let from = { line, ch: tok.start };
        let text = tok.string;
        // fold a unary minus into a number (-30, not 30)
        if (tok.type === 'number' && toks[i - 1]?.string === '-') {
          const before = (toks[i - 2]?.string ?? '').trim();
          if (before === '' || /^[:(\[,=+\-*/%]$/.test(before)) {
            from = { line, ch: toks[i - 1].start };
            text = '-' + text;
          }
        }
        const to = { line, ch: tok.end };

        const range = this._rangeFor(line, to.ch);
        if (!range) continue;
        const numeric = range.kind === 'range' || range.kind === 'numlist';
        if (tok.type === 'number' && !numeric) continue;
        if (tok.type === 'string' && range.kind !== 'strlist') continue;

        const cc = this._ccTagFor(line, to.ch);
        out.push({
          from, to, text, type: tok.type, range,
          cc: cc?.num ?? null,
          lockOnLoad: cc?.lock ?? false,
        });
      }
    }
    return out;
  }

  // Parse a knob tag from the token's trailing comment:
  //   cc70   → position knob 70's cursor here (unlocked)
  //   cc70!  → also lock it on load, so the knob controls the value immediately
  _ccTagFor(line, afterCh) {
    const tail = (this.cm.getLine(line) || '').slice(afterCh);
    const at = tail.indexOf('//');
    if (at === -1) return null;
    const m = tail.slice(at + 2).match(/\bcc(\d+)\s*(!)?/i);
    return m ? { num: parseInt(m[1], 10), lock: !!m[2] } : null;
  }

  // Parse the range comment that follows a token. Returns one of:
  //   { kind: 'range',   min, max }        continuous numeric
  //   { kind: 'numlist', values: [...] }   discrete numeric steps
  //   { kind: 'strlist', values: [...] }   string set
  _rangeFor(line, afterCh) {
    const tail = (this.cm.getLine(line) || '').slice(afterCh);

    // //[ ... ] with optional , N
    const bracket = tail.match(/^[\s,]*\/\/\s*\[([^\]]*)\]\s*(?:,\s*(\d+))?/);
    if (bracket) {
      const inner = bracket[1].trim();
      if (/['"]/.test(inner)) {
        const values = (inner.match(/(['"])(.*?)\1/g) || []).map((s) => s.slice(1, -1));
        return values.length ? { kind: 'strlist', values } : null;
      }
      const [a, b] = inner.split(',').map((s) => Number(s.trim()));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      const n = bracket[2] ? parseInt(bracket[2], 10) : 0;
      if (n >= 2) {
        const values = Array.from({ length: n }, (_, k) => a + (b - a) * (k / (n - 1)));
        return { kind: 'numlist', values };
      }
      return this._range(a, b);
    }

    // //min,max
    const dec = tail.match(/^[\s,]*\/\/\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    return dec ? this._range(Number(dec[1]), Number(dec[2])) : null;
  }

  _range(a, b) {
    return a === b ? null : { kind: 'range', min: Math.min(a, b), max: Math.max(a, b) };
  }

  // ── Value formatting ────────────────────────────────────────────────────────
  // knob (0..1) → replacement text, matching the original token's style.
  _format(token, knob) {
    const r = token.range;
    if (r.kind === 'strlist') {
      const v = r.values[Math.min(r.values.length - 1, Math.floor(knob * r.values.length))];
      const q = token.text[0] === "'" ? "'" : '"';
      return q + v + q;
    }
    if (r.kind === 'numlist') {
      const v = r.values[Math.min(r.values.length - 1, Math.floor(knob * r.values.length))];
      return this._num(v, token.text);
    }
    return this._num(r.min + knob * (r.max - r.min), token.text);
  }

  // Integer vs float comes from how the original was written:
  //   "5" → integer,  "0.50" → 2 decimals,  ".5" → keep the missing leading zero.
  _num(value, original) {
    const body = original.replace(/^-/, '');
    if (!body.includes('.')) return String(Math.round(value));
    const places = Math.max(1, Math.min((body.split('.')[1] || '').length, 4));
    let out = value.toFixed(places);
    if (body.startsWith('.')) out = out.replace(/^(-?)0\./, '$1.');
    return out;
  }

  // ── Re-execute (trailing-edge throttle) ──────────────────────────────────────
  _executeSoon() {
    const now = performance.now();
    const wait = EXECUTE_THROTTLE_MS - (now - this._lastExec);
    if (wait <= 0) { this._lastExec = now; this.onExecute?.(); return; }
    if (this._execTimer) return;
    this._execTimer = setTimeout(() => {
      this._execTimer = null;
      this._lastExec = performance.now();
      this.onExecute?.();
    }, wait);
  }

  stop() {
    clearTimeout(this._execTimer);
    this.cm.removeKeyMap(this._refreshKeyMap);
    this.channels.forEach((ch) => ch.marker?.clear());
  }
}