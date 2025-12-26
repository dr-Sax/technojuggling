/**
 * Configuration constants for Tell-A-Vision client
 */

export const CONFIG = {
  // WebSocket connection
  WEBSOCKET_URL: 'ws://127.0.0.1:5000',
  MAX_RECONNECT_ATTEMPTS: 10,
  RECONNECT_DELAY: 2000,
  
  // Camera feed dimensions (must match Python camera config)
  CAMERA_WIDTH: 640,
  CAMERA_HEIGHT: 480,
  
  // 3D scene dimensions
  PLANE_HEIGHT: 16,
  get PLANE_WIDTH() {
    return this.PLANE_HEIGHT * (this.CAMERA_WIDTH / this.CAMERA_HEIGHT);
  },
  
  // Performance
  TARGET_FPS: 60,
  STATS_UPDATE_INTERVAL: 2000, // ms
  
  // Video defaults
  DEFAULTS: {
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
  }
};