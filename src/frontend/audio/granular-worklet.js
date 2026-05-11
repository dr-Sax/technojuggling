/**
 * Granular AudioWorklet Processor
 *
 * Asynchronous granular synthesis on live audio input.
 * Maintains a rolling ring buffer of recent audio and spawns grains
 * that read from scattered positions in that buffer.
 *
 * Parameters (all k-rate, so updates apply per 128-sample block):
 *   density   — grains per second (0.1–100)
 *   grainSize — grain duration in seconds (0.005–0.5)
 *   scatter   — how far back in buffer to read (0 = immediate, 1 = up to bufferSeconds ago)
 *   pitch     — playback rate for each grain (0.25 = octave down, 2.0 = octave up)
 *   spread    — stereo spread and pitch randomization amount (0–1)
 *   envelope  — grain envelope type (0=Gauss, 1=expodec, 2=rexpodec, 3=rect)
 *
 * Envelope characters (from Curtis Roads, Microsound):
 *   Gaussian  — soft, bell-shaped; smooth clouds
 *   Expodec   — exponential decay; percussive, pulsar-like
 *   Rexpodec  — reversed expodec; sucked-in character
 *   Rectangular — hard edges with tiny anti-click ramps; glitchy
 */

class GranularProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'density',   defaultValue: 10,  minValue: 0.1,  maxValue: 100, automationRate: 'k-rate' },
      { name: 'grainSize', defaultValue: 0.1, minValue: 0.005, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'scatter',   defaultValue: 0.5, minValue: 0,    maxValue: 1,   automationRate: 'k-rate' },
      { name: 'pitch',     defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'spread',    defaultValue: 0.3, minValue: 0,    maxValue: 1,   automationRate: 'k-rate' },
      { name: 'envelope',  defaultValue: 0,   minValue: 0,    maxValue: 3,   automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.bufferSeconds = 2.0;
    this.bufferLength = Math.floor(sampleRate * this.bufferSeconds);
    this.ringL = new Float32Array(this.bufferLength);
    this.ringR = new Float32Array(this.bufferLength);
    this.writePos = 0;
    this.grains = [];
    this.samplesUntilNextGrain = 0;
    this.MAX_GRAINS = 200;
  }

  envelope(phase, type) {
    // phase ∈ [0, 1] across grain lifetime
    if (type < 0.5) {
      // Gaussian — centered bell curve
      const x = (phase - 0.5) * 6;
      return Math.exp(-x * x * 0.5);
    } else if (type < 1.5) {
      // Expodec — sharp attack, exponential decay
      return Math.exp(-phase * 5);
    } else if (type < 2.5) {
      // Rexpodec — exponential attack, sharp release
      return Math.exp(-(1 - phase) * 5);
    } else {
      // Rectangular with anti-click ramps
      if (phase < 0.02) return phase / 0.02;
      if (phase > 0.98) return (1 - phase) / 0.02;
      return 1;
    }
  }

  spawnGrain(scatter, grainSizeSec, pitch, spread, envelope) {
    if (this.grains.length >= this.MAX_GRAINS) return;

    const grainSamples = Math.floor(grainSizeSec * sampleRate);
    // Read position: scatter back from writePos by random amount up to scatter * buffer
    const maxOffset = Math.max(grainSamples + 1, Math.floor(scatter * (this.bufferLength - grainSamples - 1)));
    const offset = grainSamples + Math.floor(Math.random() * maxOffset);
    const startPos = (this.writePos - offset + this.bufferLength) % this.bufferLength;

    // Per-grain pitch randomization driven by spread
    const pitchJitter = 1 + (Math.random() - 0.5) * spread * 0.15;
    // Per-grain pan driven by spread
    const pan = (Math.random() - 0.5) * spread * 2;

    this.grains.push({
      readPos: startPos,
      phase: 0,
      phaseInc: 1 / grainSamples,
      pitch: pitch * pitchJitter,
      pan: pan,
      envType: envelope,
      alive: true
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const inL = input && input[0] ? input[0] : null;
    const inR = input && input[1] ? input[1] : inL;
    const outL = output[0];
    const outR = output[1] || output[0];

    const density   = parameters.density[0];
    const grainSize = parameters.grainSize[0];
    const scatter   = parameters.scatter[0];
    const pitch     = parameters.pitch[0];
    const spread    = parameters.spread[0];
    const envelope  = parameters.envelope[0];

    const samplesPerGrain = sampleRate / Math.max(0.1, density);
    // Gain compensation so dense clouds don't runaway
    const norm = 1 / Math.sqrt(Math.max(1, density / 4));

    const blockSize = outL.length;

    for (let i = 0; i < blockSize; i++) {
      // Write incoming audio into ring buffer
      const sampleInL = inL ? inL[i] : 0;
      const sampleInR = inR ? inR[i] : sampleInL;
      this.ringL[this.writePos] = sampleInL;
      this.ringR[this.writePos] = sampleInR;
      this.writePos = (this.writePos + 1) % this.bufferLength;

      // Schedule new grains (quasi-synchronous: small random jitter on spacing)
      if (this.samplesUntilNextGrain <= 0) {
        this.spawnGrain(scatter, grainSize, pitch, spread, envelope);
        this.samplesUntilNextGrain = samplesPerGrain * (0.7 + Math.random() * 0.6);
      }
      this.samplesUntilNextGrain--;

      // Accumulate active grains
      let sumL = 0, sumR = 0;
      for (let g = 0; g < this.grains.length; g++) {
        const grain = this.grains[g];
        if (!grain.alive) continue;

        // Linear interpolation for fractional read position
        const readF = grain.readPos;
        const idx0 = Math.floor(readF) % this.bufferLength;
        const idx1 = (idx0 + 1) % this.bufferLength;
        const frac = readF - Math.floor(readF);
        const sampleL = this.ringL[idx0] * (1 - frac) + this.ringL[idx1] * frac;
        const sampleR = this.ringR[idx0] * (1 - frac) + this.ringR[idx1] * frac;

        const env = this.envelope(grain.phase, grain.envType);
        // Equal-power pan
        const panAngle = (grain.pan + 1) * Math.PI / 4;
        const panL = Math.cos(panAngle);
        const panR = Math.sin(panAngle);

        sumL += (sampleL * panL + sampleR * panL * 0.3) * env;
        sumR += (sampleR * panR + sampleL * panR * 0.3) * env;

        grain.readPos += grain.pitch;
        if (grain.readPos >= this.bufferLength) grain.readPos -= this.bufferLength;
        grain.phase += grain.phaseInc;
        if (grain.phase >= 1) grain.alive = false;
      }

      outL[i] = sumL * norm;
      outR[i] = sumR * norm;
    }

    // Compact grain array periodically
    if (this.grains.length > 50) {
      this.grains = this.grains.filter(g => g.alive);
    }

    return true;
  }
}

registerProcessor('granular-processor', GranularProcessor);