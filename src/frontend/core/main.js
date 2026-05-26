/**
 * Tell-A-Vision Client - Main Entry Point
 * Coordinates all modules and initializes the application
 */

import { ThreeSceneManager } from './three-scene.js';

import { WebSocketClient } from './websocket-client.js';


import { BallTrackingManager } from '../tracking/ball-tracking.js';
import { SceneManager } from '../scene/scene-manager.js';
import { UIController } from '../ui/ui-controller.js';

// AudioProcessor
import { AudioProcessor } from '../audio/audio-processor.js';

// MIDI
import { MidiState } from '../midi/midi-state.js';
import { MidiController } from '../midi/midi-controller.js';
import { MidiEditorBridge } from '../midi/midi-editor-bridge.js';

class TellAVision {
  constructor() {
    this.threeScene = null;
    this.wsClient = null;
    this.audioProcessor = null;
    this.ballManager = null;
    this.sceneManager = null;
    this.uiController = null;

    // MIDI subsystem
    this.midiState = null;
    this.midiEditorBridge = null;
    this.midiController = null;

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

    // 4. Initialize ball tracking manager
    this.ballManager = new BallTrackingManager(this.threeScene, this.audioProcessor);

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

    // 7. Give scene manager access to audio processor (for video clip audio effects)
    this.sceneManager.setAudioProcessor(this.audioProcessor);

    // 8. Initialize UI controller
    const initialCode = await fetch('./initial-code.txt').then(r => r.text());
    this.uiController = new UIController(this.sceneManager, this.wsClient);
    await this.uiController.initialize(initialCode);

    // 8b. Initialize MIDI subsystem
    //   - MidiState: holds live values, injected into expression scope
    //   - MidiEditorBridge: joystick → cursor nav, knob → rewrite value, pad → execute
    //   - MidiController: Web MIDI API access, parses messages, dispatches to the above
    this.midiState = new MidiState();
    this.sceneManager.setMidiState(this.midiState);

    this.midiEditorBridge = new MidiEditorBridge(
      this.uiController.codeEditor,
      () => this.uiController.executeCode()
    );
    this.uiController.setMidiEditorBridge(this.midiEditorBridge);

    this.midiController = new MidiController(this.midiState, this.midiEditorBridge);
    await this.midiController.initialize();

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