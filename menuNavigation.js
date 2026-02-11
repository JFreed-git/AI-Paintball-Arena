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

  // Post-match results buttons
  var postMatchToLobby = document.getElementById('postMatchToLobby');
  var postMatchToMenu = document.getElementById('postMatchToMenu');
  if (postMatchToLobby) {
    postMatchToLobby.addEventListener('click', function () {
      // Return to lobby if we have lobby state
      if (window._lobbyState && window._lobbyState.roomId) {
        showOnlyMenu('lobbyMenu');
      } else {
        showOnlyMenu('mainMenu');
      }
      setHUDVisible(false);
    });
  }
  if (postMatchToMenu) {
    postMatchToMenu.addEventListener('click', function () {
      lobbyCleanup();
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });
  }

  // ── FFA Lobby ──
  bindLobbyUI();
}

// Lobby module state
window._lobbyState = null;

function lobbyCleanup() {
  if (window._lobbySocket) {
    try { window._lobbySocket.emit('leaveRoom'); } catch (e) {}
  }
  window._lobbyState = null;
}

function bindLobbyUI() {
  var lobbyReadyBtn = document.getElementById('lobbyReadyBtn');
  var lobbyStartBtn = document.getElementById('lobbyStartBtn');
  var lobbyBackBtn = document.getElementById('lobbyBackBtn');

  // FFA sub-menu navigation
  var gotoFFA = document.getElementById('gotoFFA');
  var backFromFFA = document.getElementById('backFromFFA');
  var ffaCreateBtn = document.getElementById('ffaCreateBtn');
  var ffaJoinBtn = document.getElementById('ffaJoinBtn');

  if (gotoFFA) gotoFFA.addEventListener('click', function () {
    showOnlyMenu('ffaMenu');
  });
  if (backFromFFA) backFromFFA.addEventListener('click', function () {
    showOnlyMenu('mainMenu');
  });
  if (ffaCreateBtn) ffaCreateBtn.addEventListener('click', function () {
    showOnlyMenu('lobbyMenu');
    populateMapDropdown('lobbyMapSelect');
    lobbyShowAsHost();
  });
  if (ffaJoinBtn) ffaJoinBtn.addEventListener('click', function () {
    var roomIdEl = document.getElementById('ffaRoomId');
    var roomId = roomIdEl ? String(roomIdEl.value || '').trim() : '';
    if (!roomId) { alert('Please enter a Room ID to join'); return; }
    window.lobbyJoinRoom(roomId);
  });

  // Ready button
  if (lobbyReadyBtn) {
    lobbyReadyBtn.addEventListener('click', function () {
      if (!window._lobbyState || window._lobbyState.isHost) return;
      window._lobbyState.ready = !window._lobbyState.ready;
      lobbyReadyBtn.textContent = window._lobbyState.ready ? 'Unready' : 'Ready';
      lobbyReadyBtn.classList.toggle('is-ready', window._lobbyState.ready);
      if (window._lobbySocket) {
        window._lobbySocket.emit('setReady', window._lobbyState.roomId, window._lobbyState.ready);
      }
    });
  }

  // Start button (host only)
  if (lobbyStartBtn) {
    lobbyStartBtn.addEventListener('click', function () {
      if (!window._lobbyState || !window._lobbyState.isHost) return;
      if (!window._lobbySocket) return;
      window._lobbySocket.emit('startGame', window._lobbyState.roomId, function (res) {
        if (!res || !res.ok) {
          alert(res && res.error ? res.error : 'Cannot start game');
          return;
        }
        // Start FFA mode
        launchFFAFromLobby();
      });
    });
  }

  // Back button
  if (lobbyBackBtn) {
    lobbyBackBtn.addEventListener('click', function () {
      lobbyCleanup();
      showOnlyMenu('mainMenu');
    });
  }
}

function lobbyEnsureSocket() {
  if (window._lobbySocket) return window._lobbySocket;
  if (typeof io !== 'function') {
    alert('Socket.IO client not found. Make sure the server is running.');
    return null;
  }
  var sock = io();
  window._lobbySocket = sock;

  sock.on('playerList', function (list) {
    if (!window._lobbyState) return;
    window._lobbyState.playerList = list;
    lobbyRenderPlayerList(list);
    lobbyUpdateStartButton(list);
  });

  sock.on('roomClosed', function () {
    alert('Host left. Room closed.');
    lobbyCleanup();
    showOnlyMenu('mainMenu');
  });

  sock.on('gameStarted', function (payload) {
    if (!window._lobbyState) return;
    if (!window._lobbyState.isHost) {
      // Client: transition to FFA
      launchFFAFromLobby();
    }
  });

  return sock;
}

function lobbyShowAsHost() {
  window._lobbyState = {
    roomId: generateRoomId(),
    isHost: true,
    ready: true,
    playerList: []
  };
  var roomIdEl = document.getElementById('lobbyRoomId');
  if (roomIdEl) roomIdEl.textContent = window._lobbyState.roomId;

  // Show host-only elements
  var hostOnlyEls = document.querySelectorAll('#lobbyMenu .host-only');
  hostOnlyEls.forEach(function (el) { el.style.display = ''; });

  // Hide ready button for host, show start button
  var readyBtn = document.getElementById('lobbyReadyBtn');
  var startBtn = document.getElementById('lobbyStartBtn');
  if (readyBtn) readyBtn.style.display = 'none';
  if (startBtn) startBtn.style.display = '';

  // Create room on server
  var sock = lobbyEnsureSocket();
  if (!sock) return;

  var killLimitEl = document.getElementById('lobbyKillLimit');
  var maxPlayersEl = document.getElementById('lobbyMaxPlayers');
  var mapSelectEl = document.getElementById('lobbyMapSelect');

  var settings = {
    killLimit: killLimitEl ? parseInt(killLimitEl.value, 10) || 10 : 10,
    maxPlayers: maxPlayersEl ? parseInt(maxPlayersEl.value, 10) || 8 : 8,
    mapName: (mapSelectEl && mapSelectEl.value) ? mapSelectEl.value : '__default__'
  };

  sock.emit('createRoom', window._lobbyState.roomId, settings, function (res) {
    if (!res || !res.ok) {
      alert(res && res.error ? res.error : 'Failed to create room');
      showOnlyMenu('mainMenu');
      return;
    }
  });
}

