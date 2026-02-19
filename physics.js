/**
 * physics.js — Movement engine, collision, and physics constants
 *
 * PURPOSE: Handles all physics simulation: horizontal XZ movement, vertical gravity
 * and jumping, ground detection via raycasting, AABB collision resolution, and
 * line-of-sight testing. All game modes call updateFullPhysics() each frame.
 *
 * EXPORTS (window):
 *   GROUND_Y, GRAVITY, JUMP_VELOCITY, EYE_HEIGHT, MAX_STEP_HEIGHT — physics constants
 *   getGroundHeight(pos, solids, feetY, grounded) — raycast ground detection
 *   resolveCollisions3D(state, colliders) — unified 3D AABB collision (walls+ceiling+block-tops)
 *   resolveCollisions2D(position, radius, aabbs, feetY) — legacy XZ-only push-out (used by mapEditor)
 *   updateFullPhysics(state, input, arena, dt) — full physics update cycle
 *   hasBlockingBetween(origin, target, solids) — LOS test
 *
 * DEPENDENCIES: Three.js (THREE), game.js (camera global)
 *
 * DESIGN NOTES:
 *   - Physics constants live HERE (not in config.js) because they're consumed
 *     exclusively by the physics engine.
 *   - JUMP_VELOCITY is the default. Heroes can override via player._jumpVelocity
 *     (set by applyHeroToPlayer in heroes.js). updateFullPhysics reads
 *     state._jumpVelocity if present, falling back to JUMP_VELOCITY.
 *   - Collision uses Y-aware AABB push-out: colliders are skipped when the player
 *     stands on top of them (feetY + 0.1 >= box.max.y). This enables ramp traversal.
 *   - Ground detection uses downward raycasting against arena.solids (meshes).
 *     When grounded, only surfaces within MAX_STEP_HEIGHT are accepted (prevents
 *     teleporting to distant surfaces). When airborne, any surface below feet is valid.
 *
 * TODO (future):
 *   - Crouching: reduce EYE_HEIGHT, slow speed, smaller hitbox
 *   - Sliding: momentum-based crouch-sprint with friction
 *   - Wall running / wall jumping
 *   - Ability-driven movement (dash applies velocity impulse)
 */

// Inputs are kept in input.js (WASD, Shift, Space). This file focuses on physics only.

