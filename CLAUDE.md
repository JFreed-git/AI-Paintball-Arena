# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Keep this file up to date. Whenever you make changes that affect architecture, networking, physics, module APIs, or other details documented below, update the relevant sections of this file as part of the same task.

## Development Commands

- **Node/npm path:** `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` (Homebrew install — `npm`/`node` are NOT on the default shell PATH in this environment, so always use full paths)
- **Start game server:** `/opt/homebrew/bin/node server.js` (serves on `http://0.0.0.0:3000`)
- **Start dev workbench:** `/opt/homebrew/bin/npm run dev` (launches Electron desktop app — no server needed)
- **Install dependencies:** `/opt/homebrew/bin/npm install` (express, socket.io, electron)
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
| `heroes.js` | Hero registry and hero-to-player application. `HEROES` array with built-in hero defaults (Marksman, Brawler), overridden at runtime by `loadHeroesFromServer()` which loads from `heroes/` directory. `BUILTIN_HEROES` holds the hardcoded fallbacks. `applyHeroToPlayer(player, heroId)` sets weapon, stats, color, hitbox segments (via `setHitboxConfig`), swaps weapon model, and for camera-attached players also updates crosshair style/color and first-person weapon viewmodel. `getHeroById(id)` looks up from the current `window.HEROES`. **TODO:** Add more heroes, per-hero visual models. |
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
| `player.js` | Unified `Player` class used by all modes. Holds position/physics state, health, weapon, 3D mesh, 3D health bar, and **segmented hitbox** (head/torso/legs AABB boxes with damage multipliers and offsetX/offsetY/offsetZ positioning). Compatible with `updateFullPhysics()` (same property shape). Features a **weapon attachment point** system — `_weaponAttachPoint` is a `THREE.Group` for swappable weapon models via `swapWeaponModel(modelType)`. Body meshes tagged with `userData.isBodyPart = true` for hero recoloring. `_jumpVelocity` is overridable per hero. `setHitboxConfig(config)` sets hitbox segments from hero data; `getHitSegments()` returns positioned AABB segments for collision; `getHitTarget()` returns a bounding sphere for backward compat. **TODO:** Per-hero visual models. |
| `arenaBuilder.js` | Shared arena construction helpers. `arenaAddSolidBox()`, `arenaAddFloor()`, `arenaAddPerimeterWalls()`, `arenaAddTrees()`. Shared tree materials in `ARENA_TREE_MATERIALS`. Uses `GROUND_Y` from physics.js. |
| `arenaCompetitive.js` | Competitive arena layout. `buildPaintballArenaSymmetric()` returns `{group, colliders, solids, waypoints, spawns: {A, B}}`. Z-symmetric cover placement, AI waypoint graph (25-point), gold spawn rings, and scenery trees. Uses `arenaBuilder.js` helpers. |
| `arenaTraining.js` | Training range arena. `buildTrainingRangeArena()` returns `{group, colliders, solids, spawns, targetPositions, botPatrolPaths}`. 80x100m arena with 3 shooting lanes (targets at 15/25/35m), open field with cover, and bot patrol routes. Uses `arenaBuilder.js` helpers. |
| `mapFormat.js` | Map data serialization and arena construction from JSON map data. Exports: `buildArenaFromMap(mapData)`, `getDefaultMapData()`, `normalizeSpawns(spawns)`, `saveMapToServer(name, mapData)`, `deleteMapFromServer(name)`, `fetchMapList()`, `fetchMapData(name)`, `recalcNextMirrorPairId(mapData)`, `computeColliderForMesh(mesh)`. Supports 7 shape types (box, cylinder, halfCylinder, ramp, wedge, lshape, arch) with shape-accurate colliders. Array-based spawn format with team assignment; `normalizeSpawns` converts old `{A,B}` format. `buildArenaFromMap` returns both `spawns: {A, B}` (backward compat) and `spawnsList` (full array). |
| `mapEditor.js` | Visual map editor (Electron-only). Fly camera, place/select/move/resize/rotate/delete 7 shape types via dropdown toolbar. Features: Z/X/Quad mirror modes, multi-select (Shift+click, Ctrl+A), copy/paste (Ctrl+C/V), independent color on mirror/quad clones, flexible spawn placement with team assignment, arena boundary visualization, undo/redo, save/load, player-mode preview. JS still loads in index.html (to avoid reference errors) but DOM is removed and server blocks the file. |

