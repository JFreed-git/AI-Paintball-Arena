/**
 * devApp.js — Dev Workbench bootstrap
 *
 * PURPOSE: Replaces game.js for the dev workbench. Creates the Three.js
 * scene/camera/renderer, provides stubs for functions that game modes expect,
 * manages sidebar navigation, and runs the master render loop.
 *
 * EXPORTS (globals):
 *   scene, camera, renderer, raycaster, mouse
 *
 * EXPORTS (window):
 *   setFirstPersonWeapon(modelType)
 *   clearFirstPersonWeapon()
 *   getAllHeroes() — returns window.HEROES (loaded from filesystem)
 *
 * DEPENDENCIES: Three.js, environment.js, crosshair.js, input.js,
 *   menuNavigation.js, weaponModels.js, devSplitScreen.js, devHeroEditor.js
 */

// Global scene/camera/renderer (shared across scripts)
var scene, camera, renderer;
var raycaster, mouse;

// Mouse sensitivity global expected by input.js
var mouseSensitivity = 1.0;

/**
 * Get all heroes — just returns window.HEROES (loaded from filesystem on startup).
 */
window.getAllHeroes = function () {
  return window.HEROES || [];
};

// ------- First-person weapon viewmodel -------
var _fpWeaponGroup = null;

window.setFirstPersonWeapon = function (modelType, fpOffset, fpRotation) {
  if (_fpWeaponGroup && camera) {
    camera.remove(_fpWeaponGroup);
    _fpWeaponGroup.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    _fpWeaponGroup = null;
  }

  if (!modelType || !camera) return;
  if (typeof buildWeaponModel !== 'function') return;

  var model = buildWeaponModel(modelType);
  _fpWeaponGroup = new THREE.Group();
  _fpWeaponGroup.add(model);

  var pos = fpOffset || { x: 0.28, y: -0.22, z: -0.45 };
  var rot = fpRotation || { x: 0.05, y: -0.15, z: 0 };
  _fpWeaponGroup.position.set(pos.x, pos.y, pos.z);
  _fpWeaponGroup.rotation.set(rot.x, rot.y, rot.z);

  _fpWeaponGroup.traverse(function (c) {
    if (c.isMesh && c.material) {
      c.material = c.material.clone();
      c.material.depthTest = false;
      c.material.depthWrite = false;
      c.renderOrder = 999;
    }
  });

  camera.add(_fpWeaponGroup);
};

window.clearFirstPersonWeapon = function () {
  window.setFirstPersonWeapon(null);
};

// ------- Active panel tracking -------
var _activePanel = 'splitScreen';
var _mapEditorWasOpen = false;

// ------- Sidebar / Right Panel Collapse -------

function hideGameModeUI() {
  var sidebar = document.getElementById('devSidebar');
  var rightPanel = document.getElementById('devRightPanel');
  var toolbar = document.getElementById('heViewportToolbar');
  var mbToolbar = document.getElementById('mbViewportToolbar');
  var mbPreview = document.getElementById('mbPreviewContainer');
  var leftExpand = document.getElementById('devSidebarExpand');
  var rightExpand = document.getElementById('devRightPanelExpand');
  if (sidebar) sidebar.classList.add('hidden');
  if (rightPanel) rightPanel.classList.add('hidden');
  if (toolbar) toolbar.classList.add('hidden');
  if (mbToolbar) mbToolbar.classList.add('hidden');
  if (mbPreview) mbPreview.classList.add('hidden');
  if (leftExpand) leftExpand.classList.add('hidden');
  if (rightExpand) rightExpand.classList.add('hidden');
}

function toggleSidebar(forceCollapse) {
  var sidebar = document.getElementById('devSidebar');
  var expandTab = document.getElementById('devSidebarExpand');
  if (!sidebar) return;

  var shouldCollapse = (typeof forceCollapse === 'boolean') ? forceCollapse : !sidebar.classList.contains('collapsed');

  if (shouldCollapse) {
    sidebar.classList.add('collapsed');
    if (expandTab) expandTab.classList.remove('hidden');
  } else {
    sidebar.classList.remove('collapsed');
    if (expandTab) expandTab.classList.add('hidden');
  }

  setTimeout(function () {
    resizeRenderer();
    if (typeof window._resizeHeroEditorPreview === 'function') window._resizeHeroEditorPreview();
    if (typeof window._resizeWmbPreview === 'function') window._resizeWmbPreview();
  }, 50);
}

