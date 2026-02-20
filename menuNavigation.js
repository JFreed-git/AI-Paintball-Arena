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
  // Player Name: load, display, and wire
  var playerNameInput = document.getElementById('playerNameInput');
  if (playerNameInput) {
    var savedName = null;
    try { savedName = localStorage.getItem('playerName'); } catch (e) { console.warn('menuNavigation: failed to read playerName from localStorage', e); }
    if (savedName !== null) {
      playerNameInput.value = savedName;
    }
    playerNameInput.addEventListener('input', function () {
      try { localStorage.setItem('playerName', playerNameInput.value); } catch (e) { console.warn('menuNavigation: failed to save playerName to localStorage', e); }
    });
    playerNameInput.addEventListener('blur', function () {
      try { localStorage.setItem('playerName', playerNameInput.value); } catch (e) { console.warn('menuNavigation: failed to save playerName to localStorage', e); }
    });
  }

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
      supportedModes: (defaultMapData && defaultMapData.supportedModes) ? defaultMapData.supportedModes : (defaultMapData && defaultMapData.spawns && typeof normalizeSpawns === 'function') ? Object.keys(normalizeSpawns(defaultMapData.spawns)) : ['ffa']
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
            supportedModes: mapData.supportedModes ? mapData.supportedModes : (mapData.spawns && typeof normalizeSpawns === 'function') ? Object.keys(normalizeSpawns(mapData.spawns)) : ['ffa']
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

  function _updateSelectedBadgeForMode(mode) {
    if (!_gameSetupSelected || !_gameSetupSelected.mapData) return;
    var mapGrid = document.getElementById('mapGrid');
    if (!mapGrid) return;
    var selectedCard = mapGrid.querySelector('.map-card.selected');
    if (!selectedCard) return;
    var badge = selectedCard.querySelector('.map-card-badge');
    if (!badge) return;
    var count = (typeof getMapMaxPlayers === 'function')
      ? getMapMaxPlayers(_gameSetupSelected.mapData, mode)
      : _gameSetupSelected.maxPlayers;
    badge.textContent = count + 'P';
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
      // Update badge for the first mode
      _updateSelectedBadgeForMode(modeSelect.value);
      // Wire change event to update badge on mode switch
      modeSelect.onchange = function () {
        _updateSelectedBadgeForMode(modeSelect.value);
      };
    }
  }

  // Wire No Respawns checkbox to disable Kill Limit when checked
  var _setupNoRespawns = document.getElementById('setupNoRespawns');
  var _setupKillLimit = document.getElementById('setupKillLimit');
  if (_setupNoRespawns && _setupKillLimit) {
    _setupNoRespawns.addEventListener('change', function () {
      _setupKillLimit.disabled = _setupNoRespawns.checked;
      _setupKillLimit.style.opacity = _setupNoRespawns.checked ? '0.4' : '1';
    });
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
    var noRespawnsCheckbox = document.getElementById('setupNoRespawns');
    var selectedMode = modeSelect ? modeSelect.value : 'ffa';
    var maxPlayers = (typeof getMapMaxPlayers === 'function' && _gameSetupSelected.mapData)
      ? getMapMaxPlayers(_gameSetupSelected.mapData, selectedMode)
      : _gameSetupSelected.maxPlayers;
    window.gameSetupConfig = {
      mapName: _gameSetupSelected.name,
      mapData: _gameSetupSelected.mapData,
      mode: selectedMode,
      rounds: roundsInput ? parseInt(roundsInput.value, 10) || 3 : 3,
      killLimit: killLimitInput ? parseInt(killLimitInput.value, 10) || 10 : 10,
      maxPlayers: maxPlayers,
      noRespawns: noRespawnsCheckbox ? noRespawnsCheckbox.checked : false
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
      // If FFA is running, stop it
      try {
        if (typeof stopFFAInternal === 'function') stopFFAInternal();
      } catch (e) { console.warn('menuNavigation: failed to stop FFA game', e); }
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
    if (!window._lobbyState.isHost) {
      // Non-host: sync team assignments from server data
      var ta = {};
      for (var i = 0; i < list.length; i++) {
        if (list[i].team) ta[list[i].id] = list[i].team;
      }
      window._lobbyState.teamAssignments = ta;
    } else {
      // Host: auto-assign new players to teams with available slots
      lobbyAutoAssignNewPlayers(list);
    }
    lobbyRenderSlots();
  });

  sock.on('roomClosed', function () {
    lobbyCleanup();
    showOnlyMenu('gameSetupMenu');
  });

  sock.on('hostTransfer', function (payload) {
    if (!window._lobbyState || !payload) return;
    if (payload.newHostId === sock.id) {
      window._lobbyState.isHost = true;
      // Show start button, hide ready button
      var readyBtn = document.getElementById('lobbyReadyBtn');
      var startBtn = document.getElementById('lobbyStartBtn');
      if (readyBtn) readyBtn.classList.add('hidden');
      if (startBtn) startBtn.classList.remove('hidden');
    }
    lobbyRenderSlots();
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

// Get available team numbers from map spawn data
function lobbyGetAvailableTeams() {
  var cfg = window.gameSetupConfig || {};
  var mapData = cfg.mapData;
  if (!mapData || !mapData.spawns) return [];
  var spawns = window.normalizeSpawns ? window.normalizeSpawns(mapData.spawns) : mapData.spawns;
  var mode = cfg.mode || 'ffa';
  var spawnList = (spawns && spawns[mode]) || (spawns && spawns.ffa) || [];
  if (Array.isArray(spawns)) spawnList = spawns;
  var teamSet = {};
  for (var i = 0; i < spawnList.length; i++) {
    var t = spawnList[i].team;
    if (t > 0) teamSet[t] = true;
  }
  var teams = Object.keys(teamSet).map(function (k) { return parseInt(k, 10); });
  teams.sort();
  return teams;
}

// Team label names
var TEAM_LABELS = { 0: 'Auto', 1: 'Team 1', 2: 'Team 2', 3: 'Team 3', 4: 'Team 4' };

// Create a team selector element for a player/AI in the lobby
function lobbyCreateTeamSelector(playerId, currentTeam, availableTeams, isHost) {
  if (!availableTeams || availableTeams.length === 0) return null;
  if (isHost) {
    var sel = document.createElement('select');
    sel.className = 'lobby-team-select';
    sel.setAttribute('data-player-id', playerId);
    var autoOpt = document.createElement('option');
    autoOpt.value = '0';
    autoOpt.textContent = 'Auto';
    sel.appendChild(autoOpt);
    for (var t = 0; t < availableTeams.length; t++) {
      var opt = document.createElement('option');
      opt.value = String(availableTeams[t]);
      opt.textContent = TEAM_LABELS[availableTeams[t]] || ('Team ' + availableTeams[t]);
      sel.appendChild(opt);
    }
    sel.value = String(currentTeam || 0);
    sel.addEventListener('change', function () {
      var pid = this.getAttribute('data-player-id');
      var team = parseInt(this.value, 10);
      if (window._lobbyState) {
        window._lobbyState.teamAssignments[pid] = team;
      }
      if (window._lobbySocket) {
        window._lobbySocket.emit('setPlayerTeam', pid, team);
      }
    });
    return sel;
  } else {
    if (currentTeam && currentTeam > 0) {
      var label = document.createElement('span');
      label.className = 'lobby-team-label';
      label.textContent = TEAM_LABELS[currentTeam] || ('Team ' + currentTeam);
      return label;
    }
    return null;
  }
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
    teamAssignments: {},
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
    rounds: cfg.rounds || 3,
    mode: cfg.mode || 'ffa',
    noRespawns: !!cfg.noRespawns,
    playerName: localStorage.getItem('playerName') || 'Player 1'
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
    teamAssignments: {},
    maxPlayers: 6,
    joinedFrom: 'startGameMenu'
  };

  var sock = lobbyEnsureSocket();
  if (!sock) return;

  sock.emit('joinRoom', roomId, localStorage.getItem('playerName') || 'Player', function (res) {
    if (!res || !res.ok) {
      var errMsg = (res && res.error) ? res.error : 'Failed to join room';
      window._lobbyState = null;
      if (onError) onError(errMsg);
      else alert(errMsg);
      return;
    }

    if (res.settings) {
      if (res.settings.maxPlayers) window._lobbyState.maxPlayers = res.settings.maxPlayers;
      window._lobbyState.serverSettings = res.settings;
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

// Team colors matching modeFFA.js TEAM_COLORS_HEX
var TEAM_COLORS_CSS = { 1: '#55aaff', 2: '#ff5555', 3: '#44ff44', 4: '#ff8844' };

// Count spawns per team from map data — determines max slots per team
function lobbyGetTeamCapacities() {
  var cfg = window.gameSetupConfig || {};
  var mapData = cfg.mapData;
  if (!mapData || !mapData.spawns) {
    // No spawn data: split maxPlayers evenly across default 2 teams
    var mp = (window._lobbyState && window._lobbyState.maxPlayers) || 6;
    var half = Math.ceil(mp / 2);
    return { 1: half, 2: half };
  }
  var spawns = window.normalizeSpawns ? window.normalizeSpawns(mapData.spawns) : mapData.spawns;
  var mode = cfg.mode || 'ffa';
  var spawnList = (spawns && spawns[mode]) || (spawns && spawns.ffa) || [];
  if (Array.isArray(spawns)) spawnList = spawns;
  var caps = {};
  for (var i = 0; i < spawnList.length; i++) {
    var t = spawnList[i].team;
    if (t > 0) caps[t] = (caps[t] || 0) + 1;
  }
  return caps;
}

// Count current members per team (humans + AIs)
function lobbyGetTeamCounts() {
  var ls = window._lobbyState;
  if (!ls) return {};
  var counts = {};
  var ta = ls.teamAssignments || {};
  var playerList = ls.playerList || [];
  for (var i = 0; i < playerList.length; i++) {
    if (playerList[i].isBot) continue;
    var team = ta[playerList[i].id] || playerList[i].team || 0;
    counts[team] = (counts[team] || 0) + 1;
  }
  var aiSlots = ls.aiSlots || {};
  var aiKeys = Object.keys(aiSlots);
  for (var j = 0; j < aiKeys.length; j++) {
    var aiTeam = aiSlots[aiKeys[j]].team || 0;
    counts[aiTeam] = (counts[aiTeam] || 0) + 1;
  }
  return counts;
}

// Find the team with the most remaining capacity; returns 0 if all full
function lobbyFindTeamWithRoom(availableTeams, capacities) {
  var counts = lobbyGetTeamCounts();
  var bestTeam = 0;
  var bestRemaining = 0;
  for (var i = 0; i < availableTeams.length; i++) {
    var t = availableTeams[i];
    var cap = capacities[t] || 0;
    var cur = counts[t] || 0;
    var remaining = cap - cur;
    if (remaining > bestRemaining) {
      bestRemaining = remaining;
      bestTeam = t;
    }
  }
  return bestTeam;
}

// Auto-assign unassigned human players to teams with room (host only)
function lobbyAutoAssignNewPlayers(list) {
  var ls = window._lobbyState;
  if (!ls || !ls.isHost) return;
  var ta = ls.teamAssignments;
  var capacities = lobbyGetTeamCapacities();
  var availableTeams = lobbyGetAvailableTeams();
  if (availableTeams.length === 0) availableTeams = [1, 2];

  // Clean up stale assignments for players who left
  var currentIds = {};
  for (var i = 0; i < list.length; i++) {
    if (!list[i].isBot) currentIds[list[i].id] = true;
  }
  var taKeys = Object.keys(ta);
  for (var j = 0; j < taKeys.length; j++) {
    if (!currentIds[taKeys[j]]) delete ta[taKeys[j]];
  }

  // Auto-assign players with no team assignment yet
  for (var k = 0; k < list.length; k++) {
    var p = list[k];
    if (p.isBot) continue;
    if (ta[p.id] !== undefined && ta[p.id] > 0) continue; // already assigned to a real team
    var bestTeam = lobbyFindTeamWithRoom(availableTeams, capacities);
    // If all teams are full, pick the team with the fewest members anyway
    if (bestTeam <= 0) bestTeam = lobbyFindSmallestTeam(availableTeams);
    if (bestTeam > 0) {
      ta[p.id] = bestTeam;
      if (window._lobbySocket) {
        window._lobbySocket.emit('setPlayerTeam', p.id, bestTeam);
      }
    }
  }
}

// Find the team with the fewest current members (ignoring capacity)
function lobbyFindSmallestTeam(availableTeams) {
  var counts = lobbyGetTeamCounts();
  var bestTeam = availableTeams[0] || 1;
  var bestCount = counts[bestTeam] || 0;
  for (var i = 1; i < availableTeams.length; i++) {
    var t = availableTeams[i];
    var c = counts[t] || 0;
    if (c < bestCount) {
      bestCount = c;
      bestTeam = t;
    }
  }
  return bestTeam;
}

// Check if the current game setup is FFA (no team spawns)
function lobbyIsFFA() {
  var cfg = window.gameSetupConfig || {};
  if (cfg.mode === 'ffa') return true;
  // Also check via server settings for non-host
  var ls = window._lobbyState;
  if (ls && ls.serverSettings && ls.serverSettings.mode === 'ffa') return true;
  return false;
}

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

  // Separate human players and bot entries from playerList
  var humanPlayers = [];
  var serverBots = [];
  for (var p = 0; p < playerList.length; p++) {
    if (playerList[p].isBot) {
      serverBots.push(playerList[p]);
    } else {
      humanPlayers.push(playerList[p]);
    }
  }

  // For non-host: rebuild aiSlots from server bot data (includes team)
  if (!isHost && serverBots.length > 0) {
    aiSlots = {};
    for (var sb = 0; sb < serverBots.length; sb++) {
      aiSlots[sb] = {
        hero: serverBots[sb].hero || 'random',
        difficulty: serverBots[sb].difficulty || 'Medium',
        team: serverBots[sb].team || 0
      };
    }
  }

  var aiKeys = Object.keys(aiSlots);
  var totalEntities = humanPlayers.length + aiKeys.length;

  // ── FFA mode: flat player list (no team sections) ──
  if (lobbyIsFFA()) {
    // Render all humans
    for (var h = 0; h < humanPlayers.length; h++) {
      var row = document.createElement('div');
      row.className = 'player-row';
      lobbyRenderHumanRow(row, humanPlayers[h]);
      container.appendChild(row);
    }
    // Render all AIs
    for (var a = 0; a < aiKeys.length; a++) {
      var aiKey = aiKeys[a];
      var ai = aiSlots[aiKey];
      var row2 = document.createElement('div');
      row2.className = 'player-row ai-slot';
      lobbyRenderAISlot(row2, parseInt(aiKey, 10), ai, isHost);
      container.appendChild(row2);
    }
    // Open slots
    for (var o = totalEntities; o < maxPlayers; o++) {
      var openRow = document.createElement('div');
      openRow.className = 'player-row lobby-open-slot';
      var openLabel = document.createElement('span');
      openLabel.className = 'player-name';
      openLabel.textContent = '(open)';
      openRow.appendChild(openLabel);
      container.appendChild(openRow);
    }
    // Add AI button
    if (isHost && totalEntities < maxPlayers) {
      var addBtn = document.createElement('button');
      addBtn.className = 'ai-add-btn';
      addBtn.textContent = '+ Add AI';
      addBtn.style.marginTop = '6px';
      addBtn.addEventListener('click', function () {
        lobbyAddAI();
      });
      container.appendChild(addBtn);
    }
    return;
  }

  // ── Team mode: team-sectioned layout ──
  var availableTeams = lobbyGetAvailableTeams();
  if (availableTeams.length === 0) availableTeams = [1, 2];

  // Categorize entities by team
  var teamMembers = {};
  for (var t = 0; t < availableTeams.length; t++) {
    teamMembers[availableTeams[t]] = [];
  }

  // Categorize humans
  for (var h2 = 0; h2 < humanPlayers.length; h2++) {
    var player = humanPlayers[h2];
    var pTeam = (ls.teamAssignments && ls.teamAssignments[player.id]) || player.team || 0;
    // If player is unassigned (team 0), auto-assign for display purposes
    if (pTeam === 0 || !teamMembers[pTeam]) {
      pTeam = availableTeams[0] || 1;
    }
    teamMembers[pTeam].push({ type: 'human', data: player });
  }

  // Categorize AIs
  for (var a2 = 0; a2 < aiKeys.length; a2++) {
    var aiKey2 = aiKeys[a2];
    var ai2 = aiSlots[aiKey2];
    var aiTeam = ai2.team || 0;
    if (aiTeam === 0 || !teamMembers[aiTeam]) {
      aiTeam = availableTeams[0] || 1;
    }
    teamMembers[aiTeam].push({ type: 'ai', slotIndex: parseInt(aiKey2, 10), data: ai2 });
  }

  var capacities = lobbyGetTeamCapacities();

  // Render each team section (no unassigned section)
  for (var ti = 0; ti < availableTeams.length; ti++) {
    var tn = availableTeams[ti];
    container.appendChild(lobbyCreateTeamSection(tn, teamMembers[tn] || [], isHost, maxPlayers, totalEntities, capacities[tn] || 0));
  }

  // Add AI button below team sections
  if (isHost && totalEntities < maxPlayers) {
    var addBtn2 = document.createElement('button');
    addBtn2.className = 'ai-add-btn';
    addBtn2.textContent = '+ Add AI';
    addBtn2.style.marginTop = '6px';
    addBtn2.addEventListener('click', function () {
      lobbyAddAI();
    });
    container.appendChild(addBtn2);
  }
}

// Create a single team section with header, player rows, drop targets, and open slot placeholders
function lobbyCreateTeamSection(teamNum, members, isHost, maxPlayers, totalEntities, capacity) {
  var isFull = teamNum > 0 && capacity > 0 && members.length >= capacity;

  var section = document.createElement('div');
  section.className = 'lobby-team-section';
  section.setAttribute('data-team', String(teamNum));

  // Header
  var header = document.createElement('div');
  header.className = 'lobby-team-header';

  var dot = document.createElement('span');
  dot.className = 'lobby-team-dot';
  dot.style.background = TEAM_COLORS_CSS[teamNum] || '#888';
  header.appendChild(dot);

  var title = document.createElement('span');
  title.textContent = TEAM_LABELS[teamNum] || ('Team ' + teamNum);
  header.appendChild(title);

  var count = document.createElement('span');
  count.className = 'lobby-team-count';
  if (capacity > 0) {
    count.textContent = members.length + '/' + capacity;
    if (isFull) count.style.color = '#ff8844';
  } else if (members.length > 0) {
    count.textContent = members.length;
  }
  header.appendChild(count);

  section.appendChild(header);

  // Players container
  var playersDiv = document.createElement('div');
  playersDiv.className = 'lobby-team-players';

  for (var m = 0; m < members.length; m++) {
    var member = members[m];
    var row = document.createElement('div');
    row.className = 'player-row';

    if (member.type === 'human') {
      lobbyRenderHumanRow(row, member.data);
    } else if (member.type === 'ai') {
      row.classList.add('ai-slot');
      lobbyRenderAISlot(row, member.slotIndex, member.data, isHost);
    }

    // Make draggable for host + enable row-level drop for swap
    if (isHost) {
      row.setAttribute('draggable', 'true');
      var dragId = member.type === 'human' ? ('human:' + member.data.id) : ('ai:' + member.slotIndex);
      row.setAttribute('data-drag-id', dragId);
      row.setAttribute('data-team', String(teamNum));
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', this.getAttribute('data-drag-id'));
        e.dataTransfer.effectAllowed = 'move';
        this.classList.add('dragging');
      });
      row.addEventListener('dragend', function () {
        this.classList.remove('dragging');
        var allRows = document.querySelectorAll('.player-row.drop-target');
        for (var r = 0; r < allRows.length; r++) allRows[r].classList.remove('drop-target');
        var allSections = document.querySelectorAll('.lobby-team-section');
        for (var s = 0; s < allSections.length; s++) allSections[s].classList.remove('drag-over');
      });
      // Row-level drop: swap teams with the dropped-on player
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        this.classList.add('drop-target');
      });
      row.addEventListener('dragleave', function (e) {
        if (!this.contains(e.relatedTarget)) {
          this.classList.remove('drop-target');
        }
      });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('drop-target');
        var sourceDragId = e.dataTransfer.getData('text/plain');
        var targetDragId = this.getAttribute('data-drag-id');
        if (sourceDragId && targetDragId && sourceDragId !== targetDragId) {
          lobbySwapTeams(sourceDragId, targetDragId);
        }
      });
    }

    playersDiv.appendChild(row);
  }

  // Render open placeholder rows for remaining capacity
  if (teamNum > 0 && capacity > 0) {
    var remaining = capacity - members.length;
    for (var r = 0; r < remaining; r++) {
      var openRow = document.createElement('div');
      openRow.className = 'player-row lobby-open-slot';
      var openLabel = document.createElement('span');
      openLabel.className = 'player-name';
      openLabel.textContent = '(open)';
      openRow.appendChild(openLabel);
      playersDiv.appendChild(openRow);
    }
  }

  section.appendChild(playersDiv);

  // Section-level drop target handlers (host only) — for dropping onto empty area
  if (isHost) {
    section.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      this.classList.add('drag-over');
    });
    section.addEventListener('dragleave', function (e) {
      if (!this.contains(e.relatedTarget)) {
        this.classList.remove('drag-over');
      }
    });
    section.addEventListener('drop', function (e) {
      e.preventDefault();
      this.classList.remove('drag-over');
      var dragData = e.dataTransfer.getData('text/plain');
      var targetTeam = parseInt(this.getAttribute('data-team'), 10);
      lobbyHandleTeamDrop(dragData, targetTeam);
    });
  }

  return section;
}

