# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**IMPORTANT:** Keep this file and `docs/*.md` up to date. Whenever you make changes that affect architecture, networking, physics, module APIs, or other documented details, update the relevant file as part of the same task.

## Development Commands

- **Node/npm path:** `/opt/homebrew/bin/node` and `/opt/homebrew/bin/npm` (Homebrew install — `npm`/`node` are NOT on the default shell PATH in this environment, so always use full paths)
- **Start game server:** `/opt/homebrew/bin/node server.js` (serves on `http://0.0.0.0:3000`)
- **Start dev workbench:** `/opt/homebrew/bin/npm run dev` (launches Electron desktop app — no server needed)
- **Production build:** `/opt/homebrew/bin/node build.js` (concatenates + minifies to `bundle.min.js`; server auto-detects and serves it)
- **Install dependencies:** `/opt/homebrew/bin/npm install` (express, socket.io, electron)
- **No linter or test suite** — vanilla JS loaded directly via `<script>` tags in index.html

## Architecture

Browser-based 3D first-person paintball game using **Three.js** (r128, loaded via CDN) with two modes: FFA multiplayer (host-authoritative, supports AI bots and human players) via **Socket.IO**, and a Training Range for target practice.

### Module System

All JS files use IIFEs `(function() { ... })()` for scope isolation. Public APIs are exposed on `window.*` (e.g., `window.startFFAHost`, `window.joinFFAGame`, `window.getInputState`). Cross-module communication happens entirely through these window globals. Script load order in index.html matters — `game.js` loads last and bootstraps everything. See [`docs/file-structure.md`](docs/file-structure.md) for the full file table and load orders.

### Shared Globals

`game.js` creates the Three.js `scene`, `camera`, and `renderer` as bare globals. Every other module reads/writes these directly. The camera position doubles as the local player's world position — there is no separate player entity for the local player in single-player mode.

## Key Rules

**Tick ordering:** Each game mode's tick must update ALL entity physics and call `_syncMeshPosition()` BEFORE `handlePlayerShooting()`/`sharedFireWeapon()` and `updateProjectiles(dt)`. After all updates, call `if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();`. See `docs/physics-and-arenas.md` for full details.

## Reference Docs

| Doc | Read when working on... |
|-----|------------------------|
| [`docs/file-structure.md`](docs/file-structure.md) | File table, script load orders (index.html and dev.html), module dependencies |
| [`docs/heroes-and-combat.md`](docs/heroes-and-combat.md) | Heroes, hitbox segments, body parts, weapons, projectiles, damage, abilities, mana system |
| [`docs/game-modes.md`](docs/game-modes.md) | FFA multiplayer mode, training range, round flow, scoreboard, lobby/game setup |
| [`docs/input-and-ui.md`](docs/input-and-ui.md) | Input system, remappable keymaps, settings overlay, crosshair/ADS, HUD, menus |
| [`docs/physics-and-arenas.md`](docs/physics-and-arenas.md) | Movement, gravity, collision, arena construction, map format, tick ordering |
| [`docs/networking-and-server.md`](docs/networking-and-server.md) | Socket.IO events, LAN multiplayer, REST API, server.js, production mode |
| [`docs/dev-workbench.md`](docs/dev-workbench.md) | Electron app, hero editor, WMB, menu builder, map editor, split-screen |
