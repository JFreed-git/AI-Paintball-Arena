# Networking and Server Reference

Consult this doc when working on: Socket.IO events, LAN multiplayer protocol, REST API endpoints, server.js, client-server communication, or production deployment.

## Server Overview

`server.js` is a Node.js/Express + Socket.IO server that:
- Serves static game files
- Manages multiplayer rooms (up to 8 players per room)
- Relays messages between host and clients (no game logic on server)
- Provides a full REST API for maps, heroes, sounds, weapon models, and menus
- Seeds built-in heroes (marksman, brawler) on startup
- Supports production mode via `bundle.min.js`

## Production Mode

When `bundle.min.js` exists in the project root (created by `node build.js`), the server automatically switches to production mode:
- Builds a modified `index.html` on-the-fly that loads the bundle instead of individual script tags
- Strips the dev console HTML from the served page
- Blocks all source `.js` files (returns 404) except `bundle.min.js` and `socket.io`
- Dev workbench files are always blocked regardless of mode

## REST API

All names use sanitization (`a-zA-Z0-9_-`, max 50 chars). Binary file uploads use base64-encoded JSON body (`{ data: "base64..." }`).

### Maps

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/maps` | List saved map names |
| GET | `/api/maps/:name` | Get map JSON |
| POST | `/api/maps/:name` | Save map JSON |
| DELETE | `/api/maps/:name` | Delete a map |

Storage: `maps/`

### Heroes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/heroes` | List saved hero names |
| GET | `/api/heroes/:id` | Get hero config JSON |
| POST | `/api/heroes/:id` | Save/update hero JSON |
| DELETE | `/api/heroes/:id` | Delete a hero |

Storage: `heroes/`. Built-in heroes seeded on startup if not present.

### Menus

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/menus` | List saved menu names |
| GET | `/api/menus/:name` | Get menu config JSON |
| POST | `/api/menus/:name` | Save menu JSON |
| DELETE | `/api/menus/:name` | Delete a menu |

Storage: `menus/`

### Sounds (Synthesis Definitions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sounds` | List sound definition names |
| GET | `/api/sounds/:name` | Get sound definition JSON |
| POST | `/api/sounds/:name` | Save sound definition JSON |
| DELETE | `/api/sounds/:name` | Delete a sound definition |

Storage: `sounds/`

### Hero Sound Assignments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hero-sounds` | Get hero → event → audio file mapping |
| POST | `/api/hero-sounds` | Save hero sound mapping |

Storage: `sounds/hero_sounds.json`

### Sound Files (Audio Assets)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sound-files` | List uploaded audio files |
| POST | `/api/sound-files/:filename` | Upload .wav/.mp3 file (base64 body) |
| DELETE | `/api/sound-files/:filename` | Delete an audio file |

Storage: `sounds/files/`. Filenames restricted to `a-zA-Z0-9_-.` and `.wav`/`.mp3` extensions.

### Weapon Models (JSON Definitions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/weapon-models` | List weapon model names |
| GET | `/api/weapon-models/:name` | Get weapon model JSON |
| POST | `/api/weapon-models/:name` | Save weapon model JSON |
| DELETE | `/api/weapon-models/:name` | Delete weapon model (also deletes associated GLB file) |

Storage: `weapon-models/`

### Weapon Model Files (GLB/GLTF Binaries)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/weapon-model-files` | List GLB/GLTF files |
| GET | `/api/weapon-model-files/:filename` | Download a GLB/GLTF file |
| POST | `/api/weapon-model-files/:filename` | Upload GLB/GLTF file (base64 body) |
| DELETE | `/api/weapon-model-files/:filename` | Delete a GLB/GLTF file |

Storage: `weapon-models/files/`

## Networking Protocol (Socket.IO Events)

### Room Lifecycle

| Event | Direction | Description |
|-------|-----------|-------------|
| `createRoom` | client → server | Create a room (sender becomes host). Args: `(roomId, settings, ack)` |
| `joinRoom` | client → server | Join a room. Args: `(roomId, playerName, ack)` |
| `leaveRoom` | client → server | Leave current room. Host leaving closes room. |
| `playerList` | server → room | Broadcast after any player join/leave/ready/team change. Includes AI bot entries. |
| `clientJoined` | server → host | Notify host of new client |
| `clientLeft` | server → host | Notify host that client disconnected |
| `roomClosed` | server → room | Emitted when host leaves, closing the room |
| `hostTransfer` | server → room | Emitted when host disconnects and a new host is promoted. `{ newHostId, newHostName, oldHostId }` |

### Lobby

| Event | Direction | Description |
|-------|-----------|-------------|
| `setReady` | client → server | Set ready state `(roomId, ready)` |
| `updateAISlots` | host → server | Update AI bot slot configs. Server stores and re-broadcasts `playerList`. Array of `{ hero, difficulty, team }` |
| `setPlayerTeam` | host → server | Assign team to a player `(targetId, team)`. 0 = no team. |
| `updateSettings` | host → server | Update room settings mid-room |
| `startGame` | host → server | Start the game (all non-host players must be ready) |
| `gameStarted` | server → room | Broadcast with `{ players, settings }` |

### Gameplay

| Event | Direction | Description |
|-------|-----------|-------------|
| `input` | client → server → host | Client input forwarded to host each frame. `{ clientId, ...inputState }` |
| `snapshot` | host → server → clients | Host broadcasts game state at ~30Hz |
| `shot` | host → server → clients | Shot visual event. Projectile: `{o, d, c, s, g}` (origin, direction, color, speed, gravity). Legacy hitscan: `{o, e, c}` (origin, endpoint, color). |
| `melee` | host → server → clients | Melee visual event `{playerId, swingMs}` |
| `ffaKill` | host → server → clients | Kill event for kill feed |

### Round/Match Flow

| Event | Direction | Description |
|-------|-----------|-------------|
| `startRound` | host → clients | Signal round start |
| `roundResult` | host → clients | Round result |
| `matchOver` | host → clients | Match complete |
| `startHeroSelect` | host → clients | Begin hero selection phase |
| `heroSelect` | bidirectional | Hero selection choice (relayed to other players) |
| `heroesConfirmed` | host → clients | All heroes locked in |
| `betweenRoundHeroSelect` | host → clients | Hero select between rounds |

### Room Settings

Settings are sanitized on the server:
- `roundsToWin` — clamped 1-10 (default 2)
- `maxPlayers` — clamped 2-8 (default 8)
- `killLimit` — clamped 1-50 (default 10)
- `mapName` — optional, max 100 chars

Room state also tracks: `teamAssignments` (Map), `aiSlots` (array), `playerNames` (Map), `readyState` (Map).

## Electron Dev Workbench

The dev workbench (`npm run dev`) provides filesystem access via `window.devAPI` (through `contextBridge`). The `electron-fetch-shim.js` monkey-patches `window.fetch` to intercept `/api/*` calls and route them to the filesystem via `devAPI`, so game code using `fetch('/api/...')` works identically in both web and Electron contexts.

The dev workbench also provides server process management: `devAPI.serverStart()`, `devAPI.serverStop()`, `devAPI.serverStatus()`, `devAPI.serverLogs()` — allowing the game server to be started/stopped from the workbench UI.

## Key Files

| File | Role |
|------|------|
| `server.js` | Express + Socket.IO relay server. Static files, room management, REST API. No game logic. |
| `electron-preload.js` | `contextBridge` API: filesystem CRUD + server process management |
| `electron-fetch-shim.js` | Monkey-patches fetch for Electron |
