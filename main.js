/**
 * Electron Main Process
 * Launches Python WebSocket server and creates app window
 */

// object destructuring to import only needed modules
const { app, BrowserWindow } = require('electron');
const path = require('path'); // built-in module for handling file paths
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess;
const WEBSOCKET_PORT = 5000;

/**
 * Start Python WebSocket server
 */
function startPythonServer() {

  // Paths to python virtual environment and main.py script
  const venvPython = path.join(__dirname, '.venv', 'Scripts', 'python.exe') 
  const pythonScript = path.join(__dirname, 'src', 'backend', 'main.py'); 

  // Spawn Python process with UNBUFFERED output
  pythonProcess = spawn(venvPython, ['-u', pythonScript, WEBSOCKET_PORT.toString()]);
  pythonProcess.stdout.on('data', (data) => console.log('[Python]', data.toString().trim()));
  pythonProcess.stderr.on('data', (data) => console.error('[Python ERR]', data.toString().trim()));
  pythonProcess.on('close', (code) => console.log('[Python] process exited, code:', code));
}

/**
 * Wait for Python server to be ready
 */
function waitForServer(retries = 20) {
  return new Promise((resolve) => {
    let attempts = 0;
    
    const check = () => {
      attempts++;
      
      // Check if server is responding (simple check)
      const net = require('net');
      const socket = new net.Socket();
      
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        console.log('Python server is ready');
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        if (attempts < retries) {
          console.log(`  Waiting for server... (${attempts}/${retries})`);
          setTimeout(check, 500);
        } else {
          console.warn('Server check timed out, proceeding anyway...');
          resolve(false);
        }
      });
      
      socket.on('error', () => {
        socket.destroy();
        if (attempts < retries) {
          setTimeout(check, 500);
        } else {
          console.warn('Could not connect to server, proceeding anyway...');
          resolve(false);
        }
      });
      
      socket.connect(WEBSOCKET_PORT, '127.0.0.1');
    };
    
    check();
  });
}

/**
 * Create Electron window
 */
function createWindow() {
  console.log('Creating Electron window...');
  
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920,
    fullscreen: false, // Set to true for performance mode
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      webSecurity: false, // Allow loading video URLs from different origins
      backgroundThrottling: false // Keep render loop running at full speed
    },
    backgroundColor: '#000000',
    show: false // Don't show until ready
  });

  // Load HTML from src folder
  const htmlPath = path.join(__dirname, 'src', 'frontend', 'technojuggling.html');
  mainWindow.loadFile(htmlPath);
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  
  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Optional: Open DevTools for debugging
  // mainWindow.webContents.openDevTools();
}

///////////////////////////////////////////////////////////////
// Main App initiatialization and termination

// Forcing GPU acceleration
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('use-angle', 'd3d11on12');    // bypasses buggy D3D11 path
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('force_high_performance_gpu');

// When Electron is ready
app.whenReady().then(async () => {
  startPythonServer(); // Start Python server
  await waitForServer(); // Wait for server to be ready
  createWindow(); // Create window
});

// SHUTDOWNS, AND USER QUITS
// All windows closed
app.on('window-all-closed', () => {
    if (pythonProcess) pythonProcess.kill();
});

// App is actively quitting afteer windows closed
app.on('will-quit', () => {
    if (pythonProcess) pythonProcess.kill();
});

// user presses Ctrl+C in terminal
process.on('SIGINT', () => {
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});

// OS level kill
process.on('SIGTERM', () => {
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});