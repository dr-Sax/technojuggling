/**
 * UI Controller - orchestrates code execution and UI state
 *
 * MIDI integration: setMidiEditorBridge(bridge) attaches a bridge that
 * receives the latest config.midi mapping on every successful execute.
 * The bridge is also what pads call when they want to trigger Ctrl-Enter.
 */

import { LiveCodeEditor } from './live-code-editor.js';
import { CodeExecutor } from './code-executor.js';

export class UIController {
  constructor(sceneManager, websocketClient) {
    this.sceneManager = sceneManager;
    this.wsClient = websocketClient;
    this.codeEditor = null;
    this.codeExecutor = new CodeExecutor(sceneManager);
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.calibrationComplete = false;
    this.lastExecutedCode = '';
    this.lastConfig = null;
    this.midiEditorBridge = null;
  }

  async initialize(initialCode = '') {
    this.codeEditor = new LiveCodeEditor('code-editor', () => {
      this.executeCode();
    });

    await this.codeEditor.initialize(initialCode);

    console.log('✓ UI controller initialized');
  }

  /**
   * Attach the MIDI editor bridge. After this, every successful execute
   * pushes the config's `midi` block to the bridge so it knows which CCs
   * are the joystick, which note is the execute pad, etc.
   */
  setMidiEditorBridge(bridge) {
    this.midiEditorBridge = bridge;
    // If we already have a config loaded, push the mapping immediately.
    if (this.lastConfig && this.lastConfig.midi) {
      this.midiEditorBridge.updateMapping(this.lastConfig.midi);
    }
  }

  async executeCode() {
    const newCode = this.codeEditor.getValue();
    const isFirstRun = this.lastExecutedCode === '';

    try {
      this.lastConfig = await this.codeExecutor.execute(newCode, isFirstRun, this.lastConfig);
      this.lastExecutedCode = newCode;

      // Push fresh MIDI mapping to the bridge (no-op if no bridge or no midi block)
      if (this.midiEditorBridge && this.lastConfig && this.lastConfig.midi) {
        this.midiEditorBridge.updateMapping(this.lastConfig.midi);
      }
    } catch (error) {
      console.error('Code execution error:', error);
      this.showError(error.message);
    }
  }

  hideLoadingScreen() {
    this.loadingOverlay.classList.add('hidden');
  }

  showError(message) {
    const loadingText = this.loadingOverlay.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = message;
      loadingText.style.color = '#ff4444';
    }
  }

  onCalibrationComplete() {
    this.calibrationComplete = true;
    this.hideLoadingScreen();
    this.executeCode();
  }

  onConnectionChange(connected, message) {
    if (!connected && message) {
      this.showError(message);
    }
  }
}