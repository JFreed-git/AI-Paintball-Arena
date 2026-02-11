/**
 * modeAI.js — Single-player AI game mode
 *
 * PURPOSE: Runs the single-player vs AI game loop, round flow, shooting, and
 *          hero selection phase. Manages the local player entity and delegates
 *          AI behavior to aiOpponent.js.
 * EXPORTS (window): aiModeActive, devSpectatorMode, getPaintballState,
 *                   endPaintballRound, startPaintballGame, stopPaintballInternal
 *                   (mode flag renamed from paintballActive → aiModeActive)
 * DEPENDENCIES: THREE (r128), scene/camera/renderer globals (game.js),
 *               hud.js, roundFlow.js, crosshair.js, physics.js, projectiles.js,
 *               weapon.js, heroes.js, heroSelectUI.js, aiOpponent.js,
 *               input.js, arenaCompetitive.js, player.js (Player),
 *               mapFormat.js (buildArenaFromMap, getDefaultMapData),
 *               menuNavigation.js (showOnlyMenu, setHUDVisible)
 * NOTE: Mode flag renamed from window.paintballActive → window.aiModeActive
 */

(function () {
  window.aiModeActive = false;
  window.devSpectatorMode = false;

  window.getPaintballState = function () { return state; };
  window.endPaintballRound = function (winner) { if (state && state.match.roundActive) endRound(winner); };

  // Tunables
  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;
  var PLAYER_RADIUS = 0.5;
  var PLAYER_HEALTH = 100;
  var ROUNDS_TO_WIN = 3;
  var BASE_CROSSHAIR_SPREAD_PX = 0;

  var state = null;

  function newState(difficulty) {
    return {
      difficulty: difficulty || 'Easy',
      _heroId: null,
      arena: null,
      ai: null,
      player: null, // Player instance created after state
      match: { playerWins: 0, aiWins: 0, toWin: ROUNDS_TO_WIN, roundActive: true },
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
        meleeCooldown: document.getElementById('meleeCooldown'),
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
    sharedUpdateHealthBar(state.hud.healthFill, p.health, PLAYER_HEALTH);
    sharedUpdateAmmoDisplay(state.hud.ammoDisplay, p.weapon.ammo, p.weapon.magSize);
    if (state.ai) {
      sharedUpdateHealthBar(state.hud.enemyHealthFill, state.ai.health, state.ai.maxHealth || 100);
    }
    sharedUpdateMeleeCooldown(state.hud.meleeCooldown, p.weapon, performance.now());
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
        window._roundTransition = false;
        state.inputEnabled = true;
        state.match.roundActive = true;
      }
    });
  }

  function resetEntitiesForRound() {
    var spawns = state.spawns;

    // Reset local player
    state.player.resetForRound(spawns.A);
    state.player.syncCameraFromPlayer();
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    camera.lookAt(spawns.B);
    if (typeof resolveCollisions2D === 'function') {
      try { resolveCollisions2D(camera.position, PLAYER_RADIUS, state.arena.colliders); } catch (e) { console.warn('resolveCollisions2D failed:', e); }
    }

    if (state.ai) state.ai.destroy();
    state.ai = new AIOpponent({
      difficulty: state.difficulty,
      arena: state.arena,
      spawn: spawns.B
    });
  }

  function startHeroSelectPhase() {
    if (!state) return;
    window.showPreRoundHeroSelect({
      seconds: 15,
      onConfirmed: function (heroId) {
        applyHeroWeapon(heroId);
        window.closePreRoundHeroSelect();
        startRoundCountdown(3);
      },
      onTimeout: function (heroId) {
        applyHeroWeapon(heroId);
        window.closePreRoundHeroSelect();
        startRoundCountdown(3);
      }
    });
  }

  function applyHeroWeapon(heroId) {
    if (!state || !state.player) return;
    if (typeof window.applyHeroToPlayer === 'function') {
      window.applyHeroToPlayer(state.player, heroId);
    } else {
      var hero = window.getHeroById(heroId) || HEROES[0];
      state.player.weapon = new Weapon(hero.weapon);
    }
    updateHUD();
  }

  function endRound(winner) {
    state.match.roundActive = false;
    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
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
      try { document.exitPointerLock(); } catch (e) { console.warn('exitPointerLock failed:', e); }
      return;
    }

    window._roundTransition = true;
    showRoundBanner(winner === 'player' ? 'Player wins the round!' : 'AI wins the round!', 1200);
    setTimeout(function () {
      if (!state) { window._roundTransition = false; return; }
      resetEntitiesForRound();
      updateHUD();
      if (state._heroId) {
        applyHeroWeapon(state._heroId);
        startRoundCountdown(3);
      } else {
        startHeroSelectPhase();
      }
    }, 1200);
  }

  // Combat
  function playerCanShoot(now) {
    var w = state.player.weapon;
    return sharedCanShoot(w, now, w.cooldownMs);
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

      // Build segmented hitbox target for AI
      var aiTargets = [];
      var aiEntities = [];
      if (state.ai && state.ai.player && state.ai.player.alive) {
        aiTargets.push({ segments: state.ai.player.getHitSegments(), entity: state.ai });
        aiEntities.push(state.ai.player);
      }

      var result = sharedFireWeapon(w, camera.position.clone(), dir, {
        sprinting: !!input.sprint,
        solids: state.arena.solids,
        targets: aiTargets,
        projectileTargetEntities: aiEntities,
        tracerColor: 0x66ffcc,
        onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
          var dmg = w.damage * (damageMultiplier || 1.0);
          state.ai.takeDamage(dmg);
          if (typeof playGameSound === 'function') playGameSound('hit_marker');
          updateHUD();
          if (!state.ai.alive && state.match.roundActive) {
            if (typeof playGameSound === 'function') playGameSound('elimination');
            endRound('player');
            return false;
          }
        }
      });
      updateHUD();

      if (result.magazineEmpty) {
        if (sharedStartReload(w, now)) {
          sharedSetReloadingUI(true, state.hud.reloadIndicator);
        }
      }
    }
  }

  // Melee state
  var _meleeSwinging = false;
  var _meleeSwingEnd = 0;

  function handleMelee(input, now) {
    if (!state || !state.player || !state.player.alive) return;
    var w = state.player.weapon;

    // Check swing in progress
    if (_meleeSwinging) {
      if (now >= _meleeSwingEnd) _meleeSwinging = false;
      return;
    }

    if (!input.meleePressed) return;
    if (w.reloading) return;
    if ((now - w.lastMeleeTime) < w.meleeCooldownMs) return;

    // Perform melee
    var dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    var aiTargets = [];
    if (state.ai && state.ai.player && state.ai.player.alive) {
      aiTargets.push({ segments: state.ai.player.getHitSegments(), entity: state.ai });
    }

    sharedMeleeAttack(w, camera.position.clone(), dir, {
      solids: state.arena.solids,
      targets: aiTargets,
      onHit: function (target, point, dist, totalDamage) {
        state.ai.takeDamage(totalDamage);
        if (typeof playGameSound === 'function') playGameSound('hit_marker');
        updateHUD();
        if (!state.ai.alive && state.match.roundActive) {
          if (typeof playGameSound === 'function') playGameSound('elimination');
          endRound('player');
        }
      }
    });

    // Start swing animation + block firing
    _meleeSwinging = true;
    _meleeSwingEnd = now + w.meleeSwingMs;
    if (typeof playGameSound === 'function') playGameSound('melee_swing');
    if (typeof window.triggerFPMeleeSwing === 'function') window.triggerFPMeleeSwing(w.meleeSwingMs);
    if (state.player.triggerMeleeSwing) state.player.triggerMeleeSwing(w.meleeSwingMs);
  }

  function updateReload(now) {
    if (!state || !state.player || !state.player.weapon) return;
    if (sharedHandleReload(state.player.weapon, now)) {
      sharedSetReloadingUI(false, state.hud.reloadIndicator);
      updateHUD();
    }
  }

  // Main loop
  function tick(ts) {
    if (!window.aiModeActive || !state) return;

    var dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    var input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };

    // Ignore initial stuck fire
    if (!state.inputArmed) {
      if (input.fireDown) { input.fireDown = false; }
      else { state.inputArmed = true; }
    }

    sharedSetCrosshairBySprint(!!input.sprint, state.player.weapon.spreadRad, state.player.weapon.sprintSpreadRad);
    sharedSetSprintUI(!!input.sprint, state.hud.sprintIndicator);

    if (state.inputEnabled && !window.devSpectatorMode) {
      var prevGrounded = state.player.grounded;
      updateFullPhysics(
        state.player,
        { moveX: input.moveX || 0, moveZ: input.moveZ || 0, sprint: !!input.sprint, jump: !!input.jump },
        { colliders: state.arena.colliders, solids: state.arena.solids },
        dt
      );
      // Sync mesh and camera from physics
      state.player._hitboxYaw = camera.rotation.y;
      state.player._syncMeshPosition();
      state.player.syncCameraFromPlayer();

      // Movement sounds
      if (typeof playGameSound === 'function') {
        if (prevGrounded && !state.player.grounded) playGameSound('jump');
        if (!prevGrounded && state.player.grounded) playGameSound('land');
        var moving = (input.moveX !== 0 || input.moveZ !== 0);
        if (moving && state.player.grounded && typeof playFootstepIfDue === 'function') {
          playFootstepIfDue(!!input.sprint, state._heroId, performance.now());
        }
      }
    }

    // Update AI BEFORE shooting/projectiles so AI hitboxes are fresh for hit detection
    if (state.ai && state.match.roundActive) {
      // In spectator mode, AI targets the stationary player position, not the free camera
      var aiTargetPos = window.devSpectatorMode
        ? state.player.getEyePos()
        : camera.position.clone();
      state.ai.update(dt, {
        playerPos: aiTargetPos,
        playerSegments: state.player.getHitSegments(),
        playerEntity: state.player,
        onPlayerHit: function (dmg) {
          if (!state.player.alive) return;
          if (window.devGodMode) return;
          state.player.takeDamage(dmg);
          if (typeof playGameSound === 'function') playGameSound('damage_taken');
          updateHUD();
          if (state.player.health <= 0) {
            if (state.match.roundActive) endRound('ai');
          }
        }
      });
    }

    var now = performance.now();
    if (state.inputEnabled) {
      // Melee-only weapons: left-click triggers melee swing, not fire
      if (state.player.weapon && state.player.weapon.meleeOnly && input.fireDown) {
        input.meleePressed = true;
        input.fireDown = false;
      }
      handleMelee(input, now);
      if (!_meleeSwinging) handlePlayerShooting(input, now);
    }
    updateReload(now);

    // Update live projectiles (all entity hitboxes are now fresh)
    if (typeof updateProjectiles === 'function') updateProjectiles(dt);

    // Update hitbox visualization after all positions are current
    if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();

    updateHUD();
    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public start/stop
  window.startPaintballGame = function (opts) {
    if (window.aiModeActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch (e) { console.warn('stopPaintballInternal failed:', e); }
    }
    window.devSpectatorMode = false;
    var difficulty = (opts && opts.difficulty) || 'Easy';
    state = newState(difficulty);

    var mapData = (opts && opts._mapData) ? opts._mapData : null;
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());
    state.spawns = state.arena.spawns;

    // Create local Player instance (camera-attached, mesh hidden)
    var defaultHero = window.getHeroById('marksman') || HEROES[0];
    state.player = new Player({
      cameraAttached: true,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      radius: PLAYER_RADIUS,
      maxHealth: PLAYER_HEALTH,
      color: 0x66ffcc,
      weapon: new Weapon(defaultHero.weapon)
    });

    resetEntitiesForRound();

    setHUDVisible(true);
    showOnlyMenu(null);
    showPaintballHUD(true);
    sharedSetCrosshairBySprint(false);
    sharedSetReloadingUI(false, state.hud.reloadIndicator);
    updateHUD();

    // If a hero was pre-selected (e.g. dev workbench quick test), skip hero selection
    if (opts && opts._heroId) {
      state._heroId = opts._heroId;
      applyHeroWeapon(opts._heroId);
      startRoundCountdown(3);
      // Request pointer lock since hero selection (which normally locks) is skipped
      if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }
    } else {
      startHeroSelectPhase();
    }
    window.aiModeActive = true;
    state.inputArmed = false;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  };

  window.stopPaintballInternal = function (showMenu) {
    if (showMenu === undefined) showMenu = true;
    window._roundTransition = false;
    // Close hero select overlay if open
    try { if (typeof window.closePreRoundHeroSelect === 'function') window.closePreRoundHeroSelect(); } catch (e) {}
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch (e) { console.warn('cancelAnimationFrame failed:', e); }
      state.loopHandle = 0;
    }
    if (state && state.ai) {
      try { state.ai.destroy(); } catch (e) { console.warn('ai.destroy failed:', e); }
      state.ai = null;
    }
    if (state && state.player) {
      try { state.player.destroy(); } catch (e) { console.warn('player.destroy failed:', e); }
      state.player = null;
    }
    if (state && state.arena && state.arena.group && state.arena.group.parent) {
      state.arena.group.parent.remove(state.arena.group);
    }
    if (state) showPaintballHUD(false);

    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
    setCrosshairDimmed(false);
    setCrosshairSpread(BASE_CROSSHAIR_SPREAD_PX);
    if (typeof clearFirstPersonWeapon === 'function') clearFirstPersonWeapon();

    _meleeSwinging = false;
    _meleeSwingEnd = 0;
    window.aiModeActive = false;
    if (showMenu) {
      try { document.exitPointerLock(); } catch (e) { console.warn('exitPointerLock failed:', e); }
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }
    state = null;
  };
})();
