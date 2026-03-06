/**
 * ═══════════════════════════════════════════════════════════════
 *  Tell-A-Vision Effects Library
 * ═══════════════════════════════════════════════════════════════
 * 
 *  All visual effects in one file, each typically 20-60 lines.
 *  The base classes (PerBallEffect, SpawnEffect, GlobalEffect)
 *  handle all the boilerplate — these just define the creative part.
 * 
 *  To add a new effect:
 *    1. Write a class extending one of the three bases
 *    2. Define `static defaults` and override 1-2 methods
 *    3. Register it at the bottom of this file
 *    4. That's it!
 * 
 *  See effect-bases.js for full documentation on each base class.
 * ═══════════════════════════════════════════════════════════════
 */

import {
  PerBallEffect,
  SpawnEffect,
  GlobalEffect,
  GeometryPrimitives,
  MaterialBuilder,
  ColorUtils,
  resolveColor,
  lerpColor
} from '../rendering/effect-bases.js';

import { effectRegistry } from './effect-registry.js';
import { BallSpacetime } from './ball-spacetime.js';


// ════════════════════════════════════════════════════════════════
//  TRAILS — Delayed polygon copies trailing behind each ball
// ════════════════════════════════════════════════════════════════

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


// ════════════════════════════════════════════════════════════════
//  RIPPLES — Expanding rings emanating from ball positions
// ════════════════════════════════════════════════════════════════

export class Ripples extends SpawnEffect {
  static defaults = {
    maxRipples: 3,
    spawnInterval: 0.5,
    expansionSpeed: 2.0,
    maxRadius: 5.0,
    ringWidth: 0.1,
    color: 0x00ffff,
    segments: 32,
    zIndex: 0.01,
    perBallColors: false,
    ballColors: {}
  };
  static recreateKeys = ['segments', 'ringWidth'];

  spawnForBall(ballId, worldPos, now) {
    const existing = Array.from(this._spawnData.values()).filter(d => d.ballId === ballId).length;
    if (existing >= this.config.maxRipples) return [];

    const id = `${ballId}-ripple-${now}`;
    const color = this.colorFor(ballId);
    const geometry = GeometryPrimitives.ring(0.01, this.config.ringWidth, this.config.segments);
    const material = new MaterialBuilder().color(color).opacity(1.0).doubleSided().additive().build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);

    return [{ id, mesh, geometry, material, ballId, birthTime: now }];
  }

  animateSpawned(obj, age) {
    const radius = age * this.config.expansionSpeed;
    if (radius >= this.config.maxRadius) return false;

    obj.material.opacity = 1.0 - (radius / this.config.maxRadius);
    obj.geometry.dispose();
    obj.geometry = GeometryPrimitives.ring(
      Math.max(0.01, radius - this.config.ringWidth),
      radius,
      this.config.segments
    );
    obj.mesh.geometry = obj.geometry;
    return true;
  }

  createGeometry(id, params) {
    // Spawned objects come pre-built from spawnForBall
    return { mesh: params.mesh, geometry: params.geometry, material: params.material, ballId: params.ballId };
  }

  updateGeometry() {}
}


// ════════════════════════════════════════════════════════════════
//  PARTICLES — Burst of small circles flying outward
// ════════════════════════════════════════════════════════════════

export class Particles extends SpawnEffect {
  static defaults = {
    particleCount: 10,
    spawnInterval: 0.1,
    lifespan: 2.0,
    speed: 1.0,
    size: 0.1,
    color: 0xffffff,
    zIndex: 0.05,
    gravity: 0,
    fadeOut: true
  };
  static recreateKeys = ['size'];

  spawnForBall(ballId, worldPos, now) {
    const spawns = [];
    for (let i = 0; i < this.config.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const vx = Math.cos(angle) * this.config.speed;
      const vy = Math.sin(angle) * this.config.speed;
      const id = `${ballId}-particle-${now}-${i}`;

      const { fill } = GeometryPrimitives.circle(this.config.size, 8, 0);
      const material = new MaterialBuilder().color(this.config.color).opacity(1.0).additive().build();
      const mesh = new THREE.Mesh(fill, material);
      mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);

      spawns.push({ id, mesh, geometry: fill, material, ballId, birthTime: now, vx, vy });
    }
    return spawns;
  }

  animateSpawned(obj, age, dt, data) {
    if (age >= this.config.lifespan) return false;

    obj.mesh.position.x += data.vx * dt;
    obj.mesh.position.y += data.vy * dt;
    if (this.config.gravity) data.vy -= this.config.gravity * dt;
    if (this.config.fadeOut) obj.material.opacity = 1.0 - (age / this.config.lifespan);
    return true;
  }

  createGeometry(id, params) {
    return { mesh: params.mesh, geometry: params.geometry, material: params.material, ballId: params.ballId };
  }

  updateGeometry() {}
}


// ════════════════════════════════════════════════════════════════
//  SHAPES3D — Rotating 3D wireframe shapes attached to balls
// ════════════════════════════════════════════════════════════════

