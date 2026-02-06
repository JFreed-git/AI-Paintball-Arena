// Paintball (AI) mode
// Uses shared functions from gameShared.js for HUD, round flow, crosshair, and reload.

(function () {
  window.paintballActive = false;
  window.devSpectatorMode = false;

  window.getPaintballState = function () { return state; };

  // Tunables
  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;
  var PLAYER_RADIUS = 0.5;
  var FIRE_COOLDOWN_MS = 166;
  var MAG_SIZE = 6;
  var RELOAD_TIME_SEC = 2.5;
  var SPRINT_SPREAD_BONUS_RAD = 0.012;
  var BASE_CROSSHAIR_SPREAD_PX = 0;
  var PLAYER_DAMAGE = 20;

  var state = null;

  function newState(difficulty) {
    var roundsInput = document.getElementById('roundsToWinPaintball');
    var toWin = roundsInput ? Math.max(1, Math.min(10, parseInt(roundsInput.value, 10) || 2)) : 2;

    return {
      difficulty: difficulty || 'Easy',
      arena: null,
      ai: null,
      player: {
        position: camera ? camera.position : new THREE.Vector3(0, 2, 5),
        walkSpeed: WALK_SPEED,
        sprintSpeed: SPRINT_SPEED,
        radius: PLAYER_RADIUS,
        health: 100,
        alive: true,
        weapon: {
          magSize: MAG_SIZE,
          ammo: MAG_SIZE,
          reloading: false,
          reloadEnd: 0,
          lastShotTime: 0,
          reloadTimeSec: RELOAD_TIME_SEC
        }
      },
      match: { playerWins: 0, aiWins: 0, toWin: toWin, roundActive: true },
      spawns: { A: new THREE.Vector3(), B: new THREE.Vector3() },
      hud: {
        healthContainer: document.getElementById('healthContainer'),
        healthFill: document.getElementById('healthFill'),
        ammoDisplay: document.getElementById('ammoDisplay'),
        reloadIndicator: document.getElementById('reloadIndicator'),
        sprintIndicator: document.getElementById('sprintIndicator'),
        bannerEl: document.getElementById('roundBanner'),
        countdownEl: document.getElementById('roundCountdown'),
        enemyHealthContainer: document.getElementById('enemyHealthContainer'),
        enemyHealthFill: document.getElementById('enemyHealthFill'),
      },
      inputArmed: false,
      inputEnabled: false,
      countdownTimerRef: { id: 0 },
      bannerTimerRef: { id: 0 },
      lastTs: 0,
      loopHandle: 0
    };
  }

  // HUD helpers — delegate to shared functions
  function showPaintballHUD(show) {
    if (!state) return;
    if (state.hud.healthContainer) state.hud.healthContainer.classList.toggle('hidden', !show);
    if (state.hud.enemyHealthContainer) state.hud.enemyHealthContainer.classList.toggle('hidden', !show);
  }

  function updateHUD() {
    if (!state) return;
    var p = state.player;
    sharedUpdateHealthBar(state.hud.healthFill, p.health, 100);
    sharedUpdateAmmoDisplay(state.hud.ammoDisplay, p.weapon.ammo, p.weapon.magSize);
    if (state.ai) {
      sharedUpdateHealthBar(state.hud.enemyHealthFill, state.ai.health, state.ai.maxHealth || 100);
    }
  }

  // Round/match flow — using shared countdown and banner
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
        state.inputEnabled = false;
        state.match.roundActive = false;
        state.inputArmed = false;
        if (state.player && state.player.weapon) {
          state.player.weapon.lastShotTime = performance.now() + 300;
        }
      },
      onReady: function () {
        state.inputEnabled = true;
        state.match.roundActive = true;
      }
    });
  }

  function resetEntitiesForRound() {
    var spawns = state.spawns;
    camera.position.copy(spawns.A);
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    camera.lookAt(spawns.B);
    if (typeof resolveCollisions2D === 'function') {
      try { resolveCollisions2D(camera.position, PLAYER_RADIUS, state.arena.colliders); } catch {}
    }

    var p = state.player;
    p.health = 100;
    p.alive = true;
    p.weapon.ammo = p.weapon.magSize;
    p.weapon.reloading = false;
    p.weapon.lastShotTime = 0;

    if (state.ai) state.ai.destroy();
    state.ai = new AIOpponent({
      difficulty: state.difficulty,
      arena: state.arena,
      spawn: spawns.B
    });
  }

  function endRound(winner) {
    state.match.roundActive = false;
    if (winner === 'player') state.match.playerWins++;
    else if (winner === 'ai') state.match.aiWins++;

    if (state.match.playerWins >= state.match.toWin || state.match.aiWins >= state.match.toWin) {
      var finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) {
        finalScoreEl.textContent = 'Player ' + state.match.playerWins + ' - ' + state.match.aiWins + ' AI';
      }
      stopPaintballInternal(false);
      setHUDVisible(false);
      showOnlyMenu('resultMenu');
      try { document.exitPointerLock(); } catch {}
      return;
    }

    showRoundBanner(winner === 'player' ? 'Player wins the round!' : 'AI wins the round!', 1200);
    setTimeout(function () {
      resetEntitiesForRound();
      updateHUD();
      startRoundCountdown(3);
    }, 1200);
  }

  // Combat
  function playerCanShoot(now) {
    var w = state.player.weapon;
    if (w.reloading) return false;
    if (w.ammo <= 0) return false;
    return (now - w.lastShotTime) >= FIRE_COOLDOWN_MS;
  }

  function handlePlayerShooting(input, now) {
    var w = state.player.weapon;

    if (input.reloadPressed) {
      if (sharedStartReload(w, now)) {
        sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      return;
    }
    if (w.reloading) return;

    if (input.fireDown && playerCanShoot(now)) {
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      var spread = input.sprint ? SPRINT_SPREAD_BONUS_RAD : 0;

      var hit = fireHitscan(camera.position.clone(), dir, {
        spreadRad: spread,
        solids: state.arena.solids,
        aiTarget: state.ai,
        tracerColor: 0x66ffcc,
        maxDistance: 200
      });

      if (hit.hit && state.ai && hit.hitType === 'ai') {
        state.ai.takeDamage(PLAYER_DAMAGE);
        updateHUD();
        if (!state.ai.alive && state.match.roundActive) {
          endRound('player');
        }
      }

      w.ammo--;
      w.lastShotTime = now;
      updateHUD();

      if (w.ammo <= 0) {
        if (sharedStartReload(w, now)) {
          sharedSetReloadingUI(true, state.hud.reloadIndicator);
        }
      }
    }
  }

  function updateReload(now) {
    if (sharedHandleReload(state.player.weapon, now)) {
      sharedSetReloadingUI(false, state.hud.reloadIndicator);
      updateHUD();
    }
  }

  // Main loop
  function tick(ts) {
    if (!window.paintballActive || !state) return;

    var dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    var input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };

    // Ignore initial stuck fire
    if (!state.inputArmed) {
      if (input.fireDown) { input.fireDown = false; }
      else { state.inputArmed = true; }
    }

    sharedSetCrosshairBySprint(!!input.sprint);
    sharedSetSprintUI(!!input.sprint, state.hud.sprintIndicator);

    if (state.inputEnabled && !window.devSpectatorMode) {
      updateXZPhysics(
        state.player,
        { moveX: input.moveX || 0, moveZ: input.moveZ || 0, sprint: !!input.sprint },
        { colliders: state.arena.colliders },
        dt
      );
    }

    var now = performance.now();
    if (state.inputEnabled) {
      handlePlayerShooting(input, now);
    }
    updateReload(now);

    if (state.ai && state.match.roundActive) {
      state.ai.update(dt, {
        playerPos: camera.position.clone(),
        playerRadius: PLAYER_RADIUS,
        onPlayerHit: function (dmg) {
          if (!state.player.alive) return;
          state.player.health = Math.max(0, state.player.health - dmg);
          updateHUD();
          if (state.player.health <= 0) {
            state.player.alive = false;
            if (state.match.roundActive) endRound('ai');
          }
        }
      });
    }

    updateHUD();
    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public start/stop
  window.startPaintballGame = function (opts) {
    if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    }
    try { if (typeof stopGameInternal === 'function') stopGameInternal(); } catch {}
    var difficulty = (opts && opts.difficulty) || 'Easy';
    state = newState(difficulty);

    var mapData = (opts && opts._mapData) ? opts._mapData : null;
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());
    state.spawns = state.arena.spawns;
    resetEntitiesForRound();

    setHUDVisible(true);
    showOnlyMenu(null);
    showPaintballHUD(true);
    sharedSetCrosshairBySprint(false);
    sharedSetReloadingUI(false, state.hud.reloadIndicator);
    updateHUD();

    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    startRoundCountdown(3);
    window.paintballActive = true;
    state.inputArmed = false;
    state.player.weapon.lastShotTime = performance.now() + 300;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  };

  window.stopPaintballInternal = function (showMenu) {
    if (showMenu === undefined) showMenu = true;
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch {}
      state.loopHandle = 0;
    }
    if (state && state.ai) {
      try { state.ai.destroy(); } catch {}
      state.ai = null;
    }
    if (state && state.arena && state.arena.group && state.arena.group.parent) {
      state.arena.group.parent.remove(state.arena.group);
    }
    if (state) showPaintballHUD(false);

    setCrosshairDimmed(false);
    setCrosshairSpread(BASE_CROSSHAIR_SPREAD_PX);

    window.paintballActive = false;
    if (showMenu) {
      try { document.exitPointerLock(); } catch {}
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }
    state = null;
  };
})();
