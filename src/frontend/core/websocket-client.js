/**
 * WebSocket client for server communication
 * Updated to remove hand tracking
 */
import { CONFIG } from './config.js';

export class WebSocketClient {
  constructor(onFrameData, onBallData) {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.isReady = false;
    this.pendingRequests = new Map();
    
    // Callbacks
    this.onFrameData = onFrameData;
    this.onBallData = onBallData;
    this.onConnectionChange = null;
    this.onCalibrationRequest = null;
    this.onCalibrationComplete = null;
    
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
          console.log('Server requesting calibration choice');
          if (this.onCalibrationRequest) {
            this.onCalibrationRequest();
          }
          break;
          
        case 'calibration':
          console.log('Received calibration data');
          if (this.onCalibrationComplete) {
            this.onCalibrationComplete();
          }
          this.send({ type: 'start_stream' });
          break;
          
        case 'frame':
          this.handleFrame(data);
          break;
          
        case 'ball_data':
          if (this.onBallData) {
            this.onBallData(data.data);
          }
          break;
          
        case 'cursor_navigate':
          if (this.onCursorNavigate) {
            this.onCursorNavigate(data);
          }
          break;
          
        case 'cursor_click':
          if (this.onCursorClick) {
            this.onCursorClick(data);
          }
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
    
    // Update ball tracking data
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
  
  sendCalibrationChoice(useLast) {
    console.log(`Sending calibration choice: ${useLast ? 'use last' : 'calibrate now'}`);
    this.send({
      type: 'calibration_choice',
      use_last: useLast
    });
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