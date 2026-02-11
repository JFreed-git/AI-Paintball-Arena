# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Keep this file and `docs/*.md` up to date. Whenever you make changes that affect architecture, networking, physics, module APIs, or other documented details, update the relevant file as part of the same task.

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

| File | Purpose |
|------|---------|
| `config.js` | Shared constants: `GAME_CONFIG` (round timing, hero select timer) |
| `audio.js` | Web Audio sound engine: synthesis, event-driven sound dispatch, AnalyserNode for viz, loads from `sounds/` |
| `sounds/*.json` | Sound definition JSON files (editable via Audio Manager workbench) |
| `weapon.js` | `Weapon` class — static stats + mutable state, `reset()` for rounds |
| `weaponModels.js` | `WEAPON_MODEL_REGISTRY` — model type keys → `THREE.Group` builders |
| `physics.js` | 3D movement engine: gravity, jumping, ground detection, AABB collision |
| `crosshair.js` | Crosshair rendering (cross/circle styles), spread, sprint spread |
| `hud.js` | Shared HUD: reload state machine, health bar, ammo display |
| `roundFlow.js` | Round banners and 3-2-1-GO countdown sequence |
| `heroes.js` | Hero registry, `applyHeroToPlayer()`, `loadHeroesFromServer()` |
| `abilities.js` | `AbilityManager` — cooldown tracking, passive lookup (activation TODO) |
| `heroSelectUI.js` | Card-based hero selection overlay (timed + untimed modes) |
| `menuRenderer.js` | Menu config → DOM renderer, `loadCustomMenus()` from `/api/menus` |
| `menuNavigation.js` | Menu toggle via `showOnlyMenu(id)`, settings persistence |
| `input.js` | Keyboard/mouse input, pointer lock. Exports `getInputState()`. V key = melee |
| `environment.js` | Scene setup — lights, sky, fog, ground plane |
| `player.js` | `Player` class — segmented hitbox, body parts mesh, weapon attachment |
| `arenaBuilder.js` | Shared arena construction helpers |
| `arenaCompetitive.js` | Competitive arena with waypoints and symmetric spawns |
| `arenaTraining.js` | Training range with shooting lanes and bot patrol routes |
| `mapFormat.js` | Map JSON serialization, 7 shape types, shape-accurate colliders |
| `projectiles.js` | `sharedFireWeapon()`, `sharedMeleeAttack()`, projectile/hitscan, ray intersection per shape |
| `aiOpponent.js` | 7-state AI with A* pathfinding and 3 playstyles |
| `trainingBot.js` | Simple patrol bots for training range |
| `modeAI.js` | Single-player vs AI game mode |
| `modeLAN.js` | LAN multiplayer — host-authoritative with client-side prediction |
| `modeTraining.js` | Training range mode — free practice, no rounds |
| `game.js` | Bootstrap: creates `scene`/`camera`/`renderer`, master render loop |
| `devConsole.js` | Dev console: god mode, hitbox viz, spectator cam (toggle with 'C') |
| `server.js` | Express + Socket.IO relay server, REST API, no game logic |
| `index.html` | Main HTML page with all DOM and script tags in dependency order |
| `style.css` | All CSS for menus, HUD, overlays, and game UI |
| `devAudioManager.js` | Workbench editor for sounds: viewport sound table, envelope/waveform viz, CRUD, duplicate, randomize |
| `electron-*.js`, `dev*.js/html/css`, `interactionEngine.js`, `menuBuilder.js`, `mapEditor.js` | Dev workbench (Electron) — see [`docs/dev-workbench.md`](docs/dev-workbench.md) |

## Script Load Order

Scripts load in this order in index.html (dependencies flow top-to-bottom):

```
Three.js (CDN) → Socket.IO (CDN) →
config.js → audio.js → weapon.js → weaponModels.js → physics.js → crosshair.js →
hud.js → roundFlow.js → heroes.js → abilities.js → heroSelectUI.js →
menuRenderer.js → menuNavigation.js → input.js → environment.js →
player.js → arenaBuilder.js → arenaCompetitive.js → arenaTraining.js →
mapFormat.js →
projectiles.js → aiOpponent.js → trainingBot.js →
modeAI.js → modeLAN.js → modeTraining.js →
game.js → devConsole.js
```

dev.html (Electron) loads the same shared scripts but replaces game.js with dev-specific bootstrap, and swaps Socket.IO for the fetch shim:

```
Three.js (CDN) → electron-fetch-shim.js → interactionEngine.js →
[same shared scripts as index.html: config.js → audio.js → ... through modeTraining.js, including menuRenderer.js] →
mapEditor.js →
menuBuilder.js → devAudioManager.js → devSplitScreen.js → devHeroEditor.js → devConsole.js → devApp.js
```

## Key Rules

**Tick ordering:** Each game mode's tick must update ALL entity physics and call `_syncMeshPosition()` BEFORE `handlePlayerShooting()`/`sharedFireWeapon()` and `updateProjectiles(dt)`. After all updates, call `if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();`. See `docs/physics-and-arenas.md` for full details.

## UI Flow

Menu navigation is in `menuNavigation.js`. Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. HUD elements (health bar, ammo, reload indicator, sprint indicator, crosshair) are managed by `hud.js` and `crosshair.js`, shared between all game modes. Settings (sensitivity, FOV) persist in localStorage.

## Reference Docs

| Doc | Read when working on... |
|-----|------------------------|
| [`docs/heroes-and-combat.md`](docs/heroes-and-combat.md) | Heroes, hitbox segments, body parts, weapons, projectiles, damage, abilities |
| [`docs/physics-and-arenas.md`](docs/physics-and-arenas.md) | Movement, gravity, collision, arena construction, map format, tick ordering |
| [`docs/networking-and-server.md`](docs/networking-and-server.md) | Socket.IO events, LAN multiplayer, REST API, server.js |
| [`docs/dev-workbench.md`](docs/dev-workbench.md) | Electron app, hero editor, WMB, menu builder, map editor, split-screen |
