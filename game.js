// Minimal bootstrap for Paintball-only build

// Global scene/camera/renderer (shared across scripts)
let scene, camera, renderer;
let raycaster, mouse;

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

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('gameContainer').appendChild(renderer.domElement);

  // Environment (lights, fog, ground)
  setupEnvironment();

  // Crosshair / Weapon
  ensureCrosshair();
  createWeaponModel();

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
