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
      if (c.material) {
        if (Array.isArray(c.material)) {
          c.material.forEach(function (m) { m.dispose(); });
        } else {
          c.material.dispose();
        }
      }
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
      if (Array.isArray(c.material)) {
        c.material = c.material.map(function (m) {
          var cl = m.clone();
          cl.depthTest = false;
          cl.depthWrite = false;
          return cl;
        });
      } else {
        c.material = c.material.clone();
        c.material.depthTest = false;
        c.material.depthWrite = false;
      }
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
  if (panelId === 'splitScreen' || panelId === 'heroEditor') {
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
    launchGame: 'launchGamePanel'
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

    // Return hero gallery to its panel
    var heroGallery = document.getElementById('heroGalleryView');
    var heroPanel = document.getElementById('panelHeroEditor');
    if (heroGallery && heroPanel && heroGallery.classList.contains('viewport-mode')) {
      heroGallery.classList.remove('viewport-mode');
      heroPanel.insertBefore(heroGallery, heroPanel.firstChild);
    }

    // Return map gallery to its panel
    var mapGallery = document.getElementById('mapGalleryView');
    var mapPanel = document.getElementById('panelMapEditor');
    if (mapGallery && mapPanel && mapGallery.classList.contains('viewport-mode')) {
      mapGallery.classList.remove('viewport-mode');
      mapPanel.insertBefore(mapGallery, mapPanel.firstChild);
    }

    // Return hero preview container to its panel
    var heroContainer = document.getElementById('heroPreviewContainer');
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
    if (mbPreview) {
      mbPreview.classList.add('hidden');
      mbPreview.classList.remove('viewport-mode');
    }
    var mbToolbar = document.getElementById('mbViewportToolbar');
    if (mbToolbar) mbToolbar.classList.add('hidden');

    // Hide audio manager viewport
    var amViewport = document.getElementById('amViewportContainer');
    if (amViewport) {
      amViewport.classList.add('hidden');
      amViewport.classList.remove('viewport-mode');
    }

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
    // Clean up map editor when switching away
    if (_activePanel === 'mapEditor' && _mapEditorWasOpen) {
      _mapEditorWasOpen = false;
      if (typeof window.stopMapEditor === 'function') {
        window.stopMapEditor();
      }
      // Restore sidebar (same as editorExit handler)
      var sidebar = document.getElementById('devSidebar');
      if (sidebar) {
        sidebar.classList.remove('hidden');
        var expandTab = document.getElementById('devSidebarExpand');
        if (expandTab) expandTab.classList.toggle('hidden', !sidebar.classList.contains('collapsed'));
      }
    }

    // Clean up audio manager when switching away
    if (_activePanel === 'audioManager') {
      if (typeof window._closeAudioManager === 'function') {
        window._closeAudioManager();
      }
    }

    // Collapse previous expanded layout (always clean up galleries/viewports)
    collapseEditorLayout();

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

    // Expand layout for editor panels (but NOT heroEditor in gallery mode)
    if (panelId === 'weaponModelBuilder' || panelId === 'menuBuilder' || panelId === 'audioManager') {
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
      // Show gallery first (don't expand sidebar or show right panel/toolbar)
      if (rightPanel) rightPanel.classList.add('hidden');
      if (heToolbar) heToolbar.classList.add('hidden');
      if (mbToolbar) mbToolbar.classList.add('hidden');
      if (rightExpandTab) rightExpandTab.classList.add('hidden');
      if (typeof window._showHeroGallery === 'function') {
        window._showHeroGallery();
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

    if (panelId === 'splitScreen') {
      populateAllDropdowns();
    }

    // Show map gallery when switching to map editor panel
    if (panelId === 'mapEditor') {
      if (typeof window._showMapGallery === 'function') {
        window._showMapGallery();
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
  populateHeroDropdown('heHeroSelect');
  populateModelTypeDropdown('heModelType');
}

// ------- Hero & Weapon Model Loading -------

/**
 * Seed built-in heroes to filesystem if not already present, then load all
 * heroes from filesystem into window.HEROES.
 */
function loadAllHeroes() {
  // Try direct filesystem read first (Electron only — much more reliable)
  if (window.devAPI && typeof window.devAPI.listHeroes === 'function') {
    _loadHeroesDirect();
    return;
  }
  // Fallback: fetch-based loading (server mode)
  _loadHeroesFetch();
}

function _loadHeroesDirect() {
  var builtins = window.BUILTIN_HEROES || [];

  // Seed built-in heroes if not already on disk
  builtins.forEach(function (hero) {
    try {
      var res = window.devAPI.readHero(hero.id);
      if (res.status === 404) {
        window.devAPI.writeHero(hero.id, hero);
      }
    } catch (e) {
      console.error('[loadAllHeroes] seed error for', hero.id, e);
    }
  });

  // Read all heroes from filesystem
  try {
    var names = window.devAPI.listHeroes();
    var heroes = [];
    names.forEach(function (name) {
      try {
        var res = window.devAPI.readHero(name);
        if (res.data && res.data.id) {
          heroes.push(res.data);
        } else if (res.status === 200 && res.id) {
          heroes.push(res);
        }
      } catch (e) {
        console.error('[loadAllHeroes] failed to read hero:', name, e);
      }
    });
    if (heroes.length) {
      window.HEROES = heroes;
    }
  } catch (e) {
    console.error('[loadAllHeroes] failed to list/read heroes:', e);
  }
  populateAllDropdowns();
}

function _loadHeroesFetch() {
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
    }).catch(function (err) {
      console.error('[loadAllHeroes] seed error for', hero.id, err);
    });
  });

  // After seeding, load all heroes from filesystem
  Promise.all(seedPromises).then(function () {
    return fetch('/api/heroes').then(function (r) { return r.json(); });
  }).then(function (names) {
    if (!Array.isArray(names)) {
      console.error('[loadAllHeroes] /api/heroes returned non-array:', names);
      names = [];
    }
    var promises = names.map(function (name) {
      return fetch('/api/heroes/' + encodeURIComponent(name)).then(function (r) { return r.json(); });
    });
    return Promise.all(promises);
  }).then(function (heroes) {
    if (heroes && heroes.length) {
      var valid = heroes.filter(function (h) { return h && h.id; });
      if (valid.length) {
        window.HEROES = valid;
      }
    }
    populateAllDropdowns();
  }).catch(function (err) {
    console.error('[loadAllHeroes] failed to load heroes:', err);
    populateAllDropdowns();
  });
}

