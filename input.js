/**
 * input.js — Keyboard/mouse input handling and pointer lock management
 *
 * PURPOSE: Captures WASD movement, mouse look, sprint, reload, jump, and fire
 *          inputs. Manages pointer lock lifecycle and camera defaults/reset.
 *          Uses a data-driven keymap for remappable keybindings.
 * EXPORTS (window): getInputState, resetCameraToDefaults, getKeymap, setKeyBinding,
 *                   resetKeymap, loadKeymapForHero, saveKeymapForHero, getDefaultKeymap
 * EXPORTS (bare global): bindPlayerControls, DEFAULT_CAMERA_POS
 * DEPENDENCIES: THREE (r128), camera/renderer globals (game.js),
 *               mouseSensitivity (menuNavigation.js), showOnlyMenu/setHUDVisible (menuNavigation.js)
 */

// Camera defaults and reset live with player controls
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, (typeof GROUND_Y !== 'undefined' ? GROUND_Y : -1) + (typeof EYE_HEIGHT !== 'undefined' ? EYE_HEIGHT : 2.0), 5);
const DEFAULT_CAMERA_YAW = 0;   // facing -Z
const DEFAULT_CAMERA_PITCH = 0; // level
function resetCameraToDefaults() {
  if (typeof camera === 'undefined' || !camera) return;
  camera.position.copy(DEFAULT_CAMERA_POS);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = DEFAULT_CAMERA_PITCH;
  camera.rotation.y = DEFAULT_CAMERA_YAW;
  camera.rotation.z = 0;
  camera.up.set(0, 1, 0);
}

/* ── Data-driven keymap ── */
var _defaultKeymap = {
  // Movement (axis values)
  'KeyW':       { action: 'moveZ',    value: 1 },
  'KeyS':       { action: 'moveZ',    value: -1 },
  'KeyA':       { action: 'moveX',    value: -1 },
  'KeyD':       { action: 'moveX',    value: 1 },
  // Toggles (true while held)
  'ShiftLeft':  { action: 'sprint',   type: 'toggle' },
  'ShiftRight': { action: 'sprint',   type: 'toggle' },
  // One-shots (true once, cleared after read)
  'Space':      { action: 'jump',     type: 'oneShot' },
  'KeyR':       { action: 'reloadPressed', type: 'oneShot' },
  'KeyV':       { action: 'meleePressed',  type: 'oneShot' },
  // Abilities (true while held)
  'KeyQ':       { action: 'ability1', type: 'toggle' },
  'KeyE':       { action: 'ability2', type: 'toggle' },
  'KeyF':       { action: 'ability3', type: 'toggle' },
  'KeyC':       { action: 'ability4', type: 'toggle' }
};
var _keymap = JSON.parse(JSON.stringify(_defaultKeymap));

// Track which axis keys are currently held, for correct release behavior
// e.g. if W and S are both held, moveZ should be 0; releasing W should set moveZ = -1
var _heldAxisKeys = {}; // { 'KeyW': true, 'KeyS': true, ... }

/* Paintball input state (inputs live here; physics elsewhere) */
const INPUT_STATE = { fireDown: false, secondaryDown: false, sprint: false, reloadPressed: false, jump: false, meleePressed: false, ability1: false, ability2: false, ability3: false, ability4: false, moveX: 0, moveZ: 0 };

// Recompute an axis value from all currently held keys for that axis
function recomputeAxis(axisAction) {
  var sum = 0;
  for (var code in _heldAxisKeys) {
    if (!_heldAxisKeys[code]) continue;
    var binding = _keymap[code];
    if (binding && binding.action === axisAction && binding.value !== undefined) {
      sum += binding.value;
    }
  }
  // Clamp to -1..1
  INPUT_STATE[axisAction] = Math.max(-1, Math.min(1, sum));
}

// Mouse button state for paintball
function onMouseDownGeneric(e) { if (e.button === 2) { INPUT_STATE.secondaryDown = true; } else { INPUT_STATE.fireDown = true; } }
function onMouseUpGeneric(e) { if (e.button === 2) { INPUT_STATE.secondaryDown = false; } else { INPUT_STATE.fireDown = false; } }

// One-shot accessor for reload
function getInputState() {
  const out = { ...INPUT_STATE };
  if (INPUT_STATE.reloadPressed) {
    out.reloadPressed = true;
    INPUT_STATE.reloadPressed = false;
  }
  if (INPUT_STATE.jump) {
    out.jump = true;
    INPUT_STATE.jump = false;
  }
  if (INPUT_STATE.meleePressed) {
    out.meleePressed = true;
    INPUT_STATE.meleePressed = false;
  }
  return out;
}
// Expose to paintball mode
window.getInputState = getInputState;

