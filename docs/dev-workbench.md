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

- **Split-Screen**: Two viewports side by side. Tab key switches which player you control. Both players use the same physics, shooting, and weapon systems as the real game. All UI hides during play, restores on stop.
- **Hero Editor**: Three-column layout: left sidebar (character/stats/weapon form, 450px expanded), 3D viewport (orbit-camera preview with floating toolbar), right panel (hitbox segments, 300px). Both sidebars are collapsible via `<<`/`>>` buttons — collapsed sidebars shrink to 0 and show an expand tab at the viewport edge. **Floating viewport toolbar** shows "Hide Model" and "Snap Center" buttons centered over the 3D preview. **Right hitbox panel** has undo/redo toolbar, segment list (add/remove/edit named hitbox segments), and `+ Segment` button. Hitbox wireframes are scene-level objects for accurate raycasting. Click to select (turns semi-transparent solid), drag to move in full 3D space (camera-facing plane drag updates offsetX/Y/Z). Resize handles at face centers (red=X, green=Y, blue=Z). Save/load custom heroes to filesystem. Custom heroes appear in all dropdowns alongside built-in heroes.
- **Weapon Model Builder**: Compose weapon models from box/cylinder parts with a live orbit-camera 3D preview (fills viewport when active). Register models into `WEAPON_MODEL_REGISTRY` for use in-game.
- **Menu Builder**: Visual drag-and-drop editor for game menus. Three-column layout: left sidebar (menu selector, container dimensions, element list with add/remove), viewport (live DOM preview centered, elements draggable to reposition, resize handles on selection), right panel (selected element properties — type, text, ID, action, position, size, style overrides). Supports all element types: heading, text, button, slider, select, numberInput, textInput, divider, image. Grid snapping (10px/5px/off), grid overlay toggle. Undo/redo via JSON snapshot stack. Save/load to filesystem. Reset to defaults. Custom menus override game HTML when loaded at startup via `loadCustomMenus()`.
- **Map Editor**: Full visual editor with 7 shape types (box, cylinder, half-cylinder, ramp, wedge, L-shape, arch), dropdown shape selector, Z/X/quad mirror modes, multi-select, copy/paste, flexible spawn placement with team colors, arena boundary visualization, and player-mode preview.
- **Quick Test**: Launch AI Match or Training Range directly with chosen hero/difficulty/map.
- **Dev Console**: Press C during gameplay to open dev console (same as main game). Hitbox visualization, god mode, unlimited ammo, spectator camera, AI state display.
- **Server Control**: "Server" button in sidebar header with status dot (gray=stopped, amber pulse=starting, green glow=running, red=error). Click to start/stop the game server (`node server.js`) directly from the workbench. Collapsible log panel at the bottom of the sidebar shows live server output. Server is automatically stopped on window close/reload.

## Key Architecture Decisions

- `devApp.js` replaces `game.js` but provides the same globals (`scene`, `camera`, `renderer`) and the same functions (`setFirstPersonWeapon`, `clearFirstPersonWeapon`). It overrides `showOnlyMenu` to restore the dev sidebar and panel-specific UI (right panel, floating toolbars, menu builder preview) when game modes end via ESC, preserving collapsed state. `switchPanel` handles expanded layout: moves preview containers into the viewport with `.viewport-mode` class, adds `.expanded` to sidebar, and calls resize functions. It also shows/hides `#devRightPanel` content (hitbox segments for hero editor, element properties for menu builder) and floating toolbars (`#heViewportToolbar`, `#mbViewportToolbar`) based on active panel. `hideGameModeUI()` is a shared helper that hides both sidebars, toolbars, menu builder preview, and expand tabs for full-screen gameplay. `toggleSidebar()`/`toggleRightPanel()` toggle `.collapsed` class (0 width) and show/hide expand-tab buttons. `input.js` checks `window._splitScreenActive` alongside the other mode flags for mouse look and ESC handling.
- **Fetch interception**: `electron-fetch-shim.js` monkey-patches `window.fetch` when `window.devAPI` exists (Electron). All `/api/*` calls are intercepted and routed to the filesystem. When `devAPI` doesn't exist (web game), fetch works normally. This means **zero changes** to `mapFormat.js`, `devHeroEditor.js`, or `devApp.js`.
- **Socket.IO**: Not loaded in `dev.html`. `modeLAN.js` is still included but only calls `io()` inside `ensureSocket()` which is never invoked at module load time. LAN mode is not available from the dev workbench.

## Dev Workbench Files

| File | Purpose |
|------|---------|
| `electron-main.js` | Electron entry point. Creates BrowserWindow (1400x900), loads `dev.html`, sets up preload script. |
| `electron-preload.js` | Exposes `window.devAPI` via `contextBridge` — filesystem CRUD for `heroes/`, `weapon-models/`, `maps/`, `menus/`. Server process management: `serverStart()`, `serverStop()`, `serverStatus()`, `serverLogs()`. |
| `electron-fetch-shim.js` | Monkey-patches `window.fetch` to intercept `/api/*` calls and route to filesystem via `devAPI`. Safe no-op outside Electron. |
| `interactionEngine.js` | Shared 3D interaction engine. `createOrbitController(opts)`, `createInteractionController(opts)`, `snapTo(val, step)`. Used by devHeroEditor.js for hitbox, body part, and WMB editing. |
| `dev.html` | Three-column layout HTML. Loads shared game JS plus dev-specific files. |
| `devApp.css` | Three-column layout styles (left 300px/450px, viewport flex, right 300px). Collapsible sidebars, floating toolbars, split-screen HUD. |
| `devApp.js` | Dev bootstrap. Creates bare globals, sidebar navigation, panel switching, expanded layout. Exports: `getAllHeroes()`, `CUSTOM_HEROES`, `registerCustomWeaponModel()`, `resizeRenderer()`. |
| `devSplitScreen.js` | Split-screen two-player mode. Dual viewports, Tab to switch, per-player cameras/HUD/crosshairs. Exports: `startSplitScreen(opts)`, `stopSplitScreen()`, `_splitScreenActive`. |
| `devHeroEditor.js` | Hero/weapon editor with live 3D preview. Three view modes (Hitbox/Visual/Combined), FP View, interactive editing, WMB. Exports: `_initHeroEditorPreview()`, `_initWmbPreview()`, etc. |
| `menuBuilder.js` | Visual menu builder. Drag-to-reposition, resize handles, grid snapping, snap-to-alignment, undo/redo. Exports: `_initMenuBuilderPreview()`, `_resizeMenuBuilderPreview()`. |
