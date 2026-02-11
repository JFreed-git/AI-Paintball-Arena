/**
 * menuNavigation.js — Menu DOM management and settings
 *
 * PURPOSE: Handles menu toggling, game setup, lobby, settings persistence
 * (sensitivity, FOV), and HUD visibility toggling. Bridges the DOM menu system
 * with game mode start functions.
 *
 * EXPORTS (window):
 *   bindUI()               — initialize menu event listeners (called by game.js)
 *   showOnlyMenu(id)       — show one menu, hide all others
 *   setHUDVisible(visible) — toggle all HUD elements
 *   lobbyJoinRoom(id, cb)  — join a lobby room by code
 *
 * DEPENDENCIES: modeTraining.js, modeFFA.js (start/stop functions)
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

  // Start Game sub-menu navigation
  var gotoStartGame = document.getElementById('gotoStartGame');
  var gotoHostGame = document.getElementById('gotoHostGame');
  var gotoJoinGame = document.getElementById('gotoJoinGame');
  var joinRoomSubmit = document.getElementById('joinRoomSubmit');
  var backFromStartGame = document.getElementById('backFromStartGame');

  if (gotoStartGame) gotoStartGame.addEventListener('click', function () {
    showOnlyMenu('startGameMenu');
    // Reset join room section when entering
    var joinSection = document.getElementById('joinRoomSection');
    if (joinSection) joinSection.classList.add('hidden');
  });
  if (gotoHostGame) gotoHostGame.addEventListener('click', function () {
    showOnlyMenu('gameSetupMenu');
    initGameSetup();
  });
  if (gotoJoinGame) gotoJoinGame.addEventListener('click', function () {
    var joinSection = document.getElementById('joinRoomSection');
    if (joinSection) {
      joinSection.classList.toggle('hidden');
      if (!joinSection.classList.contains('hidden')) {
        var codeInput = document.getElementById('joinRoomCode');
        if (codeInput) codeInput.focus();
      }
    }
    // Clear any previous error
    var errEl = document.getElementById('joinRoomError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  });

  // Join room submit
  function submitJoinRoom() {
    var codeInput = document.getElementById('joinRoomCode');
    var errEl = document.getElementById('joinRoomError');
    if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }

    var code = codeInput ? codeInput.value.trim().toUpperCase() : '';
    if (!code) {
      if (errEl) { errEl.textContent = 'Please enter a room code'; errEl.classList.remove('hidden'); }
      return;
    }

    window.lobbyJoinRoom(code, function (err) {
      if (err && errEl) {
        errEl.textContent = err;
        errEl.classList.remove('hidden');
      }
    });
  }

  if (joinRoomSubmit) joinRoomSubmit.addEventListener('click', submitJoinRoom);

  var joinRoomCodeInput = document.getElementById('joinRoomCode');
  if (joinRoomCodeInput) {
    joinRoomCodeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitJoinRoom();
      }
    });
  }

  if (backFromStartGame) backFromStartGame.addEventListener('click', function () {
    showOnlyMenu('mainMenu');
  });

  // ── Game Setup Screen Logic ──

  var _gameSetupMaps = [];
  var _gameSetupSelected = null;

  function initGameSetup() {
    var mapGrid = document.getElementById('mapGrid');
    if (!mapGrid) return;
    mapGrid.innerHTML = '<div style="color:#666;padding:20px;text-align:center;">Loading maps...</div>';
    _gameSetupMaps = [];
    _gameSetupSelected = null;

    var defaultMapData = typeof getDefaultMapData === 'function' ? getDefaultMapData() : null;
    var defaultEntry = {
      name: 'Default Arena',
      mapData: defaultMapData,
      maxPlayers: defaultMapData ? (typeof getMapMaxPlayers === 'function' ? getMapMaxPlayers(defaultMapData) : 2) : 6,
      supportedModes: (defaultMapData && defaultMapData.supportedModes) || ['ffa']
    };

    _fetchServerMaps(function (serverMaps) {
      _gameSetupMaps = [defaultEntry].concat(serverMaps);
      _renderMapCards();
    });
  }

  function _fetchServerMaps(callback) {
    if (typeof fetchMapList !== 'function') { callback([]); return; }
    fetchMapList().then(function (names) {
      if (!names || !names.length) { callback([]); return; }
      var entries = [];
      var pending = names.length;
      names.forEach(function (name) {
        fetchMapData(name).then(function (mapData) {
          entries.push({
            name: mapData.name || name,
            mapData: mapData,
            maxPlayers: typeof getMapMaxPlayers === 'function' ? getMapMaxPlayers(mapData) : 2,
            supportedModes: mapData.supportedModes || ['ffa']
          });
          if (--pending === 0) callback(entries);
        }).catch(function () {
          if (--pending === 0) callback(entries);
        });
      });
    }).catch(function () { callback([]); });
  }

  function _renderMapCards() {
    var mapGrid = document.getElementById('mapGrid');
    if (!mapGrid) return;
    mapGrid.innerHTML = '';
    if (_gameSetupMaps.length === 0) {
      mapGrid.innerHTML = '<div style="color:#666;padding:20px;">No maps available</div>';
      return;
    }
    _gameSetupMaps.forEach(function (entry, idx) {
      var card = document.createElement('div');
      card.className = 'map-card';
      card.setAttribute('data-map-idx', String(idx));

      var thumb = document.createElement('div');
      thumb.className = 'map-card-thumb';
      thumb.textContent = 'Generating...';

      var badge = document.createElement('div');
      badge.className = 'map-card-badge';
      badge.textContent = entry.maxPlayers + 'P';

      var info = document.createElement('div');
      info.className = 'map-card-info';
      var nameEl = document.createElement('div');
      nameEl.className = 'map-card-name';
      nameEl.textContent = entry.name;
      var modesEl = document.createElement('div');
      modesEl.className = 'map-card-modes';
      modesEl.textContent = entry.supportedModes.join(', ').toUpperCase();
      info.appendChild(nameEl);
      info.appendChild(modesEl);

      card.appendChild(thumb);
      card.appendChild(badge);
      card.appendChild(info);
      mapGrid.appendChild(card);

      card.addEventListener('click', function () { _selectMapCard(idx); });

      if (entry.mapData && typeof generateMapThumbnail === 'function') {
        generateMapThumbnail(entry.mapData, function (dataURL) {
          if (dataURL) {
            var img = document.createElement('img');
            img.src = dataURL;
            img.alt = entry.name;
            thumb.textContent = '';
            thumb.appendChild(img);
          } else {
            thumb.textContent = 'No preview';
          }
        });
      } else {
        thumb.textContent = 'No preview';
      }
    });
    _selectMapCard(0);
  }

  function _selectMapCard(idx) {
    _gameSetupSelected = _gameSetupMaps[idx] || null;
    var mapGrid = document.getElementById('mapGrid');
    if (mapGrid) {
      var cards = mapGrid.querySelectorAll('.map-card');
      cards.forEach(function (c, i) { c.classList.toggle('selected', i === idx); });
    }
    var modeSelect = document.getElementById('setupMode');
    if (modeSelect && _gameSetupSelected) {
      var modes = _gameSetupSelected.supportedModes || ['ffa'];
      var modeLabels = { ffa: 'Free-For-All', tdm: 'Team Deathmatch', ctf: 'Capture the Flag' };
      modeSelect.innerHTML = '';
      modes.forEach(function (mode) {
        var opt = document.createElement('option');
        opt.value = mode;
        opt.textContent = modeLabels[mode] || mode.toUpperCase();
        modeSelect.appendChild(opt);
      });
    }
  }

  var setupBack = document.getElementById('setupBack');
  var setupBackBottom = document.getElementById('setupBackBottom');
  if (setupBack) setupBack.addEventListener('click', function () { showOnlyMenu('startGameMenu'); });
  if (setupBackBottom) setupBackBottom.addEventListener('click', function () { showOnlyMenu('startGameMenu'); });

  var setupCreateGame = document.getElementById('setupCreateGame');
  if (setupCreateGame) setupCreateGame.addEventListener('click', function () {
    if (!_gameSetupSelected) return;
    var modeSelect = document.getElementById('setupMode');
    var roundsInput = document.getElementById('setupRounds');
    var killLimitInput = document.getElementById('setupKillLimit');
    window.gameSetupConfig = {
      mapName: _gameSetupSelected.name,
      mapData: _gameSetupSelected.mapData,
      mode: modeSelect ? modeSelect.value : 'ffa',
      rounds: roundsInput ? parseInt(roundsInput.value, 10) || 3 : 3,
      killLimit: killLimitInput ? parseInt(killLimitInput.value, 10) || 10 : 10,
      maxPlayers: _gameSetupSelected.maxPlayers
    };
    showOnlyMenu('lobbyMenu');
    lobbyShowAsHost();
  });

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
    try { window._lobbySocket.disconnect(); } catch (e) {}
    window._lobbySocket = null;
  }
  window._lobbyState = null;
}

function bindLobbyUI() {
  var lobbyReadyBtn = document.getElementById('lobbyReadyBtn');
  var lobbyStartBtn = document.getElementById('lobbyStartBtn');
  var lobbyBackBtn = document.getElementById('lobbyBackBtn');

  // Ready button (non-host only)
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

  // Start button — always enabled for host (solo + AI is valid)
  if (lobbyStartBtn) {
    lobbyStartBtn.addEventListener('click', function () {
      if (!window._lobbyState || !window._lobbyState.isHost) return;
      if (!window._lobbySocket) return;
      window._lobbySocket.emit('startGame', window._lobbyState.roomId, function (res) {
        if (!res || !res.ok) {
          alert(res && res.error ? res.error : 'Cannot start game');
          return;
        }
        launchFFAFromLobby();
      });
    });
  }

  // Back button — return to game setup
  if (lobbyBackBtn) {
    lobbyBackBtn.addEventListener('click', function () {
      lobbyCleanup();
      showOnlyMenu('gameSetupMenu');
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
    lobbyRenderSlots();
  });

  sock.on('roomClosed', function () {
    alert('Host left. Room closed.');
    lobbyCleanup();
    showOnlyMenu('gameSetupMenu');
  });

  sock.on('gameStarted', function (payload) {
    if (!window._lobbyState) return;
    if (!window._lobbyState.isHost) {
      launchFFAFromLobby();
    }
  });

  return sock;
}

// Get max players from gameSetupConfig or lobbyState fallback
function lobbyGetMaxPlayers() {
  if (window._lobbyState && window._lobbyState.maxPlayers) return window._lobbyState.maxPlayers;
  var cfg = window.gameSetupConfig;
  if (cfg && cfg.maxPlayers) return cfg.maxPlayers;
  if (cfg && cfg.mapData && cfg.mapData.maxPlayers) return cfg.mapData.maxPlayers;
  return 6;
}

// Get hero names for AI dropdown
function lobbyGetHeroNames() {
  var heroes = window.HEROES || [];
  var names = [];
  for (var i = 0; i < heroes.length; i++) {
    if (heroes[i] && heroes[i].id && heroes[i].name) {
      names.push({ id: heroes[i].id, name: heroes[i].name });
    }
  }
  return names;
}

// Show lobby as host — called from game setup "Create Game" flow
function lobbyShowAsHost() {
  var cfg = window.gameSetupConfig || {};
  var maxPlayers = cfg.maxPlayers || (cfg.mapData && cfg.mapData.maxPlayers) || 6;

  window._lobbyState = {
    roomId: generateRoomId(),
    isHost: true,
    ready: true,
    playerList: [],
    aiSlots: {},
    maxPlayers: maxPlayers,
    joinedFrom: 'gameSetupMenu'
  };

  // Update header info
  var mapNameEl = document.getElementById('lobbyMapName');
  var modeBadgeEl = document.getElementById('lobbyModeBadge');
  var roomIdEl = document.getElementById('lobbyRoomId');
  if (mapNameEl) mapNameEl.textContent = cfg.mapName || 'Default Arena';
  if (modeBadgeEl) modeBadgeEl.textContent = (cfg.mode || 'ffa').toUpperCase();
  if (roomIdEl) roomIdEl.textContent = window._lobbyState.roomId;

  // Show start button, hide ready button (host doesn't need ready)
  var readyBtn = document.getElementById('lobbyReadyBtn');
  var startBtn = document.getElementById('lobbyStartBtn');
  if (readyBtn) readyBtn.classList.add('hidden');
  if (startBtn) startBtn.classList.remove('hidden');

  // Render initial slots
  lobbyRenderSlots();

  // Create room on server
  var sock = lobbyEnsureSocket();
  if (!sock) return;

  var settings = {
    killLimit: cfg.killLimit || 10,
    maxPlayers: maxPlayers,
    mapName: cfg.mapName || '__default__',
    rounds: cfg.rounds || 3
  };

  sock.emit('createRoom', window._lobbyState.roomId, settings, function (res) {
    if (!res || !res.ok) {
      alert(res && res.error ? res.error : 'Failed to create room');
      lobbyCleanup();
      showOnlyMenu('gameSetupMenu');
      return;
    }
    if (res.roomId) {
      window._lobbyState.roomId = res.roomId;
      if (roomIdEl) roomIdEl.textContent = res.roomId;
    }
  });
}

// Expose for external use (joining from join room input)
window.lobbyJoinRoom = function (roomId, onError) {
  if (!roomId) {
    if (onError) onError('Please enter a Room Code');
    else alert('Please enter a Room Code');
    return;
  }
  window._lobbyState = {
    roomId: roomId,
    isHost: false,
    ready: false,
    playerList: [],
    aiSlots: {},
    maxPlayers: 6,
    joinedFrom: 'startGameMenu'
  };

  var sock = lobbyEnsureSocket();
  if (!sock) return;

  sock.emit('joinRoom', roomId, function (res) {
    if (!res || !res.ok) {
      var errMsg = (res && res.error) ? res.error : 'Failed to join room';
      window._lobbyState = null;
      if (onError) onError(errMsg);
      else alert(errMsg);
      return;
    }

    if (res.settings && res.settings.maxPlayers) {
      window._lobbyState.maxPlayers = res.settings.maxPlayers;
    }

    showOnlyMenu('lobbyMenu');
    var roomIdEl = document.getElementById('lobbyRoomId');
    if (roomIdEl) roomIdEl.textContent = roomId;

    var mapNameEl = document.getElementById('lobbyMapName');
    var modeBadgeEl = document.getElementById('lobbyModeBadge');
    if (mapNameEl) mapNameEl.textContent = (res.settings && res.settings.mapName) || 'Game';
    if (modeBadgeEl) modeBadgeEl.textContent = 'FFA';

    var readyBtn = document.getElementById('lobbyReadyBtn');
    var startBtn = document.getElementById('lobbyStartBtn');
    if (readyBtn) { readyBtn.classList.remove('hidden'); readyBtn.textContent = 'Ready'; readyBtn.classList.remove('is-ready'); }
    if (startBtn) startBtn.classList.add('hidden');

    lobbyRenderSlots();
  });
};

// Render all player/AI slots in the lobby
function lobbyRenderSlots() {
  var container = document.getElementById('lobbyPlayerList');
  if (!container || !window._lobbyState) return;

  var ls = window._lobbyState;
  var maxPlayers = ls.maxPlayers || 6;
  var playerList = ls.playerList || [];
  var aiSlots = ls.aiSlots || {};
  var isHost = ls.isHost;

  container.innerHTML = '';

  // Map players: slot 0 = host, rest = remote players in order
  var slotPlayers = {};
  for (var p = 0; p < playerList.length; p++) {
    if (playerList[p].isHost) {
      slotPlayers[0] = playerList[p];
    }
  }
  var nextSlot = 1;
  for (var p2 = 0; p2 < playerList.length; p2++) {
    if (!playerList[p2].isHost) {
      // Bump AI from this slot if needed
      if (aiSlots[nextSlot]) delete aiSlots[nextSlot];
      slotPlayers[nextSlot] = playerList[p2];
      nextSlot++;
    }
  }

  for (var i = 0; i < maxPlayers; i++) {
    var row = document.createElement('div');
    row.className = 'player-row';

    var player = slotPlayers[i];
    var ai = aiSlots[i];

    if (i === 0 && isHost) {
      // Slot 0: Host player
      row.classList.add('is-host');
      var hostName = document.createElement('span');
      hostName.className = 'player-name';
      var savedName = null;
      try { savedName = localStorage.getItem('playerName'); } catch (e) {}
      hostName.textContent = savedName || 'Player 1';
      row.appendChild(hostName);

      var hostBadge = document.createElement('span');
      hostBadge.className = 'player-ready host-badge';
      hostBadge.textContent = 'HOST';
      row.appendChild(hostBadge);
    } else if (player) {
      // Remote player
      row.classList.toggle('is-ready', !!player.ready);
      var pName = document.createElement('span');
      pName.className = 'player-name';
      pName.textContent = player.name || 'Player';
      row.appendChild(pName);

      var pStatus = document.createElement('span');
      pStatus.className = 'player-ready';
      pStatus.textContent = player.ready ? 'READY' : '';
      if (player.ready) pStatus.classList.add('is-ready');
      row.appendChild(pStatus);
    } else if (ai) {
      // AI slot
      row.classList.add('ai-slot');
      lobbyRenderAISlot(row, i, ai, isHost);
    } else {
      // Empty slot
      row.classList.add('empty-slot');
      if (isHost) {
        var addBtn = document.createElement('button');
        addBtn.className = 'ai-add-btn';
        addBtn.textContent = '+ Add AI';
        addBtn.setAttribute('data-slot', String(i));
        addBtn.addEventListener('click', function () {
          var slotIdx = parseInt(this.getAttribute('data-slot'), 10);
          lobbyAddAI(slotIdx);
        });
        row.appendChild(addBtn);
      } else {
        var openSpan = document.createElement('span');
        openSpan.className = 'player-name';
        openSpan.textContent = 'Open Slot';
        row.appendChild(openSpan);
      }
    }

    container.appendChild(row);
  }
}

// Render AI config controls inside a slot row
function lobbyRenderAISlot(row, slotIndex, aiConfig, isHost) {
  var nameSpan = document.createElement('span');
  nameSpan.className = 'player-name';
  nameSpan.textContent = 'AI Bot';
  row.appendChild(nameSpan);

  if (isHost) {
    // Hero dropdown
    var heroSel = document.createElement('select');
    heroSel.className = 'ai-hero-select';
    heroSel.setAttribute('data-slot', String(slotIndex));

    var randomOpt = document.createElement('option');
    randomOpt.value = 'random';
    randomOpt.textContent = 'Random';
    heroSel.appendChild(randomOpt);

    var heroes = lobbyGetHeroNames();
    for (var h = 0; h < heroes.length; h++) {
      var opt = document.createElement('option');
      opt.value = heroes[h].id;
      opt.textContent = heroes[h].name;
      heroSel.appendChild(opt);
    }
    heroSel.value = aiConfig.hero || 'random';
    heroSel.addEventListener('change', function () {
      var idx = parseInt(this.getAttribute('data-slot'), 10);
      if (window._lobbyState && window._lobbyState.aiSlots[idx]) {
        window._lobbyState.aiSlots[idx].hero = this.value;
      }
    });
    row.appendChild(heroSel);

    // Difficulty dropdown
    var diffSel = document.createElement('select');
    diffSel.className = 'ai-diff-select';
    diffSel.setAttribute('data-slot', String(slotIndex));

    var diffs = ['Easy', 'Medium', 'Hard'];
    for (var d = 0; d < diffs.length; d++) {
      var dOpt = document.createElement('option');
      dOpt.value = diffs[d];
      dOpt.textContent = diffs[d];
      diffSel.appendChild(dOpt);
    }
    diffSel.value = aiConfig.difficulty || 'Medium';
    diffSel.addEventListener('change', function () {
      var idx = parseInt(this.getAttribute('data-slot'), 10);
      if (window._lobbyState && window._lobbyState.aiSlots[idx]) {
        window._lobbyState.aiSlots[idx].difficulty = this.value;
      }
    });
    row.appendChild(diffSel);

    // Remove button
    var removeBtn = document.createElement('button');
    removeBtn.className = 'ai-remove-btn';
    removeBtn.textContent = 'X';
    removeBtn.setAttribute('data-slot', String(slotIndex));
    removeBtn.addEventListener('click', function () {
      var idx = parseInt(this.getAttribute('data-slot'), 10);
      lobbyRemoveAI(idx);
    });
    row.appendChild(removeBtn);
  } else {
    var infoSpan = document.createElement('span');
    infoSpan.className = 'player-ready';
    infoSpan.textContent = (aiConfig.difficulty || 'Medium') + ' AI';
    infoSpan.style.color = '#55bbff';
    row.appendChild(infoSpan);
  }
}

function lobbyAddAI(slotIndex) {
  if (!window._lobbyState || !window._lobbyState.isHost) return;
  window._lobbyState.aiSlots[slotIndex] = { hero: 'random', difficulty: 'Medium' };
  lobbyRenderSlots();
}

function lobbyRemoveAI(slotIndex) {
  if (!window._lobbyState || !window._lobbyState.isHost) return;
  delete window._lobbyState.aiSlots[slotIndex];
  lobbyRenderSlots();
}

// Collect all slot configs for game start
function lobbyCollectSlotConfigs() {
  if (!window._lobbyState) return { players: [], aiConfigs: [] };
  var ls = window._lobbyState;
  var aiConfigs = [];
  var keys = Object.keys(ls.aiSlots || {});
  for (var i = 0; i < keys.length; i++) {
    var ai = ls.aiSlots[keys[i]];
    aiConfigs.push({ hero: ai.hero || 'random', difficulty: ai.difficulty || 'Medium' });
  }
  return { players: ls.playerList || [], aiConfigs: aiConfigs };
}

function launchFFAFromLobby() {
  if (!window._lobbyState) return;
  var ls = window._lobbyState;
  var cfg = window.gameSetupConfig || {};
  var slotData = lobbyCollectSlotConfigs();

  // Transfer lobby socket to FFA module to avoid duplicate connections
  var lobbySock = window._lobbySocket;
  window._lobbySocket = null;

  if (ls.isHost) {
    var settings = {
      killLimit: cfg.killLimit || 10,
      mapName: cfg.mapName || '__default__',
      rounds: cfg.rounds || 3,
      aiConfigs: slotData.aiConfigs
    };
    if (typeof window.startFFAHost === 'function') {
      window.startFFAHost(ls.roomId, settings, lobbySock);
    }
  } else {
    if (typeof window.joinFFAGame === 'function') {
      window.joinFFAGame(ls.roomId, lobbySock);
    } else {
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
