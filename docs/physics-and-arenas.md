# Physics and Arenas Reference

Consult this doc when working on: movement, gravity, jumping, collision, ground detection, arena construction, map format, ramp/wedge/arch colliders, or the tick ordering of game modes.

## Physics Engine

Movement is full 3D — horizontal XZ walking plus vertical gravity, jumping, and ramp traversal. `updateFullPhysics` handles the complete cycle: horizontal movement → ground detection via `getGroundHeight` (downward raycast against `arena.solids`) → jump/gravity → ground snapping → unified 3D collision resolution → ground recheck.

- Gravity constant is in `physics.js` (`GRAVITY = -20`), NOT in config.js.
- Per-hero jump velocity is supported via `state._jumpVelocity` (defaults to `JUMP_VELOCITY` from physics.js).
- **Unified 3D collision** (`resolveCollisions3D`): single resolver handles walls, ceilings, and block-tops. Treats each collider as a solid volume — if the player overlaps it, pushes out along the axis of minimum penetration (6 directions: ±X, ±Z, up, down). Ceiling hits push the player down and zero upward velocity. Wall hits push sideways. Block-top hits push up and ground the player. Multi-pass (up to 3) handles being wedged between blocks.
- Colliders are skipped when the player stands on top of them. When grounded the tolerance is generous (`feetY + MAX_STEP_HEIGHT >= box.max.y`) so ramp staircase steps are reliably skipped even on steeper slopes; when airborne the tolerance tightens to 0.1m to prevent clipping.
- Ramp and wedge colliders use a staircase approximation (ceil(height / MAX_STEP_HEIGHT) progressively shorter AABBs, no back wall). Step count is dynamic so each step delta is at most 0.3m. Removing the back wall lets players transition smoothly onto adjacent blocks at the ramp's high end; the tallest step still blocks entry from the steep face.
- L-shape colliders decompose into 2 AABBs (horizontal leg + vertical leg) to avoid blocking the empty inner corner.
- Arch colliders decompose into 3 AABBs (2 full-height pillars + top lintel above the opening). Arch opening height is controlled by `thickness` (lintel height in absolute units); defaults to `ah * 0.35` for backward compatibility.
- Cylinder colliders use radial push-out (not AABB). The collider object has `isCylinder: true`, `centerX`, `centerZ`, `radius`, `min.y`, `max.y`. Both `resolveCollisions3D` and `resolveCollisions2D` handle this before the AABB branch. Waypoint generation checks cylinder containment via distance-from-center instead of `containsPoint`.
- Sphere shapes use default AABB collision (mesh raycaster handles projectile accuracy).
- `arena.solids` (Mesh array) = ground-height raycasting, bullet raycasting, AI line-of-sight.
- `arena.colliders` (Box3 or cylinder collider array) = movement collision.

### Physics Constants (`physics.js`)

GROUND_Y, GRAVITY, JUMP_VELOCITY, EYE_HEIGHT, MAX_STEP_HEIGHT.

## Combat (physics-related)

Combat uses visible traveling projectiles by default (`projectileSpeed: 120` m/s), with hitscan as a fallback when `projectileSpeed` is 0/null. Player hitboxes are **segmented shapes** (head/torso/legs) supporting box, sphere, cylinder, and capsule shape types, with per-segment damage multipliers — headshots deal 2x damage, leg shots 0.75x. `sharedFireWeapon()` in `projectiles.js` is the single entry point for all weapon firing across all modes. `testHitSegments()` dispatches ray intersection by shape type. `updateProjectiles(dt)` must be called each frame by the active game mode to advance live projectiles.

## Tick Ordering Requirement

Each game mode's tick function must update ALL entity physics and call `_syncMeshPosition()` BEFORE `handlePlayerShooting()`/`sharedFireWeapon()` and `updateProjectiles(dt)`. This ensures hitboxes are at their current-frame positions when tested by rays and projectiles. If entities update after projectile testing, hitboxes lag one frame behind the visual mesh. After all updates, call `if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();` to keep debug wireframes in sync.

## Arena Files

| File | Purpose |
|------|---------|
| `arenaBuilder.js` | Shared helpers: `arenaAddSolidBox()`, `arenaAddFloor()`, `arenaAddPerimeterWalls()`, `arenaAddTrees()`. Shared tree materials in `ARENA_TREE_MATERIALS`. Uses `GROUND_Y` from physics.js. |
| `arenaCompetitive.js` | Competitive arena. `buildPaintballArenaSymmetric()` returns `{group, colliders, solids, waypoints, spawns: {A, B}}`. Z-symmetric cover, AI waypoint graph (25-point), gold spawn rings, scenery trees. |
| `arenaTraining.js` | Training range. `buildTrainingRangeArena()` returns `{group, colliders, solids, spawns, targetPositions, botPatrolPaths}`. 80x100m arena with 3 shooting lanes (targets at 15/25/35m), open field with cover, and bot patrol routes. |
| `mapFormat.js` | Map data serialization and arena construction from JSON. Exports: `buildArenaFromMap(mapData)`, `getDefaultMapData()`, `normalizeSpawns(spawns)`, `saveMapToServer(name, mapData)`, `deleteMapFromServer(name)`, `fetchMapList()`, `fetchMapData(name)`, `recalcNextMirrorPairId(mapData)`, `computeColliderForMesh(mesh)`. Supports 7 shape types (box, cylinder, sphere, ramp, wedge, lshape, arch) with shape-accurate colliders. Legacy `halfCylinder` objects are auto-converted to `cylinder` on load. Array-based spawn format with team assignment; `normalizeSpawns` converts old `{A,B}` format. `buildArenaFromMap` returns both `spawns: {A, B}` (backward compat) and `spawnsList` (full array). Auto-waypoints: 7-unit grid + 3 explicit waypoints per ramp/wedge (base, on-slope, past-top) so AI can path up ramps. |
| `mapEditor.js` | Visual map editor (Electron-only). Fly camera, place/select/move/resize/rotate/delete 7 shape types. Z/X/Quad mirror modes, multi-select (Shift+click, Ctrl+A), copy/paste (Ctrl+C/V), flexible spawn placement, arena boundary visualization, undo/redo, save/load, player-mode preview. |