### Combat and AI

| File | Purpose |
|------|---------|
| `projectiles.js` | Unified weapon firing with both **hitscan** and **projectile** paths. `sharedFireWeapon(weapon, origin, baseDir, opts)` handles pellet loop, spread, ammo management. When `weapon.projectileSpeed > 0`, spawns traveling projectile entities via `spawnProjectile()`; otherwise uses instant hitscan raycast. Targets support **segmented hitboxes** (`{segments: [...]}` with AABB + damage multipliers) and legacy sphere hitboxes (`{position, radius}`). `onHit` callback receives `damageMultiplier` as 5th arg. `rayHitsAABB()` and `testHitSegments()` provide ray-AABB collision. `updateProjectiles(dt)` advances all live projectiles each frame. `clearAllProjectiles()` removes all on round/mode end. `spawnVisualProjectile()` creates damage-free projectiles for client-side LAN visuals. **TODO:** Splash damage when `weapon.splashRadius > 0`. |
| `aiOpponent.js` | AI opponent for single-player mode. 7-state state machine (SPAWN_RUSH, PATROL, ENGAGE, SEEK_COVER, HOLD_COVER, FLANK, STUCK_RECOVER) with 3 playstyles (aggressive, defensive, balanced). A* pathfinding on waypoint graph, cover scoring, layered strafing, stuck detection. Difficulty via aim error and reaction time. Applies Marksman hero on construction for proper hitbox segments and weapon. Shoots using segmented hitboxes (`ctx.playerSegments`) with damage multipliers. |
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
| `devConsole.js` | Password-protected developer console. God mode, unlimited ammo, spectator camera, kill enemy, heal player, hitbox visualization (color-coded wireframe boxes per segment: red=head, green=torso, blue=legs, yellow=custom), AI state display, map editor access. Toggle with 'C' key. |
| `server.js` | Node.js/Express + Socket.IO relay server. Serves static files, manages rooms (2 players per room), stores per-room settings (rounds to win), forwards messages. No game logic. Serves read-only REST API for maps and heroes (editing happens in the Electron dev workbench). Seeds built-in heroes to `heroes/` on startup. |

### Dev Workbench (Electron App)

Standalone **Electron desktop app** that loads the exact same game JS files — no copies, no server needed. Replaces `game.js` with dev-specific bootstrap. Includes `devConsole.js` for in-game debug tools (hitbox viz, god mode, etc.). A bug found in the dev app is the same bug in the real game. Launch with `npm run dev`.