// Swap teams between two entities (player-on-player drop)
function lobbySwapTeams(dragIdA, dragIdB) {
  if (!window._lobbyState) return;
  var ls = window._lobbyState;

  function getEntityTeam(dragId) {
    var parts = dragId.split(':');
    var type = parts[0];
    var id = parts.slice(1).join(':');
    if (type === 'human') {
      return { type: type, id: id, team: ls.teamAssignments[id] || 0 };
    } else if (type === 'ai') {
      var slot = ls.aiSlots[parseInt(id, 10)];
      return { type: type, id: id, team: slot ? (slot.team || 0) : 0 };
    }
    return null;
  }

  var a = getEntityTeam(dragIdA);
  var b = getEntityTeam(dragIdB);
  if (!a || !b || a.team === b.team) return;

  // Swap their teams
  if (a.type === 'human') {
    ls.teamAssignments[a.id] = b.team;
    if (window._lobbySocket) window._lobbySocket.emit('setPlayerTeam', a.id, b.team);
  } else if (a.type === 'ai') {
    var slotA = ls.aiSlots[parseInt(a.id, 10)];
    if (slotA) slotA.team = b.team;
  }

  if (b.type === 'human') {
    ls.teamAssignments[b.id] = a.team;
    if (window._lobbySocket) window._lobbySocket.emit('setPlayerTeam', b.id, a.team);
  } else if (b.type === 'ai') {
    var slotB = ls.aiSlots[parseInt(b.id, 10)];
    if (slotB) slotB.team = a.team;
  }

  if (a.type === 'ai' || b.type === 'ai') lobbySyncAISlotsToServer();
  lobbyRenderSlots();
}

