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
    return state.spawnsFFA[index % state.spawnsFFA.length].clone();
  }

  // ── AI Bot Management ──
  var _aiSlots = []; // { heroId, difficulty, name } — lobby AI slot definitions

  function addAISlot(heroId, difficulty) {
    var name = '[AI] Bot ' + (_aiSlots.length + 1);
    _aiSlots.push({ heroId: heroId || 'marksman', difficulty: difficulty || 'Medium', name: name });
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
      var spawnPos = getSpawnPosition(state._spawnIndex++);

      var ai = new AIOpponent({
        difficulty: slot.difficulty,
        arena: state.arena,
        spawn: { x: spawnPos.x, z: spawnPos.z },
        color: randomPlayerColor()
      });

      // Apply selected hero
      if (typeof window.applyHeroToPlayer === 'function') {
        window.applyHeroToPlayer(ai.player, slot.heroId);
      }

      state.players[aiId] = {
        entity: ai.player,
        heroId: slot.heroId,
        alive: true,
        isAI: true,
        aiInstance: ai,
        name: slot.name,
        respawnAt: 0
      };
      state.match.scores[aiId] = { kills: 0, deaths: 0 };
      state._meleeSwingState[aiId] = { swinging: false, swingEnd: 0 };
    }
  }

  function buildAITargetList(excludeId) {
    var targets = [];
    if (!state) return targets;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === excludeId) continue;
      var entry = state.players[ids[i]];
      if (!entry || !entry.entity || !entry.alive) continue;
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
        onPlayerHit: function (aiId) {
          return function (damage) {
            // AI damage is handled via sharedFireWeapon/sharedMeleeAttack callbacks
            // which already call takeDamage on the target entity
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
      players: {},        // { [socketId]: { entity: Player, heroId, alive, input: {}, isAI: false, respawnAt: 0 } }
      arena: null,
      spawnsFFA: [],
      match: {
        scores: {},       // { [socketId]: { kills: 0, deaths: 0 } }
        killLimit: (settings && settings.killLimit) || 10,
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
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity) continue;
      var spawnPos = getSpawnPosition(state._spawnIndex++);
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
    var spawnPos = getSpawnPosition(state._spawnIndex++);
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
    }

    entry.entity._syncMeshPosition();

    // Broadcast immediate snapshot so clients see the respawn
    if (state.isHost) maybeSendSnapshot(performance.now(), true);
  }

  function getPlayerName(id) {
    if (!id) return 'Unknown';
    if (state && state.players[id] && state.players[id].name) return state.players[id].name;
    if (id === (state && state.localId)) return 'You';
    return 'Player ' + id.substring(0, 4);
  }

  function recordKill(killerId, victimId, weapon) {
    if (!state || !state.match || !state.match.scores) return;
    if (!state.match.scores[killerId]) state.match.scores[killerId] = { kills: 0, deaths: 0 };
    if (!state.match.scores[victimId]) state.match.scores[victimId] = { kills: 0, deaths: 0 };
    state.match.scores[killerId].kills++;
    state.match.scores[victimId].deaths++;

    // Broadcast kill event to all clients
    var killPayload = {
      killerId: killerId,
      victimId: victimId,
      weapon: weapon || 'unknown',
      killerName: getPlayerName(killerId),
      victimName: getPlayerName(victimId)
    };
    if (socket && state.isHost) {
      socket.emit('ffaKill', killPayload);
    }

    // Show local kill feed
    showKillFeedEntry(killPayload.killerName, killPayload.victimName);

    // Update scoreboard if available
    if (typeof window.updateFFAScoreboard === 'function') {
      window.updateFFAScoreboard();
    }

    // Check win condition
    if (state.match.scores[killerId].kills >= state.match.killLimit) {
      endMatch(killerId);
    }
  }

  function endMatch(winnerId) {
    if (!state) return;
    state.match.roundActive = false;
    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
    if (typeof playGameSound === 'function') playGameSound('elimination');

    var winnerName = 'Player';
    if (winnerId === state.localId) {
      winnerName = 'You';
    } else {
      // Could look up player name from server data
      winnerName = 'Player ' + winnerId.substring(0, 4);
    }

    showRoundBanner(winnerName + ' wins!', ROUND_BANNER_MS);

    // Emit match over to all players
    if (socket) {
      socket.emit('matchOver', { winnerId: winnerId, scores: state.match.scores });
    }

    setTimeout(function () {
      if (!state) return;
      // Populate post-match scoreboard BEFORE destroying state
      if (typeof window.showPostMatchResults === 'function') {
        window.showPostMatchResults(winnerId);
      }
      window.stopFFAInternal();
      // showPostMatchResults already calls showOnlyMenu + setHUDVisible
    }, ROUND_BANNER_MS + 500);
  }

  // Build all other players' hit targets (excluding the shooter)
  function buildHitTargets(shooterId) {
    var targets = [];
    var entities = [];
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === shooterId) continue;
      var entry = state.players[ids[i]];
      if (!entry || !entry.entity || !entry.entity.alive) continue;
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
    if (sharedHandleReload(entry.entity.weapon, now)) {
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

    var dir = getPlayerDirection(id);
    var origin = getPlayerOrigin(id);
    var hitInfo = buildHitTargets(id);

    sharedMeleeAttack(w, origin, dir, {
      solids: state.arena.solids,
      targets: hitInfo.targets,
      onHit: function (target, point, dist, totalDamage) {
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
        if (id === state.localId && typeof playGameSound === 'function') playGameSound('hit_marker');
        if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('damage_taken');
        if (victimId === state.localId) updateHUDForLocalPlayer();

        if (state.match.roundActive && !victimEntry.entity.alive) {
          victimEntry.alive = false;
          victimEntry.respawnAt = performance.now() + RESPAWN_DELAY_MS;
          if (typeof playGameSound === 'function') playGameSound('elimination');
          recordKill(id, victimId, 'melee');
        }
      }
    });

    ms.swinging = true;
    ms.swingEnd = now + w.meleeSwingMs;
    if (id === state.localId) {
      if (typeof playGameSound === 'function') playGameSound('melee_swing');
      if (typeof window.triggerFPMeleeSwing === 'function') window.triggerFPMeleeSwing(w.meleeSwingMs);
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
      if (sharedStartReload(w, now)) {
        if (id === state.localId) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      inp.reloadPressed = false;
      return;
    }
    if (w.reloading) return;
    if (!inp.fireDown) return;
    if ((now - w.lastShotTime) < w.cooldownMs) return;
    if (w.ammo <= 0) {
      if (sharedStartReload(w, now)) {
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
      solids: state.arena.solids,
      targets: hitInfo.targets,
      projectileTargetEntities: hitInfo.entities,
      tracerColor: tracerColor,
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
        if (id === state.localId && typeof playGameSound === 'function') playGameSound('hit_marker');
        if (victimId === state.localId && typeof playGameSound === 'function') playGameSound('damage_taken');
        if (victimId === state.localId) updateHUDForLocalPlayer();

        if (state.match.roundActive && !victimEntry.entity.alive) {
          victimEntry.alive = false;
          victimEntry.respawnAt = performance.now() + RESPAWN_DELAY_MS;
          if (typeof playGameSound === 'function') playGameSound('elimination');
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
      if (sharedStartReload(w, now)) {
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
          if (prevGrounded && !entry.entity.grounded) playGameSound('jump');
          if (!prevGrounded && entry.entity.grounded) playGameSound('land');
          var moving = (entry.entity.input.moveX !== 0 || entry.entity.input.moveZ !== 0);
          if (moving && entry.entity.grounded && typeof playFootstepIfDue === 'function') {
            playFootstepIfDue(!!entry.entity.input.sprint, null, now);
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

    // Phase 2: Combat (melee + shooting) for human players after all physics
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var entry = state.players[id];
      if (!entry || !entry.entity || !entry.alive || entry.isAI) continue;
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
        reloadEnd: entry.entity.weapon.reloadEnd
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
        if (prevGrounded && !p.grounded) playGameSound('jump');
        if (!prevGrounded && p.grounded) playGameSound('land');
        var moving = (p.input.moveX !== 0 || p.input.moveZ !== 0);
        if (moving && p.grounded && typeof playFootstepIfDue === 'function') {
          playFootstepIfDue(!!p.input.sprint, null, now);
        }
      }
    }

    // Handle local reload completion
    if (p.weapon.reloading && now >= p.weapon.reloadEnd) {
      if (sharedHandleReload(p.weapon, now)) {
        sharedSetReloadingUI(false, state.hud.reloadIndicator);
      }
    }
    if (p.input.reloadPressed && !p.weapon.reloading) {
      if (sharedStartReload(p.weapon, now)) {
        sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      p.input.reloadPressed = false;
    }

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

    // Send input to host
    if (socket && entry.alive) {
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      socket.emit('input', {
        moveX: p.input.moveX,
        moveZ: p.input.moveZ,
        sprint: p.input.sprint,
        jump: enabled && !!rawInput.jump,
        fireDown: p.input.fireDown,
        reloadPressed: enabled && !!rawInput.reloadPressed,
        meleeDown: p.input.meleeDown,
        forward: [dir.x, dir.y, dir.z]
      });
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
          var distSq = dx * dx + dz * dz;
          if (distSq > SNAP_THRESHOLD_SQ) {
            _predictedPos.copy(serverPos);
            _predictedFeetY = sp.feetY;
            _predictedVVel = 0;
            _predictedGrounded = sp.grounded;
            localEntry.entity.position.copy(serverPos);
            localEntry.entity.feetY = sp.feetY;
          } else {
            _predictedPos.lerp(serverPos, 0.1);
            _predictedFeetY += (sp.feetY - _predictedFeetY) * 0.1;
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
        var rp = createPlayerInstance({ position: pos, color: randomPlayerColor(), cameraAttached: false });
        state.players[id] = { entity: rp, heroId: 'marksman', alive: sp.alive, isAI: false, respawnAt: 0 };
        state.match.scores[id] = state.match.scores[id] || { kills: 0, deaths: 0 };
        re = state.players[id];
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
    if (window.paintballActive) { try { stopPaintballInternal(); } catch (e) {} }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch (e) {} }
    if (window.ffaActive) { try { stopFFAInternal(); } catch (e) {} }

    var mapName = settings && settings.mapName;

    if (existingSocket) {
      // Reuse lobby socket — room already created on server
      socket = existingSocket;
      _usingLobbySocket = true;
      attachSocketHandlers();
      function doStartLobby(mapData) {
        startFFASession(settings || {}, mapData);
      }
      if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
        fetchMapData(mapName).then(doStartLobby).catch(function () { doStartLobby(null); });
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

    if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
      fetchMapData(mapName).then(doHost).catch(function () { doHost(null); });
    } else {
      doHost(null);
    }
  };

  function attachSocketHandlers() {
    if (_handlersAttached || !socket) return;
    _handlersAttached = true;

    socket.on('roomClosed', function () {
      alert('Host left. Room closed.');
      stopFFAInternal();
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });

    // Remote player input (host receives)
    socket.on('input', function (payload) {
      if (!state || !state.isHost || !payload || !payload.clientId) return;
      var cid = payload.clientId;
      if (!state._remoteInputPending[cid]) state._remoteInputPending[cid] = { jump: false, reload: false, melee: false };
      if (payload.jump) state._remoteInputPending[cid].jump = true;
      if (payload.reloadPressed) state._remoteInputPending[cid].reload = true;
      if (payload.meleeDown) state._remoteInputPending[cid].melee = true;
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
      showKillFeedEntry(payload.killerName || 'Player', payload.victimName || 'Player');
      if (typeof window.updateFFAScoreboard === 'function') {
        window.updateFFAScoreboard();
      }
      if (typeof playGameSound === 'function') playGameSound('elimination');
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
        if (typeof spawnVisualProjectile === 'function') {
          spawnVisualProjectile(o, d, data.s, data.g || 0, data.c || 0x66aaff);
        }
      } else if (data.e) {
        // Hitscan tracer
        var e = new THREE.Vector3(data.e[0], data.e[1], data.e[2]);
        if (typeof spawnTracer === 'function') spawnTracer(o, e, data.c || 0x66aaff, TRACER_LIFETIME);
      }
      if (typeof playGameSound === 'function') playGameSound('gunshot');
    });

    socket.on('melee', function (data) {
      if (!state || !data) return;
      var entry = state.players[data.playerId];
      if (entry && entry.entity && entry.entity.triggerMeleeSwing) {
        entry.entity.triggerMeleeSwing(data.swingMs || 300);
      }
      if (typeof playGameSound === 'function') playGameSound('melee_swing');
    });

    socket.on('startRound', function (data) {
      if (!state || state.isHost) return;
      var secs = (data && data.seconds) || COUNTDOWN_SECONDS;
      resetAllPlayersForRound();
      updateHUDForLocalPlayer();
      startRoundCountdown(secs);
    });

    socket.on('matchOver', function (data) {
      if (!state || state.isHost) return;
      state.match.roundActive = false;
      if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
      if (typeof playGameSound === 'function') playGameSound('elimination');
      var winnerName = 'Player';
      if (data && data.winnerId) {
        winnerName = (data.winnerId === state.localId) ? 'You' : ('Player ' + data.winnerId.substring(0, 4));
      }
      if (data && data.scores) state.match.scores = data.scores;
      showRoundBanner(winnerName + ' wins!', ROUND_BANNER_MS);
      setTimeout(function () {
        if (!state) return;
        // Populate post-match scoreboard BEFORE destroying state
        if (typeof window.showPostMatchResults === 'function') {
          window.showPostMatchResults(data && data.winnerId);
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
    var spawnPos = getSpawnPosition(state._spawnIndex++);
    var p = createPlayerInstance({
      position: spawnPos,
      color: randomPlayerColor(),
      cameraAttached: false
    });
    state.players[clientId] = {
      entity: p,
      heroId: 'marksman',
      alive: true,
      isAI: false,
      respawnAt: 0
    };
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
    state = newState(settings);
    state.isHost = true;
    state.localId = socket.id;

    // Build arena
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());

    state.spawnsFFA = state.arena.spawnsFFA || [];

    // Fallback: if no FFA spawns, use A/B spawns
    if (state.spawnsFFA.length === 0 && state.arena.spawns) {
      state.spawnsFFA = [state.arena.spawns.A.clone(), state.arena.spawns.B.clone()];
    }

    // Create host player
    _colorIdx = 0;
    var hostSpawn = getSpawnPosition(state._spawnIndex++);
    var hostPlayer = createPlayerInstance({
      position: hostSpawn,
      color: randomPlayerColor(),
      cameraAttached: true
    });
    state.players[state.localId] = {
      entity: hostPlayer,
      heroId: 'marksman',
      alive: true,
      isAI: false,
      respawnAt: 0
    };
    state.match.scores[state.localId] = { kills: 0, deaths: 0 };
    state._meleeSwingState[state.localId] = { swinging: false, swingEnd: 0 };

    // Spawn AI bots from lobby slots
    spawnAIPlayers();

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

    showRoundBanner('Waiting for players...', 999999);

    window.ffaActive = true;
    if (typeof window.startFFAScoreboardPolling === 'function') window.startFFAScoreboardPolling();
    state.lastTs = 0;
    lastSnapshotMs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  }

  function initClientSession(clientSettings) {
    state = newState(clientSettings || {});
    state.isHost = false;
    state.localId = socket.id;

    var mapName = clientSettings && clientSettings.mapName;

    function setupClient(mapData) {
      state.arena = (mapData && typeof buildArenaFromMap === 'function')
        ? buildArenaFromMap(mapData)
        : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());

      state.spawnsFFA = state.arena.spawnsFFA || [];
      if (state.spawnsFFA.length === 0 && state.arena.spawns) {
        state.spawnsFFA = [state.arena.spawns.A.clone(), state.arena.spawns.B.clone()];
      }

      // Create local player
      _colorIdx = 0;
      var spawnPos = getSpawnPosition(state._spawnIndex++);
      var localPlayer = createPlayerInstance({
        position: spawnPos,
        color: randomPlayerColor(),
        cameraAttached: true
      });
      state.players[state.localId] = {
        entity: localPlayer,
        heroId: 'marksman',
        alive: true,
        isAI: false,
        respawnAt: 0
      };
      state.match.scores[state.localId] = { kills: 0, deaths: 0 };

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

      showRoundBanner('Joined! Waiting for host...', 999999);

      window.ffaActive = true;
      if (typeof window.startFFAScoreboardPolling === 'function') window.startFFAScoreboardPolling();
      state.lastTs = 0;
      state.loopHandle = requestAnimationFrame(tick);
    }

    if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
      fetchMapData(mapName).then(setupClient).catch(function () { setupClient(null); });
    } else {
      setupClient(null);
    }
  }

  window.joinFFAGame = function (roomId, existingSocket, lobbySettings) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.paintballActive) { try { stopPaintballInternal(); } catch (e) {} }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch (e) {} }
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
    if (state) {
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
      // Destroy all player instances
      var ids = Object.keys(state.players);
      for (var i = 0; i < ids.length; i++) {
        var entry = state.players[ids[i]];
        if (entry && entry.entity) {
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
    lastSnapshotMs = 0;
    state = null;
    socket = null;
    _handlersAttached = false;
    _usingLobbySocket = false;
  };
})();