function loadCustomWeaponModels() {
  if (typeof window.loadCustomWeaponModelsFromServer === 'function') {
    window.loadCustomWeaponModelsFromServer().then(function () {
      populateModelTypeDropdown('heModelType');
      if (typeof window._refreshWmbLoadList === 'function') {
        window._refreshWmbLoadList();
      }
    });
  }
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

// Shared: hook the editor Exit button to restore sidebar + show gallery
function ensureMapEditorExitHook() {
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
      // Show map gallery if we're still on the map editor panel
      if (_activePanel === 'mapEditor' && typeof window._showMapGallery === 'function') {
        setTimeout(function () {
          window._showMapGallery();
          resizeRenderer();
        }, 50);
      } else {
        setTimeout(resizeRenderer, 50);
      }
    });
  }
}

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
        ensureMapEditorExitHook();
      }
    });
  }
})();

// ------- Map Gallery -------
(function () {
  function showMapGallery() {
    var galleryView = document.getElementById('mapGalleryView');
    if (!galleryView) return;
    galleryView.classList.remove('hidden');

    // Move gallery to viewport for full-size display
    var viewport = document.getElementById('devViewport');
    if (viewport) {
      viewport.appendChild(galleryView);
      galleryView.classList.add('viewport-mode');
    }

    populateMapGallery();
  }

  function populateMapGallery() {
    var grid = document.getElementById('mapGalleryGrid');
    if (!grid) return;
    grid.innerHTML = '<div class="gallery-empty">Loading maps...</div>';

    if (typeof fetchMapList !== 'function') {
      grid.innerHTML = '<div class="gallery-empty">Map API not available.</div>';
      return;
    }

    fetchMapList().then(function (names) {
      if (!names || names.length === 0) {
        grid.innerHTML = '<div class="gallery-empty">No maps yet. Click "Create New Map" to get started.</div>';
        return;
      }

      // Fetch metadata for each map
      var promises = names.map(function (name) {
        return fetchMapData(name).then(function (data) {
          return { name: name, data: data };
        }).catch(function () {
          return { name: name, data: null };
        });
      });

      Promise.all(promises).then(function (maps) {
        grid.innerHTML = '';
        maps.forEach(function (entry) {
          var card = createMapCard(entry.name, entry.data);
          grid.appendChild(card);
        });
      });
    }).catch(function () {
      grid.innerHTML = '<div class="gallery-empty">Failed to load maps.</div>';
    });
  }

  function createMapCard(mapName, mapData) {
    var card = document.createElement('div');
    card.className = 'gallery-card';
    card.setAttribute('data-map-name', mapName);

    // Thumbnail placeholder
    var thumb = document.createElement('div');
    thumb.className = 'gallery-card-thumb';
    thumb.textContent = '\u25A6'; // grid icon placeholder
    card.appendChild(thumb);

    var body = document.createElement('div');
    body.className = 'gallery-card-body';

    var nameEl = document.createElement('div');
    nameEl.className = 'gallery-card-name';
    nameEl.textContent = mapName;
    body.appendChild(nameEl);

    // Meta badges
    var meta = document.createElement('div');
    meta.className = 'gallery-card-meta';

    if (mapData) {
      // Count spawns
      var spawns = mapData.spawns || {};
      var ffaSpawns = Array.isArray(spawns) ? spawns : (spawns.ffa || []);
      var spawnCount = ffaSpawns.length;
      if (spawnCount > 0) {
        var spawnBadge = document.createElement('span');
        spawnBadge.className = 'gallery-badge';
        spawnBadge.textContent = spawnCount + ' spawns';
        meta.appendChild(spawnBadge);
      }

      // Arena size
      if (mapData.arena) {
        var sizeBadge = document.createElement('span');
        sizeBadge.className = 'gallery-badge';
        sizeBadge.textContent = (mapData.arena.width || 60) + 'x' + (mapData.arena.length || 90);
        meta.appendChild(sizeBadge);
      }

      // Object count
      var objCount = (mapData.objects || []).length;
      if (objCount > 0) {
        var objBadge = document.createElement('span');
        objBadge.className = 'gallery-badge';
        objBadge.textContent = objCount + ' objects';
        meta.appendChild(objBadge);
      }

      // Enabled modes
      if (mapData.modes) {
        if (mapData.modes.ffa) { var b = document.createElement('span'); b.className = 'gallery-badge'; b.textContent = 'FFA'; meta.appendChild(b); }
        if (mapData.modes.tdm) { var b2 = document.createElement('span'); b2.className = 'gallery-badge'; b2.textContent = 'TDM'; meta.appendChild(b2); }
        if (mapData.modes.ctf) { var b3 = document.createElement('span'); b3.className = 'gallery-badge'; b3.textContent = 'CTF'; meta.appendChild(b3); }
      }
    }

    body.appendChild(meta);
    card.appendChild(body);

    // Action buttons
    var actions = document.createElement('div');
    actions.className = 'gallery-card-actions';

    var renameBtn = document.createElement('button');
    renameBtn.className = 'gallery-action-btn';
    renameBtn.title = 'Rename';
    renameBtn.innerHTML = '&#9998;';
    renameBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      startMapInlineRename(card, mapName, mapData);
    });
    actions.appendChild(renameBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'gallery-action-btn gallery-delete-btn';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '&#10005;';
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteMapFromGallery(mapName);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);

    // Click card to open map editor with this map
    card.addEventListener('click', function () {
      openMapFromGallery(mapName);
    });

    return card;
  }

  function startMapInlineRename(card, oldName, mapData) {
    var nameEl = card.querySelector('.gallery-card-name');
    if (!nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'gallery-rename-input';
    input.value = oldName;
    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      var newName = input.value.trim();
      if (!newName || newName === oldName) {
        nameEl.textContent = oldName;
        return;
      }
      // Save under new name, then delete old name
      if (!mapData) {
        nameEl.textContent = oldName;
        return;
      }
      mapData.name = newName;
      saveMapToServer(newName, mapData).then(function () {
        return deleteMapFromServer(oldName);
      }).then(function () {
        nameEl.textContent = newName;
        card.setAttribute('data-map-name', newName);
        // Refresh gallery to get clean state
        populateMapGallery();
      }).catch(function () {
        nameEl.textContent = oldName;
        alert('Failed to rename map');
      });
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { input.blur(); }
      if (e.key === 'Escape') { nameEl.textContent = oldName; }
    });
    input.addEventListener('blur', commit);
  }

  function deleteMapFromGallery(mapName) {
    if (!confirm('Delete map "' + mapName + '"? This cannot be undone.')) return;

    if (typeof deleteMapFromServer !== 'function') {
      alert('Delete API not available');
      return;
    }

    deleteMapFromServer(mapName).then(function () {
      populateMapGallery();
    }).catch(function () {
      alert('Failed to delete map');
    });
  }

  function openMapFromGallery(mapName) {
    var galleryView = document.getElementById('mapGalleryView');
    var mapPanel = document.getElementById('panelMapEditor');

    // Move gallery back to panel
    if (galleryView && mapPanel) {
      mapPanel.insertBefore(galleryView, mapPanel.firstChild);
      galleryView.classList.remove('viewport-mode');
    }
    if (galleryView) galleryView.classList.add('hidden');

    // Launch map editor with the specified map
    if (typeof startMapEditor === 'function') {
      hideGameModeUI();
      resizeRenderer();
      startMapEditor(mapName);
      _mapEditorWasOpen = true;
      ensureMapEditorExitHook();
    }
  }

  // Create New Map button
  var mapNewBtn = document.getElementById('mapGalleryNew');
  if (mapNewBtn) {
    mapNewBtn.addEventListener('click', function () {
      var galleryView = document.getElementById('mapGalleryView');
      var mapPanel = document.getElementById('panelMapEditor');

      // Move gallery back to panel
      if (galleryView && mapPanel) {
        mapPanel.insertBefore(galleryView, mapPanel.firstChild);
        galleryView.classList.remove('viewport-mode');
      }
      if (galleryView) galleryView.classList.add('hidden');

      // Launch map editor with blank map (no mapName)
      var meOpenBtn = document.getElementById('meOpen');
      if (meOpenBtn) {
        meOpenBtn.click();
      }
    });
  }

  // Expose gallery functions
  window._showMapGallery = showMapGallery;
  window._populateMapGallery = populateMapGallery;
})();

