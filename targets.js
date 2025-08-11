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

  // Build camera basis
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward).normalize();

  let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  targets.forEach(target => {
    const el = target.userData && target.userData.indicator;
    if (!el) return;

    const worldPos = target.position.clone();
    const camToTarget = worldPos.clone().sub(camera.position);

    // Visibility check using original position
    const ndcCheck = worldPos.clone().project(camera);
    const isBehind = camToTarget.dot(forward) < 0;
    const onScreen =
      !isBehind &&
      ndcCheck.x >= -1 && ndcCheck.x <= 1 &&
      ndcCheck.y >= -1 && ndcCheck.y <= 1;

    if (onScreen) {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'block';

    // Components in camera space
    const lx = camToTarget.dot(right);
    const ly = camToTarget.dot(up);
    const lz = camToTarget.dot(forward);

    if (isBehind) {
      // For behind targets, place arrow on nearest side edge (left/right)
      const sideRight = lx >= 0;
      const px = sideRight ? (width - margin) : margin;

      // Vertical position: bias toward center unless pitch is significant.
      // Compute pitch relative to the camera's forward axis.
      const pitch = Math.atan2(ly, Math.abs(lz)); // [-pi/2, pi/2], up positive
      const dead = 10 * Math.PI / 180; // 10° deadzone
      let ny; // [-1, 1], positive = up
      if (Math.abs(pitch) <= dead) {
        ny = 0; // keep centered vertically when mostly a left/right turn
      } else {
        const maxPitch = 45 * Math.PI / 180; // scale up to 45°
        ny = pitch / maxPitch;
        ny = Math.max(-1, Math.min(1, ny));
      }
      const py = Math.min(height - margin, Math.max(margin, halfH - ny * (halfH - margin)));

      const ex = px - halfW;
      const ey = py - halfH;
      const angle = Math.atan2(ey, ex);

      el.style.left = `${px}px`;
      el.style.top = `${py}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
      return;
    }

    // For front targets that are offscreen: project and clamp to the nearest edge.
    const ndc = worldPos.clone().project(camera);

    // Convert to screen-centered pixel coordinates
    const sx = ndc.x * halfW;
    const sy = -ndc.y * halfH;

    // Clamp to inner edge of the screen rectangle
    const eps = 1e-6;
    const kx = (halfW - margin) / (Math.abs(sx) + eps);
    const ky = (halfH - margin) / (Math.abs(sy) + eps);
    const k = Math.min(kx, ky);

    const ex = sx * k;
    const ey = sy * k;

    const px = ex + halfW;
    const py = ey + halfH;

    const angle = Math.atan2(ey, ex);

    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
  });
}
