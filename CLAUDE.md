# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Keep this file up to date. Whenever you make changes that affect architecture, networking, physics, module APIs, or other details documented below, update the relevant sections of this file as part of the same task.

## Development Commands

- **Node/npm path:** `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` (Homebrew install — `npm`/`node` are NOT on the default shell PATH in this environment, so always use full paths)
- **Start server:** `/opt/homebrew/bin/node server.js` (serves on `http://0.0.0.0:3000`)
- **Install dependencies:** `/opt/homebrew/bin/npm install` (express, socket.io)
- **No build step, linter, or test suite** — vanilla JS loaded directly via `<script>` tags in index.html

## Architecture

Browser-based 3D first-person paintball game using **Three.js** (r128, loaded via CDN) with three modes: single-player vs AI, 2-player LAN multiplayer via **Socket.IO**, and a Training Range for target practice.

### Module System

All JS files use IIFEs `(function() { ... })()` for scope isolation. Public APIs are exposed on `window.*` (e.g., `window.startPaintballGame`, `window.hostLanGame`, `window.getInputState`). Cross-module communication happens entirely through these window globals. Script load order in index.html matters — `game.js` loads last and bootstraps everything.

### Shared Globals

`game.js` creates the Three.js `scene`, `camera`, and `renderer` as bare globals. Every other module reads/writes these directly. The camera position doubles as the local player's world position — there is no separate player entity for the local player in single-player mode.

## File Structure

### Core Systems (no game-mode dependencies)

| File | Purpose |
|------|---------|
| `config.js` | Cross-system shared constants: `ROUND_BANNER_MS`, `COUNTDOWN_SECONDS`, `HERO_SELECT_SECONDS`. Frozen `GAME_CONFIG` on window. Consumed by roundFlow.js and heroSelectUI.js. |
| `weapon.js` | `Weapon` class — holds static stats (cooldownMs, magSize, reloadTimeSec, damage, spreadRad, sprintSpreadRad, maxRange, pellets, projectileSpeed, projectileGravity, splashRadius) and per-instance mutable state (ammo, reloading, reloadEnd, lastShotTime). Also holds scope config, modelType (key for weaponModels.js), crosshair config, tracerColor, and abilities array. `Weapon.reset()` restores mutable state for round resets. |
| `weaponModels.js` | 3D weapon model builders. `WEAPON_MODEL_REGISTRY` maps model type keys ('rifle', 'shotgun', 'default') to builder functions that return `THREE.Group`. Called by `buildWeaponModel(modelType)`. **TODO:** Add more weapon models as heroes are added. |
| `physics.js` | 3D movement engine. Constants: GROUND_Y, GRAVITY, JUMP_VELOCITY, EYE_HEIGHT, MAX_STEP_HEIGHT. `updateFullPhysics(state, input, arena, dt)` handles the full cycle: horizontal movement, ground detection via `getGroundHeight` (downward raycast against `arena.solids`), jump/gravity, ground snapping, 2D AABB collision resolution, recheck. Supports per-hero jump velocity via `state._jumpVelocity`. |
| `crosshair.js` | Crosshair rendering and control. Supports multiple styles: 'cross' (4-bar, default) and 'circle' (ring + center dot, for spread weapons). `ensureCrosshair()`, `setCrosshairSpread(px)`, `setCrosshairDimmed(dim)`, `setCrosshairStyle(style, color)`, `sharedSetCrosshairBySprint(sprinting, baseSpreadRad, sprintSpreadRad)`. Converts weapon spread radians to screen pixels using FOV. Style/color set via CSS variables `--ch-color` and `--spread`. |
| `hud.js` | Shared HUD management. Weapon state machine: `sharedHandleReload`, `sharedStartReload`, `sharedCanShoot`. HUD updates: `sharedSetReloadingUI`, `sharedSetSprintUI`, `sharedUpdateHealthBar`, `sharedUpdateAmmoDisplay`. Works with any Weapon instance. |
| `roundFlow.js` | Round and match flow management. `sharedShowRoundBanner(text, durationMs)` and `sharedStartRoundCountdown(cb)` for 3-2-1-GO sequence. Uses `GAME_CONFIG` for timing. |
| `heroes.js` | Hero registry and hero-to-player application. `HEROES` array (frozen) with expanded hero definitions: id, name, maxHealth, walkSpeed, sprintSpeed, jumpVelocity, hitbox {width, height, depth}, modelType, color, full weapon config, passives[], abilities[]. `applyHeroToPlayer(player, heroId)` sets weapon, stats, color, swaps weapon model, and for camera-attached players also updates crosshair style/color and first-person weapon viewmodel. Current heroes: Marksman (hitscan rifle, 100hp, cross crosshair), Brawler (8-pellet shotgun, 120hp, circle crosshair). **TODO:** Add more heroes, per-hero visual models, per-hero hitbox shapes. |
| `abilities.js` | Ability system runtime. `AbilityManager` class with `hasPassive()`, `getCooldownPercent()`, `isReady()`, `update(dt)`, `reset()`. Cooldown tracking and passive lookup are implemented; activation via input and effect callbacks are still TODO. Hero abilities (dash, double jump) go on the hero; weapon abilities (scope) go on the weapon. |
| `heroSelectUI.js` | Hero selection overlay UI. Builds card-based overlay from `window.HEROES`, handles pre-round timed selection for competitive modes and untimed 'H' key toggle for training. Exports: `showPreRoundHeroSelect(opts)`, `closePreRoundHeroSelect()`, `showHeroSelectWaiting()`, `openHeroSelect()`, `closeHeroSelect()`, `isHeroSelectOpen()`, `getCurrentHeroId()`, `_heroSelectOpen`. Uses `GAME_CONFIG.HERO_SELECT_SECONDS` for timer. |