export class Shapes3D extends PerBallEffect {
  static defaults = {
    shape: 'cube',
    size: 1.5,
    color: 0xffffff,
    opacity: 1.0,
    zIndex: 0.03,
    lineWidth: 1,
    rotateX: 0.01,
    rotateY: 0.02,
    rotateZ: 0.01,
    segments: 8,
    perBallShapes: false,
    ballShapes: {},
    perBallColors: false,
    ballColors: {}
  };
  static usesRotation = true;
  static recreateKeys = ['shape', 'size', 'segments', 'perBallShapes', 'ballShapes'];
  static idPrefix = 'shape';

  createForBall(ballId, worldPos) {
    const shape = this._shapeFor(ballId);
    const color = this.colorFor(ballId);
    const geometry = wireframeGeometry(shape, this.config.size, this.config.segments);
    const material = new THREE.LineBasicMaterial({
      color, transparent: this.config.opacity < 1.0,
      opacity: this.config.opacity, linewidth: this.config.lineWidth
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);
    return { mesh, geometry, material, ballId, _rotation: { x: 0, y: 0, z: 0 } };
  }

  animateForBall(obj, ballId, worldPos) {
    obj.mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);
    obj._rotation.x += this.config.rotateX;
    obj._rotation.y += this.config.rotateY;
    obj._rotation.z += this.config.rotateZ;
    obj.mesh.rotation.set(obj._rotation.x, obj._rotation.y, obj._rotation.z);
  }

  _shapeFor(ballId) {
    if (this.config.perBallShapes && this.config.ballShapes) {
      return this.config.ballShapes[ballId] ?? this.config.ballShapes[String(ballId)] ?? this.config.shape;
    }
    return this.config.shape;
  }
}


// ════════════════════════════════════════════════════════════════
//  SHAPES3D_THICK — Thick tube wireframes (works on all GPUs)
// ════════════════════════════════════════════════════════════════

export class Shapes3DThick extends PerBallEffect {
  static defaults = {
    shape: 'cube',
    size: 1.5,
    thickness: 0.05,
    color: 0xffffff,
    opacity: 1.0,
    zIndex: 0.03,
    emissive: 0x000000,
    emissiveIntensity: 0,
    rotateX: 0.01,
    rotateY: 0.02,
    rotateZ: 0.01,
    perBallShapes: false,
    ballShapes: {},
    perBallColors: false,
    ballColors: {}
  };
  static usesRotation = true;
  static recreateKeys = ['shape', 'size', 'thickness'];
  static idPrefix = 'thickshape';

  createForBall(ballId, worldPos) {
    const shape = this.config.perBallShapes
      ? (this.config.ballShapes[ballId] ?? this.config.ballShapes[String(ballId)] ?? this.config.shape)
      : this.config.shape;
    const color = this.colorFor(ballId);
    const group = buildThickWireframe(shape, this.config.size, this.config.thickness, color, this.config.opacity);
    group.position.set(worldPos.x, worldPos.y, this.config.zIndex);

    const materials = [];
    group.traverse(child => {
      if (child.isMesh && child.material) materials.push(child.material);
    });

    return { mesh: group, materials, ballId, _rotation: { x: 0, y: 0, z: 0 } };
  }

  animateForBall(obj, ballId, worldPos) {
    obj.mesh.position.set(worldPos.x, worldPos.y, this.config.zIndex);
    obj._rotation.x += this.config.rotateX;
    obj._rotation.y += this.config.rotateY;
    obj._rotation.z += this.config.rotateZ;
    obj.mesh.rotation.set(obj._rotation.x, obj._rotation.y, obj._rotation.z);
  }

  _updateMaterials() {
    for (const obj of this.getAll()) {
      const color = this.colorFor(obj.ballId);
      for (const mat of (obj.materials || [])) {
        if (mat?.color) mat.color.setHex(color);
        if (mat) { mat.opacity = this.config.opacity; mat.transparent = this.config.opacity < 1; }
        if (mat?.emissive) mat.emissive.setHex(this.config.emissive);
      }
    }
  }

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    obj.mesh.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
    this.scene.remove(obj.mesh);
    this.objects.delete(id);
  }
}


// ════════════════════════════════════════════════════════════════
//  TRAILS3D — 3D wireframe shapes trailing behind balls
// ════════════════════════════════════════════════════════════════

export class Trails3D extends PerBallEffect {
  static defaults = {
    shape: 'cube',
    count: 5,
    maxDelay: 0.5,
    sizeRange: [0.5, 1.5],
    color: 0x00ffff,
    opacity: 0.6,
    zIndex: 0.03,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    segments: 8,
    perBallColors: false,
    ballColors: {},
    gradient: false
  };
  static usesHistory = true;
  static usesRotation = true;
  static recreateKeys = ['shape', 'count', 'sizeRange', 'segments'];
  static idPrefix = '3dtrail';

  getObjectCount() { return this.config.count; }

