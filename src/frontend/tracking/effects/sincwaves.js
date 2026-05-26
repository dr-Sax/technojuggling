import { Effect } from './_shared.js';

export class SincWaves extends Effect {
  static defaults = {
    amplitude: 1.0,
    frequency: 1.0,
    xStretch: 1.0,
    yStretch: 1.0,
    decay: 0.5,
    colorMultR: 4.0,
    colorMultG: 6.0,
    colorMultB: 4.0,
    intensityScale: 0.3,
    intensityBias: 0.5,
    planeSize: 20.0,
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.plane = null;
  }

  update(positions, ctx) {
    if (!this.plane) this._createPlane();
    this._updateUniforms(positions);
  }

  configure(config) {
    const prevPlaneSize = this.config.planeSize;
    Object.assign(this.config, config);
    if (!this.plane) return;

    const u = this.plane.material.uniforms;
    if (config.amplitude !== undefined) u.amplitude.value = config.amplitude;
    if (config.frequency !== undefined) u.frequency.value = config.frequency;
    if (config.xStretch !== undefined) u.xStretch.value = config.xStretch;
    if (config.yStretch !== undefined) u.yStretch.value = config.yStretch;
    if (config.decay !== undefined) u.decay.value = config.decay;
    if (config.colorMultR !== undefined) u.channelMult.value.x = config.colorMultR;
    if (config.colorMultG !== undefined) u.channelMult.value.y = config.colorMultG;
    if (config.colorMultB !== undefined) u.channelMult.value.z = config.colorMultB;
    if (config.intensityScale !== undefined) u.intensityScale.value = config.intensityScale;
    if (config.intensityBias !== undefined) u.intensityBias.value = config.intensityBias;

    if (config.planeSize !== undefined && config.planeSize !== prevPlaneSize) {
      this.plane.geometry.dispose();
      this.plane.geometry = new THREE.PlaneGeometry(this.config.planeSize, this.config.planeSize, 1, 1);
      u.planeSize.value = this.config.planeSize;
    }
  }

  dispose() {
    if (!this.plane) return;
    this.scene.remove(this.plane);
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.plane = null;
  }

  _createPlane() {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ballPositions: { value: new Float32Array(16 * 2) },
        numBalls: { value: 0 },
        amplitude: { value: this.config.amplitude },
        frequency: { value: this.config.frequency },
        xStretch: { value: this.config.xStretch },
        yStretch: { value: this.config.yStretch },
        decay: { value: this.config.decay },
        channelMult: {
          value: new THREE.Vector3(this.config.colorMultR, this.config.colorMultG, this.config.colorMultB)
        },
        intensityScale: { value: this.config.intensityScale },
        intensityBias: { value: this.config.intensityBias },
        planeSize: { value: this.config.planeSize },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: false,
      side: THREE.DoubleSide,
    });

    const geom = new THREE.PlaneGeometry(this.config.planeSize, this.config.planeSize, 1, 1);
    this.plane = new THREE.Mesh(geom, material);
    this.plane.position.z = 0;
    this.plane.renderOrder = -1;
    this.scene.add(this.plane);
  }

  _updateUniforms(positions) {
    const u = this.plane.material.uniforms;
    const posArray = u.ballPositions.value;
    let i = 0;
    for (const [, pos] of positions) {
      if (i >= 16) break;
      posArray[i * 2] = pos.x;
      posArray[i * 2 + 1] = pos.y;
      i++;
    }
    for (let j = i; j < 16; j++) {
      posArray[j * 2] = 0;
      posArray[j * 2 + 1] = 0;
    }
    u.numBalls.value = i;
    u.ballPositions.needsUpdate = true;
  }
}

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  #define PI 3.14159265359
  #define MAX_BALLS 16
  uniform vec2 ballPositions[MAX_BALLS];
  uniform int numBalls;
  uniform float amplitude, frequency, xStretch, yStretch, decay;
  uniform vec3 channelMult;
  uniform float intensityScale, intensityBias, planeSize;
  varying vec2 vUv;

  vec3 viridis(float t) {
    const vec3 c0 = vec3(0.2777273272234177, 0.005407344544966578, 0.3340998053353061);
    const vec3 c1 = vec3(0.1050930431085774, 1.404613529898575, 1.384590162594685);
    const vec3 c2 = vec3(-0.3308618287255563, 0.214847559468213, 0.09509516302823659);
    const vec3 c3 = vec3(-4.634230498983486, -5.799100973351585, -19.33244095627987);
    const vec3 c4 = vec3(6.228269936347081, 14.17993336680509, 56.69055260068105);
    const vec3 c5 = vec3(4.776384997670288, -13.74514537774601, -65.35303263337234);
    const vec3 c6 = vec3(-5.435455855934631, 4.645852612178535, 26.3124352495832);
    t = clamp(t, 0.0, 1.0);
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
  }

  float sinc(float x) {
    float px = PI * x;
    if (abs(px) < 0.001) return 1.0;
    return sin(px) / px;
  }

  float sincPattern(vec2 pos, vec2 center) {
    vec2 d = pos - center;
    float x = d.x * xStretch * frequency;
    float y = d.y * yStretch * frequency;
    float dist = length(d);
    return amplitude * sinc(x) * sinc(y) * exp(-decay * dist);
  }

  void main() {
    vec2 worldPos = (vUv - 0.5) * planeSize;
    float interference = 0.0;
    for (int i = 0; i < MAX_BALLS; i++) {
      if (i >= numBalls) break;
      interference += sincPattern(worldPos, ballPositions[i]);
    }
    float v = clamp(interference * intensityScale + intensityBias, 0.0, 1.0);
    vec3 img = viridis(v);
    gl_FragColor = vec4(fract(img * channelMult), 1.0);
  }
`;