| File | Purpose |
|------|---------|
| `electron-main.js` | Electron entry point. Creates BrowserWindow (1400x900), loads `dev.html` as a local file, sets up preload script. |
| `electron-preload.js` | Electron preload script. Exposes `window.devAPI` via `contextBridge` with filesystem CRUD methods for `heroes/`, `weapon-models/`, and `maps/` directories. Same sanitization as server.js (`a-zA-Z0-9_-`, max 50 chars). |
| `electron-fetch-shim.js` | Loaded as the first `<script>` in `dev.html`. When `window.devAPI` exists (Electron), monkey-patches `window.fetch` to intercept `/api/*` calls and route to filesystem via `devAPI`. Safe no-op when not in Electron. |
| `dev.html` | Dev workbench HTML page with sidebar layout, panel DOM, split-screen HUD elements, dev console DOM, map editor DOM (copied from index.html), and script includes. Loads all shared game JS files plus dev-specific files. |
| `devApp.css` | Sidebar layout (300px default, 450px expanded), panel styles, split-screen HUD, editor forms, weapon model builder parts UI, collapsible section styles, viewport-mode preview styles. |
| `devApp.js` | Dev workbench bootstrap. Creates `scene`/`camera`/`renderer` as bare globals (same as game.js). Sidebar navigation, panel switching with expanded layout (hero editor and WMB panels expand sidebar to 450px and move 3D preview to viewport), dropdown population, custom hero/weapon-model loading from filesystem, map editor integration, quick test mode launch, first-person weapon viewmodel management. Overrides `showOnlyMenu` to restore sidebar when game modes end. Exports: `getAllHeroes()`, `CUSTOM_HEROES`, `registerCustomWeaponModel()`, `resizeRenderer()`. |
| `devSplitScreen.js` | Split-screen two-player mode. Dual viewports via `renderer.setViewport/setScissor`. Tab key switches active player. Per-player cameras, weapon viewmodels, HUD, and crosshairs. Physics, shooting, and respawn for both players. Hides sidebar on start, restores on stop. Exports: `startSplitScreen(opts)`, `stopSplitScreen()`, `_splitScreenActive`. |
| `devHeroEditor.js` | Hero/weapon stat editor with live 3D orbit-camera preview (drag to orbit, scroll to zoom). Collapsible form sections (Weapon, Scope, Crosshair, Visual collapsed by default). Form for all hero fields (stats, weapon, scope, crosshair, visual, projectile speed/gravity). **Hitbox Segment Builder**: add/remove/edit named hitbox segments (head/torso/legs/custom) with 3D wireframe box preview color-coded by segment name. Hitbox wireframes are scene-level objects in `_hitboxGroup` (not parented to scaled player mesh). **Interactive hitbox editing**: click hitbox wireframe to select (turns semi-transparent solid), drag to move in full 3D (camera-facing plane drag, updates offsetX/Y/Z). 6 resize handles at face centers (red=X, green=Y, blue=Z spheres) for resizing width/height/depth with opposite-face anchoring. "Hide Model" button toggles player body/weapon visibility. Save/load/delete custom heroes via filesystem. Weapon Model Builder: compose models from box/cylinder parts with live orbit-camera 3D preview, register into `WEAPON_MODEL_REGISTRY`, save/load/delete via filesystem. Exports: `_initHeroEditorPreview()`, `_initWmbPreview()`, `_refreshWmbLoadList()`, `_resizeHeroEditorPreview()`, `_resizeWmbPreview()`. |

### Other Files

| File | Purpose |
|------|---------|
| `index.html` | Single HTML page with all DOM elements (menus, HUD, hero select overlay, dev console) and script tags in dependency order. Map editor DOM and script removed (Electron-only). |
| `style.css` | All CSS for menus, HUD, map editor, hero select overlay, dev console, and game UI. |

## Script Load Order

Scripts load in this order in index.html (dependencies flow top-to-bottom):

```
Three.js (CDN) → Socket.IO (CDN) →
config.js → weapon.js → weaponModels.js → physics.js → crosshair.js →
hud.js → roundFlow.js → heroes.js → abilities.js → heroSelectUI.js →
menuNavigation.js → input.js → environment.js →
player.js → arenaBuilder.js → arenaCompetitive.js → arenaTraining.js →
mapFormat.js →
projectiles.js → aiOpponent.js → trainingBot.js →
modeAI.js → modeLAN.js → modeTraining.js →
game.js → devConsole.js
```

dev.html (Electron) loads the same shared scripts but replaces game.js with dev-specific bootstrap, and swaps Socket.IO for the fetch shim:

```
Three.js (CDN) → electron-fetch-shim.js →
[same shared scripts as index.html: config.js through modeTraining.js] →
mapEditor.js →
devSplitScreen.js → devHeroEditor.js → devConsole.js → devApp.js
```

## Hero System

Heroes define a character's complete profile: health, movement speeds, jump velocity, segmented hitbox, visual model, color, weapon config, passive abilities, and active abilities.

### Hitbox System

Each hero defines an array of named hitbox segments:

```js
hitbox: [
  { name: "head",  width: 0.5, height: 0.5, depth: 0.5, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
  { name: "torso", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
  { name: "legs",  width: 0.5, height: 1.1, depth: 0.5, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
]
```