  animateAllForBall(ballId, worldPos, dt) {
    const now = Date.now() / 1000;
    for (let i = 1; i < this.config.count; i++) {
      const delay = (i / (this.config.count - 1)) * this.config.maxDelay;
      const pos = this.getPositionAtTime(ballId, now - delay);
      const rot = this.getRotation(ballId);
      const id = `${ballId}-3dtrail-${i}`;

      if (this.has(id)) {
        const obj = this.get(id);
        obj.mesh.position.set(pos.x, pos.y, obj.mesh.position.z);
        obj.mesh.rotation.set(rot.x, rot.y, rot.z);
      } else {
        this.add(id, { ballId, index: i, position: pos, rotation: rot });
      }
    }
  }

  createGeometry(id, { ballId, index, position, rotation }) {
    const t = index / (this.config.count - 1);
    const size = this.config.sizeRange[0] + (this.config.sizeRange[1] - this.config.sizeRange[0]) * t;
    const color = this.colorFor(ballId);
    let opacity = this.config.opacity;
    if (this.config.gradient) opacity *= (1 - t * 0.7);

    const geometry = wireframeGeometry(this.config.shape, size, this.config.segments);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, linewidth: 1 });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.position.set(position.x, position.y, this.config.zIndex - index * 0.001);
    if (rotation) mesh.rotation.set(rotation.x, rotation.y, rotation.z);

    return { mesh, geometry, material, ballId, index, _colorT: t };
  }

  updateGeometry() {} // Handled in animateAllForBall
}


// ════════════════════════════════════════════════════════════════
//  VORTEX — Spiral particles orbiting each ball
// ════════════════════════════════════════════════════════════════

export class Vortex extends PerBallEffect {
  static defaults = {
    particleCount: 20,
    radius: 2.0,
    spiralTightness: 0.5,
    particleSize: 0.1,
    inward: true,
    rotationSpeed: 0.05,
    radialSpeed: 0.02,
    color: 0x00ffff,
    opacity: 0.7,
    zIndex: 0.04,
    fadeEdges: true,
    colorGradient: false,
    colorStart: 0x00ffff,
    colorEnd: 0xff00ff,
    pulseSpeed: 0,
    perBallColors: false,
    ballColors: {}
  };
  static recreateKeys = ['particleCount', 'particleSize'];
  static idPrefix = 'vortex';

  getObjectCount() { return this.config.particleCount; }

  animateAllForBall(ballId, worldPos, dt) {
    const { particleCount, radius, spiralTightness, rotationSpeed, inward, pulseSpeed } = this.config;
    for (let i = 0; i < particleCount; i++) {
      const id = `${ballId}-vortex-${i}`;
      const t = i / particleCount;
      let distance = inward ? (1 - t) * radius : t * radius;
      if (pulseSpeed > 0) distance *= 1 + Math.sin(this.time * pulseSpeed + i * 0.5) * 0.2;

      const angle = t * Math.PI * 2 * spiralTightness + this.time * rotationSpeed;
      const x = worldPos.x + Math.cos(angle) * distance;
      const y = worldPos.y + Math.sin(angle) * distance;

      if (this.has(id)) {
        const obj = this.get(id);
        obj.mesh.position.set(x, y, this.config.zIndex);
        const color = this._particleColor(ballId, distance);
        obj.material.color.setHex(color);
        obj.material.opacity = this._particleOpacity(distance);
      } else {
        this.add(id, { ballId, index: i, x, y, distance });
      }
    }
  }

  createGeometry(id, { ballId, x, y, distance }) {
    const color = this._particleColor(ballId, distance);
    const { fill } = GeometryPrimitives.circle(this.config.particleSize, 8);
    const material = new MaterialBuilder().color(color).opacity(this._particleOpacity(distance)).additive().build();
    const mesh = new THREE.Mesh(fill, material);
    mesh.position.set(x, y, this.config.zIndex);
    return { mesh, geometry: fill, material, ballId };
  }

  updateGeometry() {} // Handled in animateAllForBall

  _particleColor(ballId, distance) {
    if (this.config.colorGradient) {
      const t = this.config.inward ? (distance / this.config.radius) : (1 - distance / this.config.radius);
      const c1 = this.colorFor(ballId) ?? this.config.colorStart;
      return lerpColor(c1, this.config.colorEnd, t);
    }
    return this.colorFor(ballId);
  }

  _particleOpacity(distance) {
    if (!this.config.fadeEdges) return this.config.opacity;
    const t = this.config.inward ? distance / this.config.radius : 1 - distance / this.config.radius;
    return this.config.opacity * Math.max(0.2, t);
  }
}


// ════════════════════════════════════════════════════════════════
//  FIELD3D — Ring of arrows/cones around each ball
// ════════════════════════════════════════════════════════════════

export class Field3D extends PerBallEffect {
  static defaults = {
    type: 'radial',
    rings: 3,
    pointsPerRing: 8,
    radius: 2.0,
    arrowSize: 0.3,
    arrowShape: 'cone',
    color: 0x00ffff,
    opacity: 0.7,
    zIndex: 0.03,
    rotate: true,
    rotateSpeed: 0.02,
    pulse: false,
    pulseSpeed: 0.05,
    inward: false,
    colorByDistance: false,
    colorClose: 0x00ff00,
    colorFar: 0xff0000,
    perBallColors: false,
    ballColors: {}
  };
  static recreateKeys = ['rings', 'pointsPerRing', 'radius', 'arrowSize', 'arrowShape'];
  static idPrefix = 'field';

