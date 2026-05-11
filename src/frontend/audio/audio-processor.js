/**
 * Audio Processor - Web Audio API + Tone.js integration for dynamic audio effects
 * Handles audio routing: Video → Tone.js PitchShift → Effect Nodes → Speakers
 */

export class AudioProcessor {
  constructor() {
    this.audioContext = null;
    this.videos = new Map(); // id → { source, nodes, element, toneNodes }
    this.masterCompressor = null;
    this.reverbImpulse = null;
    this.initialized = false;
    this.lastParams = new Map();
    this.toneStarted = false;
  }
  
  /**
   * Initialize audio context and Tone.js (call once, triggered by user interaction)
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      // Check if Tone.js is loaded
      if (typeof Tone === 'undefined') {
        console.error('Tone.js not loaded! Add <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js"></script> to your HTML');
        return;
      }
      
      // Start Tone.js (creates AudioContext internally)
      await Tone.start();
      this.toneStarted = true;
      
      // Use Tone's AudioContext
      this.audioContext = Tone.context.rawContext;
      
      // Create master compressor to prevent clipping
      this.masterCompressor = this.audioContext.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -20;
      this.masterCompressor.knee.value = 20;
      this.masterCompressor.ratio.value = 20;
      this.masterCompressor.attack.value = 0.001;
      this.masterCompressor.release.value = 0.1;
      
      // Connect compressor to speakers
      this.masterCompressor.connect(this.audioContext.destination);
      
      // Create reverb impulse response
      this.createReverbImpulse();
      
      this.initialized = true;
      console.log('✓ Audio processor initialized with Tone.js pitch shifting');
    } catch (error) {
      console.error('Failed to initialize AudioContext/Tone.js:', error);
    }
  }
  
  createReverbImpulse() {
    const sampleRate = this.audioContext.sampleRate;
    const duration = 2.0;
    const length = sampleRate * duration;
    
    this.reverbImpulse = this.audioContext.createBuffer(2, length, sampleRate);
    
    for (let channel = 0; channel < 2; channel++) {
      const channelData = this.reverbImpulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const decay = Math.exp(-i / (sampleRate * 0.5));
        channelData[i] = (Math.random() * 2 - 1) * decay;
      }
    }
  }
  
  /**
   * Add a video element to audio processing
   */
  addVideo(videoElement, videoId) {
    if (!this.initialized) {
      this.initialize();
    }
    if (!this.audioContext || !this.toneStarted) {
      console.warn('AudioContext/Tone.js not available');
      return;
    }
    if (this.videos.has(videoId)) {
      this.removeVideo(videoId);
    }
    
    try {
      let source;
      if (videoElement._audioSource) {
        source = videoElement._audioSource;
      } else {
        source = this.audioContext.createMediaElementSource(videoElement);
        videoElement._audioSource = source;
      }
      this._buildAudioGraph(source, videoId, videoElement);
      console.log(`✓ Audio graph with pitch shift connected for ${videoId}`);
    } catch (error) {
      console.error(`Failed to add video ${videoId} to audio processor:`, error);
    }
  }