function bindPlayerControls(renderer) {
  // Window and renderer-level listeners
  window.addEventListener('resize', onWindowResize);
  if (renderer && renderer.domElement) {
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    // Additional input hooks for Paintball mode
    renderer.domElement.addEventListener('mousedown', onMouseDownGeneric);
    renderer.domElement.addEventListener('mouseup', onMouseUpGeneric);
    renderer.domElement.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Click canvas to acquire pointer lock when a game mode is active
    renderer.domElement.addEventListener('click', function () {
      if (window._splitViewMode) return; // parent overlay handles lock
      var anyActive = window.trainingRangeActive || window.ffaActive || window._splitScreenActive;
      if (!anyActive) return;
      if (window._heroSelectOpen || window.devConsoleOpen) return;
      if (document.pointerLockElement === renderer.domElement) return; // already locked
      renderer.domElement.requestPointerLock();
    });
  }

  // Global listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('keydown', onGlobalKeyDown);
  document.addEventListener('keyup', onGlobalKeyUp);
}

function onMouseMove(event) {
  if (window._splitScreenActive) return; // iframes handle their own mouse via postMessage
  if (!window.trainingRangeActive && !window.ffaActive) return;
  if (window._heroSelectOpen) return;

  // Raycasting mouse coords (kept for completeness)
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  // Camera rotation based on mouse movement and sensitivity
  const movementX = event.movementX || 0;
  const movementY = event.movementY || 0;

  const base = 0.002;
  const factor = base * mouseSensitivity;

  camera.rotation.y -= movementX * factor;
  camera.rotation.x -= movementY * factor;

  // Limit vertical rotation and prevent roll
  const maxPitch = Math.PI / 2 - 0.004; // allow ~±89.6°
  camera.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, camera.rotation.x));
  camera.rotation.z = 0;
}