  constructor(sceneManager) {
    super(sceneManager);
    this._rotOffset = 0;
    this._pulseOffset = 0;
  }

  getObjectCount() { return this.config.rings * this.config.pointsPerRing; }

  animateAllForBall(ballId, worldPos, dt) {
    if (this.config.rotate) this._rotOffset += this.config.rotateSpeed;
    if (this.config.pulse) this._pulseOffset += this.config.pulseSpeed;

    const spacing = this.config.radius / this.config.rings;
    let idx = 0;
    for (let ring = 1; ring <= this.config.rings; ring++) {
      const ringRadius = ring * spacing;
      for (let i = 0; i < this.config.pointsPerRing; i++) {
        const angle = (i / this.config.pointsPerRing) * Math.PI * 2 + this._rotOffset;
        const x = worldPos.x + Math.cos(angle) * ringRadius;
        const y = worldPos.y + Math.sin(angle) * ringRadius;
        const id = `${ballId}-field-${idx}`;

        if (this.has(id)) {
          const obj = this.get(id);
          obj.mesh.position.set(x, y, this.config.zIndex);
          this._orientArrow(obj.mesh, angle);
          if (this.config.pulse) {
            const s = 1 + Math.sin(this._pulseOffset + angle) * 0.3;
            obj.mesh.scale.set(s, s, s);
          }
        } else {
          this.add(id, { ballId, x, y, angle, distance: ringRadius, ringIndex: ring });
        }
        idx++;
      }
    }
  }

  createGeometry(id, { ballId, x, y, angle, distance }) {
    const color = this.config.colorByDistance
      ? lerpColor(this.config.colorClose, this.config.colorFar, distance / this.config.radius)
      : this.colorFor(ballId);
    const geometry = this.config.arrowShape === 'line'
      ? GeometryPrimitives.wireframeCone(this.config.arrowSize * 0.3, this.config.arrowSize, 6)
      : GeometryPrimitives.cone(this.config.arrowSize * 0.3, this.config.arrowSize, 6);
    const material = this.config.arrowShape === 'line'
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity: this.config.opacity })
      : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.config.opacity, side: THREE.DoubleSide });
    const mesh = this.config.arrowShape === 'line'
      ? new THREE.LineSegments(geometry, material) : new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, this.config.zIndex);
    this._orientArrow(mesh, angle);
    return { mesh, geometry, material, ballId };
  }

  updateGeometry() {}

  _orientArrow(mesh, angle) {
    const a = this.config.inward ? angle + Math.PI : angle;
    mesh.rotation.z = a - Math.PI / 2;
  }

  clear() { super.clear(); this._rotOffset = 0; this._pulseOffset = 0; }
}


// ════════════════════════════════════════════════════════════════
//  SPIDERWEB — Organic curved connections between all balls
// ════════════════════════════════════════════════════════════════

export class Spiderweb extends GlobalEffect {
  static defaults = {
    mode: 'mesh',
    maxConnections: 3,
    maxDistance: 10,
    curvature: 0.3,
    curvePoints: 12,
    color: 0xffffff,
    opacity: 0.6,
    lineWidth: 0.05,
    zIndex: 0.04,
    animate: false,
    animSpeed: 0.02,
    showTension: false,
    tensionColorClose: 0x00ff00,
    tensionColorFar: 0xff0000,
    randomCurvature: 0.2,
    gradient: false
  };
  static recreateKeys = ['curvature', 'curvePoints', 'lineWidth'];

  updateConnections(positions) {
    if (this.config.animate) this.tick(this.config.animSpeed);

    const ids = Object.keys(positions);
    const validIds = new Set();

    const pairs = this.config.mode === 'nearest'
      ? this._nearestPairs(positions, ids)
      : this._meshPairs(positions, ids);

    for (const { id, p1, p2, dist } of pairs) {
      const curv = this.config.curvature + (Math.random() - 0.5) * this.config.randomCurvature;
      if (this.has(id)) {
        const obj = this.get(id);
        const moved = Math.abs(p1.x - obj.lastPos.p1.x) > 0.01 || Math.abs(p1.y - obj.lastPos.p1.y) > 0.01 ||
                      Math.abs(p2.x - obj.lastPos.p2.x) > 0.01 || Math.abs(p2.y - obj.lastPos.p2.y) > 0.01;
        if (moved) this.add(id, { p1, p2, curvature: obj.baseCurvature });
      } else {
        this.add(id, { p1, p2, curvature: curv });
      }
      validIds.add(id);
    }

    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  createGeometry(id, { p1, p2, curvature }) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const px = -dy / dist, py = dx / dist;
    const cx = mx + px * dist * curvature, cy = my + py * dist * curvature;

    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(p1.x, p1.y, 0), new THREE.Vector3(cx, cy, 0), new THREE.Vector3(p2.x, p2.y, 0)
    );
    const geometry = new THREE.TubeGeometry(curve, this.config.curvePoints, this.config.lineWidth, 6, false);
    let color = this.config.color;
    if (this.config.showTension) color = lerpColor(this.config.tensionColorClose, this.config.tensionColorFar, Math.min(dist / this.config.maxDistance, 1));
    const material = new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = this.config.zIndex;
    return { mesh, geometry, material, lastPos: { p1: { ...p1 }, p2: { ...p2 } }, baseCurvature: curvature, distance: dist };
  }

  updateGeometry() {}

  _meshPairs(positions, ids) {
    const pairs = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        if (dist <= this.config.maxDistance) pairs.push({ id: `web-${ids[i]}-${ids[j]}`, p1, p2, dist });
      }
    }
    return pairs;
  }

  _nearestPairs(positions, ids) {
    const pairs = [];
    const seen = new Set();
    for (const ballId of ids) {
      const p1 = this.sceneManager.mapCameraToWorld(positions[ballId].x, positions[ballId].y);
      const neighbors = ids.filter(id => id !== ballId).map(id => {
        const p2 = this.sceneManager.mapCameraToWorld(positions[id].x, positions[id].y);
        return { id, p2, dist: Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) };
      }).filter(n => n.dist <= this.config.maxDistance).sort((a, b) => a.dist - b.dist).slice(0, this.config.maxConnections);

      for (const n of neighbors) {
        const key = [ballId, n.id].sort().join('-');
        if (!seen.has(key)) { seen.add(key); pairs.push({ id: `web-${key}`, p1, p2: n.p2, dist: n.dist }); }
      }
    }
    return pairs;
  }
}


