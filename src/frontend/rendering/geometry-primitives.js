/**
 * GeometryPrimitives - Reusable shape generators
 * Inspired by the Stemkoski/Pascale graphics framework approach
 * 
 * Philosophy: Separate geometry creation from rendering logic
 * Each primitive returns {geometry, [optional perimeter geometry]}
 */

export class GeometryPrimitives {
  /**
   * Create a filled circle with optional white perimeter
   * @param {number} radius - Circle radius
   * @param {number} segments - Number of segments (default: 32)
   * @param {number} perimeterWidth - Width of white perimeter (0 = no perimeter)
   * @returns {{fill: THREE.CircleGeometry, perimeter: THREE.RingGeometry|null}}
   */
  static circle(radius, segments = 32, perimeterWidth = 0) {
    const fillGeometry = new THREE.CircleGeometry(radius, segments);
    
    let perimeterGeometry = null;
    if (perimeterWidth > 0) {
      const innerRadius = Math.max(0.01, radius - perimeterWidth);
      perimeterGeometry = new THREE.RingGeometry(innerRadius, radius, segments);
    }
    
    return { fill: fillGeometry, perimeter: perimeterGeometry };
  }
  
  /**
   * Create a ring (hollow circle)
   * @param {number} innerRadius - Inner radius
   * @param {number} outerRadius - Outer radius
   * @param {number} segments - Number of segments
   * @returns {THREE.RingGeometry}
   */
  static ring(innerRadius, outerRadius, segments = 32) {
    return new THREE.RingGeometry(innerRadius, outerRadius, segments);
  }
  
  /**
   * Create a regular polygon (filled)
   * @param {number} radius - Radius from center to vertices
   * @param {number} sides - Number of sides
   * @param {number} perimeterWidth - Width of white perimeter (0 = no perimeter)
   * @returns {{fill: THREE.CircleGeometry, perimeter: THREE.RingGeometry|null}}
   */
  static polygon(radius, sides, perimeterWidth = 0) {
    return this.circle(radius, sides, perimeterWidth);
  }
  
  /**
   * Create a tube/line between two points
   * @param {THREE.Vector3} p1 - Start point
   * @param {THREE.Vector3} p2 - End point
   * @param {number} width - Tube width/radius
   * @param {number} radialSegments - Number of radial segments (default: 8)
   * @returns {THREE.TubeGeometry}
   */
  static tube(p1, p2, width, radialSegments = 8) {
    const path = new THREE.LineCurve3(p1, p2);
    return new THREE.TubeGeometry(path, 1, width, radialSegments, false);
  }
  
  /**
   * Create a rectangular plane
   * @param {number} width - Width
   * @param {number} height - Height
   * @returns {THREE.PlaneGeometry}
   */
  static rectangle(width, height) {
    return new THREE.PlaneGeometry(width, height);
  }
  
  /**
   * Create a star shape
   * @param {number} outerRadius - Outer radius (tip of points)
   * @param {number} innerRadius - Inner radius (between points)
   * @param {number} points - Number of points
   * @returns {THREE.Shape}
   */
  static starShape(outerRadius, innerRadius, points = 5) {
    const shape = new THREE.Shape();
    
    for (let i = 0; i < points * 2; i++) {
      const angle = (i / (points * 2)) * Math.PI * 2;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      
      if (i === 0) {
        shape.moveTo(x, y);
      } else {
        shape.lineTo(x, y);
      }
    }
    
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }
  
