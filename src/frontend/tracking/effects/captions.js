/**
 * Captions - Text labels that follow each ball.
 *
 * Each ball gets one plane mesh textured with a 2D-canvas rendering of a
 * string. The plane is positioned at (worldPos.x + offsetX, worldPos.y +
 * offsetY, zIndex), so the label tracks the ball with a configurable offset
 * in world units. When the ball carries video media, this serves as a caption.
 *
 * Live-code config example:
 *
 *   ballCaptions: {
 *     enabled: true,
 *     text:        "hello",            // global text (used for every ball)
 *     // OR per-ball, by ball index:
 *     texts:       { 0: "alice", 1: "bob", 2: "carol" },
 *     fontStyle:   "bold italic",      // any CSS font-style/weight tokens
 *     fontFamily:  "Arial",            // any CSS family
 *     fontSize:    48,                 // px in the canvas; world size scales with it
 *     color:       0xffffff,
 *     bgColor:     null,               // 0xRRGGBB or null for transparent
 *     opacity:     1.0,
 *     offsetX:     0,                  // world units, relative to ball center
 *     offsetY:     2.0,                // world units (positive = up)
 *     zIndex:      0.1,                // draw depth (above ball media at 0)
 *     padding:     8,                  // px padding inside the canvas
 *     scale:       0.05,               // world units per canvas pixel
 *   }
 *
 * Expression strings are supported on numeric params (offsetX, offsetY,
 * fontSize, opacity, scale) via the scene's ExpressionEvaluator — the same
 * way ballSpacetime/activeGroup work. They're evaluated on every frame in
 * animateForBall(), so e.g. offsetY: "sin(t)*2" sways the label.
 */

import {
  PerBallEffect,
} from './_shared.js';

import { effectRegistry } from '../effect-registry.js';


export class Captions extends PerBallEffect {
  static defaults = {
    text: '',
    texts: {},                  // { ballIndex: "string" } — overrides `text` per ball
    fontStyle: 'normal',        // "normal" | "italic" | "bold" | "bold italic" | etc.
    fontFamily: 'Arial',
    fontSize: 48,               // px in the source canvas
    color: 0xffffff,
    bgColor: null,              // 0xRRGGBB or null
    opacity: 1.0,
    offsetX: 0,                 // world units
    offsetY: 2.0,                // world units (positive = up in world space)
    zIndex: 0.1,                // above ball media (which sits at ~0)
    padding: 8,                 // px inside the canvas around the text
    scale: 0.05,                // world units per source canvas pixel
  };

  // A change to any of these requires a fresh canvas/texture (the text or its
  // rasterization changed). Color/opacity/offsets are handled live without
  // rebuilding the texture.
  static recreateKeys = ['fontStyle', 'fontFamily', 'fontSize', 'padding', 'bgColor'];

  static idPrefix = 'caption';

  // ─── Override points ─────────────────────────────────────────────────────

  getObjectCount() { return 1; }

  // createForBall 
  createForBall(ballId, worldPos) {
    const text = this._textFor(ballId);
    const { canvas, width, height } = this._renderTextToCanvas(text);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: this.config.color,
      transparent: true,
      opacity: this.config.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const scale = this._evalNum('scale', this.config.scale);
    const worldW = width  * scale;
    const worldH = height * scale;

    const geometry = new THREE.PlaneGeometry(worldW, worldH);
    const mesh = new THREE.Mesh(geometry, material);

    const ox = this._evalNum('offsetX', this.config.offsetX);
    const oy = this._evalNum('offsetY', this.config.offsetY);
    mesh.position.set(worldPos.x + ox, worldPos.y + oy, this.config.zIndex);

    // Remember source canvas dims and the text we baked, so we can detect
    // text changes per-frame without redoing the texture for every ball.
    return {
      mesh, geometry, material, texture, canvas,
      ballId,
      _text: text,
      _canvasW: width,
      _canvasH: height,
      _colorT: 0,
    };
  }

