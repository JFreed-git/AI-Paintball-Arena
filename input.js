/**
 * input.js — Keyboard/mouse input handling and pointer lock management
 *
 * PURPOSE: Captures WASD movement, mouse look, sprint, reload, jump, and fire
 *          inputs. Manages pointer lock lifecycle and camera defaults/reset.
 * EXPORTS (window): getInputState, resetCameraToDefaults
 * EXPORTS (bare global): bindPlayerControls, DEFAULT_CAMERA_POS
 * DEPENDENCIES: THREE (r128), camera/renderer globals (game.js),
 *               mouseSensitivity (menuNavigation.js), showOnlyMenu/setHUDVisible (menuNavigation.js)
 * TODO (future): Ability keybind support, ADS (right-click) input
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

/* Paintball input state (inputs live here; physics elsewhere) */
const INPUT_STATE = { fireDown: false, sprint: false, reloadPressed: false, jump: false, meleePressed: false, moveX: 0, moveZ: 0 };
let _w = false, _a = false, _s = false, _d = false;
function recomputeMoveAxes() {
  INPUT_STATE.moveZ = (_w ? 1 : 0) + (_s ? -1 : 0);
  INPUT_STATE.moveX = (_d ? 1 : 0) + (_a ? -1 : 0);
}
// Mouse button state for paintball
function onMouseDownGeneric() { INPUT_STATE.fireDown = true; }
function onMouseUpGeneric() { INPUT_STATE.fireDown = false; }
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
    // Click canvas to acquire pointer lock when a game mode is active
    renderer.domElement.addEventListener('click', function () {
      if (window._splitViewMode) return; // parent overlay handles lock
      var anyActive = window.paintballActive || window.multiplayerActive || window.trainingRangeActive || window.ffaActive || window._splitScreenActive;
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
  if (!window.paintballActive && !window.multiplayerActive && !window.trainingRangeActive && !window.ffaActive) return;
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
      } else if (window.paintballActive) {
        try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
      } else if (window.multiplayerActive) {
        try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
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

function onGlobalKeyDown(e) {
  if (window.editorActive) return;
  if (window._splitViewMode) return; // iframe: parent forwards input via postMessage
  if (window._splitScreenActive) return; // parent: devSplitScreen.js handles all input
  if (e.key === 'Escape') {
    if (window._splitScreenActive) {
      try { if (typeof stopSplitScreen === 'function') stopSplitScreen(); } catch {}
    } else if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    } else if (window.multiplayerActive) {
      try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
    } else if (window.ffaActive) {
      try { if (typeof stopFFAInternal === 'function') stopFFAInternal(); } catch {}
    } else if (window.trainingRangeActive) {
      try { if (typeof stopTrainingRangeInternal === 'function') stopTrainingRangeInternal(); } catch {}
    }
    showOnlyMenu('mainMenu');
    setHUDVisible(false);
    return;
  }

  // Tab key: show FFA scoreboard while held
  if (e.code === 'Tab') {
    e.preventDefault();
    if (window.ffaActive) {
      var sb = document.getElementById('scoreboardOverlay');
      if (sb) sb.classList.remove('hidden');
      if (typeof window.updateFFAScoreboard === 'function') window.updateFFAScoreboard();
    }
    return;
  }

  // Paintball input tracking (WASD + Sprint + Reload)
  switch (e.code) {
    case 'KeyW': _w = true; recomputeMoveAxes(); break;
    case 'KeyA': _a = true; recomputeMoveAxes(); break;
    case 'KeyS': _s = true; recomputeMoveAxes(); break;
    case 'KeyD': _d = true; recomputeMoveAxes(); break;
    case 'ShiftLeft': INPUT_STATE.sprint = true; break;
    case 'KeyR': INPUT_STATE.reloadPressed = true; break;
    case 'Space': INPUT_STATE.jump = true; break;
    case 'KeyV': INPUT_STATE.meleePressed = true; break;
  }
}

function onGlobalKeyUp(e) {
  if (window.editorActive) return;
  if (window._splitViewMode) return;
  if (window._splitScreenActive) return;

  // Tab release: hide FFA scoreboard
  if (e.code === 'Tab') {
    var sb = document.getElementById('scoreboardOverlay');
    if (sb) sb.classList.add('hidden');
    return;
  }

  switch (e.code) {
    case 'KeyW': _w = false; recomputeMoveAxes(); break;
    case 'KeyA': _a = false; recomputeMoveAxes(); break;
    case 'KeyS': _s = false; recomputeMoveAxes(); break;
    case 'KeyD': _d = false; recomputeMoveAxes(); break;
    case 'ShiftLeft': INPUT_STATE.sprint = false; break;
  }
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
      INPUT_STATE.fireDown = true;
      break;
    case 'svMouseUp':
      INPUT_STATE.fireDown = false;
      break;
    case 'svKeyDown':
      switch (d.code) {
        case 'KeyW': _w = true; recomputeMoveAxes(); break;
        case 'KeyA': _a = true; recomputeMoveAxes(); break;
        case 'KeyS': _s = true; recomputeMoveAxes(); break;
        case 'KeyD': _d = true; recomputeMoveAxes(); break;
        case 'ShiftLeft': INPUT_STATE.sprint = true; break;
        case 'KeyR': INPUT_STATE.reloadPressed = true; break;
        case 'Space': INPUT_STATE.jump = true; break;
        case 'KeyV': INPUT_STATE.meleePressed = true; break;
      }
      break;
    case 'svKeyUp':
      switch (d.code) {
        case 'KeyW': _w = false; recomputeMoveAxes(); break;
        case 'KeyA': _a = false; recomputeMoveAxes(); break;
        case 'KeyS': _s = false; recomputeMoveAxes(); break;
        case 'KeyD': _d = false; recomputeMoveAxes(); break;
        case 'ShiftLeft': INPUT_STATE.sprint = false; break;
      }
      break;
    case 'svResetKeys':
      _w = _a = _s = _d = false;
      INPUT_STATE.sprint = false;
      INPUT_STATE.fireDown = false;
      recomputeMoveAxes();
      break;
  }
});