// Expose for external use (e.g., joining from a URL or button)
window.lobbyJoinRoom = function (roomId) {
  if (!roomId) { alert('Please enter a Room ID'); return; }
  window._lobbyState = {
    roomId: roomId,
    isHost: false,
    ready: false,
    playerList: []
  };

  showOnlyMenu('lobbyMenu');
  var roomIdEl = document.getElementById('lobbyRoomId');
  if (roomIdEl) roomIdEl.textContent = roomId;

  // Hide host-only elements
  var hostOnlyEls = document.querySelectorAll('#lobbyMenu .host-only');
  hostOnlyEls.forEach(function (el) { el.style.display = 'none'; });

  // Show ready button, hide start button
  var readyBtn = document.getElementById('lobbyReadyBtn');
  var startBtn = document.getElementById('lobbyStartBtn');
  if (readyBtn) { readyBtn.style.display = ''; readyBtn.textContent = 'Ready'; readyBtn.classList.remove('is-ready'); }
  if (startBtn) startBtn.style.display = 'none';

  var sock = lobbyEnsureSocket();
  if (!sock) return;

  sock.emit('joinRoom', roomId, function (res) {
    if (!res || !res.ok) {
      alert(res && res.error ? res.error : 'Failed to join room');
      showOnlyMenu('mainMenu');
      return;
    }
  });
};

function lobbyRenderPlayerList(list) {
  var container = document.getElementById('lobbyPlayerList');
  if (!container) return;
  var maxPlayers = 8;
  if (window._lobbyState && window._lobbyState.playerList) {
    var maxEl = document.getElementById('lobbyMaxPlayers');
    maxPlayers = maxEl ? parseInt(maxEl.value, 10) || 8 : 8;
  }

  container.innerHTML = '';

  for (var i = 0; i < maxPlayers; i++) {
    var row = document.createElement('div');
    row.className = 'player-row';

    if (i < list.length) {
      var p = list[i];
      row.classList.toggle('is-ready', !!p.ready);
      row.classList.toggle('is-host', !!p.isHost);

      var nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = p.name || 'Player';
      row.appendChild(nameSpan);

      var heroSpan = document.createElement('span');
      heroSpan.className = 'player-hero';
      heroSpan.textContent = ''; // Hero selection not yet chosen
      row.appendChild(heroSpan);

      var statusSpan = document.createElement('span');
      statusSpan.className = 'player-ready';
      if (p.isHost) {
        statusSpan.textContent = 'HOST';
        statusSpan.classList.add('host-badge');
      } else {
        statusSpan.textContent = p.ready ? 'READY' : '';
      }
      row.appendChild(statusSpan);
    } else {
      row.classList.add('empty-slot');
      var openSpan = document.createElement('span');
      openSpan.className = 'player-name';
      openSpan.textContent = 'Open Slot';
      row.appendChild(openSpan);
    }

    container.appendChild(row);
  }
}

function lobbyUpdateStartButton(list) {
  var startBtn = document.getElementById('lobbyStartBtn');
  if (!startBtn || !window._lobbyState || !window._lobbyState.isHost) return;

  var canStart = list.length >= 2;
  for (var i = 0; i < list.length; i++) {
    if (!list[i].isHost && !list[i].ready) {
      canStart = false;
      break;
    }
  }
  startBtn.disabled = !canStart;
  startBtn.style.opacity = canStart ? '1' : '0.5';
}

function launchFFAFromLobby() {
  if (!window._lobbyState) return;
  var ls = window._lobbyState;

  if (ls.isHost) {
    var killLimitEl = document.getElementById('lobbyKillLimit');
    var mapSelectEl = document.getElementById('lobbyMapSelect');
    var settings = {
      killLimit: killLimitEl ? parseInt(killLimitEl.value, 10) || 10 : 10,
      mapName: (mapSelectEl && mapSelectEl.value) ? mapSelectEl.value : '__default__'
    };
    if (typeof window.startFFAHost === 'function') {
      window.startFFAHost(ls.roomId, settings);
    }
  } else {
    // Client joining FFA — will be handled by joinFFAGame (Task 017)
    if (typeof window.joinFFAGame === 'function') {
      window.joinFFAGame(ls.roomId);
    } else {
      // Fallback: just hide menus and wait for host snapshot
      showOnlyMenu(null);
    }
  }
}

function generateRoomId() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var id = '';
  for (var i = 0; i < 5; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
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
  const menus = document.querySelectorAll('.menu, .menu-screen');
  menus.forEach(m => m.classList.add('hidden'));
  if (idOrNull) {
    const el = document.getElementById(idOrNull);
    if (el) el.classList.remove('hidden');
  }
}

// UI click sound — single delegated handler on all menu buttons
(function () {
  document.addEventListener('click', function (e) {
    if (e.target.tagName === 'BUTTON' && (e.target.closest('.menu') || e.target.closest('.menu-screen'))) {
      if (typeof playGameSound === 'function') playGameSound('ui_click');
    }
  });
})();
