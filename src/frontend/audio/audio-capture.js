/**
 * Audio Capture - Captures audio from a hardware capture card (e.g., Guermok HDMI)
 * and routes it through the existing AudioProcessor effects chain.
 *
 * Usage:
 *   import { AudioCapture } from './audio-capture.js';
 *
 *   const capture = new AudioCapture(audioProcessor);
 *   await capture.initialize();       // lists devices, auto-detects capture card
 *   await capture.start();            // begins streaming audio through effects
 *   capture.stop();                   // stops capture
 *
 * The captured audio is registered with AudioProcessor under the stream ID
 * 'capture-card' so you can apply effects via:
 *   audioProcessor.applyParameters('capture-card', { pitch: 3, reverb: 40, ... });
 */

export class AudioCapture {
  constructor(audioProcessor) {
    this.audioProcessor = audioProcessor;
    this.stream = null;
    this.deviceId = null;
    this.deviceLabel = null;
    this.availableDevices = [];
    this.streamId = 'capture-card';
    this.initialized = false;
  }

  /**
   * Enumerate audio input devices and auto-detect the capture card.
   * Call this once — requires user gesture on some browsers.
   */
  async initialize() {
    if (this.initialized) return;

    // Ensure AudioProcessor is ready (needs user gesture)
    if (!this.audioProcessor.initialized) {
      await this.audioProcessor.initialize();
    }

    // Request microphone permission so device labels are exposed
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach(t => t.stop());
    } catch (err) {
      console.error('Microphone permission denied — cannot enumerate devices:', err);
      return;
    }

    await this.refreshDevices();
    this.initialized = true;
    console.log('✓ AudioCapture initialized');
  }

  /**
   * Re-scan available audio input devices.
   * Automatically selects the first device whose label suggests a capture card.
   */
  async refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.availableDevices = devices.filter(d => d.kind === 'audioinput');

    console.log('Audio input devices:');
    this.availableDevices.forEach((d, i) => {
      console.log(`  [${i}] ${d.label || 'Unknown'} (${d.deviceId.slice(0, 8)}...)`);
    });

    // Auto-detect capture card by common keywords
    const captureKeywords = [
      'guermok', 'capture', 'hdmi', 'cam link', 'camlink',
      'elgato', 'avermedia', 'mirabox', 'usb video', 'video grabber', 'usb3 digital audio', 'digital audio interface'
    ];

    const match = this.availableDevices.find(d =>
      captureKeywords.some(kw => d.label.toLowerCase().includes(kw))
    );

    if (match) {
      this.deviceId = match.deviceId;
      this.deviceLabel = match.label;
      console.log(`✓ Auto-detected capture card: "${match.label}"`);
    } else if (this.availableDevices.length > 0) {
      console.warn(
        'Could not auto-detect capture card. Use selectDevice(index) to pick one manually.\n' +
        'Available devices listed above.'
      );
    } else {
      console.error('No audio input devices found.');
    }
  }

  /**
   * Manually select a device by index (from the logged device list)
   * or by partial label match.
   * @param {number|string} indexOrLabel - Device index or partial label string
   */
  selectDevice(indexOrLabel) {
    let device;
    if (typeof indexOrLabel === 'number') {
      device = this.availableDevices[indexOrLabel];
    } else {
      const search = indexOrLabel.toLowerCase();
      device = this.availableDevices.find(d =>
        d.label.toLowerCase().includes(search)
      );
    }

    if (device) {
      this.deviceId = device.deviceId;
      this.deviceLabel = device.label;
      console.log(`Selected device: "${device.label}"`);
    } else {
      console.error('Device not found. Run refreshDevices() and check the list.');
    }
  }

  /**
   * List available audio input devices.
   * @returns {Array<{index: number, label: string, deviceId: string}>}
   */
  listDevices() {
    return this.availableDevices.map((d, i) => ({
      index: i,
      label: d.label || `Unknown Device ${i}`,
      deviceId: d.deviceId,
      selected: d.deviceId === this.deviceId
    }));
  }

  /**
   * Start capturing audio from the selected device and route through AudioProcessor.
   */
  async start() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.deviceId) {
      console.error('No capture device selected. Call selectDevice() first.');
      return false;
    }

    // Stop any existing capture
    this.stop();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: this.deviceId },
          // Disable processing to keep the signal clean
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Request high quality
          sampleRate: 48000,
          channelCount: 2
        }
      });

      // Route through AudioProcessor using the addStream method
      this.audioProcessor.addStream(this.stream, this.streamId);

      console.log(`✓ Capturing audio from "${this.deviceLabel}" → effects chain → speakers`);
      return true;

    } catch (error) {
      console.error('Failed to start audio capture:', error);
      if (error.name === 'NotFoundError') {
        console.error('Device not found — it may have been disconnected. Try refreshDevices().');
      } else if (error.name === 'NotAllowedError') {
        console.error('Permission denied — user must allow microphone access.');
      }
      return false;
    }
  }

  /**
   * Stop capturing and remove from AudioProcessor.
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    this.audioProcessor.removeVideo(this.streamId);
    console.log('Audio capture stopped');
  }

  /**
   * Check if currently capturing.
   * @returns {boolean}
   */
  get isCapturing() {
    return this.stream !== null && this.stream.active;
  }

  /**
   * Apply effects to the captured audio (convenience wrapper).
   * @param {Object} params - { volume, pan, lowpass, highpass, reverb, delay, delayTime, delayFeedback, pitch }
   */
  applyEffects(params) {
    this.audioProcessor.applyParameters(this.streamId, params);
  }
}