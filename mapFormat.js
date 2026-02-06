// Map format: JSON-based arena builder + server API helpers.
// Shared by game modes and the map editor.

(function () {

  // ── Server API helpers ──

  window.fetchMapList = function () {
    return fetch('/api/maps').then(function (r) {
      if (!r.ok) throw new Error('Failed to fetch map list');
      return r.json();
    });
  };

  window.fetchMapData = function (name) {
    return fetch('/api/maps/' + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error('Map not found');
      return r.json();
    });
  };

  window.saveMapToServer = function (name, mapData) {
    return fetch('/api/maps/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapData)
    }).then(function (r) {
      if (!r.ok) throw new Error('Failed to save map');
      return r.json();
    });
  };

  window.deleteMapFromServer = function (name) {
    return fetch('/api/maps/' + encodeURIComponent(name), { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to delete map');
        return r.json();
      });
  };

  // ── Default map data (transcribed from paintballEnvironment.js) ──

  window.getDefaultMapData = function () {
    var objects = [];
    var id = 0;
    var coverPalette = ['#6B5B4F', '#5A5A5A', '#7A6A55', '#4A4A4A', '#5C4A3A'];
    var ci = 0;

    function nextColor() { return coverPalette[ci++ % coverPalette.length]; }

    function addBox(x, z, sx, sy, sz) {
      objects.push({ id: 'obj_' + (++id), type: 'box', position: [x, 0, z], size: [sx, sy, sz], rotation: 0, color: nextColor() });
    }
    function mirroredBox(x, z, sx, sy, sz) {
      addBox(x, z, sx, sy, sz);
      if (Math.abs(z) > 0.5) addBox(x, -z, sx, sy, sz);
    }

    // ZONE A: CENTER
    addBox(-3, 0, 2.5, 3.5, 2.0);
    addBox(3, 0, 2.5, 3.5, 2.0);
    addBox(-7, 0, 1.5, 3.0, 4.0);
    addBox(-5, 3, 3.0, 3.0, 1.5);
    addBox(7, 0, 1.5, 3.0, 4.0);
    addBox(5, -3, 3.0, 3.0, 1.5);
    mirroredBox(-14, 4, 2.0, 2.5, 2.0);
    mirroredBox(14, 4, 2.0, 2.5, 2.0);
    mirroredBox(-26, 3, 2.5, 2.0, 2.0);
    mirroredBox(26, 3, 2.5, 2.0, 2.0);

    // ZONE B: MID-FIELD
    mirroredBox(-10, 10, 4.0, 3.0, 2.0);
    mirroredBox(-13, 13, 2.0, 2.5, 1.5);
    mirroredBox(10, 9, 2.5, 3.5, 2.5);
    mirroredBox(14, 9, 1.5, 2.0, 1.5);
    mirroredBox(0, 10, 3.0, 3.5, 1.5);
    mirroredBox(-27, 11, 2.5, 2.5, 3.0);
    mirroredBox(27, 11, 2.5, 2.5, 3.0);
    mirroredBox(-9, 16, 5.0, 3.0, 1.5);
    mirroredBox(6, 15, 2.5, 3.5, 1.5);
    mirroredBox(10, 18, 2.0, 2.5, 1.5);
    mirroredBox(-24, 16, 3.0, 2.5, 2.0);
    mirroredBox(-21, 13, 1.5, 1.8, 1.5);
    mirroredBox(24, 16, 3.0, 2.5, 2.0);
    mirroredBox(21, 13, 1.5, 1.8, 1.5);

    // ZONE C: CORRIDOR
    mirroredBox(-4, 23, 2.5, 3.0, 2.0);
    mirroredBox(4, 27, 2.5, 3.0, 2.0);
    mirroredBox(-18, 23, 3.5, 3.0, 1.5);
    mirroredBox(18, 23, 3.5, 3.0, 1.5);
    mirroredBox(-15, 27, 3.0, 2.5, 2.0);
    mirroredBox(15, 27, 3.0, 2.5, 2.0);
    mirroredBox(-28, 25, 2.0, 2.5, 2.5);
    mirroredBox(28, 25, 2.0, 2.5, 2.5);
    mirroredBox(-12, 26, 1.5, 2.5, 1.5);
    mirroredBox(12, 26, 1.5, 2.5, 1.5);

    // ZONE D: SPAWN APPROACH
    mirroredBox(0, 33, 8.0, 3.5, 2.0);
    mirroredBox(-13, 34, 4.0, 3.0, 2.0);
    mirroredBox(13, 34, 4.0, 3.0, 2.0);
    mirroredBox(-24, 36, 3.0, 2.5, 1.5);
    mirroredBox(24, 36, 3.0, 2.5, 1.5);
    mirroredBox(-7, 37, 2.0, 2.0, 1.5);
    mirroredBox(7, 37, 2.0, 2.0, 1.5);

    return {
      name: 'Default Arena',
      version: 1,
      arena: { width: 60, length: 90, wallHeight: 3.5 },
      spawns: { A: [0, 0, -37], B: [0, 0, 37] },
      objects: objects
    };
  };

  // ── Mirror pair ID helper ──

  window.recalcNextMirrorPairId = function (mapData) {
    var max = 0;
    var objs = mapData.objects || [];
    for (var i = 0; i < objs.length; i++) {
      var mp = objs[i].mirrorPairId;
      if (mp) {
        var num = parseInt(mp.replace('mp_', ''), 10);
        if (num > max) max = num;
      }
    }
    return max + 1;
  };

  // ── Build arena from map data ──

  window.buildArenaFromMap = function (mapData) {
    var group = new THREE.Group();
    group.name = 'PaintballArena';
    var solids = [];
    var colliders = [];
    var waypoints = [];

    var aw = mapData.arena.width || 60;
    var al = mapData.arena.length || 90;
    var wallHeight = mapData.arena.wallHeight || 3.5;
    var halfW = aw / 2;
    var halfL = al / 2;

    var wallMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
    var ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });

    function addSolidBox(x, y, z, sx, sy, sz, mat) {
      var geom = new THREE.BoxGeometry(sx, sy, sz);
      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
      solids.push(mesh);
      colliders.push(new THREE.Box3().setFromObject(mesh));
      return mesh;
    }

    // Perimeter walls
    addSolidBox(0, wallHeight / 2 - 1, -halfL, halfW * 2, wallHeight, 0.5, wallMat);
    addSolidBox(0, wallHeight / 2 - 1,  halfL, halfW * 2, wallHeight, 0.5, wallMat);
    addSolidBox(-halfW, wallHeight / 2 - 1, 0, 0.5, wallHeight, halfL * 2, wallMat);
    addSolidBox( halfW, wallHeight / 2 - 1, 0, 0.5, wallHeight, halfL * 2, wallMat);

    // Build objects from map data
    var objs = mapData.objects || [];
    for (var i = 0; i < objs.length; i++) {
      var obj = objs[i];
      var mat = new THREE.MeshLambertMaterial({ color: obj.color || '#6B5B4F' });
      var mesh = null;
      var rotY = (obj.rotation || 0) * Math.PI / 180;

      var yOff = obj.position[1] || 0;
      if (obj.type === 'box') {
        var sx = obj.size[0], sy = obj.size[1], sz = obj.size[2];
        var geom = new THREE.BoxGeometry(sx, sy, sz);
        mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(obj.position[0], -1 + sy / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'cylinder') {
        var r = obj.radius || 1.5, h = obj.height || 3.0;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
        mesh.position.set(obj.position[0], -1 + h / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'halfCylinder') {
        var r2 = obj.radius || 2.0, h2 = obj.height || 3.0;
        var halfMat = new THREE.MeshLambertMaterial({ color: obj.color || '#7A6A55', side: THREE.DoubleSide });
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, h2, 24, 1, false, 0, Math.PI), halfMat);
        mesh.position.set(obj.position[0], -1 + h2 / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'ramp') {
        var rsx = obj.size[0], rsy = obj.size[1], rsz = obj.size[2];
        var shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(rsz, 0);
        shape.lineTo(0, rsy);
        shape.closePath();
        var extrudeSettings = { depth: rsx, bevelEnabled: false };
        var extGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        mesh = new THREE.Mesh(extGeom, mat);
        mesh.position.set(obj.position[0] - rsx / 2, -1 + yOff, obj.position[2] - rsz / 2);
      }

      if (mesh) {
        if (rotY !== 0) mesh.rotation.y = rotY;
        // Apply mirror geometry flip for linked pairs
        if (obj.mirrorFlip && obj.mirrorAxis) {
          if (obj.mirrorAxis === 'z') mesh.scale.z = -1;
          else if (obj.mirrorAxis === 'x') mesh.scale.x = -1;
          mesh.material.side = THREE.DoubleSide;
        }
        mesh.userData.mapObj = obj;
        group.add(mesh);
        solids.push(mesh);
        colliders.push(new THREE.Box3().setFromObject(mesh));
      }
    }

    // Spawns
    var spawnA = new THREE.Vector3(
      mapData.spawns.A[0], mapData.spawns.A[1], mapData.spawns.A[2]
    );
    var spawnB = new THREE.Vector3(
      mapData.spawns.B[0], mapData.spawns.B[1], mapData.spawns.B[2]
    );

    // Gold spawn rings
    function addGoldSpawnRing(pos) {
      var ring = new THREE.RingGeometry(0.8, 1.2, 64);
      var ringMesh = new THREE.Mesh(ring, ringMat);
      ringMesh.position.set(pos.x, -0.99, pos.z);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.renderOrder = 1;
      group.add(ringMesh);
    }
    addGoldSpawnRing(spawnA);
    addGoldSpawnRing(spawnB);

    // Auto-generate waypoints: grid ~10-unit spacing, filter inside colliders
    var wpSpacing = 10;
    for (var wx = -halfW + wpSpacing; wx < halfW; wx += wpSpacing) {
      for (var wz = -halfL + wpSpacing; wz < halfL; wz += wpSpacing) {
        var wp = new THREE.Vector3(wx, 0, wz);
        var inside = false;
        for (var c = 0; c < colliders.length; c++) {
          if (colliders[c].containsPoint(wp)) { inside = true; break; }
        }
        if (!inside) waypoints.push(wp);
      }
    }

    // Scenery trees outside arena
    var trunkMat = new THREE.MeshLambertMaterial({ color: 0x5C4033 });
    var canopyMat = new THREE.MeshLambertMaterial({ color: 0x2E5930 });
    var canopyDarkMat = new THREE.MeshLambertMaterial({ color: 0x1E3E22 });

    function addTree(x, z, scale) {
      scale = scale || 1;
      var trunkH = 3 * scale;
      var trunkR = 0.3 * scale;
      var canopyH = 4 * scale;
      var canopyR = 2 * scale;
      var tmat = (scale > 1.1) ? canopyDarkMat : canopyMat;
      var trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8), trunkMat
      );
      trunk.position.set(x, -1 + trunkH / 2, z);
      group.add(trunk);
      var canopy = new THREE.Mesh(new THREE.ConeGeometry(canopyR, canopyH, 8), tmat);
      canopy.position.set(x, -1 + trunkH + canopyH / 2, z);
      group.add(canopy);
    }

    var trees = [
      [36, -30, 1.2], [39, -12, 0.9], [35, 5, 1.1], [40, 20, 1.0], [37, 35, 0.8],
      [42, -20, 0.7], [38, 40, 1.3],
      [-36, -25, 1.0], [-40, -5, 1.3], [-35, 15, 0.9], [-38, 30, 1.1], [-37, -40, 0.8],
      [-42, 10, 0.7], [-36, 42, 1.2],
      [-20, 50, 1.1], [-5, 52, 0.9], [10, 50, 1.2], [25, 52, 1.0], [0, 55, 0.8],
      [-15, -50, 1.0], [0, -52, 1.2], [20, -50, 0.8], [-25, -52, 1.1], [8, -55, 0.9],
      [45, 45, 1.4], [-45, 45, 1.3], [45, -45, 1.0], [-45, -45, 1.1],
      [50, 0, 1.4], [-50, 10, 1.3],
    ];
    // Scale tree positions proportionally if arena size differs from default
    var scaleX = halfW / 30;
    var scaleZ = halfL / 45;
    trees.forEach(function (t) {
      addTree(t[0] * scaleX, t[1] * scaleZ, t[2]);
    });

    scene.add(group);

    return {
      group: group,
      colliders: colliders,
      solids: solids,
      waypoints: waypoints,
      spawns: { A: spawnA, B: spawnB }
    };
  };

})();
