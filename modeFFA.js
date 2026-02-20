/**
 * modeFFA.js — Free-For-All game mode (host game loop)
 *
 * PURPOSE: Host-authoritative FFA mode for 2-8 players. The host runs physics
 *          for all players, manages kill scoring, and broadcasts snapshots at
 *          ~30Hz. Clients send input, run client-side prediction, and reconcile
 *          with authoritative snapshots via lerp.
 * EXPORTS (window): ffaActive, getFFAState, startFFAHost, joinFFAGame, stopFFAInternal
 * DEPENDENCIES: THREE (r128), Socket.IO, scene/camera/renderer globals (game.js),
 *               hud.js, roundFlow.js, crosshair.js, physics.js, projectiles.js,
 *               weapon.js, heroes.js, heroSelectUI.js, input.js,
 *               arenaCompetitive.js, player.js (Player),
 *               mapFormat.js (buildArenaFromMap, getDefaultMapData),
 *               menuNavigation.js (showOnlyMenu, setHUDVisible)
 */

(function () {
  window.ffaActive = false;
  window.getFFAState = function () { return state; };

  var PLAYER_RADIUS = 0.5;
  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;
  var SNAPSHOT_RATE = 33;       // ms between snapshots (~30Hz)
  var DEFAULT_HEALTH = 100;
  var MAX_DT = 0.05;            // max delta-time clamp (seconds)
  var RESPAWN_DELAY_MS = 3000;  // time before respawning after death
  var ROUND_BANNER_MS = GAME_CONFIG.ROUND_BANNER_MS;
  var COUNTDOWN_SECONDS = GAME_CONFIG.COUNTDOWN_SECONDS;
  var SHOT_DELAY_AFTER_COUNTDOWN = GAME_CONFIG.SHOT_DELAY_AFTER_COUNTDOWN;

  // ── Team constants ──
  var TEAM_COLORS_HEX = [0x55aaff, 0xff5555, 0x44ff44, 0xff8844]; // Team 1: Blue, Team 2: Red, Team 3: Green, Team 4: Orange
  var TEAM_NAMES = ['Team 1', 'Team 2', 'Team 3', 'Team 4'];

  var socket = null;
  var _handlersAttached = false;
  var _usingLobbySocket = false;
  var state = null;

  // ── Client-side prediction state ──
  var _predictedPos = null;
  var _predictedFeetY = GROUND_Y;
  var _predictedVVel = 0;
  var _predictedGrounded = true;
  var _lastSnapshotTime = 0;
  var _prevLocalReloading = false;
  var LERP_RATE = 0.15;
  var SNAP_THRESHOLD_SQ = 25;
  var TRACER_LIFETIME = 70;
  var _remoteInterp = {};  // { [id]: { from, to } } for smooth remote interpolation

  function mkHudRefs() {
    return {
      healthContainer: document.getElementById('healthContainer'),
      healthFill: document.getElementById('healthFill'),
      ammoDisplay: document.getElementById('ammoDisplay'),
      reloadIndicator: document.getElementById('reloadIndicator'),
      sprintIndicator: document.getElementById('sprintIndicator'),
      bannerEl: document.getElementById('roundBanner'),
      countdownEl: document.getElementById('roundCountdown'),
      meleeCooldown: document.getElementById('meleeCooldown'),
    };
  }

  function updateHUDForLocalPlayer() {
    if (!state || !state.localId) return;
    var entry = state.players[state.localId];
    if (!entry || !entry.entity) return;
    var p = entry.entity;
    sharedUpdateHealthBar(state.hud.healthFill, p.health, p.maxHealth || DEFAULT_HEALTH);
    sharedUpdateAmmoDisplay(state.hud.ammoDisplay, p.weapon.ammo, p.weapon.magSize);
    sharedUpdateMeleeCooldown(state.hud.meleeCooldown, p.weapon, performance.now());
  }

  function showFFAHUD(show) {
    if (!state || !state.hud) return;
    if (state.hud.healthContainer) state.hud.healthContainer.classList.toggle('hidden', !show);
    var kf = document.getElementById('ffaKillFeed');
    if (kf) kf.classList.toggle('hidden', !show);
  }

  // ── Kill Feed ──
  var KILL_FEED_MAX = 4;
  var KILL_FEED_FADE_MS = 4000;

  function ensureKillFeedDOM() {
    var el = document.getElementById('ffaKillFeed');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ffaKillFeed';
      el.className = 'hidden';
      var gc = document.getElementById('gameContainer');
      if (gc) gc.appendChild(el);
    }
    return el;
  }

  function showKillFeedEntry(killerName, victimName) {
    var feed = ensureKillFeedDOM();
    if (!feed) return;
    feed.classList.remove('hidden');

    var row = document.createElement('div');
    row.className = 'kill-feed-entry';
    row.innerHTML = '<span class="kf-killer">' + escapeHTML(killerName) + '</span>' +
      ' <span class="kf-arrow">\u2192</span> ' +
      '<span class="kf-victim">' + escapeHTML(victimName) + '</span>';
    feed.appendChild(row);

    // Limit visible entries
    while (feed.children.length > KILL_FEED_MAX) {
      feed.removeChild(feed.firstChild);
    }

    // Auto-fade after delay
    setTimeout(function () {
      row.classList.add('kf-fading');
      setTimeout(function () {
        if (row.parentNode) row.parentNode.removeChild(row);
      }, 500);
    }, KILL_FEED_FADE_MS);
  }

  function clearKillFeed() {
    var feed = document.getElementById('ffaKillFeed');
    if (feed) feed.innerHTML = '';
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  window.escapeHTML = escapeHTML;

  // ── Team Assignment ──
  // Derives available teams from spawn data. Returns 0 if all spawns are teamless.
  function assignTeam() {
    if (!state) return 0;
    // Derive available teams from spawn data
    var teamSet = {};
    if (state.spawnsFFA) {
      for (var s = 0; s < state.spawnsFFA.length; s++) {
        var t = state.spawnsFFA[s].team;
        if (t > 0) teamSet[t] = true;
      }
    }
    var teamIds = Object.keys(teamSet);
    // If no team spawns (all team 0), don't assign teams
    if (teamIds.length === 0) return 0;

    // Count players per team, assign to team with fewest players
    var counts = {};
    for (var i = 0; i < teamIds.length; i++) counts[teamIds[i]] = 0;
    var ids = Object.keys(state.players);
    for (var j = 0; j < ids.length; j++) {
      var entry = state.players[ids[j]];
      if (entry && entry.team && counts[entry.team] !== undefined) {
        counts[entry.team]++;
      }
    }
    var minTeam = parseInt(teamIds[0], 10);
    var minCount = counts[teamIds[0]] || 0;
    for (var k = 1; k < teamIds.length; k++) {
      if ((counts[teamIds[k]] || 0) < minCount) {
        minCount = counts[teamIds[k]] || 0;
        minTeam = parseInt(teamIds[k], 10);
      }
    }
    return minTeam;
  }

  // Get spawn position for a specific team
  // Filters spawns where spawn.team matches or spawn.team === 0 (any team)
  function getTeamSpawnPosition(team) {
    if (!state || !state.spawnsFFA || state.spawnsFFA.length === 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    var teamSpawns = [];
    for (var i = 0; i < state.spawnsFFA.length; i++) {
      if (state.spawnsFFA[i].team === team || state.spawnsFFA[i].team === 0) {
        teamSpawns.push(state.spawnsFFA[i]);
      }
    }
    if (teamSpawns.length === 0) return getSpawnPosition(state._spawnIndex++);
    if (!state._teamSpawnIndex) state._teamSpawnIndex = {};
    if (!state._teamSpawnIndex[team]) state._teamSpawnIndex[team] = 0;
    var idx = state._teamSpawnIndex[team]++ % teamSpawns.length;
    return teamSpawns[idx].position.clone();
  }

  function getTeamColor(team) {
    if (!team) return randomPlayerColor();
    return TEAM_COLORS_HEX[(team - 1) % TEAM_COLORS_HEX.length];
  }

  function getTeamName(team) {
    return TEAM_NAMES[(team - 1) % TEAM_NAMES.length] || ('Team ' + team);
  }

  // Compute team total kills
  function getTeamKills(team) {
    if (!state || !state.match || !state.match.scores) return 0;
    var total = 0;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      var entry = state.players[ids[i]];
      var sc = state.match.scores[ids[i]];
      if (entry && entry.team === team && sc) {
        total += sc.kills || 0;
      }
    }
    return total;
  }

  function showRoundBanner(text, ms) {
    if (!state) return;
    sharedShowRoundBanner(text, state.hud.bannerEl, state.bannerTimerRef, ms);
  }

  function startRoundCountdown(seconds) {
    if (!state) return;
    sharedStartRoundCountdown({
      seconds: seconds || COUNTDOWN_SECONDS,
      countdownEl: state.hud.countdownEl,
      timerRef: state.countdownTimerRef,
      onStart: function () {
        if (!state) return;
        state.inputEnabled = false;
        state.match.roundActive = false;
        // Delay first shot for all players
        var now = performance.now();
        var ids = Object.keys(state.players);
        for (var i = 0; i < ids.length; i++) {
          var e = state.players[ids[i]];
          if (e && e.entity && e.entity.weapon) {
            e.entity.weapon.lastShotTime = now + SHOT_DELAY_AFTER_COUNTDOWN;
          }
        }
      },
      onReady: function () {
        if (!state) return;
        state.inputEnabled = true;
        state.match.roundActive = true;
        // Kick AI bots into action now that round is active
        var ids = Object.keys(state.players);
        for (var j = 0; j < ids.length; j++) {
          var e = state.players[ids[j]];
          if (e && e.isAI && e.aiInstance) {
            e.aiInstance._enterState('SPAWN_RUSH');
          }
        }
      }
    });
  }

  function applyHeroWeapon(player, heroId) {
    if (!player) return;
    if (typeof window.applyHeroToPlayer === 'function') {
      window.applyHeroToPlayer(player, heroId);
    } else {
      var hero = (typeof window.getHeroById === 'function' && window.getHeroById(heroId)) || window.HEROES[0];
      player.weapon = new Weapon(hero.weapon);
    }
    player.weapon.reset();
  }

  function createPlayerInstance(opts) {
    var heroId = (opts && opts.heroId) || 'marksman';
    var hero = (typeof window.getHeroById === 'function' && window.getHeroById(heroId)) || window.HEROES[0];
    var w = new Weapon(hero.weapon);
    var p = new Player({
      position: opts.position ? opts.position.clone() : new THREE.Vector3(),
      feetY: GROUND_Y,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      radius: PLAYER_RADIUS,
      maxHealth: DEFAULT_HEALTH,
      color: opts.color || 0xff5555,
      cameraAttached: !!opts.cameraAttached,
      weapon: w
    });
    p.input = {
      moveX: 0, moveZ: 0, sprint: false, jump: false,
      fireDown: false, reloadPressed: false, meleeDown: false,
      forward: new THREE.Vector3(0, 0, -1)
    };
    p.yaw = 0;
    p.pitch = 0;
    return p;
  }

  // Assign a spawn point from the FFA array, rotating through them
  function getSpawnPosition(index) {
    if (!state || !state.spawnsFFA || state.spawnsFFA.length === 0) {
      return new THREE.Vector3(0, 0, 0);
    }
    return state.spawnsFFA[index % state.spawnsFFA.length].position.clone();
  }

  // ── AI Bot Management ──
  var _aiSlots = []; // { heroId, difficulty, name } — lobby AI slot definitions

  function addAISlot(heroId, difficulty, team) {
    var name = '[AI] Bot ' + (_aiSlots.length + 1);
    _aiSlots.push({ heroId: heroId || 'marksman', difficulty: difficulty || 'Medium', name: name, team: team || 0 });
    return _aiSlots.length - 1;
  }

  function removeAISlot(index) {
    if (index >= 0 && index < _aiSlots.length) {
      _aiSlots.splice(index, 1);
      // Re-number remaining bot names
      for (var i = 0; i < _aiSlots.length; i++) {
        _aiSlots[i].name = '[AI] Bot ' + (i + 1);
      }
    }
  }

  function clearAISlots() {
    _aiSlots = [];
  }

  function spawnAIPlayers() {
    if (!state || !state.arena) return;
    for (var i = 0; i < _aiSlots.length; i++) {
      var slot = _aiSlots[i];
      var aiId = 'ai-' + i;
      var team = (slot.team && slot.team > 0) ? slot.team : assignTeam();
      var spawnPos = getTeamSpawnPosition(team);

      var ai = new AIOpponent({
        difficulty: slot.difficulty,
        arena: state.arena,
        spawn: { x: spawnPos.x, z: spawnPos.z },
        color: getTeamColor(team)
      });

      // Resolve 'random' hero to an actual random pick from available heroes
      var resolvedHeroId = slot.heroId;
      if (resolvedHeroId === 'random' && window.HEROES && window.HEROES.length > 0) {
        resolvedHeroId = window.HEROES[Math.floor(Math.random() * window.HEROES.length)].id;
      }

      // Apply selected hero and adjust AI playstyle for weapon type
      if (typeof window.applyHeroToPlayer === 'function') {
        window.applyHeroToPlayer(ai.player, resolvedHeroId);
      }
      ai.applyHeroPlaystyle();

      state.players[aiId] = {
        entity: ai.player,
        heroId: resolvedHeroId,
        alive: true,
        isAI: true,
        aiInstance: ai,
        name: slot.name,
        respawnAt: 0,
        team: team
      };
      state.match.scores[aiId] = { kills: 0, deaths: 0 };
      state._meleeSwingState[aiId] = { swinging: false, swingEnd: 0 };
    }
  }

  function buildAITargetList(excludeId) {
    var targets = [];
    if (!state) return targets;
    var excludeEntry = state.players[excludeId];
    var shooterTeam = excludeEntry ? excludeEntry.team : 0;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === excludeId) continue;
      var entry = state.players[ids[i]];
      if (!entry || !entry.entity || !entry.alive) continue;
      // In TDM, skip teammates
      if (state.mode === 'tdm' && shooterTeam && entry.team === shooterTeam) continue;
      var pos = (ids[i] === state.localId) ? camera.position.clone() : entry.entity.position.clone();
      targets.push({
        position: pos,
        entity: entry.entity,
        id: ids[i],
        alive: entry.alive
      });
    }
    return targets;
  }

  function tickAIPlayers(dt) {
    if (!state) return;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.isAI || !entry.aiInstance || !entry.alive) continue;

      var ai = entry.aiInstance;
      // Set multi-targets (all other players)
      ai.setTargets(buildAITargetList(id));

      // Build context for the AI (fallback playerPos for single-target compat)
      var fallbackPos = camera.position.clone();
      var ctx = {
        playerPos: fallbackPos,
        playerSegments: [],
        playerEntity: null,
        onPlayerHit: function (shooterId) {
          return function (damage, hitEntity) {
            // Find victim by matching the hit entity to a player entry
            var victimId = null;
            var victimEntry = null;
            var pids = Object.keys(state.players);
            for (var j = 0; j < pids.length; j++) {
              if (state.players[pids[j]].entity === hitEntity) {
                victimId = pids[j];
                victimEntry = state.players[pids[j]];
                break;
              }
            }
            if (!victimEntry || !victimEntry.entity || !victimEntry.entity.alive) return;
            if (window.devGodMode && victimId === state.localId) return;

            victimEntry.entity.takeDamage(damage);
            if (victimId === state.localId) {
              if (typeof playGameSound === 'function') playGameSound('damage_taken');
              updateHUDForLocalPlayer();
            }

            if (state.match.roundActive && !victimEntry.entity.alive) {
              victimEntry.alive = false;
              victimEntry.respawnAt = state.noRespawns ? 0 : performance.now() + RESPAWN_DELAY_MS;
              if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('own_death');
              recordKill(shooterId, victimId, state.players[shooterId] && state.players[shooterId].aiInstance ? state.players[shooterId].aiInstance.weapon.modelType || 'gun' : 'gun');
            }
          };
        }(id)
      };

      ai.update(dt, ctx);

      // Sync AI player state back to the entry
      entry.entity._syncMeshPosition();
    }
  }

  // Expose for lobby UI
  window.ffaAddAISlot = addAISlot;
  window.ffaRemoveAISlot = removeAISlot;
  window.ffaClearAISlots = clearAISlots;
  window.ffaGetAISlots = function () { return _aiSlots.slice(); };

  // Update the lobby player list DOM to show AI slots with controls
  window.ffaRenderAIInLobby = function (playerListEl, humanCount) {
    if (!playerListEl) return;
    var maxPlayers = 8;
    var maxEl = document.getElementById('lobbyMaxPlayers');
    if (maxEl) maxPlayers = parseInt(maxEl.value, 10) || 8;

    var totalSlots = maxPlayers;
    var filledHuman = humanCount || 0;

    // Clear existing rows
    playerListEl.innerHTML = '';

    // Human player rows are rendered by the lobby JS logic (Task 019)
    // Here we just handle AI slots and empty slots after humans

    // AI slot rows
    for (var i = 0; i < _aiSlots.length; i++) {
      (function (idx) {
        var slot = _aiSlots[idx];
        var row = document.createElement('div');
        row.className = 'player-row ai-slot';
        row.innerHTML =
          '<span class="player-name">' + escapeHTML(slot.name) + '</span>' +
          '<select class="ai-hero-select">' + buildHeroOptions(slot.heroId) + '</select>' +
          '<select class="ai-diff-select">' +
          '<option value="Easy"' + (slot.difficulty === 'Easy' ? ' selected' : '') + '>Easy</option>' +
          '<option value="Medium"' + (slot.difficulty === 'Medium' ? ' selected' : '') + '>Medium</option>' +
          '<option value="Hard"' + (slot.difficulty === 'Hard' ? ' selected' : '') + '>Hard</option>' +
          '</select>' +
          '<span class="player-ready is-ready">Ready</span>' +
          '<button class="ai-remove-btn">\u2715</button>';

        var heroSel = row.querySelector('.ai-hero-select');
        var diffSel = row.querySelector('.ai-diff-select');
        var removeBtn = row.querySelector('.ai-remove-btn');

        heroSel.addEventListener('change', function () { _aiSlots[idx].heroId = heroSel.value; });
        diffSel.addEventListener('change', function () { _aiSlots[idx].difficulty = diffSel.value; });
        removeBtn.addEventListener('click', function () {
          removeAISlot(idx);
          if (typeof window.ffaRefreshLobbyList === 'function') window.ffaRefreshLobbyList();
        });

        playerListEl.appendChild(row);
      })(i);
    }

    // Empty slots with "Add AI" button
    var remaining = totalSlots - filledHuman - _aiSlots.length;
    for (var j = 0; j < remaining; j++) {
      var emptyRow = document.createElement('div');
      emptyRow.className = 'player-row empty-slot';
      emptyRow.innerHTML = '<span class="player-name">Open Slot</span><button class="ai-add-btn host-only">Add AI</button>';
      var addBtn = emptyRow.querySelector('.ai-add-btn');
      addBtn.addEventListener('click', function () {
        addAISlot('marksman', 'Medium');
        if (typeof window.ffaRefreshLobbyList === 'function') window.ffaRefreshLobbyList();
      });
      playerListEl.appendChild(emptyRow);
    }
  };

  function buildHeroOptions(selectedId) {
    var heroes = (typeof window.HEROES !== 'undefined') ? window.HEROES : [];
    var html = '';
    for (var i = 0; i < heroes.length; i++) {
      var h = heroes[i];
      var sel = (h.id === selectedId) ? ' selected' : '';
      html += '<option value="' + h.id + '"' + sel + '>' + h.name + '</option>';
    }
    if (heroes.length === 0) {
      html = '<option value="marksman" selected>Marksman</option>';
    }
    return html;
  }

  function newState(settings) {
    return {
      players: {},        // { [socketId]: { entity: Player, heroId, alive, isAI, respawnAt, team } }
      arena: null,
      spawnsFFA: [],
      mode: (settings && settings.mode) || 'ffa',
      noRespawns: !!(settings && settings.noRespawns),
      match: {
        scores: {},       // { [socketId]: { kills: 0, deaths: 0 } }
        killLimit: (settings && settings.killLimit) || 10,
        roundsToWin: (settings && settings.rounds) || 3,
        currentRound: 1,
        roundWins: {},    // { team#: numberOfRoundsWon }
        roundActive: false
      },
      isHost: false,
      localId: null,
      hud: mkHudRefs(),
      lastTs: 0,
      loopHandle: 0,
      inputEnabled: false,
      bannerTimerRef: { id: 0 },
      countdownTimerRef: { id: 0 },
      heroSelectTimerRef: { id: 0 },
      _spawnIndex: 0,     // rotating spawn index
      _teamSpawnIndex: {}, // { [team]: rotatingIndex }
      _remoteInputs: {},  // { [socketId]: latestInputPayload }
      _remoteInputPending: {}, // { [socketId]: { jump, reload, melee } }
      _meleeSwingState: {} // { [socketId]: { swinging, swingEnd } }
    };
  }

  function resetAllPlayersForRound() {
    if (!state) return;
    clearKillFeed();
    var ids = Object.keys(state.players);
    state._spawnIndex = 0;
    state._teamSpawnIndex = {};
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity) continue;
      var spawnPos = entry.team ? getTeamSpawnPosition(entry.team) : getSpawnPosition(state._spawnIndex++);
      entry.entity.resetForRound(spawnPos);
      entry.alive = true;
      entry.respawnAt = 0;
      state.match.scores[id] = { kills: 0, deaths: 0 };
      state._meleeSwingState[id] = { swinging: false, swingEnd: 0 };
    }

    // Sync local player camera
    var local = state.players[state.localId];
    if (local && local.entity) {
      local.entity.syncCameraFromPlayer();
      camera.rotation.set(0, 0, 0, 'YXZ');
    }
  }

  function respawnPlayer(id) {
    if (!state || !state.players[id]) return;
    var entry = state.players[id];
    var spawnPos = entry.team ? getTeamSpawnPosition(entry.team) : getSpawnPosition(state._spawnIndex++);
    entry.entity.resetForRound(spawnPos);
    entry.alive = true;
    entry.respawnAt = 0;

    // Reset AI state on respawn
    if (entry.isAI && entry.aiInstance) {
      entry.aiInstance.alive = true;
      entry.aiInstance.health = entry.aiInstance.maxHealth;
      entry.aiInstance._enterState('SPAWN_RUSH');
    }

    if (id === state.localId) {
      entry.entity.syncCameraFromPlayer();
      camera.rotation.set(0, 0, 0, 'YXZ');
      updateHUDForLocalPlayer();
      if (typeof playGameSound === 'function') playGameSound('respawn');
      showRespawnHeroPrompt();
    }

    entry.entity._syncMeshPosition();

    // Broadcast immediate snapshot so clients see the respawn
    if (state.isHost) maybeSendSnapshot(performance.now(), true);
  }

  // ── Respawn hero change prompt ──

  function showRespawnHeroPrompt() {
    if (!state) return;
    state._respawnHeroPromptActive = true;
    state._respawnHeroPromptShownAt = performance.now();
    var el = document.getElementById('respawnHeroPrompt');
    if (el) el.classList.remove('hidden');
    if (state._respawnHeroPromptTimer) clearTimeout(state._respawnHeroPromptTimer);
    state._respawnHeroPromptTimer = setTimeout(function () {
      hideRespawnHeroPrompt();
    }, 5000);

    // Expose timer cancel for heroSelectUI.js (state is IIFE-local)
    window._cancelRespawnHeroTimer = function () {
      if (state && state._respawnHeroPromptTimer) {
        clearTimeout(state._respawnHeroPromptTimer);
        state._respawnHeroPromptTimer = 0;
      }
      if (state) state._respawnHeroPromptActive = false;
    };

    // Set callback for heroSelectUI.js H key handler
    window._ffaRespawnHeroCallback = function (heroId) {
      hideRespawnHeroPrompt();
      if (!state) return;
      var localEntry = state.players[state.localId];
      if (localEntry) {
        applyHeroWeapon(localEntry.entity, heroId);
        localEntry.heroId = heroId;
        sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
        updateHUDForLocalPlayer();
      }
      if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
    };
  }

  function hideRespawnHeroPrompt() {
    if (!state) return;
    state._respawnHeroPromptActive = false;
    if (state._respawnHeroPromptTimer) {
      clearTimeout(state._respawnHeroPromptTimer);
      state._respawnHeroPromptTimer = 0;
    }
    var el = document.getElementById('respawnHeroPrompt');
    if (el) el.classList.add('hidden');
    window._ffaRespawnHeroCallback = null;
    window._cancelRespawnHeroTimer = null;
  }

  function getPlayerActualName(id) {
    if (!id) return 'Unknown';
    if (state && state.players[id] && state.players[id].name) return state.players[id].name;
    return 'Player ' + id.substring(0, 4);
  }

  function getPlayerDisplayName(id) {
    if (id === (state && state.localId)) return 'You';
    return getPlayerActualName(id);
  }

  function checkEliminationWin() {
    if (!state || !state.noRespawns || !state.match.roundActive) return;
    var ids = Object.keys(state.players);
    if (state.mode === 'tdm') {
      // Count alive players per team
      var teamsAlive = {};
      for (var i = 0; i < ids.length; i++) {
        var entry = state.players[ids[i]];
        if (!entry || !entry.alive || !entry.team) continue;
        teamsAlive[entry.team] = true;
      }
      var aliveTeams = Object.keys(teamsAlive);
      if (aliveTeams.length === 1) {
        // Find a player on the winning team to pass as winnerId
        var winTeam = parseInt(aliveTeams[0], 10);
        var winnerId = null;
        for (var j = 0; j < ids.length; j++) {
          if (state.players[ids[j]] && state.players[ids[j]].team === winTeam && state.players[ids[j]].alive) {
            winnerId = ids[j];
            break;
          }
        }
        endRound(winnerId, winTeam);
      } else if (aliveTeams.length === 0) {
        // Everyone dead simultaneously — draw, no winner
        endRound(null, null);
      }
    } else {
      // FFA: last player standing wins
      var aliveIds = [];
      for (var k = 0; k < ids.length; k++) {
        if (state.players[ids[k]] && state.players[ids[k]].alive) {
          aliveIds.push(ids[k]);
        }
      }
      if (aliveIds.length <= 1) {
        endRound(aliveIds[0] || null, null);
      }
    }
  }

  function recordKill(killerId, victimId, weapon) {
    if (!state || !state.match || !state.match.scores) return;
    if (!state.match.scores[killerId]) state.match.scores[killerId] = { kills: 0, deaths: 0 };
    if (!state.match.scores[victimId]) state.match.scores[victimId] = { kills: 0, deaths: 0 };
    state.match.scores[killerId].kills++;
    state.match.scores[victimId].deaths++;

    // Broadcast kill event to all clients (use actual names, not "You")
    var killPayload = {
      killerId: killerId,
      victimId: victimId,
      weapon: weapon || 'unknown',
      killerName: getPlayerActualName(killerId),
      victimName: getPlayerActualName(victimId)
    };
    if (socket && state.isHost) {
      socket.emit('ffaKill', killPayload);
    }

    // Show local kill feed (use display names so host sees "You")
    showKillFeedEntry(getPlayerDisplayName(killerId), getPlayerDisplayName(victimId));

    // Update scoreboard if available
    if (typeof window.updateFFAScoreboard === 'function') {
      window.updateFFAScoreboard();
    }

    // Check elimination win condition (no respawns mode — kill limit is ignored)
    if (state.noRespawns) {
      checkEliminationWin();
      return;
    }

    // Check win condition — when a player hits killLimit, their TEAM wins the round
    if (state.match.scores[killerId].kills >= state.match.killLimit) {
      var killerEntry = state.players[killerId];
      var winningTeam = killerEntry ? killerEntry.team : null;
      endRound(killerId, winningTeam);
    }
  }

  function endRound(winnerId, winningTeam) {
    if (!state) return;
    state.match.roundActive = false;
    hideRespawnHeroPrompt();
    window._roundTransition = true;
    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
    if (typeof playGameSound === 'function') playGameSound('elimination');

    // Track round win by team
    var teamKey = winningTeam || 0;
    if (!state.match.roundWins[teamKey]) state.match.roundWins[teamKey] = 0;
    state.match.roundWins[teamKey]++;

    var roundNum = state.match.currentRound;
    var roundsWon = state.match.roundWins[teamKey];
    var isMatchOver = roundsWon >= state.match.roundsToWin;

    var bannerText;
    if (winningTeam) {
      var teamName = getTeamName(winningTeam);
      bannerText = isMatchOver
        ? teamName + ' wins the match!'
        : teamName + ' wins round ' + roundNum + '!';
    } else {
      var winnerName = getPlayerDisplayName(winnerId);
      bannerText = isMatchOver
        ? winnerName + ' wins the match!'
        : winnerName + ' wins round ' + roundNum + '!';
    }
    showRoundBanner(bannerText, ROUND_BANNER_MS);

    // Emit round result to all clients
    if (socket) {
      socket.emit('roundResult', {
        winnerId: winnerId,
        winningTeam: winningTeam,
        roundNum: roundNum,
        roundWins: state.match.roundWins,
        scores: state.match.scores,
        isMatchOver: isMatchOver
      });
    }

    if (isMatchOver) {
      window._roundTransition = false;
      // Match is over — show post-match results
      if (socket) {
        socket.emit('matchOver', {
          winnerId: winnerId,
          winningTeam: winningTeam,
          scores: state.match.scores
        });
      }
      setTimeout(function () {
        if (!state) return;
        if (typeof window.showPostMatchResults === 'function') {
          window.showPostMatchResults(winnerId, winningTeam);
        }
        window.stopFFAInternal();
      }, ROUND_BANNER_MS + 500);
    } else {
      // More rounds to play — hero select then reset and start next round
      setTimeout(function () {
        if (!state) return;
        state.match.currentRound++;

        // Show hero re-selection (15s timed) before starting next round
        if (typeof window.showPreRoundHeroSelect === 'function') {
          // Notify clients to also show hero select
          if (socket) socket.emit('betweenRoundHeroSelect', { round: state.match.currentRound });

          // Track confirmations for between-round hero select
          var _brHeroConfirmed = {};
          function brCheckAllConfirmed() {
            var ids = Object.keys(state.players);
            for (var ci = 0; ci < ids.length; ci++) {
              if (state.players[ids[ci]].isAI) continue;
              if (!_brHeroConfirmed[ids[ci]]) return;
            }
            if (typeof window.lockInPreRoundHeroSelect === 'function') {
              window.lockInPreRoundHeroSelect();
            }
          }

          // Listen for client hero selections during between-round phase
          var _brHeroHandler = function (payload) {
            if (!payload || !payload.clientId) return;
            _brHeroConfirmed[payload.clientId] = true;
            var entry = state.players[payload.clientId];
            if (entry) {
              entry.heroId = payload.heroId;
              applyHeroWeapon(entry.entity, payload.heroId);
            }
            brCheckAllConfirmed();
          };
          if (socket) socket.on('heroSelect', _brHeroHandler);

          window.showPreRoundHeroSelect({
            seconds: 15,
            onSelected: function (heroId) {
              var localEntry = state && state.players[state.localId];
              if (localEntry) {
                applyHeroWeapon(localEntry.entity, heroId);
                localEntry.heroId = heroId;
                sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
              }
              if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
              _brHeroConfirmed[state.localId] = true;
              brCheckAllConfirmed();
            },
            onLockIn: function (heroId) {
              // Remove the heroSelect listener to prevent stale handler accumulation
              if (socket && _brHeroHandler) socket.off('heroSelect', _brHeroHandler);
              window._roundTransition = false;
              var localEntry = state && state.players[state.localId];
              if (localEntry) {
                applyHeroWeapon(localEntry.entity, heroId);
                localEntry.heroId = heroId;
                sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
              }
              if (typeof window.closePreRoundHeroSelect === 'function') window.closePreRoundHeroSelect();
              resetAllPlayersForRound();
              updateHUDForLocalPlayer();
              startRoundCountdown(COUNTDOWN_SECONDS);
              if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
            }
          });
        } else {
          // Fallback: no hero select available, go straight to round
          window._roundTransition = false;
          resetAllPlayersForRound();
          updateHUDForLocalPlayer();
          startRoundCountdown(COUNTDOWN_SECONDS);
          if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
        }
      }, ROUND_BANNER_MS + 1000);
    }
  }

  // Build all other players' hit targets (excluding the shooter and teammates in TDM)
  function buildHitTargets(shooterId) {
    var targets = [];
    var entities = [];
    var shooterEntry = state.players[shooterId];
    var shooterTeam = shooterEntry ? shooterEntry.team : 0;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === shooterId) continue;
      var entry = state.players[ids[i]];
      if (!entry || !entry.entity || !entry.entity.alive) continue;
      // In TDM, skip teammates
      if (state.mode === 'tdm' && shooterTeam && entry.team === shooterTeam) continue;
      targets.push({ segments: entry.entity.getHitSegments(), entity: entry.entity, playerId: ids[i] });
      entities.push(entry.entity);
    }
    return { targets: targets, entities: entities };
  }

  function getPlayerDirection(id) {
    var entry = state.players[id];
    if (!entry) return new THREE.Vector3(0, 0, -1);
    if (id === state.localId) {
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      return dir;
    }
    var inp = entry.entity.input;
    if (inp.forward && inp.forward.isVector3) return inp.forward.clone().normalize();
    if (inp.forward && Array.isArray(inp.forward) && inp.forward.length === 3) {
      return new THREE.Vector3(inp.forward[0], inp.forward[1], inp.forward[2]).normalize();
    }
    return new THREE.Vector3(0, 0, -1);
  }

  function getPlayerOrigin(id) {
    if (id === state.localId) return camera.position.clone();
    var entry = state.players[id];
    return entry ? entry.entity.position.clone() : new THREE.Vector3();
  }

  function handleReload(id, now) {
    var entry = state.players[id];
    if (!entry || !entry.entity) return;
    if (sharedHandleReload(entry.entity.weapon, now, entry.heroId)) {
      if (id === state.localId) sharedSetReloadingUI(false, state.hud.reloadIndicator);
    }
  }

  function handleMelee(id, now) {
    var entry = state.players[id];
    if (!entry || !entry.entity || !entry.entity.alive) return true;
    var ms = state._meleeSwingState[id];
    if (!ms) { ms = { swinging: false, swingEnd: 0 }; state._meleeSwingState[id] = ms; }
    var w = entry.entity.weapon;
    var inp = entry.entity.input;

    if (ms.swinging) {
      if (now >= ms.swingEnd) ms.swinging = false;
      return false;
    }

    if (!inp.meleeDown) return true;
    if (w.reloading) return true;
    if ((now - w.lastMeleeTime) < w.meleeCooldownMs) return true;

    // For remote (non-host, non-AI) players, use precise aim data sent with melee input
    var dir, origin;
    var pending = (id !== state.localId && !entry.isAI) ? state._remoteInputPending[id] : null;
    if (pending && pending.meleeOrigin) {
      origin = new THREE.Vector3(pending.meleeOrigin[0], pending.meleeOrigin[1], pending.meleeOrigin[2]);
    } else {
      origin = getPlayerOrigin(id);
    }
    if (pending && pending.meleeDir) {
      dir = new THREE.Vector3(pending.meleeDir[0], pending.meleeDir[1], pending.meleeDir[2]).normalize();
    } else {
      dir = getPlayerDirection(id);
    }
    // Clear melee aim data after use
    if (pending) { pending.meleeOrigin = null; pending.meleeDir = null; }
    var hitInfo = buildHitTargets(id);

    sharedMeleeAttack(w, origin, dir, {
      solids: state.arena.solids,
      targets: hitInfo.targets,
      onHit: function (target, point, dist, totalDamage, dmgMult) {
        if (window.devGodMode && target.playerId === state.localId) return;
        var victimEntry = null;
        var victimId = null;
        // Find which player was hit
        for (var j = 0; j < hitInfo.targets.length; j++) {
          if (hitInfo.targets[j].entity === target || hitInfo.targets[j].entity === target.entity) {
            victimId = hitInfo.targets[j].playerId;
            victimEntry = state.players[victimId];
            break;
          }
        }
        if (!victimEntry || !victimEntry.entity.alive) return;

        victimEntry.entity.takeDamage(totalDamage);
        if (id === state.localId && typeof playGameSound === 'function') playGameSound('hit_marker', { headshot: (dmgMult || 1) > 1 });
        if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('damage_taken');
        if (victimId === state.localId) updateHUDForLocalPlayer();

        if (state.match.roundActive && !victimEntry.entity.alive) {
          victimEntry.alive = false;
          victimEntry.respawnAt = state.noRespawns ? 0 : performance.now() + RESPAWN_DELAY_MS;
          if (id === state.localId && typeof playGameSound === 'function') playGameSound('elimination');
          if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('own_death');
          recordKill(id, victimId, 'melee');
        }
      }
    });

    ms.swinging = true;
    ms.swingEnd = now + w.meleeSwingMs;
    if (id === state.localId) {
      if (typeof playGameSound === 'function') playGameSound('melee_swing', { heroId: entry.heroId || undefined });
      if (typeof window.triggerFPMeleeSwing === 'function') window.triggerFPMeleeSwing(w.meleeSwingMs);
    } else {
      if (typeof playGameSound === 'function') playGameSound('melee_swing', { heroId: entry.heroId || undefined, _worldPos: entry.entity.position });
    }
    if (entry.entity.triggerMeleeSwing) entry.entity.triggerMeleeSwing(w.meleeSwingMs);

    if (socket && state.isHost) {
      socket.emit('melee', { playerId: id, swingMs: w.meleeSwingMs });
    }

    if (id === state.localId) updateHUDForLocalPlayer();
    inp.meleeDown = false;
    return false;
  }

  function handleShooting(id, now) {
    var entry = state.players[id];
    if (!entry || !entry.entity || !entry.entity.alive) return;
    var w = entry.entity.weapon;
    var inp = entry.entity.input;

    if (inp.reloadPressed) {
      if (sharedStartReload(w, now, entry.heroId)) {
        if (id === state.localId) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      inp.reloadPressed = false;
      return;
    }
    if (w.reloading) return;
    if (!inp.fireDown) return;
    if ((now - w.lastShotTime) < w.cooldownMs) return;
    if (w.ammo <= 0) {
      if (id === state.localId && typeof playGameSound === 'function') playGameSound('dry_fire');
      if (sharedStartReload(w, now, entry.heroId)) {
        if (id === state.localId) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      return;
    }

    var dir = getPlayerDirection(id);
    var origin = getPlayerOrigin(id);
    // Offset origin slightly forward and down (gun barrel position)
    origin.add(dir.clone().multiplyScalar(0.2)).add(new THREE.Vector3(0, -0.05, 0));

    var hitInfo = buildHitTargets(id);
    var tracerColor = (id === state.localId) ? 0x66ffcc : 0x66aaff;

    var result = sharedFireWeapon(w, origin, dir, {
      sprinting: !!inp.sprint,
      heroId: entry.heroId || undefined,
      solids: state.arena.solids,
      targets: hitInfo.targets,
      projectileTargetEntities: hitInfo.entities,
      tracerColor: tracerColor,
      worldPos: (id !== state.localId) ? origin : null,
      onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
        var victimId = null;
        var victimEntry = null;
        for (var j = 0; j < hitInfo.targets.length; j++) {
          if (hitInfo.targets[j].entity === target || hitInfo.targets[j].entity === target.entity) {
            victimId = hitInfo.targets[j].playerId;
            victimEntry = state.players[victimId];
            break;
          }
        }
        if (!victimEntry || !victimEntry.entity.alive) return;
        if (window.devGodMode && victimId === state.localId) return;

        victimEntry.entity.takeDamage(w.damage * (damageMultiplier || 1.0));
        if (id === state.localId && typeof playGameSound === 'function') playGameSound('hit_marker', { headshot: (damageMultiplier || 1) > 1 });
        if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('damage_taken');
        if (victimId === state.localId) updateHUDForLocalPlayer();

        if (state.match.roundActive && !victimEntry.entity.alive) {
          victimEntry.alive = false;
          victimEntry.respawnAt = state.noRespawns ? 0 : performance.now() + RESPAWN_DELAY_MS;
          if (id === state.localId && typeof playGameSound === 'function') playGameSound('elimination');
          if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('own_death');
          recordKill(id, victimId, w.modelType || 'gun');
          return false;
        }
      },
      onPelletFired: function (pelletResult) {
        if (state.isHost && socket) {
          try {
            if (w.projectileSpeed && w.projectileSpeed > 0) {
              socket.emit('shot', {
                o: [origin.x, origin.y, origin.z],
                d: pelletResult.dir ? [pelletResult.dir.x, pelletResult.dir.y, pelletResult.dir.z] : [0, 0, -1],
                c: tracerColor,
                s: w.projectileSpeed,
                g: w.projectileGravity || 0,
                w: w.modelType
              });
            } else if (pelletResult && pelletResult.point) {
              socket.emit('shot', {
                o: [origin.x, origin.y, origin.z],
                e: [pelletResult.point.x, pelletResult.point.y, pelletResult.point.z],
                c: tracerColor,
                w: w.modelType
              });
            }
          } catch (e) { console.warn('ffa: shot emit failed:', e); }
        }
      }
    });

    if (id === state.localId) updateHUDForLocalPlayer();
    if (result.magazineEmpty) {
      if (sharedStartReload(w, now, entry.heroId)) {
        if (id === state.localId) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
    }
  }

  // ── Host Tick ──

  function simulateHostTick(dt) {
    if (!state) return;
    var ids = Object.keys(state.players);
    var now = performance.now();

    // Phase 1: Apply inputs and update physics for all players
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity) continue;

      // Handle respawning
      if (!entry.alive && entry.respawnAt > 0 && now >= entry.respawnAt) {
        respawnPlayer(id);
      }
      if (!entry.alive) continue;

      // AI players are updated via tickAIPlayers() — skip regular input/physics
      if (entry.isAI) continue;

      // Apply local or remote input
      if (id === state.localId) {
        var localInput = window.getInputState ? window.getInputState() : {};
        var enabledLocal = !!state.inputEnabled;
        entry.entity.input.moveX = enabledLocal ? (localInput.moveX || 0) : 0;
        entry.entity.input.moveZ = enabledLocal ? (localInput.moveZ || 0) : 0;
        entry.entity.input.sprint = enabledLocal && !!localInput.sprint;
        entry.entity.input.jump = enabledLocal && !!localInput.jump;
        entry.entity.input.fireDown = enabledLocal && !!localInput.fireDown;
        entry.entity.input.meleeDown = enabledLocal && !!localInput.meleePressed;
        if (enabledLocal && localInput.reloadPressed) entry.entity.input.reloadPressed = true;

        // Hide respawn hero prompt on first movement (500ms grace period for stale input)
        if (state._respawnHeroPromptActive
            && (performance.now() - state._respawnHeroPromptShownAt > 500)
            && (localInput.moveX || localInput.moveZ)) {
          hideRespawnHeroPrompt();
        }

        sharedSetCrosshairBySprint(!!localInput.sprint, entry.entity.weapon.spreadRad, entry.entity.weapon.sprintSpreadRad);
        sharedSetSprintUI(!!localInput.sprint, state.hud.sprintIndicator);

        // Physics
        var prevGrounded = entry.entity.grounded;
        updateFullPhysics(
          entry.entity,
          { moveX: entry.entity.input.moveX, moveZ: entry.entity.input.moveZ, sprint: entry.entity.input.sprint, jump: entry.entity.input.jump },
          { colliders: state.arena.colliders, solids: state.arena.solids },
          dt
        );
        entry.entity._hitboxYaw = camera.rotation.y;
        entry.entity._syncMeshPosition();
        entry.entity.syncCameraFromPlayer();

        // Movement sounds
        if (typeof playGameSound === 'function') {
          var _hid = entry.heroId || undefined;
          if (prevGrounded && !entry.entity.grounded) playGameSound('jump', { heroId: _hid });
          if (!prevGrounded && entry.entity.grounded) playGameSound('land', { heroId: _hid });
          var moving = (entry.entity.input.moveX !== 0 || entry.entity.input.moveZ !== 0);
          if (moving && entry.entity.grounded && typeof playFootstepIfDue === 'function') {
            playFootstepIfDue(!!entry.entity.input.sprint, entry.heroId, now);
          }
        }
      } else {
        // Remote player
        var ri = state._remoteInputs[id] || {};
        var pending = state._remoteInputPending[id] || {};
        var activeRound = !!(state.match && state.match.roundActive);

        entry.entity.input.moveX = activeRound ? (ri.moveX || 0) : 0;
        entry.entity.input.moveZ = activeRound ? (ri.moveZ || 0) : 0;
        entry.entity.input.sprint = activeRound && !!ri.sprint;
        if (activeRound && (ri.jump || pending.jump)) entry.entity.input.jump = true;
        entry.entity.input.fireDown = activeRound && !!ri.fireDown;
        if (activeRound && (ri.meleeDown || pending.melee)) entry.entity.input.meleeDown = true;
        if (activeRound && (ri.reloadPressed || pending.reload)) entry.entity.input.reloadPressed = true;

        if (ri.forward && Array.isArray(ri.forward) && ri.forward.length === 3) {
          entry.entity.input.forward = new THREE.Vector3(ri.forward[0], ri.forward[1], ri.forward[2]);
        }

        // Compute world-space move direction from their forward vector
        var fwd = (entry.entity.input.forward && entry.entity.input.forward.isVector3)
          ? entry.entity.input.forward.clone()
          : new THREE.Vector3(0, 0, -1);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        var moveDir = new THREE.Vector3();
        moveDir.addScaledVector(fwd, entry.entity.input.moveZ || 0);
        moveDir.addScaledVector(right, entry.entity.input.moveX || 0);
        if (moveDir.lengthSq() > 1e-6) moveDir.normalize(); else moveDir.set(0, 0, 0);

        var prevGroundedRemote = entry.entity.grounded;
        updateFullPhysics(
          entry.entity,
          { worldMoveDir: moveDir, sprint: entry.entity.input.sprint, jump: entry.entity.input.jump },
          { colliders: state.arena.colliders, solids: state.arena.solids },
          dt
        );
        entry.entity.input.jump = false;

        // Sync hitbox yaw from their forward vector
        var riFwd = ri.forward;
        if (riFwd && Array.isArray(riFwd) && riFwd.length === 3) {
          entry.entity._hitboxYaw = Math.atan2(riFwd[0], riFwd[2]);
        }
        entry.entity._meshGroup.rotation.set(0, entry.entity._hitboxYaw, 0);
        entry.entity._syncMeshPosition();

        // Movement sounds for remote players (spatial)
        if (typeof playGameSound === 'function') {
          var remotePos = entry.entity.position;
          var _rhid = entry.heroId || undefined;
          if (prevGroundedRemote && !entry.entity.grounded) playGameSound('jump', { heroId: _rhid, _worldPos: remotePos });
          if (!prevGroundedRemote && entry.entity.grounded) playGameSound('land', { heroId: _rhid, _worldPos: remotePos });
          var remoteMoving = (entry.entity.input.moveX !== 0 || entry.entity.input.moveZ !== 0);
          if (remoteMoving && entry.entity.grounded && typeof playFootstepIfDue === 'function') {
            playFootstepIfDue(!!entry.entity.input.sprint, entry.heroId, now, remotePos);
          }
        }

        // Clear pending one-shot flags
        if (state._remoteInputPending[id]) {
          state._remoteInputPending[id].jump = false;
          state._remoteInputPending[id].reload = false;
          state._remoteInputPending[id].melee = false;
        }
      }
    }

    // Phase 1b: AI players — update AI state machine, physics, and shooting
    if (state.match.roundActive) {
      tickAIPlayers(dt);
    }

    // Phase 1c: Ability updates for all players
    var dtMs = dt * 1000;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity || !entry.entity.abilityManager) continue;
      entry.entity.abilityManager.update(dtMs);
    }
    // Ability input activation for local player
    var localEntry = state.players[state.localId];
    if (localEntry && localEntry.entity && localEntry.entity.abilityManager && state.inputEnabled) {
      var localInput = window.getInputState ? window.getInputState() : {};
      var abState = localEntry.entity.abilityManager.getHUDState();
      for (var ai = 0; ai < abState.length; ai++) {
        if (localInput[abState[ai].key]) {
          localEntry.entity.abilityManager.activate(abState[ai].id);
        }
      }
    }

    // Phase 2: Combat (melee + shooting) for human players after all physics
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity || !entry.alive || entry.isAI) continue;
      // Melee-only weapons: left-click triggers melee swing, not fire
      if (entry.entity.weapon && entry.entity.weapon.meleeOnly && entry.entity.input.fireDown) {
        entry.entity.input.meleeDown = true;
        entry.entity.input.fireDown = false;
      }
      var ms = state._meleeSwingState[id];
      var canShoot = handleMelee(id, now);
      if (canShoot && (!ms || !ms.swinging)) handleShooting(id, now);
      handleReload(id, now);
    }

    // Phase 3: Update projectiles
    if (typeof updateProjectiles === 'function') updateProjectiles(dt);

    // Phase 4: Hitbox viz
    if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();

    // Phase 5: Update 3D health bars for remote players
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === state.localId) continue;
      var entry = state.players[ids[i]];
      if (entry && entry.entity && entry.entity.alive) {
        entry.entity.update3DHealthBar(camera.position, state.arena.solids, { checkLOS: true });
      }
    }

    // Phase 6: Send snapshot
    maybeSendSnapshot(now);

    // Phase 7: Update ability HUD for local player
    var localAbm = state.players[state.localId];
    if (localAbm && localAbm.entity && localAbm.entity.abilityManager && typeof window.updateAbilityHUD === 'function') {
      window.updateAbilityHUD(localAbm.entity.abilityManager.getHUDState());
    }

    // Phase 8: Update audio listener for spatial sound
    if (typeof window.updateAudioListener === 'function') {
      window.updateAudioListener(camera.position, camera.quaternion);
    }
  }

  var lastSnapshotMs = 0;
  function maybeSendSnapshot(nowMs, force) {
    if (!socket) return;
    if (!force && (nowMs - lastSnapshotMs) < SNAPSHOT_RATE) return;
    lastSnapshotMs = nowMs;

    var playersSnap = {};
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity) continue;
      playersSnap[id] = {
        pos: [entry.entity.position.x, entry.entity.position.y, entry.entity.position.z],
        feetY: entry.entity.feetY,
        grounded: entry.entity.grounded,
        health: entry.entity.health,
        alive: entry.alive,
        yaw: entry.entity._hitboxYaw,
        ammo: entry.entity.weapon.ammo,
        magSize: entry.entity.weapon.magSize,
        reloading: entry.entity.weapon.reloading,
        reloadEnd: entry.entity.weapon.reloadEnd,
        team: entry.team || 0,
        heroId: entry.heroId || 'marksman'
      };
    }

    socket.emit('snapshot', {
      players: playersSnap,
      scores: state.match.scores,
      t: nowMs
    });
  }

  // ── Client Tick ──

  function simulateClientTick(dt) {
    if (!state || !state.localId) return;
    var entry = state.players[state.localId];
    if (!entry || !entry.entity) return;

    var now = performance.now();
    var p = entry.entity;

    // Read local input
    var rawInput = window.getInputState ? window.getInputState() : {};
    var enabled = !!state.inputEnabled;
    p.input.moveX = enabled ? (rawInput.moveX || 0) : 0;
    p.input.moveZ = enabled ? (rawInput.moveZ || 0) : 0;
    p.input.sprint = enabled && !!rawInput.sprint;
    p.input.jump = enabled && !!rawInput.jump;
    p.input.fireDown = enabled && !!rawInput.fireDown;
    p.input.meleeDown = enabled && !!rawInput.meleePressed;
    if (enabled && rawInput.reloadPressed) p.input.reloadPressed = true;
    // Melee-only weapons: left-click triggers melee swing, not fire
    if (p.weapon && p.weapon.meleeOnly && p.input.fireDown) {
      p.input.meleeDown = true;
      p.input.fireDown = false;
    }

    // Hide respawn hero prompt on first movement (500ms grace period for stale input)
    if (state._respawnHeroPromptActive
        && (performance.now() - state._respawnHeroPromptShownAt > 500)
        && (rawInput.moveX || rawInput.moveZ)) {
      hideRespawnHeroPrompt();
    }

    sharedSetCrosshairBySprint(!!rawInput.sprint, p.weapon.spreadRad, p.weapon.sprintSpreadRad);
    sharedSetSprintUI(!!rawInput.sprint, state.hud.sprintIndicator);

    // Client-side prediction: run physics locally
    if (entry.alive) {
      var prevGrounded = p.grounded;
      if (_predictedPos) {
        p.position.copy(_predictedPos);
        p.feetY = _predictedFeetY;
        p.verticalVelocity = _predictedVVel;
        p.grounded = _predictedGrounded;
      }

      updateFullPhysics(
        p,
        { moveX: p.input.moveX, moveZ: p.input.moveZ, sprint: p.input.sprint, jump: p.input.jump },
        { colliders: state.arena.colliders, solids: state.arena.solids },
        dt
      );

      _predictedPos = p.position.clone();
      _predictedFeetY = p.feetY;
      _predictedVVel = p.verticalVelocity;
      _predictedGrounded = p.grounded;

      p._hitboxYaw = camera.rotation.y;
      p._syncMeshPosition();
      p.syncCameraFromPlayer();

      if (typeof playGameSound === 'function') {
        var _chid = entry.heroId || undefined;
        if (prevGrounded && !p.grounded) playGameSound('jump', { heroId: _chid });
        if (!prevGrounded && p.grounded) playGameSound('land', { heroId: _chid });
        var moving = (p.input.moveX !== 0 || p.input.moveZ !== 0);
        if (moving && p.grounded && typeof playFootstepIfDue === 'function') {
          playFootstepIfDue(!!p.input.sprint, entry.heroId, now);
        }
      }
    }

    // Handle local reload completion
    if (p.weapon.reloading && now >= p.weapon.reloadEnd) {
      if (sharedHandleReload(p.weapon, now, entry.heroId)) {
        sharedSetReloadingUI(false, state.hud.reloadIndicator);
      }
    }
    if (p.input.reloadPressed && !p.weapon.reloading) {
      if (sharedStartReload(p.weapon, now, entry.heroId)) {
        sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      p.input.reloadPressed = false;
    }

    // Capture melee intent before prediction consumes it (needed for host input send)
    var meleeIntent = !!p.input.meleeDown;

    // Client-side melee prediction (animation + sound + HUD only, no damage)
    var clientMs = state._meleeSwingState[state.localId];
    if (!clientMs) { clientMs = { swinging: false, swingEnd: 0 }; state._meleeSwingState[state.localId] = clientMs; }
    if (clientMs.swinging && now >= clientMs.swingEnd) clientMs.swinging = false;
    if (entry.alive && p.input.meleeDown && !clientMs.swinging) {
      var w = p.weapon;
      if (!w.reloading && (now - w.lastMeleeTime) >= w.meleeCooldownMs) {
        clientMs.swinging = true;
        clientMs.swingEnd = now + w.meleeSwingMs;
        w.lastMeleeTime = now;
        if (typeof playGameSound === 'function') playGameSound('melee_swing', { heroId: entry.heroId || undefined });
        if (typeof window.triggerFPMeleeSwing === 'function') window.triggerFPMeleeSwing(w.meleeSwingMs);
        if (p.triggerMeleeSwing) p.triggerMeleeSwing(w.meleeSwingMs);
      }
    }
    p.input.meleeDown = false;

    // Interpolate remote players
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      var rid = ids[i];
      if (rid === state.localId) continue;
      var re = state.players[rid];
      if (!re || !re.entity) continue;
      var interp = _remoteInterp[rid];
      if (interp && interp.to) {
        re.entity.position.lerp(interp.to, LERP_RATE);
        re.entity.feetY += (interp.toFeetY - re.entity.feetY) * LERP_RATE;
        re.entity._syncMeshPosition();
      }
      if (re.entity.alive) {
        re.entity.update3DHealthBar(camera.position, state.arena.solids, { checkLOS: true });
      }
    }

    if (typeof updateProjectiles === 'function') updateProjectiles(dt);
    if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();

    // Update audio listener for spatial sound
    if (typeof window.updateAudioListener === 'function') {
      window.updateAudioListener(camera.position, camera.quaternion);
    }

    // Send input to host
    if (socket && entry.alive) {
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      var inputPacket = {
        moveX: p.input.moveX,
        moveZ: p.input.moveZ,
        sprint: p.input.sprint,
        jump: enabled && !!rawInput.jump,
        fireDown: p.input.fireDown,
        reloadPressed: enabled && !!rawInput.reloadPressed,
        meleeDown: meleeIntent,
        forward: [dir.x, dir.y, dir.z]
      };
      // Include precise aim data with melee so host can use client's exact position/direction
      if (meleeIntent) {
        inputPacket.meleeOrigin = [camera.position.x, camera.position.y, camera.position.z];
        inputPacket.meleeDir = [dir.x, dir.y, dir.z];
      }
      socket.emit('input', inputPacket);
    }

    // Ability update + input activation + HUD for local player
    if (p.abilityManager) {
      p.abilityManager.update(dt * 1000);
      if (enabled) {
        var abState = p.abilityManager.getHUDState();
        for (var ai = 0; ai < abState.length; ai++) {
          if (rawInput[abState[ai].key]) {
            p.abilityManager.activate(abState[ai].id);
          }
        }
      }
      if (typeof window.updateAbilityHUD === 'function') {
        window.updateAbilityHUD(p.abilityManager.getHUDState());
      }
    }

    updateHUDForLocalPlayer();
  }

  function applySnapshotOnClient(snap) {
    if (!state || !snap || !snap.players) return;
    var now = performance.now();
    if (snap.scores) state.match.scores = snap.scores;

    var snapPlayers = snap.players;
    var ids = Object.keys(snapPlayers);

    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var sp = snapPlayers[id];
      if (!sp) continue;

      if (id === state.localId) {
        var localEntry = state.players[id];
        if (!localEntry || !localEntry.entity) continue;

        localEntry.entity.health = sp.health;
        if (!sp.alive && localEntry.entity.alive) {
          localEntry.entity.alive = false;
          if (typeof playGameSound === 'function') playGameSound('damage_taken');
          if (typeof playGameSound === 'function') playGameSound('own_death');
        }
        localEntry.alive = sp.alive;
        localEntry.entity.alive = sp.alive;

        if (sp.reloading && !_prevLocalReloading) {
          sharedSetReloadingUI(true, state.hud.reloadIndicator);
        } else if (!sp.reloading && _prevLocalReloading) {
          sharedSetReloadingUI(false, state.hud.reloadIndicator);
        }
        _prevLocalReloading = sp.reloading;
        localEntry.entity.weapon.ammo = sp.ammo;
        localEntry.entity.weapon.magSize = sp.magSize;
        localEntry.entity.weapon.reloading = sp.reloading;
        localEntry.entity.weapon.reloadEnd = sp.reloadEnd;

        if (_predictedPos && sp.pos) {
          var serverPos = new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]);
          var dx = _predictedPos.x - serverPos.x;
          var dz = _predictedPos.z - serverPos.z;
          var dy = _predictedFeetY - sp.feetY;
          var distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > SNAP_THRESHOLD_SQ) {
            _predictedPos.copy(serverPos);
            _predictedFeetY = sp.feetY;
            _predictedVVel = 0;
            _predictedGrounded = sp.grounded;
            localEntry.entity.position.copy(serverPos);
            localEntry.entity.feetY = sp.feetY;
          } else {
            // Smooth reconcile XZ; Y is driven by feetY via physics
            _predictedPos.x += (serverPos.x - _predictedPos.x) * 0.1;
            _predictedPos.z += (serverPos.z - _predictedPos.z) * 0.1;
            _predictedFeetY += (sp.feetY - _predictedFeetY) * 0.15;
            _predictedPos.y = _predictedFeetY + EYE_HEIGHT;
            _predictedGrounded = sp.grounded;
            if (sp.grounded && _predictedVVel < 0) _predictedVVel = 0;
          }
        } else if (sp.pos) {
          _predictedPos = new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]);
          _predictedFeetY = sp.feetY;
          _predictedGrounded = sp.grounded;
        }
        _lastSnapshotTime = now;
        continue;
      }

      // Remote player
      var re = state.players[id];
      if (!re) {
        var pos = sp.pos ? new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]) : new THREE.Vector3();
        var remoteTeam = sp.team || 0;
        var remoteHeroId = sp.heroId || 'marksman';
        var rp = createPlayerInstance({ position: pos, color: remoteTeam ? getTeamColor(remoteTeam) : randomPlayerColor(), cameraAttached: false });
        state.players[id] = { entity: rp, heroId: remoteHeroId, alive: sp.alive, isAI: false, respawnAt: 0, team: remoteTeam };
        state.match.scores[id] = state.match.scores[id] || { kills: 0, deaths: 0 };
        re = state.players[id];
        // Apply hero visuals, hitbox, and stats
        if (remoteHeroId !== 'marksman' && typeof window.applyHeroToPlayer === 'function') {
          window.applyHeroToPlayer(rp, remoteHeroId);
        }
      }

      // Sync hero if it changed (e.g. between rounds)
      if (sp.heroId && sp.heroId !== re.heroId) {
        re.heroId = sp.heroId;
        if (typeof window.applyHeroToPlayer === 'function') {
          window.applyHeroToPlayer(re.entity, sp.heroId);
        }
      }

      if (sp.pos) {
        var targetPos = new THREE.Vector3(sp.pos[0], sp.pos[1], sp.pos[2]);
        if (!_remoteInterp[id]) {
          _remoteInterp[id] = { to: targetPos, toFeetY: sp.feetY };
          re.entity.position.copy(targetPos);
          re.entity.feetY = sp.feetY;
        } else {
          _remoteInterp[id].to = targetPos;
          _remoteInterp[id].toFeetY = sp.feetY;
        }
      }

      // Detect damage to trigger 3D health bar display
      if (sp.health < re.entity.health) {
        re.entity.lastDamagedAt = performance.now();
      }
      re.entity.health = sp.health;
      if (sp.alive && !re.alive) {
        re.alive = true; re.entity.alive = true; re.entity._meshGroup.visible = true;
      } else if (!sp.alive && re.alive) {
        re.alive = false; re.entity.alive = false; re.entity._meshGroup.visible = false;
      }
      if (sp.yaw !== undefined) {
        re.entity._hitboxYaw = sp.yaw;
        re.entity._meshGroup.rotation.set(0, sp.yaw, 0);
      }
      re.entity._syncMeshPosition();
    }

    // Remove players no longer in snapshot
    var localIds = Object.keys(state.players);
    for (var j = 0; j < localIds.length; j++) {
      var lid = localIds[j];
      if (lid === state.localId) continue;
      if (!snapPlayers[lid]) { removePlayer(lid); delete _remoteInterp[lid]; }
    }

    if (typeof window.updateFFAScoreboard === 'function') window.updateFFAScoreboard();
  }

  // ── Main Loop ──

  function tick(ts) {
    if (!window.ffaActive || !state) return;

    var dt = state.lastTs ? Math.min(MAX_DT, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    if (state.isHost) {
      simulateHostTick(dt);
    } else {
      simulateClientTick(dt);
    }

    // Update melee cooldown timer for local player
    var local = state.players[state.localId];
    if (local && local.entity && local.entity.weapon && state.hud.meleeCooldown) {
      sharedUpdateMeleeCooldown(state.hud.meleeCooldown, local.entity.weapon, performance.now());
    }

    state.loopHandle = requestAnimationFrame(tick);
  }

  // ── Public API ──

  window.startFFAHost = function (roomId, settings, existingSocket) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.ffaActive) { try { stopFFAInternal(); } catch (e) {} }
    // Cross-mode cleanup: stop training range if active
    if (window.trainingRangeActive && typeof window.stopTrainingRangeInternal === 'function') {
      try { window.stopTrainingRangeInternal(false); } catch (e) {}
    }

    var mapName = settings && settings.mapName;
    var preloadedMapData = settings && settings.mapData;

    if (existingSocket) {
      // Reuse lobby socket — room already created on server
      socket = existingSocket;
      _usingLobbySocket = true;
      attachSocketHandlers();
      function doStartLobby(mapData) {
        startFFASession(settings || {}, mapData);
      }
      // Prefer pre-loaded mapData from game setup (avoids re-fetch + silent fallback)
      if (preloadedMapData) {
        try { doStartLobby(preloadedMapData); } catch (err) { console.error('FFA session start failed:', err); }
      } else if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
        fetchMapData(mapName).then(doStartLobby).catch(function (err) { console.error('Map fetch failed, using default:', err); doStartLobby(null); });
      } else {
        doStartLobby(null);
      }
      return;
    }

    function doHost(mapData) {
      ensureSocket();
      socket.emit('createRoom', roomId, Object.assign({}, settings || {}, { maxPlayers: (settings && settings.maxPlayers) || 8 }), function (res) {
        if (!res || !res.ok) { alert(res && res.error ? res.error : 'Failed to create room'); return; }
        startFFASession(settings || {}, mapData);
      });
    }

    // Prefer pre-loaded mapData from game setup
    if (preloadedMapData) {
      try { doHost(preloadedMapData); } catch (err) { console.error('FFA host start failed:', err); }
    } else if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
      fetchMapData(mapName).then(doHost).catch(function (err) { console.error('Map fetch failed, using default:', err); doHost(null); });
    } else {
      doHost(null);
    }
  };

  function attachSocketHandlers() {
    if (_handlersAttached || !socket) return;
    _handlersAttached = true;

    socket.on('roomClosed', function () {
      stopFFAInternal();
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });

    socket.on('hostTransfer', function (payload) {
      if (!state || !payload) return;
      // Remove the old host's player entity
      if (payload.oldHostId && state.players[payload.oldHostId]) {
        removePlayer(payload.oldHostId);
      }
      if (payload.newHostId === state.localId) {
        // This client is the new host
        state.isHost = true;
        showRoundBanner('You are now the host', 3000);
        if (window._lobbyState) {
          window._lobbyState.isHost = true;
        }
      } else {
        showRoundBanner('Host transferred', 2000);
      }
    });

    // Remote player input (host receives)
    socket.on('input', function (payload) {
      if (!state || !state.isHost || !payload || !payload.clientId) return;
      var cid = payload.clientId;
      if (!state._remoteInputPending[cid]) state._remoteInputPending[cid] = { jump: false, reload: false, melee: false };
      if (payload.jump) state._remoteInputPending[cid].jump = true;
      if (payload.reloadPressed) state._remoteInputPending[cid].reload = true;
      if (payload.meleeDown) {
        state._remoteInputPending[cid].melee = true;
        // Store precise aim data from client for melee hit detection
        if (payload.meleeOrigin) state._remoteInputPending[cid].meleeOrigin = payload.meleeOrigin;
        if (payload.meleeDir) state._remoteInputPending[cid].meleeDir = payload.meleeDir;
      }
      state._remoteInputs[cid] = payload;
    });

    // New player joined
    socket.on('clientJoined', function (payload) {
      if (!state || !state.isHost) return;
      var clientId = payload && payload.clientId;
      if (!clientId) return;
      addRemotePlayer(clientId);
      showRoundBanner('Player joined', ROUND_BANNER_MS);
    });

    socket.on('clientLeft', function (payload) {
      if (!state || !state.isHost) return;
      var clientId = payload && payload.clientId;
      if (!clientId) return;
      removePlayer(clientId);
      showRoundBanner('Player left', ROUND_BANNER_MS);
    });

    // Hero selection from remote player
    socket.on('heroSelect', function (payload) {
      if (!state || !state.isHost) return;
      if (payload && payload.heroId && payload.clientId) {
        var entry = state.players[payload.clientId];
        if (entry) {
          entry.heroId = payload.heroId;
          applyHeroWeapon(entry.entity, payload.heroId);
        }
      }
    });

    // Kill event (clients receive from host)
    socket.on('ffaKill', function (payload) {
      if (!state || !payload) return;
      var killerDisplay = (payload.killerId === state.localId) ? 'You' : (payload.killerName || 'Player');
      var victimDisplay = (payload.victimId === state.localId) ? 'You' : (payload.victimName || 'Player');
      showKillFeedEntry(killerDisplay, victimDisplay);
      if (typeof window.updateFFAScoreboard === 'function') {
        window.updateFFAScoreboard();
      }
      if (payload.killerId === state.localId && typeof playGameSound === 'function') playGameSound('elimination');
      if (payload.victimId === state.localId && typeof playGameSound === 'function') playGameSound('own_death');
    });

    // ── Client-side socket events ──

    socket.on('snapshot', function (snap) {
      if (!state || state.isHost) return;
      applySnapshotOnClient(snap);
    });

    socket.on('shot', function (data) {
      if (!state || !data) return;
      var o = new THREE.Vector3(data.o[0], data.o[1], data.o[2]);
      if (data.s && data.d) {
        // Projectile
        var d = new THREE.Vector3(data.d[0], data.d[1], data.d[2]);
        var vel = d.clone().multiplyScalar(data.s);
        if (typeof spawnVisualProjectile === 'function') {
          spawnVisualProjectile({
            position: o,
            velocity: vel,
            gravity: data.g || 0,
            tracerColor: data.c || 0x66aaff,
            maxRange: 200,
            solids: (state && state.arena) ? state.arena.solids : []
          });
        }
      } else if (data.e) {
        // Hitscan tracer
        var e = new THREE.Vector3(data.e[0], data.e[1], data.e[2]);
        if (typeof spawnTracer === 'function') spawnTracer(o, e, data.c || 0x66aaff, TRACER_LIFETIME);
      }
      if (typeof playGameSound === 'function') playGameSound('weapon_fire', { weaponModelType: data.w || 'rifle', _worldPos: o });
    });

    socket.on('melee', function (data) {
      if (!state || !data) return;
      if (data.playerId === state.localId) return; // already predicted locally
      var entry = state.players[data.playerId];
      if (entry && entry.entity && entry.entity.triggerMeleeSwing) {
        entry.entity.triggerMeleeSwing(data.swingMs || 300);
      }
      if (typeof playGameSound === 'function') playGameSound('melee_swing', { heroId: (entry && entry.heroId) || undefined, _worldPos: (entry && entry.entity) ? entry.entity.position : null });
    });

    // Between-round hero re-selection (clients)
    socket.on('betweenRoundHeroSelect', function (data) {
      if (!state || state.isHost) return;
      if (typeof window.showPreRoundHeroSelect !== 'function') return;
      window.showPreRoundHeroSelect({
        seconds: 15,
        onSelected: function (heroId) {
          var localEntry = state && state.players[state.localId];
          if (localEntry) {
            applyHeroWeapon(localEntry.entity, heroId);
            localEntry.heroId = heroId;
            sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
          }
          if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
        },
        onLockIn: function (heroId) {
          var localEntry = state && state.players[state.localId];
          if (localEntry) {
            applyHeroWeapon(localEntry.entity, heroId);
            localEntry.heroId = heroId;
            sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
          }
          if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
          // Don't close or start countdown — wait for host's startRound
        }
      });
    });

    socket.on('startRound', function (data) {
      if (!state || state.isHost) return;
      window._roundTransition = false;
      // If hero select is still open, auto-confirm current hero before starting round
      if (window._heroSelectOpen && typeof window.closePreRoundHeroSelect === 'function') {
        var localEntry = state.players[state.localId];
        var curHero = (typeof window.getCurrentHeroId === 'function') ? window.getCurrentHeroId() : 'marksman';
        if (localEntry) {
          applyHeroWeapon(localEntry.entity, curHero);
          localEntry.heroId = curHero;
          sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
        }
        if (socket) socket.emit('heroSelect', { heroId: curHero, clientId: state.localId });
        window.closePreRoundHeroSelect();
      }
      var secs = (data && data.seconds) || COUNTDOWN_SECONDS;
      resetAllPlayersForRound();
      updateHUDForLocalPlayer();
      startRoundCountdown(secs);
    });

    socket.on('roundResult', function (data) {
      if (!state || state.isHost) return;
      state.match.roundActive = false;
      hideRespawnHeroPrompt();
      window._roundTransition = true;
      if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
      if (typeof playGameSound === 'function') playGameSound('elimination');
      if (data && data.roundWins) state.match.roundWins = data.roundWins;
      if (data && data.scores) state.match.scores = data.scores;

      var bannerText;
      if (data && data.winningTeam) {
        var teamName = getTeamName(data.winningTeam);
        bannerText = data.isMatchOver
          ? teamName + ' wins the match!'
          : teamName + ' wins round ' + (data.roundNum || state.match.currentRound) + '!';
      } else {
        var winnerName = (data && data.winnerId)
          ? getPlayerDisplayName(data.winnerId)
          : 'Player';
        bannerText = data.isMatchOver
          ? winnerName + ' wins the match!'
          : winnerName + ' wins round ' + (data.roundNum || state.match.currentRound) + '!';
      }
      showRoundBanner(bannerText, ROUND_BANNER_MS);
      // If not match over, the host will send startRound for the next round
      if (!data.isMatchOver && data.roundNum) {
        state.match.currentRound = data.roundNum + 1;
      }
    });

    socket.on('matchOver', function (data) {
      if (!state || state.isHost) return;
      window._roundTransition = false;
      state.match.roundActive = false;
      if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
      if (typeof playGameSound === 'function') playGameSound('elimination');

      var bannerText;
      if (data && data.winningTeam) {
        bannerText = getTeamName(data.winningTeam) + ' wins!';
      } else {
        var winnerName = 'Player';
        if (data && data.winnerId) {
          winnerName = getPlayerDisplayName(data.winnerId);
        }
        bannerText = winnerName + ' wins!';
      }
      if (data && data.scores) state.match.scores = data.scores;
      showRoundBanner(bannerText, ROUND_BANNER_MS);
      setTimeout(function () {
        if (!state) return;
        // Populate post-match scoreboard BEFORE destroying state
        if (typeof window.showPostMatchResults === 'function') {
          window.showPostMatchResults(data && data.winnerId, data && data.winningTeam);
        }
        window.stopFFAInternal();
        // showPostMatchResults already calls showOnlyMenu + setHUDVisible
      }, ROUND_BANNER_MS + 500);
    });
  }

  function ensureSocket() {
    if (socket) return;
    if (typeof io !== 'function') {
      alert('Socket.IO client not found. Make sure the server is running.');
      return;
    }
    socket = io();
    attachSocketHandlers();
  }

  function addRemotePlayer(clientId) {
    if (!state || state.players[clientId]) return;
    var lobbyTeam = state._lobbyTeamAssignments && state._lobbyTeamAssignments[clientId];
    var team = (lobbyTeam && lobbyTeam > 0) ? lobbyTeam : assignTeam();
    var spawnPos = getTeamSpawnPosition(team);
    var p = createPlayerInstance({
      position: spawnPos,
      color: getTeamColor(team),
      cameraAttached: false
    });
    state.players[clientId] = {
      entity: p,
      heroId: 'marksman',
      alive: true,
      isAI: false,
      respawnAt: 0,
      team: team
    };
    var lobbyPlayers = window._lobbyState && window._lobbyState.playerList;
    if (lobbyPlayers) {
      for (var i = 0; i < lobbyPlayers.length; i++) {
        if (lobbyPlayers[i].id === clientId) {
          state.players[clientId].name = lobbyPlayers[i].name;
          break;
        }
      }
    }
    state.match.scores[clientId] = { kills: 0, deaths: 0 };
    state._meleeSwingState[clientId] = { swinging: false, swingEnd: 0 };
    state._remoteInputs[clientId] = {};
    state._remoteInputPending[clientId] = { jump: false, reload: false, melee: false };
  }

  function removePlayer(id) {
    if (!state || !state.players[id]) return;
    var entry = state.players[id];
    if (entry.entity) {
      try { entry.entity.destroy(); } catch (e) { console.warn('ffa: player.destroy failed:', e); }
    }
    delete state.players[id];
    delete state.match.scores[id];
    delete state._meleeSwingState[id];
    delete state._remoteInputs[id];
    delete state._remoteInputPending[id];
  }

  var _playerColors = [0x66ffcc, 0xff8844, 0x55aaff, 0xff55aa, 0xaaff55, 0xffff55, 0xaa55ff, 0xff5555];
  var _colorIdx = 0;
  function randomPlayerColor() {
    return _playerColors[(_colorIdx++) % _playerColors.length];
  }

  function startFFASession(settings, mapData) {
    // Defensive cleanup: remove any leftover arena groups from the scene
    if (typeof scene !== 'undefined' && scene) {
      for (var ci = scene.children.length - 1; ci >= 0; ci--) {
        var cname = scene.children[ci].name;
        if (cname === 'PaintballArena' || cname === 'TrainingRangeArena') {
          scene.remove(scene.children[ci]);
        }
      }
    }

    state = newState(settings);
    state.isHost = true;
    state.localId = socket.id;

    // Build arena with mode-specific spawns
    var gameMode = (settings && settings.mode) || 'ffa';
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData, gameMode)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData(), gameMode) : buildPaintballArenaSymmetric());

    // Populate spawnsFFA with team info from arena spawnsList
    state.spawnsFFA = [];
    if (state.arena.spawnsList && state.arena.spawnsList.length > 0) {
      for (var si = 0; si < state.arena.spawnsList.length; si++) {
        var sp = state.arena.spawnsList[si];
        state.spawnsFFA.push({
          position: new THREE.Vector3(sp.position[0], sp.position[1] || 0, sp.position[2]),
          team: sp.team || 0
        });
      }
    }

    // Fallback: if no spawns from spawnsList, use A/B spawns
    if (state.spawnsFFA.length === 0 && state.arena.spawns) {
      state.spawnsFFA = [
        { position: state.arena.spawns.A.clone(), team: 1 },
        { position: state.arena.spawns.B.clone(), team: 2 }
      ];
    }

    // Store lobby team assignments for use during player creation
    state._lobbyTeamAssignments = (settings && settings.teamAssignments) || {};

    // Create host player with team assignment
    _colorIdx = 0;
    var lobbyHostTeam = state._lobbyTeamAssignments[state.localId];
    var hostTeam = (lobbyHostTeam && lobbyHostTeam > 0) ? lobbyHostTeam : assignTeam();
    var hostSpawn = getTeamSpawnPosition(hostTeam);
    var hostPlayer = createPlayerInstance({
      position: hostSpawn,
      color: getTeamColor(hostTeam),
      cameraAttached: true
    });
    state.players[state.localId] = {
      entity: hostPlayer,
      heroId: 'marksman',
      alive: true,
      isAI: false,
      respawnAt: 0,
      team: hostTeam,
      name: (typeof localStorage !== 'undefined' && localStorage.getItem('playerName')) || 'Player 1'
    };
    state.match.scores[state.localId] = { kills: 0, deaths: 0 };
    state._meleeSwingState[state.localId] = { swinging: false, swingEnd: 0 };

    // Load AI configs from lobby settings into _aiSlots
    clearAISlots();
    if (settings && settings.aiConfigs && Array.isArray(settings.aiConfigs)) {
      for (var ai = 0; ai < settings.aiConfigs.length; ai++) {
        addAISlot(settings.aiConfigs[ai].hero || 'marksman', settings.aiConfigs[ai].difficulty || 'Medium', settings.aiConfigs[ai].team || 0);
      }
    }

    // Spawn AI bots from lobby slots
    try { spawnAIPlayers(); } catch (aiErr) { console.error('Failed to spawn AI players:', aiErr); }

    // Add remote human players already in the lobby (clientJoined fires during
    // lobby phase before FFA handlers are attached, so those events are missed)
    var lobbyPlayers = window._lobbyState && window._lobbyState.playerList;
    if (lobbyPlayers) {
      for (var lp = 0; lp < lobbyPlayers.length; lp++) {
        var lpId = lobbyPlayers[lp].id;
        if (lpId && lpId !== state.localId && !lobbyPlayers[lp].isBot && !state.players[lpId]) {
          addRemotePlayer(lpId);
        }
      }
    }

    // Setup HUD
    setHUDVisible(true);
    showOnlyMenu(null);
    showFFAHUD(true);
    setCrosshairDimmed(false);
    setCrosshairSpread(0);
    updateHUDForLocalPlayer();

    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    // Sync camera to host spawn
    hostPlayer.syncCameraFromPlayer();
    camera.rotation.set(0, 0, 0, 'YXZ');

    window.ffaActive = true;
    if (typeof window.startFFAScoreboardPolling === 'function') window.startFFAScoreboardPolling();
    state.lastTs = 0;
    lastSnapshotMs = 0;
    state.loopHandle = requestAnimationFrame(tick);

    // Show hero select overlay, then start countdown
    // Track which players have confirmed hero selection (host initial round)
    var _heroConfirmed = {};
    function checkAllHeroesConfirmed() {
      var ids = Object.keys(state.players);
      for (var ci = 0; ci < ids.length; ci++) {
        if (state.players[ids[ci]].isAI) continue;
        if (!_heroConfirmed[ids[ci]]) return;
      }
      // All humans have selected — lock in early
      if (typeof window.lockInPreRoundHeroSelect === 'function') {
        window.lockInPreRoundHeroSelect();
      }
    }

    if (typeof window.showPreRoundHeroSelect === 'function') {
      window.showPreRoundHeroSelect({
        seconds: 15,
        onSelected: function (heroId) {
          var localEntry = state && state.players[state.localId];
          if (localEntry) {
            applyHeroWeapon(localEntry.entity, heroId);
            localEntry.heroId = heroId;
            sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
          }
          if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
          _heroConfirmed[state.localId] = true;
          checkAllHeroesConfirmed();
        },
        onLockIn: function (heroId) {
          // Remove the heroSelect listener to prevent stale handler accumulation
          if (socket && _initHeroHandler) socket.off('heroSelect', _initHeroHandler);
          var localEntry = state && state.players[state.localId];
          if (localEntry) {
            applyHeroWeapon(localEntry.entity, heroId);
            localEntry.heroId = heroId;
            sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
          }
          if (typeof window.closePreRoundHeroSelect === 'function') window.closePreRoundHeroSelect();
          startRoundCountdown(COUNTDOWN_SECONDS);
          if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
        }
      });

      // Listen for heroSelect from clients during initial hero select
      var _initHeroHandler = null;
      if (socket) {
        _initHeroHandler = function (payload) {
          if (!payload || !payload.clientId) return;
          _heroConfirmed[payload.clientId] = true;
          var entry = state.players[payload.clientId];
          if (entry) {
            entry.heroId = payload.heroId;
            applyHeroWeapon(entry.entity, payload.heroId);
          }
          checkAllHeroesConfirmed();
        };
        socket.on('heroSelect', _initHeroHandler);
      }
    } else {
      // Fallback: no hero select available, start immediately
      startRoundCountdown(COUNTDOWN_SECONDS);
      if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
    }
  }

  function initClientSession(clientSettings) {
    // Defensive cleanup: remove any leftover arena groups from the scene
    if (typeof scene !== 'undefined' && scene) {
      for (var ci = scene.children.length - 1; ci >= 0; ci--) {
        var cname = scene.children[ci].name;
        if (cname === 'PaintballArena' || cname === 'TrainingRangeArena') {
          scene.remove(scene.children[ci]);
        }
      }
    }

    state = newState(clientSettings || {});
    state.isHost = false;
    state.localId = socket.id;

    var mapName = clientSettings && clientSettings.mapName;

    function setupClient(mapData) {
      // Build arena with mode-specific spawns
      var gameMode = (clientSettings && clientSettings.mode) || 'ffa';
      state.arena = (mapData && typeof buildArenaFromMap === 'function')
        ? buildArenaFromMap(mapData, gameMode)
        : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData(), gameMode) : buildPaintballArenaSymmetric());

      // Populate spawnsFFA with team info from arena spawnsList
      state.spawnsFFA = [];
      if (state.arena.spawnsList && state.arena.spawnsList.length > 0) {
        for (var si = 0; si < state.arena.spawnsList.length; si++) {
          var sp = state.arena.spawnsList[si];
          state.spawnsFFA.push({
            position: new THREE.Vector3(sp.position[0], sp.position[1] || 0, sp.position[2]),
            team: sp.team || 0
          });
        }
      }

      if (state.spawnsFFA.length === 0 && state.arena.spawns) {
        state.spawnsFFA = [
          { position: state.arena.spawns.A.clone(), team: 1 },
          { position: state.arena.spawns.B.clone(), team: 2 }
        ];
      }

      // Create local player with team assignment
      _colorIdx = 0;
      var localTeam = assignTeam();
      var spawnPos = getTeamSpawnPosition(localTeam);
      var localPlayer = createPlayerInstance({
        position: spawnPos,
        color: getTeamColor(localTeam),
        cameraAttached: true
      });
      state.players[state.localId] = {
        entity: localPlayer,
        heroId: 'marksman',
        alive: true,
        isAI: false,
        respawnAt: 0,
        team: localTeam,
        name: (typeof localStorage !== 'undefined' && localStorage.getItem('playerName')) || 'Player'
      };
      state.match.scores[state.localId] = { kills: 0, deaths: 0 };
      state._meleeSwingState[state.localId] = { swinging: false, swingEnd: 0 };

      // Reset prediction state
      _predictedPos = localPlayer.position.clone();
      _predictedFeetY = localPlayer.feetY;
      _predictedVVel = 0;
      _predictedGrounded = true;
      _lastSnapshotTime = 0;
      _prevLocalReloading = false;
      _remoteInterp = {};

      // Setup HUD
      setHUDVisible(true);
      showOnlyMenu(null);
      showFFAHUD(true);
      setCrosshairDimmed(false);
      setCrosshairSpread(0);
      updateHUDForLocalPlayer();

      if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }

      localPlayer.syncCameraFromPlayer();
      camera.rotation.set(0, 0, 0, 'YXZ');

      window.ffaActive = true;
      if (typeof window.startFFAScoreboardPolling === 'function') window.startFFAScoreboardPolling();
      state.lastTs = 0;
      state.loopHandle = requestAnimationFrame(tick);

      // Show hero select overlay — client waits for host's startRound
      if (typeof window.showPreRoundHeroSelect === 'function') {
        window.showPreRoundHeroSelect({
          seconds: 15,
          onSelected: function (heroId) {
            var localEntry = state && state.players[state.localId];
            if (localEntry) {
              applyHeroWeapon(localEntry.entity, heroId);
              localEntry.heroId = heroId;
              sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
            }
            if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
          },
          onLockIn: function (heroId) {
            var localEntry = state && state.players[state.localId];
            if (localEntry) {
              applyHeroWeapon(localEntry.entity, heroId);
              localEntry.heroId = heroId;
              sharedSetMeleeOnlyHUD(!!localEntry.entity.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
            }
            if (socket) socket.emit('heroSelect', { heroId: heroId, clientId: state.localId });
            // Don't start countdown — wait for host's startRound event
          }
        });
      }
      // Client countdown is started by the socket 'startRound' handler
    }

    if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
      fetchMapData(mapName).then(setupClient).catch(function (err) { console.error('Client map fetch failed, using default:', err); setupClient(null); });
    } else {
      setupClient(null);
    }
  }

  window.joinFFAGame = function (roomId, existingSocket, lobbySettings) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.ffaActive) { try { stopFFAInternal(); } catch (e) {} }

    if (existingSocket) {
      // Reuse lobby socket — already joined room on server
      socket = existingSocket;
      _usingLobbySocket = true;
      attachSocketHandlers();
      initClientSession(lobbySettings || {});
      return;
    }

    ensureSocket();

    socket.emit('joinRoom', roomId, function (res) {
      if (!res || !res.ok) { alert(res && res.error ? res.error : 'Failed to join room'); return; }
      initClientSession(res.settings || {});
    });
  };

  // Called when all players are in and host presses start
  window.startFFARound = function () {
    if (!state || !state.isHost) return;
    resetAllPlayersForRound();
    updateHUDForLocalPlayer();
    startRoundCountdown(COUNTDOWN_SECONDS);
    if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
  };

  window.stopFFAInternal = function () {
    try { if (socket && state) socket.emit('leaveRoom'); } catch (e) {}
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch (e) {}
      state.loopHandle = 0;
    }
    try { if (typeof window.closePreRoundHeroSelect === 'function') window.closePreRoundHeroSelect(); } catch (e) {}
    // Clean up respawn hero prompt and round transition flag
    window._roundTransition = false;
    var rhp = document.getElementById('respawnHeroPrompt');
    if (rhp) rhp.classList.add('hidden');
    window._ffaRespawnHeroCallback = null;
    window._cancelRespawnHeroTimer = null;
    if (state) {
      if (state._respawnHeroPromptTimer) clearTimeout(state._respawnHeroPromptTimer);
      if (state.bannerTimerRef && state.bannerTimerRef.id) {
        clearTimeout(state.bannerTimerRef.id);
        state.bannerTimerRef.id = 0;
      }
      if (state.countdownTimerRef && state.countdownTimerRef.id) {
        clearInterval(state.countdownTimerRef.id);
        state.countdownTimerRef.id = 0;
      }
      if (state.heroSelectTimerRef && state.heroSelectTimerRef.id) {
        clearTimeout(state.heroSelectTimerRef.id);
        state.heroSelectTimerRef.id = 0;
      }
      // Destroy all player instances (including AI opponents)
      var ids = Object.keys(state.players);
      for (var i = 0; i < ids.length; i++) {
        var entry = state.players[ids[i]];
        if (entry && entry.aiInstance) {
          try { entry.aiInstance.destroy(); } catch (e) { console.warn('ffa: ai.destroy failed:', e); }
        } else if (entry && entry.entity) {
          try { entry.entity.destroy(); } catch (e) { console.warn('ffa: player.destroy failed:', e); }
        }
      }
      if (state.arena && state.arena.group && state.arena.group.parent) {
        state.arena.group.parent.remove(state.arena.group);
      }
      showFFAHUD(false);
      clearKillFeed();
      if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
      setCrosshairDimmed(false);
      setCrosshairSpread(0);
      if (typeof clearFirstPersonWeapon === 'function') clearFirstPersonWeapon();
    }
    // Reset client-side prediction state
    _predictedPos = null;
    _predictedFeetY = GROUND_Y;
    _predictedVVel = 0;
    _predictedGrounded = true;
    _lastSnapshotTime = 0;
    _prevLocalReloading = false;
    _remoteInterp = {};

    window.ffaActive = false;
    if (typeof window.stopFFAScoreboardPolling === 'function') window.stopFFAScoreboardPolling();
    lastSnapshotMs = 0;
    state = null;
    socket = null;
    _handlersAttached = false;
    _usingLobbySocket = false;
  };
})();
