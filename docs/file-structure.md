# File Structure Reference

Consult this doc when working on: module dependencies, script load order, understanding which file owns which functionality, or adding new scripts.

## File Table

### Game Files (loaded in index.html)

| File | Purpose |
|------|---------|
| `config.js` | Shared constants: `GAME_CONFIG` (round timing, hero select timer) |
| `audio.js` | Web Audio sound engine: synthesis for kept events (ui_click, countdown, death, respawn), file-based playback for hero sounds via `hero_sounds.json`, spatial audio |
| `weapon.js` | `Weapon` class — static stats + mutable state, `reset()` for rounds |
| `weaponModels.js` | `WEAPON_MODEL_REGISTRY` — model type keys → `THREE.Group` builders; GLTF/GLB model loading via `loadCustomWeaponModelsFromServer()` |
| `physics.js` | 3D movement engine: gravity, jumping, ground detection, AABB + cylindrical collision |
| `crosshair.js` | Crosshair rendering (cross/circle styles), spread, sprint spread, scope/ADS system (`updateScopeADS`, `resetScopeADS`) |
| `hud.js` | Shared HUD: reload state machine, health bar, ammo display, mana bar (`updateManaHUD`), ability cooldown HUD (`updateAbilityHUD`), `ABILITY_ICONS` SVG registry |
| `roundFlow.js` | Round banners and 3-2-1-GO countdown sequence |
| `heroes.js` | Hero registry, `applyHeroToPlayer()`, `loadHeroesFromServer()` |
| `abilities.js` | `AbilityManager` — cooldown tracking, ability activation, effect registry with `onActivate`/`onTick`/`onEnd` lifecycle, mana system. 6 registered effects: dash, grappleHook, unlimitedAmmo, teleport, piercingBlast, meditate |
| `heroSelectUI.js` | Card-based hero selection overlay (timed + untimed modes) |
| `menuRenderer.js` | Menu config → DOM renderer, `loadCustomMenus()` from `/api/menus` |
| `input.js` | Keyboard/mouse input, pointer lock, remappable keymap system. Exports `getInputState()`. Ability keys: Q/E/F/C |
| `environment.js` | Scene setup — lights, sky, fog, ground plane |
| `player.js` | `Player` class — segmented hitbox, body parts mesh, weapon attachment, `AbilityManager` per player |
| `arenaBuilder.js` | Shared arena construction helpers |
| `arenaCompetitive.js` | Competitive arena with waypoints and symmetric spawns |
| `arenaTraining.js` | Training range with shooting lanes and bot patrol routes |
| `mapFormat.js` | Map JSON serialization, 7 shape types (box, cylinder, sphere, ramp, wedge, lshape, arch), shape-accurate colliders |
| `mapThumbnail.js` | Overhead map thumbnail renderer using offscreen orthographic scene. Exports `generateMapThumbnail` |
| `menuNavigation.js` | Menu toggle via `showOnlyMenu(id)`, settings persistence, game setup UI, lobby UI |
| `projectiles.js` | `sharedFireWeapon()`, `sharedMeleeAttack()`, projectile/hitscan, ray intersection per shape, lock-on projectile tracking |
| `aiOpponent.js` | 7-state AI with A* pathfinding and 3 playstyles |
| `trainingBot.js` | Simple patrol bots for training range |
| `modeTraining.js` | Training range mode — free practice, no rounds |
| `modeFFA.js` | FFA multiplayer mode — host-authoritative, client prediction, team/elimination modes, AI bots, lobby, round flow |
| `ffaScoreboard.js` | Scoreboard overlay (Tab key) and post-match results screen |
| `game.js` | Bootstrap: creates `scene`/`camera`/`renderer`, master render loop, first-person weapon viewmodel, melee swing animation |
| `devConsole.js` | Dev console: god mode, hitbox viz, spectator cam (toggle with 'C') |
| `server.js` | Express + Socket.IO relay server, full REST API (maps, heroes, sounds, weapon-models, menus), production mode |
| `index.html` | Main HTML page with all DOM and script tags in dependency order |
| `style.css` | All CSS for menus, HUD, overlays, and game UI |

### Sound Assets

| Path | Purpose |
|------|---------|
| `sounds/*.json` | Synthesis-only sound definitions (ui_click, countdown, death, respawn) |
| `sounds/hero_sounds.json` | Hero+event → audio file mapping for file-based sounds |
| `sounds/files/` | Uploaded `.wav`/`.mp3` audio files for hero sound events |

### Dev/Build Files

| File | Purpose |
|------|---------|
| `build.js` | Node.js build script: concatenates all game scripts in dependency order and minifies with `terser` to produce `bundle.min.js` |
| `test-modes.js` | Puppeteer-based automated test for FFA and AI game modes |
| `devAudioManager.js` | Hero sound assignment UI: assign .wav/.mp3 files to per-hero sound events |
| `electron-main.js` | Electron entry point |
| `electron-preload.js` | `contextBridge` API for filesystem access |
| `electron-fetch-shim.js` | Monkey-patches `fetch` to route `/api/*` to filesystem in Electron |
| `interactionEngine.js` | Shared 3D interaction engine for dev editors |
| `devApp.js` | Dev workbench bootstrap (replaces `game.js` in dev.html) |
| `devHeroEditor.js` | Hero/weapon editor with live 3D preview, hero gallery, hub view |
| `devSplitScreen.js` | Split-screen mode: two independent iframes |
| `menuBuilder.js` | Visual menu builder with drag-and-drop |
| `mapEditor.js` | Visual map editor with fly camera |
| `devApp.css` | Dev workbench layout styles |
| `dev.html` | Dev workbench HTML |

## Script Load Order

### index.html (Game)

```
Three.js (CDN) → GLTFLoader (CDN) → Socket.IO (CDN) →
config.js → audio.js → weapon.js → weaponModels.js → physics.js → crosshair.js →
hud.js → roundFlow.js → heroes.js → abilities.js → heroSelectUI.js →
menuRenderer.js →
input.js → environment.js →
player.js → arenaBuilder.js → arenaCompetitive.js → arenaTraining.js →
mapFormat.js → mapThumbnail.js →
menuNavigation.js →
projectiles.js → aiOpponent.js → trainingBot.js →
modeTraining.js → modeFFA.js → ffaScoreboard.js →
game.js → devConsole.js
```

Note: `menuNavigation.js` loads after `mapFormat.js` and `mapThumbnail.js` because it depends on them for the game setup map grid.

### dev.html (Electron Dev Workbench)

Loads the same shared scripts but replaces `game.js` with dev-specific bootstrap, swaps Socket.IO for the fetch shim, and omits `modeFFA.js`/`ffaScoreboard.js`/`mapThumbnail.js`:

```
Three.js (CDN) → GLTFLoader (CDN) → electron-fetch-shim.js → interactionEngine.js →
config.js → audio.js → weapon.js → weaponModels.js → physics.js → crosshair.js →
hud.js → roundFlow.js → heroes.js → abilities.js → heroSelectUI.js →
menuRenderer.js → menuNavigation.js → input.js → environment.js →
player.js → arenaBuilder.js → arenaCompetitive.js → arenaTraining.js →
mapFormat.js → mapEditor.js →
projectiles.js → aiOpponent.js → trainingBot.js →
modeTraining.js →
menuBuilder.js → devAudioManager.js → devSplitScreen.js → devHeroEditor.js → devConsole.js → devApp.js
```
