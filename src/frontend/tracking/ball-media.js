/**
 * BallMedia - Manages media (video/image) display on tracked balls.
 * Accepts pre-loaded elements from MediaPool via attachFromPool().
 */
import { MediaObject } from '../media/media-object.js';

export class BallMedia {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.visualFX = visualFX;
    this.media = {}; // ballId -> MediaObject
  }
  
  /**
   * Attach a pre-loaded media element from MediaPool to a ball.
   * @param {string} ballId 
   * @param {object} poolMedia - {element, type, src} from MediaPool
   * @param {object} config - {startTime, endTime, zIndex, scale, timeOffset, locked}
   */
  async attachFromPool(ballId, poolMedia, config = {}) {
    if (this.media[ballId]) this.media[ballId].dispose();
    
    const mediaObj = new MediaObject(this.sceneManager, this.audioProcessor, this.visualFX, `ball-${ballId}`);
    await mediaObj.attachElement(poolMedia.element, poolMedia.type, config);
    mediaObj.setLocked(config.locked || false);
    mediaObj.setVisible(false);
    
    this.media[ballId] = mediaObj;
    return mediaObj;
  }
  
  updatePosition(ballId, x, y) {
    const m = this.media[ballId];
    if (m) {
      const world = this.sceneManager.mapCameraToWorld(x, y);
      m.setPosition(world.x, world.y);
      if (!m.visible) m.setVisible(true);
    }
  }
  
  applyParams(ballId, params) {
    if (this.media[ballId]) this.media[ballId].applyParameters({ scale: 3, ...params }, 1.0);
  }
  
  setVisible(ballId, visible) {
    if (this.media[ballId]) this.media[ballId].setVisible(visible);
  }
  
  setAllVisible(visible) {
    for (const m of Object.values(this.media)) m.setVisible(visible);
  }
  
  getPosition(ballId) {
    return this.media[ballId]?.getPosition() || null;
  }
  
  getElement(ballId) {
    return this.media[ballId]?.element || null;
  }
  
  remove(ballId) {
    if (this.media[ballId]) {
      this.media[ballId].dispose();
      delete this.media[ballId];
    }
  }
  
  clear() {
    for (const m of Object.values(this.media)) m.dispose();
    this.media = {};
  }
}