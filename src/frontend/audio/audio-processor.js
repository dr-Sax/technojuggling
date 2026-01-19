/**
 * Audio Processor - Web Audio API integration for dynamic audio effects
 * Handles audio routing: Video → Effect Nodes → Speakers
 */

export class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.videos = new Map(); // videoId → { source, nodes, element }
    this.masterCompressor = null; // Master compressor to prevent clipping
    this.reverbNode = null; // Shared reverb convolver
    this.reverbImpulse = null; // Impulse response buffer
    this.initialized = false;
  }
  
  /**
   * Initialize audio context (call once, triggered by user interaction)
   */
  initialize() {
    if (this.initialized) return;
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Create master compressor to prevent clipping
      this.masterCompressor = this.audioContext.createDynamicsCompressor();
      
      // Configure compressor for aggressive limiting
      this.masterCompressor.threshold.value = -20;  // Start compressing earlier
      this.masterCompressor.knee.value = 20;        // Very smooth compression curve
      this.masterCompressor.ratio.value = 20;       // 20:1 ratio (hard limiting)
      this.masterCompressor.attack.value = 0.001;   // 1ms attack (very fast)
      this.masterCompressor.release.value = 0.1;    // 100ms release
      
      // Connect compressor to speakers
      this.masterCompressor.connect(this.audioContext.destination);
      
      // Create reverb impulse response (simple algorithmic reverb)
      this.createReverbImpulse();
      
      this.initialized = true;
      console.log('✓ Audio processor initialized with compressor and reverb');
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }
  
  /**
   * Create reverb impulse response
   * Generates a simple algorithmic reverb for convolution
   */
  createReverbImpulse() {
    const sampleRate = this.audioContext.sampleRate;
    const duration = 2.0; // 2 second reverb tail
    const length = sampleRate * duration;
    
    this.reverbImpulse = this.audioContext.createBuffer(2, length, sampleRate);
    
    // Fill both channels with decaying noise
    for (let channel = 0; channel < 2; channel++) {
      const channelData = this.reverbImpulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        // Exponential decay
        const decay = Math.exp(-i / (sampleRate * 0.5));
        // Random noise
        channelData[i] = (Math.random() * 2 - 1) * decay;
      }
    }
  }
  
  /**
   * Add a video element to audio processing
   * @param {HTMLVideoElement} videoElement - The video element
   * @param {string} videoId - Unique identifier for this video
   */
  addVideo(videoElement, videoId) {
    if (!this.initialized) {
      this.initialize();
    }
    
    if (!this.audioContext) {
      console.warn('AudioContext not available');
      return;
    }
    
    // Remove existing if already added
    if (this.videos.has(videoId)) {
      this.removeVideo(videoId);
    }
    
    try {
      // Create source from video element
      const source = this.audioContext.createMediaElementSource(videoElement);
      
      // Create effect nodes
      const gainNode = this.audioContext.createGain();
      const panNode = this.audioContext.createStereoPanner();
      const lowpassFilter = this.audioContext.createBiquadFilter();
      const highpassFilter = this.audioContext.createBiquadFilter();
      
      // Reverb nodes
      const reverbConvolver = this.audioContext.createConvolver();
      reverbConvolver.buffer = this.reverbImpulse;
      const reverbGain = this.audioContext.createGain();
      reverbGain.gain.value = 0; // Start with no reverb
      const dryGain = this.audioContext.createGain();
      dryGain.gain.value = 1; // Full dry signal
      
      // Delay nodes
      const delayNode = this.audioContext.createDelay(5.0); // Max 5 seconds
      delayNode.delayTime.value = 0.5; // Default 500ms
      const delayGain = this.audioContext.createGain();
      delayGain.gain.value = 0; // Start with no delay
      const delayFeedback = this.audioContext.createGain();
      delayFeedback.gain.value = 0.3; // Default feedback
      
      // Configure filters
      lowpassFilter.type = 'lowpass';
      lowpassFilter.frequency.value = 20000; // Default: no filtering
      lowpassFilter.Q.value = 1;
      
      highpassFilter.type = 'highpass';
      highpassFilter.frequency.value = 0; // Default: no filtering
      highpassFilter.Q.value = 1;
      
      // Create mixer node (combines dry, reverb, and delay)
      const mixer = this.audioContext.createGain();
      
      // Connect audio graph:
      // source → highpass → lowpass → gain → pan → [split into dry/reverb/delay] → mixer → compressor
      source.connect(highpassFilter);
      highpassFilter.connect(lowpassFilter);
      lowpassFilter.connect(gainNode);
      gainNode.connect(panNode);
      
      // Dry path
      panNode.connect(dryGain);
      dryGain.connect(mixer);
      
      // Reverb path
      panNode.connect(reverbConvolver);
      reverbConvolver.connect(reverbGain);
      reverbGain.connect(mixer);
      
      // Delay path with feedback
      panNode.connect(delayNode);
      delayNode.connect(delayGain);
      delayGain.connect(mixer);
      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode); // Feedback loop
      
      // Final output
      mixer.connect(this.masterCompressor);
      
      // Store references
      this.videos.set(videoId, {
        element: videoElement,
        source: source,
        nodes: {
          gain: gainNode,
          pan: panNode,
          lowpass: lowpassFilter,
          highpass: highpassFilter,
          dryGain: dryGain,
          reverbGain: reverbGain,
          delayNode: delayNode,
          delayGain: delayGain,
          delayFeedback: delayFeedback,
          mixer: mixer
        }
      });
      
      console.log(`✓ Audio graph connected for ${videoId}`);
      
    } catch (error) {
      console.error(`Failed to add video ${videoId} to audio processor:`, error);
    }
  }
  
  /**
   * Remove a video from audio processing
   * @param {string} videoId - Video identifier
   */
  removeVideo(videoId) {
    const video = this.videos.get(videoId);
    if (!video) return;
    
    try {
      // Disconnect all nodes
      video.source.disconnect();
      video.nodes.highpass.disconnect();
      video.nodes.lowpass.disconnect();
      video.nodes.gain.disconnect();
      video.nodes.pan.disconnect();
      video.nodes.dryGain.disconnect();
      video.nodes.reverbGain.disconnect();
      video.nodes.delayNode.disconnect();
      video.nodes.delayGain.disconnect();
      video.nodes.delayFeedback.disconnect();
      video.nodes.mixer.disconnect();
      
      this.videos.delete(videoId);
      console.log(`Removed audio graph for ${videoId}`);
    } catch (error) {
      console.error(`Error removing video ${videoId}:`, error);
    }
  }
  
  /**
   * Apply audio parameters to a video
   * @param {string} videoId - Video identifier
   * @param {Object} params - Audio parameters {volume, pan, lowpass, highpass, reverb, delay, delayTime, delayFeedback}
   */
  applyParameters(videoId, params) {
    const video = this.videos.get(videoId);
    if (!video) return;
    
    try {
      // Volume (0-100) → Gain (0-1)
      // Default to 100 if undefined or invalid
      const volume = (params.volume !== undefined && !isNaN(params.volume)) ? params.volume : 100;
      const gain = Math.max(0, Math.min(100, volume)) / 100;
      video.nodes.gain.gain.value = gain;
      
      // Pan (-1 to 1)
      // Default to 0 (center) if undefined or invalid
      const panValue = (params.pan !== undefined && !isNaN(params.pan)) ? params.pan : 0;
      const pan = Math.max(-1, Math.min(1, panValue));
      video.nodes.pan.pan.value = pan;
      
      // Lowpass filter (Hz)
      // Default to 20000 (no filtering) if undefined or invalid
      const lowpassValue = (params.lowpass !== undefined && !isNaN(params.lowpass)) ? params.lowpass : 20000;
      const lowpassFreq = Math.max(20, Math.min(20000, lowpassValue));
      video.nodes.lowpass.frequency.value = lowpassFreq;
      
      // Highpass filter (Hz)
      // Default to 0 (no filtering) if undefined or invalid
      const highpassValue = (params.highpass !== undefined && !isNaN(params.highpass)) ? params.highpass : 0;
      const highpassFreq = Math.max(0, Math.min(20000, highpassValue));
      video.nodes.highpass.frequency.value = highpassFreq;
      
      // Reverb (0-100) - dry/wet mix
      // 0 = no reverb (full dry), 100 = full reverb
      const reverbValue = (params.reverb !== undefined && !isNaN(params.reverb)) ? params.reverb : 0;
      const reverbMix = Math.max(0, Math.min(100, reverbValue)) / 100;
      video.nodes.reverbGain.gain.value = reverbMix;
      video.nodes.dryGain.gain.value = 1 - (reverbMix * 0.5); // Reduce dry as reverb increases
      
      // Delay (0-100) - dry/wet mix
      const delayValue = (params.delay !== undefined && !isNaN(params.delay)) ? params.delay : 0;
      const delayMix = Math.max(0, Math.min(100, delayValue)) / 100;
      video.nodes.delayGain.gain.value = delayMix * 0.5; // Scale down to prevent clipping
      
      // Delay time (0.1-2.0 seconds)
      const delayTimeValue = (params.delayTime !== undefined && !isNaN(params.delayTime)) ? params.delayTime : 0.5;
      const delayTime = Math.max(0.01, Math.min(5.0, delayTimeValue));
      video.nodes.delayNode.delayTime.value = delayTime;
      
      // Delay feedback (0-0.9)
      const feedbackValue = (params.delayFeedback !== undefined && !isNaN(params.delayFeedback)) ? params.delayFeedback : 0.3;
      const feedback = Math.max(0, Math.min(0.9, feedbackValue));
      video.nodes.delayFeedback.gain.value = feedback;
      
    } catch (error) {
      console.error(`Error applying audio parameters to ${videoId}:`, error);
    }
  }
  
  /**
   * Resume audio context (needed after user interaction)
   */
  resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }
  
  /**
   * Get audio context state
   * @returns {string} - 'running', 'suspended', or 'closed'
   */
  getState() {
    return this.audioContext ? this.audioContext.state : 'not initialized';
  }
  
  /**
   * Clear all videos
   */
  clearAll() {
    for (const videoId of this.videos.keys()) {
      this.removeVideo(videoId);
    }
  }
}