  /**
   * Audio graph builder used by addVideo.
   * Wires: source → Tone.js pitch shift → filters → effects → master compressor → speakers
   */
  _buildAudioGraph(source, id, videoElement) {
    // Tone.js bridge nodes
    const toneInputGain = new Tone.Gain(1.0);
    const pitchShift = new Tone.PitchShift({
      pitch: 0,
      windowSize: 0.1,
      delayTime: 0,
      feedback: 0
    });
    const outputBridge = this.audioContext.createGain();
    outputBridge.gain.value = 1.0;

    // Web Audio effect nodes
    const gainNode = this.audioContext.createGain();
    const panNode = this.audioContext.createStereoPanner();
    const lowpassFilter = this.audioContext.createBiquadFilter();
    const highpassFilter = this.audioContext.createBiquadFilter();

    // Reverb nodes
    const reverbConvolver = this.audioContext.createConvolver();
    reverbConvolver.buffer = this.reverbImpulse;
    const reverbGain = this.audioContext.createGain();
    reverbGain.gain.value = 0;
    const dryGain = this.audioContext.createGain();
    dryGain.gain.value = 1;

    // Delay nodes
    const delayNode = this.audioContext.createDelay(5.0);
    delayNode.delayTime.value = 0.5;
    const delayGain = this.audioContext.createGain();
    delayGain.gain.value = 0;
    const delayFeedback = this.audioContext.createGain();
    delayFeedback.gain.value = 0.3;

    // Configure filters
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = 20000;
    lowpassFilter.Q.value = 1;
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = 0;
    highpassFilter.Q.value = 1;

    const mixer = this.audioContext.createGain();

    // Audio graph connections:
    // source → Tone.js pitch shift
    source.connect(toneInputGain.input);
    toneInputGain.connect(pitchShift);
    pitchShift.connect(outputBridge);

    // Tone.js output → Web Audio filters → effects
    outputBridge.connect(highpassFilter);
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
    delayFeedback.connect(delayNode);

    // Final output
    mixer.connect(this.masterCompressor);

    // Store references
    this.videos.set(id, {
      element: videoElement,
      source: source,
      toneNodes: {
        inputGain: toneInputGain,
        pitchShift: pitchShift,
        outputBridge: outputBridge
      },
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
  }
  
  removeVideo(videoId) {
    const video = this.videos.get(videoId);
    if (!video) return;
    
    try {
      // Disconnect Web Audio nodes
      video.source.disconnect();
      if (video.toneNodes.outputBridge) {
        video.toneNodes.outputBridge.disconnect();
      }
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
      
      // Dispose Tone.js nodes
      if (video.toneNodes.inputGain) {
        video.toneNodes.inputGain.dispose();
      }
      if (video.toneNodes.pitchShift) {
        video.toneNodes.pitchShift.dispose();
      }
      
      this.videos.delete(videoId);
      this.lastParams.delete(videoId);
      console.log(`Removed audio graph for ${videoId}`);
    } catch (error) {
      console.error(`Error removing video ${videoId}:`, error);
    }
  }
  
  /**
   * Apply audio parameters to a video
   * @param {string} id - Video ID
   * @param {Object} params - Audio parameters {volume, pan, lowpass, highpass, reverb, delay, delayTime, delayFeedback, pitch}
   */
  applyParameters(id, params) {
    const video = this.videos.get(id);
    if (!video) return;
    
    const cached = this.lastParams.get(id) || {};
    
    const audioParams = ['volume', 'pan', 'lowpass', 'highpass', 'reverb', 'delay', 'delayTime', 'delayFeedback', 'pitch'];
    const hasAudioParams = audioParams.some(key => params[key] !== undefined);
    if (!hasAudioParams && Object.keys(cached).length === 0) {
      return;
    }
    
    try {
      // Pitch shift (semitones: -12 to +12)
      const pitchValue = (params.pitch !== undefined && !isNaN(params.pitch)) ? params.pitch : 0;
      if (cached.pitch !== pitchValue) {
        const pitch = Math.max(-12, Math.min(12, pitchValue));
        video.toneNodes.pitchShift.pitch = pitch;
        cached.pitch = pitchValue;
      }
      
      // Volume (0-100) → Gain (0-1)
      const volume = (params.volume !== undefined && !isNaN(params.volume)) ? params.volume : 100;
      if (cached.volume !== volume) {
        const gain = Math.max(0, Math.min(100, volume)) / 100;
        video.nodes.gain.gain.value = gain;
        cached.volume = volume;
      }
      
      // Pan (-1 to 1)
      const panValue = (params.pan !== undefined && !isNaN(params.pan)) ? params.pan : 0;
      if (cached.pan !== panValue) {
        const pan = Math.max(-1, Math.min(1, panValue));
        video.nodes.pan.pan.value = pan;
        cached.pan = panValue;
      }
      
      // Lowpass filter (Hz)
      const lowpassValue = (params.lowpass !== undefined && !isNaN(params.lowpass)) ? params.lowpass : 20000;
      if (cached.lowpass !== lowpassValue) {
        const lowpassFreq = Math.max(20, Math.min(20000, lowpassValue));
        video.nodes.lowpass.frequency.value = lowpassFreq;
        cached.lowpass = lowpassValue;
      }
      
      // Highpass filter (Hz)
      const highpassValue = (params.highpass !== undefined && !isNaN(params.highpass)) ? params.highpass : 0;
      if (cached.highpass !== highpassValue) {
        const highpassFreq = Math.max(0, Math.min(20000, highpassValue));
        video.nodes.highpass.frequency.value = highpassFreq;
        cached.highpass = highpassValue;
      }
      
      // Reverb (0-100)
      const reverbValue = (params.reverb !== undefined && !isNaN(params.reverb)) ? params.reverb : 0;
      if (cached.reverb !== reverbValue) {
        const reverbMix = Math.max(0, Math.min(100, reverbValue)) / 100;
        video.nodes.reverbGain.gain.value = reverbMix;
        video.nodes.dryGain.gain.value = 1 - (reverbMix * 0.5);
        cached.reverb = reverbValue;
      }
      
      // Delay (0-100)
      const delayValue = (params.delay !== undefined && !isNaN(params.delay)) ? params.delay : 0;
      if (cached.delay !== delayValue) {
        const delayMix = Math.max(0, Math.min(100, delayValue)) / 100;
        video.nodes.delayGain.gain.value = delayMix * 0.5;
        cached.delay = delayValue;
      }
      
      // Delay time (0.01-5.0 seconds)
      const delayTimeValue = (params.delayTime !== undefined && !isNaN(params.delayTime)) ? params.delayTime : 0.5;
      if (cached.delayTime !== delayTimeValue) {
        const delayTime = Math.max(0.01, Math.min(5.0, delayTimeValue));
        video.nodes.delayNode.delayTime.value = delayTime;
        cached.delayTime = delayTimeValue;
      }
      
      // Delay feedback (0-0.9)
      const feedbackValue = (params.delayFeedback !== undefined && !isNaN(params.delayFeedback)) ? params.delayFeedback : 0.3;
      if (cached.delayFeedback !== feedbackValue) {
        const feedback = Math.max(0, Math.min(0.9, feedbackValue));
        video.nodes.delayFeedback.gain.value = feedback;
        cached.delayFeedback = feedbackValue;
      }
      
      this.lastParams.set(id, cached);
      
    } catch (error) {
      console.error(`Error applying audio parameters to ${id}:`, error);
    }
  }
  
  resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    if (this.toneStarted && Tone.context.state === 'suspended') {
      Tone.context.resume();
    }
  }
  
  getState() {
    return this.audioContext ? this.audioContext.state : 'not initialized';
  }
  
  clearAll() {
    for (const videoId of this.videos.keys()) {
      this.removeVideo(videoId);
    }
    this.lastParams.clear();
  }
}