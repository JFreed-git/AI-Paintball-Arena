# Heroes and Combat Reference

Consult this doc when working on: hero definitions, hitbox segments, body parts, weapon stats, projectile/hitscan firing, damage multipliers, hero selection, the ability system, or the mana system.

## Hero System

Heroes define a character's complete profile: health, movement speeds, jump velocity, segmented hitbox, visual model, color, weapon config, passive abilities, active abilities, and optional mana.

### Current Heroes

| Hero | ID | HP | Speed (walk/sprint) | Weapon | Key Features |
|------|----|----|---------------------|--------|-------------|
| **Marksman** | `marksman` | 100 | 4.5/8.5 | Rifle (scope, 6-round mag, 166ms cooldown, 20 dmg) | Scope (35 FOV, 0.15x spread), Overdrive ability (unlimited ammo) |
| **Brawler** | `brawler` | 120 | 4.2/8.0 | Shotgun (8 pellets, 4-round mag, 600ms cooldown, 8 dmg/pellet) | Iron sights (55 FOV), Grapple Hook ability |
| **Mage** | `mage` | 90 | 4.5/8.5 | Auto-projectile (infinite ammo, 100ms cooldown, 8 dmg, 1 mana/shot) | Mana system (100 max, 2/sec regen), Teleport, Piercing Blast, Meditate |
| **Slicer** | `slicer` | — | — | — | Dash ability |
| **Sniper** | `sniper` | — | — | — | Custom hero (JSON in `heroes/`) |
| **Gunner** | `gunner` | — | — | — | Custom hero (JSON in `heroes/`) |

