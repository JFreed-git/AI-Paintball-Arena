/**
 * game.js — Application bootstrap
 *
 * PURPOSE: Creates the Three.js scene, camera, and renderer as bare globals.
 * Calls setup functions for environment, crosshair, input controls, and menu UI.
 * Starts the main render loop. Also manages the first-person weapon viewmodel
 * (camera-attached weapon model visible to the local player).
 *
 * EXPORTS (globals):
 *   scene    — THREE.Scene
 *   camera   — THREE.PerspectiveCamera
 *   renderer — THREE.WebGLRenderer
 *   raycaster, mouse — utility objects
 *
 * EXPORTS (window):
 *   setFirstPersonWeapon(modelType) — attach a weapon viewmodel to the camera
 *   clearFirstPersonWeapon()        — remove the weapon viewmodel
 *
 * DEPENDENCIES: Three.js, environment.js, crosshair.js, input.js,
 *   menuNavigation.js, weaponModels.js (buildWeaponModel)
 *
 * DESIGN NOTES:
 *   - The camera position doubles as the local player's world position in
 *     single-player mode (no separate player entity for the local camera view).
 *   - The main animate() loop only calls renderer.render(). Game mode logic
 *     runs in separate RAF loops (modeAI.js, modeLAN.js, modeTraining.js).
 *   - The first-person viewmodel is a child of the camera, positioned in the
 *     lower-right of the view. Materials use depthTest:false so the weapon
 *     always renders on top of the scene.
 */

// Global scene/camera/renderer (shared across scripts)
let scene, camera, renderer;
let raycaster, mouse;

// ------- First-person weapon viewmodel -------
var _fpWeaponGroup = null;

/**
 * Attach a first-person weapon model to the camera (bottom-right of view).
 * Replaces any existing viewmodel. Pass null to just remove.
 */
