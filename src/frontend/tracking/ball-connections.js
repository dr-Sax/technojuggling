/**
 * Ball Connections - Render lines or circles connecting tracked balls
 * Lines: Uses TubeGeometry for proper line width
 * Circles: Uses RingGeometry for outlines or CircleGeometry for filled circles
 */

export class BallConnections {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.connections = new Map();
    this.ballPositions = {};
    
    this.config = {
      enabled: false,
      mode: 'mesh', // 'mesh', 'sequential', 'circles'
      color: 0xffffff,
      opacity: 1.0,
      lineWidth: 0.1,
      filled: false,
      zIndex: 0.05,
      segments: 32,
      perCircleColors: false,
      colors: [0xff0000, 0x00ff00, 0x0000ff],
      colorMode: 'cycle'
    };
  }
  
  setEnabled(enabled) {
    this.config.enabled = enabled;
    if (!enabled) this.clearAll();
  }
  
  setMode(mode) {
    const validModes = ['mesh', 'sequential', 'circles'];
    if (!validModes.includes(mode)) {
      console.warn(`Invalid mode: ${mode}, use ${validModes.join(', ')}`);
      return;
    }
    this.config.mode = mode;
    this.clearAll();
  }
  
  setParameters(params) {
    let needsRecreate = false;
    
    if (params.color !== undefined) this.config.color = params.color;
    if (params.colors !== undefined) this.config.colors = params.colors;
    if (params.perCircleColors !== undefined) this.config.perCircleColors = params.perCircleColors;
    if (params.colorMode !== undefined) this.config.colorMode = params.colorMode;
    if (params.opacity !== undefined) this.config.opacity = Math.max(0, Math.min(1, params.opacity));
    if (params.segments !== undefined) this.config.segments = Math.max(8, Math.min(64, params.segments));
    
    if (params.lineWidth !== undefined) {
      const newWidth = Math.max(0.05, Math.min(1.0, params.lineWidth / 20));
      if (Math.abs(newWidth - this.config.lineWidth) > 0.01) {
        this.config.lineWidth = newWidth;
        needsRecreate = true;
      } else {
        this.config.lineWidth = newWidth;
      }
    }
    
    if (params.filled !== undefined && this.config.filled !== params.filled) {
      this.config.filled = params.filled;
      needsRecreate = true;
    }
    
    if (params.zIndex !== undefined) this.config.zIndex = params.zIndex;
    
    this.updateMaterials();
    if (needsRecreate) this.recreateAll();
  }
  
  updatePositions(positions) {
    if (!this.config.enabled) return;
    
    this.ballPositions = positions;
    
    if (this.config.mode === 'circles') {
      this.updateCircleConnections();
    } else if (this.config.mode === 'mesh') {
      this.updateMeshConnections();
    } else {
      this.updateSequentialConnections();
    }
  }
  
  updateMeshConnections() {
    const ballIds = Object.keys(this.ballPositions);
    
    for (let i = 0; i < ballIds.length; i++) {
      for (let j = i + 1; j < ballIds.length; j++) {
        this.updateLine(`${ballIds[i]}-${ballIds[j]}`, ballIds[i], ballIds[j]);
      }
    }
    
    this.cleanup(ballIds);
  }
  
  updateSequentialConnections() {
    const ballIds = Object.keys(this.ballPositions).sort();
    
    if (ballIds.length < 2) {
      this.clearAll();
      return;
    }
    
    for (let i = 0; i < ballIds.length; i++) {
      const nextIndex = (i + 1) % ballIds.length;
      this.updateLine(`${ballIds[i]}-${ballIds[nextIndex]}`, ballIds[i], ballIds[nextIndex]);
    }
    
    const validIds = new Set();
    for (let i = 0; i < ballIds.length; i++) {
      const nextIndex = (i + 1) % ballIds.length;
      validIds.add(`${ballIds[i]}-${ballIds[nextIndex]}`);
    }
    
    for (const connId of this.connections.keys()) {
      if (!validIds.has(connId)) this.remove(connId);
    }
  }
  
  updateCircleConnections() {
    const ballIds = Object.keys(this.ballPositions);
    
    if (ballIds.length < 2) {
      this.clearAll();
      return;
    }
    
    const pairs = [];
    let circleIndex = 0;
    
    for (let i = 0; i < ballIds.length; i++) {
      for (let j = i + 1; j < ballIds.length; j++) {
        const connId = `circle-${ballIds[i]}-${ballIds[j]}`;
        const circleColor = this.getColorForCircle(circleIndex);
        const radius = this.updateCircle(connId, ballIds[i], ballIds[j], circleColor);
        pairs.push({ connId, radius });
        circleIndex++;
      }
    }
    
    // Sort by radius (largest first) for z-layering
    pairs.sort((a, b) => b.radius - a.radius);
    pairs.forEach((pair, index) => {
      const conn = this.connections.get(pair.connId);
      if (conn) conn.mesh.position.z = this.config.zIndex - (index * 0.01);
    });
    
    this.cleanup(ballIds);
  }
  
  getColorForCircle(index) {
    if (!this.config.perCircleColors) return this.config.color;
    return this.config.colors[index % this.config.colors.length];
  }
  
  updateLine(connId, ballId1, ballId2) {
    const pos1 = this.ballPositions[ballId1];
    const pos2 = this.ballPositions[ballId2];
    
    if (!pos1 || !pos2) {
      this.remove(connId);
      return;
    }
    
    const world1 = this.sceneManager.mapCameraToWorld(pos1.x, pos1.y);
    const world2 = this.sceneManager.mapCameraToWorld(pos2.x, pos2.y);
    const existing = this.connections.get(connId);
    
    if (existing) {
      const moved1 = !existing.lastPos1 || 
        Math.abs(world1.x - existing.lastPos1.x) > 0.1 || 
        Math.abs(world1.y - existing.lastPos1.y) > 0.1;
      const moved2 = !existing.lastPos2 || 
        Math.abs(world2.x - existing.lastPos2.x) > 0.1 || 
        Math.abs(world2.y - existing.lastPos2.y) > 0.1;
      
      if (moved1 || moved2) {
        this.remove(connId);
        this.createTubeLine(connId, world1, world2);
      }
    } else {
      this.createTubeLine(connId, world1, world2);
    }
  }
  
  updateCircle(connId, ballId1, ballId2, circleColor) {
    const pos1 = this.ballPositions[ballId1];
    const pos2 = this.ballPositions[ballId2];
    
    if (!pos1 || !pos2) {
      this.remove(connId);
      return 0;
    }
    
    const world1 = this.sceneManager.mapCameraToWorld(pos1.x, pos1.y);
    const world2 = this.sceneManager.mapCameraToWorld(pos2.x, pos2.y);
    
    const centerX = (world1.x + world2.x) / 2;
    const centerY = (world1.y + world2.y) / 2;
    const dx = world2.x - world1.x;
    const dy = world2.y - world1.y;
    const radius = Math.sqrt(dx * dx + dy * dy) / 2;
    
    const existing = this.connections.get(connId);
    
    if (existing) {
      const moved1 = !existing.lastPos1 || 
        Math.abs(world1.x - existing.lastPos1.x) > 0.1 || 
        Math.abs(world1.y - existing.lastPos1.y) > 0.1;
      const moved2 = !existing.lastPos2 || 
        Math.abs(world2.x - existing.lastPos2.x) > 0.1 || 
        Math.abs(world2.y - existing.lastPos2.y) > 0.1;
      
      if (moved1 || moved2) {
        this.remove(connId);
        this.createCircle(connId, centerX, centerY, radius, world1, world2, circleColor);
      } else if (this.config.perCircleColors && existing.material.color.getHex() !== circleColor) {
        existing.material.color.setHex(circleColor);
      }
    } else {
      this.createCircle(connId, centerX, centerY, radius, world1, world2, circleColor);
    }
    
    return radius;
  }
  
  createTubeLine(connId, world1, world2) {
    // Place at z=0 focal plane to match CSS3D positioning
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(world1.x, world1.y, 0),
      new THREE.Vector3(world2.x, world2.y, 0)
    );
    
    const geometry = new THREE.TubeGeometry(curve, 1, this.config.lineWidth, 8, false);
    const material = new THREE.MeshBasicMaterial({
      color: this.config.color,
      transparent: this.config.opacity < 1.0,
      opacity: this.config.opacity,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    this.sceneManager.getWebGLScene().add(mesh);
    
    this.connections.set(connId, { 
      mesh, 
      material,
      lastPos1: { x: world1.x, y: world1.y },
      lastPos2: { x: world2.x, y: world2.y },
      radius: 0
    });
  }
  
  createCircle(connId, centerX, centerY, radius, world1, world2, circleColor) {
    let geometry;
    
    if (this.config.filled) {
      geometry = new THREE.CircleGeometry(radius, this.config.segments);
    } else {
      const innerRadius = Math.max(0.01, radius - this.config.lineWidth);
      geometry = new THREE.RingGeometry(innerRadius, radius, this.config.segments);
    }
    
    const material = new THREE.MeshBasicMaterial({
      color: circleColor || this.config.color,
      transparent: this.config.opacity < 1.0,
      opacity: this.config.opacity,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    // Place at z=0 focal plane to match CSS3D positioning
    mesh.position.set(centerX, centerY, 0);
    
    this.sceneManager.getWebGLScene().add(mesh);
    
    this.connections.set(connId, { 
      mesh, 
      material,
      lastPos1: { x: world1.x, y: world1.y },
      lastPos2: { x: world2.x, y: world2.y },
      radius: radius,
      color: circleColor || this.config.color
    });
  }
  
  remove(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    
    this.sceneManager.getWebGLScene().remove(conn.mesh);
    conn.mesh.geometry.dispose();
    conn.material.dispose();
    this.connections.delete(connId);
  }
  
  cleanup(validBallIds) {
    const validBallSet = new Set(validBallIds);
    
    for (const connId of this.connections.keys()) {
      const parts = connId.replace('circle-', '').split('-');
      if (parts.length >= 2) {
        const ball1 = parts[0];
        const ball2 = parts[1];
        if (!validBallSet.has(ball1) || !validBallSet.has(ball2)) {
          this.remove(connId);
        }
      }
    }
  }
  
  updateMaterials() {
    if (this.config.perCircleColors) {
      // Only update opacity (preserve per-circle colors)
      for (const conn of this.connections.values()) {
        conn.material.opacity = this.config.opacity;
        conn.material.transparent = this.config.opacity < 1.0;
      }
    } else {
      // Update all with same color and opacity
      for (const conn of this.connections.values()) {
        conn.material.color.setHex(this.config.color);
        conn.material.opacity = this.config.opacity;
        conn.material.transparent = this.config.opacity < 1.0;
      }
    }
  }
  
  recreateAll() {
    const positions = { ...this.ballPositions };
    this.clearAll();
    
    setTimeout(() => {
      this.ballPositions = positions;
      if (this.config.mode === 'circles') {
        this.updateCircleConnections();
      } else if (this.config.mode === 'mesh') {
        this.updateMeshConnections();
      } else {
        this.updateSequentialConnections();
      }
    }, 10);
  }
  
  clearAll() {
    const webglScene = this.sceneManager.getWebGLScene();
    
    for (const conn of this.connections.values()) {
      webglScene.remove(conn.mesh);
      conn.mesh.geometry.dispose();
      conn.material.dispose();
    }
    
    this.connections.clear();
  }
  
  getConfig() {
    return { ...this.config };
  }
  
  getStats() {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      connectionCount: this.connections.size,
      ballCount: Object.keys(this.ballPositions).length
    };
  }
}