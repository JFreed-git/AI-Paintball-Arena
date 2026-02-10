/**
 * menuBuilder.js — Visual menu builder (dev workbench only)
 *
 * PURPOSE: Drag-and-drop menu editor in the dev workbench. Renders a live DOM
 * preview of the menu being edited. Elements can be clicked to select, dragged
 * to reposition, and resized via handles. Properties panel shows selected
 * element's config fields. Supports undo/redo, save/load, grid snapping.
 *
 * EXPORTS (window):
 *   _initMenuBuilderPreview()   — called by devApp.js on init
 *   _resizeMenuBuilderPreview() — called on window resize
 *
 * DEPENDENCIES: menuRenderer.js (MENU_DEFAULTS, renderMenuFromConfig)
 */
(function () {
  'use strict';

  // ===================================================================
  // State
  // ===================================================================
  var _menuConfigs = {};       // { menuId: config }
  var _currentMenuId = null;
  var _selectedUid = null;
  var _undoStack = [];
  var _redoStack = [];
  var _nextUid = 500;
  var _snapSize = 10;
  var _snapEnabled = true;
  var _showGrid = false;
  var _alignSnap = true;       // snap-to-alignment with other elements
  var _alignThreshold = 6;     // px threshold for alignment snapping
  var _dragging = null;        // { uid, startMouseX, startMouseY, startElX, startElY }
  var _resizing = null;        // { uid, handle, startMouseX, startMouseY, origX, origY, origW, origH }

  function nextUid() { return 'el_' + (++_nextUid); }

  function snap(val) {
    return _snapEnabled ? Math.round(val / _snapSize) * _snapSize : Math.round(val);
  }

  /**
   * Compute alignment-snapped position for a dragged/resized element.
   * Returns { x, y, guides[] } where guides are lines to show.
   * Each guide: { axis: 'x'|'y', pos: px, from: px, to: px }
   */
  function computeAlignSnap(uid, rawX, rawY, w, h) {
    var cfg = getCurrentConfig();
    if (!cfg || !_alignSnap) return { x: rawX, y: rawY, guides: [] };

    var guides = [];
    var snappedX = rawX;
    var snappedY = rawY;
    var bestDx = _alignThreshold + 1;
    var bestDy = _alignThreshold + 1;

    // Dragged element edges and center
    var dragLeft = rawX;
    var dragRight = rawX + w;
    var dragCenterX = rawX + w / 2;
    var dragTop = rawY;
    var dragBottom = rawY + h;
    var dragCenterY = rawY + h / 2;

    // Collect reference edges from other elements + container edges
    var refXEdges = []; // { pos, label }
    var refYEdges = [];

    // Container edges
    var containerW = cfg.fullScreen ? (document.getElementById('mbMenuPreview') || {}).offsetWidth || 800 : (cfg.width || 420);
    var containerH = cfg.fullScreen ? (document.getElementById('mbMenuPreview') || {}).offsetHeight || 600 : (cfg.height || 240);
    refXEdges.push({ pos: 0, src: 'container' });
    refXEdges.push({ pos: containerW, src: 'container' });
    refXEdges.push({ pos: containerW / 2, src: 'container' });
    refYEdges.push({ pos: 0, src: 'container' });
    refYEdges.push({ pos: containerH, src: 'container' });
    refYEdges.push({ pos: containerH / 2, src: 'container' });

    // Other element edges
    (cfg.elements || []).forEach(function (el) {
      if (el.uid === uid) return;
      var ex = el.x || 0, ey = el.y || 0;
      var ew = el.width || 100, eh = el.height || 30;
      refXEdges.push({ pos: ex, src: el.uid });
      refXEdges.push({ pos: ex + ew, src: el.uid });
      refXEdges.push({ pos: ex + ew / 2, src: el.uid });
      refYEdges.push({ pos: ey, src: el.uid });
      refYEdges.push({ pos: ey + eh, src: el.uid });
      refYEdges.push({ pos: ey + eh / 2, src: el.uid });
    });

    // Check X alignment: drag left, right, and center vs reference edges
    var dragXPoints = [dragLeft, dragRight, dragCenterX];
    var dragXOffsets = [0, -w, -w / 2]; // offset to convert matched pos back to element x
    for (var i = 0; i < dragXPoints.length; i++) {
      for (var j = 0; j < refXEdges.length; j++) {
        var d = Math.abs(dragXPoints[i] - refXEdges[j].pos);
        if (d < bestDx) {
          bestDx = d;
          snappedX = refXEdges[j].pos + dragXOffsets[i];
        }
      }
    }

    // Check Y alignment: drag top, bottom, and center vs reference edges
    var dragYPoints = [dragTop, dragBottom, dragCenterY];
    var dragYOffsets = [0, -h, -h / 2];
    for (var i = 0; i < dragYPoints.length; i++) {
      for (var j = 0; j < refYEdges.length; j++) {
        var d = Math.abs(dragYPoints[i] - refYEdges[j].pos);
        if (d < bestDy) {
          bestDy = d;
          snappedY = refYEdges[j].pos + dragYOffsets[i];
        }
      }
    }

    // Only apply alignment snap if within threshold
    if (bestDx > _alignThreshold) snappedX = rawX;
    if (bestDy > _alignThreshold) snappedY = rawY;

    // Build guide lines for snapped axes
    if (bestDx <= _alignThreshold) {
      // Find which edge matched
      var finalLeft = snappedX;
      var finalRight = snappedX + w;
      var finalCx = snappedX + w / 2;
      var matchedXPos = null;
      // Check which drag point aligned
      for (var j = 0; j < refXEdges.length; j++) {
        if (Math.abs(finalLeft - refXEdges[j].pos) < 1) { matchedXPos = finalLeft; break; }
        if (Math.abs(finalRight - refXEdges[j].pos) < 1) { matchedXPos = finalRight; break; }
        if (Math.abs(finalCx - refXEdges[j].pos) < 1) { matchedXPos = finalCx; break; }
      }
      if (matchedXPos !== null) {
        guides.push({ axis: 'x', pos: matchedXPos, from: 0, to: containerH });
      }
    }
    if (bestDy <= _alignThreshold) {
      var finalTop = snappedY;
      var finalBottom = snappedY + h;
      var finalCy = snappedY + h / 2;
      var matchedYPos = null;
      for (var j = 0; j < refYEdges.length; j++) {
        if (Math.abs(finalTop - refYEdges[j].pos) < 1) { matchedYPos = finalTop; break; }
        if (Math.abs(finalBottom - refYEdges[j].pos) < 1) { matchedYPos = finalBottom; break; }
        if (Math.abs(finalCy - refYEdges[j].pos) < 1) { matchedYPos = finalCy; break; }
      }
      if (matchedYPos !== null) {
        guides.push({ axis: 'y', pos: matchedYPos, from: 0, to: containerW });
      }
    }

    return { x: snappedX, y: snappedY, guides: guides };
  }

  /**
   * Show alignment guide lines in the preview.
   */
  function showAlignGuides(guides) {
    var container = document.getElementById('mbAlignGuides');
    if (!container) return;
    container.innerHTML = '';
    if (!guides || !guides.length) return;

    guides.forEach(function (g) {
      var line = document.createElement('div');
      line.className = 'mb-align-guide';
      line.style.position = 'absolute';
      line.style.background = '#ff4488';
      line.style.opacity = '0.7';
      line.style.zIndex = '99';
      if (g.axis === 'x') {
        // Vertical line
        line.style.left = g.pos + 'px';
        line.style.top = g.from + 'px';
        line.style.width = '1px';
        line.style.height = (g.to - g.from) + 'px';
      } else {
        // Horizontal line
        line.style.left = g.from + 'px';
        line.style.top = g.pos + 'px';
        line.style.width = (g.to - g.from) + 'px';
        line.style.height = '1px';
      }
      container.appendChild(line);
    });
  }

  function clearAlignGuides() {
    var container = document.getElementById('mbAlignGuides');
    if (container) container.innerHTML = '';
  }

  function getCurrentConfig() {
    return _currentMenuId ? _menuConfigs[_currentMenuId] : null;
  }

  function getElementByUid(uid) {
    var cfg = getCurrentConfig();
    if (!cfg) return null;
    for (var i = 0; i < cfg.elements.length; i++) {
      if (cfg.elements[i].uid === uid) return cfg.elements[i];
    }
    return null;
  }

  // ===================================================================
  // Undo / Redo
  // ===================================================================
  function pushUndo() {
    _undoStack.push(JSON.stringify(_menuConfigs));
    _redoStack = [];
    if (_undoStack.length > 50) _undoStack.shift();
    updateUndoRedoButtons();
  }

  function undo() {
    if (!_undoStack.length) return;
    _redoStack.push(JSON.stringify(_menuConfigs));
    _menuConfigs = JSON.parse(_undoStack.pop());
    _selectedUid = null;
    renderPreview();
    renderElementList();
    clearPropsPanel();
    updateUndoRedoButtons();
  }

  function redo() {
    if (!_redoStack.length) return;
    _undoStack.push(JSON.stringify(_menuConfigs));
    _menuConfigs = JSON.parse(_redoStack.pop());
    _selectedUid = null;
    renderPreview();
    renderElementList();
    clearPropsPanel();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    var undoBtn = document.getElementById('mbUndo');
    var redoBtn = document.getElementById('mbRedo');
    if (undoBtn) undoBtn.disabled = !_undoStack.length;
    if (redoBtn) redoBtn.disabled = !_redoStack.length;
  }

  // ===================================================================
  // Menu Selector
  // ===================================================================
  function populateMenuSelect() {
    var sel = document.getElementById('mbMenuSelect');
    if (!sel) return;
    sel.innerHTML = '';
    var ids = Object.keys(_menuConfigs);
    ids.forEach(function (id) {
      var opt = document.createElement('option');
      opt.value = id;
      opt.textContent = _menuConfigs[id].name || id;
      sel.appendChild(opt);
    });
    if (_currentMenuId) sel.value = _currentMenuId;
  }

  function switchMenu(menuId) {
    _currentMenuId = menuId;
    _selectedUid = null;
    populateMenuSelect();
    populateContainerFields();
    renderPreview();
    renderElementList();
    clearPropsPanel();
  }

  function populateContainerFields() {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    var fsCheck = document.getElementById('mbContainerFS');
    var wInput = document.getElementById('mbContainerW');
    var hInput = document.getElementById('mbContainerH');
    var bgInput = document.getElementById('mbContainerBg');
    var brInput = document.getElementById('mbContainerBR');
    var wRow = document.getElementById('mbContainerWRow');
    var hRow = document.getElementById('mbContainerHRow');
    if (fsCheck) fsCheck.checked = !!cfg.fullScreen;
    if (wInput) wInput.value = cfg.width || 420;
    if (hInput) hInput.value = cfg.height || 240;
    if (bgInput) bgInput.value = (cfg.style && cfg.style.background) || '';
    if (brInput) brInput.value = (cfg.style && cfg.style.borderRadius) ? parseInt(cfg.style.borderRadius) : 12;
    // Hide width/height when full screen
    if (wRow) wRow.style.display = cfg.fullScreen ? 'none' : '';
    if (hRow) hRow.style.display = cfg.fullScreen ? 'none' : '';
  }

  // ===================================================================
  // Preview Rendering
  // ===================================================================
  function renderPreview() {
    var previewEl = document.getElementById('mbMenuPreview');
    if (!previewEl) return;
    var cfg = getCurrentConfig();
    if (!cfg) { previewEl.innerHTML = ''; return; }

    previewEl.innerHTML = '';

    // Set menu dimensions and styling
    if (cfg.fullScreen) {
      previewEl.style.width = '100%';
      previewEl.style.height = '100%';
    } else {
      previewEl.style.width = (cfg.width || 420) + 'px';
      previewEl.style.height = (cfg.height || 240) + 'px';
    }
    previewEl.style.position = 'relative';
    previewEl.style.background = (cfg.style && cfg.style.background) || 'rgba(10, 10, 10, 0.8)';
    previewEl.style.borderRadius = (cfg.style && cfg.style.borderRadius) || '12px';
    previewEl.style.border = (cfg.style && cfg.style.border) || '1px solid rgba(255, 255, 255, 0.08)';
    previewEl.style.boxShadow = (cfg.style && cfg.style.boxShadow) || '0 10px 40px rgba(0, 0, 0, 0.6)';
    previewEl.style.overflow = 'hidden';
    previewEl.style.padding = '0';

    // Get effective dimensions for grid
    var effectiveW = cfg.fullScreen ? previewEl.offsetWidth : (cfg.width || 420);
    var effectiveH = cfg.fullScreen ? previewEl.offsetHeight : (cfg.height || 240);

    // Grid overlay
    if (_showGrid) {
      var gridCanvas = document.createElement('canvas');
      gridCanvas.className = 'mb-grid-overlay';
      gridCanvas.width = effectiveW || 420;
      gridCanvas.height = effectiveH || 240;
      gridCanvas.style.position = 'absolute';
      gridCanvas.style.top = '0';
      gridCanvas.style.left = '0';
      gridCanvas.style.width = '100%';
      gridCanvas.style.height = '100%';
      gridCanvas.style.pointerEvents = 'none';
      gridCanvas.style.zIndex = '0';
      gridCanvas.style.opacity = '0.15';
      var ctx = gridCanvas.getContext('2d');
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 0.5;
      for (var gx = 0; gx <= gridCanvas.width; gx += _snapSize) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, gridCanvas.height); ctx.stroke();
      }
      for (var gy = 0; gy <= gridCanvas.height; gy += _snapSize) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(gridCanvas.width, gy); ctx.stroke();
      }
      previewEl.appendChild(gridCanvas);
    }

    // Alignment guides container (for snap-to-alignment)
    var guidesContainer = document.createElement('div');
    guidesContainer.id = 'mbAlignGuides';
    guidesContainer.style.position = 'absolute';
    guidesContainer.style.top = '0';
    guidesContainer.style.left = '0';
    guidesContainer.style.width = '100%';
    guidesContainer.style.height = '100%';
    guidesContainer.style.pointerEvents = 'none';
    guidesContainer.style.zIndex = '100';
    previewEl.appendChild(guidesContainer);

    // Render each element in a builder wrapper
    (cfg.elements || []).forEach(function (elCfg) {
      var wrapper = createPreviewWrapper(elCfg);
      previewEl.appendChild(wrapper);
    });
  }

  function createPreviewWrapper(elCfg) {
    var wrapper = document.createElement('div');
    wrapper.className = 'mb-element-wrapper';
    wrapper.setAttribute('data-mb-uid', elCfg.uid);
    wrapper.style.position = 'absolute';
    wrapper.style.left = (elCfg.x || 0) + 'px';
    wrapper.style.top = (elCfg.y || 0) + 'px';
    wrapper.style.width = (elCfg.width || 100) + 'px';
    wrapper.style.height = (elCfg.height || 30) + 'px';
    wrapper.style.zIndex = '1';
    wrapper.style.cursor = 'move';

    // Render the element inside (using a mini renderer for preview)
    var inner = renderPreviewElement(elCfg);
    inner.style.pointerEvents = 'none';
    inner.style.width = '100%';
    inner.style.height = '100%';
    inner.style.position = 'relative';
    inner.style.left = '0';
    inner.style.top = '0';
    wrapper.appendChild(inner);

    // Selection highlight
    if (elCfg.uid === _selectedUid) {
      wrapper.classList.add('mb-selected');
      // Add resize handles
      addResizeHandles(wrapper);
    }

    return wrapper;
  }

  function renderPreviewElement(cfg) {
    // Simplified element renderer for the builder preview.
    // Uses the same visual appearance but without setting IDs (to avoid conflicts).
    var root;

    switch (cfg.type) {
      case 'heading': {
        var tag = cfg.tag || 'h1';
        root = document.createElement(tag);
        root.textContent = cfg.text || 'Heading';
        root.style.fontSize = '26px';
        root.style.marginBottom = '0';
        root.style.textAlign = 'center';
        root.style.color = '#fff';
        root.style.margin = '0';
        root.style.lineHeight = (cfg.height || 36) + 'px';
        break;
      }
      case 'text': {
        root = document.createElement('p');
        root.innerHTML = cfg.text || 'Text';
        root.style.margin = '0';
        root.style.color = '#fff';
        root.style.fontSize = '14px';
        root.style.lineHeight = (cfg.height || 24) + 'px';
        break;
      }
      case 'button': {
        root = document.createElement('button');
        root.textContent = cfg.text || 'Button';
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.border = 'none';
        root.style.borderRadius = '8px';
        root.style.cursor = 'pointer';
        root.style.fontWeight = 'bold';
        root.style.fontSize = '13px';
        if (cfg.variant === 'secondary') {
          root.style.background = 'transparent';
          root.style.color = '#fff';
          root.style.border = '1px solid #555';
        } else {
          root.style.background = '#00ff88';
          root.style.color = '#000';
        }
        break;
      }
      case 'slider': {
        root = document.createElement('div');
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.gap = '8px';
        root.style.height = '100%';
        var sl = document.createElement('span');
        sl.textContent = cfg.label || 'Slider';
        sl.style.fontSize = '13px';
        sl.style.color = '#ddd';
        sl.style.whiteSpace = 'nowrap';
        var inp = document.createElement('input');
        inp.type = 'range';
        inp.style.flex = '1';
        inp.style.accentColor = '#00ff88';
        if (cfg.min !== undefined) inp.min = cfg.min;
        if (cfg.max !== undefined) inp.max = cfg.max;
        if (cfg.defaultValue !== undefined) inp.value = cfg.defaultValue;
        var val = document.createElement('span');
        val.textContent = cfg.defaultValue !== undefined ? String(cfg.defaultValue) : '0';
        val.style.fontSize = '13px';
        val.style.color = '#fff';
        val.style.minWidth = '28px';
        val.style.textAlign = 'right';
        root.appendChild(sl);
        root.appendChild(inp);
        root.appendChild(val);
        break;
      }
      case 'select': {
        root = document.createElement('div');
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.gap = '8px';
        root.style.height = '100%';
        var sl2 = document.createElement('span');
        sl2.textContent = cfg.label || 'Select';
        sl2.style.fontSize = '13px';
        sl2.style.color = '#ddd';
        sl2.style.whiteSpace = 'nowrap';
        var sel2 = document.createElement('select');
        sel2.style.flex = '1';
        sel2.style.padding = '4px 6px';
        sel2.style.background = '#222';
        sel2.style.color = '#fff';
        sel2.style.border = '1px solid #444';
        sel2.style.borderRadius = '6px';
        sel2.style.fontSize = '12px';
        (cfg.options || []).forEach(function (o) {
          var opt = document.createElement('option');
          opt.textContent = o.text;
          sel2.appendChild(opt);
        });
        root.appendChild(sl2);
        root.appendChild(sel2);
        break;
      }
      case 'numberInput': {
        root = document.createElement('div');
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.gap = '8px';
        root.style.height = '100%';
        var nl = document.createElement('span');
        nl.textContent = cfg.label || 'Number';
        nl.style.fontSize = '13px';
        nl.style.color = '#ddd';
        nl.style.whiteSpace = 'nowrap';
        var ni = document.createElement('input');
        ni.type = 'number';
        ni.style.width = '80px';
        ni.style.padding = '4px 6px';
        ni.style.background = '#222';
        ni.style.color = '#fff';
        ni.style.border = '1px solid #444';
        ni.style.borderRadius = '6px';
        ni.style.fontSize = '12px';
        if (cfg.defaultValue !== undefined) ni.value = cfg.defaultValue;
        root.appendChild(nl);
        root.appendChild(ni);
        break;
      }
      case 'textInput': {
        root = document.createElement('div');
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.gap = '8px';
        root.style.height = '100%';
        var tl = document.createElement('span');
        tl.textContent = cfg.label || 'Text';
        tl.style.fontSize = '13px';
        tl.style.color = '#ddd';
        tl.style.whiteSpace = 'nowrap';
        var ti = document.createElement('input');
        ti.type = 'text';
        ti.style.flex = '1';
        ti.style.padding = '4px 6px';
        ti.style.background = '#222';
        ti.style.color = '#fff';
        ti.style.border = '1px solid #444';
        ti.style.borderRadius = '6px';
        ti.style.fontSize = '12px';
        if (cfg.placeholder) ti.placeholder = cfg.placeholder;
        root.appendChild(tl);
        root.appendChild(ti);
        break;
      }
      case 'divider': {
        root = document.createElement('hr');
        root.style.border = 'none';
        root.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        root.style.margin = '0';
        root.style.width = '100%';
        break;
      }
      case 'image': {
        root = document.createElement('div');
        root.textContent = '[Image]';
        root.style.color = '#666';
        root.style.fontSize = '12px';
        root.style.textAlign = 'center';
        root.style.lineHeight = (cfg.height || 30) + 'px';
        root.style.border = '1px dashed #444';
        root.style.borderRadius = '4px';
        break;
      }
      default:
        root = document.createElement('div');
        root.textContent = cfg.text || cfg.type;
        root.style.color = '#888';
        root.style.fontSize = '12px';
    }

    // Apply custom style overrides
    if (cfg.style) {
      var keys = Object.keys(cfg.style);
      for (var i = 0; i < keys.length; i++) {
        root.style[keys[i]] = cfg.style[keys[i]];
      }
    }

    return root;
  }

  // ===================================================================
  // Resize Handles
  // ===================================================================
  function addResizeHandles(wrapper) {
    var handles = ['e', 'w', 's', 'n', 'se', 'sw', 'ne', 'nw'];
    handles.forEach(function (handle) {
      var h = document.createElement('div');
      h.className = 'mb-resize-handle mb-handle-' + handle;
      h.setAttribute('data-handle', handle);
      h.style.position = 'absolute';
      h.style.width = '8px';
      h.style.height = '8px';
      h.style.background = '#00ff88';
      h.style.border = '1px solid #000';
      h.style.borderRadius = '2px';
      h.style.zIndex = '10';
      h.style.pointerEvents = 'auto';

      // Position the handle
      switch (handle) {
        case 'n':  h.style.top = '-4px'; h.style.left = 'calc(50% - 4px)'; h.style.cursor = 'n-resize'; break;
        case 's':  h.style.bottom = '-4px'; h.style.left = 'calc(50% - 4px)'; h.style.cursor = 's-resize'; break;
        case 'e':  h.style.right = '-4px'; h.style.top = 'calc(50% - 4px)'; h.style.cursor = 'e-resize'; break;
        case 'w':  h.style.left = '-4px'; h.style.top = 'calc(50% - 4px)'; h.style.cursor = 'w-resize'; break;
        case 'se': h.style.bottom = '-4px'; h.style.right = '-4px'; h.style.cursor = 'se-resize'; break;
        case 'sw': h.style.bottom = '-4px'; h.style.left = '-4px'; h.style.cursor = 'sw-resize'; break;
        case 'ne': h.style.top = '-4px'; h.style.right = '-4px'; h.style.cursor = 'ne-resize'; break;
        case 'nw': h.style.top = '-4px'; h.style.left = '-4px'; h.style.cursor = 'nw-resize'; break;
      }

      wrapper.appendChild(h);
    });
  }

  // ===================================================================
  // Drag System
  // ===================================================================
  function onPreviewMouseDown(e) {
    var previewEl = document.getElementById('mbMenuPreview');
    if (!previewEl) return;

    // Check for resize handle
    var handleEl = e.target.closest('.mb-resize-handle');
    if (handleEl) {
      var wrapperEl = handleEl.parentElement;
      var uid = wrapperEl.getAttribute('data-mb-uid');
      var elCfg = getElementByUid(uid);
      if (!elCfg) return;
      e.preventDefault();
      e.stopPropagation();
      _resizing = {
        uid: uid,
        handle: handleEl.getAttribute('data-handle'),
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        origX: elCfg.x || 0,
        origY: elCfg.y || 0,
        origW: elCfg.width || 100,
        origH: elCfg.height || 30
      };
      pushUndo();
      return;
    }

    // Check for element wrapper
    var wrapperEl = e.target.closest('.mb-element-wrapper');
    if (wrapperEl && previewEl.contains(wrapperEl)) {
      var uid = wrapperEl.getAttribute('data-mb-uid');
      e.preventDefault();
      e.stopPropagation();
      selectElement(uid);

      var elCfg = getElementByUid(uid);
      if (!elCfg) return;
      _dragging = {
        uid: uid,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startElX: elCfg.x || 0,
        startElY: elCfg.y || 0
      };
      pushUndo();
      return;
    }

    // Click on empty area — deselect
    if (previewEl.contains(e.target) || e.target === previewEl) {
      selectElement(null);
    }
  }

  function onPreviewMouseMove(e) {
    if (_dragging) {
      e.preventDefault();
      var dx = e.clientX - _dragging.startMouseX;
      var dy = e.clientY - _dragging.startMouseY;
      var rawX = snap(_dragging.startElX + dx);
      var rawY = snap(_dragging.startElY + dy);

      var elCfg = getElementByUid(_dragging.uid);
      if (elCfg) {
        // Apply alignment snapping
        var aligned = computeAlignSnap(_dragging.uid, rawX, rawY, elCfg.width || 100, elCfg.height || 30);
        elCfg.x = aligned.x;
        elCfg.y = aligned.y;

        // Show alignment guides
        showAlignGuides(aligned.guides);

        // Update DOM directly for smooth dragging
        var wrapper = document.querySelector('.mb-element-wrapper[data-mb-uid="' + _dragging.uid + '"]');
        if (wrapper) {
          wrapper.style.left = aligned.x + 'px';
          wrapper.style.top = aligned.y + 'px';
        }

        // Update property fields
        updatePositionFields(elCfg);
      }
    }

    if (_resizing) {
      e.preventDefault();
      var dx = e.clientX - _resizing.startMouseX;
      var dy = e.clientY - _resizing.startMouseY;
      var elCfg = getElementByUid(_resizing.uid);
      if (!elCfg) return;

      var newX = _resizing.origX;
      var newY = _resizing.origY;
      var newW = _resizing.origW;
      var newH = _resizing.origH;
      var handle = _resizing.handle;

      if (handle.indexOf('e') >= 0) newW = snap(Math.max(20, _resizing.origW + dx));
      if (handle.indexOf('w') >= 0) {
        newW = snap(Math.max(20, _resizing.origW - dx));
        newX = snap(_resizing.origX + (_resizing.origW - newW));
      }
      if (handle.indexOf('s') >= 0) newH = snap(Math.max(14, _resizing.origH + dy));
      if (handle.indexOf('n') >= 0) {
        newH = snap(Math.max(14, _resizing.origH - dy));
        newY = snap(_resizing.origY + (_resizing.origH - newH));
      }

      // Apply alignment snapping for resizing
      var aligned = computeAlignSnap(_resizing.uid, newX, newY, newW, newH);
      showAlignGuides(aligned.guides);

      elCfg.x = newX;
      elCfg.y = newY;
      elCfg.width = newW;
      elCfg.height = newH;

      var wrapper = document.querySelector('.mb-element-wrapper[data-mb-uid="' + _resizing.uid + '"]');
      if (wrapper) {
        wrapper.style.left = newX + 'px';
        wrapper.style.top = newY + 'px';
        wrapper.style.width = newW + 'px';
        wrapper.style.height = newH + 'px';
      }

      updatePositionFields(elCfg);
    }
  }

  function onPreviewMouseUp(e) {
    if (_dragging) {
      _dragging = null;
      clearAlignGuides();
      renderPreview(); // re-render to update handles
    }
    if (_resizing) {
      _resizing = null;
      clearAlignGuides();
      renderPreview();
    }
  }

  function updatePositionFields(elCfg) {
    var xIn = document.getElementById('mbElX');
    var yIn = document.getElementById('mbElY');
    var wIn = document.getElementById('mbElW');
    var hIn = document.getElementById('mbElH');
    if (xIn) xIn.value = elCfg.x || 0;
    if (yIn) yIn.value = elCfg.y || 0;
    if (wIn) wIn.value = elCfg.width || 100;
    if (hIn) hIn.value = elCfg.height || 30;
  }

  // ===================================================================
  // Selection
  // ===================================================================
  function selectElement(uid) {
    _selectedUid = uid;
    renderPreview();
    renderElementList();
    if (uid) {
      var el = getElementByUid(uid);
      if (el) populatePropsPanel(el);
    } else {
      clearPropsPanel();
    }
  }

  // ===================================================================
  // Property Panel
  // ===================================================================

  // Map of type → which property rows to show
  var TYPE_FIELDS = {
    heading:     ['mbElTagRow'],
    text:        [],
    button:      ['mbElIdRow', 'mbElVariantRow', 'mbElActionRow'],
    slider:      ['mbElLabelRow', 'mbElInputIdRow', 'mbElValueIdRow', 'mbElMinRow', 'mbElMaxRow', 'mbElStepRow', 'mbElDefaultRow'],
    select:      ['mbElLabelRow', 'mbElIdRow', 'mbElOptionsRow', 'mbElDefaultRow'],
    numberInput: ['mbElLabelRow', 'mbElIdRow', 'mbElMinRow', 'mbElMaxRow', 'mbElStepRow', 'mbElDefaultRow'],
    textInput:   ['mbElLabelRow', 'mbElIdRow', 'mbElPlaceholderRow'],
    divider:     [],
    image:       []
  };

  var ALL_OPTIONAL_ROWS = [
    'mbElTagRow', 'mbElIdRow', 'mbElVariantRow', 'mbElActionRow',
    'mbElLabelRow', 'mbElPlaceholderRow', 'mbElMinRow', 'mbElMaxRow',
    'mbElStepRow', 'mbElDefaultRow', 'mbElInputIdRow', 'mbElValueIdRow',
    'mbElOptionsRow'
  ];

  function populatePropsPanel(el) {
    // Show right panel content
    var content = document.getElementById('mbRightPanelContent');
    if (content) content.classList.remove('hidden');

    // Set values
    setVal('mbElType', el.type || 'text');
    setVal('mbElText', el.text || '');
    setVal('mbElTag', el.tag || 'h1');
    setVal('mbElId', el.elementId || '');
    setVal('mbElVariant', el.variant || 'primary');
    setVal('mbElAction', el.action || '');
    setVal('mbElLabel', el.label || '');
    setVal('mbElPlaceholder', el.placeholder || '');
    setVal('mbElMin', el.min !== undefined ? el.min : '');
    setVal('mbElMax', el.max !== undefined ? el.max : '');
    setVal('mbElStep', el.step !== undefined ? el.step : '');
    setVal('mbElDefault', el.defaultValue !== undefined ? el.defaultValue : '');
    setVal('mbElInputId', el.inputId || '');
    setVal('mbElValueId', el.valueId || '');
    setVal('mbElX', el.x || 0);
    setVal('mbElY', el.y || 0);
    setVal('mbElW', el.width || 100);
    setVal('mbElH', el.height || 30);

    // Options textarea for select type
    var optStr = '';
    if (el.options && el.options.length) {
      optStr = el.options.map(function (o) { return o.value + ':' + o.text; }).join('\n');
    }
    setVal('mbElOptions', optStr);

    // Style fields
    var s = el.style || {};
    setVal('mbElFontSize', s.fontSize || '');
    setVal('mbElColor', s.color || '');
    setVal('mbElBgColor', s.background || '');
    setVal('mbElBorderRadius', s.borderRadius || '');
    setVal('mbElFontWeight', s.fontWeight || '');
    setVal('mbElTextAlign', s.textAlign || '');
    setVal('mbElPadding', s.padding || '');

    // Show/hide type-specific rows
    showTypeFields(el.type);
  }

  function clearPropsPanel() {
    var content = document.getElementById('mbRightPanelContent');
    if (content) content.classList.add('hidden');
  }

  function showTypeFields(type) {
    var visible = TYPE_FIELDS[type] || [];
    ALL_OPTIONAL_ROWS.forEach(function (rowId) {
      var row = document.getElementById(rowId);
      if (row) row.style.display = visible.indexOf(rowId) >= 0 ? '' : 'none';
    });
  }

  function setVal(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val;
  }

  function readPropsIntoElement() {
    if (!_selectedUid) return;
    var el = getElementByUid(_selectedUid);
    if (!el) return;

    pushUndo();

    el.type = document.getElementById('mbElType').value || el.type;
    el.text = document.getElementById('mbElText').value;
    el.tag = document.getElementById('mbElTag').value || 'h1';
    el.elementId = document.getElementById('mbElId').value || undefined;
    el.variant = document.getElementById('mbElVariant').value || 'primary';
    el.action = document.getElementById('mbElAction').value || undefined;
    el.label = document.getElementById('mbElLabel').value || undefined;
    el.placeholder = document.getElementById('mbElPlaceholder').value || undefined;

    var minVal = document.getElementById('mbElMin').value;
    var maxVal = document.getElementById('mbElMax').value;
    var stepVal = document.getElementById('mbElStep').value;
    var defVal = document.getElementById('mbElDefault').value;
    el.min = minVal !== '' ? Number(minVal) : undefined;
    el.max = maxVal !== '' ? Number(maxVal) : undefined;
    el.step = stepVal !== '' ? Number(stepVal) : undefined;
    el.defaultValue = defVal !== '' ? Number(defVal) : undefined;

    el.inputId = document.getElementById('mbElInputId').value || undefined;
    el.valueId = document.getElementById('mbElValueId').value || undefined;

    // Parse options textarea
    var optText = document.getElementById('mbElOptions').value.trim();
    if (optText) {
      el.options = optText.split('\n').map(function (line) {
        var parts = line.split(':');
        var v = parts[0].trim();
        var t = parts.length > 1 ? parts.slice(1).join(':').trim() : v;
        return { value: v, text: t };
      }).filter(function (o) { return o.value; });
    }

    el.x = parseInt(document.getElementById('mbElX').value) || 0;
    el.y = parseInt(document.getElementById('mbElY').value) || 0;
    el.width = parseInt(document.getElementById('mbElW').value) || 100;
    el.height = parseInt(document.getElementById('mbElH').value) || 30;

    // Style
    var style = {};
    var fs = document.getElementById('mbElFontSize').value.trim();
    var co = document.getElementById('mbElColor').value.trim();
    var bg = document.getElementById('mbElBgColor').value.trim();
    var br = document.getElementById('mbElBorderRadius').value.trim();
    var fw = document.getElementById('mbElFontWeight').value.trim();
    var ta = document.getElementById('mbElTextAlign').value;
    var pd = document.getElementById('mbElPadding').value.trim();
    if (fs) style.fontSize = fs;
    if (co) style.color = co;
    if (bg) style.background = bg;
    if (br) style.borderRadius = br;
    if (fw) style.fontWeight = fw;
    if (ta) style.textAlign = ta;
    if (pd) style.padding = pd;
    el.style = style;

    showTypeFields(el.type);
    renderPreview();
    renderElementList();
  }

  // ===================================================================
  // Element List (sidebar)
  // ===================================================================
  function renderElementList() {
    var listEl = document.getElementById('mbElementList');
    if (!listEl) return;
    var cfg = getCurrentConfig();
    if (!cfg) { listEl.innerHTML = ''; return; }

    listEl.innerHTML = '';
    (cfg.elements || []).forEach(function (el) {
      var row = document.createElement('div');
      row.className = 'mb-el-row';
      if (el.uid === _selectedUid) row.classList.add('mb-el-selected');

      var typeLabel = document.createElement('span');
      typeLabel.className = 'mb-el-type';
      typeLabel.textContent = '[' + (el.type || '?').substring(0, 6) + ']';

      var textLabel = document.createElement('span');
      textLabel.className = 'mb-el-text';
      textLabel.textContent = el.text || el.label || el.elementId || el.uid;

      var removeBtn = document.createElement('button');
      removeBtn.className = 'mb-el-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.setAttribute('data-uid', el.uid);

      row.appendChild(typeLabel);
      row.appendChild(textLabel);
      row.appendChild(removeBtn);

      row.addEventListener('click', function (e) {
        if (e.target === removeBtn) return;
        selectElement(el.uid);
      });

      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        removeElement(el.uid);
      });

      listEl.appendChild(row);
    });
  }

  // ===================================================================
  // Add / Remove / Duplicate
  // ===================================================================
  function addElement(type) {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    pushUndo();

    var uid = nextUid();
    var el = {
      uid: uid,
      type: type,
      x: 20,
      y: 20,
      width: 100,
      height: 30,
      style: {}
    };

    switch (type) {
      case 'heading':
        el.tag = 'h2';
        el.text = 'New Heading';
        el.width = cfg.width || 420;
        el.height = 36;
        el.x = 0;
        break;
      case 'text':
        el.text = 'New text';
        el.width = 200;
        el.height = 24;
        break;
      case 'button':
        el.text = 'Button';
        el.variant = 'primary';
        el.width = 120;
        el.height = 40;
        break;
      case 'slider':
        el.label = 'Slider';
        el.min = 0;
        el.max = 100;
        el.step = 1;
        el.defaultValue = 50;
        el.width = 300;
        el.height = 30;
        break;
      case 'select':
        el.label = 'Select';
        el.options = [{ value: 'option1', text: 'Option 1' }, { value: 'option2', text: 'Option 2' }];
        el.width = 300;
        el.height = 30;
        break;
      case 'numberInput':
        el.label = 'Number';
        el.min = 0;
        el.max = 100;
        el.step = 1;
        el.defaultValue = 0;
        el.width = 300;
        el.height = 30;
        break;
      case 'textInput':
        el.label = 'Text';
        el.placeholder = 'Enter text...';
        el.width = 300;
        el.height = 30;
        break;
      case 'divider':
        el.width = cfg.width ? cfg.width - 48 : 372;
        el.height = 2;
        el.x = 24;
        break;
    }

    cfg.elements.push(el);
    selectElement(uid);
    renderPreview();
    renderElementList();
  }

  function removeElement(uid) {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    pushUndo();
    cfg.elements = cfg.elements.filter(function (e) { return e.uid !== uid; });
    if (_selectedUid === uid) _selectedUid = null;
    renderPreview();
    renderElementList();
    clearPropsPanel();
  }

  function duplicateElement(uid) {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    var el = getElementByUid(uid);
    if (!el) return;
    pushUndo();

    var clone = JSON.parse(JSON.stringify(el));
    clone.uid = nextUid();
    clone.x = (clone.x || 0) + 20;
    clone.y = (clone.y || 0) + 20;
    // Clear elementId to avoid duplicates
    if (clone.elementId) clone.elementId = '';
    if (clone.inputId) clone.inputId = '';
    if (clone.valueId) clone.valueId = '';

    cfg.elements.push(clone);
    selectElement(clone.uid);
    renderPreview();
    renderElementList();
  }

  // ===================================================================
  // Container Property Change Handlers
  // ===================================================================
  function onContainerChange() {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    pushUndo();

    var fsCheck = document.getElementById('mbContainerFS');
    cfg.fullScreen = fsCheck ? fsCheck.checked : false;

    cfg.width = parseInt(document.getElementById('mbContainerW').value) || 420;
    cfg.height = parseInt(document.getElementById('mbContainerH').value) || 240;

    if (!cfg.style) cfg.style = {};
    var bg = document.getElementById('mbContainerBg').value.trim();
    var br = document.getElementById('mbContainerBR').value.trim();
    if (bg) cfg.style.background = bg; else delete cfg.style.background;
    if (br) cfg.style.borderRadius = br + 'px'; else delete cfg.style.borderRadius;

    // Hide/show width/height fields based on full screen
    var wRow = document.getElementById('mbContainerWRow');
    var hRow = document.getElementById('mbContainerHRow');
    if (wRow) wRow.style.display = cfg.fullScreen ? 'none' : '';
    if (hRow) hRow.style.display = cfg.fullScreen ? 'none' : '';

    renderPreview();
  }

  // ===================================================================
  // Save / Load / Reset
  // ===================================================================
  function saveMenu() {
    var cfg = getCurrentConfig();
    if (!cfg) return;
    var name = cfg.id || _currentMenuId;
    fetch('/api/menus/' + encodeURIComponent(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    }).then(function (r) {
      if (r.ok) {
        console.log('menuBuilder: saved menu', name);
      } else {
        console.warn('menuBuilder: failed to save menu', name);
      }
    }).catch(function (err) {
      console.warn('menuBuilder: save error', err);
    });
  }

  function loadAllMenuConfigs() {
    // Start with defaults
    _menuConfigs = window.getDefaultMenuConfigs ? window.getDefaultMenuConfigs() : {};

    // Try to load custom menus
    fetch('/api/menus').then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (names) {
      if (!names || !names.length) {
        finishLoad();
        return;
      }
      var promises = names.map(function (name) {
        return fetch('/api/menus/' + encodeURIComponent(name))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      });
      return Promise.all(promises).then(function (menus) {
        menus.forEach(function (m) {
          if (m && m.id) _menuConfigs[m.id] = m;
        });
        finishLoad();
      });
    }).catch(function () {
      finishLoad();
    });

    function finishLoad() {
      var ids = Object.keys(_menuConfigs);
      if (!_currentMenuId || !_menuConfigs[_currentMenuId]) {
        _currentMenuId = ids[0] || null;
      }
      populateMenuSelect();
      populateContainerFields();
      renderPreview();
      renderElementList();
      _undoStack = [];
      _redoStack = [];
      updateUndoRedoButtons();
    }
  }

  function resetToDefault() {
    if (!_currentMenuId) return;
    var defaults = window.getDefaultMenuConfigs ? window.getDefaultMenuConfigs() : {};
    if (defaults[_currentMenuId]) {
      pushUndo();
      _menuConfigs[_currentMenuId] = defaults[_currentMenuId];
      _selectedUid = null;
      populateContainerFields();
      renderPreview();
      renderElementList();
      clearPropsPanel();
    }
  }

  function createNewMenu() {
    var name = prompt('Menu name (letters, numbers, hyphens):');
    if (!name) return;
    var id = name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
    if (!id) return;
    if (_menuConfigs[id]) {
      alert('Menu "' + id + '" already exists.');
      return;
    }
    pushUndo();
    _menuConfigs[id] = {
      id: id,
      name: name,
      width: 420,
      height: 240,
      style: {},
      elements: []
    };
    switchMenu(id);
  }

  function deleteCurrentMenu() {
    if (!_currentMenuId) return;
    var defaults = window.getDefaultMenuConfigs ? window.getDefaultMenuConfigs() : {};
    if (defaults[_currentMenuId]) {
      alert('Cannot delete a built-in menu. Use "Reset Default" instead.');
      return;
    }
    if (!confirm('Delete menu "' + _currentMenuId + '"?')) return;

    pushUndo();
    // Delete from server
    fetch('/api/menus/' + encodeURIComponent(_currentMenuId), { method: 'DELETE' }).catch(function () {});
    delete _menuConfigs[_currentMenuId];
    var ids = Object.keys(_menuConfigs);
    switchMenu(ids[0] || null);
  }

  // ===================================================================
  // Grid / Snap
  // ===================================================================
  function toggleSnap() {
    if (!_snapEnabled) {
      _snapEnabled = true;
      _snapSize = 10;
    } else if (_snapSize === 10) {
      _snapSize = 5;
    } else if (_snapSize === 5) {
      _snapSize = 1;
      _snapEnabled = false;
    }
    var btn = document.getElementById('mbSnapToggle');
    if (btn) btn.textContent = _snapEnabled ? 'Snap: ' + _snapSize + 'px' : 'Snap: Off';
  }

  function toggleAlignSnap() {
    _alignSnap = !_alignSnap;
    var btn = document.getElementById('mbAlignToggle');
    if (btn) {
      btn.textContent = _alignSnap ? 'Align Snap' : 'Align: Off';
      if (_alignSnap) btn.classList.add('active'); else btn.classList.remove('active');
    }
  }

  function toggleGrid() {
    _showGrid = !_showGrid;
    var btn = document.getElementById('mbGridToggle');
    if (btn) {
      btn.textContent = _showGrid ? 'Hide Grid' : 'Show Grid';
      if (_showGrid) btn.classList.add('active'); else btn.classList.remove('active');
    }
    renderPreview();
  }

  // ===================================================================
  // Initialization
  // ===================================================================
  function initMenuBuilder() {
    // Load configs
    loadAllMenuConfigs();

    // Menu selector
    var menuSel = document.getElementById('mbMenuSelect');
    if (menuSel) {
      menuSel.addEventListener('change', function () {
        switchMenu(menuSel.value);
      });
    }

    // New / Delete menu
    var newBtn = document.getElementById('mbNewMenu');
    if (newBtn) newBtn.addEventListener('click', createNewMenu);
    var delBtn = document.getElementById('mbDeleteMenu');
    if (delBtn) delBtn.addEventListener('click', deleteCurrentMenu);

    // Container fields
    ['mbContainerW', 'mbContainerH', 'mbContainerBg', 'mbContainerBR'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', onContainerChange);
    });

    // Full screen checkbox
    var fsCheck = document.getElementById('mbContainerFS');
    if (fsCheck) fsCheck.addEventListener('change', onContainerChange);

    // Clear background button
    var bgClearBtn = document.getElementById('mbContainerBgClear');
    if (bgClearBtn) {
      bgClearBtn.addEventListener('click', function () {
        var bgInput = document.getElementById('mbContainerBg');
        if (bgInput) bgInput.value = 'transparent';
        onContainerChange();
      });
    }

    // Add element buttons
    var addBtns = document.querySelectorAll('.mb-add-btn');
    addBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        addElement(btn.getAttribute('data-type'));
      });
    });

    // Save / Reset / Undo / Redo
    var saveBtn = document.getElementById('mbSave');
    if (saveBtn) saveBtn.addEventListener('click', saveMenu);
    var resetBtn = document.getElementById('mbResetDefault');
    if (resetBtn) resetBtn.addEventListener('click', resetToDefault);
    var undoBtn = document.getElementById('mbUndo');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    var redoBtn = document.getElementById('mbRedo');
    if (redoBtn) redoBtn.addEventListener('click', redo);

    // Snap / Align / Grid toggles
    var snapBtn = document.getElementById('mbSnapToggle');
    if (snapBtn) snapBtn.addEventListener('click', toggleSnap);
    var alignBtn = document.getElementById('mbAlignToggle');
    if (alignBtn) alignBtn.addEventListener('click', toggleAlignSnap);
    var gridBtn = document.getElementById('mbGridToggle');
    if (gridBtn) gridBtn.addEventListener('click', toggleGrid);

    // Duplicate / Delete element buttons
    var dupBtn = document.getElementById('mbElDuplicate');
    if (dupBtn) dupBtn.addEventListener('click', function () { if (_selectedUid) duplicateElement(_selectedUid); });
    var elDelBtn = document.getElementById('mbElDelete');
    if (elDelBtn) elDelBtn.addEventListener('click', function () { if (_selectedUid) removeElement(_selectedUid); });

    // Property panel change handlers — debounced
    var propFields = [
      'mbElType', 'mbElText', 'mbElTag', 'mbElId', 'mbElVariant', 'mbElAction',
      'mbElLabel', 'mbElPlaceholder', 'mbElMin', 'mbElMax', 'mbElStep', 'mbElDefault',
      'mbElInputId', 'mbElValueId', 'mbElOptions',
      'mbElX', 'mbElY', 'mbElW', 'mbElH',
      'mbElFontSize', 'mbElColor', 'mbElBgColor', 'mbElBorderRadius',
      'mbElFontWeight', 'mbElTextAlign', 'mbElPadding'
    ];
    propFields.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', readPropsIntoElement);
        // For text inputs, also handle on Enter
        if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) {
          el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') readPropsIntoElement();
          });
        }
      }
    });

    // Mouse handlers on the preview container
    var previewContainer = document.getElementById('mbPreviewContainer');
    if (previewContainer) {
      previewContainer.addEventListener('mousedown', onPreviewMouseDown);
    }
    document.addEventListener('mousemove', onPreviewMouseMove);
    document.addEventListener('mouseup', onPreviewMouseUp);

    // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keyboard shortcuts
    window.addEventListener('keydown', function (e) {
      var panel = document.getElementById('panelMenuBuilder');
      if (!panel || !panel.classList.contains('active')) return;
      // Don't intercept when typing in an input/textarea
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    });
  }

  function resizeMenuBuilderPreview() {
    // Preview container fills the viewport — no special resize needed
    // but re-render to ensure proper dimensions
    renderPreview();
  }

  // ===================================================================
  // Exports
  // ===================================================================
  window._initMenuBuilderPreview = initMenuBuilder;
  window._resizeMenuBuilderPreview = resizeMenuBuilderPreview;
})();
