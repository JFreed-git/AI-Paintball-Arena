# Game Modes Reference

Consult this doc when working on: FFA multiplayer, training range, round flow, scoreboard, lobby UI, game setup, or AI bot integration.

## FFA Multiplayer (`modeFFA.js`)

The primary competitive mode. Host-authoritative architecture supporting 2-8 players (human + AI bots) with Socket.IO networking.

### Architecture

- **Host** runs all game logic: physics, hit detection, damage, scoring, round flow. Broadcasts `snapshot` events at ~30Hz.
- **Client** sends `input` events each frame. Receives snapshots and applies them with client-side prediction (lerp reconciliation: `LERP_RATE: 0.15`, `SNAP_THRESHOLD_SQ: 25`).
- Game mode logic runs in its own `requestAnimationFrame` loop, separate from the main `animate()` loop in `game.js`.

### Game Modes

| Mode | Description |
|------|-------------|
| FFA (Free-For-All) | Default. All players compete individually. First to kill limit wins the round. |
| TDM (Team Deathmatch) | `mode: 'tdm'`. Teams compete for combined kill count. Team colors assigned via lobby. |
| Elimination | `noRespawns` flag. No respawning — last player/team alive wins the round. |

### Match Flow

1. **Game Setup** (`gameSetupMenu`): Host selects map, mode, rounds to win, kill limit, elimination toggle
2. **Lobby** (`lobbyMenu`): Players join via room code, host adds AI bot slots, assigns teams. Host clicks "Start Game"
3. **Hero Select** (`heroSelectOverlay`): Timed hero selection before first round and between rounds
4. **Gameplay**: Round plays until kill limit reached or elimination. `roundFlow.js` handles countdown banners
5. **Round End**: Banner shows round winner. If rounds-to-win not reached, hero select → next round
6. **Match End**: `postMatchResults` screen shows final scoreboard with option to return to lobby or menu

### AI Bot Slots

The host can add up to 7 AI bot slots from the lobby. Each slot configures: hero (or random), difficulty (Easy/Medium/Hard), and team assignment. AI bots run client-side on the host using `aiOpponent.js`.

### Mana-Per-Shot

Before firing, the mode checks `weapon.manaCostPerShot > 0` and blocks the shot if insufficient mana. Mana is consumed on each shot. Both host-side (all players) and client-side (local player prediction) paths enforce this.

### Settings Overlay

ESC during gameplay opens the in-game settings overlay (`settingsOverlay`) instead of immediately exiting. The overlay has two tabs:
- **Keybinds**: Displays and allows remapping keybindings
- **Crosshair**: Placeholder for crosshair customization

"Leave Game" button in the settings overlay exits to main menu. "Resume" closes the overlay and re-locks the pointer.

### Key Exports

```
window.startFFAHost(roomId, settings)  — start hosting
window.joinFFAGame(roomId, playerName) — join as client
window.getFFAState()                   — current mode state (players, arena, etc.)
window.stopFFAInternal()               — clean shutdown
window.ffaActive                       — true while FFA is running
window.toggleSettingsOverlay()         — toggle ESC settings menu
window.isSettingsOpen()                — check if settings overlay is open
```

## Training Range (`modeTraining.js`)

Free practice mode with no rounds, scoring, or networking. Runs entirely client-side.

- 80x100m arena with 3 shooting lanes (targets at 15/25/35m), open field with cover, and patrol bot routes
- Simple patrol bots (`trainingBot.js`) walk predetermined paths; respawn after being killed
- Stats display: shots fired, hits, kills, accuracy
- Hero selection available (untimed) at start and via H key during play

### Key Exports

```
window.startTrainingRange()           — start training mode
window.stopTrainingRangeInternal()    — clean shutdown
window.trainingRangeActive            — true while training is running
window.getTrainingRangeState()        — current state (arena, bots, etc.)
```

## Round Flow (`roundFlow.js`)

Handles the visual round flow: "Round X" banner → 3-2-1-GO countdown → gameplay → "Round Over" banner. Used by FFA mode between rounds.

## Scoreboard (`ffaScoreboard.js`)

- **Tab-held scoreboard** (`scoreboardOverlay`): Shows during FFA gameplay while Tab is held. Columns: rank, player name, hero, kills, deaths, score. Local player row highlighted. Team dividers in TDM mode.
- **Post-match results** (`postMatchResults`): Full-screen results after match ends with final scoreboard and navigation buttons.
- Updates at 1Hz while FFA is active via `startFFAScoreboardPolling()`.

### Key Exports

```
window.updateFFAScoreboard()      — refresh scoreboard data
window.showPostMatchResults()     — show post-match screen
window.clearFFAScoreboard()       — reset
window.startFFAScoreboardPolling() / window.stopFFAScoreboardPolling()
```

## Key Files

| File | Role |
|------|------|
| `modeFFA.js` | FFA multiplayer: host-authoritative game loop, client prediction, lobby, round/match flow |
| `modeTraining.js` | Training range: local single-player practice |
| `ffaScoreboard.js` | Tab scoreboard and post-match results |
| `roundFlow.js` | Round banners and countdown sequence |
| `menuNavigation.js` | Menu navigation, game setup UI, lobby UI |
| `heroSelectUI.js` | Timed/untimed hero selection overlay |
| `aiOpponent.js` | 7-state AI with A* pathfinding (used as bots in FFA and training) |
| `trainingBot.js` | Simple patrol bots for training range |