function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerLockChange() {
  if (window._splitViewMode) return; // iframe: parent overlay manages lock
  if (window._splitScreenActive) return; // parent: devSplitScreen manages its own lifecycle
  const canvas = renderer && renderer.domElement;
  const locked = document.pointerLockElement === canvas;

  if (!locked) {
    // Don't treat as ESC during hero selection or between-round transitions
    if (window._heroSelectOpen) return;
    if (window._roundTransition) return;

    // Heuristic:
    // - If the document is focused and visible, treat pointer unlock as explicit ESC.
    // - If focus/visibility was lost (Alt-Tab), do nothing; clicking will re-lock.
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const visible = typeof document.visibilityState === 'string' ? (document.visibilityState === 'visible') : true;

    if (focused && visible && !window.devConsoleOpen) {
      if (window._splitScreenActive) {
        try { if (typeof stopSplitScreen === 'function') stopSplitScreen(); } catch {}
      } else if (window.ffaActive) {
        try { if (typeof stopFFAInternal === 'function') stopFFAInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
      } else if (window.trainingRangeActive) {
        try { if (typeof stopTrainingRangeInternal === 'function') stopTrainingRangeInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
      }
    }
  }
}

/**
 * Apply a keydown event code via the keymap.
 * Shared by onGlobalKeyDown and svKeyDown.
 */
function applyKeyDown(code) {
  var binding = _keymap[code];
  if (!binding) return false;

  if (binding.value !== undefined) {
    // Axis input — track held state and recompute
    _heldAxisKeys[code] = true;
    recomputeAxis(binding.action);
  } else {
    INPUT_STATE[binding.action] = true;
  }
  return true;
}

/**
 * Apply a keyup event code via the keymap.
 * Shared by onGlobalKeyUp and svKeyUp.
 */
function applyKeyUp(code) {
  var binding = _keymap[code];
  if (!binding) return false;

  if (binding.value !== undefined) {
    // Axis release — remove from held set and recompute
    delete _heldAxisKeys[code];
    recomputeAxis(binding.action);
  } else if (binding.type !== 'oneShot') {
    INPUT_STATE[binding.action] = false;
  }
  return true;
}

function onGlobalKeyDown(e) {
  if (window.editorActive) return;
  if (window._splitViewMode) {
    // Forward ESC to parent so it can stop split screen when cursor not locked
    if (e.key === 'Escape') {
      window.parent.postMessage({ type: 'svEscape' }, '*');
    }
    return; // iframe: parent forwards all other input via postMessage
  }
  if (window._splitScreenActive) return; // parent: devSplitScreen.js handles all input

  // Non-remappable: ESC
  if (e.key === 'Escape') {
    if (typeof window.toggleSettingsOverlay === 'function') {
      window.toggleSettingsOverlay();
    } else {
      if (window._splitScreenActive) {
        try { if (typeof stopSplitScreen === 'function') stopSplitScreen(); } catch {}
      } else if (window.ffaActive) {
        try { if (typeof stopFFAInternal === 'function') stopFFAInternal(); } catch {}
      } else if (window.trainingRangeActive) {
        try { if (typeof stopTrainingRangeInternal === 'function') stopTrainingRangeInternal(); } catch {}
      }
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }
    return;
  }

  // Non-remappable: Tab (scoreboard)
  if (e.code === 'Tab') {
    e.preventDefault();
    var hasRoom = window._lobbyState && window._lobbyState.roomId;
    if (window.ffaActive || hasRoom) {
      var sb = document.getElementById('scoreboardOverlay');
      if (sb) sb.classList.remove('hidden');
      if (typeof window.updateFFAScoreboard === 'function') window.updateFFAScoreboard();
    }
    return;
  }

  // Keymap-driven input
  applyKeyDown(e.code);
}

function onGlobalKeyUp(e) {
  if (window.editorActive) return;
  if (window._splitViewMode) return;
  if (window._splitScreenActive) return;

  // Non-remappable: Tab release
  if (e.code === 'Tab') {
    var sb = document.getElementById('scoreboardOverlay');
    if (sb) sb.classList.add('hidden');
    return;
  }

  // Keymap-driven input
  applyKeyUp(e.code);
}

/* ── SplitView input forwarding (postMessage from parent overlay) ── */
window.addEventListener('message', function (evt) {
  if (!window._splitViewMode) return;
  var d = evt.data;
  if (!d || !d.type) return;

  switch (d.type) {
    case 'svMouseMove': {
      var base = 0.002;
      var factor = base * mouseSensitivity;
      camera.rotation.y -= d.movementX * factor;
      camera.rotation.x -= d.movementY * factor;
      var maxPitch = Math.PI / 2 - 0.004;
      camera.rotation.x = Math.max(-maxPitch, Math.min(maxPitch, camera.rotation.x));
      camera.rotation.z = 0;
      break;
    }
    case 'svMouseDown':
      if (d.button === 2) { INPUT_STATE.secondaryDown = true; } else { INPUT_STATE.fireDown = true; }
      break;
    case 'svMouseUp':
      if (d.button === 2) { INPUT_STATE.secondaryDown = false; } else { INPUT_STATE.fireDown = false; }
      break;
    case 'svKeyDown':
      // Non-remappable: Tab
      if (d.code === 'Tab') {
        var hasRoom = window._lobbyState && window._lobbyState.roomId;
        if (window.ffaActive || hasRoom) {
          var sb = document.getElementById('scoreboardOverlay');
          if (sb) sb.classList.remove('hidden');
          if (typeof window.updateFFAScoreboard === 'function') window.updateFFAScoreboard();
        }
        break;
      }
      applyKeyDown(d.code);
      break;
    case 'svKeyUp':
      // Non-remappable: Tab
      if (d.code === 'Tab') {
        var sb = document.getElementById('scoreboardOverlay');
        if (sb) sb.classList.add('hidden');
        break;
      }
      applyKeyUp(d.code);
      break;
    case 'svResetKeys':
      _heldAxisKeys = {};
      INPUT_STATE.sprint = false;
      INPUT_STATE.fireDown = false;
      INPUT_STATE.secondaryDown = false;
      INPUT_STATE.ability1 = false;
      INPUT_STATE.ability2 = false;
      INPUT_STATE.ability3 = false;
      INPUT_STATE.ability4 = false;
      INPUT_STATE.moveX = 0;
      INPUT_STATE.moveZ = 0;
      break;
  }
});

/* ── Keymap API ── */
window.getKeymap = function () { return _keymap; };

window.setKeyBinding = function (keyCode, action, opts) {
  opts = opts || {};
  // Remove old binding(s) for this action (find and delete)
  for (var code in _keymap) {
    if (_keymap[code].action === action) {
      delete _keymap[code];
    }
  }
  // Set new binding
  var binding = { action: action };
  if (opts.type) binding.type = opts.type;
  if (opts.value !== undefined) binding.value = opts.value;
  _keymap[keyCode] = binding;
};

window.resetKeymap = function () {
  _keymap = JSON.parse(JSON.stringify(_defaultKeymap));
};

window.loadKeymapForHero = function (heroId) {
  var saved = localStorage.getItem('keymap_' + heroId);
  if (saved) {
    try { _keymap = JSON.parse(saved); } catch (e) { window.resetKeymap(); }
  } else {
    window.resetKeymap();
  }
};

window.saveKeymapForHero = function (heroId) {
  localStorage.setItem('keymap_' + heroId, JSON.stringify(_keymap));
};

window.getDefaultKeymap = function () {
  return JSON.parse(JSON.stringify(_defaultKeymap));
};
