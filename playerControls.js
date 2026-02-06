/**
 * Player controls and input handlers
 * Camera defaults/reset are defined here to keep input + camera behavior together.
 */

// Camera defaults and reset live with player controls
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 2, 5);
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
const INPUT_STATE = { fireDown: false, sprint: false, reloadPressed: false, moveX: 0, moveZ: 0 };
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
  }

  // Global listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('keydown', onGlobalKeyDown);
  document.addEventListener('keyup', onGlobalKeyUp);
}

function onMouseMove(event) {
  if (!window.paintballActive && !window.multiplayerActive) return;

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
  const canvas = renderer && renderer.domElement;
  const locked = document.pointerLockElement === canvas;

  if (!locked) {
    // Heuristic:
    // - If the document is focused and visible, treat pointer unlock as explicit ESC.
    // - If focus/visibility was lost (Alt-Tab), do nothing; clicking will re-lock.
    const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    const visible = typeof document.visibilityState === 'string' ? (document.visibilityState === 'visible') : true;

    if (focused && visible && !window.devConsoleOpen) {
      if (window.paintballActive) {
        try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
      } else if (window.multiplayerActive) {
        try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
        showOnlyMenu('mainMenu');
        setHUDVisible(false);
      }
    }
  }
}

function onGlobalKeyDown(e) {
  if (window.editorActive) return;
  if (e.key === 'Escape') {
    if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    } else if (window.multiplayerActive) {
      try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
    }
    showOnlyMenu('mainMenu');
    setHUDVisible(false);
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
  }
}

function onGlobalKeyUp(e) {
  if (window.editorActive) return;
  switch (e.code) {
    case 'KeyW': _w = false; recomputeMoveAxes(); break;
    case 'KeyA': _a = false; recomputeMoveAxes(); break;
    case 'KeyS': _s = false; recomputeMoveAxes(); break;
    case 'KeyD': _d = false; recomputeMoveAxes(); break;
    case 'ShiftLeft': INPUT_STATE.sprint = false; break;
  }
}
