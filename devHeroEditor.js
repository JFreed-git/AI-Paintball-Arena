/**
 * devHeroEditor.js — Hero/weapon stat editor + weapon model builder
 *
 * PURPOSE: Provides UI logic for:
 *   1. Hero Editor: edit hero stats, weapon config, visual settings, with live 3D preview
 *   2. Weapon Model Builder: compose weapon models from box/cylinder parts, live 3D preview,
 *      register into WEAPON_MODEL_REGISTRY
 *
 * EXPORTS (window):
 *   _initHeroEditorPreview() — initialize the hero editor 3D preview
 *   _initWmbPreview()        — initialize the weapon model builder 3D preview
 *   _refreshWmbLoadList()    — refresh weapon model load dropdown
 *
 * DEPENDENCIES: Three.js, weapon.js, weaponModels.js, heroes.js, player.js, devApp.js
 */

(function () {

  // Stash crosshair spread values that have no form fields, so they round-trip on save
  var _stashedCrosshair = { baseSpreadPx: 8, sprintSpreadPx: 20 };

  // ========================
  // HERO EDITOR
  // ========================

  var _heroPreviewRenderer = null;
  var _heroPreviewScene = null;
  var _heroPreviewCamera = null;
  var _heroPreviewPlayer = null;
  var _heroPreviewAngle = 0;
  var _heroPreviewAnimId = 0;

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

    _heroPreviewCamera = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 100);
    _heroPreviewCamera.position.set(0, 2, 5);
    _heroPreviewCamera.lookAt(0, 1.5, 0);

    _heroPreviewRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    _heroPreviewRenderer.setSize(canvas.width, canvas.height);

    // Build initial preview player
    updateHeroPreview();

    // Animate turntable
    function animatePreview() {
      _heroPreviewAnimId = requestAnimationFrame(animatePreview);
      _heroPreviewAngle += 0.01;
      if (_heroPreviewPlayer && _heroPreviewPlayer._meshGroup) {
        _heroPreviewPlayer._meshGroup.rotation.y = _heroPreviewAngle;
      }
      _heroPreviewRenderer.render(_heroPreviewScene, _heroPreviewCamera);
    }
    animatePreview();

    // Wire form inputs to live preview updates
    wireHeroEditorInputs();
  };

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

      hitbox: {
        width: parseFloat(document.getElementById('heHitW').value) || 0.8,
        height: parseFloat(document.getElementById('heHitH').value) || 3.2,
        depth: parseFloat(document.getElementById('heHitD').value) || 0.8
      },

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
        projectileSpeed: null,
        projectileGravity: 0,
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

    var hb = hero.hitbox || {};
    document.getElementById('heHitW').value = hb.width || 0.8;
    document.getElementById('heHitH').value = hb.height || 3.2;
    document.getElementById('heHitD').value = hb.depth || 0.8;

    var w = hero.weapon || {};
    document.getElementById('heCooldownMs').value = w.cooldownMs || 166;
    document.getElementById('heMagSize').value = w.magSize || 6;
    document.getElementById('heReloadTime').value = w.reloadTimeSec || 2.5;
    document.getElementById('heDamage').value = w.damage || 20;
    document.getElementById('heSpreadRad').value = (typeof w.spreadRad === 'number') ? w.spreadRad : 0;
    document.getElementById('heSprintSpreadRad').value = (typeof w.sprintSpreadRad === 'number') ? w.sprintSpreadRad : 0.012;
    document.getElementById('heMaxRange').value = w.maxRange || 200;
    document.getElementById('hePellets').value = w.pellets || 1;

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
  }

  function wireHeroEditorInputs() {
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
