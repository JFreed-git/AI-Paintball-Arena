# Input and UI Reference

Consult this doc when working on: keyboard/mouse input, keybindings, settings overlay, crosshair rendering, ADS/scope, HUD elements, menus, or pointer lock.

## Input System (`input.js`)

### Default Keybindings

| Key | Action | Type |
|-----|--------|------|
| W/A/S/D | Movement (moveZ/moveX axis) | Axis (held) |
| Shift (L/R) | Sprint | Toggle (held) |
| Space | Jump | One-shot |
| R | Reload | One-shot |
| V | Melee | One-shot |
| Q | Ability 1 | One-shot |
| E | Ability 2 | One-shot |
| F | Ability 3 | One-shot |
| C | Ability 4 | One-shot |
| Left-click | Fire | Held (fireDown) |
| Right-click | Secondary / ADS | Held (secondaryDown) |
| Tab | Scoreboard (non-remappable) | Hold to show |
| ESC | Settings overlay (non-remappable) | Toggle |

### Remappable Keymap System

Keybindings are data-driven via a `_keymap` object mapping `KeyboardEvent.code` → `{ action, type, value }`. Three binding types:
- **Axis** (`value` field): Held keys contribute +1 or -1 to an axis. Multiple keys on the same axis combine correctly.
- **Toggle** (`type: 'toggle'`): True while held, false on release.
- **One-shot** (`type: 'oneShot'`): Set true on press, consumed (cleared) by `getInputState()`.

### Keymap API

```js
window.getKeymap()                                  // current keymap object
window.setKeyBinding(keyCode, action, opts)          // rebind a key
window.resetKeymap()                                // restore defaults
window.loadKeymapForHero(heroId)                    // load per-hero keymap from localStorage
window.saveKeymapForHero(heroId)                    // save per-hero keymap to localStorage
window.getDefaultKeymap()                           // copy of default keymap
```

Per-hero keymaps are persisted in `localStorage` under keys like `keymap_mage`.

### Right-Click Dual Use

Right-click (`secondaryDown`) serves dual purpose depending on the hero:
- **Most heroes**: ADS/scope zoom (handled by `crosshair.js` `updateScopeADS()`)
- **Mage**: Activates Piercing Blast ability (charge-and-release beam) instead of ADS

The ability system checks if the hero has an ability keyed to `secondaryDown` and takes priority over ADS.

### Split-View Input Forwarding

In dev workbench split-screen mode, the parent overlay captures input and forwards it to iframes via `postMessage` events: `svMouseMove`, `svMouseDown`, `svMouseUp`, `svKeyDown`, `svKeyUp`, `svResetKeys`.

## Crosshair System (`crosshair.js`)

### Styles

