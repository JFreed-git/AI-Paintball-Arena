/**
 * interactionEngine.js — Shared 3D interaction engine for dev workbench
 *
 * PURPOSE: Provides reusable orbit camera and select/drag/resize interaction
 * controllers extracted from devHeroEditor.js. Used by the hero hitbox editor,
 * body part editor, and weapon model builder.
 *
 * EXPORTS (window):
 *   createOrbitController(opts)       — reusable orbit camera controller
 *   createInteractionController(opts) — reusable select/drag/resize system
 *   snapTo(val, step)                 — snap helper
 *
 * DEPENDENCIES: Three.js (THREE)
 */

(function () {

  // --- Snap helper ---
  function snapTo(val, step) {
    return Math.round(val / step) * step;
  }

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

  /**
   * createOrbitController(opts) — Reusable orbit camera controller
   *
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {THREE.PerspectiveCamera} opts.camera
   * @param {Object} opts.target - {x, y, z} look-at target
   * @param {number} [opts.initialAngle=0]
   * @param {number} [opts.initialPitch=0.3]
   * @param {number} [opts.initialDist=6]
   * @param {number} [opts.minDist=0.5]
   * @param {number} [opts.maxDist=15]
   * @param {number} [opts.minPitch=-1.2]
   * @param {number} [opts.maxPitch=1.2]
   * @param {number} [opts.sensitivity=0.01]
   * @returns controller object
   */
  function createOrbitController(opts) {
    var canvas = opts.canvas;
    var camera = opts.camera;
    var angle = opts.initialAngle || 0;
    var pitch = opts.initialPitch || 0.3;
    var dist = opts.initialDist || 6;
    var target = { x: (opts.target && opts.target.x) || 0, y: (opts.target && opts.target.y) || 1.5, z: (opts.target && opts.target.z) || 0 };
    var minDist = (typeof opts.minDist === 'number') ? opts.minDist : 0.5;
    var maxDist = (typeof opts.maxDist === 'number') ? opts.maxDist : 15;
    var minPitch = (typeof opts.minPitch === 'number') ? opts.minPitch : -1.2;
    var maxPitch = (typeof opts.maxPitch === 'number') ? opts.maxPitch : 1.2;
    var sensitivity = opts.sensitivity || 0.01;

    var _enabled = true;
    var _dragging = false;
    var _lastMouse = { x: 0, y: 0 };
    // Track if drag started from our canvas (to prevent stealing from interaction controller)
    var _dragFromCanvas = false;

    function onMouseDown(e) {
      if (!_enabled) return;
      // Only start orbit drag if it originated on this canvas
      _dragging = true;
      _dragFromCanvas = true;
      _lastMouse = { x: e.clientX, y: e.clientY };
    }

    function onMouseUp() {
      _dragging = false;
      _dragFromCanvas = false;
    }

    function onMouseMove(e) {
      if (!_enabled || !_dragging || !_dragFromCanvas) return;
      var dx = e.clientX - _lastMouse.x;
      var dy = e.clientY - _lastMouse.y;
      angle -= dx * sensitivity;
      pitch = Math.max(minPitch, Math.min(maxPitch, pitch - dy * sensitivity));
      _lastMouse = { x: e.clientX, y: e.clientY };
    }

    function onWheel(e) {
      if (!_enabled) return;
      e.preventDefault();
      dist = Math.max(minDist, Math.min(maxDist, dist + e.deltaY * 0.005));
    }

    // Bind — mousedown on canvas (start orbit only from canvas),
    // mousemove/mouseup on window (track drags even when mouse leaves canvas)
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel);

    var ctrl = {
      enable: function () { _enabled = true; },
      disable: function () { _enabled = false; _dragging = false; _dragFromCanvas = false; },
      isEnabled: function () { return _enabled; },
      isDragging: function () { return _dragging && _dragFromCanvas; },

      /** Call each frame to position the camera */
      update: function () {
        camera.position.set(
          target.x + Math.sin(angle) * Math.cos(pitch) * dist,
          target.y + Math.sin(pitch) * dist,
          target.z + Math.cos(angle) * Math.cos(pitch) * dist
        );
        camera.lookAt(target.x, target.y, target.z);
      },

      getState: function () {
        return { angle: angle, pitch: pitch, dist: dist, target: { x: target.x, y: target.y, z: target.z } };
      },

      setState: function (s) {
        if (typeof s.angle === 'number') angle = s.angle;
        if (typeof s.pitch === 'number') pitch = s.pitch;
        if (typeof s.dist === 'number') dist = s.dist;
        if (s.target) {
          if (typeof s.target.x === 'number') target.x = s.target.x;
          if (typeof s.target.y === 'number') target.y = s.target.y;
          if (typeof s.target.z === 'number') target.z = s.target.z;
        }
      },

      /** Suppress orbit drag for this mousedown (called by interaction controller) */
      suppressDrag: function () {
        _dragging = false;
        _dragFromCanvas = false;
      },

      destroy: function () {
        canvas.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('wheel', onWheel);
      }
    };

    return ctrl;
  }

  /**
   * createInteractionController(opts) — Reusable select/drag/resize system
   *
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {THREE.PerspectiveCamera} opts.camera
   * @param {Function} opts.getObjects - returns array of THREE.Mesh to pick from
   * @param {Function} opts.getHandleParent - returns THREE.Group for handle meshes
   * @param {Function} opts.onSelect - callback(index) when object selected (-1 = deselect)
   * @param {Function} [opts.onMoveStart] - callback(index) before drag begins
   * @param {Function} opts.onMove - callback(index, newPos:THREE.Vector3) during drag
   * @param {Function} [opts.onMoveEnd] - callback(index) when drag ends
   * @param {Function} opts.getHandleDefs - callback(index) returns [{axis, sign, color}]
   * @param {Function} opts.getObjectCenter - callback(index) returns THREE.Vector3
   * @param {Function} opts.getHalfDim - callback(index, axis) returns half-dimension
   * @param {Function} [opts.onResizeStart] - callback(index, handle)
   * @param {Function} opts.onResize - callback(index, axis, sign, delta) during resize
   * @param {Function} [opts.onResizeEnd] - callback(index)
   * @param {number} [opts.snapGrid=0.05] - snap increment
   * @param {Function} [opts.getSnapCenter] - returns boolean, forces X/Z to 0
   * @param {Function} [opts.orbitController] - orbit controller to suppress on interaction
   * @returns controller object
   */
  function createInteractionController(opts) {
    var canvas = opts.canvas;
    var camera = opts.camera;
    var getObjects = opts.getObjects;
    var getHandleParent = opts.getHandleParent;
    var onSelectCb = opts.onSelect;
    var onMoveStartCb = opts.onMoveStart || function () {};
    var onMoveCb = opts.onMove;
    var onMoveEndCb = opts.onMoveEnd || function () {};
    var getHandleDefsCb = opts.getHandleDefs;
    var getObjectCenterCb = opts.getObjectCenter;
    var getHalfDimCb = opts.getHalfDim;
    var onResizeStartCb = opts.onResizeStart || function () {};
    var onResizeCb = opts.onResize;
    var onResizeEndCb = opts.onResizeEnd || function () {};
    var snapGrid = (typeof opts.snapGrid === 'number') ? opts.snapGrid : 0.05;
    var getSnapCenterCb = opts.getSnapCenter || function () { return false; };
    var orbitController = opts.orbitController || null;

    var _enabled = false;
    var _selectedIndex = -1;
    var _raycaster = new THREE.Raycaster();

    // Resize handle meshes
    var _resizeHandles = []; // [{mesh, axis, sign}]

    // Drag state
    var _dragMode = null; // 'move' | null
    var _dragPlane = new THREE.Plane();
    var _dragOffset = new THREE.Vector3();

    // Resize state
    var _isResizing = false;
    var _resizeAxis = null;
    var _resizeSign = 0;
    var _resizePlane = new THREE.Plane();
    var _resizeStartPoint = new THREE.Vector3();

    function clearHandles() {
      for (var i = 0; i < _resizeHandles.length; i++) {
        var h = _resizeHandles[i];
        if (h.mesh.parent) h.mesh.parent.remove(h.mesh);
        if (h.mesh.geometry) h.mesh.geometry.dispose();
        if (h.mesh.material) h.mesh.material.dispose();
      }
      _resizeHandles = [];
    }

    function rebuildHandles() {
      clearHandles();
      if (_selectedIndex < 0) return;

      var defs = getHandleDefsCb(_selectedIndex);
      if (!defs || !defs.length) return;

      var center = getObjectCenterCb(_selectedIndex);
      if (!center) return;

      var parent = getHandleParent();
      if (!parent) return;

      for (var i = 0; i < defs.length; i++) {
        var def = defs[i];
        var geom = new THREE.SphereGeometry(0.06, 8, 8);
        var mat = new THREE.MeshBasicMaterial({ color: def.color, depthTest: false });
        var mesh = new THREE.Mesh(geom, mat);
        mesh.renderOrder = 999;

        var pos = center.clone();
        var halfDim = getHalfDimCb(_selectedIndex, def.axis);

        if (def.axis === 'x') pos.x += def.sign * halfDim;
        else if (def.axis === 'y') pos.y += def.sign * halfDim;
        else pos.z += def.sign * halfDim;

        mesh.position.copy(pos);
        parent.add(mesh);
        _resizeHandles.push({ mesh: mesh, axis: def.axis, sign: def.sign });
      }
    }

    function repositionHandles() {
      if (_selectedIndex < 0) return;
      var center = getObjectCenterCb(_selectedIndex);
      if (!center) return;

      for (var i = 0; i < _resizeHandles.length; i++) {
        var h = _resizeHandles[i];
        var pos = center.clone();
        var halfDim = getHalfDimCb(_selectedIndex, h.axis);

        if (h.axis === 'x') pos.x += h.sign * halfDim;
        else if (h.axis === 'y') pos.y += h.sign * halfDim;
        else pos.z += h.sign * halfDim;

        h.mesh.position.copy(pos);
      }
    }

    function startDrag(index, intersectionPoint) {
      var center = getObjectCenterCb(index);
      if (!center) return;

      onMoveStartCb(index);

      // Camera-facing plane through the object center
      var camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      _dragPlane.setFromNormalAndCoplanarPoint(camDir.negate(), center);

      // Offset from intersection point to center (prevents jump)
      _dragOffset.copy(center).sub(intersectionPoint);

      _dragMode = 'move';
    }

    function onDragMove(e) {
      if (_dragMode !== 'move' || _selectedIndex < 0) return;

      var ndc = getCanvasMouseNDC(e, canvas);
      _raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

      var intersect = new THREE.Vector3();
      if (!rayPlaneIntersect(_raycaster, _dragPlane, intersect)) return;

      var newPos = intersect.add(_dragOffset);

      // Snap
      newPos.x = snapTo(newPos.x, snapGrid);
      newPos.y = snapTo(newPos.y, snapGrid);
      newPos.z = snapTo(newPos.z, snapGrid);

      onMoveCb(_selectedIndex, newPos);
      repositionHandles();
    }

    function startResize(handle, point) {
      onResizeStartCb(_selectedIndex, handle);
      _isResizing = true;
      _resizeAxis = handle.axis;
      _resizeSign = handle.sign;

      // Build a plane that contains the resize axis and faces the camera.
      // A camera-facing plane fails when the camera looks along the resize axis
      // (the axis component of intersection points stays constant → zero delta).
      // Instead, project the camera direction onto the plane perpendicular to the
      // resize axis, giving a normal that is perpendicular to the resize axis but
      // as close to the camera direction as possible.
      var camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);

      var axisVec = new THREE.Vector3(
        handle.axis === 'x' ? 1 : 0,
        handle.axis === 'y' ? 1 : 0,
        handle.axis === 'z' ? 1 : 0
      );

      var dot = camDir.dot(axisVec);
      var normal = camDir.clone().sub(axisVec.clone().multiplyScalar(dot));
      if (normal.lengthSq() < 1e-6) {
        // Camera looking directly along resize axis — fallback
        if (handle.axis === 'y') normal.set(0, 0, 1);
        else normal.set(0, 1, 0);
      }
      normal.normalize();

      _resizePlane.setFromNormalAndCoplanarPoint(normal, point.clone());
      _resizeStartPoint.copy(point);
    }

    function onResizeMove(e) {
      if (!_isResizing || _selectedIndex < 0) return;

      var ndc = getCanvasMouseNDC(e, canvas);
      _raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

      var intersect = new THREE.Vector3();
      if (!rayPlaneIntersect(_raycaster, _resizePlane, intersect)) return;

      var delta;
      if (_resizeAxis === 'x') delta = intersect.x - _resizeStartPoint.x;
      else if (_resizeAxis === 'y') delta = intersect.y - _resizeStartPoint.y;
      else delta = intersect.z - _resizeStartPoint.z;

      delta *= _resizeSign;

      onResizeCb(_selectedIndex, _resizeAxis, _resizeSign, delta);
      repositionHandles();
    }

    // --- Mouse event handlers ---

    function onCanvasMouseDown(e) {
      if (!_enabled) return;

      var ndc = getCanvasMouseNDC(e, canvas);
      _raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

      // Priority 1: Resize handles
      if (_resizeHandles.length > 0) {
        var handleMeshes = _resizeHandles.map(function (h) { return h.mesh; });
        var handleHits = _raycaster.intersectObjects(handleMeshes);
        if (handleHits.length > 0) {
          var hitHandle = handleHits[0].object;
          for (var hi = 0; hi < _resizeHandles.length; hi++) {
            if (_resizeHandles[hi].mesh === hitHandle) {
              if (orbitController) orbitController.suppressDrag();
              startResize(_resizeHandles[hi], handleHits[0].point);
              return;
            }
          }
        }
      }

      // Priority 2: Objects
      var objects = getObjects();
      if (objects && objects.length > 0) {
        var objectHits = _raycaster.intersectObjects(objects);
        if (objectHits.length > 0) {
          var hitMesh = objectHits[0].object;
          var idx = objects.indexOf(hitMesh);
          if (idx !== -1) {
            if (orbitController) orbitController.suppressDrag();
            select(idx);
            startDrag(idx, objectHits[0].point);
            return;
          }
        }
      }

      // Priority 3: Empty space — deselect
      select(-1);
    }

    function onCanvasMouseMove(e) {
      if (!_enabled) return;
      if (_isResizing) {
        onResizeMove(e);
        return;
      }
      if (_dragMode === 'move') {
        onDragMove(e);
        return;
      }
    }

    function onMouseUp() {
      if (_dragMode === 'move') {
        onMoveEndCb(_selectedIndex);
        _dragMode = null;
      }
      if (_isResizing) {
        onResizeEndCb(_selectedIndex);
        _isResizing = false;
      }
    }

    // Bind events — mousedown on canvas, mousemove/mouseup on window
    // (track drags even when mouse leaves canvas during move/resize)
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    window.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    function select(index) {
      _selectedIndex = index;
      onSelectCb(index);
      rebuildHandles();
    }

    var ctrl = {
      enable: function () { _enabled = true; },
      disable: function () {
        _enabled = false;
        _dragMode = null;
        _isResizing = false;
      },
      isEnabled: function () { return _enabled; },
      select: select,
      rebuildHandles: rebuildHandles,
      repositionHandles: repositionHandles,
      clearHandles: clearHandles,
      getSelectedIndex: function () { return _selectedIndex; },
      destroy: function () {
        clearHandles();
        canvas.removeEventListener('mousedown', onCanvasMouseDown);
        window.removeEventListener('mousemove', onCanvasMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      }
    };

    return ctrl;
  }

  // --- Expose ---
  window.snapTo = snapTo;
  window.createOrbitController = createOrbitController;
  window.createInteractionController = createInteractionController;

})();
