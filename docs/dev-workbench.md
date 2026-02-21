# Dev Workbench Reference

Consult this doc when working on: the Electron app, hero editor, weapon model builder, menu builder, map editor, split-screen mode, dev console, or any dev-specific UI/architecture.

## Overview

The dev workbench is a standalone **Electron desktop app** (`npm run dev`). It loads all the same game JS files as `index.html` but replaces `game.js` (bootstrap) with dev-specific files. Includes `devConsole.js` for in-game debug tools. No game server needed — filesystem access is provided directly via Electron's `contextBridge`.

### Launch

```bash
# Dev workbench (standalone, no server needed):
/opt/homebrew/bin/npm run dev

# Game server (for players, no dev tools exposed):
/opt/homebrew/bin/node server.js
```

## Features

- **Split-Screen**: Two independent game iframes (`localhost:3000/?splitView=1`) side by side, each starting at the main menu. Host a lobby from one window, join from the other. A control bar at top-center lets you click to acquire pointer lock (play mode) or close (X) to stop. In play mode, the overlay captures input and forwards it to the active iframe via postMessage; Tab switches which iframe you control; ESC releases pointer lock back to menu mode. Hero select between rounds auto-releases pointer lock so you can click hero cards. Each iframe's HUD is self-contained.
- **Hero Editor**: Four-view flow: **Gallery → Hub → Editor / Ability Sub-view**.
  - **Gallery**: Shows all heroes as cards (color accent, name, description, HP/weapon badges). Rename (pencil icon or double-click), delete (X icon) directly from cards. "Create New Hero" button at top.
  - **Hub View**: Full-viewport hero summary card showing identity (color, name, description), stats (HP, walk, sprint, jump), weapon quick-view, abilities overview with icons, and action buttons (Edit, Save, Delete, Back). Click "Edit" to open the full editor, or click an ability to open the Ability Sub-view.
  - **Ability Sub-view**: Dedicated full-viewport editor for individual hero abilities, accessed from the Hub. Edit ability params, key bindings, cooldowns, and duration.
  - **Editor**: Three-column layout: left sidebar (character/stats/weapon form, 450px expanded), 3D viewport (orbit-camera preview with floating toolbar), right panel (hitbox segments, 300px). Both sidebars are collapsible via `<<`/`>>` buttons. **Floating viewport toolbar** shows view mode (Hitbox/Visual/Combined), "Hide Model", "Snap Center", and "FP View" buttons. **Right panel** shows hitbox segments (Hitbox mode) or body parts (Visual mode) with undo/redo, add/remove/edit, click-to-select, drag-to-move, and shape-specific resize handles. Save/load custom heroes to filesystem.
- **Weapon Model Builder**: Compose weapon models from box/cylinder parts with a live orbit-camera 3D preview (fills viewport when active). Register models into `WEAPON_MODEL_REGISTRY` for use in-game.
- **Menu Builder**: Visual drag-and-drop editor for game menus. Three-column layout: left sidebar (menu selector, container dimensions, element list with add/remove), viewport (live DOM preview centered, elements draggable to reposition, resize handles on selection), right panel (selected element properties — type, text, ID, action, position, size, style overrides). Supports all element types: heading, text, button, slider, select, numberInput, textInput, divider, image. Grid snapping (10px/5px/off), grid overlay toggle. Undo/redo via JSON snapshot stack. Save/load to filesystem. Reset to defaults. Custom menus override game HTML when loaded at startup via `loadCustomMenus()`.
- **Map Editor**: Starts with a **gallery view** showing all saved maps as cards (with size, spawn count, object count, and mode badges). Click a card to open the map editor with that map loaded; exiting the editor returns to gallery. Rename and delete directly from gallery cards. "Create New Map" opens a blank map. The editor itself is a full visual editor with 7 shape types (box, cylinder, half-cylinder, ramp, wedge, L-shape, arch), dropdown shape selector, Z/X/quad mirror modes, multi-select, copy/paste, flexible spawn placement with team colors, arena boundary visualization, and player-mode preview.
- **Dev Console**: Press C during gameplay to open dev console (same as main game). Hitbox visualization, god mode, unlimited ammo, spectator camera, AI state display.
- **Launch Game**: "Launch Game" button in sidebar nav. Opens the full game in a fullscreen iframe within the workbench. Auto-starts the game server via `devAPI.serverStart()` if not already running, then loads `localhost:3000` with polling/retry logic. Close button returns to the dev workbench.
- **Server Control**: "Server" button in sidebar header with status dot (gray=stopped, amber pulse=starting, green glow=running, red=error). Click to start/stop the game server (`node server.js`) directly from the workbench. Collapsible log panel at the bottom of the sidebar shows live server output. Server is automatically stopped on window close/reload.

