// ===== TELL-A-VISION HYDRA-STYLE RENDERER =====

// ===== THREE.JS SCENE SETUP =====
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ 
  alpha: true,
  antialias: false,  // Disable antialiasing for better performance
  powerPreference: "high-performance"
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Limit pixel ratio for performance
document.getElementById('webgl-container').appendChild(renderer.domElement);

// CSS3D Scene
const cssScene = new THREE.Scene();
const cssRenderer = new THREE.CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('css3d-container').appendChild(cssRenderer.domElement);

// Camera feed dimensions
const CAMERA_WIDTH = 480;
const CAMERA_HEIGHT = 640;
const PLANE_HEIGHT = 16;
const PLANE_WIDTH = PLANE_HEIGHT * (CAMERA_WIDTH / CAMERA_HEIGHT);

// ===== CAMERA FEED BACKGROUND =====
const img = document.createElement('img');
img.src = 'http://127.0.0.1:5000/video_feed';
const texture = new THREE.Texture(img);
texture.minFilter = THREE.LinearFilter;
texture.magFilter = THREE.LinearFilter;
img.onload = () => texture.needsUpdate = true;

const plane = new THREE.Mesh(
  new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT),
  new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.5 })
);
plane.position.z = 0;
scene.add(plane);

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
  
  if (element.tagName === 'VIDEO') {
    element.volume = params.volume / 100;
    element.playbackRate = params.speed;
  }
  
  element.style.opacity = params.opacity;
  const baseScale = PLANE_HEIGHT / 480;
  const scaleMultiplier = hand.startsWith('ball-') ? 0.5 : 1.0;
  cssObject.scale.set(
    baseScale * params.scale * scaleMultiplier,
    baseScale * params.scale * scaleMultiplier,
    baseScale * params.scale * scaleMultiplier
  );
  
  if (params.clipPath) {
    element.style.clipPath = params.clipPath;
    element.style.webkitClipPath = params.clipPath;
  }
}

// ===== CODE PARSING =====
function getCodeText() {
  return codeEditor.value;
}

// ===== SCENE MANAGEMENT =====
async function executeCode() {
  try {
    state.scenes = [];
    
    const scene = (index, name, config) => {
      state.scenes.push({ index, name, config });
    };
    
    const code = getCodeText();
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const executor = new AsyncFunction('scene', code);
    executor(scene);
    
    state.scenes.sort((a, b) => a.index - b.index);
    
    statusText.textContent = `loaded ${state.scenes.length}`;
    
    if (state.scenes.length > 0) {
      state.currentSceneIndex = 0;
      await loadScene(state.currentSceneIndex);
    }
    
  } catch (error) {
    statusText.textContent = `error`;
    console.error('Execution error:', error);
  }
}

async function loadScene(sceneIndex) {
  const scene = state.scenes[sceneIndex];
  if (!scene) return;
  
  currentSceneLabel.textContent = `${scene.index}`;
  
  initializeSceneParameters(scene);
  
  if (scene.config.hands) {
    if (scene.config.hands.right) {
      await loadHandVideo('right', scene.config.hands.right);
    }
    if (scene.config.hands.left) {
      await loadHandVideo('left', scene.config.hands.left);
    }
  }
  
  if (scene.config.balls) {
    for (const ballId of Object.keys(scene.config.balls)) {
      await loadBallVideo(parseInt(ballId), scene.config.balls[ballId]);
    }
  }
}

async function loadHandVideo(hand, config) {
  const result = await window.electronAPI.getVideoUrl(config.url);
  
  if (!result.success) {
    console.error(`Failed to get video URL for ${hand} hand:`, result.error);
    return;
  }
  
  const videoObj = {
    hand: hand,
    type: 'hand',
    url: result.url,
    youtubeUrl: config.url,
    startTime: config.start || 0,
    endTime: config.end || null,
    title: result.title
  };
  
  state.currentVideoObjects[hand] = videoObj;
  
  const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
  
  if (hand === 'right') {
    displayRightHandVideo(result.url, config.start || 0, config.end || null, zIndex);
    const params = { ...DEFAULTS, ...config };
    applyVideoParameters('right', params);
  } else if (hand === 'left') {
    displayLeftHandVideo(result.url, config.start || 0, config.end || null, zIndex);
    const params = { ...DEFAULTS, ...config };
    applyVideoParameters('left', params);
  }
}

