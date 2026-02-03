/**
 * Ball Connections - Render lines or circles connecting tracked balls
 * Lines: Uses TubeGeometry for proper line width
 * Circles: Uses RingGeometry for outlines or CircleGeometry for filled circles with video textures
 */

export class BallConnections {
  constructor(sceneManager, ballManager = null) {
    this.sceneManager = sceneManager;
    this.ballManager = ballManager;
    this.connections = new Map();
    this.ballPositions = {};
    this.routing = {}; // Maps ball IDs to streams: {ball_0: {stream: "streamA"}}
    this.streams = {}; // Maps stream names to clip defs: {streamA: "A{spinning_0}"}
    this.needsCircleUpdate = false; // Flag to force circle recreation
    
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
      circleContents: [0xff0000, 0x00ff00, 0x0000ff], // Can be hex colors or stream names
      colorMode: 'cycle'
    };
  }
  
  setRouting(routing, streams) {
    this.routing = routing || {};
    this.streams = streams || {};
  }
  
  updateBallVisibility() {
    if (!this.ballManager) return;
    
    // Hide balls if circles mode AND filled
    if (this.config.enabled && this.config.mode === 'circles' && this.config.filled) {
      if (this.ballManager.hideBallVideos) {
        this.ballManager.hideBallVideos();
      }
    } else {
      // Show balls in all other cases
      if (this.ballManager.showBallVideos) {
        this.ballManager.showBallVideos();
      }
    }
  }
  
  forceUpdateCircles() {
    if (this.config.mode === 'circles' && this.config.enabled) {
      console.log('[BallConnections] forceUpdateCircles called - setting needsCircleUpdate flag');
      // Force recreate all circles to pick up new video elements
      // Use a flag to force recreation on next position update
      this.needsCircleUpdate = true;
    } else {
      console.log('[BallConnections] forceUpdateCircles called but circles not active:', {mode: this.config.mode, enabled: this.config.enabled});
    }
  }
  
  setEnabled(enabled) {
    this.config.enabled = enabled;
    if (!enabled) {
      this.clearAll();
      // Re-show ball videos when connections disabled
      if (this.ballManager && this.ballManager.showBallVideos) {
        this.ballManager.showBallVideos();
      }
    } else {
      // Hide ball videos if in filled circles mode
      this.updateBallVisibility();
    }
  }
  
  setMode(mode) {
    const validModes = ['mesh', 'sequential', 'circles'];
    if (!validModes.includes(mode)) {
      console.warn(`Invalid mode: ${mode}, use ${validModes.join(', ')}`);
      return;
    }
    this.config.mode = mode;
    this.clearAll();
    this.updateBallVisibility();
  }
  
  setParameters(params) {
    let needsRecreate = false;
    
    if (params.color !== undefined) this.config.color = params.color;
    if (params.circleContents !== undefined) this.config.circleContents = params.circleContents;
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
    this.updateBallVisibility();
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
    
    // If forced update is needed, clear everything first
    if (this.needsCircleUpdate) {
      console.log('[BallConnections] needsCircleUpdate flag detected - clearing all circles');
      this.clearAll();
      this.needsCircleUpdate = false;
    }
    
    const pairs = [];
    let circleIndex = 0;
    
    for (let i = 0; i < ballIds.length; i++) {
      for (let j = i + 1; j < ballIds.length; j++) {
        const connId = `circle-${ballIds[i]}-${ballIds[j]}`;
        const circleContent = this.getContentForCircle(circleIndex);
        const radius = this.updateCircle(connId, ballIds[i], ballIds[j], circleContent, circleIndex);
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
  
  getContentForCircle(index) {
    if (!this.config.perCircleColors) {
      return this.config.color;
    }
    return this.config.circleContents[index % this.config.circleContents.length];
  }
  
  getVideoObjectForStream(streamName) {
    if (!this.ballManager || !this.ballManager.ballVideos) return null;
    
    // Find which ball is displaying this stream
    for (const [ballId, routeConfig] of Object.entries(this.routing)) {
      if (routeConfig.stream === streamName) {
        // Remove "ball_" prefix if present to get ballId for ballVideos lookup
        const ballKey = ballId.replace('ball_', '');
        const videoObj = this.ballManager.ballVideos[ballKey];
        if (videoObj && videoObj.element) {
          return videoObj;
        }
      }
    }
    
    console.warn(`[BallConnections] No ball found displaying stream: ${streamName}`);
    return null;
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
  
  updateCircle(connId, ballId1, ballId2, circleContent, circleIndex) {
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
        this.createCircle(connId, centerX, centerY, radius, world1, world2, circleContent, circleIndex);
      } else if (this.config.perCircleColors && typeof circleContent === 'number' && existing.material.color.getHex() !== circleContent) {
        existing.material.color.setHex(circleContent);
      }
    } else {
      this.createCircle(connId, centerX, centerY, radius, world1, world2, circleContent, circleIndex);
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
  
  createCircle(connId, centerX, centerY, radius, world1, world2, circleContent, circleIndex) {
    const webglScene = this.sceneManager.getWebGLScene();
    const isVideoContent = typeof circleContent === 'string';
    
    if (this.config.filled) {
      // Determine if we're using video texture or solid color
      let fillMaterial;
      let videoObj = null;
      
      if (isVideoContent && this.ballManager) {
        // Try to get media object for this stream
        videoObj = this.getVideoObjectForStream(circleContent);
        
        if (videoObj && videoObj.element) {
          console.log(`[BallConnections] Creating circle for stream ${circleContent} with element:`, videoObj.element.src || videoObj.element.tagName);
          
          // Ensure video is playing before creating texture
          if (videoObj.element instanceof HTMLVideoElement) {
            if (videoObj.element.paused) {
              console.warn(`[BallConnections] Video element is paused for ${circleContent}, playing now`);
              videoObj.element.play().catch(e => console.error('Failed to play video:', e));
            }
          }
          
          let texture;
          
          if (videoObj.element instanceof HTMLVideoElement) {
            // Create video texture
            texture = new THREE.VideoTexture(videoObj.element);
          } else if (videoObj.element instanceof HTMLImageElement) {
            // Create image texture
            texture = new THREE.Texture(videoObj.element);
            texture.needsUpdate = true;
          }
          
          if (texture) {
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            
            fillMaterial = new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: this.config.opacity,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            });
          } else {
            console.warn(`[BallConnections] Unsupported element type for stream: ${circleContent}`);
            fillMaterial = new THREE.MeshBasicMaterial({
              color: 0xff00ff, // Magenta to indicate unsupported type
              transparent: true,
              opacity: this.config.opacity,
              side: THREE.DoubleSide,
              blending: THREE.AdditiveBlending
            });
          }
        } else {
          console.warn(`[BallConnections] Could not find media for stream: ${circleContent}`);
          // Fallback to color
          fillMaterial = new THREE.MeshBasicMaterial({
            color: 0xff00ff, // Magenta to indicate missing media
            transparent: true,
            opacity: this.config.opacity,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
          });
        }
      } else {
        // Use solid color
        const color = typeof circleContent === 'number' ? circleContent : this.config.color;
        fillMaterial = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: this.config.opacity,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending
        });
      }
      
      // Create filled circle geometry
      const fillGeometry = new THREE.CircleGeometry(radius, this.config.segments);
      const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
      fillMesh.position.set(centerX, centerY, 0);
      webglScene.add(fillMesh);
      
      // Create white perimeter (fully opaque)
      const innerRadius = Math.max(0.01, radius - this.config.lineWidth);
      const perimeterGeometry = new THREE.RingGeometry(innerRadius, radius, this.config.segments);
      const perimeterMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: false,
        opacity: 1.0,
        side: THREE.DoubleSide
      });
      
      const perimeterMesh = new THREE.Mesh(perimeterGeometry, perimeterMaterial);
      perimeterMesh.position.set(centerX, centerY, 0.001); // Slightly in front
      webglScene.add(perimeterMesh);
      
      this.connections.set(connId, { 
        mesh: fillMesh,
        perimeterMesh: perimeterMesh,
        material: fillMaterial,
        perimeterMaterial: perimeterMaterial,
        lastPos1: { x: world1.x, y: world1.y },
        lastPos2: { x: world2.x, y: world2.y },
        radius: radius,
        content: circleContent,
        videoObj: videoObj,
        circleIndex: circleIndex
      });
    } else {
      // Unfilled mode - just the ring
      const innerRadius = Math.max(0.01, radius - this.config.lineWidth);
      const geometry = new THREE.RingGeometry(innerRadius, radius, this.config.segments);
      
      const color = typeof circleContent === 'number' ? circleContent : this.config.color;
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: this.config.opacity < 1.0,
        opacity: this.config.opacity,
        side: THREE.DoubleSide
      });
      
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(centerX, centerY, 0);
      webglScene.add(mesh);
      
      this.connections.set(connId, { 
        mesh, 
        material,
        lastPos1: { x: world1.x, y: world1.y },
        lastPos2: { x: world2.x, y: world2.y },
        radius: radius,
        content: circleContent,
        circleIndex: circleIndex
      });
    }
  }
  
  remove(connId) {
    const conn = this.connections.get(connId);
    if (!conn) return;
    
    const webglScene = this.sceneManager.getWebGLScene();
    
    webglScene.remove(conn.mesh);
    conn.mesh.geometry.dispose();
    conn.material.dispose();
    
    // Dispose video texture if present
    if (conn.material.map) {
      conn.material.map.dispose();
    }
    
    // Clean up perimeter mesh if it exists (filled mode)
    if (conn.perimeterMesh) {
      webglScene.remove(conn.perimeterMesh);
      conn.perimeterMesh.geometry.dispose();
      conn.perimeterMaterial.dispose();
    }
    
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
      // Only update opacity (preserve per-circle contents)
      for (const conn of this.connections.values()) {
        conn.material.opacity = this.config.opacity;
        conn.material.transparent = this.config.opacity < 1.0;
        // Perimeter stays fully opaque white in filled mode
      }
    } else {
      // Update all with same color and opacity
      for (const conn of this.connections.values()) {
        // Only update if it's a color material (not video texture)
        if (!conn.material.map && typeof conn.content === 'number') {
          conn.material.color.setHex(this.config.color);
        }
        conn.material.opacity = this.config.opacity;
        conn.material.transparent = this.config.opacity < 1.0;
        // Perimeter stays fully opaque white in filled mode
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
      
      // Dispose video texture if present
      if (conn.material.map) {
        conn.material.map.dispose();
      }
      
      // Clean up perimeter mesh if it exists (filled mode)
      if (conn.perimeterMesh) {
        webglScene.remove(conn.perimeterMesh);
        conn.perimeterMesh.geometry.dispose();
        conn.perimeterMaterial.dispose();
      }
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