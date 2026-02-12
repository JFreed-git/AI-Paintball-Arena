/**
 * devHeroEditor.js — Hero/weapon stat editor + weapon model builder
 *
 * PURPOSE: Provides UI logic for:
 *   1. Hero Editor: edit hero stats, weapon config, visual settings, with live 3D preview
 *      - Toggle model visibility to inspect hitboxes
 *      - Full 3D drag to move hitbox segments in space (offsetX, offsetY, offsetZ)
 *      - Resize handles (colored spheres at face centers) to resize segments
 *      - View modes: Hitbox, Visual (body parts), Combined
 *      - First-person camera toggle for weapon preview
 *   2. Weapon Model Builder: compose weapon models from box/cylinder parts, live 3D preview,
 *      register into WEAPON_MODEL_REGISTRY, interactive select/drag/resize
 *
 * EXPORTS (window):
 *   _initHeroEditorPreview() — initialize the hero editor 3D preview
 *   _initWmbPreview()        — initialize the weapon model builder 3D preview
 *   _refreshWmbLoadList()    — refresh weapon model load dropdown
 *   _resizeHeroEditorPreview() — resize hero editor preview canvas
 *   _resizeWmbPreview()      — resize weapon model builder preview canvas
 *
 * DEPENDENCIES: Three.js, interactionEngine.js, weapon.js, weaponModels.js,
 *   heroes.js, player.js, devApp.js
 */

