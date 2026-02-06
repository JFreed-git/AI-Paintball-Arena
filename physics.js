// Physics: 2D (XZ) movement + collision + vertical (gravity, jumping, ramps).
// Inputs are kept in playerControls.js (WASD, Shift, Space). This file focuses on physics only.

// --- Vertical physics constants ---
var GROUND_Y = -1;
var GRAVITY = -20;
var JUMP_VELOCITY = 8.5;
var EYE_HEIGHT = 3.0;
var MAX_STEP_HEIGHT = 0.3;

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

// Raycast downward to find the highest walkable surface at a given XZ position.
// Returns the Y of the ground surface (top of geometry), or GROUND_Y if nothing found.
// pos: THREE.Vector3 (XZ used), solids: array of THREE.Mesh, feetY: current feet Y,
// grounded: boolean (when airborne, accept any surface below feetY; when grounded, limit to step height)
function getGroundHeight(pos, solids, feetY, grounded) {
  if (!solids || solids.length === 0) return GROUND_Y;

  var currentFeetY = (typeof feetY === 'number') ? feetY : GROUND_Y;
  var rc = new THREE.Raycaster();
  // Cast from well above the player downward
  var origin = new THREE.Vector3(pos.x, currentFeetY + EYE_HEIGHT + 5, pos.z);
  rc.set(origin, new THREE.Vector3(0, -1, 0));
  rc.far = origin.y - GROUND_Y + 10;

  var hits = rc.intersectObjects(solids, true);
  var bestY = GROUND_Y;
  for (var i = 0; i < hits.length; i++) {
    var hitY = hits[i].point.y;
    if (grounded) {
      // When grounded, only accept surfaces within step tolerance above current feet
      if (hitY > bestY && hitY <= currentFeetY + MAX_STEP_HEIGHT + 0.5) {
        bestY = hitY;
      }
    } else {
      // When airborne/falling, accept any surface at or below current feet position
      if (hitY > bestY && hitY <= currentFeetY) {
        bestY = hitY;
      }
    }
  }
  return bestY;
}

// Resolve collisions against an array of AABBs (THREE.Box3) in XZ plane with sliding.
// position: THREE.Vector3 (modified in-place)
// radius: number (capsule radius approximation)
// aabbs: array of THREE.Box3
// feetY: current feet Y position for dynamic band check (default GROUND_Y)
function resolveCollisions2D(position, radius, aabbs, feetY) {
  if (feetY === undefined) feetY = GROUND_Y;
  var bandMin = feetY + 0.2;
  var bandMax = feetY + EYE_HEIGHT + 0.2;

  for (let i = 0; i < aabbs.length; i++) {
    const box = aabbs[i];
    // Skip colliders the player is standing on top of (feet at or above the collider top)
    if (feetY + 0.1 >= box.max.y) continue;
    // Skip colliders entirely above our head
    if (box.min.y > bandMax) continue;
    // Skip colliders that don't vertically overlap our body band
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

// Full 3D physics update: horizontal movement + gravity + jumping + ground detection.
// state: { position: THREE.Vector3, feetY: number, verticalVelocity: number, grounded: boolean,
//          walkSpeed: number, sprintSpeed?: number, radius: number }
// input: { moveX?, moveZ?, sprint?, jump?, worldMoveDir?: THREE.Vector3 }
//   - If worldMoveDir is set (AI), use it directly instead of camera-relative WASD
// arena: { colliders: Array<THREE.Box3>, solids: Array<THREE.Mesh> }
// dt: seconds
function updateFullPhysics(state, input, arena, dt) {
  // 1. Compute horizontal direction
  var dir;
  if (input.worldMoveDir && input.worldMoveDir.lengthSq && input.worldMoveDir.lengthSq() > 1e-6) {
    dir = input.worldMoveDir.clone();
    dir.y = 0;
    if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, 0);
  } else {
    dir = computeMoveDirXZ(input.moveZ || 0, input.moveX || 0);
  }

  // 2. Apply horizontal movement
  var speed = input.sprint && state.sprintSpeed ? state.sprintSpeed : state.walkSpeed;
  if (dir.lengthSq() > 0) {
    state.position.x += dir.x * speed * dt;
    state.position.z += dir.z * speed * dt;
  }

  // 3. Detect ground height at new XZ
  var solids = (arena && arena.solids) ? arena.solids : [];
  var groundH = getGroundHeight(state.position, solids, state.feetY, state.grounded);

  // 4. Jump
  if (input.jump && state.grounded) {
    state.verticalVelocity = JUMP_VELOCITY;
    state.grounded = false;
  }

  // 5. Apply gravity when not grounded
  if (!state.grounded) {
    state.verticalVelocity += GRAVITY * dt;
    state.feetY += state.verticalVelocity * dt;

    // Land when feet reach ground
    if (state.feetY <= groundH) {
      state.feetY = groundH;
      state.verticalVelocity = 0;
      state.grounded = true;
    }
  } else {
    // 6. Grounded: snap to ground, detect drops
    if (groundH < state.feetY - MAX_STEP_HEIGHT) {
      // Ground dropped away — start falling
      state.grounded = false;
      state.verticalVelocity = 0;
    } else {
      // Smooth snap to ground (handles ramps)
      state.feetY = groundH;
    }
  }

  // 7. Resolve 2D collisions with dynamic feetY
  if (arena && Array.isArray(arena.colliders)) {
    resolveCollisions2D(state.position, state.radius || 0.3, arena.colliders, state.feetY);
  }

  // 8. Recheck ground after collision push-out (may have been pushed to different XZ)
  var groundH2 = getGroundHeight(state.position, solids, state.feetY, state.grounded);
  if (state.grounded) {
    if (groundH2 < state.feetY - MAX_STEP_HEIGHT) {
      state.grounded = false;
      state.verticalVelocity = 0;
    } else {
      state.feetY = groundH2;
    }
  }

  // 9. Set eye-height position
  state.position.y = state.feetY + EYE_HEIGHT;
}

// Update entity (player or AI) XZ movement with collisions (legacy — kept for compatibility).
// state: { position: THREE.Vector3, walkSpeed: number, sprintSpeed?: number, radius: number }
// input: { moveX: number, moveZ: number, sprint: boolean }
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
  return hits && hits.length > 0;
}

// Expose functions and constants globally
window.GROUND_Y = GROUND_Y;
window.GRAVITY = GRAVITY;
window.JUMP_VELOCITY = JUMP_VELOCITY;
window.EYE_HEIGHT = EYE_HEIGHT;
window.MAX_STEP_HEIGHT = MAX_STEP_HEIGHT;
window.getGroundHeight = getGroundHeight;
window.resolveCollisions2D = resolveCollisions2D;
window.updateFullPhysics = updateFullPhysics;
window.updateXZPhysics = updateXZPhysics;
window.hasBlockingBetween = hasBlockingBetween;