function toggleRightPanel(forceCollapse) {
  var panel = document.getElementById('devRightPanel');
  var expandTab = document.getElementById('devRightPanelExpand');
  if (!panel) return;

  var shouldCollapse = (typeof forceCollapse === 'boolean') ? forceCollapse : !panel.classList.contains('collapsed');

  if (shouldCollapse) {
    panel.classList.add('collapsed');
    if (expandTab) expandTab.classList.remove('hidden');
  } else {
    panel.classList.remove('collapsed');
    if (expandTab) expandTab.classList.add('hidden');
  }

  setTimeout(function () {
    resizeRenderer();
    if (typeof window._resizeHeroEditorPreview === 'function') window._resizeHeroEditorPreview();
  }, 50);
}

// ------- Initialization -------
function init() {
  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.set(0, 2, 5);
  camera.rotation.order = 'YXZ';
  camera.up.set(0, 1, 0);
  resetCameraToDefaults();

  scene.add(camera);

  // Renderer — appended to devViewport's gameContainer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  var container = document.getElementById('gameContainer');
  container.appendChild(renderer.domElement);

  // Size renderer to the viewport (not full window since sidebar exists)
  resizeRenderer();

  // Environment
  setupEnvironment();

  // Crosshair
  ensureCrosshair();

  // Raycasting
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Controls
  bindPlayerControls(renderer);

  // Menu UI (wires buttons that exist in DOM — safe for stubs)
  bindUI();

  // Hide HUD and menus on load
  setHUDVisible(false);
  showOnlyMenu(null);

  // Sidebar nav
  wireSidebarNav();

  // Sidebar collapse/expand buttons
  var sidebarCollapseBtn = document.getElementById('devSidebarCollapse');
  if (sidebarCollapseBtn) sidebarCollapseBtn.addEventListener('click', function () { toggleSidebar(true); });
  var sidebarExpandBtn = document.getElementById('devSidebarExpand');
  if (sidebarExpandBtn) sidebarExpandBtn.addEventListener('click', function () { toggleSidebar(false); });

  // Right panel collapse/expand buttons
  var rightCollapseBtn = document.getElementById('devRightPanelCollapse');
  if (rightCollapseBtn) rightCollapseBtn.addEventListener('click', function () { toggleRightPanel(true); });
  var rightExpandBtn = document.getElementById('devRightPanelExpand');
  if (rightExpandBtn) rightExpandBtn.addEventListener('click', function () { toggleRightPanel(false); });

  // Populate dropdowns
  populateAllDropdowns();

  // Load all heroes and weapon models from filesystem
  loadAllHeroes();
  loadCustomWeaponModels();

  // Init hero editor and weapon model builder previews
  if (typeof window._initHeroEditorPreview === 'function') {
    window._initHeroEditorPreview();
  }
  if (typeof window._initWmbPreview === 'function') {
    window._initWmbPreview();
  }
  if (typeof window._initMenuBuilderPreview === 'function') {
    window._initMenuBuilderPreview();
  }

  // Start loop
  animate();
}

function resizeRenderer() {
  var viewport = document.getElementById('devViewport');
  if (!viewport) return;
  var w = viewport.clientWidth;
  var h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.resizeRenderer = resizeRenderer;

window.addEventListener('resize', function () {
  resizeRenderer();
  if (typeof window._resizeHeroEditorPreview === 'function') {
    window._resizeHeroEditorPreview();
  }
  if (typeof window._resizeWmbPreview === 'function') {
    window._resizeWmbPreview();
  }
  if (typeof window._resizeMenuBuilderPreview === 'function') {
    window._resizeMenuBuilderPreview();
  }
});

// ------- Sidebar Navigation -------
function wireSidebarNav() {
  var buttons = document.querySelectorAll('.dev-nav-btn');
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panelId = btn.getAttribute('data-panel');
      switchPanel(panelId);
    });
  });
}

function switchPanel(panelId) {
  // If leaving map editor, stop it
  if (_activePanel === 'mapEditor' && _mapEditorWasOpen) {
    _mapEditorWasOpen = false;
    // Map editor manages its own exit — the Exit button calls the editor's exit handler
  }

  _activePanel = panelId;

  // Update nav buttons
  var buttons = document.querySelectorAll('.dev-nav-btn');
  buttons.forEach(function (btn) {
    var id = btn.getAttribute('data-panel');
    btn.classList.toggle('active', id === panelId);
  });

  // Update panels
  var panels = document.querySelectorAll('.dev-panel');
  panels.forEach(function (p) {
    p.classList.toggle('active', p.id === 'panel' + capitalize(panelId));
  });

  // Refresh dropdowns when switching panels
  if (panelId === 'splitScreen' || panelId === 'quickTest' || panelId === 'heroEditor') {
    populateAllDropdowns();
  }
}

