/**
 * modeLAN.js — LAN multiplayer mode
 *
 * PURPOSE: Host-authoritative 2-player LAN multiplayer. The host runs physics
 *          for both players and broadcasts snapshots at ~30Hz. The client sends
 *          raw input each frame, runs client-side prediction, and reconciles
 *          with authoritative snapshots via lerp. Includes hero selection phase
 *          coordination between host and client.
 * EXPORTS (window): multiplayerActive, getMultiplayerState, hostLanGame,
 *                   joinLanGame, stopMultiplayerInternal
 * DEPENDENCIES: THREE (r128), Socket.IO, scene/camera/renderer globals (game.js),
 *               hud.js, roundFlow.js, crosshair.js, physics.js, projectiles.js,
 *               weapon.js, heroes.js, heroSelectUI.js, input.js,
 *               arenaCompetitive.js, player.js (Player),
 *               mapFormat.js (buildArenaFromMap, getDefaultMapData),
 *               menuNavigation.js (showOnlyMenu, setHUDVisible)
 * NOTE: Mode flag is still window.multiplayerActive (for backward compat, rename later)
 */

(function () {
  window.multiplayerActive = false;
  window.getMultiplayerState = function () { return state; };

  var PLAYER_RADIUS = 0.5;
  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;
  var SNAPSHOT_RATE = 33;       // ms between snapshots (~30Hz)
  var DEFAULT_HEALTH = 100;     // starting health
  var DEFAULT_DAMAGE = 20;      // damage per hit
  var ROUNDS_TO_WIN = 2;        // rounds needed to win
  var MAX_DT = 0.05;            // max delta-time clamp (seconds)
  var SNAP_THRESHOLD_SQ = 25;   // squared distance to snap instead of lerp
  var ROUND_BANNER_MS = 1200;   // duration for round banners
  var COUNTDOWN_SECONDS = 3;    // pre-round countdown
  var SHOT_DELAY_AFTER_COUNTDOWN = 300; // ms to delay firing after countdown starts
  var TRACER_LIFETIME = 70;     // ms tracer visual lasts

  var socket = null;
  var isHost = false;
  var currentRoomId = null;
  var hostId = null;
  var state = null;

  function defaultSettings() {
    return {
      roundsToWin: ROUNDS_TO_WIN,
    };
  }

  function mkHudRefs() {
    return {
      healthContainer: document.getElementById('healthContainer'),
      healthFill: document.getElementById('healthFill'),
      ammoDisplay: document.getElementById('ammoDisplay'),
      reloadIndicator: document.getElementById('reloadIndicator'),
      sprintIndicator: document.getElementById('sprintIndicator'),
      bannerEl: document.getElementById('roundBanner'),
      countdownEl: document.getElementById('roundCountdown'),
    };
  }

  // HUD helpers — delegate to shared
  function updateHUDForPlayer(p) {
    if (!state) return;
    sharedUpdateHealthBar(state.hud.healthFill, p.health, DEFAULT_HEALTH);
    sharedUpdateAmmoDisplay(state.hud.ammoDisplay, p.weapon.ammo, p.weapon.magSize);
  }

  function showMultiplayerHUD(show) {
    if (!state || !state.hud) return;
    if (state.hud.healthContainer) state.hud.healthContainer.classList.toggle('hidden', !show);
  }

  // Round flow — using shared functions
  function showRoundBanner(text, ms) {
    if (!state) return;
    sharedShowRoundBanner(text, state.hud.bannerEl, state.bannerTimerRef, ms);
  }

  function startRoundCountdown(seconds) {
    if (!state) return;
    sharedStartRoundCountdown({
      seconds: seconds || 3,
      countdownEl: state.hud.countdownEl,
      timerRef: state.countdownTimerRef,
      onStart: function () {
        if (!state) return;
        state.inputEnabled = false;
        if (state.match) state.match.roundActive = false;
        state.inputArmed = false;
        var now = performance.now();
        if (state.players && state.players.host && state.players.host.weapon) {
          state.players.host.weapon.lastShotTime = now + SHOT_DELAY_AFTER_COUNTDOWN;
        }
        if (state.players && state.players.client && state.players.client.weapon) {
          state.players.client.weapon.lastShotTime = now + SHOT_DELAY_AFTER_COUNTDOWN;
        }
      },
      onReady: function () {
        if (!state) return;
        state.inputEnabled = true;
        if (state.match) state.match.roundActive = true;
      }
    });
  }

  function resetEntitiesForRound() {
    if (!state) return;
    var A = state.spawns.A;
    var B = state.spawns.B;

    state.players.host.resetForRound(A);
    state.players.client.resetForRound(B);

    // Set camera for local player
    var localPlayer = isHost ? state.players.host : state.players.client;
    localPlayer.syncCameraFromPlayer();
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.lookAt(isHost ? B : A);

    // Attach input objects back
    state.players.host.input = state.players.host.input || { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false, forward: new THREE.Vector3(0, 0, -1) };
    state.players.client.input = state.players.client.input || { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false, forward: new THREE.Vector3(0, 0, -1) };

    updateHUDForPlayer(localPlayer);
  }

  function endRound(who) {
    if (!state || !state.match) return;
    state.match.roundActive = false;
    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();

    if (who === 'p1') state.match.player1Wins++;
    else if (who === 'p2') state.match.player2Wins++;

    var wText = who === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!';
    showRoundBanner(wText, ROUND_BANNER_MS);
    if (socket) socket.emit('roundResult', { winner: who, score: { p1: state.match.player1Wins, p2: state.match.player2Wins } });

    if (state.match.player1Wins >= state.match.toWin || state.match.player2Wins >= state.match.toWin) {
      if (socket) socket.emit('matchOver', { p1: state.match.player1Wins, p2: state.match.player2Wins });
      var finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) {
        finalScoreEl.textContent = 'Player 1 ' + state.match.player1Wins + ' - ' + state.match.player2Wins + ' Player 2';
      }
      window.stopMultiplayerInternal();
      showOnlyMenu('resultMenu');
      setHUDVisible(false);
      return;
    }

    setTimeout(function () {
      if (!state) return;
      resetEntitiesForRound();
      updateHUDForPlayer(isHost ? state.players.host : state.players.client);
      if (isHost) {
        startHeroSelectPhase();
      }
      // Client will receive startHeroSelect event from host
    }, ROUND_BANNER_MS);
  }

  // ── Hero Selection Phase (LAN) ──

  function startHeroSelectPhase() {
    if (!state) return;
    state.heroSelections = { host: null, client: null };

    // Tell client to show hero select
    if (socket) socket.emit('startHeroSelect', { seconds: 15 });

    // Show overlay for host
    window.showPreRoundHeroSelect({
      seconds: 15,
      onConfirmed: function (heroId) {
        state.heroSelections.host = heroId;
        if (socket) socket.emit('heroSelect', { heroId: heroId });
        checkBothHeroesPicked();
      },
      onTimeout: function (heroId) {
        state.heroSelections.host = heroId;
        if (socket) socket.emit('heroSelect', { heroId: heroId });
        checkBothHeroesPicked();
      }
    });

    // Host-side fallback timer: after 16s force-finish if not done
    if (state.heroSelectTimerRef.id) clearTimeout(state.heroSelectTimerRef.id);
    state.heroSelectTimerRef.id = setTimeout(function () {
      if (!state) return;
      finishHeroSelect();
    }, 16000);
  }

  function checkBothHeroesPicked() {
    if (!state) return;
    if (state.heroSelections.host && state.heroSelections.client) {
      finishHeroSelect();
    }
  }

  function finishHeroSelect() {
    if (!state) return;
    // Clear fallback timer
    if (state.heroSelectTimerRef.id) {
      clearTimeout(state.heroSelectTimerRef.id);
      state.heroSelectTimerRef.id = 0;
    }

    // Fill defaults for any null selections
    if (!state.heroSelections.host) state.heroSelections.host = 'marksman';
    if (!state.heroSelections.client) state.heroSelections.client = 'marksman';

    // Apply weapons from hero choices
    applyHeroWeapon(state.players.host, state.heroSelections.host);
    applyHeroWeapon(state.players.client, state.heroSelections.client);

    // Emit confirmed heroes to client
    if (socket) socket.emit('heroesConfirmed', {
      host: state.heroSelections.host,
      client: state.heroSelections.client
    });

    window.closePreRoundHeroSelect();
    updateHUDForPlayer(isHost ? state.players.host : state.players.client);
    startRoundCountdown(COUNTDOWN_SECONDS);
    if (socket) socket.emit('startRound', { seconds: COUNTDOWN_SECONDS });
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

  // Client-side hero select handlers (called from socket events)
  function clientStartHeroSelect(payload) {
    if (!state) return;
    var seconds = (payload && payload.seconds) || 15;
    window.showPreRoundHeroSelect({
      seconds: seconds,
      onConfirmed: function (heroId) {
        if (socket) socket.emit('heroSelect', { heroId: heroId });
        window.showHeroSelectWaiting();
      },
      onTimeout: function (heroId) {
        if (socket) socket.emit('heroSelect', { heroId: heroId });
        window.showHeroSelectWaiting();
      }
    });
  }

  function clientHeroesConfirmed(payload) {
    if (!state) return;
    // Apply own weapon from hero choice
    var myHeroId = (payload && payload.client) || 'marksman';
    applyHeroWeapon(state.players.client, myHeroId);
    // Also apply host's hero for correct damage in snapshots
    var hostHeroId = (payload && payload.host) || 'marksman';
    applyHeroWeapon(state.players.host, hostHeroId);

    window.closePreRoundHeroSelect();
    updateHUDForPlayer(state.players.client);
    // startRound event will also arrive to trigger countdown
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
    // Attach input object for multiplayer
    p.input = { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false, forward: new THREE.Vector3(0, 0, -1) };
    // Store yaw/pitch for network sync
    p.yaw = (opts && typeof opts.yaw === 'number') ? opts.yaw : 0;
    p.pitch = (opts && typeof opts.pitch === 'number') ? opts.pitch : 0;
    return p;
  }

  function newState(settingsFromServer) {
    var merged = Object.assign({}, defaultSettings(), settingsFromServer || {});
    return {
      settings: merged,
      arena: null,
      spawns: { A: new THREE.Vector3(), B: new THREE.Vector3() },
      players: { host: null, client: null },
      hud: mkHudRefs(),
      lastTs: 0,
      loopHandle: 0,
      inputArmed: false,
      inputEnabled: false,
      remoteInputLatest: null,
      playerNumber: 0,
      bannerTimerRef: { id: 0 },
      countdownTimerRef: { id: 0 },
      heroSelections: { host: null, client: null },
      heroSelectTimerRef: { id: 0 },
      match: {
        player1Wins: 0,
        player2Wins: 0,
        toWin: merged.roundsToWin || ROUNDS_TO_WIN,
        roundActive: false
      }
    };
  }

  function placePlayersAtSpawns() {
    var A = state.spawns.A;
    var B = state.spawns.B;

    if (isHost) {
      state.players.host.resetForRound(A);
      state.players.client.resetForRound(B);
      state.players.host.syncCameraFromPlayer();
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.lookAt(new THREE.Vector3(B.x, GROUND_Y + EYE_HEIGHT, B.z));
    } else {
      state.players.host.resetForRound(A);
      state.players.client.resetForRound(B);
      state.players.client.syncCameraFromPlayer();
      camera.rotation.set(0, Math.PI, 0, 'YXZ');
    }
  }

  function isLocalPlayer(p) {
    return (isHost && p === state.players.host) || (!isHost && p === state.players.client);
  }

  function handleReload(p, now) {
    if (sharedHandleReload(p.weapon, now)) {
      if (isLocalPlayer(p)) sharedSetReloadingUI(false, state.hud.reloadIndicator);
    }
  }

  function handleShooting(p, now) {
    var w = p.weapon;
    var inp = p.input;
    if (inp.reloadPressed) {
      if (sharedStartReload(w, now)) {
        if (isLocalPlayer(p)) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      inp.reloadPressed = false;
      return;
    }
    if (w.reloading) return;
    if (!inp.fireDown) return;
    if ((now - w.lastShotTime) < w.cooldownMs) return;
    if (w.ammo <= 0) {
      if (sharedStartReload(w, now)) {
        if (isLocalPlayer(p)) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      return;
    }

    var dir;
    if (isLocalPlayer(p) && isHost) {
      dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
    } else {
      if (inp.forward && inp.forward.isVector3) {
        dir = inp.forward.clone().normalize();
      } else if (inp.forward && Array.isArray(inp.forward) && inp.forward.length === 3) {
        dir = new THREE.Vector3(inp.forward[0], inp.forward[1], inp.forward[2]).normalize();
      } else {
        dir = new THREE.Vector3(0, 0, -1);
      }
    }

    var origin = isLocalPlayer(p)
      ? camera.position.clone().add(dir.clone().multiplyScalar(0.2)).add(new THREE.Vector3(0, -0.05, 0))
      : p.position.clone().add(dir.clone().multiplyScalar(0.2)).add(new THREE.Vector3(0, -0.05, 0));
    var other = (p === state.players.host) ? state.players.client : state.players.host;

    // Build segmented hitbox targets
    var hitTargets = [];
    var hitEntities = [];
    if (other && other.alive) {
      hitTargets.push({ segments: other.getHitSegments(), entity: other });
      hitEntities.push(other);
    }
    var tracerColor = isLocalPlayer(p) ? 0x66ffcc : 0x66aaff;

    var result = sharedFireWeapon(w, origin, dir, {
      sprinting: !!inp.sprint,
      solids: state.arena.solids,
      targets: hitTargets,
      projectileTargetEntities: hitEntities,
      tracerColor: tracerColor,
      onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
        if (other && other.alive) {
          if (window.devGodMode && isLocalPlayer(other)) {
            return; // God mode: skip damage for local player
          }
          other.takeDamage(w.damage * (damageMultiplier || 1.0));
          if (isLocalPlayer(other)) updateHUDForPlayer(other);
          if (isHost && state.match && state.match.roundActive && !other.alive) {
            endRound((p === state.players.host) ? 'p1' : 'p2');
            return false; // stop pellet loop
          }
        }
      },
      onPelletFired: function (pelletResult) {
        if (isHost && socket) {
          try {
            // For projectile weapons, send direction + speed for client-side visual
            if (w.projectileSpeed && w.projectileSpeed > 0) {
              socket.emit('shot', {
                o: [origin.x, origin.y, origin.z],
                d: pelletResult.dir ? [pelletResult.dir.x, pelletResult.dir.y, pelletResult.dir.z] : [0, 0, -1],
                c: tracerColor,
                s: w.projectileSpeed,
                g: w.projectileGravity || 0
              });
            } else if (pelletResult && pelletResult.point) {
              socket.emit('shot', {
                o: [origin.x, origin.y, origin.z],
                e: [pelletResult.point.x, pelletResult.point.y, pelletResult.point.z],
                c: tracerColor
              });
            }
          } catch (e) { console.warn('multiplayer: shot emit failed:', e); }
        }
      }
    });

    if (isLocalPlayer(p)) updateHUDForPlayer(p);
    if (result.magazineEmpty) {
      if (sharedStartReload(w, now)) {
        if (isLocalPlayer(p)) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
    }
  }

  function simulateHostTick(dt) {
    if (!state.players.client) return;
    var localInput = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false };
    var enabledLocal = !!state.inputEnabled;
    state.players.host.input.moveX = enabledLocal ? (localInput.moveX || 0) : 0;
    state.players.host.input.moveZ = enabledLocal ? (localInput.moveZ || 0) : 0;
    state.players.host.input.sprint = enabledLocal && !!localInput.sprint;
    state.players.host.input.jump = enabledLocal && !!localInput.jump;
    state.players.host.input.fireDown = enabledLocal && !!localInput.fireDown;
    if (enabledLocal && localInput.reloadPressed) state.players.host.input.reloadPressed = true;

    sharedSetCrosshairBySprint(!!localInput.sprint, state.players.host.weapon.spreadRad, state.players.host.weapon.sprintSpreadRad);
    sharedSetSprintUI(!!localInput.sprint, state.hud.sprintIndicator);

    // Host player physics via updateFullPhysics
    updateFullPhysics(
      state.players.host,
      { moveX: state.players.host.input.moveX, moveZ: state.players.host.input.moveZ, sprint: state.players.host.input.sprint, jump: state.players.host.input.jump },
      { colliders: state.arena.colliders, solids: state.arena.solids },
      dt
    );
    state.players.host._syncMeshPosition();
    state.players.host.syncCameraFromPlayer();

    // Remote input
    var ri = state.remoteInputLatest || {};
    var activeRound = !!(state.match && state.match.roundActive);
    state.players.client.input.moveX = activeRound ? (ri.moveX || 0) : 0;
    state.players.client.input.moveZ = activeRound ? (ri.moveZ || 0) : 0;
    state.players.client.input.sprint = activeRound && !!ri.sprint;
    state.players.client.input.jump = activeRound && !!ri.jump;
    state.players.client.input.fireDown = activeRound && !!ri.fireDown;
    if (activeRound && ri.reloadPressed) state.players.client.input.reloadPressed = true;

    if (!state.players.client || !state.players.client.input) return;
    if (ri.forward && Array.isArray(ri.forward) && ri.forward.length === 3) {
      state.players.client.input.forward = new THREE.Vector3(ri.forward[0], ri.forward[1], ri.forward[2]);
    }

    // Move client using their forward vector via updateFullPhysics with worldMoveDir
    (function () {
      var inp = state.players.client.input;
      var fwd = (inp.forward && inp.forward.isVector3) ? inp.forward.clone() :
                (Array.isArray(inp.forward) && inp.forward.length === 3 ? new THREE.Vector3(inp.forward[0], inp.forward[1], inp.forward[2]) :
                 new THREE.Vector3(0, 0, -1));
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      var dir = new THREE.Vector3();
      dir.addScaledVector(fwd, inp.moveZ || 0);
      dir.addScaledVector(right, inp.moveX || 0);
      if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, 0);

      updateFullPhysics(
        state.players.client,
        { worldMoveDir: dir, sprint: inp.sprint, jump: inp.jump },
        { colliders: state.arena.colliders, solids: state.arena.solids },
        dt
      );
    })();

    var now = performance.now();
    handleShooting(state.players.host, now);
    handleShooting(state.players.client, now);
    handleReload(state.players.host, now);
    handleReload(state.players.client, now);

    // Update live projectiles
    if (typeof updateProjectiles === 'function') updateProjectiles(dt);

    // Update remote player mesh position and facing
    var remotePlayer = state.players.client;
    remotePlayer._syncMeshPosition();
    remotePlayer.faceToward(state.players.host.position);
    remotePlayer.update3DHealthBar(camera.position, state.arena.solids, { checkLOS: true });

    maybeSendSnapshot(now);
  }

  var lastSnapshotMs = 0;
  function maybeSendSnapshot(nowMs) {
    if (!socket) return;
    if ((nowMs - lastSnapshotMs) < SNAPSHOT_RATE) return;
    lastSnapshotMs = nowMs;
    socket.emit('snapshot', {
      roomId: currentRoomId,
      host: packPlayer(state.players.host),
      client: packPlayer(state.players.client),
      t: nowMs
    });
  }

  function packPlayer(p) {
    return {
      pos: [p.position.x, p.position.y, p.position.z],
      feetY: p.feetY,
      grounded: p.grounded,
      health: p.health,
      ammo: p.weapon.ammo,
      magSize: p.weapon.magSize,
      reloading: p.weapon.reloading,
      reloadEnd: p.weapon.reloadEnd,
    };
  }

  // Client-side prediction state
  var _predictedPos = null;
  var _predictedFeetY = GROUND_Y;
  var _predictedVVel = 0;
  var _predictedGrounded = true;
  var _lastSnapshotTime = 0;
  var LERP_RATE = 0.15; // how aggressively to snap toward server position per snapshot

  // Remote player interpolation state (smooth opponent movement on client)
  var _remoteFrom = null;  // {pos: THREE.Vector3, feetY: number, receiveTime: number}
  var _remoteTo = null;    // same shape

  function applySnapshotOnClient(snap) {
    if (!snap || !state) return;
    // Skip stale snapshots
    if (snap.t && _lastSnapshotTime && snap.t < _lastSnapshotTime) return;
    _lastSnapshotTime = snap.t || 0;

    // Buffer remote player snapshots for smooth interpolation
    var H = snap.host;
    if (H && state.players.host) {
      var newRemoteSnap = {
        pos: new THREE.Vector3(H.pos[0], H.pos[1], H.pos[2]),
        feetY: (typeof H.feetY === 'number') ? H.feetY : GROUND_Y,
        receiveTime: performance.now()
      };
      _remoteFrom = _remoteTo;
      _remoteTo = newRemoteSnap;

      // Apply health immediately (no interpolation needed)
      state.players.host.health = H.health;
      state.players.host.lastDamagedAt = (H.health < state.players.host.maxHealth) ? performance.now() : state.players.host.lastDamagedAt;

      // If first snapshot, snap directly
      if (!_remoteFrom) {
        state.players.host.position.copy(newRemoteSnap.pos);
        state.players.host.feetY = newRemoteSnap.feetY;
        state.players.host._syncMeshPosition();
        if (state.players.client) {
          state.players.host.faceToward(camera.position);
        }
      }
    }

    var C = snap.client;
    if (C) {
      // Reconcile: lerp predicted position toward authoritative server position
      var serverPos = new THREE.Vector3(C.pos[0], C.pos[1], C.pos[2]);
      var serverFeetY = (typeof C.feetY === 'number') ? C.feetY : GROUND_Y;
      var serverGrounded = (typeof C.grounded === 'boolean') ? C.grounded : true;

      if (_predictedPos) {
        var diff = serverPos.clone().sub(_predictedPos);
        if (diff.lengthSq() > SNAP_THRESHOLD_SQ) {
          // Too far off — snap directly
          _predictedPos.copy(serverPos);
          _predictedFeetY = serverFeetY;
          _predictedGrounded = serverGrounded;
          _predictedVVel = 0;
        } else {
          // Smooth correction
          _predictedPos.lerp(serverPos, LERP_RATE);
          _predictedFeetY += (serverFeetY - _predictedFeetY) * LERP_RATE;
          // Reconcile eye position Y with feet
          _predictedPos.y = _predictedFeetY + EYE_HEIGHT;
          _predictedGrounded = serverGrounded;
          if (serverGrounded) _predictedVVel = 0;
        }
        camera.position.copy(_predictedPos);
      } else {
        _predictedPos = serverPos.clone();
        _predictedFeetY = serverFeetY;
        _predictedGrounded = serverGrounded;
        _predictedVVel = 0;
        camera.position.copy(serverPos);
      }

      // Sync local player state
      var localP = state.players.client;
      if (localP) {
        localP.position.copy(_predictedPos);
        localP.feetY = _predictedFeetY;
        localP.health = C.health;
        localP.weapon.ammo = C.ammo;
        localP.weapon.reloading = !!C.reloading;
        localP.weapon.reloadEnd = C.reloadEnd || 0;
        sharedSetReloadingUI(localP.weapon.reloading, state.hud.reloadIndicator);
        updateHUDForPlayer(localP);
      }
    }
  }

  function tick(ts) {
    if (!window.multiplayerActive || !state) return;

    var dt = state.lastTs ? Math.min(MAX_DT, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    if (isHost) {
      simulateHostTick(dt);
    } else {
      var input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false };
      var forward = new THREE.Vector3();
      if (camera && camera.getWorldDirection) camera.getWorldDirection(forward);

      // Client-side prediction: use same full physics as host for accurate prediction
      if (_predictedPos && state.inputEnabled) {
        var localP = state.players.client;
        if (localP) {
          // Sync prediction state into player object
          localP.position.copy(_predictedPos);
          localP.feetY = _predictedFeetY;
          localP.verticalVelocity = _predictedVVel;
          localP.grounded = _predictedGrounded;

          // Compute world-space movement direction from camera forward
          var fwd = forward.clone();
          fwd.y = 0;
          if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
          fwd.normalize();
          var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
          var moveDir = new THREE.Vector3();
          moveDir.addScaledVector(fwd, input.moveZ || 0);
          moveDir.addScaledVector(right, input.moveX || 0);
          if (moveDir.lengthSq() > 1e-6) moveDir.normalize(); else moveDir.set(0, 0, 0);

          // Run the same full physics the host uses
          updateFullPhysics(
            localP,
            { worldMoveDir: moveDir, sprint: input.sprint, jump: input.jump },
            { colliders: state.arena.colliders, solids: state.arena.solids },
            dt
          );

          // Read back prediction state
          _predictedPos.copy(localP.position);
          _predictedFeetY = localP.feetY;
          _predictedVVel = localP.verticalVelocity;
          _predictedGrounded = localP.grounded;

          camera.position.copy(_predictedPos);
        }
      }

      // Interpolate remote player (host) for smooth opponent movement
      if (_remoteFrom && _remoteTo && state.players.host) {
        var interpDuration = _remoteTo.receiveTime - _remoteFrom.receiveTime;
        if (interpDuration > 0) {
          var interpElapsed = performance.now() - _remoteFrom.receiveTime;
          var interpT = Math.min(interpElapsed / interpDuration, 1.0);
          var hostP = state.players.host;
          hostP.position.lerpVectors(_remoteFrom.pos, _remoteTo.pos, interpT);
          hostP.feetY = _remoteFrom.feetY + (_remoteTo.feetY - _remoteFrom.feetY) * interpT;
          hostP.position.y = hostP.feetY + EYE_HEIGHT;
          hostP._syncMeshPosition();
          hostP.faceToward(camera.position);
          hostP.update3DHealthBar(camera.position, state.arena ? state.arena.solids : [], { checkLOS: true });
        }
      } else if (_remoteTo && state.players.host) {
        state.players.host.update3DHealthBar(camera.position, state.arena ? state.arena.solids : [], { checkLOS: true });
      }

      if (socket) {
        socket.emit('input', {
          roomId: currentRoomId,
          moveX: input.moveX || 0,
          moveZ: input.moveZ || 0,
          sprint: !!input.sprint,
          jump: !!input.jump,
          fireDown: !!input.fireDown,
          reloadPressed: !!input.reloadPressed,
          forward: [forward.x, forward.y, forward.z],
          t: performance.now()
        });
      }

      if (state.players.client && state.players.client.weapon) {
        sharedSetCrosshairBySprint(!!input.sprint, state.players.client.weapon.spreadRad, state.players.client.weapon.sprintSpreadRad);
      }
      sharedSetSprintUI(!!input.sprint, state.hud.sprintIndicator);

      // Update visual projectiles on client
      if (typeof updateProjectiles === 'function') updateProjectiles(dt);
    }

    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public starts
  window.hostLanGame = function (roomId, settings, mapName) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.paintballActive) { try { stopPaintballInternal(); } catch (e) { console.warn('multiplayer: stopPaintballInternal failed:', e); } }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch (e) { console.warn('multiplayer: stopMultiplayerInternal failed:', e); } }

    // Include mapName in settings so client receives it
    if (mapName && mapName !== '__default__') {
      settings = Object.assign({}, settings || {}, { mapName: mapName });
    }

    function doHost(mapData) {
      ensureSocket();
      socket.emit('createRoom', roomId, settings || {}, function (res) {
        if (!res || !res.ok) { alert(res && res.error ? res.error : 'Failed to create room'); return; }
        isHost = true;
        currentRoomId = roomId;
        startMultiplayerSession(settings || {}, res.playerNumber || 1, mapData);
      });
    }

    if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function') {
      fetchMapData(mapName).then(doHost).catch(function () { doHost(null); });
    } else {
      doHost(null);
    }
  };

  window.joinLanGame = function (roomId) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.paintballActive) { try { stopPaintballInternal(); } catch (e) { console.warn('multiplayer: stopPaintballInternal failed:', e); } }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch (e) { console.warn('multiplayer: stopMultiplayerInternal failed:', e); } }

    ensureSocket();
    socket.emit('joinRoom', roomId, function (res) {
      if (!res || !res.ok) { alert(res && res.error ? res.error : 'Failed to join room'); return; }
      isHost = false;
      currentRoomId = roomId;
      hostId = res.hostId || null;
      var settings = res.settings || {};
      var mn = settings.mapName;

      function doJoin(mapData) {
        startMultiplayerSession(settings, res.playerNumber || 2, mapData);
      }

      if (mn && mn !== '__default__' && typeof fetchMapData === 'function') {
        fetchMapData(mn).then(doJoin).catch(function () { doJoin(null); });
      } else {
        doJoin(null);
      }
    });
  };

  function ensureSocket() {
    if (socket) return;
    if (typeof io !== 'function') {
      alert('Socket.IO client not found. Make sure the server is running.');
      return;
    }
    socket = io();

    socket.on('roomClosed', function () {
      alert('Host left. Room closed.');
      stopMultiplayerInternal();
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });

    socket.on('clientLeft', function () {
      if (isHost) {
        showRoundBanner('Player 2 left', ROUND_BANNER_MS);
        if (state) state.inputEnabled = false;
      }
    });

    socket.on('clientJoined', function () {
      if (!isHost || !state) return;
      showRoundBanner('Player 2 joined', ROUND_BANNER_MS);
      resetEntitiesForRound();
      updateHUDForPlayer(state.players.host);
      // Start hero selection phase instead of immediate countdown
      setTimeout(function () {
        if (!state) return;
        startHeroSelectPhase();
      }, ROUND_BANNER_MS);
    });

    // Hero selection events
    socket.on('startHeroSelect', function (payload) {
      if (isHost) return; // Only client handles this
      clientStartHeroSelect(payload);
    });

    socket.on('heroSelect', function (payload) {
      if (!isHost || !state) return; // Only host handles incoming heroSelect from client
      if (payload && payload.heroId) {
        state.heroSelections.client = payload.heroId;
        checkBothHeroesPicked();
      }
    });

    socket.on('heroesConfirmed', function (payload) {
      if (isHost) return; // Only client handles this
      clientHeroesConfirmed(payload);
    });

    socket.on('input', function (payload) {
      if (!isHost) return;
      if (!state || !state.players || !state.players.client) return;
      state.remoteInputLatest = payload || {};
    });

    socket.on('snapshot', function (payload) {
      if (isHost) return;
      applySnapshotOnClient(payload);
    });

    socket.on('settings', function (s) {
      if (!isHost && state) {
        state.settings = Object.assign({}, state.settings, s || {});
      }
    });

    socket.on('startRound', function (payload) {
      // Close hero select overlay if still open (defensive — heroesConfirmed should close it first)
      if (window._heroSelectOpen && typeof window.closePreRoundHeroSelect === 'function') {
        window.closePreRoundHeroSelect();
      }
      startRoundCountdown((payload && payload.seconds) || COUNTDOWN_SECONDS);
    });

    socket.on('roundResult', function (payload) {
      var winner = payload && payload.winner;
      if (!winner) return;
      showRoundBanner(winner === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!', ROUND_BANNER_MS);
    });

    socket.on('matchOver', function (payload) {
      var p1 = (payload && payload.p1) || 0;
      var p2 = (payload && payload.p2) || 0;
      var finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) finalScoreEl.textContent = 'Player 1 ' + p1 + ' - ' + p2 + ' Player 2';
      window.stopMultiplayerInternal();
      showOnlyMenu('resultMenu');
      setHUDVisible(false);
    });

    socket.on('shot', function (payload) {
      if (isHost) return;
      if (!payload || !Array.isArray(payload.o)) return;
      var o = new THREE.Vector3(payload.o[0], payload.o[1], payload.o[2]);
      var color = (typeof payload.c === 'number') ? payload.c : 0x66ffcc;

      // Projectile format: has 'd' (direction) and 's' (speed)
      if (payload.d && Array.isArray(payload.d) && payload.s) {
        var d = new THREE.Vector3(payload.d[0], payload.d[1], payload.d[2]);
        var vel = d.clone().multiplyScalar(payload.s);
        if (typeof spawnVisualProjectile === 'function') {
          try {
            spawnVisualProjectile({
              position: o,
              velocity: vel,
              gravity: payload.g || 0,
              tracerColor: color,
              maxRange: 200,
              solids: (state && state.arena) ? state.arena.solids : []
            });
          } catch (err) { console.warn('multiplayer: visual projectile failed:', err); }
        }
      }
      // Legacy hitscan format: has 'e' (endpoint)
      else if (Array.isArray(payload.e)) {
        var e = new THREE.Vector3(payload.e[0], payload.e[1], payload.e[2]);
        if (typeof spawnTracer === 'function') {
          try { spawnTracer(o, e, color, TRACER_LIFETIME); } catch (err) { console.warn('multiplayer: spawnTracer failed:', err); }
        }
      }
    });
  }

  function startMultiplayerSession(settings, playerNumber, mapData) {
    state = newState(settings);
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());
    state.spawns = state.arena.spawns;

    var posA = state.spawns.A.clone();
    var posB = state.spawns.B.clone();

    // Create Player instances: local gets cameraAttached, remote gets visible mesh
    if (isHost) {
      state.players.host = createPlayerInstance({ position: posA, color: 0x66ffcc, cameraAttached: true });
      state.players.client = createPlayerInstance({ position: posB, color: 0x55aaff, cameraAttached: false });
    } else {
      state.players.host = createPlayerInstance({ position: posA, color: 0xffaa55, cameraAttached: false });
      state.players.client = createPlayerInstance({ position: posB, color: 0x66ffcc, cameraAttached: true });
    }

    setHUDVisible(true);
    showOnlyMenu(null);
    showMultiplayerHUD(true);
    setCrosshairDimmed(false);
    setCrosshairSpread(0);
    updateHUDForPlayer(isHost ? state.players.host : state.players.client);

    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    placePlayersAtSpawns();

    // Initialize client-side prediction position
    _lastSnapshotTime = 0;
    _remoteFrom = null;
    _remoteTo = null;
    if (!isHost) {
      _predictedPos = state.spawns.B.clone();
      _predictedPos.y = GROUND_Y + EYE_HEIGHT;
      _predictedFeetY = GROUND_Y;
      _predictedVVel = 0;
      _predictedGrounded = true;
    } else {
      _predictedPos = null;
    }

    state.playerNumber = playerNumber || (isHost ? 1 : 2);
    showRoundBanner('You are Player ' + state.playerNumber, ROUND_BANNER_MS);

    if (isHost) {
      showRoundBanner('Waiting for Player 2...', 999999);
    }

    window.multiplayerActive = true;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  }

  window.stopMultiplayerInternal = function () {
    try { if (socket && currentRoomId) socket.emit('leaveRoom'); } catch (e) { console.warn('multiplayer: leaveRoom emit failed:', e); }
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch (e) { console.warn('multiplayer: cancelAnimationFrame failed:', e); }
      state.loopHandle = 0;
    }
    // Close hero select overlay if open
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
      // Destroy Player instances
      if (state.players.host) { try { state.players.host.destroy(); } catch (e) { console.warn('multiplayer: host.destroy failed:', e); } }
      if (state.players.client) { try { state.players.client.destroy(); } catch (e) { console.warn('multiplayer: client.destroy failed:', e); } }
      if (state.arena && state.arena.group && state.arena.group.parent) state.arena.group.parent.remove(state.arena.group);
      showMultiplayerHUD(false);
      if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
      setCrosshairDimmed(false);
      setCrosshairSpread(0);
      if (typeof clearFirstPersonWeapon === 'function') clearFirstPersonWeapon();
    }
    _predictedPos = null;
    _predictedFeetY = GROUND_Y;
    _predictedVVel = 0;
    _predictedGrounded = true;
    _lastSnapshotTime = 0;
    _remoteFrom = null;
    _remoteTo = null;
    window.multiplayerActive = false;
    state = null;
  };
})();
