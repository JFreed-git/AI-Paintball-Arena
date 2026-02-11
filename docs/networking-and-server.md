# Networking and Server Reference

Consult this doc when working on: Socket.IO events, LAN multiplayer protocol, REST API endpoints, server.js, or client-server communication.

## Networking Protocol (Socket.IO events)

`createRoom`/`joinRoom` → room lifecycle. `input` → client sends to host each frame. `snapshot` → host broadcasts state at ~30Hz. `shot` → host relays shot visuals (two formats: projectile `{o, d, c, s, g}` with origin/direction/color/speed/gravity, or legacy hitscan `{o, e, c}` with origin/endpoint/color — distinguished by presence of `d` field). `startRound`/`roundResult`/`matchOver` → round lifecycle. `startHeroSelect` (host→client) / `heroSelect` (bidirectional) / `heroesConfirmed` (host→client) → pre-round hero selection. All payloads are plain objects with arrays for positions `[x,y,z]`.

### LAN Architecture

`modeLAN.js` implements host-authoritative multiplayer. Host runs physics for both players, broadcasts snapshots at ~30Hz. Client sends raw input, runs client-side prediction, reconciles via lerp. Hero selection is coordinated between host and client via Socket.IO events.

## Server REST API

The game server (`server.js`) exposes read-only endpoints for maps and heroes. Write/delete operations for heroes and weapon-models happen only in the Electron dev workbench.

```
GET/POST/DELETE  /api/maps/:name          — Map JSON (read-write)
GET              /api/maps                — List saved map names

GET              /api/heroes/:id          — Hero config JSON (read-only)
GET              /api/heroes              — List saved hero names

GET/POST/DELETE  /api/menus/:name         — Menu config JSON (read-write)
GET              /api/menus               — List saved menu names
```

Names use sanitization (`a-zA-Z0-9_-`, max 50 chars). Storage dirs: `maps/`, `heroes/`, `menus/`. Built-in heroes are seeded to `heroes/` on server startup if not already present.

The Electron dev workbench handles full CRUD for heroes, weapon-models, and menus via `window.devAPI` (filesystem access through `contextBridge`). Storage dirs: `heroes/`, `weapon-models/`, `menus/`.

## Key Files

| File | Role |
|------|------|
| `server.js` | Node.js/Express + Socket.IO relay server. Serves static files, manages rooms (2 players per room), stores per-room settings, forwards messages. No game logic. Seeds built-in heroes on startup. |
| `modeLAN.js` | LAN multiplayer mode. Host-authoritative, client-side prediction with lerp reconciliation. Exports: `hostLanGame`, `joinLanGame`, `stopMultiplayerInternal`, `getMultiplayerState`. |
