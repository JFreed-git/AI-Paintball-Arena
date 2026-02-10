/**
 * devHeroEditor.js — Hero/weapon stat editor + weapon model builder
 *
 * PURPOSE: Provides UI logic for:
 *   1. Hero Editor: edit hero stats, weapon config, visual settings, with live 3D preview
 *      - Toggle model visibility to inspect hitboxes
 *      - Full 3D drag to move hitbox segments in space (offsetX, offsetY, offsetZ)
 *      - Resize handles (6 colored spheres at face centers) to resize segments
 *   2. Weapon Model Builder: compose weapon models from box/cylinder parts, live 3D preview,
 *      register into WEAPON_MODEL_REGISTRY
 *
 * EXPORTS (window):
 *   _initHeroEditorPreview() — initialize the hero editor 3D preview
 *   _initWmbPreview()        — initialize the weapon model builder 3D preview
 *   _refreshWmbLoadList()    — refresh weapon model load dropdown
 *   _resizeHeroEditorPreview() — resize hero editor preview canvas
 *   _resizeWmbPreview()      — resize weapon model builder preview canvas
 *
 * DEPENDENCIES: Three.js, weapon.js, weaponModels.js, heroes.js, player.js, devApp.js
 */

(function () {

  // Stash crosshair spread values that have no form fields, so they round-trip on save
  var _stashedCrosshair = { baseSpreadPx: 8, sprintSpreadPx: 20 };

  // Hitbox segment state (now includes offsetX, offsetZ, shape, radius)
  // shape: 'box' (default), 'sphere', 'cylinder', 'capsule'
  var _hitboxSegments = [
    { name: "head",  shape: "box", width: 0.5, height: 0.5, depth: 0.5, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
    { name: "torso", shape: "box", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
    { name: "legs",  shape: "box", width: 0.5, height: 1.1, depth: 0.5, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
  ];

  // --- Undo / Redo ---
  var _undoStack = [];
  var _redoStack = [];
  var MAX_UNDO = 50;

  function snapshotHitboxSegments() {
    return JSON.stringify(_hitboxSegments);
  }

  function restoreHitboxSegments(json) {
    _hitboxSegments = JSON.parse(json);
    _selectedHitboxIndex = -1;
    clearResizeHandles();
    renderHitboxSegmentList();
    updateHeroPreview();
  }

  function pushUndo() {
    _undoStack.push(snapshotHitboxSegments());
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();
    _redoStack = [];
    updateUndoRedoButtons();
  }

  function hitboxUndo() {
    if (_undoStack.length === 0) return;
    _redoStack.push(snapshotHitboxSegments());
    restoreHitboxSegments(_undoStack.pop());
    updateUndoRedoButtons();
  }

  function hitboxRedo() {
    if (_redoStack.length === 0) return;
    _undoStack.push(snapshotHitboxSegments());
    restoreHitboxSegments(_redoStack.pop());
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    var undoBtn = document.getElementById('heUndo');
    var redoBtn = document.getElementById('heRedo');
    if (undoBtn) undoBtn.disabled = _undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _redoStack.length === 0;
  }

  // Debounced undo push for form input (avoids pushing on every keystroke)
  var _formUndoPushed = false;
  function pushUndoForFormInput() {
    if (!_formUndoPushed) {
      pushUndo();
      _formUndoPushed = true;
      setTimeout(function () { _formUndoPushed = false; }, 500);
    }
  }

  // Hitbox preview wireframe objects (scene-level, not parented to player mesh)
  var _hitboxPreviewMeshes = [];

  // Scene-level hitbox group (direct child of _heroPreviewScene)
  var _hitboxGroup = null;

  // ========================
  // HERO EDITOR
  // ========================

  var _heroPreviewRenderer = null;
  var _heroPreviewScene = null;
  var _heroPreviewCamera = null;
  var _heroPreviewPlayer = null;
  var _heroPreviewAnimId = 0;

  // Hero preview orbit state
  var _heroOrbitAngle = 0;
  var _heroOrbitPitch = 0.3;
  var _heroOrbitDist = 6;
  var _heroOrbitTarget = { x: 0, y: 1.5, z: 0 };
  var _heroDragging = false;
  var _heroLastMouse = { x: 0, y: 0 };

  // Interactive hitbox editing state
  var _selectedHitboxIndex = -1;
  var _hitboxRaycaster = new THREE.Raycaster();

  // Model visibility toggle
  var _modelVisible = true;

  // Snap-to-center toggle (forces offsetX=0, offsetZ=0 when dragging)
  var _snapCenter = false;

  // 3D drag state (camera-facing plane drag)
  var _hitboxDragMode = null; // 'move' | null
  var _hitboxDragPlane = new THREE.Plane();
  var _hitboxDragOffset = new THREE.Vector3();
  var _hitboxDragStartSeg = null; // snapshot of {offsetX, offsetY, offsetZ}

  // Resize handle state
  var _resizeHandles = []; // [{mesh, axis, sign}]
  var _isResizing = false;
  var _resizeHandle = null; // current handle being dragged
  var _resizePlane = new THREE.Plane();
  var _resizeStartPoint = new THREE.Vector3();
  var _resizeStartDim = 0;
  var _resizeStartOffset = 0;
  var _resizeAxis = null; // 'x' | 'y' | 'z'
  var _resizeSign = 0;

  // Snap helper
  function snapTo(val, step) {
    return Math.round(val / step) * step;
  }

  // Player feetY in preview scene (GROUND_Y from physics.js)
  function getPreviewFeetY() {
    return (typeof GROUND_Y !== 'undefined') ? GROUND_Y : -1;
  }

  window._initHeroEditorPreview = function () {
    var canvas = document.getElementById('heroPreviewCanvas');
    if (!canvas) return;

    _heroPreviewScene = new THREE.Scene();
    _heroPreviewScene.background = new THREE.Color(0x1a1a1a);

    // Lighting
    var hemi = new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.6);
    _heroPreviewScene.add(hemi);
    var ambient = new THREE.AmbientLight(0xffffff, 0.4);
    _heroPreviewScene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    _heroPreviewScene.add(dir);

    // Grid floor
    var grid = new THREE.GridHelper(4, 8, 0x333333, 0x222222);
    grid.position.y = -1;
    _heroPreviewScene.add(grid);

    // Scene-level hitbox group
    _hitboxGroup = new THREE.Group();
    _heroPreviewScene.add(_hitboxGroup);

    _heroPreviewCamera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 100);

    _heroPreviewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    _heroPreviewRenderer.setSize(canvas.width, canvas.height);

    // Build initial preview player
    updateHeroPreview();

    // Orbit controls via mouse on the canvas
    canvas.addEventListener('mousedown', function (e) {
      if (onCanvasMouseDown(e, canvas)) return;
      _heroDragging = true;
      _heroLastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', function () {
      _heroDragging = false;
      if (_hitboxDragMode === 'move') {
        _hitboxDragMode = null;
        _hitboxDragStartSeg = null;
      }
      if (_isResizing) {
        _isResizing = false;
        _resizeHandle = null;
      }
    });
    canvas.addEventListener('mousemove', function (e) {
      if (_isResizing) {
        onResizeMove(e, canvas);
        return;
      }
      if (_hitboxDragMode === 'move') {
        onHitboxDragMove(e, canvas);
        return;
      }
      if (!_heroDragging) return;
      var dx = e.clientX - _heroLastMouse.x;
      var dy = e.clientY - _heroLastMouse.y;
      _heroOrbitAngle -= dx * 0.01;
      _heroOrbitPitch = Math.max(-1.2, Math.min(1.2, _heroOrbitPitch - dy * 0.01));
      _heroLastMouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      _heroOrbitDist = Math.max(2, Math.min(15, _heroOrbitDist + e.deltaY * 0.005));
    });

    // Animate with orbit camera
    function animatePreview() {
      _heroPreviewAnimId = requestAnimationFrame(animatePreview);
      // Position camera using orbit params
      _heroPreviewCamera.position.set(
        _heroOrbitTarget.x + Math.sin(_heroOrbitAngle) * Math.cos(_heroOrbitPitch) * _heroOrbitDist,
        _heroOrbitTarget.y + Math.sin(_heroOrbitPitch) * _heroOrbitDist,
        _heroOrbitTarget.z + Math.cos(_heroOrbitAngle) * Math.cos(_heroOrbitPitch) * _heroOrbitDist
      );
      _heroPreviewCamera.lookAt(_heroOrbitTarget.x, _heroOrbitTarget.y, _heroOrbitTarget.z);
      _heroPreviewRenderer.render(_heroPreviewScene, _heroPreviewCamera);
    }
    animatePreview();

    // Wire form inputs to live preview updates
    wireHeroEditorInputs();
  };

  // --- Canvas mouse NDC helper ---

  function getCanvasMouseNDC(e, canvas) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1
    };
  }

  // --- Ray-plane intersection helper ---

  function rayPlaneIntersect(raycaster, plane, target) {
    return raycaster.ray.intersectPlane(plane, target);
  }

  // --- Hitbox world position from segment data ---

  function getHitboxWorldPos(seg) {
    var feetY = getPreviewFeetY();
    return new THREE.Vector3(
      seg.offsetX || 0,
      feetY + seg.offsetY,
      seg.offsetZ || 0
    );
  }

  // --- Selection and visuals ---

  function selectHitboxSegment(index) {
    _selectedHitboxIndex = index;
    updateHitboxVisuals();
    rebuildResizeHandles();

    // Scroll form to selected segment
    if (index >= 0) {
      var container = document.getElementById('heHitboxList');
      if (container) {
        var entries = container.querySelectorAll('.wmb-part');
        if (entries[index]) {
          entries[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          entries[index].style.outline = '2px solid #00ff88';
          setTimeout(function () {
            if (entries[index]) entries[index].style.outline = '';
          }, 800);
        }
      }
    }
  }

  function updateHitboxVisuals() {
    var segColors = { head: 0xff4444, torso: 0x44ff44, legs: 0x4488ff };
    var defaultColor = 0xffff44;

    for (var i = 0; i < _hitboxPreviewMeshes.length; i++) {
      var mesh = _hitboxPreviewMeshes[i];
      if (!mesh || !mesh.material) continue;
      var seg = _hitboxSegments[i];
      var segColor = seg ? (segColors[seg.name] || defaultColor) : defaultColor;

      if (i === _selectedHitboxIndex) {
        mesh.material.wireframe = false;
        mesh.material.opacity = 0.5;
        mesh.material.color.setHex(segColor);
      } else {
        mesh.material.wireframe = true;
        mesh.material.opacity = 0.3;
        mesh.material.color.setHex(segColor);
      }
    }
  }

  // --- Toggle model visibility ---

  function toggleModelVisibility() {
    _modelVisible = !_modelVisible;
    var btn = document.getElementById('heToggleModel');
    if (btn) btn.textContent = _modelVisible ? 'Hide Model' : 'Show Model';

    if (_heroPreviewPlayer && _heroPreviewPlayer._meshGroup) {
      _heroPreviewPlayer._meshGroup.traverse(function (child) {
        if (child === _heroPreviewPlayer._meshGroup) return;
        if (child.userData && child.userData.isBodyPart) {
          child.visible = _modelVisible;
        }
        // Also toggle weapon attachment point
        if (child === _heroPreviewPlayer._weaponAttachPoint) {
          child.visible = _modelVisible;
        }
      });
      // Health bar should hide too
      if (_heroPreviewPlayer._healthBarGroup) {
        _heroPreviewPlayer._healthBarGroup.visible = false;
      }
    }
  }

  // --- Resize Handles ---

  function clearResizeHandles() {
    for (var i = 0; i < _resizeHandles.length; i++) {
      var h = _resizeHandles[i];
      if (h.mesh.parent) h.mesh.parent.remove(h.mesh);
      if (h.mesh.geometry) h.mesh.geometry.dispose();
      if (h.mesh.material) h.mesh.material.dispose();
    }
    _resizeHandles = [];
  }

  // Get half-dimension for a resize handle given segment and handle definition
  function getHalfDimForHandle(seg, axis) {
    var shape = seg.shape || 'box';
    if (shape === 'sphere') {
      return seg.radius || 0.25;
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (axis === 'y') return (seg.height || 0.5) / 2;
      return seg.radius || 0.3;
    }
    // box
    if (axis === 'x') return seg.width / 2;
    if (axis === 'y') return seg.height / 2;
    return seg.depth / 2;
  }

  function getHandleDefsForShape(shape) {
    if (shape === 'sphere') {
      // 4 handles: ±X and ±Y, all control radius
      return [
        { axis: 'x', sign:  1, color: 0xff4444 },
        { axis: 'x', sign: -1, color: 0xff4444 },
        { axis: 'y', sign:  1, color: 0x44ff44 },
        { axis: 'y', sign: -1, color: 0x44ff44 }
      ];
    } else if (shape === 'cylinder' || shape === 'capsule') {
      // 4 handles: ±X (radius), ±Y (height)
      return [
        { axis: 'x', sign:  1, color: 0xff4444 },
        { axis: 'x', sign: -1, color: 0xff4444 },
        { axis: 'y', sign:  1, color: 0x44ff44 },
        { axis: 'y', sign: -1, color: 0x44ff44 }
      ];
    }
    // box: 6 handles
    return [
      { axis: 'x', sign:  1, color: 0xff4444 },
      { axis: 'x', sign: -1, color: 0xff4444 },
      { axis: 'y', sign:  1, color: 0x44ff44 },
      { axis: 'y', sign: -1, color: 0x44ff44 },
      { axis: 'z', sign:  1, color: 0x4488ff },
      { axis: 'z', sign: -1, color: 0x4488ff }
    ];
  }

  function rebuildResizeHandles() {
    clearResizeHandles();
    if (_selectedHitboxIndex < 0 || _selectedHitboxIndex >= _hitboxSegments.length) return;

    var seg = _hitboxSegments[_selectedHitboxIndex];
    var center = getHitboxWorldPos(seg);
    var shape = seg.shape || 'box';
    var handleDefs = getHandleDefsForShape(shape);

    for (var i = 0; i < handleDefs.length; i++) {
      var def = handleDefs[i];
      var geom = new THREE.SphereGeometry(0.06, 8, 8);
      var mat = new THREE.MeshBasicMaterial({ color: def.color, depthTest: false });
      var mesh = new THREE.Mesh(geom, mat);
      mesh.renderOrder = 999;

      var pos = center.clone();
      var halfDim = getHalfDimForHandle(seg, def.axis);

      if (def.axis === 'x') pos.x += def.sign * halfDim;
      else if (def.axis === 'y') pos.y += def.sign * halfDim;
      else pos.z += def.sign * halfDim;

      mesh.position.copy(pos);
      _hitboxGroup.add(mesh);
      _resizeHandles.push({ mesh: mesh, axis: def.axis, sign: def.sign });
    }
  }

  function repositionResizeHandles() {
    if (_selectedHitboxIndex < 0 || _selectedHitboxIndex >= _hitboxSegments.length) return;
    var seg = _hitboxSegments[_selectedHitboxIndex];
    var center = getHitboxWorldPos(seg);

    for (var i = 0; i < _resizeHandles.length; i++) {
      var h = _resizeHandles[i];
      var pos = center.clone();
      var halfDim = getHalfDimForHandle(seg, h.axis);

      if (h.axis === 'x') pos.x += h.sign * halfDim;
      else if (h.axis === 'y') pos.y += h.sign * halfDim;
      else pos.z += h.sign * halfDim;

      h.mesh.position.copy(pos);
    }
  }

  // --- Mousedown priority chain ---

  function onCanvasMouseDown(e, canvas) {
    if (!_heroPreviewCamera) return false;

    var ndc = getCanvasMouseNDC(e, canvas);
    var mouse2 = new THREE.Vector2(ndc.x, ndc.y);
    _hitboxRaycaster.setFromCamera(mouse2, _heroPreviewCamera);

    // Priority 1: Check resize handles
    if (_resizeHandles.length > 0) {
      var handleMeshes = _resizeHandles.map(function (h) { return h.mesh; });
      var handleHits = _hitboxRaycaster.intersectObjects(handleMeshes);
      if (handleHits.length > 0) {
        var hitHandle = handleHits[0].object;
        for (var hi = 0; hi < _resizeHandles.length; hi++) {
          if (_resizeHandles[hi].mesh === hitHandle) {
            startResize(_resizeHandles[hi], handleHits[0].point);
            return true;
          }
        }
      }
    }

    // Priority 2: Check hitbox meshes (start move drag)
    if (_hitboxPreviewMeshes.length > 0) {
      var hitboxHits = _hitboxRaycaster.intersectObjects(_hitboxPreviewMeshes);
      if (hitboxHits.length > 0) {
        var hitMesh = hitboxHits[0].object;
        var idx = _hitboxPreviewMeshes.indexOf(hitMesh);
        if (idx !== -1) {
          selectHitboxSegment(idx);
          startHitboxDrag(idx, hitboxHits[0].point);
          return true;
        }
      }
    }

    // Priority 3: Empty space — deselect
    selectHitboxSegment(-1);
    return false;
  }

  // --- Full 3D drag (move hitbox in space) ---

  function startHitboxDrag(index, intersectionPoint) {
    var seg = _hitboxSegments[index];
    if (!seg) return;

    pushUndo();
    var center = getHitboxWorldPos(seg);

    // Create camera-facing plane through the hitbox center
    var camDir = new THREE.Vector3();
    _heroPreviewCamera.getWorldDirection(camDir);
    _hitboxDragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), center);

    // Compute offset from intersection point to center (so box doesn't jump)
    _hitboxDragOffset.copy(center).sub(intersectionPoint);

    // Snapshot current offsets
    _hitboxDragStartSeg = {
      offsetX: seg.offsetX || 0,
      offsetY: seg.offsetY,
      offsetZ: seg.offsetZ || 0
    };

    _hitboxDragMode = 'move';
  }

  function onHitboxDragMove(e, canvas) {
    if (_hitboxDragMode !== 'move' || _selectedHitboxIndex < 0) return;
    var seg = _hitboxSegments[_selectedHitboxIndex];
    if (!seg) return;

    var ndc = getCanvasMouseNDC(e, canvas);
    var mouse2 = new THREE.Vector2(ndc.x, ndc.y);
    _hitboxRaycaster.setFromCamera(mouse2, _heroPreviewCamera);

    var intersect = new THREE.Vector3();
    if (!rayPlaneIntersect(_hitboxRaycaster, _hitboxDragPlane, intersect)) return;

    // New position = intersection + drag offset
    var newPos = intersect.add(_hitboxDragOffset);

    // Snap to 0.05 increments
    newPos.x = snapTo(newPos.x, 0.05);
    newPos.y = snapTo(newPos.y, 0.05);
    newPos.z = snapTo(newPos.z, 0.05);

    var feetY = getPreviewFeetY();

    // Update segment offsets (snap center forces X/Z to 0)
    seg.offsetX = _snapCenter ? 0 : Math.round(newPos.x * 100) / 100;

    // Compute shape-specific half-height to prevent going below ground
    var rawOffsetY = Math.round((newPos.y - feetY) * 100) / 100;
    var shape = seg.shape || 'box';
    var halfExtent;
    if (shape === 'box') {
      halfExtent = (seg.height || 0.5) / 2;
    } else if (shape === 'sphere') {
      halfExtent = seg.radius || 0.25;
    } else if (shape === 'cylinder') {
      halfExtent = (seg.height || 0.5) / 2;
    } else if (shape === 'capsule') {
      halfExtent = (seg.height || 0.5) / 2;
    } else {
      halfExtent = 0; // Fallback
    }
    seg.offsetY = Math.max(halfExtent, rawOffsetY);

    seg.offsetZ = _snapCenter ? 0 : Math.round(newPos.z * 100) / 100;

    // Move hitbox mesh directly (no full rebuild)
    var mesh = _hitboxPreviewMeshes[_selectedHitboxIndex];
    if (mesh) {
      mesh.position.set(seg.offsetX || 0, feetY + seg.offsetY, seg.offsetZ || 0);
    }

    // Reposition resize handles
    repositionResizeHandles();

    // Sync form fields
    syncFormFromSegments();
  }

  // --- Resize interaction ---

  function startResize(handle, point) {
    pushUndo();
    _isResizing = true;
    _resizeHandle = handle;
    _resizeAxis = handle.axis;
    _resizeSign = handle.sign;

    var seg = _hitboxSegments[_selectedHitboxIndex];
    if (!seg) return;

    // Create camera-facing plane through the handle position
    var camDir = new THREE.Vector3();
    _heroPreviewCamera.getWorldDirection(camDir);
    _resizePlane.setFromNormalAndCoplanarPoint(camDir.negate(), point.clone());

    _resizeStartPoint.copy(point);

    var shape = seg.shape || 'box';

    // Store start dimension and offset
    if (shape === 'sphere') {
      _resizeStartDim = seg.radius || 0.25;
      _resizeStartOffset = (_resizeAxis === 'x') ? (seg.offsetX || 0) : seg.offsetY;
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (_resizeAxis === 'y') {
        _resizeStartDim = seg.height || 0.5;
        _resizeStartOffset = seg.offsetY;
      } else {
        _resizeStartDim = seg.radius || 0.3;
        _resizeStartOffset = seg.offsetX || 0;
      }
    } else {
      if (_resizeAxis === 'x') {
        _resizeStartDim = seg.width;
        _resizeStartOffset = seg.offsetX || 0;
      } else if (_resizeAxis === 'y') {
        _resizeStartDim = seg.height;
        _resizeStartOffset = seg.offsetY;
      } else {
        _resizeStartDim = seg.depth;
        _resizeStartOffset = seg.offsetZ || 0;
      }
    }
  }

  // Build the appropriate geometry for a hitbox segment's shape
  function buildHitboxGeometry(seg) {
    var shape = seg.shape || 'box';
    if (shape === 'sphere') {
      return new THREE.SphereGeometry(seg.radius || 0.25, 16, 12);
    } else if (shape === 'cylinder') {
      var r = seg.radius || 0.3;
      var h = seg.height || 0.5;
      return new THREE.CylinderGeometry(r, r, h, 16);
    } else if (shape === 'capsule') {
      var cr = seg.radius || 0.3;
      var ch = seg.height || 0.5;
      return buildCapsuleGeometry(cr, ch, 16, 8);
    }
    return new THREE.BoxGeometry(seg.width, seg.height, seg.depth);
  }

  function onResizeMove(e, canvas) {
    if (!_isResizing || _selectedHitboxIndex < 0) return;
    var seg = _hitboxSegments[_selectedHitboxIndex];
    if (!seg) return;

    var ndc = getCanvasMouseNDC(e, canvas);
    var mouse2 = new THREE.Vector2(ndc.x, ndc.y);
    _hitboxRaycaster.setFromCamera(mouse2, _heroPreviewCamera);

    var intersect = new THREE.Vector3();
    if (!rayPlaneIntersect(_hitboxRaycaster, _resizePlane, intersect)) return;

    // Compute signed distance along the handle's axis from the start point
    var delta;
    if (_resizeAxis === 'x') delta = intersect.x - _resizeStartPoint.x;
    else if (_resizeAxis === 'y') delta = intersect.y - _resizeStartPoint.y;
    else delta = intersect.z - _resizeStartPoint.z;

    // Apply sign: positive handle grows outward, negative handle grows outward in opposite direction
    delta *= _resizeSign;

    var shape = seg.shape || 'box';

    if (shape === 'sphere') {
      // All handles control radius (no offset shift)
      var newRadius = Math.max(0.05, _resizeStartDim + delta);
      newRadius = snapTo(newRadius, 0.05);
      newRadius = Math.round(newRadius * 100) / 100;
      seg.radius = newRadius;
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (_resizeAxis === 'y') {
        // Y handles control height
        var newH = Math.max(0.1, _resizeStartDim + delta);
        newH = snapTo(newH, 0.05);
        newH = Math.round(newH * 100) / 100;
        // Capsule: enforce height >= 2*radius
        if (shape === 'capsule') {
          var minH = 2 * (seg.radius || 0.3);
          if (newH < minH) newH = minH;
        }
        var dimChange = newH - _resizeStartDim;
        var newOffset = _resizeStartOffset;
        if (_resizeSign < 0) newOffset = _resizeStartOffset - dimChange / 2;
        else newOffset = _resizeStartOffset + dimChange / 2;
        seg.height = newH;
        seg.offsetY = Math.max(0, Math.round(newOffset * 100) / 100);
      } else {
        // X handles control radius (no offset shift)
        var newR = Math.max(0.05, _resizeStartDim + delta);
        newR = snapTo(newR, 0.05);
        newR = Math.round(newR * 100) / 100;
        seg.radius = newR;
        // Capsule: enforce height >= 2*radius
        if (shape === 'capsule' && seg.height < 2 * newR) {
          seg.height = Math.round(2 * newR * 100) / 100;
        }
      }
    } else {
      // Box: existing logic
      var newDim = Math.max(0.1, _resizeStartDim + delta);
      newDim = snapTo(newDim, 0.05);
      newDim = Math.round(newDim * 100) / 100;

      var boxDimChange = newDim - _resizeStartDim;
      var boxNewOffset = _resizeStartOffset;
      if (_resizeSign < 0) {
        boxNewOffset = _resizeStartOffset - boxDimChange / 2;
      } else {
        boxNewOffset = _resizeStartOffset + boxDimChange / 2;
      }
      boxNewOffset = Math.round(boxNewOffset * 100) / 100;

      if (_resizeAxis === 'x') {
        seg.width = newDim;
        seg.offsetX = _snapCenter ? 0 : boxNewOffset;
      } else if (_resizeAxis === 'y') {
        seg.height = newDim;
        seg.offsetY = Math.max(0, boxNewOffset);
      } else {
        seg.depth = newDim;
        seg.offsetZ = _snapCenter ? 0 : boxNewOffset;
      }
    }

    // Rebuild hitbox mesh geometry
    var mesh = _hitboxPreviewMeshes[_selectedHitboxIndex];
    if (mesh) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = buildHitboxGeometry(seg);
      var feetY = getPreviewFeetY();
      mesh.position.set(seg.offsetX || 0, feetY + seg.offsetY, seg.offsetZ || 0);
    }

    // Reposition all handles
    repositionResizeHandles();

    // Sync form
    syncFormFromSegments();
  }

  // --- Sync form fields from current segment data ---

  function syncFormFromSegments() {
    var container = document.getElementById('heHitboxList');
    if (!container) return;
    var entries = container.querySelectorAll('.wmb-part');

    for (var i = 0; i < _hitboxSegments.length; i++) {
      if (!entries[i]) continue;
      var seg = _hitboxSegments[i];

      // Use data-key attributes for keyed lookup (shape-safe)
      var inputs = entries[i].querySelectorAll('input[data-key]');
      for (var j = 0; j < inputs.length; j++) {
        var key = inputs[j].getAttribute('data-key');
        if (key && seg[key] != null) {
          inputs[j].value = String(seg[key]);
        }
      }

      // Update shape dropdown
      var shapeSelect = entries[i].querySelector('select[data-key="shape"]');
      if (shapeSelect) shapeSelect.value = seg.shape || 'box';
    }
  }

  // --- Preview resize ---

  window._resizeHeroEditorPreview = function () {
    if (!_heroPreviewRenderer || !_heroPreviewCamera) return;
    var container = document.getElementById('heroPreviewContainer');
    if (!container) return;
    var w, h;
    if (container.classList.contains('viewport-mode')) {
      w = container.clientWidth;
      h = container.clientHeight;
    } else {
      w = 280;
      h = 260;
    }
    if (w <= 0 || h <= 0) return;
    var canvas = document.getElementById('heroPreviewCanvas');
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
    }
    _heroPreviewRenderer.setSize(w, h);
    _heroPreviewCamera.aspect = w / h;
    _heroPreviewCamera.updateProjectionMatrix();
  };

  window._resizeWmbPreview = function () {
    if (!_wmbRenderer || !_wmbCamera) return;
    var container = document.getElementById('wmbPreviewContainer');
    if (!container) return;
    var w, h;
    if (container.classList.contains('viewport-mode')) {
      w = container.clientWidth;
      h = container.clientHeight;
    } else {
      w = 280;
      h = 200;
    }
    if (w <= 0 || h <= 0) return;
    var canvas = document.getElementById('wmbPreviewCanvas');
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
    }
    _wmbRenderer.setSize(w, h);
    _wmbCamera.aspect = w / h;
    _wmbCamera.updateProjectionMatrix();
  };

  // --- Hero config form read/write ---

  function getHeroConfigFromForm() {
    var colorHex = document.getElementById('heColor').value || '#66ffcc';
    var tracerHex = document.getElementById('heTracerColor').value || '#66ffcc';
    var chColorHex = document.getElementById('heCrosshairColor').value || '#00ffaa';

    var scopeType = document.getElementById('heScopeType').value;
    var scopeConfig = null;
    if (scopeType !== 'none') {
      scopeConfig = {
        type: scopeType,
        zoomFOV: parseFloat(document.getElementById('heScopeFOV').value) || 35,
        overlay: null,
        spreadMultiplier: parseFloat(document.getElementById('heScopeSpreadMult').value) || 0.15
      };
    }

    return {
      id: document.getElementById('heId').value || 'custom_hero',
      name: document.getElementById('heName').value || 'Custom Hero',
      description: document.getElementById('heDesc').value || '',
      color: parseInt(colorHex.replace('#', ''), 16),

      maxHealth: parseInt(document.getElementById('heMaxHealth').value) || 100,
      walkSpeed: parseFloat(document.getElementById('heWalkSpeed').value) || 4.5,
      sprintSpeed: parseFloat(document.getElementById('heSprintSpeed').value) || 8.5,
      jumpVelocity: parseFloat(document.getElementById('heJumpVelocity').value) || 8.5,

      hitbox: _hitboxSegments.map(function (seg) {
        var shape = seg.shape || 'box';
        var out = {
          name: seg.name,
          shape: shape,
          offsetX: seg.offsetX || 0,
          offsetY: seg.offsetY,
          offsetZ: seg.offsetZ || 0,
          damageMultiplier: seg.damageMultiplier
        };
        if (shape === 'sphere') {
          out.radius = seg.radius || 0.25;
        } else if (shape === 'cylinder' || shape === 'capsule') {
          out.radius = seg.radius || 0.3;
          out.height = seg.height || 0.5;
        } else {
          out.width = seg.width;
          out.height = seg.height;
          out.depth = seg.depth;
        }
        return out;
      }),

      modelType: 'standard',

      weapon: {
        cooldownMs: parseInt(document.getElementById('heCooldownMs').value) || 166,
        magSize: parseInt(document.getElementById('heMagSize').value) || 6,
        reloadTimeSec: parseFloat(document.getElementById('heReloadTime').value) || 2.5,
        damage: parseInt(document.getElementById('heDamage').value) || 20,
        spreadRad: parseFloat(document.getElementById('heSpreadRad').value) || 0,
        sprintSpreadRad: parseFloat(document.getElementById('heSprintSpreadRad').value) || 0.012,
        maxRange: parseInt(document.getElementById('heMaxRange').value) || 200,
        pellets: parseInt(document.getElementById('hePellets').value) || 1,
        projectileSpeed: parseFloat(document.getElementById('heProjectileSpeed').value) || 0,
        projectileGravity: parseFloat(document.getElementById('heProjectileGravity').value) || 0,
        splashRadius: 0,
        scope: scopeConfig,
        modelType: document.getElementById('heModelType').value || 'rifle',
        tracerColor: parseInt(tracerHex.replace('#', ''), 16),
        crosshair: {
          style: document.getElementById('heCrosshairStyle').value || 'cross',
          baseSpreadPx: _stashedCrosshair.baseSpreadPx,
          sprintSpreadPx: _stashedCrosshair.sprintSpreadPx,
          color: chColorHex
        },
        abilities: []
      },

      passives: [],
      abilities: []
    };
  }

  function setFormFromHeroConfig(hero) {
    if (!hero) return;

    document.getElementById('heId').value = hero.id || '';
    document.getElementById('heName').value = hero.name || '';
    document.getElementById('heDesc').value = hero.description || '';
    document.getElementById('heColor').value = '#' + (hero.color || 0x66ffcc).toString(16).padStart(6, '0');

    document.getElementById('heMaxHealth').value = hero.maxHealth || 100;
    document.getElementById('heWalkSpeed').value = hero.walkSpeed || 4.5;
    document.getElementById('heSprintSpeed').value = hero.sprintSpeed || 8.5;
    document.getElementById('heJumpVelocity').value = hero.jumpVelocity || 8.5;

    // Load hitbox segments
    if (Array.isArray(hero.hitbox) && hero.hitbox.length > 0) {
      _hitboxSegments = hero.hitbox.map(function (seg) {
        var shape = seg.shape || 'box';
        var out = {
          name: seg.name || 'segment',
          shape: shape,
          offsetX: seg.offsetX || 0,
          offsetY: seg.offsetY || 1.0,
          offsetZ: seg.offsetZ || 0,
          damageMultiplier: seg.damageMultiplier || 1.0
        };
        if (shape === 'sphere') {
          out.radius = seg.radius || 0.25;
        } else if (shape === 'cylinder' || shape === 'capsule') {
          out.radius = seg.radius || 0.3;
          out.height = seg.height || 0.5;
        } else {
          out.width = seg.width || 0.5;
          out.height = seg.height || 0.5;
          out.depth = seg.depth || 0.5;
        }
        return out;
      });
    } else {
      // Legacy single-box format fallback
      _hitboxSegments = [
        { name: "head",  shape: "box", width: 0.5, height: 0.5, depth: 0.5, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
        { name: "torso", shape: "box", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
        { name: "legs",  shape: "box", width: 0.5, height: 1.1, depth: 0.5, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
      ];
    }
    _selectedHitboxIndex = -1;
    renderHitboxSegmentList();

    var w = hero.weapon || {};
    document.getElementById('heCooldownMs').value = w.cooldownMs || 166;
    document.getElementById('heMagSize').value = w.magSize || 6;
    document.getElementById('heReloadTime').value = w.reloadTimeSec || 2.5;
    document.getElementById('heDamage').value = w.damage || 20;
    document.getElementById('heSpreadRad').value = (typeof w.spreadRad === 'number') ? w.spreadRad : 0;
    document.getElementById('heSprintSpreadRad').value = (typeof w.sprintSpreadRad === 'number') ? w.sprintSpreadRad : 0.012;
    document.getElementById('heMaxRange').value = w.maxRange || 200;
    document.getElementById('hePellets').value = w.pellets || 1;
    document.getElementById('heProjectileSpeed').value = (typeof w.projectileSpeed === 'number') ? w.projectileSpeed : 120;
    document.getElementById('heProjectileGravity').value = (typeof w.projectileGravity === 'number') ? w.projectileGravity : 0;

    var scope = w.scope || {};
    document.getElementById('heScopeType').value = scope.type || 'none';
    document.getElementById('heScopeFOV').value = scope.zoomFOV || 35;
    document.getElementById('heScopeSpreadMult').value = scope.spreadMultiplier || 0.15;

    var ch = w.crosshair || {};
    document.getElementById('heCrosshairStyle').value = ch.style || 'cross';
    document.getElementById('heCrosshairColor').value = ch.color || '#00ffaa';
    _stashedCrosshair.baseSpreadPx = (typeof ch.baseSpreadPx === 'number') ? ch.baseSpreadPx : 8;
    _stashedCrosshair.sprintSpreadPx = (typeof ch.sprintSpreadPx === 'number') ? ch.sprintSpreadPx : 20;

    document.getElementById('heModelType').value = w.modelType || 'rifle';
    document.getElementById('heTracerColor').value = '#' + (w.tracerColor || 0x66ffcc).toString(16).padStart(6, '0');
  }

  // --- Hero preview update ---

  function updateHeroPreview() {
    if (!_heroPreviewScene) return;

    // Remove old preview player
    if (_heroPreviewPlayer) {
      if (_heroPreviewPlayer._meshGroup && _heroPreviewPlayer._meshGroup.parent) {
        _heroPreviewPlayer._meshGroup.parent.remove(_heroPreviewPlayer._meshGroup);
      }
      // Manually dispose
      if (_heroPreviewPlayer._meshGroup) {
        _heroPreviewPlayer._meshGroup.traverse(function (c) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
      }
    }

    var config = getHeroConfigFromForm();

    // Temporarily override global scene for Player constructor
    var origScene = window.scene;
    window.scene = _heroPreviewScene;

    _heroPreviewPlayer = new Player({
      position: new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 0),
      color: config.color,
      weapon: config.weapon
    });
    _heroPreviewPlayer.setVisible(true);

    // Restore global scene
    window.scene = origScene;

    // Apply color to body parts
    if (_heroPreviewPlayer._meshGroup) {
      _heroPreviewPlayer._meshGroup.traverse(function (child) {
        if (child.isMesh && child.material && child.userData && child.userData.isBodyPart) {
          if (child.material.color) {
            child.material.color.setHex(config.color);
          }
        }
      });
    }

    // Apply model visibility state
    if (!_modelVisible && _heroPreviewPlayer._meshGroup) {
      _heroPreviewPlayer._meshGroup.traverse(function (child) {
        if (child === _heroPreviewPlayer._meshGroup) return;
        if (child.userData && child.userData.isBodyPart) {
          child.visible = false;
        }
        if (child === _heroPreviewPlayer._weaponAttachPoint) {
          child.visible = false;
        }
      });
      if (_heroPreviewPlayer._healthBarGroup) {
        _heroPreviewPlayer._healthBarGroup.visible = false;
      }
    }

    // Remove old hitbox preview wireframes from scene-level hitbox group
    clearResizeHandles();
    if (_hitboxGroup) {
      while (_hitboxGroup.children.length > 0) {
        var old = _hitboxGroup.children[0];
        _hitboxGroup.remove(old);
        if (old.geometry) old.geometry.dispose();
        if (old.material) old.material.dispose();
      }
    }
    _hitboxPreviewMeshes = [];

    // Add wireframe shapes at scene level (world coordinates)
    var segColors = { head: 0xff4444, torso: 0x44ff44, legs: 0x4488ff };
    var defaultColor = 0xffff44;
    var feetY = getPreviewFeetY();

    for (var si = 0; si < _hitboxSegments.length; si++) {
      var seg = _hitboxSegments[si];
      var segColor = segColors[seg.name] || defaultColor;
      var geom = buildHitboxGeometry(seg);
      var mat = new THREE.MeshBasicMaterial({ color: segColor, wireframe: true, transparent: true, opacity: 0.3 });
      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(seg.offsetX || 0, feetY + seg.offsetY, seg.offsetZ || 0);
      _hitboxGroup.add(mesh);
      _hitboxPreviewMeshes.push(mesh);
    }

    // Restore selection visual and resize handles
    updateHitboxVisuals();
    if (_selectedHitboxIndex >= 0 && _selectedHitboxIndex < _hitboxSegments.length) {
      rebuildResizeHandles();
    }
  }

  // --- Hitbox Segment List ---

  var _hitboxSegmentColors = { head: 0xff4444, torso: 0x44ff44, legs: 0x4488ff };

  function addHitboxSegment() {
    pushUndo();
    _hitboxSegments.push({
      name: 'segment',
      shape: 'box',
      width: 0.5,
      height: 0.5,
      depth: 0.5,
      offsetX: 0,
      offsetY: 1.0,
      offsetZ: 0,
      damageMultiplier: 1.0
    });
    renderHitboxSegmentList();
    updateHeroPreview();
  }

  function removeHitboxSegment(index) {
    pushUndo();
    if (index === _selectedHitboxIndex) {
      _selectedHitboxIndex = -1;
      clearResizeHandles();
    } else if (index < _selectedHitboxIndex) {
      _selectedHitboxIndex--;
    }
    _hitboxSegments.splice(index, 1);
    renderHitboxSegmentList();
    updateHeroPreview();
  }

  // Get the fields to show for a given hitbox shape
  function getFieldsForShape(shape) {
    var common = [
      { label: 'Name', key: 'name', type: 'text' },
    ];
    var dimensionFields;
    if (shape === 'sphere') {
      dimensionFields = [
        { label: 'Radius', key: 'radius', step: 0.05, type: 'number' }
      ];
    } else if (shape === 'cylinder' || shape === 'capsule') {
      dimensionFields = [
        { label: 'Radius', key: 'radius', step: 0.05, type: 'number' },
        { label: 'Height', key: 'height', step: 0.1, type: 'number' }
      ];
    } else {
      dimensionFields = [
        { label: 'Width', key: 'width', step: 0.1, type: 'number' },
        { label: 'Height', key: 'height', step: 0.1, type: 'number' },
        { label: 'Depth', key: 'depth', step: 0.1, type: 'number' }
      ];
    }
    var offsetFields = [
      { label: 'Offset X', key: 'offsetX', step: 0.1, type: 'number' },
      { label: 'Offset Y', key: 'offsetY', step: 0.1, type: 'number' },
      { label: 'Offset Z', key: 'offsetZ', step: 0.1, type: 'number' },
      { label: 'Dmg Mult', key: 'damageMultiplier', step: 0.25, type: 'number' }
    ];
    return common.concat(dimensionFields, offsetFields);
  }

  function renderHitboxSegmentList() {
    var container = document.getElementById('heHitboxList');
    if (!container) return;
    container.innerHTML = '';

    _hitboxSegments.forEach(function (seg, i) {
      var div = document.createElement('div');
      div.className = 'wmb-part';

      var header = document.createElement('div');
      header.className = 'wmb-part-header';
      header.innerHTML = '<span>' + (seg.name || 'segment').toUpperCase() + ' #' + (i + 1) + '</span>';
      var removeBtn = document.createElement('button');
      removeBtn.className = 'wmb-part-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () { removeHitboxSegment(i); });
      header.appendChild(removeBtn);
      div.appendChild(header);

      // Shape dropdown
      var shapeRow = document.createElement('div');
      shapeRow.className = 'dev-field';
      var shapeLbl = document.createElement('label');
      shapeLbl.textContent = 'Shape';
      var shapeSelect = document.createElement('select');
      shapeSelect.setAttribute('data-key', 'shape');
      ['box', 'sphere', 'cylinder', 'capsule'].forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        if ((seg.shape || 'box') === s) opt.selected = true;
        shapeSelect.appendChild(opt);
      });
      shapeSelect.addEventListener('change', function () {
        pushUndo();
        var newShape = shapeSelect.value;
        var oldShape = seg.shape || 'box';

        seg.shape = newShape;

        // Migrate dimensions between shapes
        if (newShape === 'sphere') {
          if (!seg.radius) {
            seg.radius = (oldShape === 'box') ? Math.max(seg.width, seg.height, seg.depth) / 2 : 0.25;
          }
        } else if (newShape === 'cylinder' || newShape === 'capsule') {
          if (!seg.radius) {
            seg.radius = (oldShape === 'box') ? Math.max(seg.width, seg.depth) / 2 : 0.3;
          }
          if (!seg.height && oldShape === 'box') {
            seg.height = seg.height || 0.5;
          }
          if (newShape === 'capsule' && seg.height < 2 * seg.radius) {
            seg.height = 2 * seg.radius;
          }
        } else {
          // box
          if (!seg.width) seg.width = (oldShape !== 'box' && seg.radius) ? seg.radius * 2 : 0.5;
          if (!seg.height) seg.height = seg.height || 0.5;
          if (!seg.depth) seg.depth = (oldShape !== 'box' && seg.radius) ? seg.radius * 2 : 0.5;
        }

        renderHitboxSegmentList();
        updateHeroPreview();
      });
      shapeRow.appendChild(shapeLbl);
      shapeRow.appendChild(shapeSelect);
      div.appendChild(shapeRow);

      // Dimension + offset fields, conditional on shape
      var fields = getFieldsForShape(seg.shape || 'box');

      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'dev-field';
        var lbl = document.createElement('label');
        lbl.textContent = f.label;
        var inp = document.createElement('input');
        inp.type = f.type || 'number';
        inp.setAttribute('data-key', f.key);
        if (f.step) inp.step = String(f.step);
        inp.value = String(seg[f.key] != null ? seg[f.key] : 0);
        inp.addEventListener('input', function () {
          pushUndoForFormInput();
          if (f.type === 'text') {
            seg[f.key] = inp.value;
          } else {
            seg[f.key] = parseFloat(inp.value) || 0;
          }
          // Capsule: enforce height >= 2*radius
          if (seg.shape === 'capsule' && (f.key === 'radius' || f.key === 'height')) {
            if (seg.height < 2 * seg.radius) {
              if (f.key === 'radius') seg.height = Math.round(2 * seg.radius * 100) / 100;
              else seg.height = Math.round(2 * seg.radius * 100) / 100;
            }
          }
          updateHeroPreview();
        });
        row.appendChild(lbl);
        row.appendChild(inp);
        div.appendChild(row);
      });

      container.appendChild(div);
    });
  }

  function wireHeroEditorInputs() {
    // Collapsible sections
    var defaultCollapsed = ['Weapon', 'Scope', 'Crosshair', 'Visual'];
    var sectionHeaders = document.querySelectorAll('#heroEditorForm .dev-section-header');
    sectionHeaders.forEach(function (header) {
      var content = header.nextElementSibling;
      if (!content || !content.classList.contains('dev-section-content')) return;

      // Collapse default sections
      var sectionName = header.textContent.trim();
      if (defaultCollapsed.indexOf(sectionName) !== -1) {
        header.classList.add('collapsed');
        content.classList.add('collapsed');
      }

      header.addEventListener('click', function () {
        header.classList.toggle('collapsed');
        content.classList.toggle('collapsed');
      });
    });

    // Live preview on any input change
    var inputIds = [
      'heColor', 'heModelType', 'heTracerColor'
    ];
    inputIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          updateHeroPreview();
        });
        el.addEventListener('change', function () {
          updateHeroPreview();
        });
      }
    });

    // Hitbox segment add button
    var hitboxAddBtn = document.getElementById('heHitboxAdd');
    if (hitboxAddBtn) {
      hitboxAddBtn.addEventListener('click', function () { addHitboxSegment(); });
    }

    // Toggle model button
    var toggleModelBtn = document.getElementById('heToggleModel');
    if (toggleModelBtn) {
      toggleModelBtn.addEventListener('click', function () { toggleModelVisibility(); });
    }

    // Snap to center toggle
    var snapCenterBtn = document.getElementById('heSnapCenter');
    if (snapCenterBtn) {
      snapCenterBtn.addEventListener('click', function () {
        _snapCenter = !_snapCenter;
        snapCenterBtn.textContent = _snapCenter ? 'Snap Center: On' : 'Snap Center: Off';
        if (_snapCenter) {
          snapCenterBtn.classList.add('active');
        } else {
          snapCenterBtn.classList.remove('active');
        }
      });
    }

    // Undo / Redo buttons
    var undoBtn = document.getElementById('heUndo');
    var redoBtn = document.getElementById('heRedo');
    if (undoBtn) undoBtn.addEventListener('click', function () { hitboxUndo(); });
    if (redoBtn) redoBtn.addEventListener('click', function () { hitboxRedo(); });

    // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts for hitbox undo/redo
    var canvas = document.getElementById('heroPreviewCanvas');
    if (canvas) {
      window.addEventListener('keydown', function (e) {
        // Only handle when hero editor panel is active
        var panel = document.getElementById('panelHeroEditor');
        if (!panel || !panel.classList.contains('active')) return;

        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          hitboxUndo();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
          e.preventDefault();
          hitboxRedo();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
          e.preventDefault();
          hitboxRedo();
        }
      });
    }

    // Render initial hitbox segment list
    renderHitboxSegmentList();

    // Hero select dropdown
    var heroSelect = document.getElementById('heHeroSelect');
    if (heroSelect) {
      heroSelect.addEventListener('change', function () {
        var heroId = heroSelect.value;
        var hero = null;

        // Look up in unified heroes list
        if (typeof getHeroById === 'function') {
          hero = getHeroById(heroId);
        }

        if (hero) {
          setFormFromHeroConfig(hero);
          updateHeroPreview();
        }
      });
    }

    // Save button
    var saveBtn = document.getElementById('heSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var config = getHeroConfigFromForm();
        var id = config.id;
        if (!id) { alert('Hero ID is required'); return; }

        fetch('/api/heroes/' + encodeURIComponent(id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.ok) {
            // Update window.HEROES in place
            var heroes = window.HEROES || [];
            var existing = false;
            for (var i = 0; i < heroes.length; i++) {
              if (heroes[i].id === id) {
                heroes[i] = config;
                existing = true;
                break;
              }
            }
            if (!existing) heroes.push(config);
            window.HEROES = heroes;

            window.dispatchEvent(new Event('heroesUpdated'));
            alert('Hero saved: ' + id);
          }
        }).catch(function (err) {
          alert('Failed to save hero: ' + err.message);
        });
      });
    }

    // New button
    var newBtn = document.getElementById('heNew');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        document.getElementById('heId').value = 'custom_' + Date.now();
        document.getElementById('heName').value = 'New Hero';
        document.getElementById('heDesc').value = '';
        updateHeroPreview();
      });
    }

    // Delete button
    var deleteBtn = document.getElementById('heDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var heroId = document.getElementById('heHeroSelect').value;
        if (!heroId) return;

        if (!confirm('Delete hero "' + heroId + '"?')) return;

        fetch('/api/heroes/' + encodeURIComponent(heroId), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function () {
            window.HEROES = (window.HEROES || []).filter(function (h) { return h.id !== heroId; });
            window.dispatchEvent(new Event('heroesUpdated'));
            alert('Hero deleted');
          })
          .catch(function () { alert('Failed to delete hero'); });
      });
    }

    // Apply to split-screen P1
    var applyBtn = document.getElementById('heApplySS');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        if (!window._splitScreenActive) {
          alert('Start split-screen first');
          return;
        }
        var config = getHeroConfigFromForm();
        // Temporarily add to heroes if not present
        var heroes = window.HEROES || [];
        var found = false;
        for (var i = 0; i < heroes.length; i++) {
          if (heroes[i].id === config.id) {
            heroes[i] = config;
            found = true;
            break;
          }
        }
        if (!found) heroes.push(config);
        window.HEROES = heroes;

        // Override getHeroById temporarily to include this config
        var origGet = window.getHeroById;
        window.getHeroById = function (id) {
          if (id === config.id) return config;
          return origGet(id);
        };

        // Apply to P1 of split-screen
        // Access split-screen state indirectly
        alert('Hero config applied. Restart split-screen to take effect.');

        // Restore
        window.getHeroById = origGet;
      });
    }
  }

  // ========================
  // WEAPON MODEL BUILDER
  // ========================

  var _wmbRenderer = null;
  var _wmbScene = null;
  var _wmbCamera = null;
  var _wmbAnimId = 0;
  var _wmbParts = [];
  var _wmbPreviewGroup = null;

  // Orbit state
  var _wmbOrbitAngle = 0;
  var _wmbOrbitPitch = 0.3;
  var _wmbOrbitDist = 2;
  var _wmbDragging = false;
  var _wmbLastMouse = { x: 0, y: 0 };

  window._initWmbPreview = function () {
    var canvas = document.getElementById('wmbPreviewCanvas');
    if (!canvas) return;

    _wmbScene = new THREE.Scene();
    _wmbScene.background = new THREE.Color(0x1a1a1a);

    var hemi = new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.6);
    _wmbScene.add(hemi);
    var ambient = new THREE.AmbientLight(0xffffff, 0.4);
    _wmbScene.add(ambient);
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 5, 3);
    _wmbScene.add(dir);

    // Grid floor
    var grid = new THREE.GridHelper(2, 10, 0x333333, 0x222222);
    grid.position.y = -0.5;
    _wmbScene.add(grid);

    _wmbCamera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.01, 100);

    _wmbRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    _wmbRenderer.setSize(canvas.width, canvas.height);

    _wmbPreviewGroup = new THREE.Group();
    _wmbScene.add(_wmbPreviewGroup);

    // Orbit controls via mouse
    canvas.addEventListener('mousedown', function (e) {
      _wmbDragging = true;
      _wmbLastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', function () { _wmbDragging = false; });
    canvas.addEventListener('mousemove', function (e) {
      if (!_wmbDragging) return;
      var dx = e.clientX - _wmbLastMouse.x;
      var dy = e.clientY - _wmbLastMouse.y;
      _wmbOrbitAngle -= dx * 0.01;
      _wmbOrbitPitch = Math.max(-1.2, Math.min(1.2, _wmbOrbitPitch - dy * 0.01));
      _wmbLastMouse = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      _wmbOrbitDist = Math.max(0.5, Math.min(10, _wmbOrbitDist + e.deltaY * 0.005));
    });

    function animateWmb() {
      _wmbAnimId = requestAnimationFrame(animateWmb);
      // Update camera orbit position
      _wmbCamera.position.set(
        Math.sin(_wmbOrbitAngle) * Math.cos(_wmbOrbitPitch) * _wmbOrbitDist,
        Math.sin(_wmbOrbitPitch) * _wmbOrbitDist,
        Math.cos(_wmbOrbitAngle) * Math.cos(_wmbOrbitPitch) * _wmbOrbitDist
      );
      _wmbCamera.lookAt(0, 0, 0);
      _wmbRenderer.render(_wmbScene, _wmbCamera);
    }
    animateWmb();

    wireWmbInputs();
  };

  function getWmbModelDef() {
    return {
      modelType: document.getElementById('wmbName').value || 'custom_model',
      parts: _wmbParts.map(function (p) {
        return {
          type: p.type,
          size: [p.sx, p.sy, p.sz],
          position: [p.px, p.py, p.pz],
          rotation: [p.rx, p.ry, p.rz],
          color: p.color
        };
      })
    };
  }

  function addWmbPart(type) {
    _wmbParts.push({
      type: type,
      sx: 0.08, sy: 0.10, sz: 0.40,
      px: 0, py: 0, pz: 0,
      rx: 0, ry: 0, rz: 0,
      color: '#444444'
    });
    renderWmbPartsList();
    updateWmbPreview();
  }

  function removeWmbPart(index) {
    _wmbParts.splice(index, 1);
    renderWmbPartsList();
    updateWmbPreview();
  }

  function renderWmbPartsList() {
    var container = document.getElementById('wmbPartsList');
    if (!container) return;
    container.innerHTML = '';

    _wmbParts.forEach(function (part, i) {
      var div = document.createElement('div');
      div.className = 'wmb-part';

      var header = document.createElement('div');
      header.className = 'wmb-part-header';
      header.innerHTML = '<span>' + part.type.toUpperCase() + ' #' + (i + 1) + '</span>';
      var removeBtn = document.createElement('button');
      removeBtn.className = 'wmb-part-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () { removeWmbPart(i); });
      header.appendChild(removeBtn);
      div.appendChild(header);

      // Fields
      var fields = [
        { label: 'Size X', key: 'sx', step: 0.01 },
        { label: 'Size Y', key: 'sy', step: 0.01 },
        { label: 'Size Z', key: 'sz', step: 0.01 },
        { label: 'Pos X', key: 'px', step: 0.01 },
        { label: 'Pos Y', key: 'py', step: 0.01 },
        { label: 'Pos Z', key: 'pz', step: 0.01 },
        { label: 'Rot X', key: 'rx', step: 0.1 },
        { label: 'Rot Y', key: 'ry', step: 0.1 },
        { label: 'Rot Z', key: 'rz', step: 0.1 }
      ];

      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'dev-field';
        var lbl = document.createElement('label');
        lbl.textContent = f.label;
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.step = String(f.step);
        inp.value = String(part[f.key]);
        inp.addEventListener('input', function () {
          part[f.key] = parseFloat(inp.value) || 0;
          updateWmbPreview();
        });
        row.appendChild(lbl);
        row.appendChild(inp);
        div.appendChild(row);
      });

      // Color
      var colorRow = document.createElement('div');
      colorRow.className = 'dev-field';
      var colorLbl = document.createElement('label');
      colorLbl.textContent = 'Color';
      var colorInp = document.createElement('input');
      colorInp.type = 'color';
      colorInp.value = part.color;
      colorInp.addEventListener('input', function () {
        part.color = colorInp.value;
        updateWmbPreview();
      });
      colorRow.appendChild(colorLbl);
      colorRow.appendChild(colorInp);
      div.appendChild(colorRow);

      container.appendChild(div);
    });
  }

  function updateWmbPreview() {
    if (!_wmbPreviewGroup) return;

    // Clear old preview
    while (_wmbPreviewGroup.children.length > 0) {
      var child = _wmbPreviewGroup.children[0];
      _wmbPreviewGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    _wmbParts.forEach(function (part) {
      var geom, mesh;
      var mat = new THREE.MeshLambertMaterial({ color: part.color || '#444444' });

      if (part.type === 'cylinder') {
        var radius = part.sx / 2;
        geom = new THREE.CylinderGeometry(radius, radius, part.sy, 16);
      } else {
        geom = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
      }

      mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(part.px, part.py, part.pz);
      mesh.rotation.set(part.rx, part.ry, part.rz);
      _wmbPreviewGroup.add(mesh);
    });
  }

  function wireWmbInputs() {
    var addBoxBtn = document.getElementById('wmbAddBox');
    var addCylBtn = document.getElementById('wmbAddCyl');

    if (addBoxBtn) addBoxBtn.addEventListener('click', function () { addWmbPart('box'); });
    if (addCylBtn) addCylBtn.addEventListener('click', function () { addWmbPart('cylinder'); });

    // Register button
    var registerBtn = document.getElementById('wmbRegister');
    if (registerBtn) {
      registerBtn.addEventListener('click', function () {
        var def = getWmbModelDef();
        if (!def.modelType) { alert('Model name is required'); return; }
        if (typeof window.registerCustomWeaponModel === 'function') {
          window.registerCustomWeaponModel(def);
          alert('Model "' + def.modelType + '" registered. Available in hero editor Model Type dropdown.');
          // Refresh model type dropdowns
          if (typeof populateModelTypeDropdown === 'function') {
            populateModelTypeDropdown('heModelType');
          }
        }
      });
    }

    // Save button
    var saveBtn = document.getElementById('wmbSave');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var def = getWmbModelDef();
        if (!def.modelType) { alert('Model name is required'); return; }

        fetch('/api/weapon-models/' + encodeURIComponent(def.modelType), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(def)
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.ok) {
            alert('Weapon model saved: ' + def.modelType);
            refreshWmbLoadList();
          }
        }).catch(function (err) {
          alert('Failed to save: ' + err.message);
        });
      });
    }

    // Delete button
    var deleteBtn = document.getElementById('wmbDelete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var name = document.getElementById('wmbName').value;
        if (!name) return;
        if (!confirm('Delete weapon model "' + name + '"?')) return;

        fetch('/api/weapon-models/' + encodeURIComponent(name), { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function () {
            alert('Deleted');
            _wmbParts = [];
            renderWmbPartsList();
            updateWmbPreview();
            refreshWmbLoadList();
          })
          .catch(function () { alert('Failed to delete'); });
      });
    }

    // Load dropdown
    var loadSelect = document.getElementById('wmbLoadSelect');
    if (loadSelect) {
      loadSelect.addEventListener('change', function () {
        var name = loadSelect.value;
        if (!name) {
          _wmbParts = [];
          document.getElementById('wmbName').value = '';
          renderWmbPartsList();
          updateWmbPreview();
          return;
        }

        fetch('/api/weapon-models/' + encodeURIComponent(name))
          .then(function (r) { return r.json(); })
          .then(function (def) {
            document.getElementById('wmbName').value = def.modelType || name;
            _wmbParts = (def.parts || []).map(function (p) {
              return {
                type: p.type || 'box',
                sx: (p.size && p.size[0]) || 0.08,
                sy: (p.size && p.size[1]) || 0.10,
                sz: (p.size && p.size[2]) || 0.40,
                px: (p.position && p.position[0]) || 0,
                py: (p.position && p.position[1]) || 0,
                pz: (p.position && p.position[2]) || 0,
                rx: (p.rotation && p.rotation[0]) || 0,
                ry: (p.rotation && p.rotation[1]) || 0,
                rz: (p.rotation && p.rotation[2]) || 0,
                color: p.color || '#444444'
              };
            });
            renderWmbPartsList();
            updateWmbPreview();
          })
          .catch(function () { alert('Failed to load weapon model'); });
      });
    }

    refreshWmbLoadList();
  }

  function refreshWmbLoadList() {
    var sel = document.getElementById('wmbLoadSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- New --</option>';
    fetch('/api/weapon-models')
      .then(function (r) { return r.json(); })
      .then(function (names) {
        names.forEach(function (name) {
          var opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          sel.appendChild(opt);
        });
      })
      .catch(function () {});
  }

  window._refreshWmbLoadList = refreshWmbLoadList;

})();
