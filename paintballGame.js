// Paintball (AI) mode
// - Uses playerControls.js for inputs (getInputState, mouse look, sprint/reload keys).
// - Uses physics.js for movement & collisions.
// - Uses environment.js to build a symmetric arena.
// - Uses projectiles.js for fast hitscan paintball shots.
// - Uses aiOpponent.js for a simple AI enemy.
// - Leaves aim trainer logic untouched.

(function () {
  // Public flags
  window.paintballActive = false;

  // Tunables
  const WALK_SPEED = 4.5;
  const SPRINT_SPEED = 6.5;
  const PLAYER_RADIUS = 0.35;

  const FIRE_COOLDOWN_MS = 180; // ~333 RPM
  const MAG_SIZE = 12;
  const RELOAD_TIME_SEC = 2.0;

  const BASE_SPREAD_RAD = 0.0052;      // ~0.3 deg
  const SPRINT_SPREAD_BONUS_RAD = 0.012; // ~0.7 deg
  const BASE_CROSSHAIR_SPREAD_PX = 10;
  const SPRINT_CROSSHAIR_BONUS_PX = 10;

  const PLAYER_DAMAGE = 18; // per hit to AI

  // State
  let state = null;

  function newState(difficulty) {
    return {
      difficulty: difficulty || 'Easy',
      arena: null,
      ai: null,
      // Player
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
      // Match
      match: {
        playerWins: 0,
        aiWins: 0,
        toWin: 2,
        roundActive: true,
      },
      // Spawns
      spawns: { A: new THREE.Vector3(), B: new THREE.Vector3() },
      // HUD elements
      hud: {
        healthContainer: document.getElementById('healthContainer'),
        healthFill: document.getElementById('healthFill'),
        ammoDisplay: document.getElementById('ammoDisplay'),
        reloadIndicator: document.getElementById('reloadIndicator'),
        sprintIndicator: document.getElementById('sprintIndicator'),
        scoreEl: document.getElementById('score'),
        timerEl: document.getElementById('timer'),
        instructionsEl: document.getElementById('instructions'),
      },
      lastTs: 0,
      loopHandle: 0
    };
  }

  // UI helpers
  function showPaintballHUD(show) {
    if (!state) return;
    if (state.hud.healthContainer) state.hud.healthContainer.classList.toggle('hidden', !show);
    if (state.hud.scoreEl) state.hud.scoreEl.classList.add('hidden'); // hide aim trainer score
    if (state.hud.timerEl) state.hud.timerEl.classList.add('hidden'); // hide aim trainer timer
    if (state.hud.instructionsEl) state.hud.instructionsEl.classList.add('hidden');
  }

  function updateHUD() {
    if (!state) return;
    const p = state.player;
    if (state.hud.healthFill) {
      const clamped = Math.max(0, Math.min(100, p.health));
      state.hud.healthFill.style.width = `${clamped}%`;
      // Optionally change color at low health (not required)
    }
    if (state.hud.ammoDisplay) {
      state.hud.ammoDisplay.textContent = `${p.weapon.ammo}/${p.weapon.magSize}`;
    }
  }

  function setReloadingUI(isReloading) {
    if (!state) return;
    if (state.hud.reloadIndicator) {
      state.hud.reloadIndicator.classList.toggle('hidden', !isReloading);
    }
    setCrosshairDimmed(isReloading);
  }

  function setSprintUI(sprinting) {
    if (!state) return;
    if (state.hud.sprintIndicator) {
      state.hud.sprintIndicator.classList.toggle('hidden', !sprinting);
    }
  }

  function setCrosshairBySprint(sprinting) {
    const px = BASE_CROSSHAIR_SPREAD_PX + (sprinting ? SPRINT_CROSSHAIR_BONUS_PX : 0);
    setCrosshairSpread(px);
  }

  // Round/match flow
  function resetEntitiesForRound() {
    const spawns = state.spawns;
    // Place player & camera at spawn A
    camera.position.copy(spawns.A);
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    // Face toward B
    camera.lookAt(spawns.B);

    // Reset player stats
    const p = state.player;
    p.health = 100;
    p.alive = true;
    p.weapon.ammo = p.weapon.magSize;
    p.weapon.reloading = false;
    p.weapon.lastShotTime = 0;

    // Reset AI
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

    // Check match end
    if (state.match.playerWins >= state.match.toWin || state.match.aiWins >= state.match.toWin) {
      // End of match
      const finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) {
        finalScoreEl.textContent = `Player ${state.match.playerWins} - ${state.match.aiWins} AI`;
      }
      // Clean up and show results
      stopPaintballInternal(false); // don't show main menu yet
      setHUDVisible(false);
      showOnlyMenu('resultMenu');
      try { document.exitPointerLock(); } catch {}
      return;
    }

    // Next round after short delay
    setTimeout(() => {
      state.match.roundActive = true;
      resetEntitiesForRound();
      updateHUD();
    }, 1200);
  }

  // Combat
  function playerCanShoot(now) {
    const w = state.player.weapon;
    if (w.reloading) return false;
    if (w.ammo <= 0) return false;
    return (now - w.lastShotTime) >= FIRE_COOLDOWN_MS;
  }

  function startPlayerReload(now) {
    const w = state.player.weapon;
    if (w.reloading || w.ammo >= w.magSize) return;
    w.reloading = true;
    w.reloadEnd = now + RELOAD_TIME_SEC * 1000;
    setReloadingUI(true);
  }

  function handlePlayerShooting(input, now) {
    const w = state.player.weapon;

    if (input.reloadPressed) {
      startPlayerReload(now);
      return;
    }

    if (w.reloading) return;

    if (input.fireDown && playerCanShoot(now)) {
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const spread = BASE_SPREAD_RAD + (input.sprint ? SPRINT_SPREAD_BONUS_RAD : 0);

      const hit = fireHitscan(camera.position.clone(), dir, {
        spreadRad: spread,
        solids: state.arena.solids,
        aiTarget: state.ai,
        tracerColor: 0x66ffcc,
        maxDistance: 200
      });

      if (hit.hit && state.ai && hit.hitType === 'ai') {
        state.ai.takeDamage(PLAYER_DAMAGE);
        if (!state.ai.alive && state.match.roundActive) {
          endRound('player');
        }
      }

      w.ammo--;
      w.lastShotTime = now;
      updateHUD();

      if (w.ammo <= 0) {
        startPlayerReload(now);
      }
    }
  }

  function updateReload(now) {
    const w = state.player.weapon;
    if (w.reloading && now >= w.reloadEnd) {
      w.reloading = false;
      w.ammo = w.magSize;
      setReloadingUI(false);
      updateHUD();
    }
  }

  // Main loop
  function tick(ts) {
    if (!window.paintballActive || !state) return;

    const dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    // Read inputs
    const input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };

    // Crosshair & sprint UI
    setCrosshairBySprint(!!input.sprint);
    setSprintUI(!!input.sprint);

    // Movement (XZ only)
    updateXZPhysics(
      state.player,
      { moveX: input.moveX || 0, moveZ: input.moveZ || 0, sprint: !!input.sprint },
      { colliders: state.arena.colliders },
      dt
    );

    // Shooting + reload
    const now = performance.now();
    handlePlayerShooting(input, now);
    updateReload(now);

    // AI update
    if (state.ai && state.match.roundActive) {
      state.ai.update(dt, {
        playerPos: camera.position.clone(),
        playerRadius: PLAYER_RADIUS,
        onPlayerHit: (dmg) => {
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

    // Continue loop
    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public start/stop
  window.startPaintballGame = function startPaintballGame(opts) {
    if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    }
    const difficulty = (opts && opts.difficulty) || 'Easy';
    state = newState(difficulty);

    // Build arena
    state.arena = buildPaintballArenaSymmetric();
    state.spawns = state.arena.spawns;

    // Reset for round 1
    resetEntitiesForRound();

    // Show HUD and lock pointer
    setHUDVisible(true);
    showOnlyMenu(null);
    showPaintballHUD(true);
    setCrosshairBySprint(false);
    setReloadingUI(false);
    updateHUD();

    // Request pointer lock
    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    // Activate and run loop
    window.paintballActive = true;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  };

  window.stopPaintballInternal = function stopPaintballInternal(showMenu = true) {
    // Stop loop
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch {}
      state.loopHandle = 0;
    }

    // Remove AI
    if (state && state.ai) {
      try { state.ai.destroy(); } catch {}
      state.ai = null;
    }

    // Remove arena
    if (state && state.arena && state.arena.group && state.arena.group.parent) {
      state.arena.group.parent.remove(state.arena.group);
    }

    // Hide HUD
    if (state) {
      showPaintballHUD(false);
    }

    // Reset crosshair visuals
    setCrosshairDimmed(false);
    setCrosshairSpread(BASE_CROSSHAIR_SPREAD_PX);

    window.paintballActive = false;

    if (showMenu) {
      // Return to main menu handled by caller (menuNavigation or pointer lock change)
      try { document.exitPointerLock(); } catch {}
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }

    state = null;
  };
})();
