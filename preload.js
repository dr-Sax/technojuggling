/**
 * Electron Preload Script
 * Exposes safe APIs to renderer process
 */

const { contextBridge } = require('electron');

// Note: With WebSocket architecture, we don't need IPC for video URLs anymore
// The renderer communicates directly with Python WebSocket server

// Expose minimal API if needed for future features
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  
  // Can add more APIs here if needed
  // Example: file system access, native dialogs, etc.
});

console.log('✓ Preload script initialized');
console.log('  Mode: WebSocket (direct communication)');