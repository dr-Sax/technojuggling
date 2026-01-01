/**
 * Electron Main Process
 * Launches Python WebSocket server and creates app window
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess;
const WEBSOCKET_PORT = 5000;

/**
 * Start Python WebSocket server
 */
function startPythonServer() {
  console.log('ðŸ Starting Python WebSocket server...');
  
  const isWindows = process.platform === 'win32';
  
  // Path to virtual environment Python
  const venvPython = isWindows
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(__dirname, '.venv', 'bin', 'python');
  
  // Path to Python main.py in src/python folder
  const pythonScript = path.join(__dirname, 'src', 'python', 'main.py');
  
  // Spawn Python process with UNBUFFERED output
  pythonProcess = spawn(venvPython, ['-u', pythonScript, WEBSOCKET_PORT.toString()]);
  
  // IMPORTANT: Set encoding to handle output properly
  pythonProcess.stdout.setEncoding('utf8');
  pythonProcess.stderr.setEncoding('utf8');
  
  // Log Python output (stdout)
  pythonProcess.stdout.on('data', (data) => {
    // Split by lines and log each line
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.log(`Python: ${line}`);
      }
    });
  });
  
  // Log Python errors (stderr)
  pythonProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        console.error(`Python Error: ${line}`);
      }
    });
  });
  
  // Handle Python process exit
  pythonProcess.on('close', (code) => {
    console.log(`Python process exited with code ${code}`);
  });
  
  pythonProcess.on('error', (error) => {
    console.error(`Failed to start Python server: ${error.message}`);
  });
  
  console.log('âœ“ Python server starting...');
  console.log(`  Script: ${pythonScript}`);
  console.log(`  Python: ${venvPython}`);
  console.log(`  Port: ${WEBSOCKET_PORT}`);
}

/**
 * Create Electron window
 */
function createWindow() {
  console.log('ðŸ–¼ï¸  Creating Electron window...');
  
  mainWindow = new BrowserWindow({
    width: 960,
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

  // Load HTML from src folder
  const htmlPath = path.join(__dirname, 'src', 'technojuggling.html');
  mainWindow.loadFile(htmlPath);
  
  console.log(`  Loading: ${htmlPath}`);
  
  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('âœ“ Window ready');
  });
  
  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Optional: Open DevTools for debugging
  // mainWindow.webContents.openDevTools();
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
        console.log('âœ“ Python server is ready');
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        if (attempts < retries) {
          console.log(`  Waiting for server... (${attempts}/${retries})`);
          setTimeout(check, 500);
        } else {
          console.warn('âš ï¸  Server check timed out, proceeding anyway...');
          resolve(false);
        }
      });
      
      socket.on('error', () => {
        socket.destroy();
        if (attempts < retries) {
          setTimeout(check, 500);
        } else {
          console.warn('âš ï¸  Could not connect to server, proceeding anyway...');
          resolve(false);
        }
      });
      
      socket.connect(WEBSOCKET_PORT, '127.0.0.1');
    };
    
    check();
  });
}

// ===== APP LIFECYCLE =====

// Disable hardware acceleration to prevent GPU crashes
app.disableHardwareAcceleration();

// When Electron is ready
app.whenReady().then(async () => {
  console.log('ðŸš€ Tell-A-Vision starting...');
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Working directory: ${__dirname}`);
  
  // Start Python server
  startPythonServer();
  
  // Wait for server to be ready
  await waitForServer();
  
  // Create window
  createWindow();
  
  // macOS: Re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  
  console.log('âœ“ Tell-A-Vision ready');
});

// All windows closed
app.on('window-all-closed', () => {
  console.log('ðŸ‘‹ Shutting down...');
  
  // Kill Python process
  if (pythonProcess) {
    console.log('  Stopping Python server...');
    pythonProcess.kill();
  }
  
  // Quit app (except on macOS)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// App will quit
app.on('will-quit', () => {
  console.log('  Cleaning up...');
  
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

// ===== GRACEFUL SHUTDOWN =====

process.on('SIGINT', () => {
  console.log('\nðŸ‘‹ SIGINT received, shutting down...');
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});

process.on('SIGTERM', () => {
  console.log('\nðŸ‘‹ SIGTERM received, shutting down...');
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('âŒ Uncaught exception:', error);
  if (pythonProcess) pythonProcess.kill();
  app.quit();
});