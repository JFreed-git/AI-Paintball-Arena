/**
 * mapThumbnail.js — Overhead map thumbnail renderer
 *
 * PURPOSE: Renders a top-down view of a map into a 200x200 data URL image
 *          using an offscreen Three.js scene with orthographic camera.
 * EXPORTS (window): generateMapThumbnail
 * DEPENDENCIES: THREE (r128), mapFormat.js (getDefaultMapData)
 */

(function () {
  var THUMB_SIZE = 200;
  var GROUND_COLOR = 0x3a4a3a;
  var WALL_COLOR = 0x8B7355;
  var DEFAULT_OBJ_COLOR = 0x888888;

  // Cache: { mapName: dataURL }
  var _cache = {};

  /**
   * Generate an overhead thumbnail of a map.
   * @param {object} mapData — map JSON (same format as mapFormat.js)
   * @param {function} callback — called with (dataURL) string
   */
  window.generateMapThumbnail = function (mapData, callback) {
    if (!mapData || typeof callback !== 'function') return;

    // If thumbnailPath is set, use it directly
    if (mapData.thumbnailPath) {
      callback(mapData.thumbnailPath);
      return;
    }

    // Check cache
    var cacheKey = mapData.name || 'unnamed';
    if (_cache[cacheKey]) {
      callback(_cache[cacheKey]);
      return;
    }

    try {
      var dataURL = renderThumbnail(mapData);
      _cache[cacheKey] = dataURL;
      callback(dataURL);
    } catch (e) {
      console.warn('mapThumbnail: render failed:', e);
      callback('');
    }
  };

  function parseColor(colorStr) {
    if (!colorStr) return DEFAULT_OBJ_COLOR;
    if (typeof colorStr === 'number') return colorStr;
    if (typeof colorStr === 'string' && colorStr.charAt(0) === '#') {
      return parseInt(colorStr.substring(1), 16) || DEFAULT_OBJ_COLOR;
    }
    return DEFAULT_OBJ_COLOR;
  }

  function renderThumbnail(mapData) {
    var arena = mapData.arena || {};
    var halfW = (arena.width || 60) / 2;
    var halfL = (arena.length || 90) / 2;
    var wallHeight = arena.wallHeight || 3.5;

    // Create offscreen renderer
    var renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false
    });
    renderer.setSize(THUMB_SIZE, THUMB_SIZE);
    renderer.setClearColor(0x222222, 1);

    // Create scene
    var scene = new THREE.Scene();

    // Ambient + directional light for visibility
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // Ground plane
    var groundGeo = new THREE.PlaneGeometry(halfW * 2, halfL * 2);
    var groundMat = new THREE.MeshLambertMaterial({ color: GROUND_COLOR });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Perimeter walls
    var wallMat = new THREE.MeshLambertMaterial({ color: WALL_COLOR });
    addWall(scene, wallMat, 0, wallHeight / 2, -halfL, halfW * 2, wallHeight, 0.5); // front
    addWall(scene, wallMat, 0, wallHeight / 2, halfL, halfW * 2, wallHeight, 0.5);  // back
    addWall(scene, wallMat, -halfW, wallHeight / 2, 0, 0.5, wallHeight, halfL * 2); // left
    addWall(scene, wallMat, halfW, wallHeight / 2, 0, 0.5, wallHeight, halfL * 2);  // right

    // Build map objects
    var objects = mapData.objects || [];
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      if (!obj || !obj.type) continue;
      var mesh = buildObjectMesh(obj, wallHeight);
      if (mesh) {
        scene.add(mesh);
      }
    }

    // Orthographic camera looking straight down
    var aspect = 1;
    var viewSize = Math.max(halfW, halfL) * 1.1; // slight padding
    var cam = new THREE.OrthographicCamera(
      -viewSize * aspect, viewSize * aspect,
      viewSize, -viewSize,
      0.1, 200
    );
    cam.position.set(0, 50, 0);
    cam.lookAt(0, 0, 0);

    // Render
    renderer.render(scene, cam);
    var dataURL = renderer.domElement.toDataURL('image/png');

    // Cleanup
    renderer.dispose();
    disposeScene(scene);

    return dataURL;
  }

  function addWall(scene, mat, x, y, z, sx, sy, sz) {
    var geo = new THREE.BoxGeometry(sx, sy, sz);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }

  function buildObjectMesh(obj, wallHeight) {
    var color = parseColor(obj.color);
    var mat = new THREE.MeshLambertMaterial({ color: color });
    var mesh = null;
    var pos = obj.position || [0, 0];
    var x = pos[0] || 0;
    var z = pos[1] || 0;

    switch (obj.type) {
      case 'box': {
        var s = obj.size || [2, 2, 2];
        var geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, (s[1] || 2) / 2, z);
        break;
      }
      case 'cylinder': {
        var r = obj.radius || 1;
        var h = obj.height || 2;
        var geo = new THREE.CylinderGeometry(r, r, h, 16);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h / 2, z);
        break;
      }
      case 'halfCylinder': {
        var r = obj.radius || 1;
        var h = obj.height || 2;
        var geo = new THREE.CylinderGeometry(r, r, h, 16, 1, false, 0, Math.PI);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, h / 2, z);
        break;
      }
      case 'ramp':
      case 'wedge': {
        var s = obj.size || [2, 2, 4];
        // Simplified: render as a box for the overhead view
        var geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, (s[1] || 2) / 2, z);
        break;
      }
      case 'lshape': {
        var s = obj.size || [4, 2, 4];
        // Simplified: render as a box for overhead view
        var geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, (s[1] || 2) / 2, z);
        break;
      }
      case 'arch': {
        var s = obj.size || [4, 3, 2];
        // Simplified: render as a box for overhead view
        var geo = new THREE.BoxGeometry(s[0], s[1], s[2]);
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, (s[1] || 3) / 2, z);
        break;
      }
      default:
        return null;
    }

    if (mesh && obj.rotation) {
      mesh.rotation.y = (obj.rotation * Math.PI) / 180;
    }

    // Mirror flip
    if (mesh && obj.mirrorFlip) {
      var axis = obj.mirrorAxis || 'z';
      if (axis === 'z') mesh.scale.z *= -1;
      else if (axis === 'x') mesh.scale.x *= -1;
      mat.side = THREE.DoubleSide;
    }

    return mesh;
  }

  function disposeScene(scene) {
    scene.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(function (m) { m.dispose(); });
        } else {
          obj.material.dispose();
        }
      }
    });
  }
})();