Hero JSON files live in `heroes/`. Built-in heroes (marksman, brawler) are seeded by `server.js` on startup if not present. All heroes can be edited via the dev workbench hero editor.

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
- Segments are repositioned each frame in `Player._updateHitboxes()`: reads yaw from `_hitboxYaw` (the player's own look direction, **independent** of `_meshGroup.rotation.y`), rotates `(offsetX, offsetZ)` by yaw, updates center Vector3 for all shapes, and stores yaw on box segments for OBB intersection. `_hitboxYaw` is set by each game mode from the player's camera direction (for human players) or by `faceToward()` (for AI/bots).
- `Player.getHitSegments()` returns the positioned segments for collision — `testHitSegments()` in `projectiles.js` dispatches by `seg.shape` to the appropriate ray intersection function
- `Player.getHitTarget()` returns a backward-compat bounding sphere enclosing all segments
- Ray intersection functions: `rayHitsSphereDetailed()`, `rayHitsCylinder()`, `rayHitsCapsule()`, `rayHitsOBB()` in `projectiles.js`
- `buildCapsuleGeometry(radius, totalHeight, radialSegs, heightSegs)` in `player.js` — Three.js r128 has no CapsuleGeometry, so this uses `LatheGeometry`
- The hero editor provides interactive 3D hitbox editing with shape-specific resize handles
- Dev console hitbox visualization shows color-coded wireframe shapes per segment

### Projectile System

All weapons use visible traveling projectiles (`projectileSpeed: 120` m/s by default). The system lives in `projectiles.js`:

- `sharedFireWeapon()` checks `weapon.projectileSpeed`: if > 0, spawns projectile entities; if 0/null, uses instant hitscan
- `spawnProjectile(opts)` creates a live projectile with position, velocity, gravity, damage, and target references
- `updateProjectiles(dt)` advances all projectiles each frame: applies gravity, ray-tests against solids (wall collision) and target segments (hit test), calls `onHit` with `damageMultiplier`
- `clearAllProjectiles()` removes all on round/mode end
- Each game mode calls `updateProjectiles(dt)` in its tick function

**Lock-on projectile tracking:** The weapon config can include a `lockOn` object:

```js
weapon.lockOn = {
  coneAngle: 15,      // half-angle in degrees for target acquisition
  maxRange: 50,       // max lock-on range
  turnRate: 3.0       // how fast projectile turns toward target (radians/sec)
}
```

When present, `sharedFireWeapon()` finds the nearest enemy within the cone at fire time and stores `lockOnTarget` on the projectile. `updateProjectiles()` slerp-blends the projectile's velocity toward the target each frame.

**LAN networking:** host sends `{o, d, c, s, g}` (origin, direction, color, speed, gravity) for projectile shots; client spawns visual-only projectiles. Legacy hitscan format `{o, e, c}` still supported.

### Melee System

Every weapon has per-weapon melee stats. Press `V` to melee attack. Melee performs an instant forward raycast from eye position up to `meleeRange`, tested against target hit segments using the same `testHitSegments()` as projectile/hitscan. The weapon swings forward visually (both first-person and third-person), and the player cannot fire during the swing animation.

**Weapon melee fields:**
- `meleeDamage` (30) — base melee damage
- `meleeRange` (2.5) — max melee reach in meters
- `meleeCooldownMs` (600) — time between melee attacks
- `meleeSwingMs` (350) — swing animation duration (also blocks firing)
- `meleeUseHitMultiplier` (true) — whether segment damage multipliers apply

**First-person melee animation** (`triggerFPMeleeSwing` in `game.js`): 8-keyframe hermite-interpolated animation with distinct wind-up, strike, and recovery phases.

**AI melee:** The AI opponent checks melee range in `_tryShoot()` and melees instead of shooting when within range.

**LAN networking:** Host performs hit detection, applies damage, emits `'melee'` event `{playerId, swingMs}` so the client plays the third-person swing animation.

### Scope / ADS

Per-weapon scope config is fully implemented. Right-click to ADS (unless the hero has an ability bound to `secondaryDown`, e.g., Mage's Piercing Blast). See [`docs/input-and-ui.md`](input-and-ui.md) for details on the crosshair/ADS system.

## Ability System (`abilities.js`)

### AbilityManager

Every `Player` instance has an `AbilityManager` (`player.abilityManager`). It handles:

- **Registration**: `registerPassive(def)`, `registerAbility(def)` — called by `applyHeroToPlayer()`
- **Activation**: `activate(abilityId)` — checks cooldown, dispatches `onActivate` callback, starts cooldown + duration tracking
- **Update**: `update(dt)` — ticks cooldowns, ticks active effects (`onTick`), handles `onEnd` on expiry, mana regen
- **Queries**: `isReady(id)`, `isActive(id)`, `getCooldownPercent(id)`, `hasPassive(id)`
- **HUD**: `getHUDState()` → `[{id, name, key, cooldownPct, isActive, isReady}]`
- **Lifecycle**: `reset()` (between rounds), `clearAbilities()` (hero switch — calls `onEnd` for all active effects)

### Effect Registry

Effects are registered statically at module load time via `AbilityManager.registerEffect(abilityId, callbacks)`. The callbacks are shared across all AbilityManager instances:

```js
AbilityManager.registerEffect('dash', {
  onActivate(player, params) { ... },  // return false to abort activation
  onTick(player, params, dt) { ... },  // called every frame while active
  onEnd(player, params) { ... }        // called when duration expires or force-ended
});
```

### Registered Effects

| Effect ID | Hero | Key | Description |
|-----------|------|-----|-------------|
| `dash` | Slicer | Q | Burst of velocity in look direction for 200ms. `params.speed` (default 30). |
| `grappleHook` | Brawler | Q | Fires a hook; pulls nearest enemy in aim cone toward caster. Green chain visual. Wall collision resolved on pulled target. `params: { maxRange, pullSpeed }`. |
| `unlimitedAmmo` | Marksman | Q | "Overdrive" — weapon stops consuming ammo for the duration. Ammo kept at magSize each tick. |
| `teleport` | Mage | Q | Two-phase: Q shows translucent ghost at cursor-targeted destination (updates each frame). Left-click or Q again to confirm and blink. Right-click cancels (no mana cost, clears cooldown). 3D raycast targeting: top surfaces → place on top; side surfaces → upper half on top, lower half beside on ground; no hit → horizontal max-range projection. `params: { maxRange, manaCost, snapTolerance }`. |
| `piercingBlast` | Mage | RMB | Hold right-click to charge (drains mana at `manaDrainRate` per sec). Release to fire hitscan beam. Damage = `manaSpent * damagePerMana`. Cooldown starts after firing (`postFireCooldownMs`). Purple charge sphere visual + screen edge tint. `params: { manaDrainRate, damagePerMana, maxChargeMs, beamRange, postFireCooldownMs }`. |
| `meditate` | Mage | E | Channel for duration. Freezes player (game mode handles). Restores mana gradually (`manaRestoreAmount` over `duration`). Interrupted by damage. Blue ring + light column visual. `params: { manaRestoreAmount, interruptOnDamage }`. |

### Mana System

Heroes can define a `mana` config in their JSON:

```json
"mana": { "maxMana": 100, "regenRate": 2, "regenDelay": 2000 }
```

`applyHeroToPlayer()` calls `abilityManager.initMana(manaConfig)` to initialize. The mana system provides:

```js
abilityManager.hasMana()       // true if hero uses mana
abilityManager.getMana()       // current mana
abilityManager.getMaxMana()    // max mana
abilityManager.consumeMana(n)  // deduct n mana (returns false if insufficient); resets regen timer
abilityManager.addMana(n)      // add mana (capped at max)
abilityManager.resetManaRegenDelay() // restart regen delay timer
```

Mana regens passively at `regenRate` per second, but only after `regenDelay` ms since last consumption. The mana bar HUD is updated via `window.updateManaHUD(mana, maxMana)`.

**Mana-per-shot:** Weapons with `manaCostPerShot > 0` (e.g., Mage's weapon costs 1 mana per shot) have mana checked and consumed by the game mode before firing. This replaces normal ammo for infinite-ammo weapons (`magSize: 0`).

### Hero Ability Config (JSON)

Abilities are defined in the hero JSON under `abilities[]` and `passives[]`:

```json
{
  "passives": [{ "id": "manaRegen" }],
  "abilities": [
    {
      "id": "teleport",
      "name": "Teleport",
      "key": "ability1",
      "cooldownMs": 15000,
      "duration": 60000,
      "params": { "maxRange": 25, "manaCost": 75 }
    }
  ]
}
```

- `key` maps to input actions: `ability1` (Q), `ability2` (E), `ability3` (F), `ability4` (C), `secondaryDown` (RMB)
- `duration` controls how long the effect stays active (0 or absent = instant, no `onTick`/`onEnd`)
- `params` is passed through to effect callbacks

## Weapon System

`weapon.js` defines the `Weapon` class with these fields:

**Static stats (set at construction):**
- `cooldownMs` (166) — min time between shots
- `magSize` (6) — magazine capacity (0 = infinite ammo, no reload)
- `reloadTimeSec` (2.5) — reload duration
- `damage` (20) — per-pellet damage
- `spreadRad` (0) — base spread cone radius
- `sprintSpreadRad` (0.012) — spread while sprinting
- `maxRange` (200) — max effective range
- `pellets` (1) — pellets per shot (shotgun = 8)
- `projectileSpeed` (null) — null = hitscan, number = projectile m/s
- `projectileGravity` (0) — projectile drop rate
- `splashRadius` (0) — 0 = no splash
- `manaCostPerShot` (0) — mana consumed per shot (0 = no mana cost)
- `lockOn` (null) — lock-on config `{ coneAngle, maxRange, turnRate }` or null
- `scope` ({type, zoomFOV, overlay, spreadMultiplier}) — ADS config
- `modelType` ('default') — key into weaponModels.js
- `crosshair` ({style, baseSpreadPx, sprintSpreadPx, color}) — crosshair appearance
- `tracerColor` (0xffff00) — tracer visual color
- `abilities` ([]) — weapon-specific abilities
- `fpOffset` ({x, y, z}) — first-person weapon position offset
- `fpRotation` ({x, y, z}) — first-person weapon rotation
- `meleeDamage` (30), `meleeRange` (2.5), `meleeCooldownMs` (600), `meleeSwingMs` (350), `meleeUseHitMultiplier` (true) — melee stats

**Mutable state (reset each round):**
- `ammo`, `reloading`, `reloadEnd`, `lastShotTime`, `lastMeleeTime`

### Hero Application Flow

`applyHeroToPlayer(player, heroId)` from `heroes.js` is the single entry point. It sets: weapon, maxHealth, health, walkSpeed, sprintSpeed, _jumpVelocity, mesh color, weapon model, hitbox segments, bodyParts, abilities (via abilityManager), and mana (via `abilityManager.initMana()`). For camera-attached players, also passes `fpOffset`/`fpRotation` to `setFirstPersonWeapon()`.

### Body Parts System

Each hero can optionally define a `bodyParts` array for custom 3D visual models. When present, `player.js` uses `_buildMeshFromBodyParts()` instead of the hardcoded head+torso mesh.

```js
bodyParts: [
  { name: "head", shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 1.6, offsetZ: 0,
    rotationX: 0, rotationY: 0, rotationZ: 0, color: null }
]
```

**Supported shapes:** box (width/height/depth), sphere (radius), cylinder (radius/height), capsule (radius/height).

**Fields per part:** name, shape, shape-specific dimensions, offsetX/offsetY/offsetZ, rotationX/rotationY/rotationZ, color (hex string or null → hero color), `linkedTo` (optional reference to hitbox segment name).

## Key Files

| File | Role |
|------|------|
| `weapon.js` | `Weapon` class — static stats + mutable state, `reset()` for round resets |
| `weaponModels.js` | `WEAPON_MODEL_REGISTRY` maps model type keys to builder functions |
| `heroes.js` | Hero registry, `applyHeroToPlayer()`, `loadHeroesFromServer()`, `getHeroById()` |
| `abilities.js` | `AbilityManager` — effect registry, cooldowns, activation, mana system, 6 registered effects |
| `heroSelectUI.js` | Card-based hero selection overlay |
| `player.js` | `Player` class — segmented hitbox, body parts mesh, weapon attachment, AbilityManager |
| `projectiles.js` | `sharedFireWeapon()`, `sharedMeleeAttack()`, projectile/updating, lock-on tracking, ray intersection |
| `crosshair.js` | Crosshair styles, spread, scope/ADS system |
| `hud.js` | HUD updates, ability icon registry, mana bar |
