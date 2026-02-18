/**
 * mapEditor.js — In-game 3D map editor
 *
 * EXPORTS (window):
 *   editorActive — boolean flag
 *
 * DEPENDENCIES: Three.js, mapFormat.js
 *
 * FEATURES:
 *   - 7 shape types: box, cylinder, sphere, ramp, wedge, lshape, arch
 *   - Mirror modes: off, z, x, quad (4-way)
 *   - Flexible spawn points (array-based, team assignment)
 *   - Copy/paste (Ctrl+C/V), multi-select (Shift+click, Ctrl+A)
 *   - Independent color on mirror/quad clones
 *   - Arena boundary visualization
 */

(function () {
  var editorActive = false;
  var editorScene, editorCamera, editorRenderer;
  var mapData = null;
  var editorObjects = []; // { mesh, data (ref into mapData.objects) }
  var selectedObj = null; // convenience: selectedObjects[0] or null
  var selectedObjects = []; // multi-select entries
  var boxHelpers = []; // one outline per selected object
  var currentTool = 'select';
  var arena = null;

  // Spawns (flexible array)
  var spawnEntries = []; // { mesh, data (ref into mapData.spawns[i]) }
  var selectedSpawnEntry = null;
  var _nextSpawnId = 1;

  // Clipboard
  var clipboard = null; // array of cloned object data

  // Mirror symmetry: 'off', 'z', 'x', 'quad'
  var mirrorMode = 'z';
  var mirrorLines = []; // array of Line objects
  var isDragging = false;
  var dragStart = new THREE.Vector2();
  var dragObjStart = new THREE.Vector3();
  var dragGroundStart = new THREE.Vector3();
  // For multi-select drag: array of {entry, startX, startZ}
  var multiDragStarts = [];
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  var _nextId = 1;

  // Mirror pair IDs
  var _nextMirrorPairId = 1;

  // Quad group IDs
  var _nextQuadGroupId = 1;

  // Boundary outline
  var boundaryOutline = null;
  var boundaryPosts = [];

  // Resize handles
  var resizeHandles = [];
  var isResizing = false;
  var resizeHandle = null;
  var resizeStartPoint = new THREE.Vector3();
  var resizeStartSize = null;
  var resizeStartRadius = 0;
  var resizeStartHeight = 0;
  var resizePlane = new THREE.Plane();
  var resizeFixedWorld = new THREE.Vector3();
  var resizeSignX = 0;
  var resizeSignZ = 0;
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

  // Shape display names
  var SHAPE_NAMES = {
    box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere',
    ramp: 'Ramp', wedge: 'Wedge', lshape: 'L-Shape', arch: 'Arch'
  };

  // Spawn team colors (numeric: 0=none, 1-4=teams)
  var SPAWN_COLORS = { 0: 0xffd700, 1: 0xff4444, 2: 0x4488ff, 3: 0x44cc44, 4: 0xff8800 };
  var SPAWN_MODES = ['ffa', 'tdm', 'ctf'];
  var _currentSpawnMode = 'ffa';

  // Snap settings
  var gridSnap = true;
  var edgeSnap = true;

  function snapToGrid(val) {
    return gridSnap ? Math.round(val * 2) / 2 : val;
  }

  function applyEdgeSnap(proposedX, proposedZ, draggedEntries) {
    if (!edgeSnap) return [proposedX, proposedZ];
    var threshold = 0.75;
    var bestSnapX = proposedX, bestSnapZ = proposedZ;
    var bestDx = threshold, bestDz = threshold;

    // Build set of excluded IDs (objects being dragged)
    var exclude = {};
    for (var d = 0; d < draggedEntries.length; d++) {
      exclude[draggedEntries[d].data.id] = true;
    }

    // Get dragged object bounds from first entry
    var refEntry = draggedEntries[0];
    var bbox = new THREE.Box3().setFromObject(refEntry.mesh);
    var curX = refEntry.data.position[0];
    var curZ = refEntry.data.position[2];
    var halfW = (bbox.max.x - bbox.min.x) / 2;
    var halfD = (bbox.max.z - bbox.min.z) / 2;

    var propMinX = proposedX - halfW, propMaxX = proposedX + halfW;
    var propMinZ = proposedZ - halfD, propMaxZ = proposedZ + halfD;

    for (var i = 0; i < editorObjects.length; i++) {
      var other = editorObjects[i];
      if (exclude[other.data.id]) continue;
      var ob = new THREE.Box3().setFromObject(other.mesh);

      // X-axis edge checks: left-to-right, right-to-left, left-to-left, right-to-right
      var xDiffs = [ob.max.x - propMinX, ob.min.x - propMaxX, ob.min.x - propMinX, ob.max.x - propMaxX];
      for (var xi = 0; xi < xDiffs.length; xi++) {
        if (Math.abs(xDiffs[xi]) < bestDx) { bestDx = Math.abs(xDiffs[xi]); bestSnapX = proposedX + xDiffs[xi]; }
      }

      // Z-axis edge checks
      var zDiffs = [ob.max.z - propMinZ, ob.min.z - propMaxZ, ob.min.z - propMinZ, ob.max.z - propMaxZ];
      for (var zi = 0; zi < zDiffs.length; zi++) {
        if (Math.abs(zDiffs[zi]) < bestDz) { bestDz = Math.abs(zDiffs[zi]); bestSnapZ = proposedZ + zDiffs[zi]; }
      }
    }

    return [bestSnapX, bestSnapZ];
  }

  function toggleGridSnap() {
    gridSnap = !gridSnap;
    updateSnapButton();
    updateStatusBar();
  }

  function toggleEdgeSnap() {
    edgeSnap = !edgeSnap;
    updateSnapButton();
    updateStatusBar();
  }

  function updateSnapButton() {
    var btn = document.getElementById('editorSnapToggle');
    if (!btn) return;
    var label = 'Snap:';
    if (gridSnap && edgeSnap) label += ' Grid+Edge';
    else if (gridSnap) label += ' Grid';
    else if (edgeSnap) label += ' Edge';
    else label += ' Off';
    btn.textContent = label;
  }

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

  function recalcNextQuadGroupId() {
    var max = 0;
    var objs = mapData.objects || [];
    for (var i = 0; i < objs.length; i++) {
      var qg = objs[i].quadGroupId;
      if (qg) {
        var num = parseInt(qg.replace('qg_', ''), 10);
        if (num > max) max = num;
      }
    }
    _nextQuadGroupId = max + 1;
  }

  function generateQuadGroupId() {
    return 'qg_' + (_nextQuadGroupId++);
  }

  // Get the spawn array for the currently selected mode
  function getCurrentSpawns() {
    if (!mapData.spawns || typeof mapData.spawns !== 'object') mapData.spawns = { ffa: [] };
    if (!mapData.spawns[_currentSpawnMode]) mapData.spawns[_currentSpawnMode] = [];
    return mapData.spawns[_currentSpawnMode];
  }

  function recalcNextSpawnId() {
    var max = 0;
    // Scan all modes for highest spawn ID
    var modes = Object.keys(mapData.spawns || {});
    for (var m = 0; m < modes.length; m++) {
      var spawns = mapData.spawns[modes[m]] || [];
      for (var i = 0; i < spawns.length; i++) {
        var sid = spawns[i].id || '';
        var num = parseInt(sid.replace('spawn_', ''), 10);
        if (num > max) max = num;
      }
    }
    _nextSpawnId = max + 1;
  }

  // ── Start / Stop ──

  window.stopMapEditor = stopEditor;

  window.startMapEditor = function () {
    if (editorActive) return;

    if (window.ffaActive && typeof stopFFAInternal === 'function') stopFFAInternal();

    getUI();
    editorActive = true;
    window.editorActive = true;
    playerMode = false;
    mapData = getDefaultMapData();
    // Normalize spawns to per-mode format
    mapData.spawns = normalizeSpawns(mapData.spawns);
    _currentSpawnMode = 'ffa';
    recalcNextId();
    recalcNextMirrorPairId();
    recalcNextQuadGroupId();
    recalcNextSpawnId();

    showOnlyMenu(null);
    setHUDVisible(false);
    editorUI.classList.remove('hidden');
    propsPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    loadPanel.classList.add('hidden');
    document.getElementById('editorPlayerHint').classList.add('hidden');

    editorScene = scene;
    if (typeof renderer === 'undefined' || !renderer) {
      console.warn('mapEditor: renderer not initialized');
      return;
    }
    editorRenderer = renderer;

    clearSceneArena();

    var aspect = window.innerWidth / window.innerHeight;
    editorCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 500);
    // Position above first spawn
    var currentSpawns = getCurrentSpawns();
    var firstSpawn = currentSpawns[0];
    var camZ = firstSpawn ? firstSpawn.position[2] - 15 : -52;
    var camX = firstSpawn ? firstSpawn.position[0] : 0;
    editorCamera.position.set(camX, 25, camZ);
    flyYaw = 0;
    flyPitch = -0.6;
    editorCamera.rotation.order = 'YXZ';
    editorCamera.rotation.set(flyPitch, flyYaw, 0);

    var btn = document.getElementById('editorMirrorToggle');
    if (btn) {
      btn.textContent = 'Mirror: Z';
      btn.classList.add('mirror-active');
    }

    rebuildEditorScene();
    bindEditorEvents();
    updateSnapButton();
    updateStatusBar();
    editorRenderLoop();
  };

  function stopEditor() {
    if (!editorActive) return;
    if (playerMode) exitPlayerMode();
    editorActive = false;
    window.editorActive = false;
    flyMode = false;

    clearEditorScene();

    editorUI.classList.add('hidden');
    propsPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    loadPanel.classList.add('hidden');

    unbindEditorEvents();

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
    selectedObjects = [];
    selectedSpawnEntry = null;
    removeAllBoxHelpers();
    removeResizeHandles();
    spawnEntries = [];
    arena = null;

    clearSceneArena();
    removeMirrorLines();
    removeBoundaryOutline();
  }

  function rebuildEditorScene() {
    clearEditorScene();

    arena = buildArenaFromMap(mapData);

    // Remove spawn rings from arena group — the editor creates its own interactive ones
    var arenaRingsToRemove = [];
    arena.group.children.forEach(function (c) {
      if (c.userData && c.userData.isSpawnRing) arenaRingsToRemove.push(c);
    });
    for (var ri = 0; ri < arenaRingsToRemove.length; ri++) {
      arena.group.remove(arenaRingsToRemove[ri]);
    }

    for (var i = 0; i < arena.solids.length; i++) {
      var mesh = arena.solids[i];
      if (mesh.userData.mapObj) {
        editorObjects.push({ mesh: mesh, data: mesh.userData.mapObj });
      }
    }

    rebuildMirrorLines();
    rebuildBoundaryOutline();
    rebuildSpawnMeshes();
    updateStatusBar();
  }

  // ── Spawn meshes ──

  function rebuildSpawnMeshes() {
    // Remove old spawn meshes
    for (var i = 0; i < spawnEntries.length; i++) {
      if (spawnEntries[i].mesh && spawnEntries[i].mesh.parent) {
        spawnEntries[i].mesh.parent.remove(spawnEntries[i].mesh);
      }
    }
    spawnEntries = [];
    selectedSpawnEntry = null;

    var spawns = getCurrentSpawns();
    for (var si = 0; si < spawns.length; si++) {
      var sp = spawns[si];
      var color = SPAWN_COLORS[sp.team] || SPAWN_COLORS[0];
      var ringMat = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
      var ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.8, 32), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sp.position[0], -0.94, sp.position[2]);
      ring.name = 'EditorGroup';
      editorScene.add(ring);
      spawnEntries.push({ mesh: ring, data: sp });
    }
  }

  function switchSpawnMode(mode) {
    if (SPAWN_MODES.indexOf(mode) < 0) return;
    deselectAll();
    _currentSpawnMode = mode;
    rebuildSpawnMeshes();
    updateStatusBar();
    // Update the mode dropdown if it exists
    var modeDropdown = document.getElementById('editorSpawnMode');
    if (modeDropdown) modeDropdown.value = mode;
  }

  function copySpawnsFrom(sourceMode) {
    if (sourceMode === _currentSpawnMode) return;
    var source = mapData.spawns[sourceMode];
    if (!source || source.length === 0) { alert('No spawns in ' + sourceMode + ' to copy.'); return; }
    pushUndo();
    var dest = [];
    for (var i = 0; i < source.length; i++) {
      var sp = source[i];
      dest.push({
        id: 'spawn_' + (_nextSpawnId++),
        position: sp.position.slice(),
        team: sp.team
      });
    }
    mapData.spawns[_currentSpawnMode] = dest;
    rebuildSpawnMeshes();
    updateStatusBar();
    showEditorToast('Copied ' + dest.length + ' spawns from ' + sourceMode);
  }

  // ── Mirror axis lines ──

  function removeMirrorLines() {
    for (var i = 0; i < mirrorLines.length; i++) {
      if (mirrorLines[i].parent) mirrorLines[i].parent.remove(mirrorLines[i]);
    }
    mirrorLines = [];
  }

  function addMirrorLine(axis) {
    var halfW = (mapData.arena.width || 60) / 2;
    var halfL = (mapData.arena.length || 90) / 2;
    var extend = 5;
    var pts;
    if (axis === 'z') {
      pts = [
        new THREE.Vector3(-halfW - extend, -0.85, 0),
        new THREE.Vector3(halfW + extend, -0.85, 0)
      ];
    } else {
      pts = [
        new THREE.Vector3(0, -0.85, -halfL - extend),
        new THREE.Vector3(0, -0.85, halfL + extend)
      ];
    }
    var lineGeom = new THREE.BufferGeometry().setFromPoints(pts);
    var lineMat = new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 1.5, gapSize: 0.8 });
    var line = new THREE.Line(lineGeom, lineMat);
    line.computeLineDistances();
    line.name = 'EditorGroup';
    editorScene.add(line);
    mirrorLines.push(line);
  }

  function rebuildMirrorLines() {
    removeMirrorLines();
    if (mirrorMode === 'off') return;
    if (mirrorMode === 'z' || mirrorMode === 'quad') addMirrorLine('z');
    if (mirrorMode === 'x' || mirrorMode === 'quad') addMirrorLine('x');
  }

  function cycleMirrorMode() {
    if (mirrorMode === 'off') mirrorMode = 'z';
    else if (mirrorMode === 'z') mirrorMode = 'x';
    else if (mirrorMode === 'x') mirrorMode = 'quad';
    else mirrorMode = 'off';

    var btn = document.getElementById('editorMirrorToggle');
    if (btn) {
      var labels = { off: 'Mirror: Off', z: 'Mirror: Z', x: 'Mirror: X', quad: 'Mirror: Quad' };
      btn.textContent = labels[mirrorMode] || 'Mirror: Off';
      if (mirrorMode === 'off') btn.classList.remove('mirror-active');
      else btn.classList.add('mirror-active');
    }
    rebuildMirrorLines();
    updateStatusBar();
  }

  // ── Boundary outline ──

  function removeBoundaryOutline() {
    if (boundaryOutline && boundaryOutline.parent) boundaryOutline.parent.remove(boundaryOutline);
    boundaryOutline = null;
    for (var i = 0; i < boundaryPosts.length; i++) {
      if (boundaryPosts[i].parent) boundaryPosts[i].parent.remove(boundaryPosts[i]);
    }
    boundaryPosts = [];
  }

  function rebuildBoundaryOutline() {
    removeBoundaryOutline();
    var halfW = (mapData.arena.width || 60) / 2;
    var halfL = (mapData.arena.length || 90) / 2;
    var wallH = mapData.arena.wallHeight || 3.5;
    var baseY = -0.98;

    var pts = [
      new THREE.Vector3(-halfW, baseY, -halfL),
      new THREE.Vector3(halfW, baseY, -halfL),
      new THREE.Vector3(halfW, baseY, halfL),
      new THREE.Vector3(-halfW, baseY, halfL),
      new THREE.Vector3(-halfW, baseY, -halfL)
    ];
    var geom = new THREE.BufferGeometry().setFromPoints(pts);
    var mat = new THREE.LineDashedMaterial({ color: 0x4488ff, dashSize: 2.0, gapSize: 1.0 });
    boundaryOutline = new THREE.Line(geom, mat);
    boundaryOutline.computeLineDistances();
    boundaryOutline.name = 'EditorGroup';
    editorScene.add(boundaryOutline);

    // Corner posts showing wall height
    var corners = [[-halfW, -halfL], [halfW, -halfL], [halfW, halfL], [-halfW, halfL]];
    var postMat = new THREE.LineBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.5 });
    for (var i = 0; i < corners.length; i++) {
      var postPts = [
        new THREE.Vector3(corners[i][0], baseY, corners[i][1]),
        new THREE.Vector3(corners[i][0], baseY + wallH, corners[i][1])
      ];
      var postGeom = new THREE.BufferGeometry().setFromPoints(postPts);
      var post = new THREE.Line(postGeom, postMat);
      post.name = 'EditorGroup';
      editorScene.add(post);
      boundaryPosts.push(post);
    }
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
    if (axis === 'z') return (360 - rot) % 360;
    if (axis === 'x') return (540 - rot) % 360;
    return rot;
  }

  function syncMirrorPartner(srcData) {
    var partner = findMirrorPartner(srcData);
    if (!partner) return;
    var axis = srcData.mirrorAxis || 'z';

    partner.type = srcData.type;
    // Color is NOT synced — allows independent coloring
    if (srcData.size) partner.size = srcData.size.slice();
    if (srcData.radius !== undefined) partner.radius = srcData.radius;
    if (srcData.height !== undefined) partner.height = srcData.height;
    if (srcData.thickness !== undefined) partner.thickness = srcData.thickness;

    partner.position = srcData.position.slice();
    if (axis === 'z') partner.position[2] = -srcData.position[2];
    else if (axis === 'x') partner.position[0] = -srcData.position[0];
    partner.rotation = mirrorRotation(srcData.rotation, axis);
    partner.mirrorFlip = !srcData.mirrorFlip;

    var partnerEntry = findMirrorPartnerEntry(srcData);
    if (partnerEntry) rebuildSingleObject(partnerEntry);
  }

  function mirrorObjData(srcData, axis) {
    var obj = JSON.parse(JSON.stringify(srcData));
    obj.id = 'obj_' + (++_nextId);
    if (axis === 'z') obj.position[2] = -obj.position[2];
    else if (axis === 'x') obj.position[0] = -obj.position[0];
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

  // ── Quad group helpers ──

  function findQuadGroupEntries(objData) {
    if (!objData.quadGroupId) return [];
    var result = [];
    for (var i = 0; i < editorObjects.length; i++) {
      if (editorObjects[i].data !== objData && editorObjects[i].data.quadGroupId === objData.quadGroupId) {
        result.push(editorObjects[i]);
      }
    }
    return result;
  }

  function findQuadGroupData(objData) {
    if (!objData.quadGroupId) return [];
    var result = [];
    for (var i = 0; i < mapData.objects.length; i++) {
      if (mapData.objects[i] !== objData && mapData.objects[i].quadGroupId === objData.quadGroupId) {
        result.push(mapData.objects[i]);
      }
    }
    return result;
  }

  // Rotational quad symmetry: each quadrant is a 90° rotation of the adjacent one.
  // Roles: 'original', 'rot90', 'rot180', 'rot270'
  // Position offsets (CCW): how much the position is rotated from the original
  var QUAD_POS_OFFSETS = { original: 0, rot90: 90, rot180: 180, rot270: 270 };
  // Visual rotation offsets: opposite direction so pieces face the same way relative to quadrant
  var QUAD_ROT_OFFSETS = { original: 0, rot90: 270, rot180: 180, rot270: 90 };

  function quadMirrorRotation(srcRot, srcRole, targetRole) {
    var rot = srcRot || 0;
    var srcOffset = QUAD_ROT_OFFSETS[srcRole] || 0;
    var targetOffset = QUAD_ROT_OFFSETS[targetRole] || 0;
    return ((rot - srcOffset + targetOffset) % 360 + 360) % 360;
  }

  function quadMirrorPosition(srcPos, srcRole, targetRole) {
    var px = srcPos[0], pz = srcPos[2];
    // Undo source position rotation to get original position
    var srcOffset = QUAD_POS_OFFSETS[srcRole] || 0;
    var ox = px, oz = pz;
    if (srcOffset === 90) { ox = pz; oz = -px; }
    else if (srcOffset === 180) { ox = -px; oz = -pz; }
    else if (srcOffset === 270) { ox = -pz; oz = px; }
    // Apply target position rotation
    var targetOffset = QUAD_POS_OFFSETS[targetRole] || 0;
    var tx = ox, tz = oz;
    if (targetOffset === 90) { tx = -oz; tz = ox; }
    else if (targetOffset === 180) { tx = -ox; tz = -oz; }
    else if (targetOffset === 270) { tx = oz; tz = -ox; }
    return [tx, srcPos[1] || 0, tz];
  }

  function syncQuadGroup(srcData) {
    if (!srcData.quadGroupId) return;
    var members = findQuadGroupData(srcData);
    var srcRole = srcData.quadRole || 'original';

    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      var targetRole = m.quadRole || 'original';
      m.type = srcData.type;
      // Color NOT synced (independent coloring)
      if (srcData.size) m.size = srcData.size.slice();
      if (srcData.radius !== undefined) m.radius = srcData.radius;
      if (srcData.height !== undefined) m.height = srcData.height;
      if (srcData.thickness !== undefined) m.thickness = srcData.thickness;

      m.position = quadMirrorPosition(srcData.position, srcRole, targetRole);
      m.rotation = quadMirrorRotation(srcData.rotation, srcRole, targetRole);

      // Rotational symmetry: no geometry flip needed
      delete m.mirrorFlip;
      delete m.mirrorAxis;
    }

    // Rebuild all group entries
    var entries = findQuadGroupEntries(srcData);
    for (var j = 0; j < entries.length; j++) {
      rebuildSingleObject(entries[j]);
    }
  }

  function syncAllLinked(srcData) {
    syncMirrorPartner(srcData);
    syncQuadGroup(srcData);
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
    var axis = mirrorMode !== 'off' && mirrorMode !== 'quad' ? mirrorMode : 'z';
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

  // ── Build mesh from object data ──

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
      // Legacy: convert halfCylinder to cylinder
      obj.type = 'cylinder';
      var r2 = obj.radius || 1.5, h2 = obj.height || 3.0;
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, h2, 24), mat);
      mesh.position.set(obj.position[0], -1 + h2 / 2 + yOff, obj.position[2]);
    } else if (obj.type === 'sphere') {
      var sr = obj.radius || 1.5;
      mesh = new THREE.Mesh(new THREE.SphereGeometry(sr, 24, 16), mat);
      mesh.position.set(obj.position[0], -1 + sr + yOff, obj.position[2]);
    } else if (obj.type === 'ramp' || obj.type === 'wedge') {
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
    } else if (obj.type === 'lshape') {
      var lw = obj.size[0], lh = obj.size[1], ld = obj.size[2];
      var lt = obj.thickness || 1.0;
      var lShape = new THREE.Shape();
      // L cross-section: outer from (0,0) going clockwise
      lShape.moveTo(-lw / 2, -ld / 2);
      lShape.lineTo(lw / 2, -ld / 2);
      lShape.lineTo(lw / 2, -ld / 2 + lt);
      lShape.lineTo(-lw / 2 + lt, -ld / 2 + lt);
      lShape.lineTo(-lw / 2 + lt, ld / 2);
      lShape.lineTo(-lw / 2, ld / 2);
      lShape.closePath();
      var lGeom = new THREE.ExtrudeGeometry(lShape, { depth: lh, bevelEnabled: false });
      // Rotate so extrude goes up (Y axis)
      lGeom.rotateX(-Math.PI / 2);
      mesh = new THREE.Mesh(lGeom, mat);
      mesh.position.set(obj.position[0], -1 + yOff, obj.position[2]);
    } else if (obj.type === 'arch') {
      var aw = obj.size[0], ah = obj.size[1], ad = obj.size[2];
      var openW = aw * 0.6; // opening is 60% of width
      var openH = (obj.thickness != null) ? Math.max(0.5, ah - obj.thickness) : ah * 0.65;
      var holeHW = openW / 2;
      var rectH = openH - holeHW; // straight part of opening
      if (rectH < 0) rectH = 0;
      // Single path tracing the arch profile (no hole — avoids bottom face under opening)
      // CCW: outer boundary → inward around the opening
      var archShape = new THREE.Shape();
      archShape.moveTo(-aw / 2, -0.05);       // bottom-left
      archShape.lineTo(-aw / 2, ah);           // up left side
      archShape.lineTo(aw / 2, ah);            // across top
      archShape.lineTo(aw / 2, -0.05);         // down right side
      archShape.lineTo(holeHW, -0.05);         // inward along bottom to right opening edge
      archShape.lineTo(holeHW, rectH);         // up right side of opening
      archShape.absarc(0, rectH, holeHW, 0, Math.PI, false); // arc across top of opening
      archShape.lineTo(-holeHW, -0.05);        // down left side of opening
      archShape.closePath();                    // back to start under left pillar
      var archGeom = new THREE.ExtrudeGeometry(archShape, { depth: ad, bevelEnabled: false });
      archGeom.translate(0, 0, -ad / 2);
      mesh = new THREE.Mesh(archGeom, mat);
      mesh.position.set(obj.position[0], -1 + yOff, obj.position[2]);
    }

    if (mesh && rotY !== 0) mesh.rotation.y = rotY;
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
    return { x: offX * cosR + offZ * sinR, z: -offX * sinR + offZ * cosR };
  }

  function createResizeHandles(entry) {
    removeResizeHandles();
    var d = entry.data;
    var baseY = -1 + (d.position[1] || 0);
    var cx = d.position[0], cz = d.position[2];
    var rot = d.rotation || 0;
    var usesRadius = (d.type === 'cylinder' || d.type === 'sphere');

    if (usesRadius) {
      var r = d.radius || 1.5;
      var h = d.type === 'sphere' ? r * 2 : (d.height || 3.0);
      var handleY = d.type === 'sphere' ? baseY + r : baseY + 0.25;
      var rOff1 = rotateOffset(r, 0, rot);
      var rOff2 = rotateOffset(-r, 0, rot);
      var rOff3 = rotateOffset(0, r, rot);
      var rOff4 = rotateOffset(0, -r, rot);
      addHandle(cx + rOff1.x, handleY, cz + rOff1.z, 'radius', 1, 0);
      addHandle(cx + rOff2.x, handleY, cz + rOff2.z, 'radius', -1, 0);
      addHandle(cx + rOff3.x, handleY, cz + rOff3.z, 'radius', 0, 1);
      addHandle(cx + rOff4.x, handleY, cz + rOff4.z, 'radius', 0, -1);
      // No top handle for sphere (radius handles control size)
      if (d.type !== 'sphere') addHandle(cx, baseY + h, cz, 'top', 0, 0);
    } else if (d.size) {
      var isRamp = (d.type === 'ramp' || d.type === 'wedge');
      var hsx = isRamp ? d.size[2] / 2 : d.size[0] / 2;
      var hsz = isRamp ? d.size[0] / 2 : d.size[2] / 2;
      var sy = d.size[1];
      var c1 = rotateOffset(hsx, hsz, rot);
      var c2 = rotateOffset(hsx, -hsz, rot);
      var c3 = rotateOffset(-hsx, hsz, rot);
      var c4 = rotateOffset(-hsx, -hsz, rot);
      addHandle(cx + c1.x, baseY + 0.25, cz + c1.z, 'corner', 1, 1);
      addHandle(cx + c2.x, baseY + 0.25, cz + c2.z, 'corner', 1, -1);
      addHandle(cx + c3.x, baseY + 0.25, cz + c3.z, 'corner', -1, 1);
      addHandle(cx + c4.x, baseY + 0.25, cz + c4.z, 'corner', -1, -1);
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
      var camDir = new THREE.Vector3();
      editorCamera.getWorldDirection(camDir);
      camDir.y = 0;
      if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
      camDir.normalize();
      resizePlane.setFromNormalAndCoplanarPoint(camDir, handle.mesh.position.clone());
    } else {
      var baseY = -1 + (d.position[1] || 0) + 0.25;
      resizePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, baseY, 0));
    }
    // For corner handles, compute the fixed (opposite) corner in world space
    if (handle.handleType === 'corner' && d.size) {
      resizeSignX = handle.signX;
      resizeSignZ = handle.signZ;
      var isRamp = (d.type === 'ramp' || d.type === 'wedge');
      var hsx = isRamp ? d.size[2] / 2 : d.size[0] / 2;
      var hsz = isRamp ? d.size[0] / 2 : d.size[2] / 2;
      var rot = d.rotation || 0;
      var fixedOff = rotateOffset(-resizeSignX * hsx, -resizeSignZ * hsz, rot);
      resizeFixedWorld.set(d.position[0] + fixedOff.x, 0, d.position[2] + fixedOff.z);
    }
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
    var usesRadius = (d.type === 'cylinder' || d.type === 'sphere');
    if (resizeHandle.handleType === 'top') {
      var deltaY = pt.y - resizeStartPoint.y;
      var newH = Math.max(0.5, Math.round((resizeStartHeight + deltaY) * 4) / 4);
      if (d.type === 'cylinder') d.height = newH;
      else if (d.size) d.size[1] = newH;
    } else if (resizeHandle.handleType === 'corner' && d.size) {
      var isRamp = (d.type === 'ramp' || d.type === 'wedge');
      var rot = d.rotation || 0;
      // World delta from fixed corner to drag point
      var wdx = pt.x - resizeFixedWorld.x;
      var wdz = pt.z - resizeFixedWorld.z;
      // Un-rotate to local object space
      var local = rotateOffset(wdx, wdz, -rot);
      // local.x / local.z are full sizes (fixed corner to drag corner)
      var newVisualX = Math.max(0.5, Math.round(Math.abs(local.x) * 4) / 4);
      var newVisualZ = Math.max(0.5, Math.round(Math.abs(local.z) * 4) / 4);
      // Map visual extents back to size array (ramps swap X↔Z)
      if (isRamp) {
        d.size[2] = newVisualX;
        d.size[0] = newVisualZ;
      } else {
        d.size[0] = newVisualX;
        d.size[2] = newVisualZ;
      }
      // New center = fixed corner + rotated offset by half the new size
      var centerOff = rotateOffset(resizeSignX * newVisualX / 2, resizeSignZ * newVisualZ / 2, rot);
      d.position[0] = resizeFixedWorld.x + centerOff.x;
      d.position[2] = resizeFixedWorld.z + centerOff.z;
    } else if (resizeHandle.handleType === 'radius' && usesRadius) {
      var cx2 = d.position[0], cz2 = d.position[2];
      d.radius = Math.max(0.25, Math.round(Math.sqrt((pt.x - cx2) * (pt.x - cx2) + (pt.z - cz2) * (pt.z - cz2)) * 4) / 4);
    }
    rebuildSingleObject(selectedObj);
    refreshSelectionVisuals();
    showPropsPanel(d);
    syncAllLinked(d);
  }

  function endResize() {
    isResizing = false;
    resizeHandle = null;
  }

  // ── Selection ──

  function removeAllBoxHelpers() {
    for (var i = 0; i < boxHelpers.length; i++) {
      if (boxHelpers[i].parent) boxHelpers[i].parent.remove(boxHelpers[i]);
    }
    boxHelpers = [];
  }

  function refreshSelectionVisuals() {
    removeAllBoxHelpers();
    removeResizeHandles();
    for (var i = 0; i < selectedObjects.length; i++) {
      var outline = createRotatedOutline(selectedObjects[i], 0x00ff88);
      editorScene.add(outline);
      boxHelpers.push(outline);
    }
    // Spawn selection outline
    if (selectedSpawnEntry && selectedSpawnEntry.mesh) {
      var spawnHelper = new THREE.BoxHelper(selectedSpawnEntry.mesh, 0xffd700);
      editorScene.add(spawnHelper);
      boxHelpers.push(spawnHelper);
    }
    // Only show resize handles for single object selection
    if (selectedObjects.length === 1) {
      createResizeHandles(selectedObjects[0]);
    }
  }

  function createRotatedOutline(entry, color) {
    var d = entry.data;
    var rot = (d.rotation || 0) * Math.PI / 180;
    var cx = d.position[0], cz = d.position[2];
    var baseY = -1 + (d.position[1] || 0);
    var usesRadius = (d.type === 'cylinder' || d.type === 'sphere');
    var hx, hz, sy;

    if (usesRadius) {
      var r = d.radius || 1.5;
      hx = r; hz = r;
      sy = d.type === 'sphere' ? r * 2 : (d.height || 3.0);
    } else if (d.size) {
      var isRamp = (d.type === 'ramp' || d.type === 'wedge');
      hx = isRamp ? d.size[2] / 2 : d.size[0] / 2;
      hz = isRamp ? d.size[0] / 2 : d.size[2] / 2;
      sy = d.size[1];
    } else {
      return new THREE.BoxHelper(entry.mesh, color);
    }

    var geom = new THREE.BufferGeometry();
    var corners = [
      [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz],
      [-hx, sy, -hz], [hx, sy, -hz], [hx, sy, hz], [-hx, sy, hz]
    ];
    var indices = [0,1, 1,2, 2,3, 3,0, 4,5, 5,6, 6,7, 7,4, 0,4, 1,5, 2,6, 3,7];
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
    selectedObjects = [entry];
    selectedObj = entry;
    selectedSpawnEntry = null;
    refreshSelectionVisuals();
    showPropsPanel(entry.data);
  }

  function toggleObjectInSelection(entry) {
    var idx = selectedObjects.indexOf(entry);
    if (idx >= 0) {
      selectedObjects.splice(idx, 1);
    } else {
      selectedObjects.push(entry);
    }
    selectedSpawnEntry = null;
    selectedObj = selectedObjects.length > 0 ? selectedObjects[0] : null;
    refreshSelectionVisuals();
    if (selectedObjects.length === 1) showPropsPanel(selectedObjects[0].data);
    else if (selectedObjects.length > 1) showMultiPropsPanel();
    else propsPanel.classList.add('hidden');
  }

  function selectAllObjects() {
    selectedObjects = editorObjects.slice();
    selectedObj = selectedObjects.length > 0 ? selectedObjects[0] : null;
    selectedSpawnEntry = null;
    refreshSelectionVisuals();
    if (selectedObjects.length === 1) showPropsPanel(selectedObjects[0].data);
    else if (selectedObjects.length > 1) showMultiPropsPanel();
    updateStatusBar();
  }

  function selectSpawnEntry(entry) {
    deselectAll();
    selectedSpawnEntry = entry;
    selectedObj = null;
    selectedObjects = [];
    refreshSelectionVisuals();
    showSpawnPropsPanel(entry.data);
  }

  function deselectAll() {
    selectedObj = null;
    selectedObjects = [];
    selectedSpawnEntry = null;
    removeAllBoxHelpers();
    removeResizeHandles();
    propsPanel.classList.add('hidden');
  }

  function showPropsPanel(data) {
    propsPanel.classList.remove('hidden');
    document.getElementById('epropTypeRow').style.display = '';
    document.getElementById('epropMultiRow').style.display = 'none';
    document.getElementById('epropType').textContent = SHAPE_NAMES[data.type] || data.type;
    document.getElementById('epropXRow').style.display = '';
    document.getElementById('epropZRow').style.display = '';
    document.getElementById('epropYRow').style.display = '';
    document.getElementById('epropX').value = data.position[0];
    document.getElementById('epropZ').value = data.position[2];
    document.getElementById('epropY').value = data.position[1] || 0;
    document.getElementById('epropRotRow').style.display = '';
    document.getElementById('epropRot').value = data.rotation || 0;
    document.getElementById('epropColor').value = data.color || '#6B5B4F';
    document.getElementById('epropSpawnTeamRow').style.display = 'none';
    document.getElementById('epropMirror').style.display = '';

    var usesRadius = (data.type === 'cylinder' || data.type === 'sphere');
    document.getElementById('epropSizeRow').style.display = usesRadius ? 'none' : '';
    document.getElementById('epropSZRow').style.display = usesRadius ? 'none' : '';
    document.getElementById('epropSYRow').style.display = data.type === 'sphere' ? 'none' : '';
    document.getElementById('epropRadiusRow').style.display = usesRadius ? '' : 'none';
    document.getElementById('epropThicknessRow').style.display = (data.type === 'lshape' || data.type === 'arch') ? '' : 'none';

    if (usesRadius) {
      document.getElementById('epropRadius').value = data.radius || 1.5;
      if (data.type === 'cylinder') document.getElementById('epropSY').value = data.height || 3.0;
    } else {
      document.getElementById('epropSX').value = data.size ? data.size[0] : 2;
      document.getElementById('epropSY').value = data.size ? data.size[1] : 3;
      document.getElementById('epropSZ').value = data.size ? data.size[2] : 2;
    }
    if (data.type === 'lshape') {
      document.getElementById('epropThickness').value = data.thickness || 1.0;
    } else if (data.type === 'arch') {
      document.getElementById('epropThickness').value = data.thickness != null ? data.thickness : 1.4;
    }
  }

  function showMultiPropsPanel() {
    propsPanel.classList.remove('hidden');
    document.getElementById('epropTypeRow').style.display = 'none';
    document.getElementById('epropMultiRow').style.display = '';
    document.getElementById('epropMultiLabel').textContent = selectedObjects.length + ' objects selected';
    document.getElementById('epropXRow').style.display = 'none';
    document.getElementById('epropZRow').style.display = 'none';
    document.getElementById('epropYRow').style.display = 'none';
    document.getElementById('epropSizeRow').style.display = 'none';
    document.getElementById('epropSYRow').style.display = 'none';
    document.getElementById('epropSZRow').style.display = 'none';
    document.getElementById('epropRadiusRow').style.display = 'none';
    document.getElementById('epropThicknessRow').style.display = 'none';
    document.getElementById('epropRotRow').style.display = 'none';
    document.getElementById('epropSpawnTeamRow').style.display = 'none';
    document.getElementById('epropMirror').style.display = 'none';
  }

  function showSpawnPropsPanel(data) {
    propsPanel.classList.remove('hidden');
    document.getElementById('epropTypeRow').style.display = '';
    document.getElementById('epropMultiRow').style.display = 'none';
    document.getElementById('epropType').textContent = 'Spawn';
    document.getElementById('epropXRow').style.display = '';
    document.getElementById('epropZRow').style.display = '';
    document.getElementById('epropYRow').style.display = 'none';
    document.getElementById('epropX').value = data.position[0];
    document.getElementById('epropZ').value = data.position[2];
    document.getElementById('epropSizeRow').style.display = 'none';
    document.getElementById('epropSYRow').style.display = 'none';
    document.getElementById('epropSZRow').style.display = 'none';
    document.getElementById('epropRadiusRow').style.display = 'none';
    document.getElementById('epropThicknessRow').style.display = 'none';
    document.getElementById('epropRotRow').style.display = 'none';
    document.getElementById('epropSpawnTeamRow').style.display = '';
    document.getElementById('epropSpawnTeam').value = data.team || 0;
    document.getElementById('epropMirror').style.display = 'none';
  }

  function applyPropsToSelected() {
    if (selectedSpawnEntry) {
      pushUndo();
      var sp = selectedSpawnEntry.data;
      sp.position[0] = parseFloat(document.getElementById('epropX').value) || 0;
      sp.position[2] = parseFloat(document.getElementById('epropZ').value) || 0;
      var teamSel = document.getElementById('epropSpawnTeam');
      if (teamSel) sp.team = parseInt(teamSel.value, 10) || 0;
      rebuildSpawnMeshes();
      // Re-select the spawn after rebuild
      for (var si = 0; si < spawnEntries.length; si++) {
        if (spawnEntries[si].data === sp) { selectSpawnEntry(spawnEntries[si]); break; }
      }
      return;
    }

    if (selectedObjects.length > 1) {
      // Multi-select: only color applies
      pushUndo();
      var color = document.getElementById('epropColor').value;
      for (var i = 0; i < selectedObjects.length; i++) {
        selectedObjects[i].data.color = color;
        rebuildSingleObject(selectedObjects[i]);
      }
      refreshSelectionVisuals();
      return;
    }

    if (!selectedObj) return;
    pushUndo();
    var d = selectedObj.data;
    d.position[0] = parseFloat(document.getElementById('epropX').value) || 0;
    d.position[2] = parseFloat(document.getElementById('epropZ').value) || 0;
    d.position[1] = parseFloat(document.getElementById('epropY').value) || 0;
    d.rotation = parseFloat(document.getElementById('epropRot').value) || 0;
    d.color = document.getElementById('epropColor').value;

    var usesRadius = (d.type === 'cylinder' || d.type === 'sphere');
    if (usesRadius) {
      d.radius = Math.max(0.25, parseFloat(document.getElementById('epropRadius').value) || 1.5);
      if (d.type === 'cylinder') d.height = Math.max(0.5, parseFloat(document.getElementById('epropSY').value) || 3.0);
    } else {
      if (!d.size) d.size = [2, 3, 2];
      d.size[0] = Math.max(0.5, parseFloat(document.getElementById('epropSX').value) || 2);
      d.size[1] = Math.max(0.5, parseFloat(document.getElementById('epropSY').value) || 3);
      d.size[2] = Math.max(0.5, parseFloat(document.getElementById('epropSZ').value) || 2);
    }
    if (d.type === 'lshape') {
      d.thickness = Math.max(0.25, parseFloat(document.getElementById('epropThickness').value) || 1.0);
    } else if (d.type === 'arch') {
      d.thickness = Math.max(0.25, parseFloat(document.getElementById('epropThickness').value) || 1.4);
    }

    rebuildSingleObject(selectedObj);
    refreshSelectionVisuals();
    syncAllLinked(d);
  }

  function rebuildSingleObject(entry) {
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (arena) {
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
    } else if (type === 'sphere') {
      obj.radius = 1.5;
    } else if (type === 'ramp') {
      obj.size = [4, 2, 6];
      obj.color = '#4A4A4A';
    } else if (type === 'wedge') {
      obj.size = [2.5, 3.0, 4.0];
      obj.color = '#5A5A5A';
    } else if (type === 'lshape') {
      obj.size = [4, 3, 4];
      obj.thickness = 1.0;
    } else if (type === 'arch') {
      obj.size = [5, 4, 1.5];
      obj.thickness = 1.4;
      obj.color = '#7A6A55';
    }
    return obj;
  }

  function placeObjectAt(type, worldX, worldZ) {
    pushUndo();
    var obj = addObject(type);
    obj.position[0] = snapToGrid(worldX);
    obj.position[2] = snapToGrid(worldZ);

    var entry = addObjToScene(obj);
    if (entry) selectObject(entry);

    if (mirrorMode === 'quad') {
      var onZAxis = Math.abs(obj.position[2]) < 0.3;
      var onXAxis = Math.abs(obj.position[0]) < 0.3;
      if (onZAxis && onXAxis) {
        // Center — just one copy
      } else if (onZAxis) {
        // On Z axis — X-mirror pair only
        var mirX = mirrorObjDataLinked(obj, 'x');
        rebuildSingleObject(entry);
        addObjToScene(mirX);
      } else if (onXAxis) {
        // On X axis — Z-mirror pair only
        var mirZ = mirrorObjDataLinked(obj, 'z');
        rebuildSingleObject(entry);
        addObjToScene(mirZ);
      } else {
        // Full quad: 4 objects
        var qgId = generateQuadGroupId();
        obj.quadGroupId = qgId;
        obj.quadRole = 'original';
        delete obj.mirrorPairId;
        delete obj.mirrorAxis;

        var rot = obj.rotation || 0;
        var ox = obj.position[0], oz = obj.position[2];

        var qRot90 = JSON.parse(JSON.stringify(obj));
        qRot90.id = 'obj_' + (++_nextId);
        qRot90.position[0] = -oz;
        qRot90.position[2] = ox;
        qRot90.rotation = (rot + 270) % 360;
        qRot90.quadRole = 'rot90';

        var qRot180 = JSON.parse(JSON.stringify(obj));
        qRot180.id = 'obj_' + (++_nextId);
        qRot180.position[0] = -ox;
        qRot180.position[2] = -oz;
        qRot180.rotation = (rot + 180) % 360;
        qRot180.quadRole = 'rot180';

        var qRot270 = JSON.parse(JSON.stringify(obj));
        qRot270.id = 'obj_' + (++_nextId);
        qRot270.position[0] = oz;
        qRot270.position[2] = -ox;
        qRot270.rotation = (rot + 90) % 360;
        qRot270.quadRole = 'rot270';

        rebuildSingleObject(entry);
        addObjToScene(qRot90);
        addObjToScene(qRot180);
        addObjToScene(qRot270);
      }
    } else if (mirrorMode !== 'off') {
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

  function placeSpawnAt(worldX, worldZ) {
    pushUndo();
    var spawns = getCurrentSpawns();
    var team = 0;
    // Auto-assign team based on mode
    if (_currentSpawnMode === 'ffa') {
      team = 0; // FFA: no team
    } else {
      // TDM/CTF: alternate between team 1 and team 2
      var count1 = 0, count2 = 0;
      for (var i = 0; i < spawns.length; i++) {
        if (spawns[i].team === 1) count1++;
        if (spawns[i].team === 2) count2++;
      }
      team = (count1 <= count2) ? 1 : 2;
    }

    var spawnData = {
      id: 'spawn_' + (_nextSpawnId++),
      position: [snapToGrid(worldX), 0, snapToGrid(worldZ)],
      team: team
    };
    spawns.push(spawnData);
    rebuildSpawnMeshes();
    // Select the new spawn
    for (var si = 0; si < spawnEntries.length; si++) {
      if (spawnEntries[si].data === spawnData) { selectSpawnEntry(spawnEntries[si]); break; }
    }
    updateStatusBar();
  }

  function deleteSelected() {
    if (selectedSpawnEntry) {
      pushUndo();
      var spawns = getCurrentSpawns();
      var spIdx = spawns.indexOf(selectedSpawnEntry.data);
      if (spIdx >= 0) spawns.splice(spIdx, 1);
      rebuildSpawnMeshes();
      deselectAll();
      updateStatusBar();
      return;
    }

    if (selectedObjects.length === 0) return;
    pushUndo();

    // Collect all entries to delete (including mirror/quad partners)
    var toDelete = [];
    for (var i = 0; i < selectedObjects.length; i++) {
      var entry = selectedObjects[i];
      if (toDelete.indexOf(entry) < 0) toDelete.push(entry);
      var partnerEntry = findMirrorPartnerEntry(entry.data);
      if (partnerEntry && toDelete.indexOf(partnerEntry) < 0) toDelete.push(partnerEntry);
      var quadEntries = findQuadGroupEntries(entry.data);
      for (var q = 0; q < quadEntries.length; q++) {
        if (toDelete.indexOf(quadEntries[q]) < 0) toDelete.push(quadEntries[q]);
      }
    }

    for (var j = 0; j < toDelete.length; j++) {
      removeObjectEntry(toDelete[j]);
    }
    deselectAll();
    updateStatusBar();
  }

  function removeObjectEntry(entry) {
    if (entry.mesh && entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
    if (arena) {
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

    if (src.quadGroupId) {
      var newQgId = generateQuadGroupId();
      var groupData = [src].concat(findQuadGroupData(src));
      var firstEntry = null;
      for (var g = 0; g < groupData.length; g++) {
        var obj = JSON.parse(JSON.stringify(groupData[g]));
        obj.id = 'obj_' + (++_nextId);
        obj.position[0] += 2;
        obj.position[2] += 2;
        obj.quadGroupId = newQgId;
        delete obj.mirrorPairId;
        var e = addObjToScene(obj);
        if (g === 0 && e) firstEntry = e;
      }
      if (firstEntry) selectObject(firstEntry);
    } else {
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
        delete obj.quadGroupId;
        delete obj.quadRole;
        var entry = addObjToScene(obj);
        if (entry) selectObject(entry);
      }
    }
    updateStatusBar();
  }

  // ── Copy / Paste ──

  function copySelected() {
    if (selectedObjects.length === 0) return;
    var items = [];
    var seen = {};
    for (var i = 0; i < selectedObjects.length; i++) {
      var d = selectedObjects[i].data;
      if (seen[d.id]) continue;
      seen[d.id] = true;
      items.push(JSON.parse(JSON.stringify(d)));
      // Include mirror partner if linked
      var partner = findMirrorPartner(d);
      if (partner && !seen[partner.id]) {
        seen[partner.id] = true;
        items.push(JSON.parse(JSON.stringify(partner)));
      }
      // Include quad group members
      var qMembers = findQuadGroupData(d);
      for (var q = 0; q < qMembers.length; q++) {
        if (!seen[qMembers[q].id]) {
          seen[qMembers[q].id] = true;
          items.push(JSON.parse(JSON.stringify(qMembers[q])));
        }
      }
    }
    clipboard = items;
    showEditorToast('Copied ' + items.length + ' object' + (items.length > 1 ? 's' : ''));
  }

  function pasteClipboard() {
    if (!clipboard || clipboard.length === 0) return;
    pushUndo();

    var fakeEvent = { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 };
    var gp = getGroundPoint(fakeEvent);
    if (!gp) return;

    var baseObj = clipboard[0];
    var offsetX = snapToGrid(gp.x - baseObj.position[0]);
    var offsetZ = snapToGrid(gp.z - baseObj.position[2]);

    // Map old IDs to new IDs, old mirrorPairIds to new, old quadGroupIds to new
    var idMap = {};
    var mpMap = {};
    var qgMap = {};
    var firstEntry = null;

    for (var i = 0; i < clipboard.length; i++) {
      var obj = JSON.parse(JSON.stringify(clipboard[i]));
      var oldId = obj.id;
      obj.id = 'obj_' + (++_nextId);
      idMap[oldId] = obj.id;
      obj.position[0] += offsetX;
      obj.position[2] += offsetZ;

      if (obj.mirrorPairId) {
        if (!mpMap[obj.mirrorPairId]) mpMap[obj.mirrorPairId] = generateMirrorPairId();
        obj.mirrorPairId = mpMap[obj.mirrorPairId];
      }
      if (obj.quadGroupId) {
        if (!qgMap[obj.quadGroupId]) qgMap[obj.quadGroupId] = generateQuadGroupId();
        obj.quadGroupId = qgMap[obj.quadGroupId];
      }

      var entry = addObjToScene(obj);
      if (i === 0 && entry) firstEntry = entry;
    }

    if (firstEntry) selectObject(firstEntry);
    updateStatusBar();
    showEditorToast('Pasted');
  }

  function rotateSelected() {
    if (selectedObjects.length === 0) return;
    pushUndo();
    for (var i = 0; i < selectedObjects.length; i++) {
      selectedObjects[i].data.rotation = ((selectedObjects[i].data.rotation || 0) + 90) % 360;
      rebuildSingleObject(selectedObjects[i]);
      syncAllLinked(selectedObjects[i].data);
    }
    refreshSelectionVisuals();
    if (selectedObjects.length === 1) showPropsPanel(selectedObjects[0].data);
  }

  function moveSelectedY(delta) {
    if (selectedObjects.length === 0) return;
    pushUndo();
    for (var i = 0; i < selectedObjects.length; i++) {
      selectedObjects[i].data.position[1] = (selectedObjects[i].data.position[1] || 0) + delta;
      rebuildSingleObject(selectedObjects[i]);
      syncAllLinked(selectedObjects[i].data);
    }
    refreshSelectionVisuals();
    if (selectedObjects.length === 1) showPropsPanel(selectedObjects[0].data);
  }

  // ── Player Walk Mode ──

  function enterPlayerMode() {
    if (playerMode) return;
    if (flyMode) {
      flyMode = false;
      try { document.exitPointerLock(); } catch (ex) {}
    }
    playerMode = true;
    deselectAll();
    savedSpectatorPos = editorCamera.position.clone();
    savedSpectatorYaw = flyYaw;
    savedSpectatorPitch = flyPitch;
    playerPos.set(editorCamera.position.x, 0, editorCamera.position.z);
    playerYaw = flyYaw;
    playerPitch = 0;
    editorCamera.position.set(playerPos.x, 2, playerPos.z);
    editorCamera.rotation.order = 'YXZ';
    editorCamera.rotation.set(playerPitch, playerYaw, 0);
    playerKeys = { w: false, a: false, s: false, d: false, shift: false };
    editorRenderer.domElement.requestPointerLock();
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
    try { document.exitPointerLock(); } catch (ex) {}
    if (savedSpectatorPos) {
      editorCamera.position.copy(savedSpectatorPos);
      flyYaw = savedSpectatorYaw;
      flyPitch = savedSpectatorPitch;
      editorCamera.rotation.order = 'YXZ';
      editorCamera.rotation.set(flyPitch, flyYaw, 0);
    }
    toolbar.style.display = '';
    statusBar.style.display = '';
    document.getElementById('editorPlayerHint').classList.add('hidden');
    var btn = document.getElementById('editorPlayerMode');
    if (btn) btn.classList.remove('player-active');
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
    mapData.spawns = normalizeSpawns(mapData.spawns);
    recalcNextId();
    recalcNextMirrorPairId();
    recalcNextQuadGroupId();
    recalcNextSpawnId();
    rebuildEditorScene();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(mapData));
    mapData = JSON.parse(redoStack.pop());
    mapData.spawns = normalizeSpawns(mapData.spawns);
    recalcNextId();
    recalcNextMirrorPairId();
    recalcNextQuadGroupId();
    recalcNextSpawnId();
    rebuildEditorScene();
  }

  // ── Raycasting helpers ──

  function getGroundPoint(event) {
    var rect = editorRenderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, editorCamera);
    var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
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
    var spawnMeshArr = spawnEntries.map(function (e) { return e.mesh; });
    var spawnHits = raycaster.intersectObjects(spawnMeshArr, true);
    if (spawnHits.length > 0) {
      for (var si = 0; si < spawnEntries.length; si++) {
        if (spawnEntries[si].mesh === spawnHits[0].object) {
          return { spawnEntry: spawnEntries[si] };
        }
      }
    }

    // Check editor objects
    var meshes = [];
    for (var i = 0; i < editorObjects.length; i++) meshes.push(editorObjects[i].mesh);
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
    unbindEditorEvents();
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

    // Toolbar: Select and Spawn tool buttons
    var toolBtns = document.querySelectorAll('.editor-tool');
    for (var i = 0; i < toolBtns.length; i++) {
      addUI(toolBtns[i], 'click', onToolClick);
    }

    // Dropdown: Place button toggles menu
    addUI('editorPlaceBtn', 'click', function () {
      var dd = document.getElementById('editorPlaceDropdown');
      if (dd) dd.classList.toggle('open');
    });

    // Dropdown: Shape option buttons
    var shapeOpts = document.querySelectorAll('.editor-shape-opt');
    for (var s = 0; s < shapeOpts.length; s++) {
      addUI(shapeOpts[s], 'click', onShapeOptClick);
    }

    addUI('editorMirrorToggle', 'click', cycleMirrorMode);
    addUI('editorSnapToggle', 'click', function () {
      // Cycle: Grid+Edge → Grid → Edge → Off → Grid+Edge
      if (gridSnap && edgeSnap) { edgeSnap = false; }
      else if (gridSnap && !edgeSnap) { gridSnap = false; edgeSnap = true; }
      else if (!gridSnap && edgeSnap) { edgeSnap = false; }
      else { gridSnap = true; edgeSnap = true; }
      updateSnapButton();
      updateStatusBar();
    });
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

    addUI('epropClose', 'click', function () { deselectAll(); });
    addUI('esCloseX', 'click', function () { settingsPanel.classList.add('hidden'); });
    addUI('editorLoadCloseX', 'click', function () { loadPanel.classList.add('hidden'); });

    ['epropX', 'epropZ', 'epropY', 'epropSX', 'epropSY', 'epropSZ', 'epropRadius', 'epropThickness', 'epropRot', 'epropColor', 'epropSpawnTeam'].forEach(function (id) {
      addUI(id, 'change', applyPropsToSelected);
    });

    addUI('esApply', 'click', onSettingsApply);
    addUI('esClose', 'click', function () { settingsPanel.classList.add('hidden'); });
    addUI('esMakeSquare', 'click', function () {
      var w = parseInt(document.getElementById('esArenaW').value, 10) || 60;
      var l = parseInt(document.getElementById('esArenaL').value, 10) || 90;
      var size = Math.max(w, l);
      document.getElementById('esArenaW').value = size;
      document.getElementById('esArenaL').value = size;
    });

    addUI('editorLoadConfirm', 'click', onLoadConfirm);
    addUI('editorDeleteMap', 'click', onDeleteMap);
    addUI('editorLoadCancel', 'click', function () { loadPanel.classList.add('hidden'); });

    // Spawn mode dropdown
    addUI('editorSpawnMode', 'change', function () {
      var sel = document.getElementById('editorSpawnMode');
      if (sel) switchSpawnMode(sel.value);
    });

    // Copy spawns dropdown toggle
    addUI('editorCopySpawnsBtn', 'click', function () {
      var dd = document.getElementById('editorCopySpawnsDropdown');
      if (dd) dd.classList.toggle('open');
    });

    // Copy spawns option buttons
    var copyOpts = document.querySelectorAll('.editor-copy-spawn-opt');
    for (var co = 0; co < copyOpts.length; co++) {
      (function (btn) {
        addUI(btn, 'click', function () {
          var srcMode = btn.getAttribute('data-mode');
          copySpawnsFrom(srcMode);
          var dd = document.getElementById('editorCopySpawnsDropdown');
          if (dd) dd.classList.remove('open');
        });
      })(copyOpts[co]);
    }
  }

  function unbindEditorEvents() {
    var canvas = editorRenderer ? editorRenderer.domElement : null;
    if (canvas) {
      canvas.removeEventListener('mousedown', _boundHandlers.mousedown);
      canvas.removeEventListener('mousemove', _boundHandlers.mousemove);
      canvas.removeEventListener('mouseup', _boundHandlers.mouseup);
      canvas.removeEventListener('wheel', _boundHandlers.wheel);
      canvas.removeEventListener('contextmenu', _boundHandlers.contextmenu);
    }
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
      if (flyMode) flyMode = false;
      if (playerMode) exitPlayerMode();
    }
  }

  function onToolClick(e) {
    var tool = e.target.getAttribute('data-tool');
    if (!tool) return;
    currentTool = tool;
    // Deactivate all tool buttons and place button
    document.querySelectorAll('.editor-tool').forEach(function (b) { b.classList.remove('active'); });
    var placeBtn = document.getElementById('editorPlaceBtn');
    if (placeBtn) placeBtn.classList.remove('place-active');
    e.target.classList.add('active');
    // Close dropdown if open
    var dd = document.getElementById('editorPlaceDropdown');
    if (dd) dd.classList.remove('open');
    updateStatusBar();
  }

  function onShapeOptClick(e) {
    var tool = e.target.getAttribute('data-tool');
    if (!tool) return;
    currentTool = tool;
    // Deactivate all tool buttons
    document.querySelectorAll('.editor-tool').forEach(function (b) { b.classList.remove('active'); });
    // Activate place button
    var placeBtn = document.getElementById('editorPlaceBtn');
    if (placeBtn) {
      placeBtn.classList.add('place-active');
      placeBtn.innerHTML = 'Place: ' + (SHAPE_NAMES[tool] || tool) + ' &#9662;';
    }
    // Mark selected option
    document.querySelectorAll('.editor-shape-opt').forEach(function (b) { b.classList.remove('active'); });
    e.target.classList.add('active');
    // Close dropdown
    var dd = document.getElementById('editorPlaceDropdown');
    if (dd) dd.classList.remove('open');
    updateStatusBar();
  }

  function closeDropdown() {
    var dd = document.getElementById('editorPlaceDropdown');
    if (dd) dd.classList.remove('open');
  }

  function onMouseDown(e) {
    if (playerMode) return;
    if (isOverUI(e)) return;

    // Close dropdown on any click outside it
    closeDropdown();

    if (e.button === 2) {
      flyMode = true;
      editorRenderer.domElement.requestPointerLock();
      return;
    }
    if (e.button !== 0) return;
    if (flyMode) return;

    // Check resize handles first (single selection only)
    if (selectedObjects.length === 1 && currentTool === 'select') {
      var handleHit = getHandleHit(e);
      if (handleHit) {
        startResize(handleHit, e);
        return;
      }
    }

    if (currentTool === 'select') {
      var hit = getHitObject(e);
      if (hit && hit.spawnEntry) {
        pushUndo();
        selectSpawnEntry(hit.spawnEntry);
        isDragging = true;
        dragObjStart.set(hit.spawnEntry.mesh.position.x, hit.spawnEntry.mesh.position.y, hit.spawnEntry.mesh.position.z);
        var gp = getGroundPoint(e);
        if (gp) dragGroundStart.copy(gp);
        dragStart.set(e.clientX, e.clientY);
      } else if (hit && hit.obj) {
        if (e.shiftKey) {
          // Shift+click: toggle multi-select
          toggleObjectInSelection(hit.obj);
        } else {
          pushUndo();
          selectObject(hit.obj);
        }
        isDragging = true;
        dragObjStart.set(hit.obj.data.position[0], 0, hit.obj.data.position[2]);
        var gp2 = getGroundPoint(e);
        if (gp2) dragGroundStart.copy(gp2);
        dragStart.set(e.clientX, e.clientY);
        // Store start positions for all selected objects (multi-drag)
        multiDragStarts = [];
        for (var ms = 0; ms < selectedObjects.length; ms++) {
          multiDragStarts.push({
            entry: selectedObjects[ms],
            startX: selectedObjects[ms].data.position[0],
            startZ: selectedObjects[ms].data.position[2]
          });
        }
      } else {
        deselectAll();
      }
    } else if (currentTool === 'spawn') {
      var gp3 = getGroundPoint(e);
      if (gp3) placeSpawnAt(gp3.x, gp3.z);
    } else {
      var gp4 = getGroundPoint(e);
      if (gp4) placeObjectAt(currentTool, gp4.x, gp4.z);
    }
  }

  function onMouseMove(e) {
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

    if (isResizing) {
      updateResize(e);
      return;
    }

    if (isDragging && (selectedObjects.length > 0 || selectedSpawnEntry)) {
      var gp = getGroundPoint(e);
      if (!gp) return;

      var dx = gp.x - dragGroundStart.x;
      var dz = gp.z - dragGroundStart.z;

      if (selectedSpawnEntry) {
        var newX = snapToGrid(dragObjStart.x + dx);
        var newZ = snapToGrid(dragObjStart.z + dz);
        selectedSpawnEntry.mesh.position.x = newX;
        selectedSpawnEntry.mesh.position.z = newZ;
        selectedSpawnEntry.data.position[0] = newX;
        selectedSpawnEntry.data.position[2] = newZ;
        refreshSelectionVisuals();
        showSpawnPropsPanel(selectedSpawnEntry.data);
      } else if (selectedObjects.length > 0) {
        // Compute snapped position for first object, apply same delta to all
        var firstMds = multiDragStarts[0];
        var rawX = firstMds.startX + dx;
        var rawZ = firstMds.startZ + dz;
        var snappedX = snapToGrid(rawX);
        var snappedZ = snapToGrid(rawZ);
        // Apply edge snapping to the first dragged object
        var snapped = applyEdgeSnap(snappedX, snappedZ, [firstMds.entry]);
        var snapDx = snapped[0] - firstMds.startX;
        var snapDz = snapped[1] - firstMds.startZ;

        for (var i = 0; i < multiDragStarts.length; i++) {
          var mds = multiDragStarts[i];
          var nx = mds.startX + snapDx;
          var nz = mds.startZ + snapDz;
          mds.entry.data.position[0] = nx;
          mds.entry.data.position[2] = nz;
          rebuildSingleObject(mds.entry);
          syncAllLinked(mds.entry.data);
        }
        refreshSelectionVisuals();
        if (selectedObjects.length === 1) showPropsPanel(selectedObjects[0].data);
      }
    }
  }

  function onMouseUp(e) {
    if (e.button === 2 && flyMode) {
      flyMode = false;
      try { document.exitPointerLock(); } catch (ex) {}
      return;
    }
    if (isResizing) { endResize(); return; }
    if (isDragging) { isDragging = false; multiDragStarts = []; }
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
      editorCamera.position.addScaledVector(dir, e.deltaY > 0 ? -2 : 2);
    }
  }

  function onKeyDown(e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (playerMode) {
      var pk = e.key.toLowerCase();
      if (pk === 'w') playerKeys.w = true;
      if (pk === 'a') playerKeys.a = true;
      if (pk === 's') playerKeys.s = true;
      if (pk === 'd') playerKeys.d = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') playerKeys.shift = true;
      if (pk === 'p' || e.key === 'Escape') { exitPlayerMode(); e.preventDefault(); }
      return;
    }

    var k = e.key.toLowerCase();
    if (k === 'w') flyKeys.w = true;
    if (k === 'a') flyKeys.a = true;
    if (k === 's') flyKeys.s = true;
    if (k === 'd') flyKeys.d = true;
    if (k === ' ') { flyKeys.space = true; e.preventDefault(); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') flyKeys.shift = true;

    if (flyMode) return;

    if (k === 'p') { enterPlayerMode(); e.preventDefault(); return; }

    if (e.key === 'Escape') {
      closeDropdown();
      if (!settingsPanel.classList.contains('hidden')) { settingsPanel.classList.add('hidden'); return; }
      if (!loadPanel.classList.contains('hidden')) { loadPanel.classList.add('hidden'); return; }
      deselectAll();
      e.preventDefault();
      return;
    }

    if (e.key === 'ArrowUp' && selectedObjects.length > 0) { moveSelectedY(0.5); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' && selectedObjects.length > 0) { moveSelectedY(-0.5); e.preventDefault(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); return; }

    if (k === 'r' && !e.ctrlKey && !e.metaKey) { rotateSelected(); e.preventDefault(); return; }
    if (k === 'm') { mirrorSelected(); e.preventDefault(); return; }
    if (k === 'g' && !e.ctrlKey && !e.metaKey) { toggleGridSnap(); e.preventDefault(); return; }
    if (k === 'e' && !e.ctrlKey && !e.metaKey) { toggleEdgeSnap(); e.preventDefault(); return; }

    // Ctrl+C: Copy
    if ((e.ctrlKey || e.metaKey) && k === 'c') { copySelected(); e.preventDefault(); return; }
    // Ctrl+V: Paste
    if ((e.ctrlKey || e.metaKey) && k === 'v') { pasteClipboard(); e.preventDefault(); return; }
    // Ctrl+A: Select all
    if ((e.ctrlKey || e.metaKey) && k === 'a') { selectAllObjects(); e.preventDefault(); return; }
    // Ctrl+D: Duplicate
    if ((e.ctrlKey || e.metaKey) && k === 'd') { duplicateSelected(); e.preventDefault(); return; }
    // Ctrl+Shift+Z: Redo
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'z') { redo(); e.preventDefault(); return; }
    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && k === 'z') { undo(); e.preventDefault(); return; }
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
    }).catch(function () { alert('Failed to save map.'); });
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
      mapData.spawns = normalizeSpawns(mapData.spawns);
      recalcNextId();
      recalcNextMirrorPairId();
      recalcNextQuadGroupId();
      recalcNextSpawnId();
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
      version: 2,
      arena: { width: 60, length: 90, wallHeight: 3.5 },
      spawns: {
        ffa: [
          { id: 'spawn_1', position: [0, 0, -37], team: 0 },
          { id: 'spawn_2', position: [0, 0, 37], team: 0 }
        ]
      },
      objects: []
    };
    _currentSpawnMode = 'ffa';
    _nextId = 1;
    _nextMirrorPairId = 1;
    _nextQuadGroupId = 1;
    _nextSpawnId = 3;
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
    // Supported modes checkboxes
    var modes = mapData.supportedModes;
    if (!modes && mapData.spawns && typeof normalizeSpawns === 'function') {
      modes = Object.keys(normalizeSpawns(mapData.spawns));
    }
    if (!modes || !modes.length) modes = ['ffa'];
    var ffaCb = document.getElementById('esModeFFA');
    var tdmCb = document.getElementById('esModeTDM');
    var ctfCb = document.getElementById('esModeCTF');
    if (ffaCb) ffaCb.checked = modes.indexOf('ffa') !== -1;
    if (tdmCb) tdmCb.checked = modes.indexOf('tdm') !== -1;
    if (ctfCb) ctfCb.checked = modes.indexOf('ctf') !== -1;
  }

  function onSettingsApply() {
    pushUndo();
    mapData.name = document.getElementById('esMapName').value.trim() || 'my-map';
    mapData.arena.width = Math.max(20, parseInt(document.getElementById('esArenaW').value, 10) || 60);
    mapData.arena.length = Math.max(20, parseInt(document.getElementById('esArenaL').value, 10) || 90);
    mapData.arena.wallHeight = Math.max(1, parseFloat(document.getElementById('esWallH').value) || 3.5);
    // Supported modes
    var modes = [];
    var ffaCb = document.getElementById('esModeFFA');
    var tdmCb = document.getElementById('esModeTDM');
    var ctfCb = document.getElementById('esModeCTF');
    if (ffaCb && ffaCb.checked) modes.push('ffa');
    if (tdmCb && tdmCb.checked) modes.push('tdm');
    if (ctfCb && ctfCb.checked) modes.push('ctf');
    if (modes.length === 0) modes.push('ffa'); // ensure at least one
    mapData.supportedModes = modes;
    rebuildEditorScene();
    settingsPanel.classList.add('hidden');
  }

  // ── Status ──

  function updateStatusBar() {
    var toolName = SHAPE_NAMES[currentTool] || currentTool.charAt(0).toUpperCase() + currentTool.slice(1);
    var toolText = 'Tool: ' + toolName;
    if (mirrorMode !== 'off') {
      var mirrorLabel = mirrorMode === 'quad' ? 'Quad' : mirrorMode.toUpperCase() + '-axis';
      toolText += '  |  Mirror: ' + mirrorLabel;
    }
    var snapLabel = gridSnap && edgeSnap ? 'Grid+Edge' : gridSnap ? 'Grid' : edgeSnap ? 'Edge' : 'Off';
    toolText += '  |  Snap: ' + snapLabel;
    if (toolLabel) toolLabel.textContent = toolText;
    var spawnCount = mapData ? getCurrentSpawns().length : 0;
    if (objCount) objCount.textContent = 'Objects: ' + (mapData ? mapData.objects.length : 0) + '  |  Spawns (' + _currentSpawnMode + '): ' + spawnCount;
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

    // Update BoxHelper instances (spawn outlines)
    for (var i = 0; i < boxHelpers.length; i++) {
      if (typeof boxHelpers[i].update === 'function') boxHelpers[i].update();
    }

    editorRenderer.render(editorScene, editorCamera);
    requestAnimationFrame(editorRenderLoop);
  }

})();
