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

window.setFirstPersonWeapon = function (modelType) {
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

  _fpWeaponGroup.position.set(0.28, -0.22, -0.45);
  _fpWeaponGroup.rotation.set(0.05, -0.15, 0);

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

window.addEventListener('resize', function () {
  resizeRenderer();
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
    mapEditor: 'panelMapEditor',
    quickTest: 'panelQuickTest'
  };
  return map[panelId] || '';
}

// Override switchPanel to use proper mapping
(function () {
  var origSwitch = switchPanel;
  switchPanel = function (panelId) {
    if (_activePanel === 'mapEditor' && _mapEditorWasOpen) {
      _mapEditorWasOpen = false;
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

    if (panelId === 'splitScreen' || panelId === 'quickTest' || panelId === 'heroEditor') {
      populateAllDropdowns();
    }
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
        // Hide sidebar for full editor experience
        var sidebar = document.getElementById('devSidebar');
        if (sidebar) sidebar.classList.add('hidden');
        resizeRenderer();
        startMapEditor();
        _mapEditorWasOpen = true;

        // Override editor exit to restore sidebar
        var origEditorExit = document.getElementById('editorExit');
        if (origEditorExit && !origEditorExit._devHooked) {
          origEditorExit._devHooked = true;
          origEditorExit.addEventListener('click', function () {
            var sidebar = document.getElementById('devSidebar');
            if (sidebar) sidebar.classList.remove('hidden');
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

  if (qtAI) {
    qtAI.addEventListener('click', function () {
      var heroId = document.getElementById('qtHero').value;
      var difficulty = document.getElementById('qtDifficulty').value;
      var mapName = document.getElementById('qtMapSelect').value;

      // Hide sidebar for full-screen gameplay
      var sidebar = document.getElementById('devSidebar');
      if (sidebar) sidebar.classList.add('hidden');
      resizeRenderer();

      // Set the paintball menu selectors to match our choices
      var diffSel = document.getElementById('paintballDifficulty');
      if (diffSel) diffSel.value = difficulty;

      var launchGame = function (mapData) {
        if (typeof startPaintballGame === 'function') {
          startPaintballGame({ difficulty: difficulty, _mapData: mapData || null, _heroId: heroId });
        }
      };

      if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
        fetchMapData(mapName).then(launchGame).catch(function () { launchGame(null); });
      } else {
        launchGame(null);
      }
    });
  }

  if (qtTraining) {
    qtTraining.addEventListener('click', function () {
      var heroId = document.getElementById('qtHero').value;
      var sidebar = document.getElementById('devSidebar');
      if (sidebar) sidebar.classList.add('hidden');
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
    // Call original
    if (typeof origShowOnlyMenu === 'function') {
      origShowOnlyMenu(idOrNull);
    }
    // If returning to main menu, restore dev sidebar
    if (idOrNull === 'mainMenu' || idOrNull === null) {
      var sidebar = document.getElementById('devSidebar');
      if (sidebar) sidebar.classList.remove('hidden');
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

// ------- Boot -------
init();