async function loadBallVideo(ballId, config) {
  const result = await window.electronAPI.getVideoUrl(config.url);
  
  if (!result.success) {
    console.error(`Failed to get video URL for ball ${ballId}:`, result.error);
    return;
  }
  
  const videoObj = {
    hand: `ball-${ballId}`,
    type: 'ball',
    ballId: ballId,
    url: result.url,
    youtubeUrl: config.url,
    startTime: config.start || 0,
    endTime: config.end || null,
    title: result.title,
    locked: config.locked !== undefined ? config.locked : false
  };
  
  state.currentVideoObjects[`ball-${ballId}`] = videoObj;
  
  const zIndex = config.zIndex !== undefined ? config.zIndex : 0.1;
  
  displayBallVideo(
    ballId,
    result.url,
    config.start || 0,
    config.end || null,
    config.locked !== undefined ? config.locked : false,
    zIndex
  );
  
  const params = { ...DEFAULTS, ...config, selected: false };
  applyVideoParameters(`ball-${ballId}`, params);
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

// ===== TRACKING SSE CONNECTIONS =====
// Throttle hand tracking updates
let lastHandUpdate = 0;
const handTrackingSource = new EventSource('http://127.0.0.1:5000/hand_tracking');
handTrackingSource.onmessage = (event) => {
  const now = Date.now();
  if (now - lastHandUpdate < 100) return; // Max 10 updates/sec
  lastHandUpdate = now;
  
  const data = JSON.parse(event.data);
  
  if (data.right_hand_detected && data.right_hand_landmarks?.length === 21) {
    updateHandVideo('right', data.right_hand_landmarks);
  }
  
  if (data.left_hand_detected && data.left_hand_landmarks?.length === 21) {
    updateHandVideo('left', data.left_hand_landmarks);
  }
};

// Throttle ball tracking updates
let lastBallUpdate = 0;
const ballTrackingSource = new EventSource('http://127.0.0.1:5000/ball_tracking');
ballTrackingSource.onmessage = (event) => {
  const now = Date.now();
  if (now - lastBallUpdate < 100) return; // Max 10 updates/sec
  lastBallUpdate = now;
  
  const data = JSON.parse(event.data);
  
  if (data.balls && data.balls.length > 0) {
    data.balls.forEach(ball => {
      updateBallVideo(ball.id, ball);
    });
  }
};

// Throttle foot mouse updates heavily
let lastFootUpdate = 0;
const footMouseSource = new EventSource('http://127.0.0.1:5000/bigtrack');
footMouseSource.onmessage = (event) => {
  const now = Date.now();
  if (now - lastFootUpdate < 50) return; // Max 20 updates/sec
  lastFootUpdate = now;
  
  const data = JSON.parse(event.data);
  
  state.footPosition.x = data.x;
  state.footPosition.y = data.y;
  
  if (data.left_click) {
    nextScene();
  }
  
  if (data.right_click) {
    previousScene();
  }
  
  updateFootControl();
};

// ===== UI CONTROLS =====
executeBtn.addEventListener('click', executeCode);
prevSceneBtn.addEventListener('click', previousScene);
nextSceneBtn.addEventListener('click', nextScene);

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  // Ctrl+Enter to execute (even when editing)
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    executeCode();
    return;
  }
  
  // Don't handle other shortcuts when editing
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

// Throttle animation to 30fps instead of 60fps to reduce GPU load
let lastFrameTime = 0;
const targetFrameTime = 1000 / 30; // 30 FPS

// Update texture less frequently
let textureUpdateCounter = 0;

// Pause rendering while typing
let isTyping = false;
let typingTimeout = null;

codeEditor.addEventListener('input', () => {
  isTyping = true;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isTyping = false;
  }, 500); // Resume rendering 500ms after typing stops
});

function animate(currentTime) {
  requestAnimationFrame(animate);
  
  // Skip rendering while typing for better text input responsiveness
  if (isTyping) {
    return;
  }
  
  // Throttle to 30fps
  if (currentTime - lastFrameTime < targetFrameTime) {
    return;
  }
  lastFrameTime = currentTime;
  
  // Update texture every other frame (15fps instead of 30fps)
  textureUpdateCounter++;
  if (textureUpdateCounter % 2 === 0) {
    texture.needsUpdate = true;
  }
  
  renderer.render(scene, camera);
  cssRenderer.render(cssScene, camera);
}
animate(0);

// ===== WINDOW RESIZE =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== INITIALIZATION =====
// Wait for Flask server to be ready before hiding loading screen
let serverReady = false;
let handTrackingReady = false;

// Test server connection
fetch('http://127.0.0.1:5000/video_feed', { method: 'HEAD' })
  .then(() => {
    serverReady = true;
    checkReady();
  })
  .catch(() => {
    console.log('Waiting for Flask server...');
    setTimeout(() => {
      fetch('http://127.0.0.1:5000/video_feed', { method: 'HEAD' })
        .then(() => {
          serverReady = true;
          checkReady();
        });
    }, 2000);
  });

function checkReady() {
  if (serverReady) {
    loadingOverlay.classList.add('hidden');
    executeCode();
  }
}