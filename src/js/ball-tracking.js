/**
 * Ball tracking and video management
 */
import { CONFIG } from './config.js';

export class BallTrackingManager {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.ballVideos = {};
  }
  
  // Update ball video position
  updateBall(ballId, ballData) {
    const ball = this.ballVideos[ballId];
    if (!ball || !ball.cssObject || !ball.element) return;
    
    if (!ball.visible) {
      ball.cssObject.visible = true;
      ball.visible = true;
    }
    
    if (ball.locked) return;
    
    const worldPos = this.sceneManager.mapCameraToWorld(ballData.x, ballData.y);
    ball.lastPosition = { x: worldPos.x, y: worldPos.y };
    ball.cssObject.position.set(worldPos.x, worldPos.y, ball.cssObject.position.z);
  }
  
  // Process ball tracking data
  processBallData(data) {
    if (data.balls && data.balls.length > 0) {
      data.balls.forEach(ball => {
        this.updateBall(ball.id, ball);
      });
    }
  }
  
  // Create video element
  createVideoElement(videoUrl, startTime = 0, endTime = null) {
    const video = document.createElement('video');
    video.className = 'video-element';
    video.src = videoUrl;
    video.controls = false;
    video.autoplay = true;
    video.loop = !endTime;
    video.muted = false;
    video.currentTime = startTime;
    
    if (endTime) {
      video.ontimeupdate = () => {
        if (video.currentTime >= endTime) {
          video.currentTime = startTime;
        }
      };
    }
    
    return video;
  }
  
  // Display ball video
  displayBallVideo(ballId, videoUrl, startTime = 0, endTime = null, locked = false, zIndex = 0.1) {
    const cssScene = this.sceneManager.getCssScene();
    
    // Remove existing ball video if present
    if (this.ballVideos[ballId]) {
      if (this.ballVideos[ballId].cssObject) {
        cssScene.remove(this.ballVideos[ballId].cssObject);
      }
    }
    
    const videoElement = this.createVideoElement(videoUrl, startTime, endTime);
    const cssObject = new THREE.CSS3DObject(videoElement);
    
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    cssObject.scale.set(baseScale * 0.5, baseScale * 0.5, baseScale * 0.5);
    cssObject.position.set(0, 0, zIndex);
    cssObject.visible = false; // Hidden until tracked
    
    cssScene.add(cssObject);
    
    this.ballVideos[ballId] = {
      element: videoElement,
      cssObject: cssObject,
      locked: locked,
      lastPosition: { x: 0, y: 0 },
      visible: false
    };
  }
  
  // Set ball locked state
  setBallLocked(ballId, locked) {
    if (this.ballVideos[ballId]) {
      this.ballVideos[ballId].locked = locked;
    }
  }
  
  // Apply video effects parameters
  applyParameters(ballId, params) {
    const ball = this.ballVideos[ballId];
    if (!ball || !ball.element || !ball.cssObject) return;
    
    const filters = [
      `hue-rotate(${params.hue}deg)`,
      `saturate(${params.saturation}%)`,
      `brightness(${params.brightness}%)`,
      `contrast(${params.contrast}%)`,
      `blur(${params.blur}px)`,
      `grayscale(${params.grayscale}%)`,
      `sepia(${params.sepia}%)`
    ];
    
    ball.element.style.filter = filters.join(' ');
    ball.element.style.opacity = params.opacity;
    ball.element.volume = params.volume / 100;
    ball.element.playbackRate = params.speed;
    
    const baseScale = this.sceneManager.getPlaneHeight() / 480;
    const finalScale = baseScale * 0.5 * params.scale;
    ball.cssObject.scale.set(finalScale, finalScale, finalScale);
    ball.cssObject.position.z = params.zIndex;
  }
  
  // Clear ball video
  clearBall(ballId) {
    const cssScene = this.sceneManager.getCssScene();
    
    if (this.ballVideos[ballId]) {
      if (this.ballVideos[ballId].cssObject) {
        cssScene.remove(this.ballVideos[ballId].cssObject);
      }
      delete this.ballVideos[ballId];
    }
  }
  
  // Clear all ball videos
  clearAll() {
    const cssScene = this.sceneManager.getCssScene();
    
    Object.values(this.ballVideos).forEach(ball => {
      if (ball.cssObject) {
        cssScene.remove(ball.cssObject);
      }
    });
    
    this.ballVideos = {};
  }
}