window.setFirstPersonWeapon = function (modelType, fpOffset, fpRotation) {
  // Remove old viewmodel
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

  // Position in lower-right of camera view (customizable via fpOffset/fpRotation)
  var pos = fpOffset || { x: 0.28, y: -0.22, z: -0.45 };
  var rot = fpRotation || { x: 0.05, y: -0.15, z: 0 };
  _fpWeaponGroup.position.set(pos.x, pos.y, pos.z);
  _fpWeaponGroup.rotation.set(rot.x, rot.y, rot.z);

  // Render on top of everything (no depth fighting with scene)
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

// ------- First-person melee swing animation -------
var _fpSwingActive = false;

window.triggerFPMeleeSwing = function (durationMs) {
  if (!_fpWeaponGroup || _fpSwingActive) return;
  _fpSwingActive = true;

  var origPos = _fpWeaponGroup.position.clone();
  var origRot = { x: _fpWeaponGroup.rotation.x, y: _fpWeaponGroup.rotation.y, z: _fpWeaponGroup.rotation.z };

  // Keyframes: [progress, posOffset(x,y,z), rotOffset(x,y,z)]
  // Full gun-butt strike: cock back right → slam forward left → sweep across → recover
  var keys = [
    [0.00,  0, 0, 0,              0, 0, 0],           // Rest
    [0.15,  0.12, 0.08, 0.15,    -0.25, -0.3, -0.1],  // Wind-up: pull back+right, tilt up+right
    [0.25,  0.08, 0.12, 0.08,    -0.15, -0.15, -0.05], // Coil peak: weapon cocked high-right
    [0.45, -0.30, 0.06, -0.40,    0.3, 0.9, 0.35],    // Strike: slam forward+left, big yaw sweep
    [0.55, -0.40, -0.02, -0.35,   0.15, 1.2, 0.25],   // Impact: furthest left, slight dip
    [0.70, -0.25, 0.0, -0.18,     0.08, 0.8, 0.15],   // Follow-through: decelerate
    [0.85, -0.10, 0.02, -0.06,    0.03, 0.3, 0.05],   // Recovery: drifting back
    [1.00,  0, 0, 0,              0, 0, 0]             // Return to rest
  ];

  function hermite(t) { return t * t * (3 - 2 * t); }

  function sampleKeyframes(progress) {
    // Find surrounding keyframes
    var a = keys[0], b = keys[keys.length - 1];
    for (var i = 0; i < keys.length - 1; i++) {
      if (progress >= keys[i][0] && progress <= keys[i + 1][0]) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    var span = b[0] - a[0];
    var t = span > 0 ? hermite((progress - a[0]) / span) : 0;
    return {
      px: a[1] + (b[1] - a[1]) * t,
      py: a[2] + (b[2] - a[2]) * t,
      pz: a[3] + (b[3] - a[3]) * t,
      rx: a[4] + (b[4] - a[4]) * t,
      ry: a[5] + (b[5] - a[5]) * t,
      rz: a[6] + (b[6] - a[6]) * t
    };
  }

  var startTime = performance.now();
  function animateSwing() {
    if (!_fpWeaponGroup) { _fpSwingActive = false; return; }
    var elapsed = performance.now() - startTime;
    var progress = Math.min(1, elapsed / durationMs);
    var s = sampleKeyframes(progress);

    _fpWeaponGroup.position.set(origPos.x + s.px, origPos.y + s.py, origPos.z + s.pz);
    _fpWeaponGroup.rotation.set(origRot.x + s.rx, origRot.y + s.ry, origRot.z + s.rz);

    if (progress < 1) {
      requestAnimationFrame(animateSwing);
    } else {
      _fpWeaponGroup.position.copy(origPos);
      _fpWeaponGroup.rotation.set(origRot.x, origRot.y, origRot.z);
      _fpSwingActive = false;
    }
  }
  requestAnimationFrame(animateSwing);
};

// ------- Initialization -------
function init() {
  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 5);
  camera.rotation.order = 'YXZ';
  camera.up.set(0, 1, 0);
  resetCameraToDefaults();

  // Add camera to scene so its children (viewmodel) are rendered
  scene.add(camera);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('gameContainer').appendChild(renderer.domElement);

  // Environment (lights, fog, ground)
  setupEnvironment();

  // Crosshair (weapon models are created per-Player via weaponModels.js)
  ensureCrosshair();

  // Raycasting utilities for input
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Controls + Menu
  bindPlayerControls(renderer);

  // Start loop
  animate();

  // Ensure HUD hidden on load and main menu visible
  setHUDVisible(false);
  showOnlyMenu('mainMenu');

  // Load heroes from server (overrides built-in defaults with any edited versions)
  if (typeof loadHeroesFromServer === 'function') {
    loadHeroesFromServer();
  }

  // Load custom menu configs (overrides hardcoded HTML with saved configs)
  // loadCustomMenus() calls bindUI() after rendering, so we don't call it separately
  if (typeof loadCustomMenus === 'function') {
    loadCustomMenus();
  } else {
    bindUI();
  }

  // ── SplitView auto-start (iframe clients from dev workbench) ──
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('splitView') === '1') {
    window._splitViewMode = true;
    document.body.classList.add('split-view-mode');
    // Suppress alert() so join failures don't block retry loop
    window.alert = function () {};

    var autoHost = urlParams.get('autoHost');
    var autoJoin = urlParams.get('autoJoin');
    var mapName = urlParams.get('map') || '__default__';
    var rounds = parseInt(urlParams.get('rounds'), 10) || 2;
    var heroId = urlParams.get('hero') || '';

    if (autoHost) {
      setTimeout(function () {
        if (typeof io !== 'function' || typeof startFFAHost !== 'function') return;
        var sock = io();
        var settings = { killLimit: 10, maxPlayers: 8, mapName: mapName, rounds: rounds };
        sock.emit('createRoom', autoHost, settings, function (res) {
          if (!res || !res.ok) { console.warn('splitView: createRoom failed', res); return; }
          startFFAHost(autoHost, settings, sock);
          // Apply hero selection to host player
          if (heroId && typeof applyHeroToPlayer === 'function' && typeof getFFAState === 'function') {
            var st = getFFAState();
            if (st && st.localId && st.players[st.localId]) {
              applyHeroToPlayer(st.players[st.localId].entity, heroId);
              st.players[st.localId].heroId = heroId;
            }
          }
          // Auto-start round when first client joins
          sock.once('clientJoined', function () {
            setTimeout(function () {
              if (typeof startFFARound === 'function') startFFARound();
            }, 500);
          });
        });
      }, 500);
    } else if (autoJoin) {
      setTimeout(function () {
        if (typeof io !== 'function' || typeof joinFFAGame !== 'function') return;
        var sock = io();
        sock.emit('joinRoom', autoJoin, function (res) {
          if (!res || !res.ok) {
            // Retry — host room may not exist yet
            var retries = 0;
            var retryTimer = setInterval(function () {
              if (window.ffaActive) { clearInterval(retryTimer); return; }
              retries++;
              if (retries >= 10) { clearInterval(retryTimer); return; }
              sock.emit('joinRoom', autoJoin, function (r) {
                if (r && r.ok) {
                  clearInterval(retryTimer);
                  finishJoin(r);
                }
              });
            }, 1000);
            return;
          }
          finishJoin(res);
        });
        function finishJoin(res) {
          var clientSettings = res.settings || {};
          if (!clientSettings.mapName) clientSettings.mapName = mapName;
          joinFFAGame(autoJoin, sock, clientSettings);
          // Apply hero selection to client player
          if (heroId) {
            setTimeout(function () {
              if (typeof applyHeroToPlayer === 'function' && typeof getFFAState === 'function') {
                var st = getFFAState();
                if (st && st.localId && st.players[st.localId]) {
                  applyHeroToPlayer(st.players[st.localId].entity, heroId);
                  st.players[st.localId].heroId = heroId;
                }
              }
              // Tell host about hero choice (include clientId for server relay)
              sock.emit('heroSelect', { heroId: heroId, clientId: sock.id });
            }, 100);
          }
        }
      }, 2000);
    }
  }

  // ── AutoAI auto-start (iframe from dev workbench Quick Test) ──
  if (urlParams.get('autoAI') === '1') {
    window._splitViewMode = true;
    document.body.classList.add('split-view-mode');
    window.alert = function () {};

    setTimeout(function () {
      var heroId = urlParams.get('hero') || '';
      var difficulty = urlParams.get('difficulty') || 'medium';
      var mapName = urlParams.get('map') || '__default__';

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
    }, 500);
  }
}

// ------- Main loop -------
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// ------- Boot -------
init();
