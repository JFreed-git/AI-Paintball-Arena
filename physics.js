// Lightweight 2D (XZ-plane) movement + collision for a capsule-like player/opponent.
// - Inputs are kept in playerControls.js (WASD, Shift). This file focuses on physics only.

// Compute camera-relative movement direction on the XZ plane:
// moveZ: forward/back (-1..1), moveX: right/left (-1..1)
function computeMoveDirXZ(moveZ, moveX) {
  const forward = new THREE.Vector3();
  if (typeof camera !== 'undefined' && camera) {
    camera.getWorldDirection(forward);
  } else {
    forward.set(0, 0, -1);
  }
  // Flatten to XZ
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();

  // right = forward x up
  let right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();

  const dir = new THREE.Vector3();
  dir.addScaledVector(forward, moveZ);
  dir.addScaledVector(right, moveX);

  // Normalize (avoid NaN for zero vector)
  const len = dir.length();
  if (len > 1e-6) {
    dir.divideScalar(len);
  } else {
    dir.set(0, 0, 0);
  }
  return dir;
}

// Resolve collisions against an array of AABBs (THREE.Box3) in XZ plane with sliding.
// position: THREE.Vector3 (modified in-place)
// radius: number (capsule radius approximation)
// aabbs: array of THREE.Box3
// yCheck: the Y height where our capsule center roughly exists (default ~2)
function resolveCollisions2D(position, radius, aabbs, yCheck = 2) {
  // For 2D resolution, we expand each AABB in X/Z by the radius and push the point out
  // along the axis of least penetration.
  for (let i = 0; i < aabbs.length; i++) {
    const box = aabbs[i];
    // Quick vertical overlap test so we don't collide with very low/high objects
    // Treat player "height band" roughly [0.2, 3.2]
    const bandMin = 0.2;
    const bandMax = 3.2;
    if (box.max.y < bandMin || box.min.y > bandMax) continue;

    const minX = box.min.x - radius;
    const maxX = box.max.x + radius;
    const minZ = box.min.z - radius;
    const maxZ = box.max.z + radius;

    const px = position.x;
    const pz = position.z;

    if (px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
      // Penetrations along each axis to edges
      const penLeft = Math.abs(px - minX);
      const penRight = Math.abs(maxX - px);
      const penBottom = Math.abs(pz - minZ);
      const penTop = Math.abs(maxZ - pz);

      // Pick smallest penetration to push out
      const minPen = Math.min(penLeft, penRight, penBottom, penTop);
      if (minPen === penLeft) {
        position.x = minX - 1e-6;
      } else if (minPen === penRight) {
        position.x = maxX + 1e-6;
      } else if (minPen === penBottom) {
        position.z = minZ - 1e-6;
      } else {
        position.z = maxZ + 1e-6;
      }
    }
  }
}

// Update entity (player or AI) XZ movement with collisions.
// state: { position: THREE.Vector3, walkSpeed: number, sprintSpeed?: number, radius: number }
// input: { moveX: number, moveZ: number, sprint: boolean }  (for AI, set sprint=false typically)
// arena: { colliders: Array<THREE.Box3> }
// dt: seconds
function updateXZPhysics(state, input, arena, dt) {
  const speed = input.sprint && state.sprintSpeed ? state.sprintSpeed : state.walkSpeed;
  const dir = computeMoveDirXZ(input.moveZ || 0, input.moveX || 0);
  if (dir.lengthSq() <= 0) return;

  const move = dir.multiplyScalar(speed * dt);
  state.position.add(move);

  if (arena && Array.isArray(arena.colliders)) {
    resolveCollisions2D(state.position, state.radius || 0.3, arena.colliders);
  }
}

// Line-of-sight test (ray vs colliders), returns true if any solid blocks LOS.
// origin, target: THREE.Vector3
// solids: array of THREE.Object3D (meshes) that can block
function hasBlockingBetween(origin, target, solids) {
  if (!solids || solids.length === 0) return false;
  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3().subVectors(target, origin);
  const dist = dir.length();
  if (dist < 1e-6) return false;
  dir.normalize();
  raycaster.set(origin, dir);
  raycaster.far = dist;

  const hits = raycaster.intersectObjects(solids, true);
  // Ignore the target itself if it's part of solids; caller should pass solids excluding the target mesh.
  return hits && hits.length > 0;
}

// Expose functions globally
window.resolveCollisions2D = resolveCollisions2D;
window.updateXZPhysics = updateXZPhysics;
window.hasBlockingBetween = hasBlockingBetween;
