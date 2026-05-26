/**
 * Trails - Delayed polygon copies trailing behind each ball
 *
 * Configured via `ballTrails` block in user code.
 * Registers itself with effectRegistry on import.
 */

import {
  PerBallEffect,
  GeometryPrimitives,
  MaterialBuilder
} from './_shared.js';

import { effectRegistry } from '../effect-registry.js';


export class Trails extends PerBallEffect {
  static defaults = {
    count: 5,
    maxDelay: 0.5,
    radiusRange: [0.5, 2.0],
    sides: 6,
    color: 0x00ffff,
    opacity: 0.6,
    zIndex: 0.02,
    perimeterWidth: 0.1,
    perBallColors: false,
    ballColors: {},
    gradient: false
  };
  static usesHistory = true;
  static recreateKeys = ['count', 'sides', 'radiusRange', 'perimeterWidth'];
  static idPrefix = 'trail';

  getObjectCount() { return this.config.count; }

  animateAllForBall(ballId, worldPos, dt) {
    const now = Date.now() / 1000;
    for (let i = 1; i < this.config.count; i++) {
      const delay = (i / (this.config.count - 1)) * this.config.maxDelay;
      const pos = this.getPositionAtTime(ballId, now - delay);
      const id = `${ballId}-trail-${i}`;

      if (this.has(id)) {
        const obj = this.get(id);
        obj.mesh.position.set(pos.x, pos.y, obj.mesh.position.z);
        if (obj.perimeterMesh) obj.perimeterMesh.position.set(pos.x, pos.y, obj.perimeterMesh.position.z);
      } else {
        this.add(id, { ballId, index: i, position: pos });
      }
    }
  }

  createGeometry(id, { ballId, index, position }) {
    const t = index / (this.config.count - 1);
    const radius = this.config.radiusRange[0] + (this.config.radiusRange[1] - this.config.radiusRange[0]) * t;
    const color = this.colorFor(ballId, t);

    const geoms = GeometryPrimitives.polygon(radius, this.config.sides, this.config.perimeterWidth);
    const material = new MaterialBuilder().color(color).opacity(this.config.opacity * (1 - t * 0.5)).doubleSided().build();
    const mesh = new THREE.Mesh(geoms.fill, material);
    mesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001);

    let perimeterMesh = null;
    if (geoms.perimeter) {
      const pMat = new MaterialBuilder().color(0xffffff).doubleSided().build();
      perimeterMesh = new THREE.Mesh(geoms.perimeter, pMat);
      perimeterMesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001 + 0.0001);
      this.scene.add(perimeterMesh);
    }

    return { mesh, geometry: geoms.fill, material, perimeterMesh, perimeterGeometry: geoms.perimeter, perimeterMaterial: perimeterMesh?.material, ballId, index, _colorT: t };
  }

  updateGeometry() {} // Handled in animateAllForBall

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    this.objects.delete(id);
  }
}


// Registration
effectRegistry.register('trails', Trails);