### Input, UI, Environment

| File | Purpose |
|------|---------|
| `menuNavigation.js` | Menu navigation and settings. DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. `setHUDVisible(visible)` toggles HUD. `bindUI()` wires menu buttons to mode start functions. Persists sensitivity and FOV to localStorage. |
| `input.js` | Keyboard/mouse input handling and pointer lock. Captures WASD, mouse look, sprint, reload, jump, fire. Exports: `getInputState()` (window), `bindPlayerControls()` and `resetCameraToDefaults()` (bare globals). **TODO:** Ability keybind support, ADS (right-click) input. |
| `environment.js` | Scene setup — lights, sky background, fog, large grass ground plane. `setupEnvironment()` (bare global) called once by game.js at boot. |

### Player and Arenas

| File | Purpose |
|------|---------|
| `player.js` | Unified `Player` class used by all modes. Holds position/physics state, health, weapon, 3D mesh, 3D health bar, and sphere hitbox. Compatible with `updateFullPhysics()` (same property shape). Features a **weapon attachment point** system — `_weaponAttachPoint` is a `THREE.Group` for swappable weapon models via `swapWeaponModel(modelType)`. Body meshes tagged with `userData.isBodyPart = true` for hero recoloring. `_jumpVelocity` is overridable per hero. **TODO:** Per-hero visual models, box/segment hitboxes instead of sphere. |
| `arenaBuilder.js` | Shared arena construction helpers. `arenaAddSolidBox()`, `arenaAddFloor()`, `arenaAddPerimeterWalls()`, `arenaAddTrees()`. Shared tree materials in `ARENA_TREE_MATERIALS`. Uses `GROUND_Y` from physics.js. |
| `arenaCompetitive.js` | Competitive arena layout. `buildPaintballArenaSymmetric()` returns `{group, colliders, solids, waypoints, spawns: {A, B}}`. Z-symmetric cover placement, AI waypoint graph (25-point), gold spawn rings, and scenery trees. Uses `arenaBuilder.js` helpers. |
| `arenaTraining.js` | Training range arena. `buildTrainingRangeArena()` returns `{group, colliders, solids, spawns, targetPositions, botPatrolPaths}`. 80x100m arena with 3 shooting lanes (targets at 15/25/35m), open field with cover, and bot patrol routes. Uses `arenaBuilder.js` helpers. |
| `mapFormat.js` | Map data serialization and arena construction from JSON map data. Exports: `buildArenaFromMap(mapData)`, `getDefaultMapData()`, `saveMapToServer(name, mapData)`, `deleteMapFromServer(name)`, `fetchMapList()`, `fetchMapData(name)`, `recalcNextMirrorPairId(mapData)`, `computeColliderForMesh(mesh)`. Server API-based (not localStorage). |
| `mapEditor.js` | Visual map editor. Fly camera, place/select/move/resize/delete primitives (box, cylinder, half-cylinder, ramp), Z-mirror toggle, undo/redo, save/load, player-mode preview. Toggled via dev console or menu. |