// ════════════════════════════════════════════════════════════════
//  VECTOR FIELD — Full-screen arrows influenced by ball positions
// ════════════════════════════════════════════════════════════════

export class VectorFieldEffect extends GlobalEffect {
  static defaults = {
    gridWidth: 20,
    gridHeight: 15,
    arrowSize: 0.3,
    arrowShape: 'line',
    lineLength: 0.5,
    normalizeVectors: true,
    fieldType: 'electric',
    color: 0xffffff,
    opacity: 0.6,
    zIndex: 0.01,
    colorByMagnitude: true,
    colorWeak: 0x0000ff,
    colorStrong: 0xff0000,
    animate: false,
    animSpeed: 0.02,
    ballCharges: { 0: 1.0, 1: 1.0, 2: 1.0 },
    strength: 5.0,
    minMagnitude: 0.01,
    maxDistance: 15.0
  };
  static recreateKeys = ['gridWidth', 'gridHeight', 'arrowShape', 'arrowSize'];

  constructor(sceneManager) {
    super(sceneManager);
    this._ballPositions = new Map();
  }

  updateField(positions) {
    this._ballPositions.clear();
    for (const [ballId, pos] of Object.entries(positions)) {
      const wp = this.sceneManager.mapCameraToWorld(pos.x, pos.y);
      const charge = this.config.ballCharges[ballId] ?? this.config.ballCharges[String(ballId)] ?? 1.0;
      this._ballPositions.set(ballId, { x: wp.x, y: wp.y, charge });
    }

    if (this.config.animate) this.tick(this.config.animSpeed);

    const validIds = new Set();
    const { gridWidth, gridHeight } = this.config;
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const wp = this._gridToWorld(gx, gy);
        const field = this._calcField(wp.x, wp.y);
        if (field.mag < this.config.minMagnitude) continue;

        const id = `field-${gx}-${gy}`;
        this.addOrUpdate(id, { gx, gy, vector: field.vec, magnitude: field.mag });
        validIds.add(id);
      }
    }
    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  createGeometry(id, { gx, gy, vector, magnitude }) {
    const color = this._magColor(magnitude);
    const geometry = this._arrowGeom();
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: this.config.opacity });
    const mesh = new THREE.LineSegments(geometry, material);
    const wp = this._gridToWorld(gx, gy);
    mesh.position.set(wp.x, wp.y, this.config.zIndex);
    this._orientAndScale(mesh, vector, magnitude);
    return { mesh, geometry, material, gx, gy };
  }

  updateGeometry(id, { vector, magnitude }) {
    const obj = this.get(id);
    if (!obj) return;
    obj.material.color.setHex(this._magColor(magnitude));
    this._orientAndScale(obj.mesh, vector, magnitude);
  }

  _arrowGeom() {
    const s = this.config.arrowSize;
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, s, 0)];
    if (this.config.arrowShape === 'arrow') {
      pts.push(new THREE.Vector3(-s * 0.2, s * 0.8, 0), new THREE.Vector3(0, s, 0), new THREE.Vector3(s * 0.2, s * 0.8, 0));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  _orientAndScale(mesh, vec, mag) {
    const len = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    if (len > 0.001) mesh.rotation.z = Math.atan2(vec.y / len, vec.x / len) - Math.PI / 2;
    const scale = this.config.normalizeVectors ? this.config.lineLength : Math.min(mag * this.config.lineLength, 2);
    mesh.scale.set(scale, scale, 1);
  }

  _gridToWorld(gx, gy) {
    return {
      x: (gx / (this.config.gridWidth - 1)) * 20 - 10,
      y: (gy / (this.config.gridHeight - 1)) * 15 - 7.5
    };
  }

  _calcField(x, y) {
    let tx = 0, ty = 0;
    for (const ball of this._ballPositions.values()) {
      const dx = x - ball.x, dy = y - ball.y;
      const distSq = dx * dx + dy * dy, dist = Math.sqrt(distSq);
      if (dist > this.config.maxDistance || dist < 0.1) continue;
      let str;
      if (this.config.fieldType === 'gravity') str = -this.config.strength * Math.abs(ball.charge) / distSq;
      else if (this.config.fieldType === 'flow') str = this.config.strength * ball.charge / dist;
      else str = this.config.strength * ball.charge / distSq; // electric
      tx += str * dx / dist;
      ty += str * dy / dist;
    }
    return { vec: { x: tx, y: ty }, mag: Math.sqrt(tx * tx + ty * ty) };
  }

  _magColor(mag) {
    if (!this.config.colorByMagnitude) return this.config.color;
    const t = Math.min(Math.log(mag + 1) / Math.log(10), 1);
    return lerpColor(this.config.colorWeak, this.config.colorStrong, t);
  }

  clear() { super.clear(); this._ballPositions.clear(); }
}


