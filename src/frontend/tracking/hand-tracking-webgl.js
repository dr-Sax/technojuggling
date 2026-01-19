/**
 * Hand Tracking Manager - WebGL video rendering with predictive smoothing
 */
import { VideoObject } from '../rendering/video-object.js';

export class HandTrackingManager {
  constructor(sceneManager, audioProcessor, visualFX) {
    this.sceneManager = sceneManager;
    this.audioProcessor = audioProcessor;
    this.visualFX = visualFX;
    
    this.rightHand = null;
    this.leftHand = null;
    
    this.rightLandmarks = null;
    this.leftLandmarks = null;
    
    this.rightVelocity = { x: 0, y: 0 };
    this.leftVelocity = { x: 0, y: 0 };
    this.lastUpdateTime = performance.now();
    
    this.predictionMs = 30;
    this.velocitySmoothing = 0.7;
  }
  
  getHandCenter(landmarks) {
    const worldPositions = landmarks.map(lm =>
      this.sceneManager.mapCameraToWorld(lm.x, lm.y)
    );
    
    const avgX = worldPositions.reduce((sum, pos) => sum + pos.x, 0) / worldPositions.length;
    const avgY = worldPositions.reduce((sum, pos) => sum + pos.y, 0) / worldPositions.length;
    
    return { x: avgX, y: avgY };
  }
  
  updateHand(hand, landmarks) {
    const videoObj = hand === 'right' ? this.rightHand : this.leftHand;
    
    if (!videoObj || !videoObj.mesh || !landmarks) return;
    
    const now = performance.now();
    const dt = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;
    
    if (hand === 'right') {
      this.rightLandmarks = landmarks;
    } else {
      this.leftLandmarks = landmarks;
    }
    
    const handCenter = this.getHandCenter(landmarks);
    const velocity = hand === 'right' ? this.rightVelocity : this.leftVelocity;
    const lastPos = videoObj.lastPosition;
    
    const hasValidHistory = (lastPos.x !== 0 || lastPos.y !== 0);
    const hasValidTiming = dt > 0.005 && dt < 0.2;
    
    if (hasValidHistory && hasValidTiming) {
      const currentVelX = (handCenter.x - lastPos.x) / dt;
      const currentVelY = (handCenter.y - lastPos.y) / dt;
      
      const maxVelocity = 1000;
      const clampedVelX = Math.max(-maxVelocity, Math.min(maxVelocity, currentVelX));
      const clampedVelY = Math.max(-maxVelocity, Math.min(maxVelocity, currentVelY));
      
      velocity.x = this.velocitySmoothing * velocity.x + (1 - this.velocitySmoothing) * clampedVelX;
      velocity.y = this.velocitySmoothing * velocity.y + (1 - this.velocitySmoothing) * clampedVelY;
    }
    
    const predictSec = this.predictionMs / 1000;
    let predictedX = handCenter.x + (velocity.x * predictSec);
    let predictedY = handCenter.y + (velocity.y * predictSec);
    
    const maxPredictionOffset = 5;
    if (Math.abs(predictedX - handCenter.x) > maxPredictionOffset ||
        Math.abs(predictedY - handCenter.y) > maxPredictionOffset) {
      predictedX = handCenter.x;
      predictedY = handCenter.y;
      velocity.x = 0;
      velocity.y = 0;
    }
    
    videoObj.setPosition(predictedX, predictedY);
  }
  
  processHandData(data) {
    if (data.right?.detected && data.right?.landmarks?.length === 21) {
      this.updateHand('right', data.right.landmarks);
    }
    
    if (data.left?.detected && data.left?.landmarks?.length === 21) {
      this.updateHand('left', data.left.landmarks);
    }
  }
  
  getHandPosition(hand) {
    const videoObj = hand === 'right' ? this.rightHand : this.leftHand;
    return videoObj ? videoObj.getPosition() : null;
  }
  
  displayHandVideo(hand, videoUrl, startTime = 0, endTime = null, zIndex = 0.1, timeOffset = 0) {
    if (hand === 'right' && this.rightHand) {
      this.rightHand.dispose();
      this.rightHand = null;
    } else if (hand === 'left' && this.leftHand) {
      this.leftHand.dispose();
      this.leftHand = null;
    }
    
    const videoObj = new VideoObject(
      this.sceneManager,
      this.audioProcessor,
      this.visualFX,
      `hand-${hand}`
    );
    
    const cameraZ = 12;
    const backgroundZ = 0;
    const objectZ = zIndex;
    const perspectiveScale = (cameraZ - objectZ) / (cameraZ - backgroundZ);
    const scale = perspectiveScale * 1.8;
    
    videoObj.createVideo(videoUrl, startTime, endTime, zIndex, scale, timeOffset);
    videoObj.setVisible(true);
    
    if (hand === 'right') {
      this.rightHand = videoObj;
      this.rightVelocity = { x: 0, y: 0 };
    } else {
      this.leftHand = videoObj;
      this.leftVelocity = { x: 0, y: 0 };
    }
  }
  
  applyParameters(hand, params) {
    const videoObj = hand === 'right' ? this.rightHand : this.leftHand;
    if (!videoObj) return;
    
    const zIndex = params.zIndex !== undefined ? params.zIndex : 0.1;
    const cameraZ = 12;
    const backgroundZ = 0;
    const perspectiveScale = (cameraZ - zIndex) / (cameraZ - backgroundZ);
    
    videoObj.applyParameters(params, perspectiveScale * 1.8);
  }
  
  setPrediction(ms) {
    this.predictionMs = Math.max(0, Math.min(100, ms));
  }
  
  clearAll() {
    if (this.rightHand) {
      this.rightHand.dispose();
      this.rightHand = null;
    }
    
    if (this.leftHand) {
      this.leftHand.dispose();
      this.leftHand = null;
    }
    
    this.rightLandmarks = null;
    this.leftLandmarks = null;
    this.rightVelocity = { x: 0, y: 0 };
    this.leftVelocity = { x: 0, y: 0 };
  }
}