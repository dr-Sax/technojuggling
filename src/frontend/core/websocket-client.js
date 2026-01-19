/**
 * WebSocket client for server communication
 * Backwards compatible with both old and new message formats
 */
import { CONFIG } from '../core/config.js';

export class WebSocketClient {
  constructor(onFrameData, onHandData, onBallData) {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.isReady = false;
    this.pendingRequests = new Map();
    
    this.onFrameData = onFrameData;
    this.onHandData = onHandData;
    this.onBallData = onBallData;
    this.onConnectionChange = null;
    this.onCalibrationRequest = null;
    this.onCalibrationComplete = null;
  }
  
  connect() {
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
          if (this.onCalibrationRequest) {
            this.onCalibrationRequest();
          }
          break;
          
        case 'calibration':
          if (this.onCalibrationComplete) {
            this.onCalibrationComplete();
          }
          this.send({ type: 'start_stream' });
          break;
        
        case 'tracking':
          this.handleTracking(data);
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
      }
      
    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }
  }
  
  handleTracking(data) {
    if (this.onHandData && data.hands) {
      this.onHandData(data.hands);
    }
    
    if (this.onBallData && data.balls) {
      this.onBallData(data.balls);
    }
  }
  
  handleFrame(data) {
    if (this.onFrameData && data.frame) {
      this.onFrameData(data.frame);
    }
    
    // Backwards compatibility: old format includes tracking data
    if (data.hands || data.balls) {
      if (this.onHandData && data.hands) {
        this.onHandData(data.hands);
      }
      
      if (this.onBallData && data.balls) {
        this.onBallData(data.balls);
      }
    }
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    
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
    this.send({
      type: 'calibration_choice',
      use_last: useLast
    });
  }
  
  async requestVideoUrl(youtubeUrl) {
    return new Promise((resolve, reject) => {
      const requestId = Date.now();
      
      this.pendingRequests.set(requestId, { resolve, reject });
      
      this.send({
        type: 'get_video_url',
        url: youtubeUrl,
        requestId
      });
      
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error('Video URL request timeout'));
        }
      }, 30000);
    });
  }
  
  resolveVideoRequest(data) {
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