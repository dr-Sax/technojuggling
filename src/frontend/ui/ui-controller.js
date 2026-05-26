/**
 * UI Controller - orchestrates code execution and UI state.
 *
 * Owns the editor, runs user code, decides whether each execute is a full
 * scene reload or a light param update, and wires the MIDI editor bridge.
 *
 * Structural reload = anything that would require recreating video elements
 * or changing which effects are enabled. Detected by stringifying a
 * stripped-down view of the config that excludes per-ball channel values
 * and inner effect-block values (those go through the light-update path).
 */

import { LiveCodeEditor } from './live-code-editor.js';

export class UIController {
  constructor(sceneManager, websocketClient) {
    this.sceneManager = sceneManager;
    this.wsClient = websocketClient;
    this.codeEditor = null;
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.lastExecutedCode = '';
    this.lastStructuralKey = null;
    this.midiEditorBridge = null;
    this._midiAutoAssigned = false;
  }

  async initialize(initialCode = '') {
    this.codeEditor = new LiveCodeEditor('code-editor', () => this.executeCode());
    this.codeEditor.setValue(initialCode);
    console.log('✓ UI controller initialized');
  }

  setMidiEditorBridge(bridge) {
    this.midiEditorBridge = bridge;
    if (this.lastConfig?.midi) {
      this.midiEditorBridge.updateMapping(this.lastConfig.midi);
    }
  }

  async executeCode() {
    const newCode = this.codeEditor.getValue();
    const isFirstRun = this.lastExecutedCode === '';

    try {
      const config = eval(`(${newCode.trim()})`);
      if (!config.clips && !config.scenes) {
        console.warn('No sequence properties found in config');
        return;
      }

      const structuralKey = this._structuralKey(config);
      if (isFirstRun || structuralKey !== this.lastStructuralKey) {
        await this.sceneManager.loadConfig(config);
      } else {
        await this.sceneManager.updateConfig(config);
      }

      this.lastStructuralKey = structuralKey;
      this.lastExecutedCode = newCode;
      this.lastConfig = config;

      if (this.midiEditorBridge && config.midi) {
        this.midiEditorBridge.updateMapping(config.midi);
      }
      if (this.midiEditorBridge && !this._midiAutoAssigned) {
        this.midiEditorBridge.autoAssignChannels();
        this._midiAutoAssigned = true;
      }
    } catch (error) {
      console.error('Code execution error:', error);
      this.showError(error.message);
    }
  }

  /** Build a stable string that changes only when something structural changes. */
  _structuralKey(config) {
    const clipSig = {};
    for (const [k, c] of Object.entries(config.clips || {})) {
      clipSig[k] = { url: c.url, start: c.start, end: c.end };
    }
    const channelKeys = Object.keys(config.channels || {}).sort();
    const sceneSig = (config.scenes || []).map(scene => {
      const blocks = {};
      for (const [k, v] of Object.entries(scene)) {
        if (k === 'clips') continue;
        blocks[k] = (v && typeof v === 'object') ? !!v.enabled : true;
      }
      return { clips: scene.clips || null, blocks };
    });
    return JSON.stringify({
      clips: clipSig,
      channels: channelKeys,
      scenes: sceneSig,
      showCamera: config.showCamera,
    });
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
    this.hideLoadingScreen();
    this.executeCode();
  }

  onConnectionChange(connected, message) {
    if (!connected && message) {
      this.showError(message);
    }
  }
}