  animateForBall(obj, ballId, worldPos, dt) {
    // 1) Re-rasterize if the text for this ball changed (e.g. config.texts updated).
    const text = this._textFor(ballId);
    if (text !== obj._text) {
      const { canvas, width, height } = this._renderTextToCanvas(text);
      obj._text = text;
      obj.canvas = canvas;
      obj._canvasW = width;
      obj._canvasH = height;

      obj.texture.dispose();
      obj.texture = new THREE.CanvasTexture(canvas);
      obj.texture.minFilter = THREE.LinearFilter;
      obj.texture.magFilter = THREE.LinearFilter;
      obj.material.map = obj.texture;
      obj.material.needsUpdate = true;

      // Plane geometry needs to match new canvas dimensions.
      const scale = this._evalNum('scale', this.config.scale);
      obj.geometry.dispose();
      obj.geometry = new THREE.PlaneGeometry(width * scale, height * scale);
      obj.mesh.geometry = obj.geometry;
    } else {
      // 2) Re-evaluate scale every frame — expressions may move it.
      const scale = this._evalNum('scale', this.config.scale);
      const wantW = obj._canvasW * scale;
      const wantH = obj._canvasH * scale;
      // Only rebuild geometry when scale visibly changes (avoids per-frame churn).
      if (Math.abs(obj.geometry.parameters.width  - wantW) > 1e-4 ||
          Math.abs(obj.geometry.parameters.height - wantH) > 1e-4) {
        obj.geometry.dispose();
        obj.geometry = new THREE.PlaneGeometry(wantW, wantH);
        obj.mesh.geometry = obj.geometry;
      }
    }

    // 3) Position with live-evaluated offsets.
    const ox = this._evalNum('offsetX', this.config.offsetX);
    const oy = this._evalNum('offsetY', this.config.offsetY);
    obj.mesh.position.set(worldPos.x + ox, worldPos.y + oy, this.config.zIndex);

    // 4) Live opacity (color is handled by EffectBase._updateMaterials on setConfig).
    const op = this._evalNum('opacity', this.config.opacity);
    if (obj.material.opacity !== op) obj.material.opacity = op;
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.texture?.dispose();
    this.objects.delete(id);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Pick the text string for a given ball id. texts[id] wins, else global text. */
  _textFor(ballId) {
    const texts = this.config.texts;
    if (texts && typeof texts === 'object') {
      // Accept both numeric ('0') and string ('ball_0') keys.
      const idx = String(ballId).replace(/^ball_/, '');
      if (texts[idx] !== undefined) return String(texts[idx]);
      if (texts[ballId] !== undefined) return String(texts[ballId]);
    }
    return String(this.config.text ?? '');
  }

  /** Evaluate a numeric param that may be an expression string. */
  _evalNum(key, fallback) {
    const v = this.config[key];
    if (typeof v === 'number') return v;
    const sm = this.sceneManager;
    if (typeof v === 'string' && sm?.evaluator?.isExpression?.(v)) {
      try {
        const t = sm.getTime ? sm.getTime() : (performance.now() / 1000);
        const r = sm.evaluator.evaluate(v, { time: t, t });
        return Number.isFinite(r) ? r : fallback;
      } catch (e) {
        return fallback;
      }
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * Render `text` to an offscreen 2D canvas sized to fit, with current font /
   * padding / bgColor settings. Returns the canvas plus its pixel dims.
   *
   * The shader/material color tints WHITE pixels in the canvas, so we draw
   * the text in white here and let the material's `color` do the work. This
   * keeps live color changes free (no re-rasterization).
   */
  _renderTextToCanvas(text) {
    const cfg = this.config;
    const fontSize = Math.max(1, this._evalNum('fontSize', cfg.fontSize));
    const padding  = Math.max(0, cfg.padding | 0);
    const fontSpec = `${cfg.fontStyle} ${fontSize}px ${cfg.fontFamily}`;

    // Measure first with a throwaway context.
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = fontSpec;
    const lines = String(text === '' ? ' ' : text).split('\n');
    let maxW = 0;
    for (const line of lines) {
      const m = probe.measureText(line);
      if (m.width > maxW) maxW = m.width;
    }
    const lineH = fontSize * 1.2;
    const width  = Math.max(1, Math.ceil(maxW + padding * 2));
    const height = Math.max(1, Math.ceil(lineH * lines.length + padding * 2));

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (cfg.bgColor != null) {
      ctx.fillStyle = '#' + (cfg.bgColor & 0xffffff).toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // Always white — color is tinted by the material.
    ctx.fillStyle = '#ffffff';
    ctx.font = fontSpec;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], padding, padding + i * lineH);
    }

    return { canvas, width, height };
  }
}


// Registration. Keyed as 'captions' → config key 'ballCaptions'
// (applyAllEffects derives the key by capitalizing the first letter).
effectRegistry.register('captions', Captions, {
  updateMethod: 'updateBall',
  requiresWorldPos: true,
  hasEnabled: true,
  hasConfig: true,
  clearMethod: 'clear',
  removeBallMethod: 'removeBall',
});