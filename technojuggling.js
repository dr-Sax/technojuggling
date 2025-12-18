// ===== TELL-A-VISION WEBSOCKET CLIENT =====

// ===== THREE.JS SCENE SETUP =====
const threeScene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ 
  alpha: true,
  antialias: false,
  powerPreference: "high-performance"
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
document.getElementById('webgl-container').appendChild(renderer.domElement);

// CSS3D Scene
const cssScene = new THREE.Scene();
const cssRenderer = new THREE.CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('css3d-container').appendChild(cssRenderer.domElement);

// Camera feed dimensions
const CAMERA_WIDTH = 320;
const CAMERA_HEIGHT = 240;
const PLANE_HEIGHT = 16;
const PLANE_WIDTH = PLANE_HEIGHT * (CAMERA_WIDTH / CAMERA_HEIGHT);

// ===== CAMERA FEED BACKGROUND (Now uses WebSocket frames) =====
const img = document.createElement('img');
const texture = new THREE.Texture(img);
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;

const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.5 })
);
plane.position.z = 0;
threeScene.add(plane);

// ===== STATE MANAGEMENT =====
const state = {
  scenes: [],
  currentSceneIndex: 0,
  footPosition: { x: 0, y: 0 },
  parameterValues: {},
  currentVideoObjects: {}
};

// Video elements
let rightVideoElement = null;
let rightCssObject = null;
let leftVideoElement = null;
let leftCssObject = null;
let ballVideos = {};

// ===== DEFAULT PARAMETERS =====
const DEFAULTS = {
  volume: 100,
  speed: 1.0,
  hue: 0,
  saturation: 100,
  brightness: 100,
  contrast: 100,
  blur: 0,
  scale: 1.0,
  opacity: 1.0,
  grayscale: 0,
  sepia: 0,
  clipPath: '',
  locked: false,
  zIndex: 0.1
};

// ===== DOM ELEMENTS =====
const codeEditor = document.getElementById('code-editor');
const statusText = document.getElementById('statusText');
const currentSceneLabel = document.getElementById('currentScene');
const executeBtn = document.getElementById('executeBtn');
const prevSceneBtn = document.getElementById('prevSceneBtn');
const nextSceneBtn = document.getElementById('nextSceneBtn');
const loadingOverlay = document.getElementById('loadingOverlay');

// ===== WEBSOCKET CONNECTION =====
let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY = 2000;
let isWebSocketReady = false;

// Performance stats
let frameCount = 0;
let lastStatsTime = Date.now();
let latencySum = 0;
let latencyCount = 0;