// Render a human player row (host or remote)
function lobbyRenderHumanRow(row, player) {
  if (player.isHost) row.classList.add('is-host');

  var name = document.createElement('span');
  name.className = 'player-name';
  name.textContent = player.name || 'Player';
  row.appendChild(name);

  if (player.isHost) {
    var badge = document.createElement('span');
    badge.className = 'player-ready host-badge';
    badge.textContent = 'HOST';
    row.appendChild(badge);
  } else {
    var status = document.createElement('span');
    status.className = 'player-ready';
    if (player.ready) {
      status.classList.add('is-ready');
      status.textContent = 'READY';
    }
    row.appendChild(status);
  }
}

// Handle a drop onto a team section
function lobbyHandleTeamDrop(dragData, targetTeam) {
  if (!dragData || !window._lobbyState) return;
  var parts = dragData.split(':');
  var entityType = parts[0];
  var entityId = parts.slice(1).join(':');

  // Determine entity's current team so we can skip no-op and adjust capacity check
  var currentTeam = 0;
  if (entityType === 'human') {
    currentTeam = window._lobbyState.teamAssignments[entityId] || 0;
  } else if (entityType === 'ai') {
    var slot = window._lobbyState.aiSlots[parseInt(entityId, 10)];
    if (slot) currentTeam = slot.team || 0;
  }
  if (currentTeam === targetTeam) return; // no-op

  // Enforce team capacity (skip check for unassigned section)
  if (targetTeam > 0) {
    var capacities = lobbyGetTeamCapacities();
    var counts = lobbyGetTeamCounts();
    var cap = capacities[targetTeam] || 0;
    var cur = counts[targetTeam] || 0;
    if (cap > 0 && cur >= cap) return; // team is full
  }

  if (entityType === 'human') {
    window._lobbyState.teamAssignments[entityId] = targetTeam;
    if (window._lobbySocket) {
      window._lobbySocket.emit('setPlayerTeam', entityId, targetTeam);
    }
  } else if (entityType === 'ai') {
    var slotIdx = parseInt(entityId, 10);
    if (window._lobbyState.aiSlots[slotIdx]) {
      window._lobbyState.aiSlots[slotIdx].team = targetTeam;
      lobbySyncAISlotsToServer();
    }
  }

  lobbyRenderSlots();
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
        lobbySyncAISlotsToServer();
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
        lobbySyncAISlotsToServer();
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
    // Non-host: read-only bot display with hero name and difficulty
    var heroName = aiConfig.hero || 'random';
    if (heroName !== 'random') {
      var heroes = lobbyGetHeroNames();
      for (var hi = 0; hi < heroes.length; hi++) {
        if (heroes[hi].id === heroName) { heroName = heroes[hi].name; break; }
      }
    } else {
      heroName = 'Random';
    }
    var heroSpan = document.createElement('span');
    heroSpan.className = 'player-ready';
    heroSpan.textContent = heroName + ' / ' + (aiConfig.difficulty || 'Medium');
    heroSpan.style.color = '#55bbff';
    row.appendChild(heroSpan);

    var botBadge = document.createElement('span');
    botBadge.className = 'player-ready host-badge';
    botBadge.textContent = 'BOT';
    botBadge.style.color = '#55bbff';
    row.appendChild(botBadge);
  }
}

