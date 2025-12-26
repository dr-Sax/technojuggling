/**
 * WebSocket client for server communication
 */
import { CONFIG } from './config.js';

export class WebSocketClient {
  constructor(onFrameData, onHandData, onBallData) {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.isReady = false;
    this.pendingRequests = new Map();
    
    // Callbacks
    this.onFrameData = onFrameData;
    this.onHandData = onHandData;
    this.onBallData = onBallData;
    this.onConnectionChange = null;
    this.onCalibrationRequest = null;
    this.onCalibrationComplete = null; // NEW: Called when calibration data received
    
    // Performance tracking
    this.frameCount = 0;
    this.lastStatsTime = Date.now();
    this.latencySum = 0;
    this.latencyCount = 0;
  }
  
  connect() {
    console.log('Connecting to WebSocket server...');
    
    this.ws = new WebSocket(CONFIG.WEBSOCKET_URL);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.isReady = true;
      
      if (this.onConnectionChange) {
        this.onConnectionChange(true);
      }
    };
    
    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (this.onConnectionChange) {
        this.onConnectionChange(false, 'Connection error');
      }
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.isReady = false;
      
      if (this.onConnectionChange) {
        this.onConnectionChange(false, 'Disconnected');
      }
      
      this.attemptReconnect();
    };
  }
  
  handleMessage(rawData) {
    try {
      const data = JSON.parse(rawData);
      
      switch(data.type) {
        case 'calibration_request':
          // Server is waiting for calibration choice
          console.log('Server requesting calibration choice');
          if (this.onCalibrationRequest) {
            this.onCalibrationRequest();
          }
          break;
          
        case 'calibration':
          console.log('Received calibration data');
          // Calibration complete - notify app
          if (this.onCalibrationComplete) {
            this.onCalibrationComplete();
          }
          // Also auto-start streaming
          this.send({ type: 'start_stream' });
          break;
          
        case 'frame':
          this.handleFrame(data);
          break;
          
        case 'hand_data':
          if (this.onHandData) {
            this.onHandData(data.data);
          }
          break;
          
        case 'ball_data':
          if (this.onBallData) {
            this.onBallData(data.data);
          }
          break;
          
        case 'video_url':
          this.resolveVideoRequest(data);
          break;
          
        default:
          console.warn('Unknown message type:', data.type);
      }
      
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  }
  
  handleFrame(data) {
    // Update frame
    if (this.onFrameData) {
      this.onFrameData(data.frame);
    }
    
    // Update tracking data
    if (this.onHandData && data.hands) {
      this.onHandData(data.hands);
    }
    
    if (this.onBallData && data.balls) {
      this.onBallData(data.balls);
    }
    
    // Calculate performance
    const latency = Date.now() - (data.timestamp * 1000);
    this.latencySum += latency;
    this.latencyCount++;
    
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastStatsTime > CONFIG.STATS_UPDATE_INTERVAL) {
      const fps = this.frameCount / (CONFIG.STATS_UPDATE_INTERVAL / 1000);
      const avgLatency = this.latencySum / this.latencyCount;
      
      console.log(`Receiving: ${fps.toFixed(1)} FPS | Latency: ${avgLatency.toFixed(1)}ms`);
      
      this.frameCount = 0;
      this.lastStatsTime = now;
      this.latencySum = 0;
      this.latencyCount = 0;
    }
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`Reconnecting... (${this.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
    
    setTimeout(() => {
      this.connect();
    }, CONFIG.RECONNECT_DELAY);
  }
  
  send(data) {
    if (!this.isReady || !this.ws) {
      console.warn('WebSocket not ready');
      return false;
    }
    
    this.ws.send(JSON.stringify(data));
    return true;
  }
  
  // Send calibration choice to server
  sendCalibrationChoice(useLast) {
    console.log(`Sending calibration choice: ${useLast ? 'use last' : 'calibrate now'}`);
    this.send({
      type: 'calibration_choice',
      use_last: useLast
    });
  }
  
  async requestVideoUrl(youtubeUrl) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now();
      
      // Store resolver
      this.pendingRequests.set(requestId, { resolve, reject });
      
      // Send request
      this.send({
        type: 'get_video_url',
        url: youtubeUrl,
        requestId
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Video URL request timeout'));
        }
      }, 30000);
    });
  }
  
  resolveVideoRequest(data) {
    // Find pending request (for now, resolve first one)
    const [requestId, pending] = Array.from(this.pendingRequests.entries())[0] || [];
    
    if (pending) {
      this.pendingRequests.delete(requestId);
      
      if (data.success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(data.error || 'Failed to fetch video URL'));
      }
    }
  }
  
  isConnected() {
    return this.isReady;
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}