## Key Architecture Decisions

- `devApp.js` replaces `game.js` but provides the same globals (`scene`, `camera`, `renderer`) and the same functions (`setFirstPersonWeapon`, `clearFirstPersonWeapon`). It overrides `showOnlyMenu` to restore the dev sidebar and panel-specific UI (right panel, floating toolbars, menu builder preview) when game modes end via ESC, preserving collapsed state. `switchPanel` handles **gallery views** for heroEditor and mapEditor (shows gallery in viewport first, transitions to hub/editor on card click), **hub views** for heroEditor (intermediate summary card before the full editor), and **expanded layout** for other editor panels: moves preview containers into the viewport with `.viewport-mode` class, adds `.expanded` to sidebar, and calls resize functions. It also shows/hides `#devRightPanel` content (hitbox segments for hero editor, element properties for menu builder) and floating toolbars (`#heViewportToolbar`, `#mbViewportToolbar`) based on active panel. `hideGameModeUI()` is a shared helper that hides both sidebars, toolbars, menu builder preview, and expand tabs for full-screen gameplay. `toggleSidebar()`/`toggleRightPanel()` toggle `.collapsed` class (0 width) and show/hide expand-tab buttons. `launchGame()` hides dev UI and shows the game in a fullscreen iframe, auto-starting the server if needed. `input.js` checks `window._splitScreenActive` alongside the other mode flags for mouse look and ESC handling.
- **Fetch interception**: `electron-fetch-shim.js` monkey-patches `window.fetch` when `window.devAPI` exists (Electron). All `/api/*` calls are intercepted and routed to the filesystem. When `devAPI` doesn't exist (web game), fetch works normally. This means **zero changes** to `mapFormat.js`, `devHeroEditor.js`, or `devApp.js`.
- **Socket.IO**: Not loaded in `dev.html`. LAN/FFA modes are not available directly from the dev workbench, but split-screen launches iframes that load the full game (including Socket.IO) from localhost:3000.

## Dev Workbench Files

| File | Purpose |
|------|---------|
| `electron-main.js` | Electron entry point. Creates BrowserWindow (1400x900), loads `dev.html`, sets up preload script. |
| `electron-preload.js` | Exposes `window.devAPI` via `contextBridge` — filesystem CRUD for `heroes/`, `weapon-models/`, `maps/`, `menus/`. Server process management: `serverStart()`, `serverStop()`, `serverStatus()`, `serverLogs()`. |
| `electron-fetch-shim.js` | Monkey-patches `window.fetch` to intercept `/api/*` calls and route to filesystem via `devAPI`. Safe no-op outside Electron. |
| `interactionEngine.js` | Shared 3D interaction engine. `createOrbitController(opts)`, `createInteractionController(opts)`, `snapTo(val, step)`. Used by devHeroEditor.js for hitbox, body part, and WMB editing. |
| `dev.html` | Three-column layout HTML. Loads shared game JS plus dev-specific files. |
| `devApp.css` | Three-column layout styles (left 300px/450px, viewport flex, right 300px). Collapsible sidebars, floating toolbars, split-screen HUD. |
| `devApp.js` | Dev bootstrap. Creates bare globals, sidebar navigation, panel switching, expanded layout, map gallery. Exports: `getAllHeroes()`, `CUSTOM_HEROES`, `registerCustomWeaponModel()`, `resizeRenderer()`, `_showMapGallery()`. |
| `devSplitScreen.js` | Split-screen mode: two independent iframes side by side. Control bar for pointer lock, overlay input forwarding, Tab to switch active iframe. Exports: `startSplitScreen()`, `stopSplitScreen()`, `_splitScreenActive`. |
| `devHeroEditor.js` | Hero/weapon editor with live 3D preview. Four-view flow: gallery → hub → editor / ability sub-view. Three viewport modes (Hitbox/Visual/Combined), FP View, interactive editing, WMB. Exports: `_initHeroEditorPreview()`, `_initWmbPreview()`, `_showHeroGallery()`, `_showHeroHub()`, `_openHeroEditor()`, `_backToHeroGallery()`, `_showAbilitySubview()`, etc. |
| `menuBuilder.js` | Visual menu builder. Drag-to-reposition, resize handles, grid snapping, snap-to-alignment, undo/redo. Exports: `_initMenuBuilderPreview()`, `_resizeMenuBuilderPreview()`. |
