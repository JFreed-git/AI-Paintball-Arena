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
window.setFirstPersonWeapon = function (modelType) {
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

  // Position in lower-right of camera view
  _fpWeaponGroup.position.set(0.28, -0.22, -0.45);
  _fpWeaponGroup.rotation.set(0.05, -0.15, 0);

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
  bindUI();

  // Start loop
  animate();

  // Ensure HUD hidden on load and main menu visible
  setHUDVisible(false);
  showOnlyMenu('mainMenu');
}

// ------- Main loop -------
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// ------- Boot -------
init();