function capitalize(s) {
  if (!s) return '';
  // Convert camelCase panel IDs to PascalCase for panel element IDs
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Panel ID to element ID mapping
function getPanelElementId(panelId) {
  var map = {
    splitScreen: 'panelSplitScreen',
    heroEditor: 'panelHeroEditor',
    weaponModelBuilder: 'panelWeaponModelBuilder',
    menuBuilder: 'panelMenuBuilder',
    audioManager: 'panelAudioManager',
    mapEditor: 'panelMapEditor',
    quickTest: 'panelQuickTest'
  };
  return map[panelId] || '';
}

// Override switchPanel to use proper mapping + expanded layout for editor panels
(function () {
  var origSwitch = switchPanel;

  // Track previous panel for cleanup
  var _prevExpandedPanel = null;

  function collapseEditorLayout() {
    var sidebar = document.getElementById('devSidebar');
    var viewport = document.getElementById('devViewport');

    // Return hero preview container to its panel
    var heroContainer = document.getElementById('heroPreviewContainer');
    var heroPanel = document.getElementById('panelHeroEditor');
    if (heroContainer && heroPanel && heroContainer.classList.contains('viewport-mode')) {
      heroContainer.classList.remove('viewport-mode');
      heroPanel.appendChild(heroContainer);
    }

    // Return wmb preview container to its panel
    var wmbContainer = document.getElementById('wmbPreviewContainer');
    var wmbPanel = document.getElementById('panelWeaponModelBuilder');
    if (wmbContainer && wmbPanel && wmbContainer.classList.contains('viewport-mode')) {
      wmbContainer.classList.remove('viewport-mode');
      // Insert before the last dev-actions in the panel
      var wmbActions = wmbPanel.querySelectorAll('.dev-actions');
      if (wmbActions.length > 1) {
        wmbPanel.insertBefore(wmbContainer, wmbActions[wmbActions.length - 1]);
      } else {
        wmbPanel.appendChild(wmbContainer);
      }
    }

    // Hide menu builder preview
    var mbPreview = document.getElementById('mbPreviewContainer');
    if (mbPreview) mbPreview.classList.add('hidden');
    var mbToolbar = document.getElementById('mbViewportToolbar');
    if (mbToolbar) mbToolbar.classList.add('hidden');

    // Hide audio manager viewport
    var amViewport = document.getElementById('amViewportContainer');
    if (amViewport) amViewport.classList.add('hidden');

    if (sidebar) sidebar.classList.remove('expanded');
    _prevExpandedPanel = null;
  }

  function expandEditorLayout(panelId) {
    var sidebar = document.getElementById('devSidebar');
    var viewport = document.getElementById('devViewport');
    if (!sidebar || !viewport) return;

    sidebar.classList.add('expanded');

    if (panelId === 'heroEditor') {
      var heroContainer = document.getElementById('heroPreviewContainer');
      if (heroContainer) {
        viewport.appendChild(heroContainer);
        heroContainer.classList.add('viewport-mode');
        setTimeout(function () {
          if (typeof window._resizeHeroEditorPreview === 'function') {
            window._resizeHeroEditorPreview();
          }
        }, 50);
      }
    } else if (panelId === 'menuBuilder') {
      var mbPreview = document.getElementById('mbPreviewContainer');
      if (mbPreview) {
        mbPreview.classList.remove('hidden');
        mbPreview.classList.add('viewport-mode');
        setTimeout(function () {
          if (typeof window._resizeMenuBuilderPreview === 'function') {
            window._resizeMenuBuilderPreview();
          }
        }, 50);
      }
    } else if (panelId === 'weaponModelBuilder') {
      var wmbContainer = document.getElementById('wmbPreviewContainer');
      if (wmbContainer) {
        viewport.appendChild(wmbContainer);
        wmbContainer.classList.add('viewport-mode');
        setTimeout(function () {
          if (typeof window._resizeWmbPreview === 'function') {
            window._resizeWmbPreview();
          }
        }, 50);
      }
    } else if (panelId === 'audioManager') {
      var amViewport = document.getElementById('amViewportContainer');
      if (amViewport) {
        amViewport.classList.remove('hidden');
        amViewport.classList.add('viewport-mode');
      }
    }

    _prevExpandedPanel = panelId;
  }

  switchPanel = function (panelId) {
    if (_activePanel === 'mapEditor' && _mapEditorWasOpen) {
      _mapEditorWasOpen = false;
    }

    // Collapse previous expanded layout
    if (_prevExpandedPanel) {
      collapseEditorLayout();
    }

    _activePanel = panelId;

    var buttons = document.querySelectorAll('.dev-nav-btn');
    buttons.forEach(function (btn) {
      var id = btn.getAttribute('data-panel');
      btn.classList.toggle('active', id === panelId);
    });

    var panels = document.querySelectorAll('.dev-panel');
    var targetId = getPanelElementId(panelId);
    panels.forEach(function (p) {
      p.classList.toggle('active', p.id === targetId);
    });

    // Expand layout for editor panels
    if (panelId === 'heroEditor' || panelId === 'weaponModelBuilder' || panelId === 'menuBuilder' || panelId === 'audioManager') {
      expandEditorLayout(panelId);
    }

    // Show/hide right panel and viewport toolbars based on active panel
    var rightPanel = document.getElementById('devRightPanel');
    var heToolbar = document.getElementById('heViewportToolbar');
    var mbToolbar = document.getElementById('mbViewportToolbar');
    var rightExpandTab = document.getElementById('devRightPanelExpand');
    var hePropsContent = document.getElementById('devRightPanelContent');
    var heBodyContent = document.getElementById('heBodyPartsContent');
    var wmbPropsContent = document.getElementById('wmbRightPanelContent');
    var mbPropsContent = document.getElementById('mbRightPanelContent');
    var rightTitle = document.querySelector('#devRightPanelHeader h3');

    // Hide all right panel content sections first
    if (hePropsContent) hePropsContent.classList.add('hidden');
    if (heBodyContent) heBodyContent.classList.add('hidden');
    if (wmbPropsContent) wmbPropsContent.classList.add('hidden');
    if (mbPropsContent) mbPropsContent.classList.add('hidden');

    if (panelId === 'heroEditor') {
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (heToolbar) heToolbar.classList.remove('hidden');
      if (mbToolbar) mbToolbar.classList.add('hidden');
      // Apply current view mode (sets correct right panel content + toolbar buttons)
      if (typeof window._applyHeroViewMode === 'function') {
        window._applyHeroViewMode();
      } else {
        // Fallback if not yet loaded
        if (hePropsContent) hePropsContent.classList.remove('hidden');
        if (rightTitle) rightTitle.textContent = 'Hitbox Segments';
      }
    } else if (panelId === 'weaponModelBuilder') {
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (heToolbar) heToolbar.classList.add('hidden');
      if (mbToolbar) mbToolbar.classList.add('hidden');
      if (wmbPropsContent) wmbPropsContent.classList.remove('hidden');
      if (rightTitle) rightTitle.textContent = 'Part Properties';
    } else if (panelId === 'menuBuilder') {
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (heToolbar) heToolbar.classList.add('hidden');
      if (mbToolbar) mbToolbar.classList.remove('hidden');
      // mbPropsContent visibility is controlled by selection in menuBuilder.js
      if (rightTitle) rightTitle.textContent = 'Element Properties';
    } else {
      if (rightPanel) rightPanel.classList.add('hidden');
      if (heToolbar) heToolbar.classList.add('hidden');
      if (mbToolbar) mbToolbar.classList.add('hidden');
      if (rightExpandTab) rightExpandTab.classList.add('hidden');
    }

    // Load audio manager sounds when switching to that panel
    if (panelId === 'audioManager') {
      if (typeof window._initAudioManager === 'function') window._initAudioManager();
    }

    if (panelId === 'splitScreen' || panelId === 'quickTest' || panelId === 'heroEditor') {
      populateAllDropdowns();
      // Auto-load the first hero when opening the hero editor
      if (panelId === 'heroEditor') {
        var heSelect = document.getElementById('heHeroSelect');
        if (heSelect && heSelect.options.length > 0) {
          heSelect.selectedIndex = 0;
          heSelect.dispatchEvent(new Event('change'));
        }
      }
    }

    // Auto-open map editor when switching to that panel
    if (panelId === 'mapEditor') {
      var meOpenBtn = document.getElementById('meOpen');
      if (meOpenBtn) {
        setTimeout(function () { meOpenBtn.click(); }, 50);
      }
    }

    resizeRenderer();
  };
})();

// ------- Dropdown Population -------
function populateHeroDropdown(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var heroes = window.getAllHeroes();
  sel.innerHTML = '';
  heroes.forEach(function (h) {
    var opt = document.createElement('option');
    opt.value = h.id;
    opt.textContent = h.name;
    sel.appendChild(opt);
  });
}

function populateMapDropdownDev(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="__default__">Default Arena</option>';
  if (typeof fetchMapList !== 'function') return;
  fetchMapList().then(function (names) {
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }).catch(function () {});
}

function populateModelTypeDropdown(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '';
  var registry = window.WEAPON_MODEL_REGISTRY || {};
  Object.keys(registry).forEach(function (key) {
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = key;
    sel.appendChild(opt);
  });
}

function populateAllDropdowns() {
  populateHeroDropdown('ssHeroP1');
  populateHeroDropdown('ssHeroP2');
  populateHeroDropdown('heHeroSelect');
  populateHeroDropdown('qtHero');
  populateMapDropdownDev('ssMapSelect');
  populateMapDropdownDev('qtMapSelect');
  populateModelTypeDropdown('heModelType');
}

// ------- Hero & Weapon Model Loading -------

/**
 * Seed built-in heroes to filesystem if not already present, then load all
 * heroes from filesystem into window.HEROES.
 */
function loadAllHeroes() {
  var builtins = window.BUILTIN_HEROES || [];

  // Seed: write each built-in hero if it doesn't already exist
  var seedPromises = builtins.map(function (hero) {
    return fetch('/api/heroes/' + encodeURIComponent(hero.id)).then(function (r) {
      if (r.status === 404) {
        return fetch('/api/heroes/' + encodeURIComponent(hero.id), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hero)
        });
      }
    }).catch(function () {});
  });

  // After seeding, load all heroes from filesystem
  Promise.all(seedPromises).then(function () {
    return fetch('/api/heroes').then(function (r) { return r.json(); });
  }).then(function (names) {
    var promises = names.map(function (name) {
      return fetch('/api/heroes/' + encodeURIComponent(name)).then(function (r) { return r.json(); });
    });
    return Promise.all(promises);
  }).then(function (heroes) {
    if (heroes && heroes.length) {
      window.HEROES = heroes;
    }
    populateAllDropdowns();
  }).catch(function () {
    populateAllDropdowns();
  });
}