- `offsetX`, `offsetY`, `offsetZ` position the segment center relative to the player's feet position (offsetX/offsetZ default to 0 for backward compat)
- `damageMultiplier` scales damage on hit (2.0 = headshot double damage)
- Segments are AABB boxes repositioned each frame in `Player._updateHitboxes()`
- `Player.getHitSegments()` returns the positioned segments for collision
- `Player.getHitTarget()` returns a backward-compat bounding sphere enclosing all segments
- The hero editor provides interactive 3D hitbox editing: click to select, drag to move in 3D, resize handles at face centers (6 colored spheres: red=X, green=Y, blue=Z), toggle model visibility to inspect hitboxes clearly
- Dev console hitbox visualization shows color-coded wireframe boxes per segment

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

`applyHeroToPlayer(player, heroId)` from `heroes.js` is the single entry point for applying a hero to any Player instance. It sets: weapon (new Weapon with hero config), maxHealth, health, walkSpeed, sprintSpeed, _jumpVelocity, mesh color, weapon model, and hitbox segments (via `setHitboxConfig`).

### Future Hero Design

- **Visual models:** Currently all players use the same head+torso mesh. Each hero should have a unique geometric model (different shapes, proportions).
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

**Mutable state (reset each round):**
- `ammo`, `reloading`, `reloadEnd`, `lastShotTime`

## Physics & Combat

Movement is full 3D — horizontal XZ walking plus vertical gravity, jumping, and ramp traversal. `updateFullPhysics` handles the complete cycle: horizontal movement → ground detection via `getGroundHeight` (downward raycast against `arena.solids`) → jump/gravity → ground snapping → 2D collision resolution → recheck.

- Gravity constant is in `physics.js` (`GRAVITY = 20`), NOT in config.js.
- Per-hero jump velocity is supported via `state._jumpVelocity` (defaults to `JUMP_VELOCITY` from physics.js).
- Collision uses Y-aware AABB push-out against `arena.colliders` (Box3 array); colliders are skipped when the player stands on top of them (`feetY + 0.1 >= box.max.y`).
- Ramp and wedge colliders use a staircase approximation (5 progressively shorter AABBs + back wall) so the Y-skip logic lets players ascend slopes while still blocking side entry.
- L-shape colliders decompose into 2 AABBs (horizontal leg + vertical leg) to avoid blocking the empty inner corner.
- Arch colliders decompose into 3 AABBs (2 full-height pillars + top lintel above the opening).
- `arena.solids` (Mesh array) = ground-height raycasting, bullet raycasting, AI line-of-sight.
- `arena.colliders` (Box3 array) = movement collision.

**Combat** uses visible traveling projectiles by default (`projectileSpeed: 120` m/s), with hitscan as a fallback when `projectileSpeed` is 0/null. Player hitboxes are **segmented AABBs** (head/torso/legs) with per-segment damage multipliers — headshots deal 2x damage, leg shots 0.75x. `sharedFireWeapon()` in `projectiles.js` is the single entry point for all weapon firing across all modes. `updateProjectiles(dt)` must be called each frame by the active game mode to advance live projectiles.

## Networking Protocol (Socket.IO events)

`createRoom`/`joinRoom` → room lifecycle. `input` → client sends to host each frame. `snapshot` → host broadcasts state at ~30Hz. `shot` → host relays shot visuals (two formats: projectile `{o, d, c, s, g}` with origin/direction/color/speed/gravity, or legacy hitscan `{o, e, c}` with origin/endpoint/color — distinguished by presence of `d` field). `startRound`/`roundResult`/`matchOver` → round lifecycle. `startHeroSelect` (host→client) / `heroSelect` (bidirectional) / `heroesConfirmed` (host→client) → pre-round hero selection. All payloads are plain objects with arrays for positions `[x,y,z]`.

## Server REST API

The game server (`server.js`) exposes read-only endpoints for maps and heroes. Write/delete operations for heroes and weapon-models happen only in the Electron dev workbench.

```
GET/POST/DELETE  /api/maps/:name          — Map JSON (read-write)
GET              /api/maps                — List saved map names

GET              /api/heroes/:id          — Hero config JSON (read-only)
GET              /api/heroes              — List saved hero names
```