// --- Vertical physics constants ---
var GROUND_Y = -1;
var GRAVITY = -20;
var JUMP_VELOCITY = 8.5;
var EYE_HEIGHT = 2.0;
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
// Uses multiple rays at foot corners to avoid missing block edges.
// pos: THREE.Vector3 (XZ used), solids: array of THREE.Mesh, feetY: current feet Y,
// grounded: boolean (when airborne, accept any surface below feetY; when grounded, limit to step height)
// radius: optional player radius for multi-ray spread (defaults to 0.3)
function getGroundHeight(pos, solids, feetY, grounded, radius) {
  if (!solids || solids.length === 0) return GROUND_Y;

  var currentFeetY = (typeof feetY === 'number') ? feetY : GROUND_Y;
  var r = (typeof radius === 'number') ? radius : 0.3;
  var rc = new THREE.Raycaster();
  var downDir = new THREE.Vector3(0, -1, 0);
  var originY = currentFeetY + EYE_HEIGHT + 5;
  var farDist = originY - GROUND_Y + 10;

  // Cast from center + 4 foot corners to reliably detect ground at block edges
  var offsets = [
    [0, 0],
    [r * 0.7, 0], [-r * 0.7, 0],
    [0, r * 0.7], [0, -r * 0.7]
  ];

  var bestY = GROUND_Y;
  for (var o = 0; o < offsets.length; o++) {
    rc.set(
      new THREE.Vector3(pos.x + offsets[o][0], originY, pos.z + offsets[o][1]),
      downDir
    );
    rc.far = farDist;

    var hits = rc.intersectObjects(solids, true);
    for (var i = 0; i < hits.length; i++) {
      var hitY = hits[i].point.y;
      if (grounded) {
        // When grounded, only accept surfaces within step tolerance above current feet
        if (hitY > bestY && hitY <= currentFeetY + MAX_STEP_HEIGHT + 0.1) {
          bestY = hitY;
        }
      } else {
        // When airborne/falling, accept any surface at or below current feet position
        if (hitY > bestY && hitY <= currentFeetY) {
          bestY = hitY;
        }
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

    // --- Cylinder collider: radial push-out ---
    if (box.isCylinder) {
      if (feetY + 0.1 >= box.max.y) continue;
      if (box.max.y < feetY + 0.2 || box.min.y > feetY + EYE_HEIGHT + 0.2) continue;
      var cdx = position.x - box.centerX;
      var cdz = position.z - box.centerZ;
      var cdist = Math.sqrt(cdx * cdx + cdz * cdz);
      var cMinDist = box.radius + radius;
      if (cdist < cMinDist) {
        if (cdist < 1e-6) { position.x += cMinDist; }
        else {
          var cPush = cMinDist - cdist;
          position.x += (cdx / cdist) * cPush;
          position.z += (cdz / cdist) * cPush;
        }
      }
      continue;
    }

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

// Unified 3D AABB collision resolver: handles walls, ceilings, and block-tops using
// minimum-penetration-axis resolution. Replaces the separate ceiling and XZ resolvers.
// Blocks are solid volumes — if the player is inside one, push out along whichever
// axis has the smallest penetration. Multi-pass handles being wedged between blocks.
function resolveCollisions3D(state, colliders) {
  if (!colliders || colliders.length === 0) return;
  var radius = state.radius || 0.3;
  // When grounded, use a generous Y-skip tolerance (MAX_STEP_HEIGHT) so ramp
  // staircase steps are reliably skipped even on steeper slopes.  When airborne,
  // keep the tight 0.1 tolerance to prevent clipping through obstacles mid-jump.
  var ySkipTol = state.grounded ? MAX_STEP_HEIGHT : 0.1;

  for (var pass = 0; pass < 3; pass++) {
    var resolved = false;

    for (var i = 0; i < colliders.length; i++) {
      var box = colliders[i];
      var feetY = state.feetY;
      var headY = feetY + EYE_HEIGHT;

      // --- Cylinder collider: radial push-out ---
      if (box.isCylinder) {
        if (feetY + ySkipTol >= box.max.y) continue;
        if (headY <= box.min.y || feetY >= box.max.y) continue;
        var cdx = state.position.x - box.centerX;
        var cdz = state.position.z - box.centerZ;
        var cdist = Math.sqrt(cdx * cdx + cdz * cdz);
        var cMinDist = box.radius + radius;
        if (cdist < cMinDist) {
          if (cdist < 1e-6) { state.position.x += cMinDist; }
          else {
            var cPush = cMinDist - cdist;
            state.position.x += (cdx / cdist) * cPush;
            state.position.z += (cdz / cdist) * cPush;
          }
          resolved = true;
        }
        continue;
      }

      // Skip blocks player is standing on top of (let ground detection handle this)
      if (feetY + ySkipTol >= box.max.y) continue;

      // Expand block by player radius in XZ for capsule approximation
      var bMinX = box.min.x - radius;
      var bMaxX = box.max.x + radius;
      var bMinZ = box.min.z - radius;
      var bMaxZ = box.max.z + radius;

      // Check full 3D overlap: player XZ point inside expanded box AND vertical overlap
      if (state.position.x <= bMinX || state.position.x >= bMaxX) continue;
      if (state.position.z <= bMinZ || state.position.z >= bMaxZ) continue;
      if (headY <= box.min.y || feetY >= box.max.y) continue;

      // Compute penetration depth along each of 6 directions
      var penPosX = bMaxX - state.position.x;  // push +X (right)
      var penNegX = state.position.x - bMinX;  // push -X (left)
      var penPosZ = bMaxZ - state.position.z;  // push +Z
      var penNegZ = state.position.z - bMinZ;  // push -Z
      var penDown = headY - box.min.y;          // push down (ceiling hit)
      var penUp = box.max.y - feetY;            // push up (land on top)

      // Surface-snap bias: when feet are close to a block's top surface,
      // prefer snapping up onto it rather than pushing in X/Z (prevents
      // edge-of-block oscillation where two adjacent blocks fight each other)
      if (penUp <= MAX_STEP_HEIGHT && penUp < penDown) {
        state.feetY = box.max.y;
        state.verticalVelocity = 0;
        state.grounded = true;
        resolved = true;
        continue;
      }

      // Find minimum penetration
      var minPen = Math.min(penPosX, penNegX, penPosZ, penNegZ, penDown, penUp);

      if (minPen === penDown) {
        // Ceiling: push player down so head clears block bottom
        state.feetY = box.min.y - EYE_HEIGHT - 1e-3;
        if (state.verticalVelocity > 0) state.verticalVelocity = 0;
      } else if (minPen === penUp) {
        // Landing on block top: push player up
        state.feetY = box.max.y;
        state.verticalVelocity = 0;
        state.grounded = true;
      } else if (minPen === penPosX) {
        state.position.x = bMaxX + 1e-6;
      } else if (minPen === penNegX) {
        state.position.x = bMinX - 1e-6;
      } else if (minPen === penPosZ) {
        state.position.z = bMaxZ + 1e-6;
      } else {
        state.position.z = bMinZ - 1e-6;
      }
      resolved = true;
    }

    if (!resolved) break; // No more overlaps
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

  // 3. Detect ground height at new XZ (multi-ray for edge robustness)
  var solids = (arena && arena.solids) ? arena.solids : [];
  var pRadius = state.radius || 0.3;
  var groundH = getGroundHeight(state.position, solids, state.feetY, state.grounded, pRadius);

  // 4. Jump (use per-hero _jumpVelocity if available, else global JUMP_VELOCITY)
  if (input.jump && state.grounded) {
    state.verticalVelocity = (state._jumpVelocity != null) ? state._jumpVelocity : JUMP_VELOCITY;
    state.grounded = false;
  }

  // Drop threshold: use hysteresis — require a larger gap before becoming airborne
  // to prevent oscillation at block edges where ground detection may flicker
  var dropThreshold = MAX_STEP_HEIGHT + 0.15;

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
    if (groundH < state.feetY - dropThreshold) {
      // Ground dropped away — start falling
      state.grounded = false;
      state.verticalVelocity = 0;
    } else {
      // Smooth snap to ground (handles ramps)
      state.feetY = groundH;
    }
  }

  // 7. Resolve ALL collisions (walls + ceiling + block-tops) in one pass
  if (arena && Array.isArray(arena.colliders)) {
    resolveCollisions3D(state, arena.colliders);
  }

  // 8. Recheck ground after collision push-out (may have been pushed to different XZ)
  var groundH2 = getGroundHeight(state.position, solids, state.feetY, state.grounded, pRadius);
  if (state.grounded) {
    if (groundH2 < state.feetY - dropThreshold) {
      state.grounded = false;
      state.verticalVelocity = 0;
    } else {
      state.feetY = groundH2;
    }
  }

  // 9. Set eye-height position
  state.position.y = state.feetY + EYE_HEIGHT;
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
window.resolveCollisions3D = resolveCollisions3D;
window.updateFullPhysics = updateFullPhysics;
window.hasBlockingBetween = hasBlockingBetween;
