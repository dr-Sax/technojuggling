/**
 * UI Controller - orchestrates code execution and UI state
 */

import { LiveCodeEditor } from './live-code-editor.js';
import { CodeExecutor } from './code-executor.js';
import { SceneDiffer } from './scene-differ.js';

export class UIController {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.codeEditor = null;
    this.codeExecutor = new CodeExecutor(sceneManager);
    this.sceneDiffer = new SceneDiffer(sceneManager);
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.calibrationComplete = false;
    this.lastExecutedCode = '';
    this.lastScenes = [];
  }
  
  async initialize(initialCode = '') {
    this.codeEditor = new LiveCodeEditor('code-editor', () => {
      this.executeCode();
    });
    
    await this.codeEditor.initialize(initialCode);
    console.log('✓ UI controller initialized');
  }
  
  async executeCode() {
    const newCode = this.codeEditor.getValue();
    const isFirstRun = this.lastExecutedCode === '';
    
    try {
      const newScenes = await this.codeExecutor.execute(newCode, isFirstRun, this.lastScenes);
      
      if (!isFirstRun && newScenes.length > 0) {
        await this.sceneDiffer.applyDifferentialUpdate(newScenes, this.lastScenes);
      }
      
      this.lastScenes = newScenes;
      this.lastExecutedCode = newCode;
      
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