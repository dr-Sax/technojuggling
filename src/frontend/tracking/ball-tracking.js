/**
 * Ball Tracking Manager - WebGL video rendering for tracked balls
 */
import { VideoObject } from '../rendering/video-object.js';
import { ImageObject } from '../rendering/image-object.js';
import { ModelBall } from '../rendering/model-ball.js';
import { BallConnections } from './ball-connections.js';

export class BallTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.visualFX = visualFX;
    this.ballVideos = {};
    this.ballConnections = new BallConnections(sceneManager, this);
    this.ballData = {}; // Store latest ball data: {ball_0: {x, y, vx, vy}, ...}
    this.hideVideosForCircles = false; // Flag to keep videos hidden when using filled circles
  }
  
  // Detect media type from URL
  getMediaType(url) {
    const extension = url.split('.').pop().toLowerCase().split('?')[0];
    
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
    const videoExtensions = ['mp4', 'webm', 'ogg', 'mov'];
    const modelExtensions = ['glb', 'gltf'];
    
    if (imageExtensions.includes(extension)) {
      return 'image';
    } else if (videoExtensions.includes(extension)) {
      return 'video';
    } else if (modelExtensions.includes(extension)) {
      return 'model';
    }
    
    // Default to video for unknown types
    console.warn(`Unknown media type for ${url}, defaulting to video`);
    return 'video';
  }
  
  updateBall(ballId, ballData) {
    const videoObj = this.ballVideos[ballId];
    if (!videoObj) {
      return;
    }
    
    if (!videoObj.visible && !this.hideVideosForCircles) {
      videoObj.setVisible(true);
    }
    if (!videoObj.visible && !this.hideVideosForCircles) {
      videoObj.setVisible(true);
    }
    if (!videoObj.visible && !this.hideVideosForCircles) {
      videoObj.setVisible(true);
    }
    
    const worldPos = this.sceneManager.mapCameraToWorld(ballData.x, ballData.y);
    videoObj.setPosition(worldPos.x, worldPos.y);
  }
  
  processBallData(data) {
    if (data.balls && data.balls.length > 0) {
      data.balls.forEach(ball => {
        this.updateBall(ball.id, ball);
        
        // Update ballData for expression evaluation using normalized coordinates
        const videoObj = this.ballVideos[ball.id];
        if (videoObj) {
          const normalizedPos = videoObj.getPosition();
          if (normalizedPos) {
            const ballKey = `ball_${ball.id}`;
            // Swap x and y for expressions so screen movement matches parameter names:
            // - Vertical movement (bottom to top) affects ball_N.y
            // - Horizontal movement (left to right) affects ball_N.x
            this.ballData[ballKey] = {
              x: normalizedPos.y,      // Screen vertical becomes expression x
              y: 1 - normalizedPos.x,  // Invert so bottom = 0, top = 1
              vx: ball.vx || 0,
              vy: ball.vy || 0
            };
          }
        }
      });
      
      this.ballConnections.updatePositions(this.getAllBallPositions());
    }
  }
  
  // Get current ball data for expression evaluation
  getBallData() {
    return { ...this.ballData };
  }
  
  getAllBallPositions() {
    const positions = {};
    
    for (const [ballId, videoObj] of Object.entries(this.ballVideos)) {
      const pos = videoObj.getPosition();
      if (pos) {
        positions[ballId] = pos;
      }
    }

    this.ballConnections.updatePositions(positions);
    return positions;
  }
  
  
  /**
   * Unified method to display any media type on a ball
   * Auto-detects whether it's an image, video, or 3D model and creates appropriate object
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
    
    // Clear any existing media
    if (this.ballVideos[ballId]) {
      this.ballVideos[ballId].dispose();
    }
    
    // Detect media type
    const mediaType = this.getMediaType(mediaUrl);
    const filename = mediaUrl.split('/').pop();
    console.log(`[BallTrack] ball_${ballId}: ${filename} (${mediaType})`);
    
    let mediaObj;
    
    if (mediaType === 'image') {
      // Create image object
      mediaObj = new ImageObject(
        this.sceneManager,
        this.audioProcessor,
        this.visualFX,
        `ball-${ballId}`
      );
      
      // Wait for image to load
      await mediaObj.createImage(mediaUrl, zIndex, scale);
      
    } else if (mediaType === 'model') {
      // Create 3D model object
      mediaObj = new ModelBall(
        this.sceneManager,
        this.audioProcessor,
        this.visualFX,
        `ball-${ballId}`
      );
      
      // Wait for model to load
      await mediaObj.createModel(mediaUrl, zIndex, scale);
      
    } else {
      // Create video object
      mediaObj = new VideoObject(
        this.sceneManager,
        this.audioProcessor,
        this.visualFX,
        `ball-${ballId}`
      );
      
      // Videos don't need await - they're synchronous
      mediaObj.createVideo(mediaUrl, startTime, endTime, zIndex, scale, timeOffset);
    }
    
    mediaObj.setLocked(locked);
    mediaObj.setVisible(false);
    
    this.ballVideos[ballId] = mediaObj;
    
    // Force update circles to pick up new video element
    if (this.ballConnections) {
      this.ballConnections.forceUpdateCircles();
    }
    
    return mediaObj;
  }
  
  displayBallVideo(ballId, videoUrl, startTime = 0, endTime = null, locked = false, zIndex = 0.1, timeOffset = 0) {
    if (this.ballVideos[ballId]) {
      this.ballVideos[ballId].dispose();
    }
    
    const videoObj = new VideoObject(
      this.sceneManager,
      this.audioProcessor,
      this.visualFX,
      `ball-${ballId}`
    );
    
    videoObj.createVideo(videoUrl, startTime, endTime, zIndex, 0.5, timeOffset);
    videoObj.setLocked(locked);
    videoObj.setVisible(false);
    
    this.ballVideos[ballId] = videoObj;
  }
  
  async displayBallImage(ballId, imageUrl, zIndex = 0.1, scale = 3) {
    console.log(`[BallTracking] displayBallImage: ballId=${ballId}, zIndex=${zIndex}, scale=${scale}`);
    
    if (this.ballVideos[ballId]) {
      this.ballVideos[ballId].dispose();
    }
    
    const imageObj = new ImageObject(
      this.sceneManager,
      this.audioProcessor,
      this.visualFX,
      `ball-${ballId}`
    );
    
    // Wait for the image to fully load before continuing
    await imageObj.createImage(imageUrl, zIndex, scale);
    imageObj.setVisible(false);
    
    this.ballVideos[ballId] = imageObj;
    console.log(`[BallTracking] Image object created and ready for ball ${ballId}`);
  }
  
  setBallLocked(ballId, locked) {
    const videoObj = this.ballVideos[ballId];
    if (videoObj) {
      videoObj.setLocked(locked);
    }
  }

  // Enable/disable connections
  setConnectionsEnabled(enabled) {
    this.ballConnections.setEnabled(enabled);
  }

  // Set connection mode ('mesh' or 'sequential')
  setConnectionMode(mode) {
    this.ballConnections.setMode(mode);
  }

  // Set connection visual parameters
  setConnectionParameters(params) {
    this.ballConnections.setParameters(params);
  }
  
  applyParameters(ballId, params) {
    const videoObj = this.ballVideos[ballId];
    if (!videoObj) return;
    
    const adjustedParams = { ...params };
    if (adjustedParams.scale === undefined) {
      adjustedParams.scale = 3;
    }
    
    videoObj.applyParameters(adjustedParams, 1.0);
  }
  
  clearBall(ballId) {
    const videoObj = this.ballVideos[ballId];
    if (videoObj) {
      videoObj.dispose();
      delete this.ballVideos[ballId];
    }
  }
  
  clearAll() {
    Object.values(this.ballVideos).forEach(videoObj => {
      videoObj.dispose();
    });
    
    this.ballVideos = {};
    this.ballData = {};
  }

  // Set routing and streams for clip-to-ball mapping
  setConnectionRouting(routing, streams) {
    this.ballConnections.setRouting(routing, streams);
  }

  // Hide all ball videos (for when using circles mode)
  hideBallVideos() {
    this.hideVideosForCircles = true;
    for (const videoObj of Object.values(this.ballVideos)) {
      if (videoObj) {
        videoObj.setVisible(false);
      }
    }
  }

  // Show all ball videos
  showBallVideos() {
    this.hideVideosForCircles = false;
    for (const videoObj of Object.values(this.ballVideos)) {
      if (videoObj) {
        videoObj.setVisible(true);
      }
    }
  }
}