Names use sanitization (`a-zA-Z0-9_-`, max 50 chars). Storage dirs: `maps/`, `heroes/`. Built-in heroes are seeded to `heroes/` on server startup if not already present.

The Electron dev workbench handles full CRUD for heroes and weapon-models via `window.devAPI` (filesystem access through `contextBridge`). Storage dirs: `heroes/`, `weapon-models/`.

## UI Flow

Menu navigation is in `menuNavigation.js`. Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. HUD elements (health bar, ammo, reload indicator, sprint indicator, crosshair) are managed by `hud.js` and `crosshair.js`, shared between all game modes. Settings (sensitivity, FOV) persist in localStorage.

## Dev Workbench

The dev workbench is a standalone **Electron desktop app** (`npm run dev`). It loads all the same game JS files as `index.html` but replaces `game.js` (bootstrap) with dev-specific files. Includes `devConsole.js` for in-game debug tools. No game server needed — filesystem access is provided directly via Electron's `contextBridge`.

### Launch

```bash
# Dev workbench (standalone, no server needed):
/opt/homebrew/bin/npm run dev

# Game server (for players, no dev tools exposed):
/opt/homebrew/bin/node server.js
```

### Features
- **Split-Screen**: Two viewports side by side. Tab key switches which player you control. Both players use the same physics, shooting, and weapon systems as the real game. Sidebar hides during play, restores on stop.
- **Hero Editor**: Edit all hero stats with a live 3D orbit-camera preview (drag to orbit, scroll to zoom). Sidebar expands to 450px and preview fills the main viewport for full visibility. Collapsible form sections (Weapon, Scope, Crosshair, Visual collapsed by default). **Enhanced interactive hitbox editing**: hitbox wireframes are scene-level objects (not parented to scaled player mesh) for accurate raycasting. Click a hitbox to select it (turns semi-transparent solid), drag to move in full 3D space (camera-facing plane drag updates offsetX/Y/Z). When selected, 6 resize handles appear at face centers (red spheres=X, green=Y, blue=Z); drag handles to resize width/height/depth with opposite-face anchoring. "Hide Model" button toggles player body/weapon visibility to inspect hitboxes clearly. Form fields include offsetX, offsetY, offsetZ for each segment. Save/load custom heroes to filesystem. Custom heroes appear in all dropdowns alongside built-in heroes.
- **Weapon Model Builder**: Compose weapon models from box/cylinder parts with a live orbit-camera 3D preview (fills viewport when active). Register models into `WEAPON_MODEL_REGISTRY` for use in-game.
- **Map Editor**: Full visual editor with 7 shape types (box, cylinder, half-cylinder, ramp, wedge, L-shape, arch), dropdown shape selector, Z/X/quad mirror modes, multi-select, copy/paste, flexible spawn placement with team colors, arena boundary visualization, and player-mode preview.
- **Quick Test**: Launch AI Match or Training Range directly with chosen hero/difficulty/map.
- **Dev Console**: Press C during gameplay to open dev console (same as main game). Hitbox visualization, god mode, unlimited ammo, spectator camera, AI state display.

### Key Architecture Decisions
- `devApp.js` replaces `game.js` but provides the same globals (`scene`, `camera`, `renderer`) and the same functions (`setFirstPersonWeapon`, `clearFirstPersonWeapon`). It also overrides `showOnlyMenu` to restore the dev sidebar when game modes end via ESC. `switchPanel` handles expanded layout: moves preview containers into the viewport with `.viewport-mode` class, adds `.expanded` to sidebar, and calls resize functions. `input.js` checks `window._splitScreenActive` alongside the other mode flags for mouse look and ESC handling.
- **Fetch interception**: `electron-fetch-shim.js` monkey-patches `window.fetch` when `window.devAPI` exists (Electron). All `/api/*` calls are intercepted and routed to the filesystem. When `devAPI` doesn't exist (web game), fetch works normally. This means **zero changes** to `mapFormat.js`, `devHeroEditor.js`, or `devApp.js`.
- **Socket.IO**: Not loaded in `dev.html`. `modeLAN.js` is still included but only calls `io()` inside `ensureSocket()` which is never invoked at module load time. LAN mode is not available from the dev workbench.
