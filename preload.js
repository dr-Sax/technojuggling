const { contextBridge, ipcRenderer } = require('electron');

// Expose Electron API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get video URL from YouTube
  getVideoUrl: (youtubeUrl) => ipcRenderer.invoke('get-video-url', youtubeUrl)
});

console.log('✓ Preload script initialized for unified window');