// ════════════════════════════════════════════════════════════════
//  CONNECTIONS — Lines and circles between balls (unified)
// ════════════════════════════════════════════════════════════════
// Wraps the former ConnectionLines + ConnectionCircles into a single
// GlobalEffect so the connection system participates in the registry
// like everything else. Supports 3 modes: mesh, sequential, circles.

export class Connections extends GlobalEffect {
  static defaults = {
    mode: 'none',         // 'none', 'mesh', 'sequential', 'circles'
    color: 0xffffff,
    opacity: 1.0,
    lineWidth: 0.1,
    zIndex: 0.05,
    segments: 32,         // For circle mode
    filled: false,        // For circle mode: filled disc vs ring
    perCircleColors: false,
    circleContents: [0xff0000, 0x00ff00, 0x0000ff]
  };
  static recreateKeys = ['lineWidth', 'segments', 'filled'];

  constructor(sceneManager, audioProcessor, visualFX) {
    super(sceneManager);
    this._ballMedia = null;   // Set externally via setBallMedia()
    this._routing = {};
    this._onVisibilityChange = null; // callback: (visible) => {}
  }

  /** Called by BallTrackingManager to wire up the media dependency */
  setBallMedia(ballMedia) { this._ballMedia = ballMedia; }

  /** Callback for when circle fill mode needs to toggle ball media visibility */
  onVisibilityChange(fn) { this._onVisibilityChange = fn; }

  /** Set routing for texture-mapped circles */
  setRouting(routing) { this._routing = routing; }

  // --- Mode control ---

  setMode(mode) {
    if (mode === this.config.mode) return;
    this.clear();
    this.config.mode = mode;
    // When switching to filled circles, hide ball media
    if (this._onVisibilityChange) {
      this._onVisibilityChange(!(mode === 'circles' && this.config.filled));
    }
  }

  setEnabled(enabled) {
    if (!enabled) {
      this.config.mode = 'none';
      this.clear();
      if (this._onVisibilityChange) this._onVisibilityChange(true);
    }
  }

  // --- Main update: receives all ball positions each frame ---

  updateConnections(positions) {
    const mode = this.config.mode;
    if (mode === 'none') return;

    const ids = Object.keys(positions);
    if (ids.length < 2) { this.clear(); return; }

    if (mode === 'mesh') {
      this._updateLines(positions, ids, 'mesh');
    } else if (mode === 'sequential') {
      this._updateLines(positions, ids, 'sequential');
    } else if (mode === 'circles') {
      this._updateCircles(positions, ids);
    }
  }

  // --- Line modes (mesh / sequential) ---

  _updateLines(positions, ids, style) {
    const pairs = style === 'sequential' ? this._sequentialPairs(ids) : this._meshPairs(ids);
    const validIds = new Set();

    for (const [idA, idB] of pairs) {
      const connId = `line-${idA}-${idB}`;
      const p1 = this.sceneManager.mapCameraToWorld(positions[idA].x, positions[idA].y);
      const p2 = this.sceneManager.mapCameraToWorld(positions[idB].x, positions[idB].y);

      if (this.has(connId)) {
        const obj = this.get(connId);
        const moved = Math.abs(p1.x - obj._p1.x) > 0.01 || Math.abs(p1.y - obj._p1.y) > 0.01 ||
                      Math.abs(p2.x - obj._p2.x) > 0.01 || Math.abs(p2.y - obj._p2.y) > 0.01;
        if (moved) this.add(connId, { p1, p2, type: 'line' });
      } else {
        this.add(connId, { p1, p2, type: 'line' });
      }
      validIds.add(connId);
    }
    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  _meshPairs(ids) {
    const pairs = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        pairs.push([ids[i], ids[j]]);
    return pairs;
  }

  _sequentialPairs(ids) {
    const sorted = [...ids].sort();
    return sorted.map((id, i) => [id, sorted[(i + 1) % sorted.length]]);
  }

  // --- Circle mode ---

  _updateCircles(positions, ids) {
    const validIds = new Set();
    let index = 0;

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const connId = `circle-${ids[i]}-${ids[j]}`;
        const p1 = this.sceneManager.mapCameraToWorld(positions[ids[i]].x, positions[ids[i]].y);
        const p2 = this.sceneManager.mapCameraToWorld(positions[ids[j]].x, positions[ids[j]].y);
        const content = this.config.perCircleColors
          ? this.config.circleContents[index % this.config.circleContents.length]
          : this.config.color;

        if (this.has(connId)) {
          const obj = this.get(connId);
          const moved = Math.abs(p1.x - obj._p1.x) > 0.01 || Math.abs(p1.y - obj._p1.y) > 0.01 ||
                        Math.abs(p2.x - obj._p2.x) > 0.01 || Math.abs(p2.y - obj._p2.y) > 0.01;
          if (moved) this.add(connId, { p1, p2, type: 'circle', content, index });
        } else {
          this.add(connId, { p1, p2, type: 'circle', content, index });
        }
        validIds.add(connId);
        index++;
      }
    }