function loadCustomWeaponModels() {
  fetch('/api/weapon-models').then(function (r) { return r.json(); }).then(function (names) {
    var promises = names.map(function (name) {
      return fetch('/api/weapon-models/' + encodeURIComponent(name)).then(function (r) { return r.json(); });
    });
    return Promise.all(promises);
  }).then(function (models) {
    (models || []).forEach(function (modelDef) {
      if (modelDef && modelDef.modelType) {
        registerCustomWeaponModel(modelDef);
      }
    });
    populateModelTypeDropdown('heModelType');
    // Also populate weapon model builder load dropdown
    if (typeof window._refreshWmbLoadList === 'function') {
      window._refreshWmbLoadList();
    }
  }).catch(function () {});
}

/**
 * Register a custom weapon model definition into WEAPON_MODEL_REGISTRY.
 */
function registerCustomWeaponModel(modelDef) {
  if (!modelDef || !modelDef.modelType || !modelDef.parts) return;
  var registry = window.WEAPON_MODEL_REGISTRY;
  if (!registry) return;

  registry[modelDef.modelType] = function () {
    var group = new THREE.Group();
    group.name = 'weapon_' + modelDef.modelType;

    modelDef.parts.forEach(function (part) {
      var geom, mesh;
      var color = part.color || '#444444';
      var mat = new THREE.MeshLambertMaterial({ color: color });

      if (part.type === 'cylinder') {
        var radius = (part.size && part.size[0]) ? part.size[0] / 2 : 0.05;
        var height = (part.size && part.size[1]) ? part.size[1] : 0.1;
        geom = new THREE.CylinderGeometry(radius, radius, height, 16);
      } else {
        // box (default)
        var sx = (part.size && part.size[0]) ? part.size[0] : 0.1;
        var sy = (part.size && part.size[1]) ? part.size[1] : 0.1;
        var sz = (part.size && part.size[2]) ? part.size[2] : 0.1;
        geom = new THREE.BoxGeometry(sx, sy, sz);
      }

      mesh = new THREE.Mesh(geom, mat);

      if (part.position) {
        mesh.position.set(part.position[0] || 0, part.position[1] || 0, part.position[2] || 0);
      }
      if (part.rotation) {
        mesh.rotation.set(part.rotation[0] || 0, part.rotation[1] || 0, part.rotation[2] || 0);
      }

      group.add(mesh);
    });

    return group;
  };
}
window.registerCustomWeaponModel = registerCustomWeaponModel;

