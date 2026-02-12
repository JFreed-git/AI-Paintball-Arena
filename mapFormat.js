/**
 * mapFormat.js — Map data serialization and arena construction from map data
 *
 * PURPOSE: Defines the JSON map format, builds arenas from map data objects,
 * provides the default map, and handles server API calls for saving/loading maps.
 * Shared by game modes (modeFFA, modeTraining) and the map editor.
 *
 * EXPORTS (window):
 *   buildArenaFromMap(mapData) — construct a playable arena from map JSON
 *   getDefaultMapData()        — returns the built-in default map
 *   saveMapToServer(name, mapData) — POST map to server
 *   deleteMapFromServer(name)      — DELETE map from server
 *   fetchMapList()                 — GET map list from server
 *   fetchMapData(name)             — GET map from server
 *   recalcNextMirrorPairId(mapData) — recompute mirror pair IDs
 *   normalizeSpawns(spawns)          — convert any spawn format to per-mode object
 *   getMapSpawnsForMode(mapData, mode) — get spawn array for a given mode
 *   getMapMaxPlayers(mapData, mode)  — max player count (optionally per-mode)
 *   computeColliderForMesh(mesh)    — compute Box3 collider(s) for a mesh
 *
 * DEPENDENCIES: Three.js, game.js (scene global), physics.js (GROUND_Y)
 *
 * TODO (future):
 *   - Map validation (ensure spawns exist, arena is enclosed, etc.)
 *   - Map versioning (handle format changes gracefully)
 *   - Standalone map editor app (instead of in-game editor)
 *   - Map thumbnail generation for selection UI
 */

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

  // ── Default map data (transcribed from arenaCompetitive.js) ──

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
      spawns: {
        ffa: [
          { id: 'spawn_1', position: [0, 0, -37], team: 0 },
          { id: 'spawn_2', position: [0, 0, 37], team: 0 }
        ]
      },
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

  // ── Normalize spawns to per-mode object format ──
  // Returns: { ffa: [{id, position, team}], tdm: [...], ... }
  // team is an integer: 0 = no team (any player), 1/2/3/4 = team-specific
  // Handles three input formats:
  //   1. Array (current format): wrap as { ffa: [...] }, convert team letters to numbers
  //   2. Object with mode keys (new format): return as-is
  //   3. Ancient {A:[x,y,z], B:[x,y,z]} format: convert to { ffa: [...] }

  var _letterToTeam = { A: 1, B: 2, C: 3, D: 4 };

  function _convertTeamToNumber(team) {
    if (typeof team === 'number') return team;
    if (typeof team === 'string' && _letterToTeam[team]) return _letterToTeam[team];
    return 0;
  }

  window.normalizeSpawns = function (spawns) {
    if (!spawns) return { ffa: [] };

    // Case 1: Array (current format) — convert team letters to numbers, wrap as { ffa: [...] }
    if (Array.isArray(spawns)) {
      var converted = [];
      for (var i = 0; i < spawns.length; i++) {
        var sp = spawns[i];
        converted.push({ id: sp.id, position: sp.position, team: _convertTeamToNumber(sp.team) });
      }
      return { ffa: converted };
    }

    // Object — check if new per-mode format or ancient {A:pos, B:pos}
    var keys = Object.keys(spawns);
    if (keys.length === 0) return { ffa: [] };

    // Ancient format: keys are single uppercase letters (A, B, C, D)
    if (/^[A-Z]$/.test(keys[0])) {
      var arr = [];
      var id = 1;
      for (var k = 0; k < keys.length; k++) {
        arr.push({
          id: 'spawn_' + id++,
          position: spawns[keys[k]].slice(),
          team: _letterToTeam[keys[k]] || 0
        });
      }
      return { ffa: arr };
    }

    // Case 2: New per-mode format — return as-is
    return spawns;
  };

  // supportedModes can be derived from Object.keys(normalizeSpawns(mapData.spawns))

  window.getMapMaxPlayers = function (mapData, mode) {
    if (!mapData) return 2;
    var spawnsByMode = window.normalizeSpawns(mapData.spawns);
    if (mode) {
      var modeSpawns = spawnsByMode[mode] || spawnsByMode.ffa || [];
      return Math.max(2, modeSpawns.length);
    }
    // No mode: fall back to maxPlayers if set, otherwise max across all modes
    if (mapData.maxPlayers) return mapData.maxPlayers;
    var max = 0;
    var modes = Object.keys(spawnsByMode);
    for (var m = 0; m < modes.length; m++) {
      var count = spawnsByMode[modes[m]].length;
      if (count > max) max = count;
    }
    return Math.max(2, max);
  };

  window.getMapSpawnsForMode = function (mapData, mode) {
    if (!mapData || !mapData.spawns) return [];
    var spawnsByMode = window.normalizeSpawns(mapData.spawns);
    if (spawnsByMode[mode]) return spawnsByMode[mode];
    if (spawnsByMode.ffa) return spawnsByMode.ffa;
    // Fall back to first available mode
    var keys = Object.keys(spawnsByMode);
    if (keys.length > 0) return spawnsByMode[keys[0]];
    return [];
  };

  // ── Compute colliders for a mesh ──
  // Returns an ARRAY of Box3 colliders.
  // Ramps get staircase colliders (approximating the triangular cross-section)
  // plus a thin tall-wall collider. Other types get a single standard AABB.
  //
  // The staircase works with resolveCollisions2D's Y-skip logic:
  //   if (feetY + 0.1 >= box.max.y) continue;
  // Each step's max.y = slope height at its lower edge, so when the player
  // walks up the slope (feetY at slope surface), lower steps are skipped.
  // Approaching from the side at ground level, the steps still block.

  window.computeColliderForMesh = function (mesh) {
    var obj = mesh.userData.mapObj;
    if (!obj) {
      return [new THREE.Box3().setFromObject(mesh)];
    }

    // --- Ramp & Wedge: staircase approximation ---
    // Both use the same right-triangle ExtrudeGeometry. Staircase steps allow
    // walking up the slope (Y-skip logic in resolveCollisions2D).
    if (obj.type === 'ramp' || obj.type === 'wedge') {
      var rsx = obj.size[0], rsy = obj.size[1], rsz = obj.size[2];
      var result = [];
      var N = 5;

      for (var i = 0; i < N; i++) {
        var stepHeight = rsy * (N - i - 1) / N;
        if (stepHeight < 0.05) continue;
        var stepDepth = rsz / N;
        var stepGeom = new THREE.BoxGeometry(stepDepth, stepHeight, rsx);
        var helper = new THREE.Mesh(stepGeom);
        helper.position.set(
          -rsz / 2 + rsz * i / N + stepDepth / 2,
          stepHeight / 2,
          0
        );
        mesh.add(helper);
        mesh.updateMatrixWorld(true);
        result.push(new THREE.Box3().setFromObject(helper));
        mesh.remove(helper);
        stepGeom.dispose();
      }

      var wallGeom = new THREE.BoxGeometry(0.3, rsy, rsx);
      var wallHelper = new THREE.Mesh(wallGeom);
      wallHelper.position.set(-rsz / 2, rsy / 2, 0);
      mesh.add(wallHelper);
      mesh.updateMatrixWorld(true);
      result.push(new THREE.Box3().setFromObject(wallHelper));
      mesh.remove(wallHelper);
      wallGeom.dispose();

      return result;
    }

    // --- L-Shape: 2 AABBs for the two legs ---
    // The L cross-section after centering and rotateX(-PI/2) has:
    //   Bottom horizontal leg: full width (lw), thickness (lt) in Z, at Z=ld/2-lt/2
    //   Left vertical leg: thickness (lt) in X, remaining depth (ld-lt) in Z, at X=-lw/2+lt/2
    if (obj.type === 'lshape') {
      var lw = obj.size[0], lh = obj.size[1], ld = obj.size[2];
      var lt = obj.thickness || 1.0;
      var result = [];

      // Bottom horizontal leg
      var leg1Geom = new THREE.BoxGeometry(lw, lh, lt);
      var leg1 = new THREE.Mesh(leg1Geom);
      leg1.position.set(0, lh / 2, ld / 2 - lt / 2);
      mesh.add(leg1);
      mesh.updateMatrixWorld(true);
      result.push(new THREE.Box3().setFromObject(leg1));
      mesh.remove(leg1);
      leg1Geom.dispose();

      // Left vertical leg
      var leg2Geom = new THREE.BoxGeometry(lt, lh, ld - lt);
      var leg2 = new THREE.Mesh(leg2Geom);
      leg2.position.set(-lw / 2 + lt / 2, lh / 2, -lt / 2);
      mesh.add(leg2);
      mesh.updateMatrixWorld(true);
      result.push(new THREE.Box3().setFromObject(leg2));
      mesh.remove(leg2);
      leg2Geom.dispose();

      return result;
    }

    // --- Arch: 3 AABBs (2 pillars + top lintel) ---
    // Opening is 60% width, 65% height. Pillars are full-height on the sides,
    // lintel spans the opening width above the opening height.
    if (obj.type === 'arch') {
      var aw = obj.size[0], ah = obj.size[1], ad = obj.size[2];
      var openW = aw * 0.6;
      var openH = ah * 0.65;
      var pillarW = (aw - openW) / 2;
      var result = [];

      // Left pillar (full height)
      var lpGeom = new THREE.BoxGeometry(pillarW, ah, ad);
      var leftPillar = new THREE.Mesh(lpGeom);
      leftPillar.position.set(-aw / 2 + pillarW / 2, ah / 2, 0);
      mesh.add(leftPillar);
      mesh.updateMatrixWorld(true);
      result.push(new THREE.Box3().setFromObject(leftPillar));
      mesh.remove(leftPillar);
      lpGeom.dispose();

      // Right pillar (full height)
      var rpGeom = new THREE.BoxGeometry(pillarW, ah, ad);
      var rightPillar = new THREE.Mesh(rpGeom);
      rightPillar.position.set(aw / 2 - pillarW / 2, ah / 2, 0);
      mesh.add(rightPillar);
      mesh.updateMatrixWorld(true);
      result.push(new THREE.Box3().setFromObject(rightPillar));
      mesh.remove(rightPillar);
      rpGeom.dispose();

      // Top lintel (above opening, between pillars)
      var lintelH = ah - openH;
      if (lintelH > 0.05) {
        var ltGeom = new THREE.BoxGeometry(openW, lintelH, ad);
        var lintel = new THREE.Mesh(ltGeom);
        lintel.position.set(0, openH + lintelH / 2, 0);
        mesh.add(lintel);
        mesh.updateMatrixWorld(true);
        result.push(new THREE.Box3().setFromObject(lintel));
        mesh.remove(lintel);
        ltGeom.dispose();
      }

      return result;
    }

    // Default: single AABB
    return [new THREE.Box3().setFromObject(mesh)];
  };

  // ── Build arena from map data ──

  window.buildArenaFromMap = function (mapData, mode) {
    mode = mode || 'ffa';
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

    function addSolidBox(x, y, z, sx, sy, sz, mat) {
      var geom = new THREE.BoxGeometry(sx, sy, sz);
      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
      solids.push(mesh);
      colliders.push(new THREE.Box3().setFromObject(mesh));
      return mesh;
    }

    // Floor mesh for ground-height raycasting (surface at Y = -1, not a collider)
    var floorGeom = new THREE.PlaneGeometry(halfW * 2 + 10, halfL * 2 + 10);
    var floorMesh = new THREE.Mesh(floorGeom, new THREE.MeshBasicMaterial({ visible: false }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = GROUND_Y;
    group.add(floorMesh);
    solids.push(floorMesh);

    // Perimeter walls
    addSolidBox(0, wallHeight / 2 + GROUND_Y, -halfL, halfW * 2, wallHeight, 0.5, wallMat);
    addSolidBox(0, wallHeight / 2 + GROUND_Y,  halfL, halfW * 2, wallHeight, 0.5, wallMat);
    addSolidBox(-halfW, wallHeight / 2 + GROUND_Y, 0, 0.5, wallHeight, halfL * 2, wallMat);
    addSolidBox( halfW, wallHeight / 2 + GROUND_Y, 0, 0.5, wallHeight, halfL * 2, wallMat);

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
        mesh.position.set(obj.position[0], GROUND_Y + sy / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'cylinder') {
        var r = obj.radius || 1.5, h = obj.height || 3.0;
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
        mesh.position.set(obj.position[0], GROUND_Y + h / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'halfCylinder') {
        var r2 = obj.radius || 2.0, h2 = obj.height || 3.0;
        var halfMat = new THREE.MeshLambertMaterial({ color: obj.color || '#7A6A55', side: THREE.DoubleSide });
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, h2, 24, 1, false, 0, Math.PI), halfMat);
        mesh.position.set(obj.position[0], GROUND_Y + h2 / 2 + yOff, obj.position[2]);
      } else if (obj.type === 'ramp' || obj.type === 'wedge') {
        var rsx = obj.size[0], rsy = obj.size[1], rsz = obj.size[2];
        var shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(rsz, 0);
        shape.lineTo(0, rsy);
        shape.closePath();
        var extrudeSettings = { depth: rsx, bevelEnabled: false };
        var extGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        extGeom.translate(-rsz / 2, 0, -rsx / 2);
        mesh = new THREE.Mesh(extGeom, mat);
        mesh.position.set(obj.position[0], GROUND_Y + yOff, obj.position[2]);
      } else if (obj.type === 'lshape') {
        var lw = obj.size[0], lh = obj.size[1], ld = obj.size[2];
        var lt = obj.thickness || 1.0;
        var lShape = new THREE.Shape();
        lShape.moveTo(-lw / 2, -ld / 2);
        lShape.lineTo(lw / 2, -ld / 2);
        lShape.lineTo(lw / 2, -ld / 2 + lt);
        lShape.lineTo(-lw / 2 + lt, -ld / 2 + lt);
        lShape.lineTo(-lw / 2 + lt, ld / 2);
        lShape.lineTo(-lw / 2, ld / 2);
        lShape.closePath();
        var lGeom = new THREE.ExtrudeGeometry(lShape, { depth: lh, bevelEnabled: false });
        lGeom.rotateX(-Math.PI / 2);
        mesh = new THREE.Mesh(lGeom, mat);
        mesh.position.set(obj.position[0], GROUND_Y + yOff, obj.position[2]);
      } else if (obj.type === 'arch') {
        var aw2 = obj.size[0], ah2 = obj.size[1], ad2 = obj.size[2];
        var openW = aw2 * 0.6;
        var openH = ah2 * 0.65;
        var archShape = new THREE.Shape();
        archShape.moveTo(-aw2 / 2, 0);
        archShape.lineTo(aw2 / 2, 0);
        archShape.lineTo(aw2 / 2, ah2);
        archShape.lineTo(-aw2 / 2, ah2);
        archShape.closePath();
        var hole = new THREE.Path();
        var holeHW = openW / 2;
        var rectH = openH - holeHW;
        if (rectH < 0) rectH = 0;
        hole.moveTo(-holeHW, 0);
        hole.lineTo(-holeHW, rectH);
        hole.absarc(0, rectH, holeHW, Math.PI, 0, true);
        hole.lineTo(holeHW, 0);
        hole.closePath();
        archShape.holes.push(hole);
        var archGeom = new THREE.ExtrudeGeometry(archShape, { depth: ad2, bevelEnabled: false });
        archGeom.translate(0, 0, -ad2 / 2);
        mesh = new THREE.Mesh(archGeom, new THREE.MeshLambertMaterial({ color: obj.color || '#7A6A55', side: THREE.DoubleSide }));
        mesh.position.set(obj.position[0], GROUND_Y + yOff, obj.position[2]);
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
        var meshColliders = window.computeColliderForMesh(mesh);
        mesh.userData.colliderBoxes = meshColliders;
        for (var ci = 0; ci < meshColliders.length; ci++) colliders.push(meshColliders[ci]);
      }
    }

    // Spawns — normalize to per-mode object, get spawns for the active mode
    var spawnsByMode = window.normalizeSpawns(mapData.spawns);
    var spawnsList = window.getMapSpawnsForMode(mapData, mode);

    // Find first two spawns for backward compatibility (spawnA/spawnB used by game modes)
    var spawnA = new THREE.Vector3(0, 0, -10);
    var spawnB = new THREE.Vector3(0, 0, 10);
    for (var si = 0; si < spawnsList.length; si++) {
      var sp = spawnsList[si];
      if (sp.team === 1 || (si === 0 && spawnA.z === -10)) {
        spawnA.set(sp.position[0], sp.position[1] || 0, sp.position[2]);
      } else if (sp.team === 2 || (si === 1 && spawnB.z === 10)) {
        spawnB.set(sp.position[0], sp.position[1] || 0, sp.position[2]);
      }
    }

    // Color-coded spawn rings (gold=teamless, red=team1, blue=team2, green=team3, orange=team4)
    var spawnTeamColors = { 1: 0xff4444, 2: 0x4488ff, 3: 0x44ff44, 4: 0xff8844 };
    for (var si2 = 0; si2 < spawnsList.length; si2++) {
      var sp2 = spawnsList[si2];
      var spColor = spawnTeamColors[sp2.team] || 0xffd700;
      var spRingMat = new THREE.MeshBasicMaterial({ color: spColor, side: THREE.DoubleSide });
      var ring = new THREE.RingGeometry(0.8, 1.2, 64);
      var spRingMesh = new THREE.Mesh(ring, spRingMat);
      spRingMesh.position.set(sp2.position[0], -0.99, sp2.position[2]);
      spRingMesh.rotation.x = -Math.PI / 2;
      spRingMesh.renderOrder = 1;
      spRingMesh.userData.isSpawnRing = true;
      group.add(spRingMesh);
    }

    // Auto-generate waypoints: grid ~7-unit spacing, Y-aware via raycast
    var wpSpacing = 7;
    var wpRaycaster = new THREE.Raycaster();
    for (var wx = -halfW + wpSpacing; wx < halfW; wx += wpSpacing) {
      for (var wz = -halfL + wpSpacing; wz < halfL; wz += wpSpacing) {
        var wp = new THREE.Vector3(wx, 0, wz);
        var inside = false;
        for (var c = 0; c < colliders.length; c++) {
          if (colliders[c].containsPoint(wp)) { inside = true; break; }
        }
        if (!inside) {
          // Raycast down to find actual ground height
          wpRaycaster.set(new THREE.Vector3(wx, 20, wz), new THREE.Vector3(0, -1, 0));
          wpRaycaster.far = 40;
          var wpHits = wpRaycaster.intersectObjects(solids, true);
          var groundY = GROUND_Y;
          for (var h = 0; h < wpHits.length; h++) {
            if (wpHits[h].point.y > groundY) groundY = wpHits[h].point.y;
          }
          // Filter out waypoints with no ground (groundY stayed at extreme low)
          if (groundY >= GROUND_Y - 0.5) {
            wp.y = groundY;
            waypoints.push(wp);
          }
        }
      }
    }

    // Add spawn-adjacent waypoints for immediate pathing out of spawn
    var spawnOffsets = [
      new THREE.Vector3(3, 0, 0), new THREE.Vector3(-3, 0, 0),
      new THREE.Vector3(0, 0, 3), new THREE.Vector3(0, 0, -3)
    ];
    var spawnPositions = [spawnA, spawnB];
    for (var spi = 0; spi < spawnPositions.length; spi++) {
      for (var oi = 0; oi < spawnOffsets.length; oi++) {
        var swp = spawnPositions[spi].clone().add(spawnOffsets[oi]);
        var sInside = false;
        for (var c = 0; c < colliders.length; c++) {
          if (colliders[c].containsPoint(swp)) { sInside = true; break; }
        }
        if (!sInside && Math.abs(swp.x) < halfW && Math.abs(swp.z) < halfL) {
          wpRaycaster.set(new THREE.Vector3(swp.x, 20, swp.z), new THREE.Vector3(0, -1, 0));
          wpRaycaster.far = 40;
          var sHits = wpRaycaster.intersectObjects(solids, true);
          var sGroundY = GROUND_Y;
          for (var h = 0; h < sHits.length; h++) {
            if (sHits[h].point.y > sGroundY) sGroundY = sHits[h].point.y;
          }
          swp.y = sGroundY;
          waypoints.push(swp);
        }
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
      trunk.position.set(x, GROUND_Y + trunkH / 2, z);
      group.add(trunk);
      var canopy = new THREE.Mesh(new THREE.ConeGeometry(canopyR, canopyH, 8), tmat);
      canopy.position.set(x, GROUND_Y + trunkH + canopyH / 2, z);
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

    // Ensure all world matrices are up-to-date so raycasts (LOS, hitscans)
    // against these solids work correctly before the first render pass.
    group.updateMatrixWorld(true);

    return {
      group: group,
      colliders: colliders,
      solids: solids,
      waypoints: waypoints,
      spawns: { A: spawnA, B: spawnB },
      spawnsList: spawnsList,
      spawnsByMode: spawnsByMode,
      spawnMode: mode
    };
  };

})();