    // Layer by radius (biggest behind smallest)
    const sorted = Array.from(this.objects.entries())
      .filter(([id]) => id.startsWith('circle-'))
      .sort(([, a], [, b]) => (b._radius || 0) - (a._radius || 0));
    sorted.forEach(([, obj], i) => { obj.mesh.position.z = this.config.zIndex - i * 0.01; });

    for (const id of this.objects.keys()) { if (!validIds.has(id)) this.remove(id); }
  }

  // --- Geometry creation ---

  createGeometry(id, { p1, p2, type, content, index }) {
    if (type === 'line') return this._createLine(p1, p2);
    if (type === 'circle') return this._createCircle(p1, p2, content, index);
    return null;
  }

  _createLine(p1, p2) {
    const geometry = GeometryPrimitives.tube(
      new THREE.Vector3(p1.x, p1.y, 0),
      new THREE.Vector3(p2.x, p2.y, 0),
      this.config.lineWidth, 8
    );
    const material = new MaterialBuilder()
      .color(this.config.color)
      .opacity(this.config.opacity)
      .build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = this.config.zIndex;
    return { mesh, geometry, material, _p1: { ...p1 }, _p2: { ...p2 } };
  }

  _createCircle(p1, p2, content, index) {
    const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
    const radius = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) / 2;

    if (this.config.filled) {
      return this._createFilledCircle(cx, cy, radius, content, p1, p2, index);
    }
    return this._createRingCircle(cx, cy, radius, content, p1, p2, index);
  }

  _createFilledCircle(cx, cy, radius, content, p1, p2, index) {
    const material = this._circleContentMaterial(content);
    const geoms = GeometryPrimitives.circle(radius, this.config.segments, this.config.lineWidth);
    const mesh = new THREE.Mesh(geoms.fill, material);
    mesh.position.set(cx, cy, 0);

    let perimeterMesh = null;
    if (geoms.perimeter) {
      const pMat = new MaterialBuilder().color(0xffffff).doubleSided().build();
      perimeterMesh = new THREE.Mesh(geoms.perimeter, pMat);
      perimeterMesh.position.set(cx, cy, 0.001);
      this.scene.add(perimeterMesh);
    }

    return {
      mesh, geometry: geoms.fill, material,
      perimeterMesh, perimeterGeometry: geoms.perimeter, perimeterMaterial: perimeterMesh?.material,
      _p1: { ...p1 }, _p2: { ...p2 }, _radius: radius, content, index
    };
  }

  _createRingCircle(cx, cy, radius, content, p1, p2, index) {
    const innerRad = Math.max(0.01, radius - this.config.lineWidth);
    const geometry = GeometryPrimitives.ring(innerRad, radius, this.config.segments);
    const color = typeof content === 'number' ? content : this.config.color;
    const material = new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().additive().build();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(cx, cy, 0);
    return { mesh, geometry, material, _p1: { ...p1 }, _p2: { ...p2 }, _radius: radius, content, index };
  }

  _circleContentMaterial(content) {
    // Try to use video texture from ball media routing
    if (typeof content === 'string' && this._ballMedia) {
      for (const [ballId, stream] of Object.entries(this._routing)) {
        if (stream === content) {
          const el = this._ballMedia.getElement(ballId.replace('ball_', ''));
          if (el) {
            try {
              const texture = new THREE.Texture(el);
              texture.minFilter = THREE.LinearFilter;
              texture.magFilter = THREE.LinearFilter;
              texture.needsUpdate = true;
              return new THREE.MeshBasicMaterial({
                map: texture, transparent: true, opacity: this.config.opacity,
                side: THREE.DoubleSide, blending: THREE.AdditiveBlending
              });
            } catch (e) { /* fall through to color */ }
          }
        }
      }
    }
    const color = typeof content === 'number' ? content : this.config.color;
    return new MaterialBuilder().color(color).opacity(this.config.opacity).doubleSided().additive().build();
  }

  updateGeometry() {} // Handled by recreate-on-move pattern

  remove(id) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.scene.remove(obj.mesh);
    obj.geometry?.dispose();
    obj.material?.dispose();
    obj.material?.map?.dispose();
    if (obj.perimeterMesh) {
      this.scene.remove(obj.perimeterMesh);
      obj.perimeterGeometry?.dispose();
      obj.perimeterMaterial?.dispose();
    }
    this.objects.delete(id);
  }

  _onConfigChange(changed, prev) {
    // Handle filled toggle visibility side-effect
    if (changed.filled !== undefined && this._onVisibilityChange) {
      this._onVisibilityChange(!changed.filled);
    }
    super._onConfigChange(changed, prev);
  }
}


