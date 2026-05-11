/**
 * Tell-A-Vision Client - Main Entry Point
 * Coordinates all modules and initializes the application
 */

import { ThreeSceneManager } from './three-scene.js';
import { WebSocketClient } from './websocket-client.js';
import { BallTrackingManager } from '../tracking/ball-tracking.js';
import { SceneManager } from '../scene/scene-manager.js';
import { UIController } from '../ui/ui-controller.js';
import { AudioProcessor } from '../audio/audio-processor.js';
import { VisualEffectsProcessor } from '../media/visual-effects-processor.js';

class TellAVision {
  constructor() {
    this.threeScene = null;
    this.wsClient = null;
    this.audioProcessor = null;
    this.visualFX = null;
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
    
    // 2. Initialize audio processor
    this.audioProcessor = new AudioProcessor();
    this.audioProcessor.initialize();
    
    // 3. Initialize visual effects processor
    this.visualFX = new VisualEffectsProcessor();
    this.visualFX.initialize();
    
    // 4. Initialize ball tracking manager
    this.ballManager = new BallTrackingManager(this.threeScene, this.audioProcessor, this.visualFX);
    
    // 5. Initialize WebSocket client with callbacks
    this.wsClient = new WebSocketClient(
      (frameData) => this.onFrameData(frameData),
      (ballData) => this.onBallData(ballData)
    );
    
    // 6. Initialize scene manager
    this.sceneManager = new SceneManager(
      this.ballManager,
      this.wsClient
    );

    this.threeScene.setSceneManager(this.sceneManager);
    this.threeScene.setVisualFX(this.visualFX);
    
    // 7. Give scene manager access to audio processor (for video clip audio effects)
    this.sceneManager.setAudioProcessor(this.audioProcessor);
    
    // 8. Initialize UI controller
    const codeEditorDiv = document.getElementById('code-editor');
    const initialCode = codeEditorDiv.dataset.initialCode || '';
    
    this.uiController = new UIController(this.sceneManager, this.wsClient);
    await this.uiController.initialize(initialCode);
    
    // 9. Set up WebSocket callbacks
    this.wsClient.onConnectionChange = (connected, message) => {
      this.onConnectionChange(connected, message);
    };
    
    this.wsClient.onCalibrationRequest = () => {
      this.showCalibrationChoice();
    };
    
    this.wsClient.onCalibrationComplete = () => {
      this.onCalibrationComplete();
    };
    
    // 10. Start Three.js animation loop
    this.threeScene.startAnimation();
    
    // 11. Connect to WebSocket server
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
    } else {
      this.loadingStatus.textContent = message || 'Connection failed';
      this.loadingStatus.classList.add('error');
      this.uiController.onConnectionChange(connected, message);
    }
  }
  
  // Called when calibration data is received
  onCalibrationComplete() {
    console.log('Calibration complete - hiding loading screen');
    this.loadingStatus.textContent = 'Starting...';
    
    // Resume audio context (required after user interaction)
    this.audioProcessor.resume();
    
    // Hide loading screen and start app
    setTimeout(() => {
      this.uiController.onCalibrationComplete();
    }, 500);
  }
  
  // Callback: Handle frame data from WebSocket
  onFrameData(frameData) {
    this.threeScene.updateCameraFrame(frameData);
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