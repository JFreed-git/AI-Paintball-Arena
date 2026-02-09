# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Keep this file up to date. Whenever you make changes that affect architecture, networking, physics, module APIs, or other details documented below, update the relevant sections of this file as part of the same task.

## Development Commands

- **Node/npm path:** `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` (Homebrew install — `npm`/`node` are NOT on the default shell PATH in this environment, so always use full paths)
- **Start server:** `/opt/homebrew/bin/node server.js` (serves on `http://0.0.0.0:3000`)
- **Install dependencies:** `/opt/homebrew/bin/npm install` (express, socket.io)
- **No build step, linter, or test suite** — vanilla JS loaded directly via `<script>` tags in index.html

## Architecture

Browser-based 3D first-person paintball game using **Three.js** (r128, loaded via CDN) with two modes: single-player vs AI and 2-player LAN multiplayer via **Socket.IO**.

### Module System

All JS files use IIFEs `(function() { ... })()` for scope isolation. Public APIs are exposed on `window.*` (e.g., `window.startPaintballGame`, `window.hostLanGame`, `window.getInputState`). Cross-module communication happens entirely through these window globals. Script load order in index.html matters — `game.js` loads last and bootstraps everything.

### Shared Globals

`game.js` creates the Three.js `scene`, `camera`, and `renderer` as bare globals. Every other module reads/writes these directly. The camera position doubles as the local player's world position — there is no separate player entity for the local player in single-player mode.

### Two Game Modes, Parallel Implementations

**Single-player AI** (`paintballGame.js` + `aiOpponent.js`): Self-contained game loop via `requestAnimationFrame`. The AI uses a 7-state state machine (`SPAWN_RUSH`, `PATROL`, `ENGAGE`, `SEEK_COVER`, `HOLD_COVER`, `FLANK`, `STUCK_RECOVER`) with 3 randomly-selected playstyles per round (aggressive, defensive, balanced). Each playstyle is a config object controlling engagement distance, cover thresholds, sprint/jump rates, strafe intensity, and flank timing. Difficulty (Easy/Medium/Hard) affects AI behavior through two mechanisms: (1) **aim error** (`_aimErrorRad`) — the AI intentionally aims slightly off-target before firing, with per-difficulty values (Easy: 0.08rad/~4.6°, Medium: 0.035rad/~2.0°, Hard: 0.012rad/~0.7°), and (2) **reaction time** — randomized delay after gaining LOS before the AI can shoot (Easy: 400-650ms, Medium: 200-380ms, Hard: 100-220ms). The AI uses the same Weapon instance (identical stats) as the player — difficulty is expressed through aim accuracy and behavior, not weapon differences. The AI uses A* pathfinding on a 25-point waypoint graph, a cover system that scores spots from `arena.colliders`, layered strafing (base + micro-jitter + damage dodge), stuck detection (position tracking every 500ms), and hitscan raycasting for combat. Controlled by `window.paintballActive`.

**LAN Multiplayer** (`multiplayer.js`): Host-authoritative architecture. The host runs physics simulation for both players and broadcasts snapshots at ~30Hz. The client sends raw input each frame, runs client-side prediction using the same `updateFullPhysics` as the host for accurate prediction, and gently reconciles with authoritative snapshots via lerp (`LERP_RATE = 0.15`). The remote player (opponent) is rendered using snapshot interpolation — buffering the last two snapshots and smoothly lerping between them each frame — rather than snapping to each snapshot. The server (`server.js`) is a thin Socket.IO relay that manages rooms and forwards messages — it runs no game logic. Controlled by `window.multiplayerActive`.

**Shared game logic** (`gameShared.js`): Both modes call shared functions for HUD updates (`sharedUpdateHealthBar`, `sharedUpdateAmmoDisplay`), reload logic (`sharedHandleReload`, `sharedStartReload`), round flow (`sharedShowRoundBanner`, `sharedStartRoundCountdown`), and crosshair/sprint UI (`sharedSetCrosshairBySprint`, `sharedSetReloadingUI`, `sharedSetSprintUI`). Mode-specific logic (AI, networking) stays in their respective files.

Both modes also share `weapon.js` (Weapon class for weapon stats and state), `physics.js` (3D movement: XZ walking + vertical gravity/jumping/ramps), `projectiles.js` (hitscan raycasting + tracer visuals), `paintballEnvironment.js` (symmetric arena generation), and `playerControls.js` (keyboard/mouse input with pointer lock).

### Weapon System

`weapon.js` defines the `Weapon` class (`window.Weapon`), which holds both static stats (cooldownMs, magSize, reloadTimeSec, damage, spreadRad, sprintSpreadRad, maxRange) and per-instance mutable state (ammo, reloading, reloadEnd, lastShotTime). Default values: 166ms cooldown, 6-round mag, 2.5s reload, 20 damage, 0 base spread, 0.012 sprint spread, 200 range. Player, AI, and LAN multiplayer all use Weapon instances — the AI gets an identical default weapon to the player. `Weapon.reset()` restores mutable state for round resets. LAN multiplayer overrides weapon stats from room settings (fire cooldown, mag size, reload time, damage). The shared functions in `gameShared.js` (`sharedHandleReload`, `sharedStartReload`, `sharedCanShoot`) work with any Weapon instance.

### Physics & Combat

Movement is full 3D — horizontal XZ walking plus vertical gravity, jumping, and ramp traversal. `updateFullPhysics` handles the complete cycle: horizontal movement → ground detection via `getGroundHeight` (downward raycast against `arena.solids`) → jump/gravity → ground snapping → 2D collision resolution → recheck. Collision uses Y-aware AABB push-out against `arena.colliders` (Box3 array); colliders are skipped when the player stands on top of them (`feetY + 0.1 >= box.max.y`). Ramp colliders use a staircase approximation (multiple progressively shorter AABBs) so the Y-skip logic lets players ascend slopes while still blocking side entry. `arena.solids` (Mesh array) is used for ground-height raycasting, bullet raycasting, and AI line-of-sight checks; `arena.colliders` (Box3 array) is used for movement collision. Combat is hitscan with configurable spread cone, not projectile-based. Player hitboxes are spheres for raycasting.

### Networking Protocol (Socket.IO events)

`createRoom`/`joinRoom` → room lifecycle. `input` → client sends to host each frame. `snapshot` → host broadcasts state at ~30Hz. `shot` → host relays tracer visuals. `startRound`/`roundResult`/`matchOver` → round lifecycle. All payloads are plain objects with arrays for positions `[x,y,z]`.

### UI Flow

Menu navigation is in `menuNavigation.js`. Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. HUD elements (health bar, ammo, reload indicator, sprint indicator, crosshair) are shared between both game modes. Settings (sensitivity, FOV) persist in localStorage.
