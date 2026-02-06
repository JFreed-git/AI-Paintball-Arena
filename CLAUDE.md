# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

**Single-player AI** (`paintballGame.js` + `aiOpponent.js`): Self-contained game loop via `requestAnimationFrame`. The AI uses A* pathfinding on a 25-point waypoint graph and hitscan raycasting for combat. Controlled by `window.paintballActive`.

**LAN Multiplayer** (`multiplayer.js`): Host-authoritative architecture. The host runs physics simulation for both players and broadcasts snapshots at ~20Hz. The client sends raw input each frame, applies client-side movement prediction locally, and reconciles with authoritative snapshots via lerp. The server (`server.js`) is a thin Socket.IO relay that manages rooms and forwards messages — it runs no game logic. Controlled by `window.multiplayerActive`.

**Shared game logic** (`gameShared.js`): Both modes call shared functions for HUD updates (`sharedUpdateHealthBar`, `sharedUpdateAmmoDisplay`), reload logic (`sharedHandleReload`, `sharedStartReload`), round flow (`sharedShowRoundBanner`, `sharedStartRoundCountdown`), and crosshair/sprint UI (`sharedSetCrosshairBySprint`, `sharedSetReloadingUI`, `sharedSetSprintUI`). Mode-specific logic (AI, networking) stays in their respective files.

Both modes also share `physics.js` (3D movement: XZ walking + vertical gravity/jumping/ramps), `projectiles.js` (hitscan raycasting + tracer visuals), `paintballEnvironment.js` (symmetric arena generation), and `playerControls.js` (keyboard/mouse input with pointer lock).

### Physics & Combat

Movement is full 3D — horizontal XZ walking plus vertical gravity, jumping, and ramp traversal. `updateFullPhysics` handles the complete cycle: horizontal movement → ground detection via `getGroundHeight` (downward raycast against `arena.solids`) → jump/gravity → ground snapping → 2D collision resolution → recheck. Collision uses Y-aware AABB push-out against `arena.colliders` (Box3 array); colliders are skipped when the player stands on top of them (`feetY + 0.1 >= box.max.y`). Ramp colliders use a staircase approximation (multiple progressively shorter AABBs) so the Y-skip logic lets players ascend slopes while still blocking side entry. `arena.solids` (Mesh array) is used for ground-height raycasting, bullet raycasting, and AI line-of-sight checks; `arena.colliders` (Box3 array) is used for movement collision. Combat is hitscan with configurable spread cone, not projectile-based. Player hitboxes are spheres for raycasting.

### Networking Protocol (Socket.IO events)

`createRoom`/`joinRoom` → room lifecycle. `input` → client sends to host each frame. `snapshot` → host broadcasts state at 20Hz. `shot` → host relays tracer visuals. `startRound`/`roundResult`/`matchOver` → round lifecycle. All payloads are plain objects with arrays for positions `[x,y,z]`.

### UI Flow

Menu navigation is in `menuNavigation.js`. Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. HUD elements (health bar, ammo, reload indicator, sprint indicator, crosshair) are shared between both game modes. Settings (sensitivity, FOV) persist in localStorage.