function lobbyAddAI() {
  if (!window._lobbyState || !window._lobbyState.isHost) return;
  // Find next available slot key
  var keys = Object.keys(window._lobbyState.aiSlots);
  var maxKey = -1;
  for (var i = 0; i < keys.length; i++) {
    var k = parseInt(keys[i], 10);
    if (k > maxKey) maxKey = k;
  }
  // Auto-assign to team with the most room (never team 0)
  var availableTeams = lobbyGetAvailableTeams();
  if (availableTeams.length === 0) availableTeams = [1, 2];
  var capacities = lobbyGetTeamCapacities();
  var team = lobbyFindTeamWithRoom(availableTeams, capacities);
  if (team <= 0) team = lobbyFindSmallestTeam(availableTeams);
  window._lobbyState.aiSlots[maxKey + 1] = { hero: 'random', difficulty: 'Medium', team: team };
  lobbySyncAISlotsToServer();
  lobbyRenderSlots();
}

function lobbyRemoveAI(slotIndex) {
  if (!window._lobbyState || !window._lobbyState.isHost) return;
  delete window._lobbyState.aiSlots[slotIndex];
  lobbySyncAISlotsToServer();
  lobbyRenderSlots();
}

// Send current AI slot configs to the server so all clients see them
function lobbySyncAISlotsToServer() {
  if (!window._lobbySocket || !window._lobbyState || !window._lobbyState.isHost) return;
  var slots = [];
  var keys = Object.keys(window._lobbyState.aiSlots || {});
  for (var i = 0; i < keys.length; i++) {
    var ai = window._lobbyState.aiSlots[keys[i]];
    slots.push({ hero: ai.hero || 'random', difficulty: ai.difficulty || 'Medium', team: ai.team || 0 });
  }
  window._lobbySocket.emit('updateAISlots', slots);
}