// ------- Launch Game -------
(function () {
  var _lgLoadingDoc = '<html><body style="background:#111;color:#aaa;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;font-size:18px">Starting server\u2026</body></html>';

  function launchGame() {
    var lgIframe = document.getElementById('lgIframe');

    // Set iframe to loading state BEFORE showing the panel (prevents black flash)
    if (lgIframe) lgIframe.srcdoc = _lgLoadingDoc;

    // Hide sidebar and all panels
    var sidebar = document.getElementById('devSidebar');
    var expandTab = document.getElementById('devSidebarExpand');
    if (sidebar) sidebar.classList.add('hidden');
    if (expandTab) expandTab.classList.add('hidden');

    var rightPanel = document.getElementById('devRightPanel');
    var rightExpandTab = document.getElementById('devRightPanelExpand');
    if (rightPanel) rightPanel.classList.add('hidden');
    if (rightExpandTab) rightExpandTab.classList.add('hidden');

    // Hide all dev panels
    var panels = document.querySelectorAll('.dev-panel');
    panels.forEach(function (p) { p.style.display = 'none'; });

    // Hide Three.js canvas
    var gc = document.getElementById('gameContainer');
    var threeCanvas = gc && gc.querySelector('canvas');
    if (threeCanvas) threeCanvas.style.display = 'none';

    // Show the Launch Game panel full-screen
    var lgPanel = document.getElementById('launchGamePanel');
    if (lgPanel) lgPanel.style.display = 'flex';

    // Add viewport mode class for full-screen styling
    document.body.classList.add('viewport-mode');

    // Check if server is reachable by fetching it directly (works for externally started servers too)
    function checkServerReady(cb) {
      fetch('http://localhost:3000', { method: 'HEAD', mode: 'no-cors' })
        .then(function () { cb(true); })
        .catch(function () { cb(false); });
    }

    function loadIframe() {
      if (lgIframe) {
        lgIframe.removeAttribute('srcdoc'); // Clear srcdoc so src takes effect
        lgIframe.src = 'http://localhost:3000';
      }
    }

    // Try server first — if already running, load immediately
    checkServerReady(function (ready) {
      if (ready) { loadIframe(); return; }

      // Server not reachable — start it via devAPI if available
      if (window.devAPI) window.devAPI.serverStart();

      // Poll until server responds
      var attempts = 0;
      var poll = setInterval(function () {
        attempts++;
        checkServerReady(function (ok) {
          if (ok) {
            clearInterval(poll);
            loadIframe();
          } else if (attempts > 20) {
            clearInterval(poll);
            if (lgIframe) lgIframe.srcdoc = '<html><body style="background:#111;color:#f66;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif;font-size:18px">Server failed to start. Start it manually: node server.js</body></html>';
          }
        });
      }, 500);
    });
  }

  function closeLaunchGame() {
    // Hide Launch Game panel and reset iframe
    var lgPanel = document.getElementById('launchGamePanel');
    var lgIframe = document.getElementById('lgIframe');
    if (lgPanel) lgPanel.style.display = 'none';
    if (lgIframe) lgIframe.src = 'about:blank';

    // Remove viewport mode
    document.body.classList.remove('viewport-mode');

    // Restore Three.js canvas
    var gc = document.getElementById('gameContainer');
    var threeCanvas = gc && gc.querySelector('canvas');
    if (threeCanvas) threeCanvas.style.display = '';

    // Clear inline display overrides that launchGame() set on all dev panels.
    // The CSS .active class controls panel visibility — inline style.display
    // overrides it, so we must remove the inline style for panels to show again.
    var panels = document.querySelectorAll('.dev-panel');
    panels.forEach(function (p) {
      if (p !== lgPanel) p.style.display = '';
    });

    // Restore sidebar (preserve collapsed state)
    var sidebar = document.getElementById('devSidebar');
    if (sidebar) {
      sidebar.classList.remove('hidden');
      var expandTab = document.getElementById('devSidebarExpand');
      if (expandTab) expandTab.classList.toggle('hidden', !sidebar.classList.contains('collapsed'));
    }

    // Restore right panel if editor panel is active (not gallery mode)
    var heroInGallery = _activePanel === 'heroEditor' && document.getElementById('heroEditorView') && document.getElementById('heroEditorView').classList.contains('hidden');
    if ((_activePanel === 'heroEditor' && !heroInGallery) || _activePanel === 'weaponModelBuilder' || _activePanel === 'menuBuilder') {
      var rightPanel = document.getElementById('devRightPanel');
      var rightExpandTab = document.getElementById('devRightPanelExpand');
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
    }

    if (typeof resizeRenderer === 'function') setTimeout(resizeRenderer, 50);
  }

  // Wire nav button
  var lgNavBtn = document.querySelector('[data-panel="launchGame"]');
  if (lgNavBtn) {
    lgNavBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      launchGame();
    });
  }

  // Wire close button
  var lgCloseBtn = document.getElementById('lgCloseBtn');
  if (lgCloseBtn) {
    lgCloseBtn.addEventListener('click', function () {
      closeLaunchGame();
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
      // Restore right panel and toolbar if hero editor (not gallery), WMB, or menu builder is active
      var heroEditorInGallery = _activePanel === 'heroEditor' && document.getElementById('heroEditorView') && document.getElementById('heroEditorView').classList.contains('hidden');
      if ((_activePanel === 'heroEditor' && !heroEditorInGallery) || _activePanel === 'weaponModelBuilder' || _activePanel === 'menuBuilder') {
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
      if (typeof window.startSplitScreen === 'function') {
        window.startSplitScreen();
        startBtn.disabled = true;
        stopBtn.disabled = false;
        document.getElementById('ssStatus').textContent = 'Running. Click bar to lock cursor, Tab to switch.';
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