- **`cross`** — 4-bar crosshair (default, for precision weapons like Marksman's rifle)
- **`circle`** — Circle ring + center dot (for spread weapons like Brawler's shotgun)

Style and color are set per-weapon via `weapon.crosshair = { style, baseSpreadPx, sprintSpreadPx, color }`.

### Spread

Spread is converted from weapon radians to screen pixels using camera FOV (`spreadRadToPx()`), so the crosshair accurately represents where shots land regardless of FOV settings. `sharedSetCrosshairBySprint()` is called every frame by game modes to toggle between base and sprint spread.

### Scope / ADS System

Fully implemented in `crosshair.js`:

```js
updateScopeADS(weapon, isADSHeld, dt) → { adsActive, spreadMultiplier }
resetScopeADS()
```

- Lerps camera FOV between default (75) and `weapon.scope.zoomFOV` at speed 12
- Fades crosshair opacity based on zoom progress (invisible when fully scoped)
- Returns `spreadMultiplier` for use by firing code (e.g., Marksman's 0.15x while scoped)
- `resetScopeADS()` called on hero switch, round end, death

### Weapon Scope Config

```js
weapon.scope = {
  type: 'scope' | 'ironsights',   // visual type (for future overlay)
  zoomFOV: 35,                     // target FOV when ADS
  spreadMultiplier: 0.15           // multiplied against base spread while ADS
}
```

## HUD (`hud.js`)

### Standard HUD Elements

| Element | DOM ID | Description |
|---------|--------|-------------|
| Health bar | `healthFill` | Width % based on current/max health |
| Ammo display | `ammoDisplay` | "current/magSize" or infinity symbol for magSize 0 |
| Reload indicator | `reloadIndicator` | Shown during reload, dims crosshair |
| Sprint indicator | `sprintIndicator` | "SPRINTING" text while sprinting |
| Melee cooldown | `meleeCooldown` | SVG circular timer showing melee cooldown progress |
| Weapon name | `weaponNameDisplay` | Hero/weapon name (training range) |

### Mana Bar

```js
window.updateManaHUD(mana, maxMana)  // show/update mana bar; pass null to hide
```

DOM: `#manaBarContainer` > `#manaBar` > `#manaFill` + `#manaText`. Shown only for heroes with a mana system (e.g., Mage).

### Ability HUD

```js
window.updateAbilityHUD(hudState)  // array of {id, name, key, cooldownPct, isActive, isReady}
```

DOM: `#abilityHUD` container. Dynamically creates/reconciles ability slot elements with:
- SVG icon from `ABILITY_ICONS` registry (keyed by ability ID)
- Key label (Q/E/F/C/RMB)
- Cooldown overlay that recedes upward as cooldown progresses
- CSS classes: `.ready`, `.active`, `.on-cooldown`

### ABILITY_ICONS Registry

`hud.js` exports `window.ABILITY_ICONS` — an object mapping ability IDs to inline SVG strings. Used by the ability HUD, hero select UI, and dev hero editor. Current icons: `dash`, `grappleHook`, `unlimitedAmmo`, `teleport`, `piercingBlast`, `meditate`.

### Weapon State Machine

Shared reload/fire logic in `hud.js` (tightly coupled with HUD updates):

```js
sharedHandleReload(weapon, now, heroId)     // check if reload finished, refill ammo
sharedStartReload(weapon, now, heroId)      // initiate reload (magSize 0 = no reload)
sharedCanShoot(weapon, now, cooldownMs)     // check fire readiness
```

## Menu System

### Menu Navigation (`menuNavigation.js`)

Menus are DOM elements toggled via CSS `hidden` class through `showOnlyMenu(id)`. Menu IDs include: `mainMenu`, `startGameMenu`, `gameSetupMenu`, `lobbyMenu`, `trainingMenu`, `resultMenu`, `postMatchResults`.

Settings (sensitivity, FOV, player name) persist in `localStorage`.

### Menu Renderer (`menuRenderer.js`)

Renders menu DOM from JSON config objects. `loadCustomMenus()` fetches saved menus from `/api/menus` and replaces hardcoded HTML with custom layouts. Used at startup by both `game.js` and `devApp.js`.

### Settings Overlay

ESC during gameplay opens `#settingsOverlay` instead of immediately exiting. Managed by `modeFFA.js`:
- `toggleSettingsOverlay()` — toggle visibility, release/reacquire pointer lock
- `isSettingsOpen()` — check state
- Tabs: Keybinds (remapping UI), Crosshair (placeholder)
- Footer: "Leave Game" (exits to menu) and "Resume" (closes overlay)

## Key Files

| File | Role |
|------|------|
| `input.js` | Keyboard/mouse input, pointer lock, remappable keymaps, split-view forwarding |
| `crosshair.js` | Crosshair rendering, spread calculation, scope/ADS system |
| `hud.js` | Health/ammo/reload/sprint/mana/ability HUD, weapon state machine, ability icon registry |
| `menuNavigation.js` | Menu toggle, settings persistence, game setup UI, lobby UI |
| `menuRenderer.js` | JSON config → DOM menu rendering, custom menu loading |
