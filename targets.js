// Target creation and indicator utilities

function createTarget() {
  const geometry = new THREE.SphereGeometry(0.5, 16, 16);
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(Math.random(), Math.random(), Math.random())
  });
  const target = new THREE.Mesh(geometry, material);

  // Choose spawn position based on current mode
  let pos;
  if (spawnMode === 'Wall' && wallConfig) {
    pos = getWallSpawnPosition();
  } else {
    pos = getFreeSpaceSpawnPosition();
  }
  target.position.copy(pos);

  scene.add(target);
  targets.push(target);
  createIndicatorForTarget(target);
}

function createIndicatorForTarget(target) {
  const el = document.createElement('div');
  el.className = 'indicator';
  el.textContent = '➤';
  el.style.display = 'none';
  const container = document.getElementById('gameContainer');
  container.appendChild(el);
  target.userData.indicator = el;
}

function removeIndicatorForTarget(target) {
  const el = target.userData && target.userData.indicator;
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
  if (target.userData) {
    delete target.userData.indicator;
  }
}

function updateIndicators() {
  if (!gameActive) {
    targets.forEach(target => {
      const el = target.userData && target.userData.indicator;
      if (el) el.style.display = 'none';
    });
    return;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const halfW = width / 2;
  const halfH = height / 2;
  const margin = 16; // keep arrows right at the inner edge

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  targets.forEach(target => {
    const el = target.userData && target.userData.indicator;
    if (!el) return;

    // Determine if off-screen/behind
    const worldPos = target.position.clone();
    const camToTarget = worldPos.clone().sub(camera.position);
    const isBehind = camToTarget.dot(forward) < 0;

    const ndc = worldPos.clone().project(camera);
    const isOffscreen = isBehind || ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1;

    if (!isOffscreen) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    // Flip NDC if behind so arrow points correctly
    let nx = ndc.x;
    let ny = ndc.y;
    if (isBehind) {
      nx = -nx;
      ny = -ny;
    }

    // Convert to screen-centered coordinates
    const sx = nx * halfW;
    const sy = -ny * halfH;

    // Scale to the inner edge of the screen rectangle
    const eps = 1e-6;
    const kx = (halfW - margin) / (Math.abs(sx) + eps);
    const ky = (halfH - margin) / (Math.abs(sy) + eps);
    const k = Math.min(kx, ky);

    const ex = sx * k;
    const ey = sy * k;

    const px = ex + halfW;
    const py = ey + halfH;

    // Point arrow from center toward the target direction
    const angle = Math.atan2(ey, ex);

    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  });
}
