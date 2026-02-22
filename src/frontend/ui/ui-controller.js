/**
 * UI Controller - orchestrates code execution and UI state
 */

import { LiveCodeEditor } from './live-code-editor.js';
import { CodeExecutor } from './code-executor.js';
import { CursorNavigationHandler } from './cursor-navigation.js';

// Properties that require a full loadConfig() when changed via scrub.
// Everything else goes through the faster updateConfig() path.
const STRUCTURAL_PARAMS = new Set([
  'showCamera',
]);

export class UIController {
  constructor(sceneManager, websocketClient) {
    this.sceneManager = sceneManager;
    this.wsClient = websocketClient;
    this.codeEditor = null;
    this.codeExecutor = new CodeExecutor(sceneManager);
    this.cursorNav = null;
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.calibrationComplete = false;
    this.lastExecutedCode = '';
    this.lastConfig = null;
  }

  async initialize(initialCode = '') {
    this.codeEditor = new LiveCodeEditor('code-editor', () => {
      this.executeCode();
    });

    await this.codeEditor.initialize(initialCode);

    this.cursorNav = new CursorNavigationHandler(this.codeEditor, this.wsClient);

    // Wire scrub callback — passes the changed param name so we can decide
    // whether a lightweight updateConfig or a full loadConfig is needed.
    this.cursorNav.paramScrub.onAfterScrub = (paramName) =>
      this.updateConfigFromEditor(paramName);

    console.log('✓ UI controller initialized with cursor navigation');
  }

  async executeCode() {
    const newCode = this.codeEditor.getValue();
    const isFirstRun = this.lastExecutedCode === '';

    try {
      this.lastConfig = await this.codeExecutor.execute(newCode, isFirstRun, this.lastConfig);
      this.lastExecutedCode = newCode;
    } catch (error) {
      console.error('Code execution error:', error);
      this.showError(error.message);
    }
  }

  /**
   * Called after every param scrub.
   * Uses loadConfig() for params in STRUCTURAL_PARAMS (e.g. showCamera),
   * updateConfig() for everything else (no clip/stream reload).
   */
  async updateConfigFromEditor(paramName) {
    try {
      const code = this.codeEditor.getValue().trim();
      const config = eval(`(${code})`);

      if (!config || (!config.clips && !config.streams && !config.routing)) return;

      if (paramName && STRUCTURAL_PARAMS.has(paramName)) {
        await this.sceneManager.loadConfig(config);
      } else {
        this.sceneManager.updateConfig(config);
      }

      this.lastConfig = config;
    } catch (e) {
      // Silently ignore parse errors during scrubbing (mid-edit transient state)
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