function connectWebSocket() {
  console.log('🔌 Connecting to WebSocket server...');
  statusText.textContent = 'connecting...';
  
  ws = new WebSocket('ws://127.0.0.1:5000');
  
  ws.onopen = () => {
    console.log('✓ WebSocket connected');
    reconnectAttempts = 0;
    isWebSocketReady = true;
    statusText.textContent = 'connected';
    
    // Hide loading screen and execute code
    loadingOverlay.classList.add('hidden');
    executeCode();
    
    // Start streaming
    ws.send(JSON.stringify({ type: 'start_stream' }));
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      switch(data.type) {
        case 'calibration':
          console.log('✓ Received calibration data');
          break;
          
        case 'frame':
          handleFrameData(data);
          break;
          
        case 'hand_data':
          handleHandData(data.data);
          break;
          
        case 'ball_data':
          handleBallData(data.data);
          break;
      }
      
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  };
  
  ws.onerror = (error) => {
    console.error('❌ WebSocket error:', error);
    statusText.textContent = 'connection error';
    
    // Show error message on loading screen
    const loadingText = loadingOverlay.querySelector('.loading-text');
    if (loadingText) {
      loadingText.textContent = 'CONNECTION ERROR - Check if server is running';
      loadingText.style.color = '#ff4444';
    }
  };
  
  ws.onclose = () => {
    console.log('❌ WebSocket closed');
    statusText.textContent = 'disconnected';
    isWebSocketReady = false;
    
    // Show error on loading screen if not already hidden
    if (!loadingOverlay.classList.contains('hidden')) {
      const loadingText = loadingOverlay.querySelector('.loading-text');
      if (loadingText) {
        loadingText.textContent = 'SERVER NOT FOUND - Start websocket_server.py';
        loadingText.style.color = '#ff4444';
      }
    }
    
    // Attempt reconnection
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.log(`Reconnecting... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
      statusText.textContent = `reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`;
      setTimeout(connectWebSocket, RECONNECT_DELAY);
    } else {
      console.error('Max reconnection attempts reached');
      statusText.textContent = 'connection failed';
      const loadingText = loadingOverlay.querySelector('.loading-text');
      if (loadingText) {
        loadingText.textContent = 'CONNECTION FAILED - Restart app and server';
        loadingText.style.color = '#ff0000';
      }
    }
  };
}

// ===== FRAME HANDLING =====
function handleFrameData(data) {
  // Update camera frame
  img.src = 'data:image/jpeg;base64,' + data.frame;
  texture.needsUpdate = true;
  
  // Update tracking data
  handleHandData(data.hands);
  handleBallData(data.balls);
  
  // Calculate latency
  const latency = Date.now() - (data.timestamp * 1000);
  latencySum += latency;
  latencyCount++;
  
  // Update stats
  frameCount++;
  const now = Date.now();
  if (now - lastStatsTime > 2000) {
    const fps = frameCount / 2;
    const avgLatency = latencySum / latencyCount;
    console.log(`📊 Receiving: ${fps.toFixed(1)} FPS | Latency: ${avgLatency.toFixed(1)}ms`);
    
    frameCount = 0;
    lastStatsTime = now;
    latencySum = 0;
    latencyCount = 0;
  }
}

function handleHandData(data) {
  if (data.right_hand_detected && data.right_hand_landmarks?.length === 21) {
    updateHandVideo('right', data.right_hand_landmarks);
  }
  
  if (data.left_hand_detected && data.left_hand_landmarks?.length === 21) {
    updateHandVideo('left', data.left_hand_landmarks);
  }
}

function handleBallData(data) {
  if (data.balls && data.balls.length > 0) {
    data.balls.forEach(ball => {
      updateBallVideo(ball.id, ball);
    });
  }
}

// ===== UTILITY FUNCTIONS =====
function mapCameraToWorld(normalizedX, normalizedY) {
  const worldX = (normalizedX - 0.5) * PLANE_WIDTH;
  const worldY = -(normalizedY - 0.5) * PLANE_HEIGHT;
  return { x: worldX, y: worldY };
}

function generateHandOutline(landmarks, handCenter) {
  const outlineIndices = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 19, 18, 17, 0
  ];
  
  let sumX = 0, sumY = 0;
  landmarks.forEach(lm => {
    sumX += lm.x;
    sumY += lm.y;
  });
  const centerX = sumX / landmarks.length;
  const centerY = sumY / landmarks.length;
  
  const points = outlineIndices.map(idx => {
    const landmark = landmarks[idx];
    const relativeX = landmark.x - centerX + 0.5;
    const relativeY = landmark.y - centerY + 0.5;
    const x = (relativeX * 100).toFixed(2);
    const y = (relativeY * 100).toFixed(2);
    return `${x}% ${y}%`;
  });
  
  return `polygon(${points.join(', ')})`;
}

function getHandCenter(landmarks) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  landmarks.forEach(lm => {
    minX = Math.min(minX, lm.x);
    maxX = Math.max(maxX, lm.x);
    minY = Math.min(minY, lm.y);
    maxY = Math.max(maxY, lm.y);
  });
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const worldCenter = mapCameraToWorld(centerX, centerY);
  
  return { x: worldCenter.x, y: worldCenter.y };
}

function updateHandVideo(hand, landmarks) {
  const element = hand === 'right' ? rightVideoElement : leftVideoElement;
  const cssObject = hand === 'right' ? rightCssObject : leftCssObject;
  
  // Silently skip if this hand's video isn't loaded in current scene
  if (!element || !cssObject || !landmarks) return;
  
  const handCenter = getHandCenter(landmarks);
  const clipPath = generateHandOutline(landmarks, handCenter);
  
  element.style.clipPath = clipPath;
  element.style.webkitClipPath = clipPath;
  cssObject.position.set(handCenter.x, handCenter.y, cssObject.position.z);
}

function updateBallVideo(ballId, ballData) {
  const ballVideo = ballVideos[ballId];
  if (!ballVideo || !ballVideo.cssObject || !ballVideo.element) return;
  
  if (!ballVideo.visible) {
    ballVideo.cssObject.visible = true;
    ballVideo.visible = true;
  }
  
  if (ballVideo.locked) return;
  
  const worldPos = mapCameraToWorld(ballData.x, ballData.y);
  ballVideo.lastPosition = { x: worldPos.x, y: worldPos.y };
  ballVideo.cssObject.position.set(worldPos.x, worldPos.y, ballVideo.cssObject.position.z);
}

function createVideoElement(videoUrl, startTime = 0, endTime = null) {
  const video = document.createElement('video');
  video.className = 'video-element';
  video.src = videoUrl;
  video.controls = false;
  video.autoplay = true;
  video.loop = !endTime;
  video.muted = false;
  video.currentTime = startTime;
  
  if (endTime) {
    video.ontimeupdate = () => {
      if (video.currentTime >= endTime) {
        video.currentTime = startTime;
      }
    };
  }
  
  return video;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ===== HAND VIDEO MANAGEMENT =====
function displayRightHandVideo(videoUrl, startTime = 0, endTime = null, zIndex = 0.1) {
  if (rightCssObject) cssScene.remove(rightCssObject);
  
  rightVideoElement = createVideoElement(videoUrl, startTime, endTime);
  rightCssObject = new THREE.CSS3DObject(rightVideoElement);
  
  const baseScale = PLANE_HEIGHT / 480;
  rightCssObject.scale.set(baseScale, baseScale, baseScale);
  rightCssObject.position.set(0, 0, zIndex);
  rightCssObject.visible = true;
  cssScene.add(rightCssObject);
}

function displayLeftHandVideo(videoUrl, startTime = 0, endTime = null, zIndex = 0.1) {
  if (leftCssObject) cssScene.remove(leftCssObject);
  
  leftVideoElement = createVideoElement(videoUrl, startTime, endTime);
  leftCssObject = new THREE.CSS3DObject(leftVideoElement);
  
  const baseScale = PLANE_HEIGHT / 480;
  leftCssObject.scale.set(baseScale, baseScale, baseScale);
  leftCssObject.position.set(0, 0, zIndex);
  leftCssObject.visible = true;
  cssScene.add(leftCssObject);
}

// ===== BALL VIDEO MANAGEMENT =====
function displayBallVideo(ballId, videoUrl, startTime = 0, endTime = null, locked = false, zIndex = 0.1) {
  if (ballVideos[ballId]) {
    if (ballVideos[ballId].cssObject) {
      cssScene.remove(ballVideos[ballId].cssObject);
    }
  }
  
  const videoElement = createVideoElement(videoUrl, startTime, endTime);
  const cssObject = new THREE.CSS3DObject(videoElement);
  
  const baseScale = PLANE_HEIGHT / 480;
  cssObject.scale.set(baseScale * 0.5, baseScale * 0.5, baseScale * 0.5);
  cssObject.position.set(0, 0, zIndex);
  cssObject.visible = false;
  
  cssScene.add(cssObject);
  
  ballVideos[ballId] = {
    element: videoElement,
    cssObject: cssObject,
    locked: locked,
    lastPosition: { x: 0, y: 0 },
    visible: false
  };
}

function setBallLocked(ballId, locked) {
  if (ballVideos[ballId]) {
    ballVideos[ballId].locked = locked;
  }
}

function applyVideoParameters(hand, params) {
  let element, cssObject;
  
  if (hand === 'right') {
    element = rightVideoElement;
    cssObject = rightCssObject;
  } else if (hand === 'left') {
    element = leftVideoElement;
    cssObject = leftCssObject;
  } else if (hand && hand.startsWith('ball-')) {
    const bId = parseInt(hand.replace('ball-', ''));
    if (ballVideos[bId]) {
      element = ballVideos[bId].element;
      cssObject = ballVideos[bId].cssObject;
    }
  }
  
  if (!element || !cssObject) return;
  
  const filters = [
    `hue-rotate(${params.hue}deg)`,
    `saturate(${params.saturation}%)`,
    `brightness(${params.brightness}%)`,
    `contrast(${params.contrast}%)`,
    `blur(${params.blur}px)`,
    `grayscale(${params.grayscale}%)`,
    `sepia(${params.sepia}%)`
  ];
  
  element.style.filter = filters.join(' ');
  element.style.opacity = params.opacity;
  element.volume = params.volume / 100;
  element.playbackRate = params.speed;
  
  const baseScale = PLANE_HEIGHT / 480;
  const scaleFactor = hand.startsWith('ball-') ? 0.5 : 1.0;
  const finalScale = baseScale * scaleFactor * params.scale;
  cssObject.scale.set(finalScale, finalScale, finalScale);
  cssObject.position.z = params.zIndex;
}

// ===== SCENE MANAGEMENT =====
function scene(id, name, config) {
  state.scenes.push({ id, name, config });
}

async function executeCode() {
  statusText.textContent = 'executing...';
  
  state.scenes = [];
  
  try {
    eval(codeEditor.value);
    
    if (state.scenes.length === 0) {
      statusText.textContent = 'no scenes';
      return;
    }
    
    statusText.textContent = `loaded ${state.scenes.length} scenes`;
    state.currentSceneIndex = 0;
    await loadScene(0);
    
  } catch (error) {
    console.error('Code execution error:', error);
    statusText.textContent = 'error';
    alert(`Error: ${error.message}`);
  }
}

async function loadScene(index) {
  if (index < 0 || index >= state.scenes.length) return;
  
  const sceneData = state.scenes[index];
  state.currentSceneIndex = index;
  currentSceneLabel.textContent = sceneData.name;
  statusText.textContent = 'loading scene...';
  
  // Clear existing videos
  if (rightCssObject) {
    cssScene.remove(rightCssObject);
    rightVideoElement = null;
    rightCssObject = null;
  }
  if (leftCssObject) {
    cssScene.remove(leftCssObject);
    leftVideoElement = null;
    leftCssObject = null;
  }
  
  Object.values(ballVideos).forEach(ball => {
    if (ball.cssObject) cssScene.remove(ball.cssObject);
  });
  ballVideos = {};
  
  // Load hands
  if (sceneData.config.hands) {
    if (sceneData.config.hands.right) {
      await loadHandVideo('right', sceneData.config.hands.right);
    }
    if (sceneData.config.hands.left) {
      await loadHandVideo('left', sceneData.config.hands.left);
    }
  }
  
  // Load balls
  if (sceneData.config.balls) {
    for (const [ballId, ballConfig] of Object.entries(sceneData.config.balls)) {
      await loadBallVideo(ballId, ballConfig);
    }
  }
  
  initializeSceneParameters(sceneData);
  statusText.textContent = 'ready';
}

async function loadHandVideo(hand, config) {
  statusText.textContent = `loading ${hand} video...`;
  
  try {
    // Send request via WebSocket
    ws.send(JSON.stringify({
      type: 'get_video_url',
      url: config.url
    }));
    
    // Wait for response
    const data = await new Promise((resolve) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'video_url') {
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      ws.addEventListener('message', handler);
    });
    
    if (!data.success) {
      console.error(`Failed to get video URL for ${hand} hand:`, data.error);
      return;
    }
    
    const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
    
    if (hand === 'right') {
      displayRightHandVideo(data.url, config.start || 0, config.end || null, zIndex);
    } else {
      displayLeftHandVideo(data.url, config.start || 0, config.end || null, zIndex);
    }
    
    const params = { ...DEFAULTS, ...config, selected: false };
    applyVideoParameters(hand, params);
    
  } catch (error) {
    console.error(`Error loading ${hand} hand video:`, error);
  }
}

async function loadBallVideo(ballId, config) {
  statusText.textContent = `loading ball ${ballId} video...`;
  
  try {
    // Send request via WebSocket
    ws.send(JSON.stringify({
      type: 'get_video_url',
      url: config.url
    }));
    
    // Wait for response
    const data = await new Promise((resolve) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'video_url') {
          ws.removeEventListener('message', handler);
          resolve(msg);
        }
      };
      ws.addEventListener('message', handler);
    });
    
    if (!data.success) {
      console.error(`Failed to get video URL for ball ${ballId}:`, data.error);
      return;
    }
    
    const locked = config.locked || false;
    const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
    
    displayBallVideo(
      ballId,
      data.url,
      config.start || 0,
      config.end || null,
      locked,
      zIndex
    );
    
    const params = { ...DEFAULTS, ...config, selected: false };
    applyVideoParameters(`ball-${ballId}`, params);
    
  } catch (error) {
    console.error(`Error loading ball ${ballId} video:`, error);
  }
}

function initializeSceneParameters(scene) {
  state.parameterValues = {};
  
  if (scene.config.balls) {
    Object.keys(scene.config.balls).forEach(ballId => {
      const ball = scene.config.balls[ballId];
      const key = `ball-${ballId}`;
      state.parameterValues[key] = { ...DEFAULTS, ...ball };
    });
  }
  
  if (scene.config.hands) {
    ['right', 'left'].forEach(hand => {
      if (scene.config.hands[hand]) {
        const key = `hand-${hand}`;
        state.parameterValues[key] = { ...DEFAULTS, ...scene.config.hands[hand] };
      }
    });
  }
}

async function nextScene() {
  if (state.scenes.length === 0) return;
  
  state.currentSceneIndex = (state.currentSceneIndex + 1) % state.scenes.length;
  await loadScene(state.currentSceneIndex);
}

async function previousScene() {
  if (state.scenes.length === 0) return;
  
  state.currentSceneIndex = (state.currentSceneIndex - 1 + state.scenes.length) % state.scenes.length;
  await loadScene(state.currentSceneIndex);
}

// ===== FOOT CONTROL =====
function updateFootControl() {
  const scene = state.scenes[state.currentSceneIndex];
  if (!scene) return;
  
  const footX = state.footPosition.x;
  const footY = state.footPosition.y;
  
  if (scene.config.global_foot) {
    Object.keys(scene.config.balls || {}).forEach(ballId => {
      const key = `ball-${ballId}`;
      applyFootMapping(key, scene.config.global_foot.x, scene.config.global_foot.y, footX, footY);
    });
  }
  
  if (scene.config.balls) {
    Object.keys(scene.config.balls).forEach(ballId => {
      const ball = scene.config.balls[ballId];
      if (ball.foot) {
        const key = `ball-${ballId}`;
        applyFootMapping(key, ball.foot.x, ball.foot.y, footX, footY);
      }
    });
  }
}

function applyFootMapping(key, xMapping, yMapping, footX, footY) {
  if (!state.parameterValues[key]) return;
  
  if (xMapping) {
    const normalized = (footX + 1) / 2;
    const range = xMapping.range[1] - xMapping.range[0];
    const sensitivity = xMapping.sensitivity || 1.0;
    const value = xMapping.range[0] + (normalized * range * sensitivity);
    
    state.parameterValues[key][xMapping.param] = clamp(value, xMapping.range[0], xMapping.range[1]);
    sendParameterUpdate(key);
  }
  
  if (yMapping) {
    const normalized = (footY + 1) / 2;
    const range = yMapping.range[1] - yMapping.range[0];
    const sensitivity = yMapping.sensitivity || 1.0;
    const value = yMapping.range[0] + (normalized * range * sensitivity);
    
    state.parameterValues[key][yMapping.param] = clamp(value, yMapping.range[0], yMapping.range[1]);
    sendParameterUpdate(key);
  }
}

function sendParameterUpdate(key) {
  const params = state.parameterValues[key];
  applyVideoParameters(key, params);
}

// ===== UI CONTROLS =====
executeBtn.addEventListener('click', executeCode);
prevSceneBtn.addEventListener('click', previousScene);
nextSceneBtn.addEventListener('click', nextScene);

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    executeCode();
    return;
  }
  
  if (document.activeElement === codeEditor) return;
  
  if (e.key === ' ') {
    e.preventDefault();
    nextScene();
  } else if (e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    previousScene();
  }
});

// ===== ANIMATION LOOP =====
camera.position.z = 12;

// Run at 60fps
function animate() {
  requestAnimationFrame(animate);
  
  renderer.render(threeScene, camera);
  cssRenderer.render(cssScene, camera);
}
animate();

// ===== WINDOW RESIZE =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== INITIALIZATION =====
connectWebSocket();

// Note: Loading screen is hidden and executeCode() is called 
// when WebSocket connection opens (see ws.onopen above)