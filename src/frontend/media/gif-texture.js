/**
 * GifTexture — decodes an animated GIF into a frame buffer and exposes a
 * THREE.CanvasTexture that advances frame-by-frame.
 *
 * Why this exists: a cross-origin GIF <img> handed straight to WebGL freezes
 * on its first frame — the element animates in the DOM but the GPU only ever
 * samples the initial frame. gifuct-js decodes the GIF binary into frame
 * patches, which we composite onto an offscreen <canvas> (same-origin, always
 * re-samplable) wrapped in a THREE.CanvasTexture.
 *
 * Usage:
 *   const gif = new GifTexture();
 *   await gif.load(url);             // resolves with first frame drawn
 *   material.map = gif.texture;
 *   gif.update(performance.now());   // call once per render frame
 *   gif.dispose();                   // on teardown
 *
 * gifuct-js is imported as an ES module. If the jsDelivr +esm endpoint fails
 * to resolve, swap the import URL for 'https://esm.sh/gifuct-js@2.1.2'.
 */

import { parseGIF, decompressFrames } from 'https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm';

export class GifTexture {
  constructor() {
    this.texture = null;        // THREE.CanvasTexture
    this.canvas = null;         // offscreen compositing canvas
    this.ctx = null;
    this.frames = [];           // decoded frames from gifuct-js
    this.frameImageData = [];   // pre-built ImageData per frame patch
    this.currentFrame = 0;
    this.frameStart = 0;        // performance.now() when current frame began
    this.loaded = false;
    this.width = 0;
    this.height = 0;

    this._prevImageData = null; // snapshot for GIF disposal type 3
    this._patchCanvas = null;   // reused temp canvas for staging frame patches
    this._patchCtx = null;
  }

  /**
   * Fetch and decode a GIF URL. Resolves once the first frame is on the canvas.
   */
  async load(url) {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) {
      throw new Error(`GifTexture: failed to fetch ${url} (${resp.status})`);
    }

    const gif = parseGIF(await resp.arrayBuffer());
    // `true` builds full RGBA patches per frame (handles LZW + palette)
    this.frames = decompressFrames(gif, true);
    if (!this.frames.length) {
      throw new Error(`GifTexture: no frames decoded from ${url}`);
    }

    // Logical screen size — the canvas all frames composite into.
    this.width = gif.lsd.width;
    this.height = gif.lsd.height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');

    // Pre-build ImageData per frame so update() does no decoding work.
    this.frameImageData = this.frames.map((frame) => new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height
    ));

    this.currentFrame = 0;
    this._drawFrame(0);
    this.frameStart = performance.now();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this.loaded = true;
    return this;
  }

  /**
   * Composite frame `i` onto the canvas, honoring the previous frame's
   * disposal method (2 = clear region, 3 = restore snapshot, 0/1 = leave).
   */
  _drawFrame(i) {
    const frame = this.frames[i];
    const prev = i > 0 ? this.frames[i - 1] : null;

    if (prev) {
      if (prev.disposalType === 2) {
        this.ctx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      } else if (prev.disposalType === 3 && this._prevImageData) {
        this.ctx.putImageData(this._prevImageData, 0, 0);
      }
    }

    // Snapshot before drawing, in case this frame is disposal type 3.
    this._prevImageData = frame.disposalType === 3
      ? this.ctx.getImageData(0, 0, this.width, this.height)
      : null;

    // gifuct-js patches are full RGBA for the frame's sub-rect. Stage the
    // patch on a reused temp canvas, then drawImage it into place.
    if (!this._patchCanvas) {
      this._patchCanvas = document.createElement('canvas');
      this._patchCtx = this._patchCanvas.getContext('2d');
    }
    this._patchCanvas.width = frame.dims.width;
    this._patchCanvas.height = frame.dims.height;
    this._patchCtx.putImageData(this.frameImageData[i], 0, 0);
    this.ctx.drawImage(this._patchCanvas, frame.dims.left, frame.dims.top);
  }

  /**
   * Advance the animation by real elapsed time. Call once per render frame
   * with performance.now(). Returns true if the visible frame changed.
   */
  update(now) {
    if (!this.loaded || this.frames.length < 2) return false;

    // gifuct-js normalizes delay to ms. Floor 0-delay frames to 20ms.
    const delay = Math.max(this.frames[this.currentFrame].delay || 0, 20);
    if (now - this.frameStart < delay) return false;

    this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    this._drawFrame(this.currentFrame);
    this.frameStart = now;
    this.texture.needsUpdate = true;
    return true;
  }

  dispose() {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.frames = [];
    this.frameImageData = [];
    this._prevImageData = null;
    this.canvas = null;
    this.ctx = null;
    this._patchCanvas = null;
    this._patchCtx = null;
    this.loaded = false;
  }
}