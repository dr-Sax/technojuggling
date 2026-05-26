/**
 * Glow - Additive disc behind each ball that pulses with time.
 *
 * Demonstrates the basic Effect pattern:
 *   - per-ball mesh map
 *   - update() reads ctx.time and positions, moves and animates meshes
 *   - configure() handles live param changes
 *   - dispose() / removeBall() clean up
 */

import { Effect, makeMaterial, makeDisc, disposeMesh, colorFor } from './_shared.js';

export class Glow extends Effect {
  static defaults = {
    radius: 1.5,        // base disc radius (world units)
    pulse: 0.3,         // pulse amplitude (0 = no pulse, 1 = ±100%)
    speed: 2.0,         // pulse frequency (radians/sec)
    color: 0xffaa00,
    opacity: 0.5,
    zIndex: -0.01,      // behind ball media (which sits at ~0)
    ballColors: {},     // per-ball color override
  };

  constructor(sceneManager) {
    super(sceneManager);
    this.discs = new Map();  // ballId → mesh
  }

  update(positions, ctx) {
    const pulse = 1 + Math.sin(ctx.time * this.config.speed) * this.config.pulse;

    for (const [ballId, pos] of positions) {
      let mesh = this.discs.get(ballId);
      if (!mesh) {
        mesh = this._createDisc(ballId);
        this.discs.set(ballId, mesh);
      }
      mesh.position.set(pos.x, pos.y, this.config.zIndex);
      mesh.scale.setScalar(pulse);
    }
  }

  configure(config) {
    Object.assign(this.config, config);
    // Restyle existing discs without rebuilding geometry.
    for (const [ballId, mesh] of this.discs) {
      mesh.material.color.setHex(colorFor(this.config, ballId));
      mesh.material.opacity = this.config.opacity;
    }
  }

  dispose() {
    for (const mesh of this.discs.values()) disposeMesh(this.scene, mesh);
    this.discs.clear();
  }

  removeBall(ballId) {
    const mesh = this.discs.get(ballId);
    if (!mesh) return;
    disposeMesh(this.scene, mesh);
    this.discs.delete(ballId);
  }

  _createDisc(ballId) {
    const geom = makeDisc(this.config.radius, 32);
    const mat = makeMaterial({
      color: colorFor(this.config, ballId),
      opacity: this.config.opacity,
      additive: true,  // additive blending makes it look like light
    });
    const mesh = new THREE.Mesh(geom, mat);
    this.scene.add(mesh);
    return mesh;
  }
}