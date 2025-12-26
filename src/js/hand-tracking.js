/**
 * Hand tracking and video management
 */
import { CONFIG } from './config.js';

export class HandTrackingManager {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.rightVideoElement = null;
    this.rightCssObject = null;
    this.leftVideoElement = null;
    this.leftCssObject = null;
  }
  
  // Generate isosceles triangle cursor matching video aspect ratio
  generateHandOutline(landmarks) {
    // Clip-path works in percentage of the VIDEO ELEMENT (0-100%)
    
    // Video aspect ratio (16:9 for landscape videos)
    const aspectRatio = 16 / 9;  // ~1.78
    
    // Triangle dimensions
    // For a proper triangle, base is at 100% (bottom edge)
    // Width is proportional to height based on aspect ratio
    
    // Tip at top center
    const tipX = 50;  // Center horizontally
    const tipY = 5;   // Near top (5% from top edge)
    
    // Base at bottom corners
    const baseY = 100;  // Bottom edge
    
    // Calculate base width to match aspect ratio
    // Triangle height = 95% (from 5% to 100%)
    // Width should be height * aspect ratio
    const triangleHeight = 95;
    const baseWidth = (triangleHeight * aspectRatio) / 100 * 100;  // Convert to percentage of video width
    
    const baseLeftX = 50 - baseWidth / 2;
    const baseRightX = 50 + baseWidth / 2;
    
    return `polygon(${tipX}% ${tipY}%, ${baseLeftX}% ${baseY}%, ${baseRightX}% ${baseY}%)`;
  }
  
  // Get hand center position in world coordinates
  getHandCenter(landmarks) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    landmarks.forEach(lm => {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    });
    
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    return this.sceneManager.mapCameraToWorld(centerX, centerY);
  }
  
  // Calculate hand bounding box dimensions in world space
  getHandDimensions(landmarks) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    landmarks.forEach(lm => {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    });
    
    // Get dimensions in normalized camera space
    const normalizedWidth = maxX - minX;
    const normalizedHeight = maxY - minY;
    
    // Convert to world space dimensions
    const worldWidth = normalizedWidth * CONFIG.PLANE_WIDTH;
    const worldHeight = normalizedHeight * CONFIG.PLANE_HEIGHT;
    
    return { width: worldWidth, height: worldHeight };
  }
  
  // Update hand video position and clip path
  updateHand(hand, landmarks) {
    const element = hand === 'right' ? this.rightVideoElement : this.leftVideoElement;
    const cssObject = hand === 'right' ? this.rightCssObject : this.leftCssObject;
    
    if (!element || !cssObject || !landmarks) return;
    
    const handCenter = this.getHandCenter(landmarks);
    const clipPath = this.generateHandOutline(landmarks);
    
    element.style.clipPath = clipPath;
    element.style.webkitClipPath = clipPath;
    cssObject.position.set(handCenter.x, handCenter.y, cssObject.position.z);
  }
  
  // Process hand tracking data
  processHandData(data) {
    if (data.right_hand_detected && data.right_hand_landmarks?.length === 21) {
      this.updateHand('right', data.right_hand_landmarks);
    }
    
    if (data.left_hand_detected && data.left_hand_landmarks?.length === 21) {
      this.updateHand('left', data.left_hand_landmarks);
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
    
    // Improve rendering quality during scaling
    video.style.imageRendering = 'high-quality';
    video.style.backfaceVisibility = 'hidden';
    video.style.transform = 'translateZ(0)';  // Force GPU acceleration
    video.style.willChange = 'transform';  // Hint browser to optimize
    
    if (endTime) {
      video.ontimeupdate = () => {
        if (video.currentTime >= endTime) {
          video.currentTime = startTime;
        }
      };
    }
    
    return video;
  }
  
  // Display hand video
  displayHandVideo(hand, videoUrl, startTime = 0, endTime = null, zIndex = 0.1) {
    const cssScene = this.sceneManager.getCssScene();
    
    if (hand === 'right') {
      if (this.rightCssObject) {
        cssScene.remove(this.rightCssObject);
      }
      
      this.rightVideoElement = this.createVideoElement(videoUrl, startTime, endTime);
      this.rightCssObject = new THREE.CSS3DObject(this.rightVideoElement);
      
      // Perspective-correct scale based on Z-distance
      // Increased scale multiplier to better cover full hand
      const cameraZ = 12;
      const backgroundZ = 0;
      const objectZ = zIndex;
      const perspectiveScale = (cameraZ - objectZ) / (cameraZ - backgroundZ);
      const baseScale = (this.sceneManager.getPlaneHeight() / 480) * perspectiveScale * 1.8;  // 1.8x multiplier for better coverage
      
      this.rightCssObject.scale.set(baseScale, baseScale, baseScale);
      this.rightCssObject.position.set(0, 0, zIndex);
      this.rightCssObject.visible = true;
      cssScene.add(this.rightCssObject);
      
    } else if (hand === 'left') {
      if (this.leftCssObject) {
        cssScene.remove(this.leftCssObject);
      }
      
      this.leftVideoElement = this.createVideoElement(videoUrl, startTime, endTime);
      this.leftCssObject = new THREE.CSS3DObject(this.leftVideoElement);
      
      // Perspective-correct scale with increased coverage
      const cameraZ = 12;
      const backgroundZ = 0;
      const objectZ = zIndex;
      const perspectiveScale = (cameraZ - objectZ) / (cameraZ - backgroundZ);
      const baseScale = (this.sceneManager.getPlaneHeight() / 480) * perspectiveScale * 1.8;  // 1.8x multiplier
      
      this.leftCssObject.scale.set(baseScale, baseScale, baseScale);
      this.leftCssObject.position.set(0, 0, zIndex);
      this.leftCssObject.visible = true;
      cssScene.add(this.leftCssObject);
    }
  }
  
  // Apply video effects parameters
  applyParameters(hand, params) {
    const element = hand === 'right' ? this.rightVideoElement : this.leftVideoElement;
    const cssObject = hand === 'right' ? this.rightCssObject : this.leftCssObject;
    
    if (!element || !cssObject) return;
    
    const filters = [
      `hue-rotate(${params.hue}deg)`,
      `saturate(${params.saturation}%)`,
      `brightness(${params.brightness}%)`,
      `contrast(${params.contrast}%)`,
      `blur(${params.blur}px)`,
      `grayscale(${params.grayscale}%)`,
      `sepia(${params.sepia}%)`
    ];
    
    element.style.filter = filters.join(' ');
    element.style.opacity = params.opacity;
    element.volume = params.volume / 100;
    element.playbackRate = params.speed;
    
    // Perspective-correct scale with increased coverage
    const cameraZ = 12;
    const backgroundZ = 0;
    const objectZ = params.zIndex;
    const perspectiveScale = (cameraZ - objectZ) / (cameraZ - backgroundZ);
    const baseScale = (this.sceneManager.getPlaneHeight() / 480) * perspectiveScale * 1.8;  // 1.8x multiplier
    const finalScale = baseScale * params.scale;
    
    cssObject.scale.set(finalScale, finalScale, finalScale);
    cssObject.position.z = params.zIndex;
  }
  
  // Clear hand video
  clearHand(hand) {
    const cssScene = this.sceneManager.getCssScene();
    
    if (hand === 'right') {
      if (this.rightCssObject) {
        cssScene.remove(this.rightCssObject);
        this.rightVideoElement = null;
        this.rightCssObject = null;
      }
    } else if (hand === 'left') {
      if (this.leftCssObject) {
        cssScene.remove(this.leftCssObject);
        this.leftVideoElement = null;
        this.leftCssObject = null;
      }
    }
  }
  
  clearAll() {
    this.clearHand('right');
    this.clearHand('left');
  }
}
