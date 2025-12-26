/**
 * Tell-A-Vision Client - Main Entry Point
 * Coordinates all modules and initializes the application
 */

import { ThreeSceneManager } from './three-scene.js';
import { WebSocketClient } from './websocket-client.js';
import { HandTrackingManager } from './hand-tracking.js';
import { BallTrackingManager } from './ball-tracking.js';
import { SceneManager } from './scene-manager.js';
import { UIController } from './ui-controller.js';

class TellAVision {
  constructor() {
    this.threeScene = null;
    this.wsClient = null;
    this.handManager = null;
    this.ballManager = null;
    this.sceneManager = null;
    this.uiController = null;
    
    // Loading screen elements
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingStatus = document.getElementById('loadingStatus');
    this.calibrationButtons = document.getElementById('calibrationButtons');
    this.useLastBtn = document.getElementById('useLast');
    this.calibrateNowBtn = document.getElementById('calibrateNow');
  }
  
  async initialize() {
    console.log('Initializing Tell-A-Vision...');
    
    // Setup calibration button handlers
    this.setupCalibrationButtons();
    
    // 1. Initialize Three.js scene
    this.threeScene = new ThreeSceneManager();
    this.threeScene.initialize();
    
    // 2. Initialize tracking managers
    this.handManager = new HandTrackingManager(this.threeScene);
    this.ballManager = new BallTrackingManager(this.threeScene);
    
    // 3. Initialize WebSocket client with callbacks
    this.wsClient = new WebSocketClient(
      (frameData) => this.onFrameData(frameData),
      (handData) => this.onHandData(handData),
      (ballData) => this.onBallData(ballData)
    );
    
    // 4. Initialize scene manager
    this.sceneManager = new SceneManager(
      this.handManager,
      this.ballManager,
      this.wsClient
    );
    
    // 5. Initialize UI controller
    this.uiController = new UIController(this.sceneManager);
    this.uiController.initialize();
    
    // 6. Set up WebSocket callbacks
    this.wsClient.onConnectionChange = (connected, message) => {
      this.onConnectionChange(connected, message);
    };
    
    this.wsClient.onCalibrationRequest = () => {
      this.showCalibrationChoice();
    };
    
    this.wsClient.onCalibrationComplete = () => {
      this.onCalibrationComplete();
    };
    
    // 7. Start Three.js animation loop
    this.threeScene.startAnimation();
    
    // 8. Connect to WebSocket server
    this.wsClient.connect();
    
    console.log('Tell-A-Vision initialized');
  }
  
  setupCalibrationButtons() {
    this.useLastBtn.addEventListener('click', () => {
      this.handleCalibrationChoice(true);
    });
    
    this.calibrateNowBtn.addEventListener('click', () => {
      this.handleCalibrationChoice(false);
    });
  }
  
  showCalibrationChoice() {
    console.log('Showing calibration choice');
    this.loadingStatus.textContent = 'Choose calibration option:';
    this.calibrationButtons.classList.add('show');
  }
  
  handleCalibrationChoice(useLast) {
    console.log(`Calibration choice: ${useLast ? 'Use Last' : 'Calibrate Now'}`);
    
    // Disable buttons
    this.useLastBtn.disabled = true;
    this.calibrateNowBtn.disabled = true;
    
    // Update status
    if (useLast) {
      this.loadingStatus.textContent = 'Loading last settings...';
    } else {
      this.loadingStatus.textContent = 'Starting calibration...\nFollow instructions in calibration window';
    }
    
    // Send choice to server
    this.wsClient.sendCalibrationChoice(useLast);
    
    // Hide buttons
    setTimeout(() => {
      this.calibrationButtons.classList.remove('show');
    }, 500);
  }
  
  onConnectionChange(connected, message) {
    if (connected) {
      this.loadingStatus.textContent = 'Connected to server...';
      this.loadingStatus.classList.remove('error');
      // DON'T pass to UI controller yet - wait for calibration
    } else {
      this.loadingStatus.textContent = message || 'Connection failed';
      this.loadingStatus.classList.add('error');
      this.uiController.onConnectionChange(connected, message);
    }
  }
  
  // NEW: Called when calibration data is received
  onCalibrationComplete() {
    console.log('Calibration complete - hiding loading screen');
    this.loadingStatus.textContent = 'Starting...';
    
    // Hide loading screen and start app
    setTimeout(() => {
      this.uiController.onCalibrationComplete();
    }, 500);
  }
  
  // Callback: Handle frame data from WebSocket
  onFrameData(frameData) {
    this.threeScene.updateCameraFrame(frameData);
  }
  
  // Callback: Handle hand tracking data
  onHandData(handData) {
    this.handManager.processHandData(handData);
  }
  
  // Callback: Handle ball tracking data
  onBallData(ballData) {
    this.ballManager.processBallData(ballData);
  }
}

// Initialize application when page loads
window.addEventListener('load', () => {
  const app = new TellAVision();
  app.initialize();
});