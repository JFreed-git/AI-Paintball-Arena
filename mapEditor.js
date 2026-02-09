/**
 * mapEditor.js — In-game 3D map editor
 *
 * PURPOSE: Spectator-mode editor for creating and modifying arena layouts. Allows
 * placing cover blocks, ramps, spawn points, and waypoints. Gated behind the dev
 * console password. Maps are saved/loaded via server API (mapFormat.js).
 *
 * EXPORTS (window):
 *   editorActive — boolean flag
 *   (Various editor functions exposed on window for devConsole.js integration)
 *
 * DEPENDENCIES: Three.js, mapFormat.js, devConsole.js (authentication gate)
 *
 * DESIGN NOTES:
 *   - Currently runs as an in-game overlay. The long-term plan is to extract this
 *     into a standalone app so only the developer can edit and upload maps.
 *   - Uses free-camera controls (WASD + mouse) separate from game input.
 *
 * TODO (future):
 *   - Extract to standalone app (separate from game client)
 *   - Copy/paste/mirror selection
 *   - Snap-to-grid with configurable grid size
 *   - Prop placement (barrels, crates, scenery)
 *   - Lighting placement and preview
 *   - Map testing mode (play the map without reloading)
 *   - Export to file (download JSON) instead of only server save
 */

(function () {
  var editorActive = false;
  var editorScene, editorCamera, editorRenderer;
  var mapData = null;
  var editorObjects = []; // { mesh, data (ref into mapData.objects) }
  var selectedObj = null;
  var boxHelper = null;
  var spawnMeshes = { A: null, B: null };
  var selectedSpawn = null; // 'A' or 'B' if a spawn is selected
  var currentTool = 'select';
  var arena = null; // result from buildArenaFromMap

  // Mirror symmetry: 'off', 'z', 'x'
  var mirrorMode = 'z';
  var mirrorLine = null;
  var isDragging = false;
  var dragStart = new THREE.Vector2();
  var dragObjStart = new THREE.Vector3();
  var dragGroundStart = new THREE.Vector3();
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var _nextId = 1;

  // Mirror pair IDs
  var _nextMirrorPairId = 1;

  // Resize handles
  var resizeHandles = []; // { mesh, handleType, signX, signZ }
  var isResizing = false;
  var resizeHandle = null;
  var resizeStartPoint = new THREE.Vector3();
  var resizeStartSize = null;
  var resizeStartRadius = 0;
  var resizeStartHeight = 0;
  var resizePlane = new THREE.Plane();
  var handleCornerMat = new THREE.MeshBasicMaterial({ color: 0xff8800, depthTest: false, transparent: true, opacity: 0.85 });
  var handleTopMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, depthTest: false, transparent: true, opacity: 0.85 });
  var handleCornerGeom = new THREE.BoxGeometry(0.45, 0.45, 0.45);
  var handleTopGeom = new THREE.SphereGeometry(0.3, 12, 8);

  // Fly camera state
  var flyMode = false;
  var flyYaw = 0;
  var flyPitch = -0.3;
  var flyKeys = { w: false, a: false, s: false, d: false, space: false, shift: false };
  var flySpeed = 0.4;

  // Player walk mode
  var playerMode = false;
  var savedSpectatorPos = null;
  var savedSpectatorYaw = 0;
  var savedSpectatorPitch = 0;
  var playerYaw = 0;
  var playerPitch = 0;
  var playerKeys = { w: false, a: false, s: false, d: false, shift: false };
  var playerPos = new THREE.Vector3();

  // Undo/redo
  var undoStack = [];
  var redoStack = [];
  var MAX_UNDO = 50;

  // UI refs
  var editorUI, toolbar, propsPanel, settingsPanel, loadPanel, statusBar;
  var toolLabel, objCount;

  function getUI() {
    editorUI = document.getElementById('editorUI');
    toolbar = document.getElementById('editorToolbar');
    propsPanel = document.getElementById('editorPropsPanel');
    settingsPanel = document.getElementById('editorSettingsPanel');
    loadPanel = document.getElementById('editorLoadPanel');
    statusBar = document.getElementById('editorStatusBar');
    toolLabel = document.getElementById('editorToolLabel');
    objCount = document.getElementById('editorObjCount');
  }

  function recalcNextId() {
    var maxId = 0;
    for (var i = 0; i < mapData.objects.length; i++) {
      var id = mapData.objects[i].id || '';
      var num = parseInt(id.replace('obj_', ''), 10);
      if (num > maxId) maxId = num;
    }
    _nextId = maxId + 1;
  }

  function recalcNextMirrorPairId() {
    _nextMirrorPairId = window.recalcNextMirrorPairId(mapData);
  }

  function generateMirrorPairId() {
    return 'mp_' + (_nextMirrorPairId++);
  }

  // ── Start / Stop ──

  window.startMapEditor = function () {
    if (!window.devAuthenticated) { alert('Dev access required.'); return; }
    if (editorActive) return;

    // Stop any running game
    if (window.paintballActive && typeof stopPaintballInternal === 'function') stopPaintballInternal();
    if (window.multiplayerActive && typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal();

    getUI();
    editorActive = true;
    window.editorActive = true;
    playerMode = false;
    mapData = getDefaultMapData();
    recalcNextId();
    recalcNextMirrorPairId();

    // Hide game menus, show editor
    showOnlyMenu(null);
    setHUDVisible(false);
    editorUI.classList.remove('hidden');
    propsPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    loadPanel.classList.add('hidden');
    document.getElementById('editorPlayerHint').classList.add('hidden');

    // Use the existing Three.js renderer + scene
    editorScene = scene;
    if (typeof renderer === 'undefined' || !renderer) {
      console.warn('mapEditor: renderer not initialized');
      return;
    }
    editorRenderer = renderer;

    // Clear scene children that are arena groups
    clearSceneArena();

    // Perspective camera starting above Spawn A looking toward center
    var aspect = window.innerWidth / window.innerHeight;
    editorCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 500);
    var spA = mapData.spawns.A;
    editorCamera.position.set(spA[0], 25, spA[2] - 15);
    flyYaw = 0;
    flyPitch = -0.6;
    editorCamera.rotation.order = 'YXZ';
    editorCamera.rotation.set(flyPitch, flyYaw, 0);

    // Set mirror button state
    var btn = document.getElementById('editorMirrorToggle');
    if (btn) {
      btn.textContent = 'Mirror: Z';
      btn.classList.add('mirror-active');
    }

    // Build editor scene
    rebuildEditorScene();
    bindEditorEvents();
    updateStatusBar();

    // Start editor render loop
    editorRenderLoop();
  };

  function stopEditor() {
    if (!editorActive) return;
    if (playerMode) exitPlayerMode();
    editorActive = false;
    window.editorActive = false;
    flyMode = false;

    // Clean up editor objects
    clearEditorScene();

    editorUI.classList.add('hidden');
    propsPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    loadPanel.classList.add('hidden');

    unbindEditorEvents();

    // Restore perspective camera
    if (typeof camera !== 'undefined' && camera) {
      camera.position.set(0, 2, 5);
      camera.rotation.set(0, 0, 0);
    }

    showOnlyMenu('mainMenu');
  }

  // ── Scene building ──

  function clearSceneArena() {
    var toRemove = [];
    editorScene.children.forEach(function (c) {
      if (c.name === 'PaintballArena' || c.name === 'EditorGroup') toRemove.push(c);
    });
    toRemove.forEach(function (c) { editorScene.remove(c); });
  }

  function clearEditorScene() {
    editorObjects = [];
    selectedObj = null;
    selectedSpawn = null;
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = null;
    removeResizeHandles();
    spawnMeshes = { A: null, B: null };
    arena = null;

    clearSceneArena();
    if (mirrorLine && mirrorLine.parent) mirrorLine.parent.remove(mirrorLine);
    mirrorLine = null;
  }

  function rebuildEditorScene() {
    clearEditorScene();

    // Build the full visual arena from map data
    arena = buildArenaFromMap(mapData);

    // Build editorObjects from arena solids that have userData.mapObj
    for (var i = 0; i < arena.solids.length; i++) {
      var mesh = arena.solids[i];
      if (mesh.userData.mapObj) {
        editorObjects.push({ mesh: mesh, data: mesh.userData.mapObj });
      }
    }

    // Mirror axis line
    rebuildMirrorLine();

    // Editor spawn ring meshes (slightly larger, for selection handles)
    var ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });
    function makeSpawnRing(pos) {
      var ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.8, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(pos[0], -0.94, pos[2]);
      ring.name = 'EditorGroup';
      editorScene.add(ring);
      return ring;
    }
    spawnMeshes.A = makeSpawnRing(mapData.spawns.A);
    spawnMeshes.B = makeSpawnRing(mapData.spawns.B);

    updateStatusBar();
  }

  // ── Mirror axis line ──

  function rebuildMirrorLine() {
    if (mirrorLine && mirrorLine.parent) mirrorLine.parent.remove(mirrorLine);
    mirrorLine = null;
    if (mirrorMode === 'off') return;

    var halfW = (mapData.arena.width || 60) / 2;
    var halfL = (mapData.arena.length || 90) / 2;
    var extend = 5;
    var pts;
    if (mirrorMode === 'z') {
      pts = [
        new THREE.Vector3(-halfW - extend, -0.85, 0),
        new THREE.Vector3( halfW + extend, -0.85, 0)
      ];
    } else {
      pts = [
        new THREE.Vector3(0, -0.85, -halfL - extend),
        new THREE.Vector3(0, -0.85,  halfL + extend)
      ];
    }

    var lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    var lineMat = new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 1.5, gapSize: 0.8 });
    mirrorLine = new THREE.Line(lineGeom, lineMat);
    mirrorLine.computeLineDistances();
    mirrorLine.name = 'EditorGroup';
    editorScene.add(mirrorLine);
  }

  function cycleMirrorMode() {
    if (mirrorMode === 'off') mirrorMode = 'z';
    else if (mirrorMode === 'z') mirrorMode = 'x';
    else mirrorMode = 'off';

    var btn = document.getElementById('editorMirrorToggle');
    if (btn) {
      if (mirrorMode === 'off') {
        btn.textContent = 'Mirror: Off';
        btn.classList.remove('mirror-active');
      } else if (mirrorMode === 'z') {
        btn.textContent = 'Mirror: Z';
        btn.classList.add('mirror-active');
      } else {
        btn.textContent = 'Mirror: X';
        btn.classList.add('mirror-active');
      }
    }
    rebuildMirrorLine();
    updateStatusBar();
  }

  // ── Mirror pair helpers ──

  function findMirrorPartner(objData) {
    if (!objData.mirrorPairId) return null;
    var objs = mapData.objects;
    for (var i = 0; i < objs.length; i++) {
      if (objs[i] !== objData && objs[i].mirrorPairId === objData.mirrorPairId) return objs[i];
    }
    return null;
  }

  function findMirrorPartnerEntry(objData) {
    if (!objData.mirrorPairId) return null;
    for (var i = 0; i < editorObjects.length; i++) {
      if (editorObjects[i].data !== objData && editorObjects[i].data.mirrorPairId === objData.mirrorPairId) {
        return editorObjects[i];
      }
    }
    return null;
  }

  function mirrorRotation(rotation, axis) {
    var rot = rotation || 0;
    if (axis === 'z') {
      // Reflecting across z=0: negate the Y-rotation
      return (360 - rot) % 360;
    } else if (axis === 'x') {
      // Reflecting across x=0: supplement the Y-rotation (180 - rot)
      return (540 - rot) % 360;
    }
    return rot;
  }

  function syncMirrorPartner(srcData) {
    var partner = findMirrorPartner(srcData);
    if (!partner) return;
    var axis = srcData.mirrorAxis || 'z';

    partner.type = srcData.type;
    partner.color = srcData.color;
    if (srcData.size) partner.size = srcData.size.slice();
    if (srcData.radius !== undefined) partner.radius = srcData.radius;
    if (srcData.height !== undefined) partner.height = srcData.height;

    // Mirror position (copy Y as-is), mirror rotation based on axis, toggle geometry flip
    partner.position = srcData.position.slice();
    if (axis === 'z') {
      partner.position[2] = -srcData.position[2];
    } else if (axis === 'x') {
      partner.position[0] = -srcData.position[0];
    }
    partner.rotation = mirrorRotation(srcData.rotation, axis);
    partner.mirrorFlip = !srcData.mirrorFlip;

    var partnerEntry = findMirrorPartnerEntry(srcData);
    if (partnerEntry) {
      rebuildSingleObject(partnerEntry);
    }
  }

  function mirrorObjData(srcData, axis) {
    var obj = JSON.parse(JSON.stringify(srcData));
    obj.id = 'obj_' + (++_nextId);
    if (axis === 'z') {
      obj.position[2] = -obj.position[2];
    } else if (axis === 'x') {
      obj.position[0] = -obj.position[0];
    }
    obj.rotation = mirrorRotation(obj.rotation, axis);
    obj.mirrorFlip = !srcData.mirrorFlip;
    return obj;
  }

  function mirrorObjDataLinked(srcData, axis) {
    var pairId = generateMirrorPairId();
    srcData.mirrorPairId = pairId;
    srcData.mirrorAxis = axis;

    var obj = mirrorObjData(srcData, axis);
    obj.mirrorPairId = pairId;
    obj.mirrorAxis = axis;
    return obj;
  }

  function addObjToScene(objData) {
    mapData.objects.push(objData);
    var mesh = buildSingleMesh(objData);
    if (mesh) {
      mesh.userData.mapObj = objData;
      arena.group.add(mesh);
      arena.solids.push(mesh);
      var meshColliders = window.computeColliderForMesh(mesh);
      mesh.userData.colliderBoxes = meshColliders;
      for (var ci = 0; ci < meshColliders.length; ci++) arena.colliders.push(meshColliders[ci]);
      var entry = { mesh: mesh, data: objData };
      editorObjects.push(entry);
      return entry;
    }
    return null;
  }

  function mirrorSelected() {
    if (!selectedObj) return;
    var axis = mirrorMode !== 'off' ? mirrorMode : 'z';
    pushUndo();

    if (selectedObj.data.mirrorPairId && findMirrorPartner(selectedObj.data)) {
      showEditorToast('Already has a mirror partner');
      return;
    }

    var mirrored = mirrorObjDataLinked(selectedObj.data, axis);
    rebuildSingleObject(selectedObj);
    var entry = addObjToScene(mirrored);
    if (entry) selectObject(entry);
    updateStatusBar();
  }

  // Build a single mesh from object data
  function buildSingleMesh(obj) {
    var mat = new THREE.MeshLambertMaterial({ color: obj.color || '#6B5B4F' });
    var mesh = null;
    var rotY = (obj.rotation || 0) * Math.PI / 180;
    var yOff = obj.position[1] || 0;

    if (obj.type === 'box') {
      var sx = obj.size[0], sy = obj.size[1], sz = obj.size[2];
      mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(obj.position[0], -1 + sy / 2 + yOff, obj.position[2]);
    } else if (obj.type === 'cylinder') {
      var r = obj.radius || 1.5, h = obj.height || 3.0;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat);
      mesh.position.set(obj.position[0], -1 + h / 2 + yOff, obj.position[2]);
    } else if (obj.type === 'halfCylinder') {
      var r2 = obj.radius || 2.0, h2 = obj.height || 3.0;
      var hMat = new THREE.MeshLambertMaterial({ color: obj.color || '#7A6A55', side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, h2, 24, 1, false, 0, Math.PI), hMat);
      mesh.position.set(obj.position[0], -1 + h2 / 2 + yOff, obj.position[2]);
    } else if (obj.type === 'ramp') {
      var rsx = obj.size[0], rsy = obj.size[1], rsz = obj.size[2];
      var shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(rsz, 0);
      shape.lineTo(0, rsy);
      shape.closePath();
      var extGeom = new THREE.ExtrudeGeometry(shape, { depth: rsx, bevelEnabled: false });
      extGeom.translate(-rsz / 2, 0, -rsx / 2);
      mesh = new THREE.Mesh(extGeom, mat);
      mesh.position.set(obj.position[0], -1 + yOff, obj.position[2]);
    }

    if (mesh && rotY !== 0) mesh.rotation.y = rotY;
    // Apply mirror geometry flip for linked pairs
    if (mesh && obj.mirrorFlip && obj.mirrorAxis) {
      if (obj.mirrorAxis === 'z') mesh.scale.z = -1;
      else if (obj.mirrorAxis === 'x') mesh.scale.x = -1;
      mesh.material.side = THREE.DoubleSide;
    }
    if (mesh) mesh.userData.mapObj = obj;
    return mesh;
  }

  // ── Resize Handles ──

  function rotateOffset(offX, offZ, rotDeg) {
    var rad = (rotDeg || 0) * Math.PI / 180;
    var cosR = Math.cos(rad);
    var sinR = Math.sin(rad);
    return {
      x: offX * cosR + offZ * sinR,
      z: -offX * sinR + offZ * cosR
    };
  }

  function createResizeHandles(entry) {
    removeResizeHandles();
    var d = entry.data;
    var baseY = -1 + (d.position[1] || 0);
    var cx = d.position[0], cz = d.position[2];
    var rot = d.rotation || 0;
    var isCyl = (d.type === 'cylinder' || d.type === 'halfCylinder');

    if (isCyl) {
      var r = d.radius || 1.5;
      var h = d.height || 3.0;
      // 4 radius handles at cardinal directions, rotated by object rotation
      var rOff1 = rotateOffset(r, 0, rot);
      var rOff2 = rotateOffset(-r, 0, rot);
      var rOff3 = rotateOffset(0, r, rot);
      var rOff4 = rotateOffset(0, -r, rot);
      addHandle(cx + rOff1.x, baseY + 0.25, cz + rOff1.z, 'radius', 1, 0);
      addHandle(cx + rOff2.x, baseY + 0.25, cz + rOff2.z, 'radius', -1, 0);
      addHandle(cx + rOff3.x, baseY + 0.25, cz + rOff3.z, 'radius', 0, 1);
      addHandle(cx + rOff4.x, baseY + 0.25, cz + rOff4.z, 'radius', 0, -1);
      // Top handle (centered, no rotation offset needed)
      addHandle(cx, baseY + h, cz, 'top', 0, 0);
    } else if (d.size) {
      var hsx = d.size[0] / 2;
      var hsz = d.size[2] / 2;
      var sy = d.size[1];
      // 4 corner handles at base, rotated by object rotation
      var c1 = rotateOffset(hsx, hsz, rot);
      var c2 = rotateOffset(hsx, -hsz, rot);
      var c3 = rotateOffset(-hsx, hsz, rot);
      var c4 = rotateOffset(-hsx, -hsz, rot);
      addHandle(cx + c1.x, baseY + 0.25, cz + c1.z, 'corner', 1, 1);
      addHandle(cx + c2.x, baseY + 0.25, cz + c2.z, 'corner', 1, -1);
      addHandle(cx + c3.x, baseY + 0.25, cz + c3.z, 'corner', -1, 1);
      addHandle(cx + c4.x, baseY + 0.25, cz + c4.z, 'corner', -1, -1);
      // Top handle (centered, no rotation offset needed)
      addHandle(cx, baseY + sy, cz, 'top', 0, 0);
    }
  }

  function addHandle(x, y, z, handleType, signX, signZ) {
    var geom = (handleType === 'top') ? handleTopGeom : handleCornerGeom;
    var mat = (handleType === 'top') ? handleTopMat : handleCornerMat;
    var mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 999;
    mesh.name = 'EditorGroup';
    editorScene.add(mesh);
    resizeHandles.push({ mesh: mesh, handleType: handleType, signX: signX, signZ: signZ });
  }

  function removeResizeHandles() {
    for (var i = 0; i < resizeHandles.length; i++) {
      if (resizeHandles[i].mesh.parent) resizeHandles[i].mesh.parent.remove(resizeHandles[i].mesh);
    }
    resizeHandles = [];
  }

  function updateResizeHandlePositions() {
    if (!selectedObj || resizeHandles.length === 0) return;
    removeResizeHandles();
    createResizeHandles(selectedObj);
  }

  function getHandleHit(event) {
    if (resizeHandles.length === 0) return null;
    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);

    var meshes = resizeHandles.map(function (h) { return h.mesh; });
    var hits = raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      for (var i = 0; i < resizeHandles.length; i++) {
        if (resizeHandles[i].mesh === hits[0].object) return resizeHandles[i];
      }
    }
    return null;
  }

  function startResize(handle, event) {
    isResizing = true;
    resizeHandle = handle;
    pushUndo();

    var d = selectedObj.data;
    if (d.size) resizeStartSize = d.size.slice();
    resizeStartRadius = d.radius || 1.5;
    resizeStartHeight = d.size ? d.size[1] : (d.height || 3.0);

    if (handle.handleType === 'top') {
      // Create a camera-facing vertical plane through the handle position
      var camDir = new THREE.Vector3();
      editorCamera.getWorldDirection(camDir);
      camDir.y = 0;
      if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
      camDir.normalize();
      resizePlane.setFromNormalAndCoplanarPoint(camDir, handle.mesh.position.clone());
    } else {
      // Use a horizontal plane at the handle's Y position
      var baseY = -1 + (d.position[1] || 0) + 0.25;
      resizePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, baseY, 0));
    }

    // Record start intersection point
    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);
    raycaster.ray.intersectPlane(resizePlane, resizeStartPoint);
  }

  function updateResize(event) {
    if (!isResizing || !resizeHandle || !selectedObj) return;

    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);

    var pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(resizePlane, pt)) return;

    var d = selectedObj.data;
    var isCyl = (d.type === 'cylinder' || d.type === 'halfCylinder');

    if (resizeHandle.handleType === 'top') {
      // Vertical resize — track Y delta
      var deltaY = pt.y - resizeStartPoint.y;
      var newH = Math.max(0.5, Math.round((resizeStartHeight + deltaY) * 4) / 4);
      if (isCyl) {
        d.height = newH;
      } else if (d.size) {
        d.size[1] = newH;
      }
    } else if (resizeHandle.handleType === 'corner' && d.size) {
      // Corner resize — compute new half-extents from center to cursor
      var cx = d.position[0], cz = d.position[2];
      var halfX = Math.abs(pt.x - cx);
      var halfZ = Math.abs(pt.z - cz);
      d.size[0] = Math.max(0.5, Math.round(halfX * 2 * 4) / 4);
      d.size[2] = Math.max(0.5, Math.round(halfZ * 2 * 4) / 4);
    } else if (resizeHandle.handleType === 'radius' && isCyl) {
      // Radius resize — distance from center to cursor on XZ
      var cx2 = d.position[0], cz2 = d.position[2];
      var dist = Math.sqrt((pt.x - cx2) * (pt.x - cx2) + (pt.z - cz2) * (pt.z - cz2));
      d.radius = Math.max(0.25, Math.round(dist * 4) / 4);
    }

    rebuildSingleObject(selectedObj);
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = createRotatedOutline(selectedObj, 0x00ff88);
    editorScene.add(boxHelper);
    updateResizeHandlePositions();
    showPropsPanel(d);
    syncMirrorPartner(d);
  }

  function endResize() {
    isResizing = false;
    resizeHandle = null;
  }

  // ── Selection ──

  function createRotatedOutline(entry, color) {
    var d = entry.data;
    var rot = (d.rotation || 0) * Math.PI / 180;
    var cx = d.position[0], cz = d.position[2];
    var baseY = -1 + (d.position[1] || 0);
    var isCyl = (d.type === 'cylinder' || d.type === 'halfCylinder');
    var hx, hz, sy;

    if (isCyl) {
      var r = d.radius || 1.5;
      hx = r; hz = r;
      sy = d.height || 3.0;
    } else if (d.size) {
      hx = d.size[0] / 2;
      hz = d.size[2] / 2;
      sy = d.size[1];
    } else {
      // Fallback to THREE.BoxHelper
      return new THREE.BoxHelper(entry.mesh, color);
    }

    // Build a wireframe box in local space, then position and rotate it
    var geom = new THREE.BufferGeometry();
    var corners = [
      [-hx, 0, -hz], [ hx, 0, -hz], [ hx, 0,  hz], [-hx, 0,  hz],
      [-hx, sy, -hz], [ hx, sy, -hz], [ hx, sy,  hz], [-hx, sy,  hz]
    ];
    // 12 edges of a box
    var indices = [
      0,1, 1,2, 2,3, 3,0,   // bottom
      4,5, 5,6, 6,7, 7,4,   // top
      0,4, 1,5, 2,6, 3,7    // verticals
    ];
    var positions = [];
    for (var i = 0; i < indices.length; i++) {
      var c = corners[indices[i]];
      positions.push(c[0], c[1], c[2]);
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    var mat = new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true });
    var outline = new THREE.LineSegments(geom, mat);
    outline.position.set(cx, baseY, cz);
    outline.rotation.y = rot;
    outline.renderOrder = 998;
    outline.name = 'EditorGroup';
    return outline;
  }

  function selectObject(entry) {
    deselectAll();
    if (!entry) return;
    selectedObj = entry;
    selectedSpawn = null;
    boxHelper = createRotatedOutline(entry, 0x00ff88);
    editorScene.add(boxHelper);
    createResizeHandles(entry);
    showPropsPanel(entry.data);
  }

  function selectSpawn(which) {
    deselectAll();
    selectedSpawn = which;
    selectedObj = null;
    var m = spawnMeshes[which];
    if (m) {
      boxHelper = new THREE.BoxHelper(m, 0xffd700);
      editorScene.add(boxHelper);
    }
    propsPanel.classList.add('hidden');
  }

  function deselectAll() {
    selectedObj = null;
    selectedSpawn = null;
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = null;
    removeResizeHandles();
    propsPanel.classList.add('hidden');
  }

  function showPropsPanel(data) {
    propsPanel.classList.remove('hidden');
    document.getElementById('epropType').textContent = data.type;
    document.getElementById('epropX').value = data.position[0];
    document.getElementById('epropZ').value = data.position[2];
    document.getElementById('epropY').value = data.position[1] || 0;
    document.getElementById('epropRot').value = data.rotation || 0;
    document.getElementById('epropColor').value = data.color || '#6B5B4F';

    var isCyl = (data.type === 'cylinder' || data.type === 'halfCylinder');
    document.getElementById('epropSizeRow').style.display = isCyl ? 'none' : '';
    document.getElementById('epropSZRow').style.display = isCyl ? 'none' : '';
    document.getElementById('epropRadiusRow').style.display = isCyl ? '' : 'none';

    if (isCyl) {
      document.getElementById('epropRadius').value = data.radius || 1.5;
      document.getElementById('epropSY').value = data.height || 3.0;
    } else {
      document.getElementById('epropSX').value = data.size ? data.size[0] : 2;
      document.getElementById('epropSY').value = data.size ? data.size[1] : 3;
      document.getElementById('epropSZ').value = data.size ? data.size[2] : 2;
    }
  }

  function applyPropsToSelected() {
    if (!selectedObj) return;
    pushUndo();
    var d = selectedObj.data;
    d.position[0] = parseFloat(document.getElementById('epropX').value) || 0;
    d.position[2] = parseFloat(document.getElementById('epropZ').value) || 0;
    d.position[1] = parseFloat(document.getElementById('epropY').value) || 0;
    d.rotation = parseFloat(document.getElementById('epropRot').value) || 0;
    d.color = document.getElementById('epropColor').value;

    var isCyl = (d.type === 'cylinder' || d.type === 'halfCylinder');
    if (isCyl) {
      d.radius = Math.max(0.25, parseFloat(document.getElementById('epropRadius').value) || 1.5);
      d.height = Math.max(0.5, parseFloat(document.getElementById('epropSY').value) || 3.0);
    } else {
      if (!d.size) d.size = [2, 3, 2];
      d.size[0] = Math.max(0.5, parseFloat(document.getElementById('epropSX').value) || 2);
      d.size[1] = Math.max(0.5, parseFloat(document.getElementById('epropSY').value) || 3);
      d.size[2] = Math.max(0.5, parseFloat(document.getElementById('epropSZ').value) || 2);
    }

    rebuildSingleObject(selectedObj);
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = createRotatedOutline(selectedObj, 0x00ff88);
    editorScene.add(boxHelper);
    updateResizeHandlePositions();

    syncMirrorPartner(d);
  }

  function rebuildSingleObject(entry) {
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (arena) {
      // Remove old colliders by reference (not parallel index)
      var oldBoxes = entry.mesh.userData.colliderBoxes;
      if (oldBoxes) {
        for (var ci = oldBoxes.length - 1; ci >= 0; ci--) {
          var idx = arena.colliders.indexOf(oldBoxes[ci]);
          if (idx >= 0) arena.colliders.splice(idx, 1);
        }
      }
      var solidIdx = arena.solids.indexOf(entry.mesh);
      if (solidIdx >= 0) arena.solids.splice(solidIdx, 1);
    }

    var newMesh = buildSingleMesh(entry.data);
    if (newMesh) {
      if (arena) {
        arena.group.add(newMesh);
        arena.solids.push(newMesh);
        var meshColliders = window.computeColliderForMesh(newMesh);
        newMesh.userData.colliderBoxes = meshColliders;
        for (var ci = 0; ci < meshColliders.length; ci++) arena.colliders.push(meshColliders[ci]);
      } else {
        newMesh.name = 'EditorGroup';
        editorScene.add(newMesh);
      }
      entry.mesh = newMesh;
    }
  }

  // ── Object manipulation ──

  function addObject(type) {
    var obj = {
      id: 'obj_' + (++_nextId),
      type: type,
      position: [0, 0, 0],
      rotation: 0,
      color: '#6B5B4F'
    };
    if (type === 'box') {
      obj.size = [2.5, 3.0, 2.0];
    } else if (type === 'cylinder') {
      obj.radius = 1.5;
      obj.height = 3.0;
    } else if (type === 'halfCylinder') {
      obj.radius = 2.0;
      obj.height = 3.0;
      obj.color = '#7A6A55';
    } else if (type === 'ramp') {
      obj.size = [4, 2, 6];
      obj.color = '#4A4A4A';
    }
    return obj;
  }

  function placeObjectAt(type, worldX, worldZ) {
    pushUndo();
    var obj = addObject(type);
    obj.position[0] = Math.round(worldX * 2) / 2;
    obj.position[2] = Math.round(worldZ * 2) / 2;

    var entry = addObjToScene(obj);
    if (entry) selectObject(entry);

    if (mirrorMode !== 'off') {
      var onAxis = (mirrorMode === 'z' && Math.abs(obj.position[2]) < 0.3) ||
                   (mirrorMode === 'x' && Math.abs(obj.position[0]) < 0.3);
      if (!onAxis) {
        var mirrored = mirrorObjDataLinked(obj, mirrorMode);
        rebuildSingleObject(entry);
        addObjToScene(mirrored);
      }
    }

    updateStatusBar();
  }

  function deleteSelected() {
    if (!selectedObj) return;
    pushUndo();

    var partnerEntry = findMirrorPartnerEntry(selectedObj.data);
    if (partnerEntry) {
      removeObjectEntry(partnerEntry);
    }

    removeObjectEntry(selectedObj);
    deselectAll();
    updateStatusBar();
  }

  function removeObjectEntry(entry) {
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (arena) {
      // Remove colliders by reference (not parallel index)
      var oldBoxes = entry.mesh.userData.colliderBoxes;
      if (oldBoxes) {
        for (var ci = oldBoxes.length - 1; ci >= 0; ci--) {
          var cidx = arena.colliders.indexOf(oldBoxes[ci]);
          if (cidx >= 0) arena.colliders.splice(cidx, 1);
        }
      }
      var solidIdx = arena.solids.indexOf(entry.mesh);
      if (solidIdx >= 0) arena.solids.splice(solidIdx, 1);
    }
    var idx = editorObjects.indexOf(entry);
    if (idx >= 0) editorObjects.splice(idx, 1);
    var dataIdx = mapData.objects.indexOf(entry.data);
    if (dataIdx >= 0) mapData.objects.splice(dataIdx, 1);
  }

  function duplicateSelected() {
    if (!selectedObj) return;
    pushUndo();
    var src = selectedObj.data;

    var partner = findMirrorPartner(src);
    if (partner) {
      var newPairId = generateMirrorPairId();

      var obj1 = JSON.parse(JSON.stringify(src));
      obj1.id = 'obj_' + (++_nextId);
      obj1.position[0] += 2;
      obj1.position[2] += 2;
      obj1.mirrorPairId = newPairId;

      var obj2 = JSON.parse(JSON.stringify(partner));
      obj2.id = 'obj_' + (++_nextId);
      obj2.position[0] += 2;
      obj2.position[2] += 2;
      obj2.mirrorPairId = newPairId;

      var entry1 = addObjToScene(obj1);
      addObjToScene(obj2);
      if (entry1) selectObject(entry1);
    } else {
      var obj = JSON.parse(JSON.stringify(src));
      obj.id = 'obj_' + (++_nextId);
      obj.position[0] += 2;
      obj.position[2] += 2;
      delete obj.mirrorPairId;
      delete obj.mirrorAxis;

      var entry = addObjToScene(obj);
      if (entry) selectObject(entry);
    }
    updateStatusBar();
  }

  function rotateSelected() {
    if (!selectedObj) return;
    pushUndo();
    selectedObj.data.rotation = ((selectedObj.data.rotation || 0) + 90) % 360;
    rebuildSingleObject(selectedObj);
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = createRotatedOutline(selectedObj, 0x00ff88);
    editorScene.add(boxHelper);
    updateResizeHandlePositions();
    showPropsPanel(selectedObj.data);

    syncMirrorPartner(selectedObj.data);
  }

  // Move selected object on Y axis (arrow keys)
  function moveSelectedY(delta) {
    if (!selectedObj) return;
    pushUndo();
    selectedObj.data.position[1] = (selectedObj.data.position[1] || 0) + delta;
    rebuildSingleObject(selectedObj);
    if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
    boxHelper = createRotatedOutline(selectedObj, 0x00ff88);
    editorScene.add(boxHelper);
    updateResizeHandlePositions();
    showPropsPanel(selectedObj.data);
    syncMirrorPartner(selectedObj.data);
  }

  // ── Player Walk Mode ──

  function enterPlayerMode() {
    if (playerMode) return;
    if (flyMode) {
      flyMode = false;
      try { document.exitPointerLock(); } catch (ex) { console.warn('mapEditor: exitPointerLock failed', ex); }
    }

    playerMode = true;
    deselectAll();

    // Save spectator camera state
    savedSpectatorPos = editorCamera.position.clone();
    savedSpectatorYaw = flyYaw;
    savedSpectatorPitch = flyPitch;

    // Drop camera to player eye height below current position
    playerPos.set(editorCamera.position.x, 0, editorCamera.position.z);
    playerYaw = flyYaw;
    playerPitch = 0;
    editorCamera.position.set(playerPos.x, 2, playerPos.z);
    editorCamera.rotation.order = 'YXZ';
    editorCamera.rotation.set(playerPitch, playerYaw, 0);

    // Reset player keys
    playerKeys = { w: false, a: false, s: false, d: false, shift: false };

    // Request pointer lock
    editorRenderer.domElement.requestPointerLock();

    // Hide UI, show hint
    toolbar.style.display = 'none';
    propsPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    loadPanel.classList.add('hidden');
    statusBar.style.display = 'none';
    document.getElementById('editorPlayerHint').classList.remove('hidden');

    var btn = document.getElementById('editorPlayerMode');
    if (btn) btn.classList.add('player-active');
  }

  function exitPlayerMode() {
    if (!playerMode) return;
    playerMode = false;

    try { document.exitPointerLock(); } catch (ex) { console.warn('mapEditor: exitPointerLock failed', ex); }

    // Restore spectator camera state
    if (savedSpectatorPos) {
      editorCamera.position.copy(savedSpectatorPos);
      flyYaw = savedSpectatorYaw;
      flyPitch = savedSpectatorPitch;
      editorCamera.rotation.order = 'YXZ';
      editorCamera.rotation.set(flyPitch, flyYaw, 0);
    }

    // Show UI
    toolbar.style.display = '';
    statusBar.style.display = '';
    document.getElementById('editorPlayerHint').classList.add('hidden');

    var btn = document.getElementById('editorPlayerMode');
    if (btn) btn.classList.remove('player-active');

    // Reset keys
    playerKeys = { w: false, a: false, s: false, d: false, shift: false };
  }

  // ── Undo / Redo ──

  function pushUndo() {
    undoStack.push(JSON.stringify(mapData));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(mapData));
    mapData = JSON.parse(undoStack.pop());
    recalcNextId();
    recalcNextMirrorPairId();
    rebuildEditorScene();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(mapData));
    mapData = JSON.parse(redoStack.pop());
    recalcNextId();
    recalcNextMirrorPairId();
    rebuildEditorScene();
  }

  // ── Raycasting helpers ──

  function getGroundPoint(event) {
    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1); // y = -1 ground plane
    var pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, pt);
    return pt;
  }

  function getHitObject(event) {
    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);

    // Check spawns first
    var spawnArr = [];
    if (spawnMeshes.A) spawnArr.push(spawnMeshes.A);
    if (spawnMeshes.B) spawnArr.push(spawnMeshes.B);
    var spawnHits = raycaster.intersectObjects(spawnArr, true);
    if (spawnHits.length > 0) {
      var hitMesh = spawnHits[0].object;
      if (hitMesh === spawnMeshes.A || hitMesh.parent === spawnMeshes.A) return { spawn: 'A' };
      if (hitMesh === spawnMeshes.B || hitMesh.parent === spawnMeshes.B) return { spawn: 'B' };
    }

    // Check editor objects
    var meshes = [];
    for (var i = 0; i < editorObjects.length; i++) {
      meshes.push(editorObjects[i].mesh);
    }
    var hits = raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      var hitM = hits[0].object;
      for (var j = 0; j < editorObjects.length; j++) {
        if (editorObjects[j].mesh === hitM || isDescendant(hitM, editorObjects[j].mesh)) {
          return { obj: editorObjects[j] };
        }
      }
    }
    return null;
  }

  function isDescendant(child, parent) {
    var p = child.parent;
    while (p) {
      if (p === parent) return true;
      p = p.parent;
    }
    return false;
  }

  // ── Event handling ──

  var _boundHandlers = {};
  var _uiListeners = [];

  function bindEditorEvents() {
    unbindEditorEvents(); // Clear any existing listeners first
    var canvas = editorRenderer.domElement;

    _boundHandlers.mousedown = function (e) { onMouseDown(e); };
    _boundHandlers.mousemove = function (e) { onMouseMove(e); };
    _boundHandlers.mouseup = function (e) { onMouseUp(e); };
    _boundHandlers.wheel = function (e) { onWheel(e); };
    _boundHandlers.keydown = function (e) { onKeyDown(e); };
    _boundHandlers.keyup = function (e) { onKeyUp(e); };
    _boundHandlers.contextmenu = function (e) { e.preventDefault(); };
    _boundHandlers.resize = function () { onResize(); };
    _boundHandlers.pointerlockchange = function () { onEditorPointerLockChange(); };

    canvas.addEventListener('mousedown', _boundHandlers.mousedown);
    canvas.addEventListener('mousemove', _boundHandlers.mousemove);
    canvas.addEventListener('mouseup', _boundHandlers.mouseup);
    canvas.addEventListener('wheel', _boundHandlers.wheel);
    canvas.addEventListener('contextmenu', _boundHandlers.contextmenu);
    document.addEventListener('keydown', _boundHandlers.keydown);
    document.addEventListener('keyup', _boundHandlers.keyup);
    document.addEventListener('pointerlockchange', _boundHandlers.pointerlockchange);
    window.addEventListener('resize', _boundHandlers.resize);

    function addUI(id, event, fn) {
      var el = typeof id === 'string' ? document.getElementById(id) : id;
      if (!el) return;
      el.addEventListener(event, fn);
      _uiListeners.push({ el: el, event: event, fn: fn });
    }

    // Toolbar buttons
    var toolBtns = document.querySelectorAll('.editor-tool');
    for (var i = 0; i < toolBtns.length; i++) {
      addUI(toolBtns[i], 'click', onToolClick);
    }

    addUI('editorMirrorToggle', 'click', cycleMirrorMode);
    addUI('editorUndo', 'click', undo);
    addUI('editorRedo', 'click', redo);
    addUI('editorSave', 'click', onSave);
    addUI('editorLoad', 'click', onLoadOpen);
    addUI('editorNew', 'click', onNew);
    addUI('editorPlayerMode', 'click', function () {
      if (playerMode) exitPlayerMode(); else enterPlayerMode();
    });
    addUI('editorSettings', 'click', onSettingsOpen);
    addUI('editorExit', 'click', stopEditor);
    addUI('epropDelete', 'click', deleteSelected);
    addUI('epropMirror', 'click', mirrorSelected);

    // Panel close (X) buttons
    addUI('epropClose', 'click', function () { deselectAll(); });
    addUI('esCloseX', 'click', function () { settingsPanel.classList.add('hidden'); });
    addUI('editorLoadCloseX', 'click', function () { loadPanel.classList.add('hidden'); });

    // Props panel inputs (including Y)
    ['epropX', 'epropZ', 'epropY', 'epropSX', 'epropSY', 'epropSZ', 'epropRadius', 'epropRot', 'epropColor'].forEach(function (id) {
      addUI(id, 'change', applyPropsToSelected);
    });

    // Settings panel
    addUI('esApply', 'click', onSettingsApply);
    addUI('esClose', 'click', function () { settingsPanel.classList.add('hidden'); });

    // Load panel
    addUI('editorLoadConfirm', 'click', onLoadConfirm);
    addUI('editorDeleteMap', 'click', onDeleteMap);
    addUI('editorLoadCancel', 'click', function () { loadPanel.classList.add('hidden'); });
  }

  function unbindEditorEvents() {
    var canvas = editorRenderer.domElement;
    canvas.removeEventListener('mousedown', _boundHandlers.mousedown);
    canvas.removeEventListener('mousemove', _boundHandlers.mousemove);
    canvas.removeEventListener('mouseup', _boundHandlers.mouseup);
    canvas.removeEventListener('wheel', _boundHandlers.wheel);
    canvas.removeEventListener('contextmenu', _boundHandlers.contextmenu);
    document.removeEventListener('keydown', _boundHandlers.keydown);
    document.removeEventListener('keyup', _boundHandlers.keyup);
    document.removeEventListener('pointerlockchange', _boundHandlers.pointerlockchange);
    window.removeEventListener('resize', _boundHandlers.resize);

    for (var i = 0; i < _uiListeners.length; i++) {
      var l = _uiListeners[i];
      l.el.removeEventListener(l.event, l.fn);
    }
    _uiListeners = [];
  }

  function onEditorPointerLockChange() {
    if (document.pointerLockElement !== editorRenderer.domElement) {
      // Pointer lock was lost
      if (flyMode) flyMode = false;
      if (playerMode) exitPlayerMode();
    }
  }

  function onToolClick(e) {
    var tool = e.target.getAttribute('data-tool');
    if (!tool) return;
    currentTool = tool;
    document.querySelectorAll('.editor-tool').forEach(function (b) { b.classList.remove('active'); });
    e.target.classList.add('active');
    updateStatusBar();
  }

  function onMouseDown(e) {
    if (playerMode) return;
    if (isOverUI(e)) return;

    if (e.button === 2) {
      flyMode = true;
      editorRenderer.domElement.requestPointerLock();
      return;
    }

    if (e.button !== 0) return;
    if (flyMode) return;

    // Check resize handles first (higher priority than objects)
    if (selectedObj && currentTool === 'select') {
      var handleHit = getHandleHit(e);
      if (handleHit) {
        startResize(handleHit, e);
        return;
      }
    }

    if (currentTool === 'select') {
      var hit = getHitObject(e);
      if (hit && hit.spawn) {
        pushUndo();
        selectSpawn(hit.spawn);
        isDragging = true;
        var sm = spawnMeshes[hit.spawn];
        dragObjStart.set(sm.position.x, sm.position.y, sm.position.z);
        var gp = getGroundPoint(e);
        if (gp) dragGroundStart.copy(gp);
        dragStart.set(e.clientX, e.clientY);
      } else if (hit && hit.obj) {
        pushUndo();
        selectObject(hit.obj);
        isDragging = true;
        dragObjStart.set(hit.obj.data.position[0], 0, hit.obj.data.position[2]);
        var gp2 = getGroundPoint(e);
        if (gp2) dragGroundStart.copy(gp2);
        dragStart.set(e.clientX, e.clientY);
      } else {
        deselectAll();
      }
    } else {
      var gp3 = getGroundPoint(e);
      if (gp3) {
        placeObjectAt(currentTool, gp3.x, gp3.z);
      }
    }
  }

  function onMouseMove(e) {
    // Player mode mouse look
    if (playerMode) {
      if (document.pointerLockElement === editorRenderer.domElement) {
        playerYaw -= e.movementX * 0.002;
        playerPitch -= e.movementY * 0.002;
        playerPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, playerPitch));
        editorCamera.rotation.order = 'YXZ';
        editorCamera.rotation.set(playerPitch, playerYaw, 0);
      }
      return;
    }

    // Fly mode mouse look
    if (flyMode) {
      if (document.pointerLockElement === editorRenderer.domElement) {
        flyYaw -= e.movementX * 0.002;
        flyPitch -= e.movementY * 0.002;
        flyPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, flyPitch));
        editorCamera.rotation.order = 'YXZ';
        editorCamera.rotation.set(flyPitch, flyYaw, 0);
      }
      return;
    }

    // Resize dragging
    if (isResizing) {
      updateResize(e);
      return;
    }

    // Object/spawn dragging
    if (isDragging && (selectedObj || selectedSpawn)) {
      var gp = getGroundPoint(e);
      if (!gp) return;

      var dx = gp.x - dragGroundStart.x;
      var dz = gp.z - dragGroundStart.z;
      var newX = Math.round((dragObjStart.x + dx) * 2) / 2;
      var newZ = Math.round((dragObjStart.z + dz) * 2) / 2;

      if (selectedSpawn) {
        var sm = spawnMeshes[selectedSpawn];
        sm.position.x = newX;
        sm.position.z = newZ;
        mapData.spawns[selectedSpawn][0] = newX;
        mapData.spawns[selectedSpawn][2] = newZ;
        if (boxHelper) boxHelper.update();
      } else if (selectedObj) {
        selectedObj.data.position[0] = newX;
        selectedObj.data.position[2] = newZ;
        rebuildSingleObject(selectedObj);
        if (boxHelper && boxHelper.parent) boxHelper.parent.remove(boxHelper);
        boxHelper = createRotatedOutline(selectedObj, 0x00ff88);
        editorScene.add(boxHelper);
        updateResizeHandlePositions();
        showPropsPanel(selectedObj.data);

        syncMirrorPartner(selectedObj.data);
      }
    }
  }

  function onMouseUp(e) {
    if (e.button === 2 && flyMode) {
      flyMode = false;
      try { document.exitPointerLock(); } catch (ex) { console.warn('mapEditor: exitPointerLock failed', ex); }
      return;
    }
    if (isResizing) {
      endResize();
      return;
    }
    if (isDragging) {
      isDragging = false;
    }
  }

  function onWheel(e) {
    if (playerMode) return;
    e.preventDefault();
    if (flyMode) {
      if (e.deltaY > 0) flySpeed = Math.max(0.05, flySpeed * 0.85);
      else flySpeed = Math.min(3.0, flySpeed * 1.15);
    } else {
      var dir = new THREE.Vector3();
      editorCamera.getWorldDirection(dir);
      var amount = e.deltaY > 0 ? -2 : 2;
      editorCamera.position.addScaledVector(dir, amount);
    }
  }

  function onKeyDown(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Player mode keys
    if (playerMode) {
      var pk = e.key.toLowerCase();
      if (pk === 'w') playerKeys.w = true;
      if (pk === 'a') playerKeys.a = true;
      if (pk === 's') playerKeys.s = true;
      if (pk === 'd') playerKeys.d = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') playerKeys.shift = true;
      if (pk === 'p' || e.key === 'Escape') {
        exitPlayerMode();
        e.preventDefault();
      }
      return;
    }

    // Fly keys (always tracked for when RMB fly mode activates)
    var k = e.key.toLowerCase();
    if (k === 'w') flyKeys.w = true;
    if (k === 'a') flyKeys.a = true;
    if (k === 's') flyKeys.s = true;
    if (k === 'd') flyKeys.d = true;
    if (k === ' ') { flyKeys.space = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') flyKeys.shift = true;

    if (flyMode) return;

    // P key — enter player mode
    if (k === 'p') {
      enterPlayerMode();
      e.preventDefault();
      return;
    }

    if (e.key === 'Escape') {
      if (!settingsPanel.classList.contains('hidden')) { settingsPanel.classList.add('hidden'); return; }
      if (!loadPanel.classList.contains('hidden')) { loadPanel.classList.add('hidden'); return; }
      deselectAll();
      e.preventDefault();
      return;
    }

    // Arrow keys — move selected object on Y axis
    if (e.key === 'ArrowUp' && selectedObj) {
      moveSelectedY(0.5);
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' && selectedObj) {
      moveSelectedY(-0.5);
      e.preventDefault();
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected();
      e.preventDefault();
      return;
    }

    if (k === 'r' && !e.ctrlKey && !e.metaKey) {
      rotateSelected();
      e.preventDefault();
      return;
    }

    if (k === 'm') {
      mirrorSelected();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && k === 'd') {
      duplicateSelected();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'z')) {
      redo();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (k === 'z')) {
      undo();
      e.preventDefault();
      return;
    }
  }

  function onKeyUp(e) {
    if (playerMode) {
      var pk = e.key.toLowerCase();
      if (pk === 'w') playerKeys.w = false;
      if (pk === 'a') playerKeys.a = false;
      if (pk === 's') playerKeys.s = false;
      if (pk === 'd') playerKeys.d = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') playerKeys.shift = false;
      return;
    }

    var k = e.key.toLowerCase();
    if (k === 'w') flyKeys.w = false;
    if (k === 'a') flyKeys.a = false;
    if (k === 's') flyKeys.s = false;
    if (k === 'd') flyKeys.d = false;
    if (k === ' ') flyKeys.space = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') flyKeys.shift = false;
  }

  function onResize() {
    if (!editorActive) return;
    editorCamera.aspect = window.innerWidth / window.innerHeight;
    editorCamera.updateProjectionMatrix();
    editorRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  function isOverUI(e) {
    var els = [toolbar, propsPanel, settingsPanel, loadPanel, statusBar];
    for (var i = 0; i < els.length; i++) {
      if (els[i] && !els[i].classList.contains('hidden') && els[i].style.display !== 'none') {
        var r = els[i].getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return true;
      }
    }
    return false;
  }

  // ── Save / Load / New ──

  function onSave() {
    var nameEl = document.getElementById('esMapName');
    var name = nameEl ? nameEl.value.trim().replace(/[^a-zA-Z0-9_-]/g, '') : 'my-map';
    if (!name) { alert('Enter a map name in Settings first.'); return; }
    mapData.name = name;
    saveMapToServer(name, mapData).then(function () {
      showEditorToast('Saved: ' + name);
    }).catch(function () {
      alert('Failed to save map.');
    });
  }

  function onLoadOpen() {
    loadPanel.classList.remove('hidden');
    var sel = document.getElementById('editorLoadSelect');
    sel.innerHTML = '';
    fetchMapList().then(function (names) {
      if (names.length === 0) {
        var opt = document.createElement('option');
        opt.textContent = '(no maps saved)';
        opt.disabled = true;
        sel.appendChild(opt);
        return;
      }
      names.forEach(function (n) {
        var opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        sel.appendChild(opt);
      });
    });
  }

  function onLoadConfirm() {
    var sel = document.getElementById('editorLoadSelect');
    var name = sel.value;
    if (!name) return;
    fetchMapData(name).then(function (data) {
      pushUndo();
      mapData = data;
      recalcNextId();
      recalcNextMirrorPairId();
      document.getElementById('esMapName').value = name;
      rebuildEditorScene();
      loadPanel.classList.add('hidden');
      syncSettingsUI();
      showEditorToast('Loaded: ' + name);
    }).catch(function () { alert('Failed to load map.'); });
  }

  function onDeleteMap() {
    var sel = document.getElementById('editorLoadSelect');
    var name = sel.value;
    if (!name) return;
    if (!confirm('Delete map "' + name + '"?')) return;
    deleteMapFromServer(name).then(function () {
      onLoadOpen();
      showEditorToast('Deleted: ' + name);
    }).catch(function () { alert('Failed to delete.'); });
  }

  function onNew() {
    if (!confirm('Create a new empty map? Unsaved changes will be lost.')) return;
    pushUndo();
    mapData = {
      name: 'new-map',
      version: 1,
      arena: { width: 60, length: 90, wallHeight: 3.5 },
      spawns: { A: [0, 0, -37], B: [0, 0, 37] },
      objects: []
    };
    _nextId = 1;
    _nextMirrorPairId = 1;
    document.getElementById('esMapName').value = 'new-map';
    rebuildEditorScene();
    syncSettingsUI();
  }

  // ── Settings panel ──

  function onSettingsOpen() {
    syncSettingsUI();
    settingsPanel.classList.remove('hidden');
  }

  function syncSettingsUI() {
    document.getElementById('esMapName').value = mapData.name || 'my-map';
    document.getElementById('esArenaW').value = mapData.arena.width || 60;
    document.getElementById('esArenaL').value = mapData.arena.length || 90;
    document.getElementById('esWallH').value = mapData.arena.wallHeight || 3.5;
    document.getElementById('esSpawnAX').value = mapData.spawns.A[0];
    document.getElementById('esSpawnAZ').value = mapData.spawns.A[2];
    document.getElementById('esSpawnBX').value = mapData.spawns.B[0];
    document.getElementById('esSpawnBZ').value = mapData.spawns.B[2];
  }

  function onSettingsApply() {
    pushUndo();
    mapData.name = document.getElementById('esMapName').value.trim() || 'my-map';
    mapData.arena.width = Math.max(20, parseInt(document.getElementById('esArenaW').value, 10) || 60);
    mapData.arena.length = Math.max(20, parseInt(document.getElementById('esArenaL').value, 10) || 90);
    mapData.arena.wallHeight = Math.max(1, parseFloat(document.getElementById('esWallH').value) || 3.5);
    mapData.spawns.A[0] = parseFloat(document.getElementById('esSpawnAX').value) || 0;
    mapData.spawns.A[2] = parseFloat(document.getElementById('esSpawnAZ').value) || -37;
    mapData.spawns.B[0] = parseFloat(document.getElementById('esSpawnBX').value) || 0;
    mapData.spawns.B[2] = parseFloat(document.getElementById('esSpawnBZ').value) || 37;
    rebuildEditorScene();
    settingsPanel.classList.add('hidden');
  }

  // ── Status ──

  function updateStatusBar() {
    var toolText = 'Tool: ' + currentTool.charAt(0).toUpperCase() + currentTool.slice(1);
    if (mirrorMode !== 'off') toolText += '  |  Mirror: ' + mirrorMode.toUpperCase() + '-axis';
    if (toolLabel) toolLabel.textContent = toolText;
    if (objCount) objCount.textContent = 'Objects: ' + (mapData ? mapData.objects.length : 0);
  }

  function showEditorToast(msg) {
    if (toolLabel) {
      toolLabel.textContent = msg;
      setTimeout(updateStatusBar, 2000);
    }
  }

  // ── Render loop ──

  function editorRenderLoop() {
    if (!editorActive) return;

    // Player walk mode movement
    if (playerMode) {
      var speed = playerKeys.shift ? 8 : 5;
      var dt = 1 / 60;

      var dir = new THREE.Vector3();
      editorCamera.getWorldDirection(dir);
      dir.y = 0; dir.normalize();
      var right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

      if (playerKeys.w) playerPos.addScaledVector(dir, speed * dt);
      if (playerKeys.s) playerPos.addScaledVector(dir, -speed * dt);
      if (playerKeys.a) playerPos.addScaledVector(right, -speed * dt);
      if (playerKeys.d) playerPos.addScaledVector(right, speed * dt);

      if (arena) resolveCollisions2D(playerPos, 0.3, arena.colliders);
      editorCamera.position.set(playerPos.x, 2, playerPos.z);
    }

    // Fly mode movement
    if (flyMode) {
      var fdir = new THREE.Vector3();
      editorCamera.getWorldDirection(fdir);
      fdir.y = 0; fdir.normalize();
      var fright = new THREE.Vector3().crossVectors(fdir, new THREE.Vector3(0, 1, 0)).normalize();

      if (flyKeys.w) editorCamera.position.addScaledVector(fdir, flySpeed);
      if (flyKeys.s) editorCamera.position.addScaledVector(fdir, -flySpeed);
      if (flyKeys.a) editorCamera.position.addScaledVector(fright, -flySpeed);
      if (flyKeys.d) editorCamera.position.addScaledVector(fright, flySpeed);
      if (flyKeys.space) editorCamera.position.y += flySpeed;
      if (flyKeys.shift) editorCamera.position.y -= flySpeed;
    }

    // Update box helper (only BoxHelper has .update; custom outlines are static)
    if (boxHelper && typeof boxHelper.update === 'function') boxHelper.update();

    editorRenderer.render(editorScene, editorCamera);
    requestAnimationFrame(editorRenderLoop);
  }

})();