// Collect all slot configs for game start
function lobbyCollectSlotConfigs() {
  if (!window._lobbyState) return { players: [], aiConfigs: [] };
  var ls = window._lobbyState;
  var aiConfigs = [];
  var keys = Object.keys(ls.aiSlots || {});
  for (var i = 0; i < keys.length; i++) {
    var ai = ls.aiSlots[keys[i]];
    aiConfigs.push({ hero: ai.hero || 'random', difficulty: ai.difficulty || 'Medium', team: ai.team || 0 });
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
      mapData: cfg.mapData || null,
      mode: cfg.mode || 'ffa',
      rounds: cfg.rounds || 3,
      noRespawns: !!cfg.noRespawns,
      aiConfigs: slotData.aiConfigs,
      teamAssignments: ls.teamAssignments || {}
    };
    if (typeof window.startFFAHost === 'function') {
      window.startFFAHost(ls.roomId, settings, lobbySock);
    }
  } else {
    if (typeof window.joinFFAGame === 'function') {
      window.joinFFAGame(ls.roomId, lobbySock, ls.serverSettings || {});
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

// === Settings Overlay (ESC menu) =======================================

window.toggleSettingsOverlay = function () {
  var overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;
  var isOpen = !overlay.classList.contains('hidden');
  if (isOpen) {
    // Close settings, resume game
    overlay.classList.add('hidden');
    // Re-request pointer lock to resume gameplay
    var canvas = document.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
  } else {
    // Open settings, pause input
    overlay.classList.remove('hidden');
    // Populate keybind list
    populateKeybindList();
    // Exit pointer lock so mouse cursor is visible
    document.exitPointerLock();
  }
};

window.isSettingsOpen = function () {
  var overlay = document.getElementById('settingsOverlay');
  return overlay && !overlay.classList.contains('hidden');
};

// --- Keybind list population ---

var DEFAULT_KEYBINDS = [
  { action: 'Move Forward', key: 'W' },
  { action: 'Move Back', key: 'S' },
  { action: 'Move Left', key: 'A' },
  { action: 'Move Right', key: 'D' },
  { action: 'Sprint', key: 'Shift' },
  { action: 'Jump', key: 'Space' },
  { action: 'Reload', key: 'R' },
  { action: 'Melee', key: 'V' },
  { action: 'Ability 1 (Q)', key: 'Q' },
  { action: 'Ability 2 (E)', key: 'E' },
  { action: 'Ability 3 (F)', key: 'F' },
  { action: 'Ability 4 (C)', key: 'C' }
];

function populateKeybindList() {
  var container = document.getElementById('settingsKeybinds');
  if (!container) return;

  // Try to read live keymap
  var keymap = (typeof window.getKeymap === 'function') ? window.getKeymap() : null;
  var bindings = DEFAULT_KEYBINDS;

  if (keymap) {
    // Build reverse map: action → key label
    var actionToKey = {};
    var keys = Object.keys(keymap);
    for (var i = 0; i < keys.length; i++) {
      var code = keys[i];
      var action = keymap[code];
      if (!actionToKey[action]) {
        // Convert code to a readable label
        var label = code.replace('Key', '').replace('Digit', '').replace('Arrow', '');
        if (code === 'ShiftLeft' || code === 'ShiftRight') label = 'Shift';
        if (code === 'Space') label = 'Space';
        actionToKey[action] = label;
      }
    }

    // Map known actions to display
    var ACTION_MAP = {
      'Move Forward': 'forward',
      'Move Back': 'back',
      'Move Left': 'left',
      'Move Right': 'right',
      'Sprint': 'sprint',
      'Jump': 'jump',
      'Reload': 'reload',
      'Melee': 'melee',
      'Ability 1 (Q)': 'ability1',
      'Ability 2 (E)': 'ability2',
      'Ability 3 (F)': 'ability3',
      'Ability 4 (C)': 'ability4'
    };

    bindings = [];
    for (var j = 0; j < DEFAULT_KEYBINDS.length; j++) {
      var def = DEFAULT_KEYBINDS[j];
      var internalAction = ACTION_MAP[def.action];
      var keyLabel = (internalAction && actionToKey[internalAction]) ? actionToKey[internalAction] : def.key;
      bindings.push({ action: def.action, key: keyLabel });
    }
  }

  // Render grid
  var html = '<div class="settings-keybind-grid">';
  for (var k = 0; k < bindings.length; k++) {
    html += '<div class="settings-keybind-action">' + bindings[k].action + '</div>';
    html += '<div class="settings-keybind-key">' + bindings[k].key + '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// --- Tab switching ---

(function () {
  document.addEventListener('click', function (e) {
    if (!e.target.classList.contains('settings-tab')) return;
    var tabName = e.target.getAttribute('data-tab');
    if (!tabName) return;

    // Toggle active class on tabs
    var tabs = document.querySelectorAll('.settings-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i] === e.target);
    }

    // Toggle content visibility
    var keybindsContent = document.getElementById('settingsKeybinds');
    var crosshairContent = document.getElementById('settingsCrosshair');
    if (keybindsContent) keybindsContent.classList.toggle('hidden', tabName !== 'keybinds');
    if (crosshairContent) crosshairContent.classList.toggle('hidden', tabName !== 'crosshair');
  });
})();

// --- Leave Game button ---

(function () {
  document.addEventListener('click', function (e) {
    if (e.target.id !== 'settingsLeaveGame') return;

    // Stop the active game mode
    if (window.ffaActive) {
      try { if (typeof stopFFAInternal === 'function') stopFFAInternal(); } catch (ex) {}
    } else if (window.trainingRangeActive) {
      try { if (typeof stopTrainingRangeInternal === 'function') stopTrainingRangeInternal(); } catch (ex) {}
    }

    // Show main menu
    showOnlyMenu('mainMenu');

    // Hide HUD
    if (typeof setHUDVisible === 'function') setHUDVisible(false);

    // Close settings overlay
    var overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.add('hidden');
  });
})();

// --- Resume button ---

(function () {
  document.addEventListener('click', function (e) {
    if (e.target.id !== 'settingsClose') return;

    // Close settings overlay and re-request pointer lock
    var overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.add('hidden');

    var canvas = document.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
  });
})();
