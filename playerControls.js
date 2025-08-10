// Player controls and input handlers

function bindPlayerControls(renderer) {
  // Window and renderer-level listeners
  window.addEventListener('resize', onWindowResize);
  if (renderer && renderer.domElement) {
    renderer.domElement.addEventListener('click', onMouseClick);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
  }

  // Global listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('keydown', onGlobalKeyDown);
}

function onMouseMove(event) {
  if (!gameActive) return;

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
  camera.rotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, camera.rotation.x));
  camera.rotation.z = 0;
}

function onMouseClick(event) {
  if (!gameActive) return;

  // Cast ray from camera (center crosshair)
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

  // Check for intersections with targets
  const intersects = raycaster.intersectObjects(targets);

  if (intersects.length > 0) {
    const hitTarget = intersects[0].object;

    // Remove target
    scene.remove(hitTarget);
    removeIndicatorForTarget(hitTarget);
    targets = targets.filter(t => t !== hitTarget);

    // Update score
    score++;
    const scoreEl = document.getElementById('score');
    if (scoreEl) scoreEl.textContent = `Score: ${score}`;

    // Create new target
    setTimeout(createTarget, 500);
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerLockChange() {
  const locked = document.pointerLockElement === (renderer && renderer.domElement);
  // If we lose pointer lock during a game, return to main menu
  if (!locked && gameActive) {
    returnToMainMenu();
  }
}

function onGlobalKeyDown(e) {
  if (e.key === 'Escape') {
    // From anywhere, go to main menu
    if (gameActive) {
      returnToMainMenu();
    } else {
      // Ensure main menu is shown if not in game
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }
  }
}
