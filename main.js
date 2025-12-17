const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let flaskProcess;
const FLASK_PORT = 5000;

function startFlaskServer() {
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');
  
  flaskProcess = spawn(venvPython, [path.join(__dirname, 'server.py'), FLASK_PORT.toString()]);
  
  flaskProcess.stdout.on('data', (data) => {
    console.log(`Flask: ${data}`);
  });
  
  flaskProcess.stderr.on('data', (data) => {
    console.error(`Flask Error: ${data}`);
  });
  
  // Wait for server to start
  setTimeout(() => {}, 2000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    fullscreen: false, // Set to true for performance mode
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      webSecurity: false // Allow loading video URLs from different origins
    },
    backgroundColor: '#000000',
    show: false // Don't show until ready
  });

  mainWindow.loadFile('technojuggling.html');
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Optional: Open DevTools for debugging
  // mainWindow.webContents.openDevTools();
}

// Disable hardware acceleration to prevent GPU crashes
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  startFlaskServer();
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (flaskProcess) flaskProcess.kill();
  app.quit();
});

// ===== IPC HANDLERS =====
ipcMain.handle('get-video-url', async (event, youtubeUrl) => {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ url: youtubeUrl });
    
    const req = http.request({
      hostname: '127.0.0.1',
      port: FLASK_PORT,
      path: '/get-video-url',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
    
    req.write(postData);
    req.end();
  });
});

// Log app readiness
app.on('ready', () => {
  console.log('✓ Electron app ready');
  console.log('✓ Single-window unified interface');
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  if (flaskProcess) flaskProcess.kill();
  app.quit();
});

process.on('SIGTERM', () => {
  if (flaskProcess) flaskProcess.kill();
  app.quit();
});