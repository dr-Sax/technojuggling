/**
 * Ball Tracking Manager - Uses unified MediaObject
 */
import { MediaObject } from '../rendering/media-object.js';
import { BallConnections } from './ball-connections.js';

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.visualFX = visualFX;
    this.ballVideos = {};
    this.ballConnections = new BallConnections(sceneManager, this);
    this.ballData = {};
    this.hideVideosForCircles = false;
  }
  
  updateBall(ballId, ballData) {
    const mediaObj = this.ballVideos[ballId];
    if (!mediaObj) return;
    
    if (!mediaObj.visible && !this.hideVideosForCircles) {
      mediaObj.setVisible(true);
    }
    
    const worldPos = this.sceneManager.mapCameraToWorld(ballData.x, ballData.y);
    mediaObj.setPosition(worldPos.x, worldPos.y);
  }
  
  processBallData(data) {
    if (data.balls && data.balls.length > 0) {
      data.balls.forEach(ball => {
        this.updateBall(ball.id, ball);
        
        const mediaObj = this.ballVideos[ball.id];
        if (mediaObj) {
          const normalizedPos = mediaObj.getPosition();
          if (normalizedPos) {
            const ballKey = `ball_${ball.id}`;
            this.ballData[ballKey] = {
              x: normalizedPos.y,
              y: 1 - normalizedPos.x,
              vx: ball.vx || 0,
              vy: ball.vy || 0
            };
          }
        }
      });
      
      this.ballConnections.updatePositions(this.getAllBallPositions());
    }
  }
  
  getBallData() {
    return { ...this.ballData };
  }
  
  getAllBallPositions() {
    const positions = {};
    
    for (const [ballId, mediaObj] of Object.entries(this.ballVideos)) {
      const pos = mediaObj.getPosition();
      if (pos) {
        positions[ballId] = pos;
      }
    }

    this.ballConnections.updatePositions(positions);
    return positions;
  }
  
  /**
   * Display media on ball (video or image, auto-detected)
   */
  async displayBallMedia(ballId, mediaUrl, config = {}) {
    const {
      startTime = 0,
      endTime = null,
      locked = false,
      zIndex = 0.1,
      scale = 1.0,
      timeOffset = 0
    } = config;
    
    if (this.ballVideos[ballId]) {
      this.ballVideos[ballId].dispose();
    }
    
    const mediaObj = new MediaObject(
      this.sceneManager,
      this.audioProcessor,
      this.visualFX,
      `ball-${ballId}`
    );
    
    await mediaObj.createMedia(mediaUrl, startTime, endTime, zIndex, scale, timeOffset);
    mediaObj.setLocked(locked);
    mediaObj.setVisible(false);
    
    this.ballVideos[ballId] = mediaObj;
    
    if (this.ballConnections) {
      this.ballConnections.forceUpdateCircles();
    }
    
    return mediaObj;
  }
  
  setBallLocked(ballId, locked) {
    const mediaObj = this.ballVideos[ballId];
    if (mediaObj) {
      mediaObj.setLocked(locked);
    }
  }

  setConnectionsEnabled(enabled) {
    this.ballConnections.setEnabled(enabled);
  }

  setConnectionMode(mode) {
    this.ballConnections.setMode(mode);
  }

  setConnectionParameters(params) {
    this.ballConnections.setParameters(params);
  }
  
  applyParameters(ballId, params) {
    const mediaObj = this.ballVideos[ballId];
    if (!mediaObj) return;
    
    const adjustedParams = { ...params };
    if (adjustedParams.scale === undefined) {
      adjustedParams.scale = 3;
    }
    
    mediaObj.applyParameters(adjustedParams, 1.0);
  }
  
  clearBall(ballId) {
    const mediaObj = this.ballVideos[ballId];
    if (mediaObj) {
      mediaObj.dispose();
      delete this.ballVideos[ballId];
    }
  }
  
  clearAll() {
    Object.values(this.ballVideos).forEach(mediaObj => {
      mediaObj.dispose();
    });
    
    this.ballVideos = {};
    this.ballData = {};
  }

  setConnectionRouting(routing, streams) {
    this.ballConnections.setRouting(routing, streams);
  }

  hideBallVideos() {
    this.hideVideosForCircles = true;
    for (const mediaObj of Object.values(this.ballVideos)) {
      if (mediaObj) {
        mediaObj.setVisible(false);
      }
    }
  }

  showBallVideos() {
    this.hideVideosForCircles = false;
    for (const mediaObj of Object.values(this.ballVideos)) {
      if (mediaObj) {
        mediaObj.setVisible(true);
      }
    }
  }
}