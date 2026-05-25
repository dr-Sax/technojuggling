/**
 * Electron Preload Script
 * Exposes safe APIs to renderer process
 */

const { contextBridge } = require('electron');

// Expose minimal API if needed for future features
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  
  // Can add more APIs here if needed
  // Example: file system access, native dialogs, etc.
});
