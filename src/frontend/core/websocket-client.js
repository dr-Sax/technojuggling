/**
 * WebSocket client for server communication.
 *
 * Protocol:
 * - Binary messages = JPEG frame data (displayed directly via blob URL)
 * - JSON messages = ball data, calibration, cursor events, param scrub, etc.
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
    this.onBallData  = onBallData;
    this.onConnectionChange  = null;
    this.onCalibrationRequest = null;
    this.onCalibrationComplete = null;

    // Foot mouse callbacks (set by CursorNavigationHandler)
    this.onCursorNavigate  = null;
    this.onCursorClick     = null;
    this.onParamScrub      = null;   // NEW: { type, direction }
    this.onScrubModeToggle = null;   // NEW: { type, active }

    // Performance tracking
    this.frameCount   = 0;
    this.lastStatsTime = Date.now();
    this.latencySum   = 0;
    this.latencyCount = 0;

    this._lastBlobUrl = null;
  }

  connect() {
    console.log('Connecting to WebSocket server...');

    this.ws = new WebSocket(CONFIG.WEBSOCKET_URL);
    this.ws.binaryType = 'blob';

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.isReady = true;
      if (this.onConnectionChange) this.onConnectionChange(true);
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof Blob) {
        this._handleBinaryFrame(event.data);
      } else {
        this._handleJsonMessage(event.data);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (this.onConnectionChange) this.onConnectionChange(false, 'Connection error');
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.isReady = false;
      if (this.onConnectionChange) this.onConnectionChange(false, 'Disconnected');
      this.attemptReconnect();
    };
  }

  _handleBinaryFrame(blob) {
    if (this.onFrameData) this.onFrameData(blob);
    this.frameCount++;
  }

  _handleJsonMessage(rawData) {
    try {
      const data = JSON.parse(rawData);

      switch (data.type) {
        case 'calibration_request':
          if (this.onCalibrationRequest) this.onCalibrationRequest();
          break;

        case 'calibration':
          if (this.onCalibrationComplete) this.onCalibrationComplete();
          this.send({ type: 'start_stream' });
          break;

        case 'balls':
          if (this.onBallData && data.balls) this.onBallData(data.balls);
          if (data.timestamp) {
            this.latencySum += Date.now() - data.timestamp * 1000;
            this.latencyCount++;
          }
          break;

        // Legacy combined frame+balls
        case 'frame':
          this.handleLegacyFrame(data);
          break;

        // ── Foot mouse navigation ──────────────────────────────────────────
        case 'cursor_navigate':
          if (this.onCursorNavigate) this.onCursorNavigate(data);
          break;

        case 'cursor_click':
          if (this.onCursorClick) this.onCursorClick(data);
          break;

        // ── Param scrub (NEW) ──────────────────────────────────────────────
        case 'param_scrub':
          if (this.onParamScrub) this.onParamScrub(data);
          break;

        case 'scrub_mode_toggle':
          if (this.onScrubModeToggle) this.onScrubModeToggle(data);
          break;
      }

    } catch (e) {
      console.error('Error parsing WebSocket message:', e);
    }

    // Periodic stats log
    const now = Date.now();
    if (now - this.lastStatsTime > CONFIG.STATS_UPDATE_INTERVAL) {
      const elapsed    = (now - this.lastStatsTime) / 1000;
      const fps        = this.frameCount / elapsed;
      const avgLatency = this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0;
      console.log(`Receiving: ${fps.toFixed(1)} FPS | Latency: ${avgLatency.toFixed(1)}ms`);
      this.frameCount   = 0;
      this.lastStatsTime = now;
      this.latencySum   = 0;
      this.latencyCount = 0;
    }
  }

  handleLegacyFrame(data) {
    if (this.onFrameData) this.onFrameData('data:image/jpeg;base64,' + data.frame);
    if (this.onBallData && data.balls) this.onBallData(data.balls);
    this.frameCount++;
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return;
    }
    this.reconnectAttempts++;
    console.log(`Reconnecting... (${this.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(() => this.connect(), CONFIG.RECONNECT_DELAY);
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
    this.send({ type: 'calibration_choice', use_last: useLast });
  }

  isConnected() { return this.isReady; }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}