# Heroes and Combat Reference

Consult this doc when working on: hero definitions, hitbox segments, body parts, weapon stats, projectile/hitscan firing, damage multipliers, hero selection, or the ability system.

## Hero System

Heroes define a character's complete profile: health, movement speeds, jump velocity, segmented hitbox, visual model, color, weapon config, passive abilities, and active abilities.

### Hitbox System

Each hero defines an array of named hitbox segments with a `shape` field:

```js
hitbox: [
  { name: "head",  shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
  { name: "torso", shape: "box", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
  { name: "legs",  shape: "capsule", radius: 0.25, height: 1.1, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
]
```

**Supported shapes and their dimension fields:**

| Shape | Fields | Notes |
|-------|--------|-------|
| `box` (default) | width, height, depth | OBB (oriented bounding box). Rotates with the player's yaw. Segments without a `shape` field default to box for backward compat. |
| `sphere` | radius | Single radius, centered at offset position |
| `cylinder` | radius, height | Y-axis aligned finite cylinder with flat caps |
| `capsule` | radius, height | Y-axis aligned, height includes hemispherical caps. Enforces `height >= 2*radius`. |

**Common fields (all shapes):** name, shape, offsetX, offsetY, offsetZ, damageMultiplier.

- `offsetX`, `offsetY`, `offsetZ` position the segment center relative to the player's feet position (offsetX/offsetZ default to 0 for backward compat). Offsets are **rotated by the player's yaw** so off-center hitboxes follow the player's facing direction.
- `damageMultiplier` scales damage on hit (2.0 = headshot double damage)
- Segments are repositioned each frame in `Player._updateHitboxes()`: reads yaw from `_hitboxYaw` (the player's own look direction, **independent** of `_meshGroup.rotation.y`), rotates `(offsetX, offsetZ)` by yaw, updates center Vector3 for all shapes, and stores yaw on box segments for OBB intersection. `_hitboxYaw` is set by each game mode from the player's camera direction (for human players) or by `faceToward()` (for AI/bots). This separation ensures hitboxes follow where the player is looking, not where their visual model faces for aesthetics.
- `Player.getHitSegments()` returns the positioned segments for collision — `testHitSegments()` in `projectiles.js` dispatches by `seg.shape` to the appropriate ray intersection function
- `Player.getHitTarget()` returns a backward-compat bounding sphere enclosing all segments (computes AABB of rotated OBBs for box shapes)
- Ray intersection functions: `rayHitsSphereDetailed()`, `rayHitsCylinder()`, `rayHitsCapsule()`, `rayHitsOBB()` in `projectiles.js`. `rayHitsOBB()` transforms the ray into the box's local space (rotate by -yaw) then uses the standard slab method.
- `buildCapsuleGeometry(radius, totalHeight, radialSegs, heightSegs)` in `player.js` — Three.js r128 has no CapsuleGeometry, so this uses `LatheGeometry` with a hemisphere+sides profile. Exposed on `window` for use by devHeroEditor.js and devConsole.js.
- The hero editor provides interactive 3D hitbox editing: shape dropdown per segment (box/sphere/cylinder/capsule) with conditional form fields, click to select, drag to move in 3D, shape-specific resize handles (box: 6 handles, sphere: 4, cylinder/capsule: 4), toggle model visibility to inspect hitboxes clearly
- Dev console hitbox visualization shows color-coded wireframe shapes per segment (geometry matched to actual shape/dimensions)

### Projectile System

All weapons use visible traveling projectiles (`projectileSpeed: 120` m/s by default). The system lives in `projectiles.js`:

- `sharedFireWeapon()` checks `weapon.projectileSpeed`: if > 0, spawns projectile entities; if 0/null, uses instant hitscan
- `spawnProjectile(opts)` creates a live projectile with position, velocity, gravity, damage, and target references
- `updateProjectiles(dt)` advances all projectiles each frame: applies gravity, ray-tests against solids (wall collision) and target segments (AABB hit test), calls `onHit` with `damageMultiplier`
- `clearAllProjectiles()` removes all on round/mode end
- Each game mode calls `updateProjectiles(dt)` in its tick function
- LAN networking: host sends `{o, d, c, s, g}` (origin, direction, color, speed, gravity) for projectile shots; client spawns visual-only projectiles. Legacy hitscan format `{o, e, c}` still supported.

### Current Heroes

- **Marksman** (id: `marksman`): 100 HP, 4.5/8.5 walk/sprint speed. Rifle with scope (35 FOV zoom, 0.15x spread multiplier when scoped). 6-round mag, 166ms cooldown, 20 damage, 120 m/s projectile speed. Hitbox: head (2x), torso (1x), legs (0.75x).
- **Brawler** (id: `brawler`): 120 HP, 4.2/8.0 walk/sprint speed. 8-pellet shotgun with iron sights (55 FOV zoom). 4-round mag, 600ms cooldown, 13 damage per pellet, 0.06 base spread, 120 m/s projectile speed. Slightly wider hitbox segments.

### Hero Application Flow

`applyHeroToPlayer(player, heroId)` from `heroes.js` is the single entry point for applying a hero to any Player instance. It sets: weapon (new Weapon with hero config), maxHealth, health, walkSpeed, sprintSpeed, _jumpVelocity, mesh color, weapon model, hitbox segments (via `setHitboxConfig`), and bodyParts. For camera-attached players, also passes `fpOffset`/`fpRotation` to `setFirstPersonWeapon()`.

### Body Parts System

Each hero can optionally define a `bodyParts` array for custom 3D visual models. When present, `player.js` uses `_buildMeshFromBodyParts()` instead of the hardcoded head+torso mesh.

```js
bodyParts: [
  { name: "head", shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 1.6, offsetZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0, color: null },
  { name: "torso", shape: "cylinder", radius: 0.275, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0, color: null }
]
```

**Supported shapes:** box (width/height/depth), sphere (radius), cylinder (radius/height), capsule (radius/height) — same shapes as hitbox segments.

**Fields per part:** name, shape, shape-specific dimensions, offsetX/offsetY/offsetZ (relative to mesh origin), rotationX/rotationY/rotationZ (Euler angles), color (hex string or null → falls back to hero color).

- Heroes without `bodyParts` or with an empty array fall back to the default head+torso mesh
- Built-in Marksman and Brawler both define `bodyParts` that replicate their default appearance
- The dev workbench hero editor provides interactive body part editing in "Visual" view mode

### Future Hero Design

- **Abilities:** Hero abilities (dash, double jump, wall-climb) go on the hero via `abilities[]`. Weapon abilities (scope/ADS, alt-fire) go on the weapon. AbilityManager will handle cooldowns and activation.
- **Scope/ADS:** Per-weapon scope config with different zoom levels and overlay designs. Right-click to ADS (not yet wired to input).
- **Splash damage:** `weapon.splashRadius` (0 = single-target). Area damage system TBD.

## Weapon System

`weapon.js` defines the `Weapon` class with these fields:

**Static stats (set at construction):**
- `cooldownMs` (166) — min time between shots
- `magSize` (6) — magazine capacity
- `reloadTimeSec` (2.5) — reload duration
- `damage` (20) — per-pellet damage
- `spreadRad` (0) — base spread cone radius
- `sprintSpreadRad` (0.012) — spread while sprinting
- `maxRange` (200) — max effective range
- `pellets` (1) — pellets per shot (shotgun = 8)
- `projectileSpeed` (null) — null = hitscan, number = projectile m/s
- `projectileGravity` (0) — projectile drop rate
- `splashRadius` (0) — 0 = no splash
- `scope` ({type, zoomFOV, overlay, spreadMultiplier}) — ADS config
- `modelType` ('default') — key into weaponModels.js
- `crosshair` ({style, baseSpreadPx, sprintSpreadPx, color}) — crosshair appearance
- `tracerColor` (0xffff00) — tracer visual color
- `abilities` ([]) — weapon-specific abilities
- `fpOffset` ({x, y, z}) — optional first-person weapon position offset (default: `{0.28, -0.22, -0.45}`)
- `fpRotation` ({x, y, z}) — optional first-person weapon rotation (default: `{0.05, -0.15, 0}`)

**Mutable state (reset each round):**
- `ammo`, `reloading`, `reloadEnd`, `lastShotTime`

## Key Files

| File | Role |
|------|------|
| `weapon.js` | `Weapon` class — static stats + mutable state, `reset()` for round resets |
| `weaponModels.js` | `WEAPON_MODEL_REGISTRY` maps model type keys to builder functions returning `THREE.Group` |
| `heroes.js` | Hero registry, `applyHeroToPlayer()`, `loadHeroesFromServer()`, `getHeroById()` |
| `abilities.js` | `AbilityManager` — cooldown tracking, passive lookup; activation still TODO |
| `heroSelectUI.js` | Card-based hero selection overlay, timed for competitive, untimed for training |
| `player.js` | `Player` class — segmented hitbox, body parts mesh, weapon attachment, `rebuildMesh()` |
| `projectiles.js` | `sharedFireWeapon()`, projectile spawning/updating, ray intersection per shape type |
| `aiOpponent.js` | 7-state AI with A* pathfinding, uses segmented hitboxes for shooting |
| `crosshair.js` | Crosshair styles (cross/circle), spread rendering, sprint spread |
| `hud.js` | Shared HUD — reload state machine, health bar, ammo display |
