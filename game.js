// Game variables (globals shared across scripts)
let scene, camera, renderer;
let targets = [];
let score = 0;
let timeLeft = 30;
let gameActive = false;
let raycaster, mouse;
let gameTimer = null;
let spawnMode = 'Free Space';
let wallConfig = null;
let mouseSensitivity = 1.0;
let isTimed = false;
let targetCount = 5;


// ------- Initialization -------
function init() {
  // Create scene
  scene = new THREE.Scene();

  // Create camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 5);
  camera.rotation.order = 'YXZ';
  camera.up.set(0, 1, 0);
  resetCameraToDefaults();

  // Create renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('gameContainer').appendChild(renderer.domElement);
  // Build base environment (background, fog, lights, ground)
  setupEnvironment();

  // Ensure crosshair element exists in DOM
  ensureCrosshair();

  // Setup raycaster for shooting
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();



  // Create simple weapon model
  createWeaponModel();

  // Bind player controls and UI/menu logic
  bindPlayerControls(renderer);
  bindUI();

  // Start animation loop
  animate();

  // Ensure HUD hidden while in menus on load
  setHUDVisible(false);
  // Ensure only main menu is visible on load (HTML already does this, but enforce)
  showOnlyMenu('mainMenu');
}


// ------- Game lifecycle -------
function startGame(config) {
  // config: { mode: 'Free Space' | 'Wall', isTimed: boolean, duration?: number }
  // Clean any previous session
  stopGameInternal();
  // Ensure a consistent starting camera transform each session
  resetCameraToDefaults();

  gameActive = true;
  score = 0;
  spawnMode = config.mode || 'Free Space';
  isTimed = !!config.isTimed;
  timeLeft = isTimed ? Math.max(1, config.duration || 30) : 0;

  // UI setup
  const scoreEl = document.getElementById('score');
  const timerEl = document.getElementById('timer');
  if (scoreEl) scoreEl.textContent = `Score: ${score}`;
  if (timerEl) {
    if (isTimed) {
      timerEl.classList.remove('hidden');
      timerEl.textContent = `Time: ${timeLeft}s`;
    } else {
      timerEl.classList.add('hidden');
    }
  }

  // Hide menus, show HUD
  showOnlyMenu(null);
  setHUDVisible(true);

  // Show instructions for untimed modes
  const instructionsEl = document.getElementById('instructions');
  if (instructionsEl) instructionsEl.classList.toggle('hidden', isTimed);

  // Clear existing targets and indicators
  targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
  targets = [];

  // Setup wall if needed
  clearWall();
  if (spawnMode === 'Wall') {
    prepareWall();
  }

  // Spawn initial targets
  for (let i = 0; i < targetCount; i++) {
    createTarget();
  }

  // Request pointer lock for better mouse control
  // Must be called from user gesture (click on button) - which this is.
  renderer.domElement.requestPointerLock();

  // Start timer if timed
  if (isTimed) {
    gameTimer = setInterval(() => {
      timeLeft--;
      if (timerEl) timerEl.textContent = `Time: ${timeLeft}s`;
      if (timeLeft <= 0) {
        endTimedSession();
      }
    }, 1000);
  }
}

function stopGameInternal() {
  // Stop and cleanup without showing menus; used before starting a new session
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
  // Clear targets and indicators
  targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
  targets = [];
  // Remove wall if present
  clearWall();
  gameActive = false;
  // Hide instructions (if any were showing)
  {
    const instructionsEl = document.getElementById('instructions');
    if (instructionsEl) instructionsEl.classList.add('hidden');
  }
  // Exit pointer lock if active
  try { document.exitPointerLock(); } catch {}
}

function endTimedSession() {
  // Stop timer if running
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }

  // Mark game as inactive and clean up scene
  gameActive = false;

  targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
  targets = [];
  clearWall();

  // Exit pointer lock
  try { document.exitPointerLock(); } catch {}

  // Hide HUD
  setHUDVisible(false);
  // Hide instructions
  {
    const instructionsEl = document.getElementById('instructions');
    if (instructionsEl) instructionsEl.classList.add('hidden');
  }

  // Show final score and results menu
  const finalScoreEl = document.getElementById('finalScore');
  if (finalScoreEl) finalScoreEl.textContent = String(score);
  showOnlyMenu('resultMenu');
}

function returnToMainMenu() {
  if (!gameActive && !gameTimer) {
    // Ensure menus visible even if not in a game
    showOnlyMenu('mainMenu');
    setHUDVisible(false);
    return;
  }
  // Clean up timer/targets/wall and state
  if (gameTimer) {
    clearInterval(gameTimer);
    gameTimer = null;
  }
  gameActive = false;

  targets.forEach(target => { scene.remove(target); removeIndicatorForTarget(target); });
  targets = [];
  clearWall();

  // Hide HUD, show main menu
  setHUDVisible(false);
  // Hide instructions
  {
    const instructionsEl = document.getElementById('instructions');
    if (instructionsEl) instructionsEl.classList.add('hidden');
  }
  showOnlyMenu('mainMenu');

  // Exit pointer lock
  try { document.exitPointerLock(); } catch {}
}

// ------- Main loop -------
function animate() {
  requestAnimationFrame(animate);

  // Rotate targets slowly
  targets.forEach(target => {
    target.rotation.x += 0.01;
    target.rotation.y += 0.01;
  });

  updateIndicators();
  renderer.render(scene, camera);
}

// ------- Boot -------
init();