(function () {

  // Stash crosshair spread values that have no form fields, so they round-trip on save
  var _stashedCrosshair = { baseSpreadPx: 8, sprintSpreadPx: 20 };

  // Toggle gun/scope/tracer fields based on meleeOnly checkbox
  function toggleMeleeOnlyFields() {
    var isMeleeOnly = document.getElementById('heMeleeOnly').checked;
    var gunFields = document.getElementById('heGunFields');
    var scopeSection = document.getElementById('heScopeSection');
    var tracerField = document.getElementById('heTracerField');
    var meleeHeader = document.getElementById('heMeleeHeader');
    if (gunFields) gunFields.style.display = isMeleeOnly ? 'none' : '';
    if (scopeSection) scopeSection.style.display = isMeleeOnly ? 'none' : '';
    if (tracerField) tracerField.style.display = isMeleeOnly ? 'none' : '';
    if (meleeHeader) meleeHeader.textContent = isMeleeOnly ? 'Weapon (Melee)' : 'Melee';
  }

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
    if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.clearHandles();
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

  // Interaction engine controllers
  var _heroOrbitCtrl = null;
  var _hitboxInteractionCtrl = null;

  // Interactive hitbox editing state
  var _selectedHitboxIndex = -1;

  // Model visibility toggle
  var _modelVisible = true;

  // Snap-to-center toggle (forces offsetX=0, offsetZ=0 when dragging)
  var _snapCenter = false;

  // Resize start state — snapshot of segment/part at drag start, so resize
  // uses startValue + totalDelta instead of currentValue + totalDelta
  var _resizeStartSeg = null;
  var _bpResizeStartPart = null;

  // Body parts state
  var _bodyParts = [];
  var _bodyPartGroup = null;
  var _bodyPartPreviewMeshes = [];
  var _bodyInteractionCtrl = null;
  var _weaponPreviewGroup = null;

  // Camera offset state — world-space delta from the default camera position.
  // Default camera is at (playerX, feetY + EYE_HEIGHT, playerZ).
  // cameraOffset adds to that: (playerX + co.x, feetY + EYE_HEIGHT + co.y, playerZ + co.z)
  var _cameraOffset = { x: 0, y: 0, z: 0 }; // all zeros = default position
  var _cameraMarkerMesh = null;

  // View mode state
  var _viewMode = 'hitbox';
  var _hideWeapon = false;
  var _fpViewActive = false;

  // Body parts undo/redo
  var _bpUndoStack = [];
  var _bpRedoStack = [];

  // Player feetY in preview scene (GROUND_Y from physics.js)
  function getPreviewFeetY() {
    return (typeof GROUND_Y !== 'undefined') ? GROUND_Y : -1;
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

  // --- Handle definitions for hitbox shapes ---

  function getHandleDefsForShape(shape) {
    if (shape === 'sphere') {
      return [
        { axis: 'x', sign:  1, color: 0xff4444 },
        { axis: 'x', sign: -1, color: 0xff4444 },
        { axis: 'y', sign:  1, color: 0x44ff44 },
        { axis: 'y', sign: -1, color: 0x44ff44 }
      ];
    } else if (shape === 'cylinder' || shape === 'capsule') {
      return [
        { axis: 'x', sign:  1, color: 0xff4444 },
        { axis: 'x', sign: -1, color: 0xff4444 },
        { axis: 'y', sign:  1, color: 0x44ff44 },
        { axis: 'y', sign: -1, color: 0x44ff44 }
      ];
    }
    return [
      { axis: 'x', sign:  1, color: 0xff4444 },
      { axis: 'x', sign: -1, color: 0xff4444 },
      { axis: 'y', sign:  1, color: 0x44ff44 },
      { axis: 'y', sign: -1, color: 0x44ff44 },
      { axis: 'z', sign:  1, color: 0x4488ff },
      { axis: 'z', sign: -1, color: 0x4488ff }
    ];
  }

  function getHalfDimForHandle(seg, axis) {
    var shape = seg.shape || 'box';
    if (shape === 'sphere') {
      return seg.radius || 0.25;
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (axis === 'y') return (seg.height || 0.5) / 2;
      return seg.radius || 0.3;
    }
    if (axis === 'x') return seg.width / 2;
    if (axis === 'y') return seg.height / 2;
    return seg.depth / 2;
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

  // --- Selection and visuals ---

  function selectHitboxSegment(index) {
    _selectedHitboxIndex = index;
    updateHitboxVisuals();

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
    applyPlayerMeshVisibility(_modelVisible);
  }

  // --- Hitbox move callback (called by interaction engine) ---

  function onHitboxMove(index, newPos) {
    var seg = _hitboxSegments[index];
    if (!seg) return;

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
    } else if (shape === 'cylinder' || shape === 'capsule') {
      halfExtent = (seg.height || 0.5) / 2;
    } else {
      halfExtent = 0;
    }
    seg.offsetY = Math.max(halfExtent, rawOffsetY);

    seg.offsetZ = _snapCenter ? 0 : Math.round(newPos.z * 100) / 100;

    // Move hitbox mesh directly (no full rebuild)
    var mesh = _hitboxPreviewMeshes[index];
    if (mesh) {
      mesh.position.set(seg.offsetX || 0, feetY + seg.offsetY, seg.offsetZ || 0);
    }

    // Sync form fields
    syncFormFromSegments();
  }

  // --- Hitbox resize callback (called by interaction engine) ---

  function onHitboxResizeStart(index) {
    pushUndo();
    var seg = _hitboxSegments[index];
    if (!seg) return;
    _resizeStartSeg = JSON.parse(JSON.stringify(seg));
  }

  function onHitboxResize(index, axis, sign, delta) {
    var seg = _hitboxSegments[index];
    if (!seg || !_resizeStartSeg) return;
    var start = _resizeStartSeg;

    var shape = seg.shape || 'box';

    if (shape === 'sphere') {
      var newRadius = Math.max(0.05, (start.radius || 0.25) + delta);
      newRadius = snapTo(newRadius, 0.05);
      seg.radius = Math.round(newRadius * 100) / 100;
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (axis === 'y') {
        var startH = start.height || 0.5;
        var newH = Math.max(0.1, startH + delta);
        newH = snapTo(newH, 0.05);
        newH = Math.round(newH * 100) / 100;
        if (shape === 'capsule') {
          var minH = 2 * (seg.radius || 0.3);
          if (newH < minH) newH = minH;
        }
        var dimChange = newH - startH;
        if (sign < 0) seg.offsetY = Math.max(0, Math.round((start.offsetY - dimChange / 2) * 100) / 100);
        else seg.offsetY = Math.max(0, Math.round((start.offsetY + dimChange / 2) * 100) / 100);
        seg.height = newH;
      } else {
        var newR = Math.max(0.05, (start.radius || 0.3) + delta);
        newR = snapTo(newR, 0.05);
        seg.radius = Math.round(newR * 100) / 100;
        if (shape === 'capsule' && seg.height < 2 * seg.radius) {
          seg.height = Math.round(2 * seg.radius * 100) / 100;
        }
      }
    } else {
      // Box — use start values so total delta doesn't accumulate
      var dimKey = (axis === 'x') ? 'width' : (axis === 'y') ? 'height' : 'depth';
      var offKey = (axis === 'x') ? 'offsetX' : (axis === 'y') ? 'offsetY' : 'offsetZ';
      var startDim = start[dimKey] || 0.5;
      var startOff = start[offKey] || 0;
      var newDim = Math.max(0.1, startDim + delta);
      newDim = snapTo(newDim, 0.05);
      newDim = Math.round(newDim * 100) / 100;

      var boxDimChange = newDim - startDim;
      var boxNewOffset = startOff;
      if (sign < 0) boxNewOffset -= boxDimChange / 2;
      else boxNewOffset += boxDimChange / 2;
      boxNewOffset = Math.round(boxNewOffset * 100) / 100;

      seg[dimKey] = newDim;
      if (axis === 'y') {
        seg.offsetY = Math.max(0, boxNewOffset);
      } else if (_snapCenter) {
        // don't shift X/Z when snap center is on
      } else {
        seg[offKey] = boxNewOffset;
      }
    }

    // Rebuild hitbox mesh geometry
    var mesh = _hitboxPreviewMeshes[index];
    if (mesh) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = buildHitboxGeometry(seg);
      var feetY = getPreviewFeetY();
      mesh.position.set(seg.offsetX || 0, feetY + seg.offsetY, seg.offsetZ || 0);
    }

    // Sync form
    syncFormFromSegments();
  }

  var _hePreviewInited = false;
  window._initHeroEditorPreview = function () {
    if (_hePreviewInited) return;
    _hePreviewInited = true;
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

    // Body part group (for Visual mode)
    _bodyPartGroup = new THREE.Group();
    _heroPreviewScene.add(_bodyPartGroup);

    // Weapon preview group
    _weaponPreviewGroup = new THREE.Group();
    _heroPreviewScene.add(_weaponPreviewGroup);

    _heroPreviewCamera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 100);
    // Add camera to scene so its children (FP weapon viewmodel) render
    _heroPreviewScene.add(_heroPreviewCamera);

    _heroPreviewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    _heroPreviewRenderer.setSize(canvas.width, canvas.height);

    // Build initial preview player
    updateHeroPreview();

    // Create orbit controller
    _heroOrbitCtrl = createOrbitController({
      canvas: canvas,
      camera: _heroPreviewCamera,
      target: { x: 0, y: 1.5, z: 0 },
      initialAngle: 0,
      initialPitch: 0.3,
      initialDist: 6,
      minDist: 2,
      maxDist: 15
    });

    // Create hitbox interaction controller
    _hitboxInteractionCtrl = createInteractionController({
      canvas: canvas,
      camera: _heroPreviewCamera,
      getObjects: function () { return _hitboxPreviewMeshes; },
      getHandleParent: function () { return _hitboxGroup; },
      onSelect: function (index) {
        selectHitboxSegment(index);
      },
      onMoveStart: function (index) {
        pushUndo();
      },
      onMove: function (index, newPos) {
        onHitboxMove(index, newPos);
      },
      onMoveEnd: function () {},
      getHandleDefs: function (index) {
        if (index < 0 || index >= _hitboxSegments.length) return [];
        var seg = _hitboxSegments[index];
        return getHandleDefsForShape(seg.shape || 'box');
      },
      getObjectCenter: function (index) {
        if (index < 0 || index >= _hitboxSegments.length) return null;
        return getHitboxWorldPos(_hitboxSegments[index]);
      },
      getHalfDim: function (index, axis) {
        if (index < 0 || index >= _hitboxSegments.length) return 0;
        return getHalfDimForHandle(_hitboxSegments[index], axis);
      },
      onResizeStart: function (index) {
        onHitboxResizeStart(index);
      },
      onResize: function (index, axis, sign, delta) {
        onHitboxResize(index, axis, sign, delta);
      },
      onResizeEnd: function () {},
      snapGrid: 0.05,
      getSnapCenter: function () { return _snapCenter; },
      orbitController: _heroOrbitCtrl
    });
    _hitboxInteractionCtrl.enable();

    // Body part interaction controller (starts disabled, enabled in Visual mode)
    _bodyInteractionCtrl = createInteractionController({
      canvas: canvas,
      camera: _heroPreviewCamera,
      getObjects: function () { return _bodyPartPreviewMeshes; },
      getHandleParent: function () { return _bodyPartGroup; },
      onSelect: function (index) { selectBodyPart(index); },
      onMoveStart: function () { pushBodyPartUndo(); },
      onMove: function (index, newPos) { onBodyPartMove(index, newPos); },
      onMoveEnd: function () {},
      getHandleDefs: function (index) { return getBodyPartHandleDefs(index); },
      getObjectCenter: function (index) { return getBodyPartCenter(index); },
      getHalfDim: function (index, axis) { return getBodyPartHalfDim(index, axis); },
      onResizeStart: function (index) { onBodyPartResizeStart(index); },
      onResize: function (index, axis, sign, delta) { onBodyPartResize(index, axis, sign, delta); },
      onResizeEnd: function () {},
      snapGrid: 0.05,
      orbitController: _heroOrbitCtrl
    });
    // Starts disabled — hitbox mode is default

    // Animate with orbit camera
    function animatePreview() {
      _heroPreviewAnimId = requestAnimationFrame(animatePreview);
      if (_heroOrbitCtrl && _heroOrbitCtrl.isEnabled()) {
        _heroOrbitCtrl.update();
      }
      _heroPreviewRenderer.render(_heroPreviewScene, _heroPreviewCamera);
    }
    animatePreview();

    // Wire form inputs to live preview updates
    wireHeroEditorInputs();
  };

  // --- View mode switching ---

  function setViewMode(mode) {
    _viewMode = mode;

    // Update mode button active states
    var modeButtons = document.querySelectorAll('.he-mode-btn');
    modeButtons.forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });

    var hideModelBtn = document.getElementById('heToggleModel');
    var hideWeaponBtn = document.getElementById('heHideWeapon');
    var snapCenterBtn = document.getElementById('heSnapCenter');
    var rightContent = document.getElementById('devRightPanelContent');
    var bodyContent = document.getElementById('heBodyPartsContent');
    var rightTitle = document.querySelector('#devRightPanelHeader h3');

    if (mode === 'hitbox') {
      // Hitbox mode: show player mesh as reference, show hitbox wireframes, hide body part editor
      if (_bodyPartGroup) _bodyPartGroup.visible = false;
      if (_hitboxGroup) _hitboxGroup.visible = true;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = false;
      applyPlayerMeshVisibility(_modelVisible);
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.enable();
      if (_bodyInteractionCtrl) _bodyInteractionCtrl.disable();
      if (rightContent) rightContent.classList.remove('hidden');
      if (bodyContent) bodyContent.classList.add('hidden');
      if (rightTitle) rightTitle.textContent = 'Hitbox Segments';
      if (hideModelBtn) hideModelBtn.classList.remove('hidden');
      if (hideWeaponBtn) hideWeaponBtn.classList.add('hidden');
      if (snapCenterBtn) snapCenterBtn.classList.remove('hidden');
    } else if (mode === 'visual') {
      // Visual mode: show editable body parts, hide player mesh, optionally show weapon
      if (_bodyPartGroup) _bodyPartGroup.visible = true;
      if (_hitboxGroup) _hitboxGroup.visible = false;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = !_hideWeapon;
      applyPlayerMeshVisibility(false);
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.disable();
      if (_bodyInteractionCtrl) _bodyInteractionCtrl.enable();
      if (rightContent) rightContent.classList.add('hidden');
      if (bodyContent) bodyContent.classList.remove('hidden');
      if (rightTitle) rightTitle.textContent = 'Body Parts';
      if (hideModelBtn) hideModelBtn.classList.add('hidden');
      if (hideWeaponBtn) hideWeaponBtn.classList.remove('hidden');
      if (snapCenterBtn) snapCenterBtn.classList.remove('hidden');
    } else if (mode === 'combined') {
      // Combined mode: show body parts + hitbox wireframes overlaid, hide player mesh
      if (_bodyPartGroup) _bodyPartGroup.visible = true;
      if (_hitboxGroup) _hitboxGroup.visible = true;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = true;
      applyPlayerMeshVisibility(false);
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.disable();
      if (_bodyInteractionCtrl) _bodyInteractionCtrl.disable();
      // Show hitbox wireframes with reduced opacity in combined mode
      for (var i = 0; i < _hitboxPreviewMeshes.length; i++) {
        var m = _hitboxPreviewMeshes[i];
        if (m && m.material) {
          m.material.wireframe = true;
          m.material.opacity = 0.15;
        }
      }
      if (rightContent) rightContent.classList.remove('hidden');
      if (bodyContent) bodyContent.classList.remove('hidden');
      if (rightTitle) rightTitle.textContent = 'Combined View';
      if (hideModelBtn) hideModelBtn.classList.add('hidden');
      if (hideWeaponBtn) hideWeaponBtn.classList.remove('hidden');
      if (snapCenterBtn) snapCenterBtn.classList.add('hidden');
    }
  }

  function applyPlayerMeshVisibility(visible) {
    if (_heroPreviewPlayer && _heroPreviewPlayer._meshGroup) {
      _heroPreviewPlayer._meshGroup.traverse(function (child) {
        if (child === _heroPreviewPlayer._meshGroup) return;
        if (child.userData && child.userData.isBodyPart) {
          child.visible = visible;
        }
        if (child === _heroPreviewPlayer._weaponAttachPoint) {
          child.visible = visible;
        }
      });
      if (_heroPreviewPlayer._healthBarGroup) {
        _heroPreviewPlayer._healthBarGroup.visible = false;
      }
    }
  }

  // --- Body part stubs (fleshed out in Phase 4) ---

  var _selectedBodyPartIndex = -1;

  function isCameraMarkerIndex(index) {
    return index === _bodyParts.length;
  }

  function selectBodyPart(index) {
    _selectedBodyPartIndex = index;
    updateBodyPartVisuals();
    // Scroll to part in list
    if (index >= 0) {
      var container = document.getElementById('heBodyPartList');
      if (container) {
        var entries = container.querySelectorAll('.wmb-part');
        if (entries[index]) {
          entries[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          entries[index].style.outline = '2px solid #00ff88';
          setTimeout(function () { if (entries[index]) entries[index].style.outline = ''; }, 800);
        }
      }
    }
  }

  function updateBodyPartVisuals() {
    for (var i = 0; i < _bodyPartPreviewMeshes.length; i++) {
      var mesh = _bodyPartPreviewMeshes[i];
      if (!mesh) continue;
      // Camera marker uses invisible wrap mesh — skip material opacity changes
      if (mesh.userData && mesh.userData.isCameraMarker) continue;
      if (!mesh.material) continue;
      if (i === _selectedBodyPartIndex) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0.7;
      } else {
        mesh.material.transparent = false;
        mesh.material.opacity = 1.0;
      }
    }
  }

  function onBodyPartMove(index, newPos) {
    // Camera marker move
    if (isCameraMarkerIndex(index)) {
      var feetY = getPreviewFeetY();
      var eyeH = (typeof EYE_HEIGHT !== 'undefined') ? EYE_HEIGHT : 2.0;
      _cameraOffset.x = Math.round(newPos.x * 100) / 100;
      _cameraOffset.y = Math.round((newPos.y - feetY - eyeH) * 100) / 100;
      _cameraOffset.z = Math.round(newPos.z * 100) / 100;
      var mesh = _bodyPartPreviewMeshes[index];
      if (mesh) mesh.position.set(newPos.x, newPos.y, newPos.z);
      syncBodyPartFormFromData();
      return;
    }
    if (index < 0 || index >= _bodyParts.length) return;
    var part = _bodyParts[index];
    var feetY = getPreviewFeetY();
    var mfo = computeBodyPartsMfo();
    // Convert from world coords (2x scaled) back to local offsets
    part.offsetX = Math.round((newPos.x / 2) * 100) / 100;
    part.offsetY = Math.max(0, Math.round(((newPos.y - feetY - mfo) / 2) * 100) / 100);
    part.offsetZ = Math.round((newPos.z / 2) * 100) / 100;
    // Move mesh directly in world coords
    var mesh = _bodyPartPreviewMeshes[index];
    if (mesh) mesh.position.set(newPos.x, newPos.y, newPos.z);
    syncBodyPartFormFromData();
  }

  function onBodyPartResizeStart(index) {
    if (isCameraMarkerIndex(index)) return; // Camera marker can't be resized
    pushBodyPartUndo();
    if (index >= 0 && index < _bodyParts.length) {
      _bpResizeStartPart = JSON.parse(JSON.stringify(_bodyParts[index]));
    }
  }

  function onBodyPartResize(index, axis, sign, delta) {
    if (isCameraMarkerIndex(index)) return; // Camera marker can't be resized
    if (index < 0 || index >= _bodyParts.length) return;
    var part = _bodyParts[index];
    var start = _bpResizeStartPart;
    if (!start) return;
    var shape = part.shape || 'box';
    // Delta is in world coords (2x scaled), convert to local
    var localDelta = delta / 2;

    if (shape === 'sphere') {
      part.radius = Math.max(0.05, Math.round(((start.radius || 0.25) + localDelta) * 100) / 100);
    } else if (shape === 'cylinder' || shape === 'capsule') {
      if (axis === 'y') {
        part.height = Math.max(0.1, Math.round(((start.height || 0.5) + localDelta) * 100) / 100);
      } else {
        part.radius = Math.max(0.05, Math.round(((start.radius || 0.3) + localDelta) * 100) / 100);
      }
    } else {
      var dimKey = (axis === 'x') ? 'width' : (axis === 'y') ? 'height' : 'depth';
      part[dimKey] = Math.max(0.1, Math.round(((start[dimKey] || 0.5) + localDelta) * 100) / 100);
    }

    // Rebuild mesh geometry and reposition
    var mesh = _bodyPartPreviewMeshes[index];
    if (mesh) {
      if (mesh.geometry) mesh.geometry.dispose();
      mesh.geometry = buildBodyPartGeometry(part);
    }
    syncBodyPartFormFromData();
  }

  function getBodyPartHandleDefs(index) {
    if (isCameraMarkerIndex(index)) return []; // Camera marker: move only, no resize handles
    if (index < 0 || index >= _bodyParts.length) return [];
    return getHandleDefsForShape(_bodyParts[index].shape || 'box');
  }

  function getBodyPartCenter(index) {
    if (isCameraMarkerIndex(index)) return getCameraMarkerWorldPos();
    if (index < 0 || index >= _bodyParts.length) return null;
    return getBodyPartWorldPos(_bodyParts[index]);
  }

  function getBodyPartHalfDim(index, axis) {
    if (isCameraMarkerIndex(index)) return 0.25; // Small fixed size for camera marker
    if (index < 0 || index >= _bodyParts.length) return 0;
    // Return half-dim in world coords (2x scale)
    return getHalfDimForHandle(_bodyParts[index], axis) * 2;
  }

  function buildBodyPartGeometry(part) {
    return buildHitboxGeometry(part); // Same shape dispatch
  }

  function pushBodyPartUndo() {
    _bpUndoStack.push(JSON.stringify({ parts: _bodyParts, cam: _cameraOffset }));
    if (_bpUndoStack.length > MAX_UNDO) _bpUndoStack.shift();
    _bpRedoStack = [];
    updateBodyPartUndoRedoButtons();
  }

  function bodyPartUndo() {
    if (_bpUndoStack.length === 0) return;
    _bpRedoStack.push(JSON.stringify({ parts: _bodyParts, cam: _cameraOffset }));
    var state = JSON.parse(_bpUndoStack.pop());
    _bodyParts = state.parts || state;
    if (state.cam) _cameraOffset = state.cam;
    _selectedBodyPartIndex = -1;
    if (_bodyInteractionCtrl) _bodyInteractionCtrl.clearHandles();
    renderBodyPartList();
    updateBodyPartPreview();
    updateBodyPartUndoRedoButtons();
  }

  function bodyPartRedo() {
    if (_bpRedoStack.length === 0) return;
    _bpUndoStack.push(JSON.stringify({ parts: _bodyParts, cam: _cameraOffset }));
    var state = JSON.parse(_bpRedoStack.pop());
    _bodyParts = state.parts || state;
    if (state.cam) _cameraOffset = state.cam;
    _selectedBodyPartIndex = -1;
    if (_bodyInteractionCtrl) _bodyInteractionCtrl.clearHandles();
    renderBodyPartList();
    updateBodyPartPreview();
    updateBodyPartUndoRedoButtons();
  }

  function updateBodyPartUndoRedoButtons() {
    var undoBtn = document.getElementById('heBPUndo');
    var redoBtn = document.getElementById('heBPRedo');
    if (undoBtn) undoBtn.disabled = _bpUndoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _bpRedoStack.length === 0;
  }

  function renderBodyPartList() {
    var container = document.getElementById('heBodyPartList');
    if (!container) return;
    container.innerHTML = '';

    _bodyParts.forEach(function (part, i) {
      var div = document.createElement('div');
      div.className = 'wmb-part';

      var header = document.createElement('div');
      header.className = 'wmb-part-header';
      header.innerHTML = '<span>' + (part.name || 'part').toUpperCase() + ' #' + (i + 1) + '</span>';
      var removeBtn = document.createElement('button');
      removeBtn.className = 'wmb-part-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () { removeBodyPart(i); });
      header.appendChild(removeBtn);
      div.appendChild(header);

      // Shape dropdown
      var shapeRow = document.createElement('div');
      shapeRow.className = 'dev-field';
      var shapeLbl = document.createElement('label');
      shapeLbl.textContent = 'Shape';
      var shapeSelect = document.createElement('select');
      ['box', 'sphere', 'cylinder', 'capsule'].forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        if ((part.shape || 'box') === s) opt.selected = true;
        shapeSelect.appendChild(opt);
      });
      shapeSelect.addEventListener('change', function () {
        pushBodyPartUndo();
        part.shape = shapeSelect.value;
        if (part.shape === 'sphere' && !part.radius) part.radius = 0.25;
        if ((part.shape === 'cylinder' || part.shape === 'capsule') && !part.radius) part.radius = 0.3;
        if (part.shape === 'box' && !part.width) { part.width = 0.5; part.depth = 0.5; }
        renderBodyPartList();
        updateBodyPartPreview();
      });
      shapeRow.appendChild(shapeLbl);
      shapeRow.appendChild(shapeSelect);
      div.appendChild(shapeRow);

      // Dimension fields (displayed in world-space coordinates)
      var fields = getBodyPartFieldsForShape(part.shape || 'box');
      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'dev-field';
        var lbl = document.createElement('label');
        lbl.textContent = f.label;
        var inp = document.createElement('input');
        inp.type = f.type || 'number';
        if (f.step) inp.step = String(f.step);
        // Display in world-space: stored * worldScale (+ mfo for offsetY)
        var rawVal = part[f.key] != null ? part[f.key] : (f.def || 0);
        var displayVal = rawVal;
        if (f.worldScale) {
          displayVal = rawVal * f.worldScale;
          if (f.addMfo) displayVal += computeBodyPartsMfo();
        }
        inp.value = String(Math.round(displayVal * 100) / 100);
        inp.addEventListener('input', function () {
          pushBodyPartUndo();
          if (f.type === 'text') {
            part[f.key] = inp.value;
          } else {
            var inputVal = parseFloat(inp.value) || 0;
            if (f.worldScale) {
              if (f.addMfo) inputVal -= computeBodyPartsMfo();
              inputVal /= f.worldScale;
            }
            part[f.key] = inputVal;
          }
          updateBodyPartPreview();
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
      colorInp.value = part.color || '#66ffcc';
      colorInp.addEventListener('input', function () {
        part.color = colorInp.value;
        updateBodyPartPreview();
      });
      var resetColorBtn = document.createElement('button');
      resetColorBtn.textContent = 'Hero';
      resetColorBtn.className = 'wmb-part-remove';
      resetColorBtn.style.borderColor = '#666';
      resetColorBtn.style.color = '#aaa';
      resetColorBtn.addEventListener('click', function () {
        part.color = null;
        colorInp.value = document.getElementById('heColor').value || '#66ffcc';
        updateBodyPartPreview();
      });
      colorRow.appendChild(colorLbl);
      colorRow.appendChild(colorInp);
      colorRow.appendChild(resetColorBtn);
      div.appendChild(colorRow);

      // Rotation fields (unique to body parts)
      ['rotationX', 'rotationY', 'rotationZ'].forEach(function (rKey, ri) {
        var row = document.createElement('div');
        row.className = 'dev-field';
        var lbl = document.createElement('label');
        lbl.textContent = 'Rot ' + 'XYZ'[ri];
        var inp = document.createElement('input');
        inp.type = 'number';
        inp.step = '0.1';
        inp.value = String(part[rKey] || 0);
        inp.addEventListener('input', function () {
          part[rKey] = parseFloat(inp.value) || 0;
          updateBodyPartPreview();
        });
        row.appendChild(lbl);
        row.appendChild(inp);
        div.appendChild(row);
      });

      container.appendChild(div);
    });

    // Camera marker entry (always last)
    var camDiv = document.createElement('div');
    camDiv.className = 'wmb-part';
    camDiv.style.borderLeft = '3px solid #ffaa00';
    var camHeader = document.createElement('div');
    camHeader.className = 'wmb-part-header';
    camHeader.innerHTML = '<span style="color:#ffaa00">CAMERA EYE</span>';
    var camResetBtn = document.createElement('button');
    camResetBtn.className = 'wmb-part-remove';
    camResetBtn.textContent = 'Reset';
    camResetBtn.style.borderColor = '#666';
    camResetBtn.style.color = '#aaa';
    camResetBtn.addEventListener('click', function () {
      _cameraOffset = { x: 0, y: 0, z: 0 };
      renderBodyPartList();
      updateBodyPartPreview();
    });
    camHeader.appendChild(camResetBtn);
    camDiv.appendChild(camHeader);

    // Camera offset fields — world-space deltas from default position
    var camFields = [
      { label: 'Offset X', key: 'x' },
      { label: 'Offset Y', key: 'y' },
      { label: 'Offset Z', key: 'z' }
    ];
    var eyeH = (typeof EYE_HEIGHT !== 'undefined') ? EYE_HEIGHT : 2.0;
    camFields.forEach(function (f) {
      var row = document.createElement('div');
      row.className = 'dev-field';
      var lbl = document.createElement('label');
      lbl.textContent = f.label;
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.step = '0.1';
      inp.value = String(Math.round((_cameraOffset[f.key] || 0) * 100) / 100);
      inp.addEventListener('input', function () {
        _cameraOffset[f.key] = Math.round((parseFloat(inp.value) || 0) * 100) / 100;
        updateBodyPartPreview();
      });
      row.appendChild(lbl);
      row.appendChild(inp);
      camDiv.appendChild(row);
    });

    // Note about default
    var noteDiv = document.createElement('div');
    noteDiv.style.cssText = 'font-size:10px;color:#888;padding:2px 4px;';
    noteDiv.textContent = 'Offset from default eye pos (Y=' + eyeH.toFixed(1) + ')';
    camDiv.appendChild(noteDiv);

    container.appendChild(camDiv);
  }

  // Body part fields display in world-space coordinates (matching hitbox units).
  // Stored values are local (pre-2x mesh scale); worldScale converts for display.
  // offsetY also adds meshFeetOffset so it matches hitbox offsetY directly.
  function getBodyPartFieldsForShape(shape) {
    var common = [{ label: 'Name', key: 'name', type: 'text', def: 'part' }];
    var dimFields;
    if (shape === 'sphere') {
      dimFields = [{ label: 'Radius', key: 'radius', step: 0.1, def: 0.25, worldScale: 2 }];
    } else if (shape === 'cylinder' || shape === 'capsule') {
      dimFields = [
        { label: 'Radius', key: 'radius', step: 0.1, def: 0.3, worldScale: 2 },
        { label: 'Height', key: 'height', step: 0.1, def: 0.5, worldScale: 2 }
      ];
    } else {
      dimFields = [
        { label: 'Width', key: 'width', step: 0.1, def: 0.5, worldScale: 2 },
        { label: 'Height', key: 'height', step: 0.1, def: 0.5, worldScale: 2 },
        { label: 'Depth', key: 'depth', step: 0.1, def: 0.5, worldScale: 2 }
      ];
    }
    var offsetFields = [
      { label: 'Offset X', key: 'offsetX', step: 0.1, def: 0, worldScale: 2 },
      { label: 'Offset Y', key: 'offsetY', step: 0.1, def: 1.0, worldScale: 2, addMfo: true },
      { label: 'Offset Z', key: 'offsetZ', step: 0.1, def: 0, worldScale: 2 }
    ];
    return common.concat(dimFields, offsetFields);
  }

  function addBodyPart() {
    pushBodyPartUndo();
    _bodyParts.push({
      name: 'part', shape: 'box', width: 0.5, height: 0.5, depth: 0.5,
      offsetX: 0, offsetY: 1.0, offsetZ: 0,
      rotationX: 0, rotationY: 0, rotationZ: 0, color: null
    });
    renderBodyPartList();
    updateBodyPartPreview();
  }

  function removeBodyPart(index) {
    pushBodyPartUndo();
    if (index === _selectedBodyPartIndex) {
      _selectedBodyPartIndex = -1;
      if (_bodyInteractionCtrl) _bodyInteractionCtrl.clearHandles();
    } else if (index < _selectedBodyPartIndex) {
      _selectedBodyPartIndex--;
    }
    _bodyParts.splice(index, 1);
    renderBodyPartList();
    updateBodyPartPreview();
  }

  function syncBodyPartFormFromData() {
    // Simple re-render approach
    renderBodyPartList();
  }

  // Compute meshFeetOffset directly from the current _bodyParts array.
  // This avoids using a stale value from _heroPreviewPlayer when body parts
  // have been edited without rebuilding the Player.
  function computeBodyPartsMfo() {
    var parts = (_bodyParts && _bodyParts.length > 0) ? _bodyParts : null;
    if (!parts) {
      return (_heroPreviewPlayer && _heroPreviewPlayer._meshFeetOffset) || 0;
    }
    var minY = Infinity;
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var shape = part.shape || 'box';
      var localY = part.offsetY || 0;
      var halfExtent;
      if (shape === 'sphere') {
        halfExtent = part.radius || 0.25;
      } else if (shape === 'cylinder' || shape === 'capsule') {
        halfExtent = (part.height || 0.5) / 2;
      } else {
        halfExtent = (part.height || 0.5) / 2;
      }
      var worldBottom = (localY - halfExtent) * 2; // 2x mesh scale
      if (worldBottom < minY) minY = worldBottom;
    }
    return (minY === Infinity) ? 0 : -minY;
  }

  // Helper to get the player mesh group's Y origin in world coords.
  // Body parts use LOCAL coords (pre-2x scale), so we need the same
  // transform as the player mesh: group at (0, feetY + meshFeetOffset, 0), scale 2x.
  function getBodyPartWorldPos(part) {
    var feetY = getPreviewFeetY();
    var mfo = computeBodyPartsMfo();
    return new THREE.Vector3(
      (part.offsetX || 0) * 2,
      feetY + mfo + (part.offsetY || 0) * 2,
      (part.offsetZ || 0) * 2
    );
  }

  function updateBodyPartPreview() {
    if (!_bodyPartGroup) return;

    // Clear old meshes
    while (_bodyPartGroup.children.length > 0) {
      var old = _bodyPartGroup.children[0];
      _bodyPartGroup.remove(old);
      if (old.geometry) old.geometry.dispose();
      if (old.material) old.material.dispose();
    }
    _bodyPartPreviewMeshes = [];

    var heroColor = '#66ffcc';
    var heColorEl = document.getElementById('heColor');
    if (heColorEl) heroColor = heColorEl.value;

    for (var i = 0; i < _bodyParts.length; i++) {
      var part = _bodyParts[i];
      var geom = buildBodyPartGeometry(part);
      var color = part.color || heroColor;
      var mat = new THREE.MeshLambertMaterial({ color: color });
      var mesh = new THREE.Mesh(geom, mat);
      // Position in world coords matching the player mesh (2x scale)
      var wp = getBodyPartWorldPos(part);
      mesh.position.copy(wp);
      mesh.rotation.set(part.rotationX || 0, part.rotationY || 0, part.rotationZ || 0);
      mesh.scale.set(2, 2, 2);
      _bodyPartGroup.add(mesh);
      _bodyPartPreviewMeshes.push(mesh);
    }

    // Add camera marker mesh (always last in the meshes array)
    _cameraMarkerMesh = buildCameraMarkerMesh();
    var camWp = getCameraMarkerWorldPos();
    _cameraMarkerMesh.position.copy(camWp);
    _bodyPartGroup.add(_cameraMarkerMesh);
    _bodyPartPreviewMeshes.push(_cameraMarkerMesh);

    updateBodyPartVisuals();
  }

  // Build a distinctive camera marker mesh — a small eye/lens shape
  function buildCameraMarkerMesh() {
    var group = new THREE.Group();
    // Main body: small box
    var bodyGeom = new THREE.BoxGeometry(0.3, 0.2, 0.25);
    var bodyMat = new THREE.MeshLambertMaterial({ color: 0xffaa00 });
    var bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
    group.add(bodyMesh);
    // Lens: cylinder pointing forward (-Z)
    var lensGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 8);
    var lensMat = new THREE.MeshLambertMaterial({ color: 0x2244ff });
    var lensMesh = new THREE.Mesh(lensGeom, lensMat);
    lensMesh.rotation.x = Math.PI / 2;
    lensMesh.position.z = -0.2;
    group.add(lensMesh);
    // Make it a single selectable object by using the group trick:
    // The interaction controller needs a .geometry for raycasting, so wrap in a transparent sphere
    var wrapGeom = new THREE.SphereGeometry(0.25, 8, 8);
    var wrapMat = new THREE.MeshBasicMaterial({ visible: false });
    var wrapMesh = new THREE.Mesh(wrapGeom, wrapMat);
    wrapMesh.add(group);
    wrapMesh.userData.isCameraMarker = true;
    return wrapMesh;
  }

  // Get camera marker world position in the editor scene.
  // Default camera is at (0, feetY + EYE_HEIGHT, 0); offset is added in world-space.
  function getCameraMarkerWorldPos() {
    var feetY = getPreviewFeetY();
    var eyeH = (typeof EYE_HEIGHT !== 'undefined') ? EYE_HEIGHT : 2.0;
    return new THREE.Vector3(
      _cameraOffset.x || 0,
      feetY + eyeH + (_cameraOffset.y || 0),
      _cameraOffset.z || 0
    );
  }

  // --- FP View toggle ---

  var _fpViewYaw = 0;
  var _fpViewPitch = 0;
  var _fpWeaponGroup = null;

  function toggleFPView() {
    _fpViewActive = !_fpViewActive;
    var btn = document.getElementById('heFPView');

    if (_fpViewActive) {
      if (btn) btn.textContent = 'Orbit View';
      if (_heroOrbitCtrl) _heroOrbitCtrl.disable();
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.disable();
      if (_bodyInteractionCtrl) _bodyInteractionCtrl.disable();

      // Position camera at eye height
      var feetY = getPreviewFeetY();
      _heroPreviewCamera.position.set(0, feetY + (typeof EYE_HEIGHT !== 'undefined' ? EYE_HEIGHT : 1.6) * 2, 0);
      _fpViewYaw = Math.PI; // Look along +Z initially
      _fpViewPitch = 0;
      updateFPCameraRotation();

      // Build FP weapon viewmodel
      var modelType = document.getElementById('heModelType');
      var mt = modelType ? modelType.value : 'default';
      if (typeof buildWeaponModel === 'function') {
        _fpWeaponGroup = new THREE.Group();
        var model = buildWeaponModel(mt);
        _fpWeaponGroup.add(model);

        // Get FP offset from form or defaults
        var fpOx = parseFloat((document.getElementById('heFPOffsetX') || {}).value) || 0.28;
        var fpOy = parseFloat((document.getElementById('heFPOffsetY') || {}).value) || -0.22;
        var fpOz = parseFloat((document.getElementById('heFPOffsetZ') || {}).value) || -0.45;
        var fpRx = parseFloat((document.getElementById('heFPRotX') || {}).value) || 0.05;
        var fpRy = parseFloat((document.getElementById('heFPRotY') || {}).value) || -0.15;
        var fpRz = parseFloat((document.getElementById('heFPRotZ') || {}).value) || 0;

        _fpWeaponGroup.position.set(fpOx, fpOy, fpOz);
        _fpWeaponGroup.rotation.set(fpRx, fpRy, fpRz);

        _fpWeaponGroup.traverse(function (c) {
          if (c.isMesh && c.material) {
            c.material = c.material.clone();
            c.material.depthTest = false;
            c.material.depthWrite = false;
            c.renderOrder = 999;
          }
        });
        _heroPreviewCamera.add(_fpWeaponGroup);
      }

      // Hide body parts in FP (can't see yourself)
      if (_bodyPartGroup) _bodyPartGroup.visible = false;
      if (_heroPreviewPlayer && _heroPreviewPlayer._meshGroup) {
        _heroPreviewPlayer._meshGroup.visible = false;
      }
    } else {
      if (btn) btn.textContent = 'FP View';
      // Remove FP weapon
      if (_fpWeaponGroup && _heroPreviewCamera) {
        _heroPreviewCamera.remove(_fpWeaponGroup);
        _fpWeaponGroup.traverse(function (c) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
        _fpWeaponGroup = null;
      }

      // Re-enable orbit and restore view mode
      if (_heroOrbitCtrl) _heroOrbitCtrl.enable();
      setViewMode(_viewMode); // Restore correct visibility + interaction state
    }
  }

  function updateFPCameraRotation() {
    _heroPreviewCamera.rotation.set(0, 0, 0);
    _heroPreviewCamera.rotateY(_fpViewYaw);
    _heroPreviewCamera.rotateX(_fpViewPitch);
  }

  // FP mouse look (only when FP view is active)
  (function () {
    var _fpDragging = false;
    var _fpLastMouse = { x: 0, y: 0 };

    document.addEventListener('mousedown', function (e) {
      if (!_fpViewActive) return;
      var canvas = document.getElementById('heroPreviewCanvas');
      if (!canvas || e.target !== canvas) return;
      _fpDragging = true;
      _fpLastMouse = { x: e.clientX, y: e.clientY };
    });
    document.addEventListener('mouseup', function () { _fpDragging = false; });
    document.addEventListener('mousemove', function (e) {
      if (!_fpViewActive || !_fpDragging) return;
      var dx = e.clientX - _fpLastMouse.x;
      var dy = e.clientY - _fpLastMouse.y;
      _fpViewYaw -= dx * 0.005;
      _fpViewPitch = Math.max(-1.4, Math.min(1.4, _fpViewPitch - dy * 0.005));
      _fpLastMouse = { x: e.clientX, y: e.clientY };
      updateFPCameraRotation();
    });
  })();

  // --- Sync form fields from current segment data ---

  function syncFormFromSegments() {
    var container = document.getElementById('heHitboxList');
    if (!container) return;
    var entries = container.querySelectorAll('.wmb-part');

    for (var i = 0; i < _hitboxSegments.length; i++) {
      if (!entries[i]) continue;
      var seg = _hitboxSegments[i];

      var inputs = entries[i].querySelectorAll('input[data-key]');
      for (var j = 0; j < inputs.length; j++) {
        var key = inputs[j].getAttribute('data-key');
        if (key && seg[key] != null) {
          inputs[j].value = String(seg[key]);
        }
      }

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

    // Read FP offset/rotation if fields exist
    var fpOffset = null;
    var fpRotation = null;
    var fpOxEl = document.getElementById('heFPOffsetX');
    if (fpOxEl) {
      fpOffset = {
        x: parseFloat(fpOxEl.value) || 0.28,
        y: parseFloat((document.getElementById('heFPOffsetY') || {}).value) || -0.22,
        z: parseFloat((document.getElementById('heFPOffsetZ') || {}).value) || -0.45
      };
      fpRotation = {
        x: parseFloat((document.getElementById('heFPRotX') || {}).value) || 0.05,
        y: parseFloat((document.getElementById('heFPRotY') || {}).value) || -0.15,
        z: parseFloat((document.getElementById('heFPRotZ') || {}).value) || 0
      };
    }

    var weaponConfig = {
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
      meleeOnly: document.getElementById('heMeleeOnly').checked,
      meleeDamage: parseInt(document.getElementById('heMeleeDamage').value) || 30,
      meleeRange: parseFloat(document.getElementById('heMeleeRange').value) || 2.5,
      meleeCooldownMs: parseInt(document.getElementById('heMeleeCooldownMs').value) || 600,
      meleeSwingMs: parseInt(document.getElementById('heMeleeSwingMs').value) || 350,
      meleeUseHitMultiplier: document.getElementById('heMeleeUseHitMult').checked,
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
    };

    if (fpOffset) weaponConfig.fpOffset = fpOffset;
    if (fpRotation) weaponConfig.fpRotation = fpRotation;

    var config = {
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
      weapon: weaponConfig,
      passives: [],
      abilities: []
    };

    // Include body parts if any
    if (_bodyParts.length > 0) {
      config.bodyParts = _bodyParts.map(function (p) {
        var out = {
          name: p.name || 'part',
          shape: p.shape || 'box',
          offsetX: p.offsetX || 0,
          offsetY: p.offsetY || 0,
          offsetZ: p.offsetZ || 0,
          rotationX: p.rotationX || 0,
          rotationY: p.rotationY || 0,
          rotationZ: p.rotationZ || 0
        };
        if (p.color) out.color = p.color;
        var shape = p.shape || 'box';
        if (shape === 'sphere') out.radius = p.radius || 0.25;
        else if (shape === 'cylinder' || shape === 'capsule') { out.radius = p.radius || 0.3; out.height = p.height || 0.5; }
        else { out.width = p.width || 0.5; out.height = p.height || 0.5; out.depth = p.depth || 0.5; }
        return out;
      });
    }

    // Include camera offset if customized (non-zero)
    if (_cameraOffset.x !== 0 || _cameraOffset.y !== 0 || _cameraOffset.z !== 0) {
      config.cameraOffset = {
        x: _cameraOffset.x,
        y: _cameraOffset.y,
        z: _cameraOffset.z
      };
    }

    return config;
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
      _hitboxSegments = [
        { name: "head",  shape: "box", width: 0.5, height: 0.5, depth: 0.5, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
        { name: "torso", shape: "box", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
        { name: "legs",  shape: "box", width: 0.5, height: 1.1, depth: 0.5, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
      ];
    }
    _selectedHitboxIndex = -1;
    if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.clearHandles();
    renderHitboxSegmentList();

    // Load body parts
    if (Array.isArray(hero.bodyParts) && hero.bodyParts.length > 0) {
      _bodyParts = hero.bodyParts.map(function (p) {
        return {
          name: p.name || 'part',
          shape: p.shape || 'box',
          width: p.width || 0.5,
          height: p.height || 0.5,
          depth: p.depth || 0.5,
          radius: p.radius || 0.25,
          offsetX: p.offsetX || 0,
          offsetY: p.offsetY || 0,
          offsetZ: p.offsetZ || 0,
          rotationX: p.rotationX || 0,
          rotationY: p.rotationY || 0,
          rotationZ: p.rotationZ || 0,
          color: p.color || null
        };
      });
    } else {
      _bodyParts = [];
    }
    _selectedBodyPartIndex = -1;
    if (_bodyInteractionCtrl) _bodyInteractionCtrl.clearHandles();

    // Load camera offset
    if (hero.cameraOffset) {
      _cameraOffset = {
        x: hero.cameraOffset.x || 0,
        y: hero.cameraOffset.y || 0,
        z: hero.cameraOffset.z || 0
      };
    } else {
      _cameraOffset = { x: 0, y: 0, z: 0 };
    }

    renderBodyPartList();

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

    document.getElementById('heMeleeOnly').checked = !!w.meleeOnly;
    toggleMeleeOnlyFields();
    document.getElementById('heMeleeDamage').value = (typeof w.meleeDamage === 'number') ? w.meleeDamage : 30;
    document.getElementById('heMeleeRange').value = (typeof w.meleeRange === 'number') ? w.meleeRange : 2.5;
    document.getElementById('heMeleeCooldownMs').value = (typeof w.meleeCooldownMs === 'number') ? w.meleeCooldownMs : 600;
    document.getElementById('heMeleeSwingMs').value = (typeof w.meleeSwingMs === 'number') ? w.meleeSwingMs : 350;
    document.getElementById('heMeleeUseHitMult').checked = (w.meleeUseHitMultiplier !== undefined) ? !!w.meleeUseHitMultiplier : true;

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

    // FP offset/rotation fields
    var fpO = w.fpOffset || {};
    var fpR = w.fpRotation || {};
    var fpFields = {
      'heFPOffsetX': fpO.x, 'heFPOffsetY': fpO.y, 'heFPOffsetZ': fpO.z,
      'heFPRotX': fpR.x, 'heFPRotY': fpR.y, 'heFPRotZ': fpR.z
    };
    for (var fk in fpFields) {
      var el = document.getElementById(fk);
      if (el && typeof fpFields[fk] === 'number') el.value = fpFields[fk];
    }
  }

  // --- Hero preview update ---

  function updateHeroPreview() {
    if (!_heroPreviewScene) return;

    // Remove old preview player
    if (_heroPreviewPlayer) {
      if (_heroPreviewPlayer._meshGroup && _heroPreviewPlayer._meshGroup.parent) {
        _heroPreviewPlayer._meshGroup.parent.remove(_heroPreviewPlayer._meshGroup);
      }
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
      weapon: config.weapon,
      bodyParts: config.bodyParts || null
    });
    _heroPreviewPlayer.setVisible(true);

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

    // Apply visibility based on current view mode
    if (_viewMode === 'hitbox') {
      applyPlayerMeshVisibility(_modelVisible);
    } else {
      // In visual and combined modes, player mesh is hidden (body part group is shown instead)
      applyPlayerMeshVisibility(false);
    }

    // Remove old hitbox preview wireframes from scene-level hitbox group
    if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.clearHandles();
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
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.rebuildHandles();
    }

    // Update body part preview
    updateBodyPartPreview();

    // Update weapon preview
    updateWeaponPreview();

    // Re-apply visibility for current view mode (rebuild may have reset it)
    if (_viewMode === 'hitbox') {
      if (_bodyPartGroup) _bodyPartGroup.visible = false;
      if (_hitboxGroup) _hitboxGroup.visible = true;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = false;
    } else if (_viewMode === 'visual') {
      if (_bodyPartGroup) _bodyPartGroup.visible = true;
      if (_hitboxGroup) _hitboxGroup.visible = false;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = !_hideWeapon;
    } else if (_viewMode === 'combined') {
      if (_bodyPartGroup) _bodyPartGroup.visible = true;
      if (_hitboxGroup) _hitboxGroup.visible = true;
      if (_weaponPreviewGroup) _weaponPreviewGroup.visible = true;
    }
  }

  function updateWeaponPreview() {
    if (!_weaponPreviewGroup) return;
    // Clear old
    while (_weaponPreviewGroup.children.length > 0) {
      var old = _weaponPreviewGroup.children[0];
      _weaponPreviewGroup.remove(old);
      if (old.traverse) old.traverse(function (c) { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }

    var modelType = document.getElementById('heModelType');
    var mt = modelType ? modelType.value : 'default';
    if (typeof buildWeaponModel === 'function') {
      var model = buildWeaponModel(mt);
      // Position weapon to match where the player mesh places it:
      // Player mesh has weapon attach at local (0.35, 1.4, -0.1), mesh scaled 2x,
      // mesh group positioned at (0, feetY + meshFeetOffset, 0).
      // Read the actual world position from the player if available.
      var wpX = 0.7, wpY = 0, wpZ = -0.2;
      if (_heroPreviewPlayer && _heroPreviewPlayer._weaponAttachPoint) {
        var wp = new THREE.Vector3();
        _heroPreviewPlayer._weaponAttachPoint.getWorldPosition(wp);
        wpX = wp.x;
        wpY = wp.y;
        wpZ = wp.z;
      } else {
        var feetY = getPreviewFeetY();
        var mfo = (_heroPreviewPlayer && _heroPreviewPlayer._meshFeetOffset) || 0;
        wpY = feetY + mfo + 1.4 * 2;
      }
      model.position.set(wpX, wpY, wpZ);
      model.scale.set(2, 2, 2);
      _weaponPreviewGroup.add(model);
    }
  }

  // --- Hitbox Segment List ---

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
      if (_hitboxInteractionCtrl) _hitboxInteractionCtrl.clearHandles();
    } else if (index < _selectedHitboxIndex) {
      _selectedHitboxIndex--;
    }
    _hitboxSegments.splice(index, 1);
    renderHitboxSegmentList();
    updateHeroPreview();
  }

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

        if (newShape === 'sphere') {
          if (!seg.radius) {
            seg.radius = (oldShape === 'box') ? Math.max(seg.width, seg.height, seg.depth) / 2 : 0.25;
          }
        } else if (newShape === 'cylinder' || newShape === 'capsule') {
          if (!seg.radius) {
            seg.radius = (oldShape === 'box') ? Math.max(seg.width, seg.depth) / 2 : 0.3;
          }
          if (!seg.height) {
            seg.height = (oldShape === 'box') ? seg.height : (seg.radius ? seg.radius * 2 : 0.5);
          }
          if (newShape === 'capsule' && seg.height < 2 * seg.radius) {
            seg.height = 2 * seg.radius;
          }
        } else {
          if (!seg.width) seg.width = (oldShape !== 'box' && seg.radius) ? seg.radius * 2 : 0.5;
          if (!seg.height) seg.height = (oldShape !== 'box' && seg.radius) ? seg.radius * 2 : 0.5;
          if (!seg.depth) seg.depth = (oldShape !== 'box' && seg.radius) ? seg.radius * 2 : 0.5;
        }

        renderHitboxSegmentList();
        updateHeroPreview();
      });
      shapeRow.appendChild(shapeLbl);
      shapeRow.appendChild(shapeSelect);
      div.appendChild(shapeRow);

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

    // Toggle gun/scope/tracer fields when meleeOnly checkbox changes
    var meleeOnlyCb = document.getElementById('heMeleeOnly');
    if (meleeOnlyCb) {
      meleeOnlyCb.addEventListener('change', function () { toggleMeleeOnlyFields(); });
    }

    // Live preview on any input change
    var inputIds = ['heColor', 'heModelType', 'heTracerColor'];
    inputIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () { updateHeroPreview(); });
        el.addEventListener('change', function () { updateHeroPreview(); });
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

    // Hide weapon button
    var hideWeaponBtn = document.getElementById('heHideWeapon');
    if (hideWeaponBtn) {
      hideWeaponBtn.addEventListener('click', function () {
        _hideWeapon = !_hideWeapon;
        hideWeaponBtn.textContent = _hideWeapon ? 'Show Weapon' : 'Hide Weapon';
        if (_weaponPreviewGroup) _weaponPreviewGroup.visible = !_hideWeapon;
      });
    }

    // Snap to center toggle
    var snapCenterBtn = document.getElementById('heSnapCenter');
    if (snapCenterBtn) {
      snapCenterBtn.addEventListener('click', function () {
        _snapCenter = !_snapCenter;
        snapCenterBtn.textContent = _snapCenter ? 'Snap Center: On' : 'Snap Center: Off';
        if (_snapCenter) snapCenterBtn.classList.add('active');
        else snapCenterBtn.classList.remove('active');
      });
    }

    // FP View toggle
    var fpViewBtn = document.getElementById('heFPView');
    if (fpViewBtn) {
      fpViewBtn.addEventListener('click', function () { toggleFPView(); });
    }

    // Camera preset buttons (orbit around different target points)
    // GROUND_Y = -1, EYE_HEIGHT = 2.0, so feet=-1, head≈1.0, eye≈1.0
    var camPresets = {
      heCamDefault: { targetY: 1.5, pitch: 0.3, dist: 6 },
      heCamHead:    { targetY: 1.0, pitch: 0.1, dist: 2.5 },
      heCamFull:    { targetY: 0.0, pitch: 0.15, dist: 8 }
    };
    var camBtns = document.querySelectorAll('.he-cam-btn');
    camBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (_fpViewActive) toggleFPView(); // exit FP view first
        var preset = camPresets[btn.id];
        if (preset && _heroOrbitCtrl) {
          _heroOrbitCtrl.setState({
            target: { x: 0, y: preset.targetY, z: 0 },
            pitch: preset.pitch,
            dist: preset.dist
          });
        }
        camBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });

    // View mode buttons
    var modeButtons = document.querySelectorAll('.he-mode-btn');
    modeButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-mode');
        if (mode) setViewMode(mode);
      });
    });

    // Undo / Redo buttons
    var undoBtn = document.getElementById('heUndo');
    var redoBtn = document.getElementById('heRedo');
    if (undoBtn) undoBtn.addEventListener('click', function () { hitboxUndo(); });
    if (redoBtn) redoBtn.addEventListener('click', function () { hitboxRedo(); });

    // Body part buttons
    var bpAddBtn = document.getElementById('heBodyPartAdd');
    if (bpAddBtn) bpAddBtn.addEventListener('click', function () { addBodyPart(); });
    var bpUndoBtn = document.getElementById('heBPUndo');
    if (bpUndoBtn) bpUndoBtn.addEventListener('click', function () { bodyPartUndo(); });
    var bpRedoBtn = document.getElementById('heBPRedo');
    if (bpRedoBtn) bpRedoBtn.addEventListener('click', function () { bodyPartRedo(); });

    // Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts
    window.addEventListener('keydown', function (e) {
      var panel = document.getElementById('panelHeroEditor');
      if (!panel || !panel.classList.contains('active')) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (_viewMode === 'visual') bodyPartUndo();
        else hitboxUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        if (_viewMode === 'visual') bodyPartRedo();
        else hitboxRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        if (_viewMode === 'visual') bodyPartRedo();
        else hitboxRedo();
      }
    });

    // Render initial lists
    renderHitboxSegmentList();
    renderBodyPartList();

    // Hero select dropdown
    var heroSelect = document.getElementById('heHeroSelect');
    if (heroSelect) {
      heroSelect.addEventListener('change', function () {
        var heroId = heroSelect.value;
        var hero = null;
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
        _bodyParts = [];
        renderBodyPartList();
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
        var heroes = window.HEROES || [];
        var found = false;
        for (var i = 0; i < heroes.length; i++) {
          if (heroes[i].id === config.id) { heroes[i] = config; found = true; break; }
        }
        if (!found) heroes.push(config);
        window.HEROES = heroes;

        var origGet = window.getHeroById;
        window.getHeroById = function (id) {
          if (id === config.id) return config;
          return origGet(id);
        };
        alert('Hero config applied. Restart split-screen to take effect.');
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
  var _wmbPreviewMeshes = [];
  var _wmbSelectedIndex = -1;
  var _wmbResizeStartPart = null;

  // Engine controllers
  var _wmbOrbitCtrl = null;
  var _wmbInteractionCtrl = null;

  // WMB Undo/Redo
  var _wmbUndoStack = [];
  var _wmbRedoStack = [];

  function pushWmbUndo() {
    _wmbUndoStack.push(JSON.stringify(_wmbParts));
    if (_wmbUndoStack.length > MAX_UNDO) _wmbUndoStack.shift();
    _wmbRedoStack = [];
    updateWmbUndoRedoButtons();
  }

  function wmbUndo() {
    if (_wmbUndoStack.length === 0) return;
    _wmbRedoStack.push(JSON.stringify(_wmbParts));
    _wmbParts = JSON.parse(_wmbUndoStack.pop());
    _wmbSelectedIndex = -1;
    if (_wmbInteractionCtrl) _wmbInteractionCtrl.clearHandles();
    renderWmbPartsList();
    updateWmbPreview();
    updateWmbUndoRedoButtons();
  }

  function wmbRedo() {
    if (_wmbRedoStack.length === 0) return;
    _wmbUndoStack.push(JSON.stringify(_wmbParts));
    _wmbParts = JSON.parse(_wmbRedoStack.pop());
    _wmbSelectedIndex = -1;
    if (_wmbInteractionCtrl) _wmbInteractionCtrl.clearHandles();
    renderWmbPartsList();
    updateWmbPreview();
    updateWmbUndoRedoButtons();
  }

  function updateWmbUndoRedoButtons() {
    var undoBtn = document.getElementById('wmbUndo');
    var redoBtn = document.getElementById('wmbRedo');
    if (undoBtn) undoBtn.disabled = _wmbUndoStack.length === 0;
    if (redoBtn) redoBtn.disabled = _wmbRedoStack.length === 0;
  }

  function selectWmbPart(index) {
    _wmbSelectedIndex = index;
    updateWmbVisuals();
    syncWmbRightPanel();

    // Scroll to part in sidebar list
    if (index >= 0) {
      var container = document.getElementById('wmbPartsList');
      if (container) {
        var entries = container.querySelectorAll('.wmb-part');
        if (entries[index]) {
          entries[index].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          entries[index].style.outline = '2px solid #00ff88';
          setTimeout(function () { if (entries[index]) entries[index].style.outline = ''; }, 800);
        }
      }
    }
  }

  function updateWmbVisuals() {
    for (var i = 0; i < _wmbPreviewMeshes.length; i++) {
      var mesh = _wmbPreviewMeshes[i];
      if (!mesh || !mesh.material) continue;
      if (i === _wmbSelectedIndex) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0.7;
      } else {
        mesh.material.transparent = false;
        mesh.material.opacity = 1.0;
      }
    }
  }

  function syncWmbRightPanel() {
    var panel = document.getElementById('wmbRightPanelContent');
    if (!panel) return;

    if (_wmbSelectedIndex < 0 || _wmbSelectedIndex >= _wmbParts.length) {
      panel.innerHTML = '<p style="color:#666;font-size:12px;padding:8px;">Select a part to edit properties.</p>';
      return;
    }

    var part = _wmbParts[_wmbSelectedIndex];
    panel.innerHTML = '';

    var fields = [
      { label: 'Type', key: 'type', type: 'text', readonly: true },
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
      inp.type = f.type || 'number';
      if (f.step) inp.step = String(f.step);
      inp.value = String(part[f.key]);
      if (f.readonly) inp.readOnly = true;
      inp.addEventListener('input', function () {
        if (f.readonly) return;
        pushWmbUndo();
        part[f.key] = parseFloat(inp.value) || 0;
        updateWmbPreview();
      });
      row.appendChild(lbl);
      row.appendChild(inp);
      panel.appendChild(row);
    });

    // Color
    var colorRow = document.createElement('div');
    colorRow.className = 'dev-field';
    var colorLbl = document.createElement('label');
    colorLbl.textContent = 'Color';
    var colorInp = document.createElement('input');
    colorInp.type = 'color';
    colorInp.value = part.color || '#444444';
    colorInp.addEventListener('input', function () {
      part.color = colorInp.value;
      updateWmbPreview();
    });
    colorRow.appendChild(colorLbl);
    colorRow.appendChild(colorInp);
    panel.appendChild(colorRow);
  }

  var _wmbPreviewInited = false;
  window._initWmbPreview = function () {
    if (_wmbPreviewInited) return;
    _wmbPreviewInited = true;
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

    var grid = new THREE.GridHelper(2, 10, 0x333333, 0x222222);
    grid.position.y = -0.5;
    _wmbScene.add(grid);

    _wmbCamera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.01, 100);

    _wmbRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    _wmbRenderer.setSize(canvas.width, canvas.height);

    _wmbPreviewGroup = new THREE.Group();
    _wmbScene.add(_wmbPreviewGroup);

    // Create orbit controller
    _wmbOrbitCtrl = createOrbitController({
      canvas: canvas,
      camera: _wmbCamera,
      target: { x: 0, y: 0, z: 0 },
      initialAngle: 0,
      initialPitch: 0.3,
      initialDist: 2,
      minDist: 0.5,
      maxDist: 10
    });

    // Create interaction controller for WMB parts
    _wmbInteractionCtrl = createInteractionController({
      canvas: canvas,
      camera: _wmbCamera,
      getObjects: function () { return _wmbPreviewMeshes; },
      getHandleParent: function () { return _wmbPreviewGroup; },
      onSelect: function (index) { selectWmbPart(index); },
      onMoveStart: function () { pushWmbUndo(); },
      onMove: function (index, newPos) {
        if (index < 0 || index >= _wmbParts.length) return;
        var part = _wmbParts[index];
        part.px = Math.round(newPos.x * 100) / 100;
        part.py = Math.round(newPos.y * 100) / 100;
        part.pz = Math.round(newPos.z * 100) / 100;
        var mesh = _wmbPreviewMeshes[index];
        if (mesh) mesh.position.set(part.px, part.py, part.pz);
        syncWmbRightPanel();
        renderWmbPartsList();
      },
      onMoveEnd: function () {},
      getHandleDefs: function (index) {
        if (index < 0 || index >= _wmbParts.length) return [];
        // Box: 6 handles, Cylinder: 4 handles
        var part = _wmbParts[index];
        if (part.type === 'cylinder') {
          return [
            { axis: 'x', sign: 1, color: 0xff4444 },
            { axis: 'x', sign: -1, color: 0xff4444 },
            { axis: 'y', sign: 1, color: 0x44ff44 },
            { axis: 'y', sign: -1, color: 0x44ff44 }
          ];
        }
        return [
          { axis: 'x', sign: 1, color: 0xff4444 },
          { axis: 'x', sign: -1, color: 0xff4444 },
          { axis: 'y', sign: 1, color: 0x44ff44 },
          { axis: 'y', sign: -1, color: 0x44ff44 },
          { axis: 'z', sign: 1, color: 0x4488ff },
          { axis: 'z', sign: -1, color: 0x4488ff }
        ];
      },
      getObjectCenter: function (index) {
        if (index < 0 || index >= _wmbParts.length) return null;
        var p = _wmbParts[index];
        return new THREE.Vector3(p.px, p.py, p.pz);
      },
      getHalfDim: function (index, axis) {
        if (index < 0 || index >= _wmbParts.length) return 0;
        var p = _wmbParts[index];
        if (axis === 'x') return p.sx / 2;
        if (axis === 'y') return p.sy / 2;
        return p.sz / 2;
      },
      onResizeStart: function (index) {
        pushWmbUndo();
        if (index >= 0 && index < _wmbParts.length) {
          _wmbResizeStartPart = JSON.parse(JSON.stringify(_wmbParts[index]));
        }
      },
      onResize: function (index, axis, sign, delta) {
        if (index < 0 || index >= _wmbParts.length || !_wmbResizeStartPart) return;
        var part = _wmbParts[index];
        var start = _wmbResizeStartPart;
        var sizeKey = (axis === 'x') ? 'sx' : (axis === 'y') ? 'sy' : 'sz';
        var posKey = (axis === 'x') ? 'px' : (axis === 'y') ? 'py' : 'pz';
        var startSize = start[sizeKey];
        var startPos = start[posKey];
        var newSize = Math.max(0.01, startSize + delta);
        newSize = Math.round(newSize * 100) / 100;
        var dimChange = newSize - startSize;
        part[sizeKey] = newSize;
        // Shift position to anchor opposite face
        if (sign < 0) part[posKey] = Math.round((startPos - dimChange / 2) * 100) / 100;
        else part[posKey] = Math.round((startPos + dimChange / 2) * 100) / 100;

        // Rebuild mesh
        var mesh = _wmbPreviewMeshes[index];
        if (mesh) {
          if (mesh.geometry) mesh.geometry.dispose();
          if (part.type === 'cylinder') {
            var radius = part.sx / 2;
            mesh.geometry = new THREE.CylinderGeometry(radius, radius, part.sy, 16);
          } else {
            mesh.geometry = new THREE.BoxGeometry(part.sx, part.sy, part.sz);
          }
          mesh.position.set(part.px, part.py, part.pz);
        }
        syncWmbRightPanel();
        renderWmbPartsList();
      },
      onResizeEnd: function () {},
      snapGrid: 0.01,
      orbitController: _wmbOrbitCtrl
    });
    _wmbInteractionCtrl.enable();

    function animateWmb() {
      _wmbAnimId = requestAnimationFrame(animateWmb);
      if (_wmbOrbitCtrl) _wmbOrbitCtrl.update();
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
    pushWmbUndo();
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
    pushWmbUndo();
    if (index === _wmbSelectedIndex) {
      _wmbSelectedIndex = -1;
      if (_wmbInteractionCtrl) _wmbInteractionCtrl.clearHandles();
    } else if (index < _wmbSelectedIndex) {
      _wmbSelectedIndex--;
    }
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
      if (i === _wmbSelectedIndex) div.style.borderColor = '#00ff88';

      var header = document.createElement('div');
      header.className = 'wmb-part-header';
      header.innerHTML = '<span>' + part.type.toUpperCase() + ' #' + (i + 1) + '</span>';
      header.style.cursor = 'pointer';
      header.addEventListener('click', function () {
        if (_wmbInteractionCtrl) _wmbInteractionCtrl.select(i);
      });
      var removeBtn = document.createElement('button');
      removeBtn.className = 'wmb-part-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function (e) { e.stopPropagation(); removeWmbPart(i); });
      header.appendChild(removeBtn);
      div.appendChild(header);

      // Compact fields in sidebar
      var fields = [
        { label: 'Size', keys: ['sx', 'sy', 'sz'] },
        { label: 'Pos', keys: ['px', 'py', 'pz'] },
        { label: 'Rot', keys: ['rx', 'ry', 'rz'] }
      ];

      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'dev-field';
        var lbl = document.createElement('label');
        lbl.textContent = f.label;
        lbl.style.minWidth = '30px';
        row.appendChild(lbl);
        f.keys.forEach(function (k) {
          var inp = document.createElement('input');
          inp.type = 'number';
          inp.step = k.charAt(0) === 'r' ? '0.1' : '0.01';
          inp.value = String(part[k]);
          inp.style.width = '50px';
          inp.style.flex = '1';
          inp.addEventListener('input', function () {
            part[k] = parseFloat(inp.value) || 0;
            updateWmbPreview();
            syncWmbRightPanel();
          });
          row.appendChild(inp);
        });
        div.appendChild(row);
      });

      // Color
      var colorRow = document.createElement('div');
      colorRow.className = 'dev-field';
      var colorLbl = document.createElement('label');
      colorLbl.textContent = 'Color';
      colorLbl.style.minWidth = '30px';
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
    _wmbPreviewMeshes = [];

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
      _wmbPreviewMeshes.push(mesh);
    });

    updateWmbVisuals();
    if (_wmbInteractionCtrl && _wmbSelectedIndex >= 0) {
      _wmbInteractionCtrl.rebuildHandles();
    }
  }

  function wireWmbInputs() {
    var addBoxBtn = document.getElementById('wmbAddBox');
    var addCylBtn = document.getElementById('wmbAddCyl');

    if (addBoxBtn) addBoxBtn.addEventListener('click', function () { addWmbPart('box'); });
    if (addCylBtn) addCylBtn.addEventListener('click', function () { addWmbPart('cylinder'); });

    // WMB Undo/Redo
    var wmbUndoBtn = document.getElementById('wmbUndo');
    var wmbRedoBtn = document.getElementById('wmbRedo');
    if (wmbUndoBtn) wmbUndoBtn.addEventListener('click', function () { wmbUndo(); });
    if (wmbRedoBtn) wmbRedoBtn.addEventListener('click', function () { wmbRedo(); });

    // Register button
    var registerBtn = document.getElementById('wmbRegister');
    if (registerBtn) {
      registerBtn.addEventListener('click', function () {
        var def = getWmbModelDef();
        if (!def.modelType) { alert('Model name is required'); return; }
        if (typeof window.registerCustomWeaponModel === 'function') {
          window.registerCustomWeaponModel(def);
          alert('Model "' + def.modelType + '" registered. Available in hero editor Model Type dropdown.');
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
            _wmbSelectedIndex = -1;
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
          _wmbSelectedIndex = -1;
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
            _wmbSelectedIndex = -1;
            renderWmbPartsList();
            updateWmbPreview();
          })
          .catch(function () { alert('Failed to load weapon model'); });
      });
    }

    // Ctrl+Z/Y for WMB
    window.addEventListener('keydown', function (e) {
      var panel = document.getElementById('panelWeaponModelBuilder');
      if (!panel || !panel.classList.contains('active')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        wmbUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' && e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        wmbRedo();
      }
    });

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

  // Expose view mode reapplication for devApp.js panel switching
  window._applyHeroViewMode = function () { setViewMode(_viewMode); };

})();