### Combat and AI

| File | Purpose |
|------|---------|
| `projectiles.js` | Unified weapon firing. `sharedFireWeapon(weapon, origin, baseDir, opts)` handles pellet loop, spread, multi-target sphere raycasting, tracer spawning, ammo management. Mode-specific behavior via `onHit` and `onPelletFired` callbacks. Low-level `fireHitscan` also available. **TODO:** Projectile-speed weapons (non-hitscan) — when `weapon.projectileSpeed` is set, spawn a moving projectile entity instead of instant raycast. Splash damage when `weapon.splashRadius > 0`. |
| `aiOpponent.js` | AI opponent for single-player mode. 7-state state machine (SPAWN_RUSH, PATROL, ENGAGE, SEEK_COVER, HOLD_COVER, FLANK, STUCK_RECOVER) with 3 playstyles (aggressive, defensive, balanced). A* pathfinding on waypoint graph, cover scoring, layered strafing, stuck detection. Difficulty via aim error and reaction time. |
| `trainingBot.js` | Simple patrol bots for training range. Non-combatant, ping-pong along multi-waypoint patrol paths at walking speed, 3s respawn on death. Uses Player composition. **TODO:** Bot difficulty variants, visual variants, non-linear patrol paths. |

### Game Modes

| File | Purpose |
|------|---------|
| `modeAI.js` | Single-player vs AI game mode. Game loop via `requestAnimationFrame`, round flow, shooting, hero selection phase. Exports: `window.paintballActive`, `startPaintballGame`, `stopPaintballInternal`, `getPaintballState`, `endPaintballRound`. |
| `modeLAN.js` | LAN multiplayer mode. Host-authoritative — host runs physics for both players, broadcasts snapshots at ~30Hz. Client sends raw input, runs client-side prediction, reconciles via lerp. Hero selection coordinated between host and client. Exports: `window.multiplayerActive`, `hostLanGame`, `joinLanGame`, `stopMultiplayerInternal`, `getMultiplayerState`. |
| `modeTraining.js` | Training range mode. Free-practice with static targets and patrol bots. No rounds — train indefinitely until ESC. Hero switching via 'H' key. Exports: `window.trainingRangeActive`, `startTrainingRange`, `stopTrainingRangeInternal`, `switchTrainingHero`. |

### Bootstrap and Dev Tools

| File | Purpose |
|------|---------|
| `game.js` | Application bootstrap. Creates Three.js `scene`, `camera`, `renderer` as bare globals. Camera is added to scene so children render. Runs the master render loop. Manages first-person weapon viewmodel (camera-attached): `setFirstPersonWeapon(modelType)`, `clearFirstPersonWeapon()`. Viewmodel uses `depthTest:false` to render on top. |
| `devConsole.js` | Password-protected developer console. God mode, unlimited ammo, spectator camera, kill enemy, heal player, hitbox visualization, AI state display, map editor access. Toggle with 'C' key. |
| `server.js` | Node.js/Express + Socket.IO relay server. Serves static files, manages rooms (2 players per room), stores per-room settings (rounds to win), forwards messages. No game logic. Also serves map save/load/delete API endpoints. |

### Other Files

| File | Purpose |
|------|---------|
| `index.html` | Single HTML page with all DOM elements (menus, HUD, map editor UI, hero select overlay, dev console) and script tags in dependency order. |
| `style.css` | All CSS for menus, HUD, map editor, hero select overlay, dev console, and game UI. |

## Script Load Order

Scripts load in this order in index.html (dependencies flow top-to-bottom):

```
Three.js (CDN) → Socket.IO (CDN) →
config.js → weapon.js → weaponModels.js → physics.js → crosshair.js →
hud.js → roundFlow.js → heroes.js → abilities.js → heroSelectUI.js →
menuNavigation.js → input.js → environment.js →
player.js → arenaBuilder.js → arenaCompetitive.js → arenaTraining.js →
mapFormat.js → mapEditor.js →
projectiles.js → aiOpponent.js → trainingBot.js →
modeAI.js → modeLAN.js → modeTraining.js →
game.js → devConsole.js
```