// ------- Map Editor Integration -------
(function () {
  var meOpenBtn = document.getElementById('meOpen');
  if (meOpenBtn) {
    meOpenBtn.addEventListener('click', function () {
      if (typeof startMapEditor === 'function') {
        // Hide all UI for full editor experience
        hideGameModeUI();
        resizeRenderer();
        startMapEditor();
        _mapEditorWasOpen = true;

        // Override editor exit to restore sidebar
        var origEditorExit = document.getElementById('editorExit');
        if (origEditorExit && !origEditorExit._devHooked) {
          origEditorExit._devHooked = true;
          origEditorExit.addEventListener('click', function () {
            var sidebar = document.getElementById('devSidebar');
            if (sidebar) {
              sidebar.classList.remove('hidden');
              var expandTab = document.getElementById('devSidebarExpand');
              if (expandTab) expandTab.classList.toggle('hidden', !sidebar.classList.contains('collapsed'));
            }
            _mapEditorWasOpen = false;
            setTimeout(resizeRenderer, 50);
          });
        }
      }
    });
  }
})();

// ------- Quick Test -------
(function () {
  var qtAI = document.getElementById('qtAIMatch');
  var qtTraining = document.getElementById('qtTraining');

  // --- Quick Test AI via iframe ---
  var _quickTestState = null;

  function ensureServerForQuickTest(cb) {
    if (!window.devAPI) { cb(); return; }
    var info = window.devAPI.serverStatus();
    if (info.status === 'running') { cb(); return; }
    window.devAPI.serverStart();
    var attempts = 0;
    var poll = setInterval(function () {
      attempts++;
      var s = window.devAPI.serverStatus();
      if (s.status === 'running') { clearInterval(poll); cb(); }
      else if (attempts > 20 || s.status === 'error') { clearInterval(poll); cb(); }
    }, 500);
  }

  function stopQuickTest() {
    if (!_quickTestState) return;
    // Remove iframe
    if (_quickTestState.iframe && _quickTestState.iframe.parentNode) {
      _quickTestState.iframe.parentNode.removeChild(_quickTestState.iframe);
    }
    // Remove overlay
    if (_quickTestState.overlay && _quickTestState.overlay.parentNode) {
      _quickTestState.overlay.parentNode.removeChild(_quickTestState.overlay);
    }
    _quickTestState = null;

    // Remove listeners
    document.removeEventListener('keydown', onQtKeyDown);
    document.removeEventListener('keyup', onQtKeyUp);

    // Exit pointer lock
    try { document.exitPointerLock(); } catch (e) {}

    // Restore Three.js canvas
    var gc = document.getElementById('gameContainer');
    var threeCanvas = gc && gc.querySelector('canvas');
    if (threeCanvas) threeCanvas.style.display = '';

    // Restore sidebar (preserve collapsed state)
    var devSidebar = document.getElementById('devSidebar');
    if (devSidebar) {
      devSidebar.classList.remove('hidden');
      var sidebarExpandTab = document.getElementById('devSidebarExpand');
      if (sidebarExpandTab) sidebarExpandTab.classList.toggle('hidden', !devSidebar.classList.contains('collapsed'));
    }
    // Restore right panel and toolbar if hero editor or menu builder was active
    if (_activePanel === 'heroEditor' || _activePanel === 'weaponModelBuilder' || _activePanel === 'menuBuilder') {
      var rightPanel = document.getElementById('devRightPanel');
      var rightExpandTab = document.getElementById('devRightPanelExpand');
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (_activePanel === 'heroEditor') {
        var heToolbar = document.getElementById('heViewportToolbar');
        if (heToolbar) heToolbar.classList.remove('hidden');
      }
      if (_activePanel === 'menuBuilder') {
        var mbToolbar = document.getElementById('mbViewportToolbar');
        var mbPreview = document.getElementById('mbPreviewContainer');
        if (mbToolbar) mbToolbar.classList.remove('hidden');
        if (mbPreview) mbPreview.classList.remove('hidden');
      }
    }
    if (typeof resizeRenderer === 'function') setTimeout(resizeRenderer, 50);
  }

  function forwardToQuickTest(msg) {
    if (!_quickTestState) return;
    var iframe = _quickTestState.iframe;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(msg, '*');
    }
  }

  function onQtKeyDown(e) {
    if (!_quickTestState) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      stopQuickTest();
      return;
    }
    forwardToQuickTest({ type: 'svKeyDown', code: e.code, key: e.key });
  }

  function onQtKeyUp(e) {
    if (!_quickTestState) return;
    forwardToQuickTest({ type: 'svKeyUp', code: e.code, key: e.key });
  }

  if (qtAI) {
    qtAI.addEventListener('click', function () {
      var heroId = document.getElementById('qtHero').value;
      var difficulty = document.getElementById('qtDifficulty').value;
      var mapName = document.getElementById('qtMapSelect').value;

      ensureServerForQuickTest(function () {
        // Hide all UI
        hideGameModeUI();

        // Hide Three.js canvas
        var gc = document.getElementById('gameContainer');
        var threeCanvas = gc && gc.querySelector('canvas');
        if (threeCanvas) threeCanvas.style.display = 'none';

        // Create iframe
        var url = 'http://localhost:3000/?autoAI=1' +
          '&hero=' + encodeURIComponent(heroId) +
          '&difficulty=' + encodeURIComponent(difficulty) +
          '&map=' + encodeURIComponent(mapName);
        var iframe = document.createElement('iframe');
        iframe.className = 'ss-iframe';
        iframe.style.width = '100%';
        iframe.style.left = '0';
        iframe.src = url;
        iframe.setAttribute('allow', 'autoplay');
        if (gc) gc.appendChild(iframe);

        _quickTestState = { iframe: iframe, overlay: null };

        // Create input overlay
        var overlay = document.createElement('div');
        overlay.id = 'ssInputOverlay';
        if (gc) gc.appendChild(overlay);
        _quickTestState.overlay = overlay;

        overlay.addEventListener('click', function () {
          overlay.requestPointerLock();
        });
        overlay.addEventListener('mousemove', function (e) {
          forwardToQuickTest({ type: 'svMouseMove', movementX: e.movementX || 0, movementY: e.movementY || 0 });
        });
        overlay.addEventListener('mousedown', function (e) {
          if (e.button === 0) forwardToQuickTest({ type: 'svMouseDown' });
        });
        overlay.addEventListener('mouseup', function (e) {
          if (e.button === 0) forwardToQuickTest({ type: 'svMouseUp' });
        });

        // Document-level keyboard handlers
        document.addEventListener('keydown', onQtKeyDown);
        document.addEventListener('keyup', onQtKeyUp);
      });
    });
  }

  if (qtTraining) {
    qtTraining.addEventListener('click', function () {
      var heroId = document.getElementById('qtHero').value;
      hideGameModeUI();
      resizeRenderer();

      if (typeof window.startTrainingRange === 'function') {
        window.startTrainingRange({ _heroId: heroId });
      }
    });
  }

  // When game modes end (ESC), restore sidebar
  // Override showOnlyMenu to detect when we return to mainMenu
  var origShowOnlyMenu = window.showOnlyMenu;
  window.showOnlyMenu = function (idOrNull) {
    // In the dev workbench, never show the mainMenu stub — always hide all menus
    // when returning to main menu, since the sidebar replaces it.
    var effectiveId = (idOrNull === 'mainMenu') ? null : idOrNull;
    if (typeof origShowOnlyMenu === 'function') {
      origShowOnlyMenu(effectiveId);
    }
    // If returning to main menu, restore dev sidebar and panel-specific UI
    if (idOrNull === 'mainMenu' || idOrNull === null) {
      var sidebar = document.getElementById('devSidebar');
      if (sidebar) {
        sidebar.classList.remove('hidden');
        // Preserve collapsed state — don't force uncollapse
        var expandTab = document.getElementById('devSidebarExpand');
        if (expandTab) expandTab.classList.toggle('hidden', !sidebar.classList.contains('collapsed'));
      }
      // Restore right panel and toolbar if hero editor, WMB, or menu builder is active
      if (_activePanel === 'heroEditor' || _activePanel === 'weaponModelBuilder' || _activePanel === 'menuBuilder') {
        var rightPanel = document.getElementById('devRightPanel');
        var rightExpandTab = document.getElementById('devRightPanelExpand');
        if (rightPanel) {
          rightPanel.classList.remove('hidden');
          if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
        }
        if (_activePanel === 'heroEditor') {
          var heToolbar = document.getElementById('heViewportToolbar');
          if (heToolbar) heToolbar.classList.remove('hidden');
        }
        if (_activePanel === 'menuBuilder') {
          var mbToolbar = document.getElementById('mbViewportToolbar');
          var mbPreview = document.getElementById('mbPreviewContainer');
          if (mbToolbar) mbToolbar.classList.remove('hidden');
          if (mbPreview) mbPreview.classList.remove('hidden');
        }
      }
      setTimeout(resizeRenderer, 50);
    }
  };
})();

