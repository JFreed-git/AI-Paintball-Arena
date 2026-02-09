/**
 * menuNavigation.js — Menu DOM management and settings
 *
 * PURPOSE: Handles menu toggling (main menu, settings, LAN lobby, result screen),
 * settings persistence (sensitivity, FOV), game mode launch buttons, and HUD
 * visibility toggling. Bridges the DOM menu system with game mode start functions.
 *
 * EXPORTS (window):
 *   bindUI()               — initialize menu event listeners (called by game.js)
 *   showOnlyMenu(id)       — show one menu, hide all others
 *   setHUDVisible(visible) — toggle all HUD elements
 *
 * DEPENDENCIES: modeAI.js, modeLAN.js, modeTraining.js (start/stop functions)
 *
 * TODO (future):
 *   - Hero stats preview in lobby
 *   - Map selection UI with thumbnails
 *   - Audio settings (volume, mute)
 *   - Key rebinding menu
 *   - Server browser for LAN (auto-discover rooms)
 */


function bindUI() {
  // Sensitivity: load, display, and wire
  const sensInput = document.getElementById('sensInput');
  const sensValue = document.getElementById('sensValue');

  if (sensInput && sensValue) {
    let saved = null;
    try { saved = localStorage.getItem('mouseSensitivity'); } catch (e) { console.warn('menuNavigation: failed to read mouseSensitivity from localStorage', e); }

    if (saved !== null) {
      mouseSensitivity = parseFloat(saved) || 1.0;
      sensInput.value = String(mouseSensitivity);
    } else {
      mouseSensitivity = parseFloat(sensInput.value) || 1.0;
    }
    sensValue.textContent = String(mouseSensitivity.toFixed(1));

    sensInput.addEventListener('input', () => {
      mouseSensitivity = parseFloat(sensInput.value) || 1.0;
      sensValue.textContent = String(mouseSensitivity.toFixed(1));
      try {
        localStorage.setItem('mouseSensitivity', String(mouseSensitivity));
      } catch (e) { console.warn('menuNavigation: failed to save mouseSensitivity to localStorage', e); }
    });
  }

  // Field of View: load, display, and wire
  const fovInput = document.getElementById('fovInput');
  const fovValue = document.getElementById('fovValue');

  if (fovInput && fovValue) {
    let savedFov = null;
    try { savedFov = localStorage.getItem('fov'); } catch (e) { console.warn('menuNavigation: failed to read fov from localStorage', e); }

    // Default to current camera FOV if available, else 75
    let fov = (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) ? camera.fov : 75;

    if (savedFov !== null) {
      const parsed = parseFloat(savedFov);
      if (!Number.isNaN(parsed)) {
        fov = Math.min(110, Math.max(50, parsed));
      }
    }

    // Sync UI
    fovInput.value = String(Math.round(fov));
    fovValue.textContent = String(Math.round(fov));

    // Apply to camera
    if (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    fovInput.addEventListener('input', () => {
      const newFov = Math.min(110, Math.max(50, parseFloat(fovInput.value) || 75));
      fovValue.textContent = String(Math.round(newFov));
      if (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) {
        camera.fov = newFov;
        camera.updateProjectionMatrix();
      }
      try { localStorage.setItem('fov', String(newFov)); } catch (e) { console.warn('menuNavigation: failed to save fov to localStorage', e); }
    });
  }

  // Navigation (Paintball only)
  const gotoPaintball = document.getElementById('gotoPaintball');
  const backFromPaintball = document.getElementById('backFromPaintball');

  if (gotoPaintball) gotoPaintball.addEventListener('click', () => {
    showOnlyMenu('paintballMenu');
    populateMapDropdown('paintballMapSelect');
  });
  if (backFromPaintball) backFromPaintball.addEventListener('click', () => showOnlyMenu('mainMenu'));

  // Training Range navigation
  const gotoTraining = document.getElementById('gotoTraining');
  const backFromTraining = document.getElementById('backFromTraining');
  const startTraining = document.getElementById('startTraining');

  if (gotoTraining) gotoTraining.addEventListener('click', () => showOnlyMenu('trainingMenu'));
  if (backFromTraining) backFromTraining.addEventListener('click', () => showOnlyMenu('mainMenu'));
  if (startTraining) {
    startTraining.addEventListener('click', () => {
      if (typeof window.startTrainingRange === 'function') {
        window.startTrainingRange();
      }
    });
  }

  // LAN menu navigation
  const gotoLAN = document.getElementById('gotoLAN');
  const backFromLAN = document.getElementById('backFromLAN');
  if (gotoLAN) gotoLAN.addEventListener('click', () => {
    showOnlyMenu('lanMenu');
    populateMapDropdown('lanMapSelect');
  });
  if (backFromLAN) backFromLAN.addEventListener('click', () => showOnlyMenu('mainMenu'));

  // Paintball (AI) start
  const startPaintball = document.getElementById('startPaintball');
  if (startPaintball) {
    startPaintball.addEventListener('click', () => {
      const sel = document.getElementById('paintballDifficulty');
      const difficulty = sel ? sel.value : 'Easy';
      const mapSel = document.getElementById('paintballMapSelect');
      const mapName = (mapSel && mapSel.value) ? mapSel.value : '__default__';
      if (typeof startPaintballGame !== 'function') return;

      if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
        fetchMapData(mapName).then(function (mapData) {
          startPaintballGame({ difficulty, _mapData: mapData });
        }).catch(function () {
          startPaintballGame({ difficulty });
        });
      } else {
        startPaintballGame({ difficulty });
      }
    });
  }

  // LAN host/join
  const hostLanBtn = document.getElementById('hostLanBtn');
  const joinLanBtn = document.getElementById('joinLanBtn');
  if (hostLanBtn) {
    hostLanBtn.addEventListener('click', () => {
      const roomIdEl = document.getElementById('roomId');
      const roomId = roomIdEl ? String(roomIdEl.value || '').trim() : '';
      const roundsToWin = parseInt((document.getElementById('roundsToWin') || {}).value, 10) || 2;
      const settings = { roundsToWin };
      const mapSel = document.getElementById('lanMapSelect');
      const mapName = (mapSel && mapSel.value) ? mapSel.value : '__default__';
      if (typeof hostLanGame === 'function') {
        hostLanGame(roomId, settings, mapName);
      } else {
        alert('Multiplayer module not loaded.');
      }
    });
  }
  if (joinLanBtn) {
    joinLanBtn.addEventListener('click', () => {
      const roomIdEl = document.getElementById('roomId');
      const roomId = roomIdEl ? String(roomIdEl.value || '').trim() : '';
      if (typeof joinLanGame === 'function') {
        joinLanGame(roomId);
      } else {
        alert('Multiplayer module not loaded.');
      }
    });
  }

  // Results screen
  const backToMenu = document.getElementById('backToMenu');
  if (backToMenu) {
    backToMenu.addEventListener('click', () => {
      // If paintball is running, stop it
      try {
        if (typeof stopPaintballInternal === 'function') stopPaintballInternal();
      } catch (e) { console.warn('menuNavigation: failed to stop paintball game', e); }
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });
  }
}

function setHUDVisible(visible) {
  const ui = document.getElementById('ui');
  const crosshair = document.getElementById('crosshair');
  if (ui) ui.classList.toggle('hidden', !visible);
  if (crosshair) crosshair.classList.toggle('hidden', !visible);
}

function populateMapDropdown(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  // Keep only the default option
  sel.innerHTML = '<option value="__default__">Default Arena</option>';
  if (typeof fetchMapList !== 'function') return;
  fetchMapList().then(function (names) {
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }).catch(function (e) { console.warn('menuNavigation: failed to fetch map list', e); });
}

function showOnlyMenu(idOrNull) {
  const menus = document.querySelectorAll('.menu');
  menus.forEach(m => m.classList.add('hidden'));
  if (idOrNull) {
    const el = document.getElementById(idOrNull);
    if (el) el.classList.remove('hidden');
  }
}