## Hero System

Heroes define a character's complete profile: health, movement speeds, jump velocity, hitbox dimensions, visual model, color, weapon config, passive abilities, and active abilities.

### Current Heroes

- **Marksman** (id: `marksman`): 100 HP, 4.5/8.5 walk/sprint speed. Hitscan rifle with scope (35 FOV zoom, 0.15x spread multiplier when scoped). 6-round mag, 166ms cooldown, 20 damage.
- **Brawler** (id: `brawler`): 120 HP, 4.2/8.0 walk/sprint speed. 8-pellet shotgun with iron sights (55 FOV zoom). 4-round mag, 600ms cooldown, 8 damage per pellet, 0.06 base spread.

### Hero Application Flow

`applyHeroToPlayer(player, heroId)` from `heroes.js` is the single entry point for applying a hero to any Player instance. It sets: weapon (new Weapon with hero config), maxHealth, health, walkSpeed, sprintSpeed, _jumpVelocity, mesh color, and weapon model.

### Future Hero Design

- **Hitboxes:** Currently spheres. Plan to move to box hitboxes (`{width, height, depth}` in hero config) and eventually segment-based hitboxes (head/torso/legs with different damage multipliers).
- **Visual models:** Currently all players use the same head+torso mesh. Each hero should have a unique geometric model (different shapes, proportions).
- **Abilities:** Hero abilities (dash, double jump, wall-climb) go on the hero via `abilities[]`. Weapon abilities (scope/ADS, alt-fire) go on the weapon. AbilityManager will handle cooldowns and activation.
- **Scope/ADS:** Per-weapon scope config with different zoom levels and overlay designs. Right-click to ADS (not yet wired to input).
- **Projectile weapons:** `weapon.projectileSpeed` (null = hitscan, number = projectile speed m/s). `weapon.projectileGravity` (0 = straight line). Projectile entity system needs to be built in `projectiles.js`.
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

**Mutable state (reset each round):**
- `ammo`, `reloading`, `reloadEnd`, `lastShotTime`

## Physics & Combat

Movement is full 3D — horizontal XZ walking plus vertical gravity, jumping, and ramp traversal. `updateFullPhysics` handles the complete cycle: horizontal movement → ground detection via `getGroundHeight` (downward raycast against `arena.solids`) → jump/gravity → ground snapping → 2D collision resolution → recheck.

- Gravity constant is in `physics.js` (`GRAVITY = 20`), NOT in config.js.
- Per-hero jump velocity is supported via `state._jumpVelocity` (defaults to `JUMP_VELOCITY` from physics.js).
- Collision uses Y-aware AABB push-out against `arena.colliders` (Box3 array); colliders are skipped when the player stands on top of them (`feetY + 0.1 >= box.max.y`).
- Ramp colliders use a staircase approximation (multiple progressively shorter AABBs) so the Y-skip logic lets players ascend slopes while still blocking side entry.
- `arena.solids` (Mesh array) = ground-height raycasting, bullet raycasting, AI line-of-sight.
- `arena.colliders` (Box3 array) = movement collision.

**Combat** is currently hitscan with configurable spread cone. Player hitboxes are spheres for raycasting. `sharedFireWeapon()` in `projectiles.js` is the single entry point for all weapon firing across all modes.

## Networking Protocol (Socket.IO events)

`createRoom`/`joinRoom` → room lifecycle. `input` → client sends to host each frame. `snapshot` → host broadcasts state at ~30Hz. `shot` → host relays tracer visuals. `startRound`/`roundResult`/`matchOver` → round lifecycle. `startHeroSelect` (host→client) / `heroSelect` (bidirectional) / `heroesConfirmed` (host→client) → pre-round hero selection. All payloads are plain objects with arrays for positions `[x,y,z]`.

## UI Flow

Menu navigation is in `menuNavigation.js`. Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. HUD elements (health bar, ammo, reload indicator, sprint indicator, crosshair) are managed by `hud.js` and `crosshair.js`, shared between all game modes. Settings (sensitivity, FOV) persist in localStorage.