// ------- Split-Screen Start/Stop Buttons -------
(function () {
  var startBtn = document.getElementById('ssStart');
  var stopBtn = document.getElementById('ssStop');

  if (startBtn) {
    startBtn.addEventListener('click', function () {
      var heroP1 = document.getElementById('ssHeroP1').value;
      var heroP2 = document.getElementById('ssHeroP2').value;
      var mapName = document.getElementById('ssMapSelect').value;

      if (typeof window.startSplitScreen === 'function') {
        window.startSplitScreen({
          heroP1: heroP1,
          heroP2: heroP2,
          mapName: mapName
        });
        startBtn.disabled = true;
        stopBtn.disabled = false;
        document.getElementById('ssStatus').textContent = 'Running. Tab to switch player.';
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      if (typeof window.stopSplitScreen === 'function') {
        window.stopSplitScreen();
      }
      startBtn.disabled = false;
      stopBtn.disabled = true;
      document.getElementById('ssStatus').textContent = 'Stopped.';
    });
  }
})();

// ------- Main Render Loop -------
function animate() {
  requestAnimationFrame(animate);

  // If split-screen is active, it handles its own rendering
  if (window._splitScreenActive) {
    // devSplitScreen.js handles renderer.setViewport + renderer.setScissor
    return;
  }

  // Default: single camera render
  renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
  renderer.setScissorTest(false);
  renderer.render(scene, camera);
}

// ------- Server Control -------
(function () {
  if (!window.devAPI || typeof window.devAPI.serverStart !== 'function') return;

  var btn = document.getElementById('devServerBtn');
  var dot = btn ? btn.querySelector('.server-dot') : null;
  var logPanel = document.getElementById('serverLogPanel');
  var logOutput = document.getElementById('serverLogOutput');
  var logCloseBtn = document.getElementById('serverLogClose');
  var _logCursorId = 0;
  var _pollTimer = null;

  function setDotState(state) {
    if (!dot) return;
    dot.className = 'server-dot ' + state;
  }

  function updateLogs() {
    var entries = window.devAPI.serverLogs(_logCursorId);
    if (!entries || !entries.length) return;
    entries.forEach(function (entry) {
      _logCursorId = entry.id;
      var line = document.createElement('div');
      line.textContent = entry.text;
      if (entry.text.indexOf('[ERR]') === 0) line.style.color = '#ff6666';
      logOutput.appendChild(line);
    });
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(function () {
      var info = window.devAPI.serverStatus();
      setDotState(info.status);
      if (info.status === 'error' && info.error) {
        btn.title = 'Error: ' + info.error;
      } else if (info.status === 'running') {
        btn.title = 'Server running — click to stop';
      } else if (info.status === 'stopped') {
        btn.title = 'Start LAN server';
        stopPolling();
      }
      updateLogs();
    }, 500);
  }

  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var info = window.devAPI.serverStatus();
      if (info.status === 'running' || info.status === 'starting') {
        window.devAPI.serverStop();
        setDotState('stopped');
        btn.title = 'Start LAN server';
      } else {
        // Clear previous log
        if (logOutput) logOutput.innerHTML = '';
        _logCursorId = 0;
        window.devAPI.serverStart();
        setDotState('starting');
        btn.title = 'Starting server...';
        // Show log panel
        if (logPanel) logPanel.classList.remove('hidden');
        startPolling();
      }
    });
  }

  if (logCloseBtn) {
    logCloseBtn.addEventListener('click', function () {
      if (logPanel) logPanel.classList.add('hidden');
    });
  }

  // Clean shutdown on window close/reload
  window.addEventListener('beforeunload', function () {
    var info = window.devAPI.serverStatus();
    if (info.status === 'running' || info.status === 'starting') {
      window.devAPI.serverStop();
    }
  });
})();

// ------- Boot -------
init();