  /**
   * Create a spiral path (useful for trails/effects)
   * @param {number} innerRadius - Starting radius
   * @param {number} outerRadius - Ending radius
   * @param {number} turns - Number of complete turns
   * @param {number} segments - Number of segments
   * @returns {THREE.Vector2[]} Array of 2D points
   */
  static spiralPath(innerRadius, outerRadius, turns = 2, segments = 100) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * turns * Math.PI * 2;
      const radius = innerRadius + (outerRadius - innerRadius) * t;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }
  
  /**
   * Create a bezier curve between points with control points
   * @param {THREE.Vector3} start - Start point
   * @param {THREE.Vector3} control1 - First control point
   * @param {THREE.Vector3} control2 - Second control point
   * @param {THREE.Vector3} end - End point
   * @returns {THREE.CubicBezierCurve3}
   */
  static bezierCurve(start, control1, control2, end) {
    return new THREE.CubicBezierCurve3(start, control1, control2, end);
  }
  
  /**
   * Create an arc
   * @param {number} radius - Arc radius
   * @param {number} startAngle - Start angle in radians
   * @param {number} endAngle - End angle in radians
   * @param {number} segments - Number of segments
   * @returns {THREE.Vector2[]} Array of 2D points
   */
  static arcPath(radius, startAngle, endAngle, segments = 32) {
    const points = [];
    const angleRange = endAngle - startAngle;
    for (let i = 0; i <= segments; i++) {
      const angle = startAngle + (i / segments) * angleRange;
      points.push(new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ));
    }
    return points;
  }
  
  // ========================================================================
  // 3D PRIMITIVES - For wireframes and 3D effects
  // ========================================================================
  
  /**
   * Create a box/cube geometry
   * @param {number} width - Width (x)
   * @param {number} height - Height (y) 
   * @param {number} depth - Depth (z)
   * @param {number} widthSegments - Segments along width (default: 1)
   * @param {number} heightSegments - Segments along height (default: 1)
   * @param {number} depthSegments - Segments along depth (default: 1)
   * @returns {THREE.BoxGeometry}
   */
  static box(width, height, depth, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
    return new THREE.BoxGeometry(width, height, depth, widthSegments, heightSegments, depthSegments);
  }
  
  /**
   * Create a sphere geometry
   * @param {number} radius - Sphere radius
   * @param {number} widthSegments - Horizontal segments (default: 16)
   * @param {number} heightSegments - Vertical segments (default: 12)
   * @returns {THREE.SphereGeometry}
   */
  static sphere(radius, widthSegments = 16, heightSegments = 12) {
    return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  }
  
  /**
   * Create a cone geometry
   * @param {number} radius - Base radius
   * @param {number} height - Cone height
   * @param {number} radialSegments - Segments around (default: 8)
   * @param {number} heightSegments - Segments along height (default: 1)
   * @param {boolean} openEnded - Open or closed bottom (default: false)
   * @returns {THREE.ConeGeometry}
   */
  static cone(radius, height, radialSegments = 8, heightSegments = 1, openEnded = false) {
    return new THREE.ConeGeometry(radius, height, radialSegments, heightSegments, openEnded);
  }
  
  /**
   * Create a cylinder geometry
   * @param {number} radiusTop - Top radius
   * @param {number} radiusBottom - Bottom radius
   * @param {number} height - Cylinder height
   * @param {number} radialSegments - Segments around (default: 8)
   * @param {number} heightSegments - Segments along height (default: 1)
   * @returns {THREE.CylinderGeometry}
   */
  static cylinder(radiusTop, radiusBottom, height, radialSegments = 8, heightSegments = 1) {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments, heightSegments);
  }
  
  /**
   * Create a torus (donut) geometry
   * @param {number} radius - Torus radius
   * @param {number} tube - Tube radius
   * @param {number} radialSegments - Segments around tube (default: 8)
   * @param {number} tubularSegments - Segments around torus (default: 16)
   * @returns {THREE.TorusGeometry}
   */
  static torus(radius, tube, radialSegments = 8, tubularSegments = 16) {
    return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
  }
  
  /**
   * Create a tetrahedron geometry
   * @param {number} radius - Radius
   * @param {number} detail - Subdivision detail (default: 0)
   * @returns {THREE.TetrahedronGeometry}
   */
  static tetrahedron(radius, detail = 0) {
    return new THREE.TetrahedronGeometry(radius, detail);
  }
  
  /**
   * Create an octahedron geometry
   * @param {number} radius - Radius
   * @param {number} detail - Subdivision detail (default: 0)
   * @returns {THREE.OctahedronGeometry}
   */
  static octahedron(radius, detail = 0) {
    return new THREE.OctahedronGeometry(radius, detail);
  }
  
  /**
   * Create an icosahedron geometry
   * @param {number} radius - Radius
   * @param {number} detail - Subdivision detail (default: 0)
   * @returns {THREE.IcosahedronGeometry}
   */
  static icosahedron(radius, detail = 0) {
    return new THREE.IcosahedronGeometry(radius, detail);
  }
  
  /**
   * Create a dodecahedron geometry
   * @param {number} radius - Radius
   * @param {number} detail - Subdivision detail (default: 0)
   * @returns {THREE.DodecahedronGeometry}
   */
  static dodecahedron(radius, detail = 0) {
    return new THREE.DodecahedronGeometry(radius, detail);
  }
  
  // ========================================================================
  // WIREFRAME HELPERS - Convert geometries to wireframes using EdgesGeometry
  // ========================================================================
  
  /**
   * Create a wireframe cube
   * @param {number} size - Cube size
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeCube(size = 1) {
    const geometry = new THREE.BoxGeometry(size, size, size);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe sphere
   * @param {number} radius - Sphere radius
   * @param {number} widthSegments - Horizontal segments (default: 8)
   * @param {number} heightSegments - Vertical segments (default: 6)
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeSphere(radius = 1, widthSegments = 8, heightSegments = 6) {
    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe cone
   * @param {number} radius - Base radius
   * @param {number} height - Cone height
   * @param {number} radialSegments - Number of segments around (default: 8)
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeCone(radius = 1, height = 2, radialSegments = 8) {
    const geometry = new THREE.ConeGeometry(radius, height, radialSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe cylinder
   * @param {number} radiusTop - Top radius
   * @param {number} radiusBottom - Bottom radius
   * @param {number} height - Cylinder height
   * @param {number} radialSegments - Segments around (default: 8)
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeCylinder(radiusTop = 1, radiusBottom = 1, height = 2, radialSegments = 8) {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe torus (donut)
   * @param {number} radius - Torus radius
   * @param {number} tube - Tube radius
   * @param {number} radialSegments - Segments around tube (default: 8)
   * @param {number} tubularSegments - Segments around torus (default: 12)
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeTorus(radius = 1, tube = 0.4, radialSegments = 8, tubularSegments = 12) {
    const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe octahedron
   * @param {number} radius - Octahedron radius
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeOctahedron(radius = 1) {
    const geometry = new THREE.OctahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe tetrahedron
   * @param {number} radius - Tetrahedron radius
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeTetrahedron(radius = 1) {
    const geometry = new THREE.TetrahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe icosahedron
   * @param {number} radius - Icosahedron radius
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeIcosahedron(radius = 1) {
    const geometry = new THREE.IcosahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
  
  /**
   * Create a wireframe dodecahedron
   * @param {number} radius - Dodecahedron radius
   * @returns {THREE.EdgesGeometry}
   */
  static wireframeDodecahedron(radius = 1) {
    const geometry = new THREE.DodecahedronGeometry(radius);
    return new THREE.EdgesGeometry(geometry);
  }
}