// ════════════════════════════════════════════════════════════════
//  SINC WAVES — Shader-based interference patterns (unique)
// ════════════════════════════════════════════════════════════════
// This effect is unique enough (custom shader, own plane) that it 
// stays mostly self-contained. It extends GlobalEffect for the 
// lifecycle but manages its own shader plane.

export { BallSincWaves } from './ball-sinc-waves.js';


// ════════════════════════════════════════════════════════════════
//  WIREFRAME GEOMETRY HELPER (shared by Shapes3D, Trails3D)
// ════════════════════════════════════════════════════════════════

function wireframeGeometry(shape, size, segments = 8) {
  switch (shape) {
    case 'cube':        return GeometryPrimitives.wireframeCube(size);
    case 'sphere':      return GeometryPrimitives.wireframeSphere(size * 0.5, segments, Math.floor(segments * 0.75));
    case 'cone':        return GeometryPrimitives.wireframeCone(size * 0.5, size, segments);
    case 'cylinder':    return GeometryPrimitives.wireframeCylinder(size * 0.5, size * 0.5, size, segments);
    case 'torus':       return GeometryPrimitives.wireframeTorus(size * 0.4, size * 0.15, 8, segments);
    case 'tetrahedron': return GeometryPrimitives.wireframeTetrahedron(size * 0.5);
    case 'octahedron':  return GeometryPrimitives.wireframeOctahedron(size * 0.5);
    case 'icosahedron': return GeometryPrimitives.wireframeIcosahedron(size * 0.5);
    case 'dodecahedron':return GeometryPrimitives.wireframeDodecahedron(size * 0.5);
    default:            return GeometryPrimitives.wireframeCube(size);
  }
}


// ════════════════════════════════════════════════════════════════
//  THICK WIREFRAME BUILDER (shared helper for Shapes3DThick)
// ════════════════════════════════════════════════════════════════

function buildThickWireframe(shape, size, thickness, color, opacity) {
  const group = new THREE.Group();
  const { vertices, edges } = getShapeEdges(shape, size);
  for (const [i, j] of edges) {
    const path = new THREE.LineCurve3(vertices[i], vertices[j]);
    const geom = new THREE.TubeGeometry(path, 1, thickness, 8, false);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
    group.add(new THREE.Mesh(geom, mat));
  }
  return group;
}

function getShapeEdges(shape, size) {
  const s = size / 2;
  switch (shape) {
    case 'tetrahedron': {
      const r = s;
      return {
        vertices: [new THREE.Vector3(r,r,r), new THREE.Vector3(-r,-r,r), new THREE.Vector3(-r,r,-r), new THREE.Vector3(r,-r,-r)],
        edges: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]
      };
    }
    case 'octahedron': {
      const r = s;
      return {
        vertices: [new THREE.Vector3(0,r,0), new THREE.Vector3(0,-r,0), new THREE.Vector3(r,0,0), new THREE.Vector3(-r,0,0), new THREE.Vector3(0,0,r), new THREE.Vector3(0,0,-r)],
        edges: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,4],[4,3],[3,5],[5,2]]
      };
    }
    default: { // cube
      return {
        vertices: [
          new THREE.Vector3(-s,-s,-s), new THREE.Vector3(s,-s,-s), new THREE.Vector3(s,s,-s), new THREE.Vector3(-s,s,-s),
          new THREE.Vector3(-s,-s,s), new THREE.Vector3(s,-s,s), new THREE.Vector3(s,s,s), new THREE.Vector3(-s,s,s)
        ],
        edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]
      };
    }
  }
}


// ════════════════════════════════════════════════════════════════
//  REGISTRATION — Wire everything up with the EffectRegistry
// ════════════════════════════════════════════════════════════════

effectRegistry.register('trails', Trails, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('ripples', Ripples, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('particles', Particles, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3Dshapes', Shapes3D, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3Dtrails', Trails3D, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('3DShapesThick', Shapes3DThick, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('spiderweb', Spiderweb, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});
effectRegistry.register('3DField', Field3D, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('vortex', Vortex, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});
effectRegistry.register('vectorField', VectorFieldEffect, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});
effectRegistry.register('connections', Connections, {
  updateMethod: null, clearMethod: 'clear', removeBallMethod: null
});
// Note: sincwaves registration stays in ball-tracking.js since it uses
// the original BallSincWaves class (too unique for the base classes)

effectRegistry.register('spacetime', BallSpacetime, {
  updateMethod: 'updateBall', removeBallMethod: 'removeBall', clearMethod: 'clear'
});