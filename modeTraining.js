/**
 * modeTraining.js — Training range mode
 *
 * PURPOSE: Free-practice mode with static targets and patrol bots. No rounds or
 *          match flow — player trains indefinitely until ESC. Supports hero/weapon
 *          switching via the 'H' key overlay (heroSelectUI.js).
 * EXPORTS (window): trainingRangeActive, switchTrainingHero, startTrainingRange,
 *                   stopTrainingRangeInternal
 * DEPENDENCIES: THREE (r128), scene/camera/renderer globals (game.js),
 *               hud.js, crosshair.js, physics.js, projectiles.js, weapon.js,
 *               heroes.js, heroSelectUI.js, input.js, player.js (Player),
 *               arenaTraining.js, trainingBot.js,
 *               menuNavigation.js (showOnlyMenu, setHUDVisible)
 * NOTE: Mode flag is still window.trainingRangeActive (for backward compat, rename later)
 */

(function () {
  window.trainingRangeActive = false;
  window.getTrainingRangeState = function () { return state; };

  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;
  var PLAYER_RADIUS = 0.5;
  var PLAYER_HEALTH = 100;
  var TARGET_RADIUS = 0.35;
  var TARGET_TILT_DURATION = 2000; // ms before target pops back up

  var state = null;

  // ── Static Target ──

  function createTarget(position) {
    var grp = new THREE.Group();

    // Pedestal
    var pedestalGeom = new THREE.CylinderGeometry(0.15, 0.2, 1.0, 12);
    var pedestalMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    var pedestal = new THREE.Mesh(pedestalGeom, pedestalMat);
    pedestal.position.y = 0.5;
    grp.add(pedestal);

    // Head sphere (hit target)
    var headGeom = new THREE.SphereGeometry(TARGET_RADIUS, 16, 16);
    var headMat = new THREE.MeshLambertMaterial({ color: 0xff4444 });
    var head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.0 + TARGET_RADIUS;
    grp.add(head);

    grp.position.set(position.x, position.y, position.z);
    scene.add(grp);

    var targetObj = {
      group: grp,
      headMesh: head,
      headMat: headMat,
      active: true,
      tiltTimer: 0,
      _origColor: 0xff4444,
      getHitTarget: function () {
        if (!this.active) return null;
        return {
          position: new THREE.Vector3(
            grp.position.x,
            grp.position.y + 1.0 + TARGET_RADIUS,
            grp.position.z
          ),
          radius: TARGET_RADIUS
        };
      },
      // Segmented hitbox interface for projectile system
      getHitSegments: function () {
        if (!this.active) return [];
        var cx = grp.position.x;
        var headY = grp.position.y + 1.0 + TARGET_RADIUS;
        var cz = grp.position.z;
        return [{
          shape: 'sphere',
          center: new THREE.Vector3(cx, headY, cz),
          radius: TARGET_RADIUS,
          damageMultiplier: 1.0,
          name: 'head'
        }];
      },
      takeDamage: function () {
        this.onHit();
      },
      onHit: function () {
        if (!this.active) return;
        this.active = false;
        this.tiltTimer = performance.now() + TARGET_TILT_DURATION;
        // Tilt back and gray out
        grp.rotation.x = -0.4;
        headMat.color.setHex(0x666666);
      },
      update: function () {
        if (!this.active && performance.now() >= this.tiltTimer) {
          // Pop back up
          this.active = true;
          grp.rotation.x = 0;
          headMat.color.setHex(this._origColor);
        }
      },
      destroy: function () {
        if (grp.parent) grp.parent.remove(grp);
        grp.traverse(function (child) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) child.material.dispose();
        });
      }
    };
    // 'alive' getter mirrors 'active' for projectile system compatibility
    Object.defineProperty(targetObj, 'alive', {
      get: function () { return targetObj.active; }
    });
    return targetObj;
  }

  // ── HUD ──

  function getHudElements() {
    return {
      healthContainer: document.getElementById('healthContainer'),
      healthFill: document.getElementById('healthFill'),
      ammoDisplay: document.getElementById('ammoDisplay'),
      reloadIndicator: document.getElementById('reloadIndicator'),
      sprintIndicator: document.getElementById('sprintIndicator'),
      weaponNameDisplay: document.getElementById('weaponNameDisplay'),
      meleeCooldown: document.getElementById('meleeCooldown'),
    };
  }

  function showTrainingHUD(show) {
    if (!state) return;
    var hud = state.hud;
    if (hud.healthContainer) hud.healthContainer.classList.toggle('hidden', !show);
    if (hud.weaponNameDisplay) hud.weaponNameDisplay.classList.toggle('hidden', !show);
    // Hide enemy health (not used in training)
    var enemyHC = document.getElementById('enemyHealthContainer');
    if (enemyHC) enemyHC.classList.add('hidden');
  }

  function updateWeaponNameDisplay() {
    if (!state || !state.hud.weaponNameDisplay) return;
    var hero = window.getHeroById ? window.getHeroById(state.currentHeroId) : null;
    state.hud.weaponNameDisplay.textContent = hero ? hero.name : '';
  }

  function updateHUD() {
    if (!state) return;
    var p = state.player;
    sharedUpdateHealthBar(state.hud.healthFill, p.health, PLAYER_HEALTH);
    if (!p.weapon.meleeOnly) {
      sharedUpdateAmmoDisplay(state.hud.ammoDisplay, p.weapon.ammo, p.weapon.magSize);
    }
    sharedUpdateMeleeCooldown(state.hud.meleeCooldown, p.weapon, performance.now());

  }

  // ── Hero switching ──

  window.switchTrainingHero = function (heroId) {
    if (!state) return;
    var hero = window.getHeroById ? window.getHeroById(heroId) : null;
    if (!hero) return;
    state.currentHeroId = heroId;
    state.tracerColor = hero.color;
    if (typeof window.applyHeroToPlayer === 'function') {
      window.applyHeroToPlayer(state.player, heroId);
    } else {
      state.player.weapon = new Weapon(hero.weapon);
    }
    if (typeof window.resetScopeADS === 'function') window.resetScopeADS();
    if (typeof window.sharedClearBursts === 'function') window.sharedClearBursts();
    updateWeaponNameDisplay();
    sharedSetMeleeOnlyHUD(!!state.player.weapon.meleeOnly, state.hud.ammoDisplay, state.hud.reloadIndicator, state.hud.meleeCooldown);
    updateHUD();
  };

  // ── Melee ──
  var _meleeSwinging = false;
  var _meleeSwingEnd = 0;

  function handleMelee(input, now) {
    if (!state || !state.player || !state.player.alive) return;
    var w = state.player.weapon;

    if (_meleeSwinging) {
      if (now >= _meleeSwingEnd) _meleeSwinging = false;
      return;
    }
    if (!input.meleePressed) return;
    if (w.reloading) return;
    if ((now - w.lastMeleeTime) < w.meleeCooldownMs) return;

    var dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // Build melee targets from bots
    var meleeTargets = [];
    for (var bi = 0; bi < state.bots.length; bi++) {
      var bot = state.bots[bi];
      if (bot.alive && bot.player) {
        meleeTargets.push({ segments: bot.player.getHitSegments(), entity: bot, type: 'bot' });
      }
    }
    // Also include static targets
    for (var ti = 0; ti < state.targets.length; ti++) {
      var tgt = state.targets[ti];
      var ht = tgt.getHitTarget();
      if (ht) meleeTargets.push({ position: ht.position, radius: ht.radius, entity: tgt, type: 'target' });
    }

    sharedMeleeAttack(w, camera.position.clone(), dir, {
      solids: state.arena.solids,
      targets: meleeTargets,
      onHit: function (target, point, dist, totalDamage) {
        if (target.type === 'target') {
          target.entity.onHit();
        } else if (target.type === 'bot') {
          target.entity.takeDamage(totalDamage);
        } else if (typeof target.takeDamage === 'function') {
          target.takeDamage(totalDamage);
        }
        state.stats.hits++;
      }
    });

    state.stats.shots++;
    // Check bot kills
    for (var i = 0; i < state.bots.length; i++) {
      if (!state.bots[i].alive && !state.bots[i]._countedKill) {
        state.stats.kills++;
        state.bots[i]._countedKill = true;
      }
    }

    _meleeSwinging = true;
    _meleeSwingEnd = now + w.meleeSwingMs;
    if (typeof playGameSound === 'function') playGameSound('melee_swing', { heroId: state.currentHeroId || undefined });
    if (typeof window.triggerFPMeleeSwing === 'function') window.triggerFPMeleeSwing(w.meleeSwingMs);
    if (state.player.triggerMeleeSwing) state.player.triggerMeleeSwing(w.meleeSwingMs);
    updateHUD();
  }

  // ── Shooting ──

  var _trainingScopeResult = { adsActive: false, spreadMultiplier: 1.0 };

  function handlePlayerShooting(input, now) {
    var w = state.player.weapon;
    if (w.meleeOnly) return; // No gun shooting for melee-only weapons

    if (input.reloadPressed) {
      if (sharedStartReload(w, now, state.currentHeroId)) {
        sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
      return;
    }
    if (w.reloading) return;

    if (input.fireDown && !w.reloading && w.ammo <= 0) {
      if (typeof playGameSound === 'function') playGameSound('dry_fire', { heroId: state.currentHeroId || undefined });
      if (sharedStartReload(w, now, state.currentHeroId)) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      return;
    }

    if (input.fireDown && sharedCanShoot(w, now, w.cooldownMs)) {
      // Build multi-target array from static targets and bots
      var allTargets = [];
      var allEntities = [];
      for (var ti = 0; ti < state.targets.length; ti++) {
        var tgt = state.targets[ti];
        var ht = tgt.getHitTarget();
        if (ht) allTargets.push({ position: ht.position, radius: ht.radius, entity: tgt, type: 'target' });
        if (tgt.alive) allEntities.push(tgt);
      }
      for (var bi = 0; bi < state.bots.length; bi++) {
        var bot = state.bots[bi];
        if (bot.alive && bot.player) {
          allTargets.push({ segments: bot.player.getHitSegments(), entity: bot, type: 'bot' });
          allEntities.push(bot);
        }
      }

      // Compute effective spread (scope reduces spread)
      var effectiveSpread = w.spreadRad;
      if (input.sprint) effectiveSpread = w.sprintSpreadRad;
      if (_trainingScopeResult.adsActive) effectiveSpread *= _trainingScopeResult.spreadMultiplier;

      var fireOpts = {
        spreadOverride: effectiveSpread,
        heroId: state.currentHeroId || undefined,
        solids: state.arena.solids,
        targets: allTargets,
        projectileTargetEntities: allEntities,
        tracerColor: state.tracerColor,
        onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
          if (target.type === 'target') {
            target.entity.onHit();
          } else if (target.type === 'bot') {
            target.entity.takeDamage(w.damage * (damageMultiplier || 1.0));
          } else if (typeof target.takeDamage === 'function') {
            target.takeDamage(w.damage * (damageMultiplier || 1.0));
          }
          if (typeof playGameSound === 'function') playGameSound('hit_marker', { heroId: state.currentHeroId || undefined, headshot: (damageMultiplier || 1) > 1 });
          state.stats.hits++;
        }
      };

      var result;
      if (w.burst && window.sharedStartBurst) {
        var originFn = function () { return camera.position.clone(); };
        var dirFn = function () { var d = new THREE.Vector3(); camera.getWorldDirection(d); return d; };
        result = window.sharedStartBurst(w, originFn, dirFn, fireOpts);
      } else {
        var dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        result = sharedFireWeapon(w, camera.position.clone(), dir, fireOpts);
      }

      state.stats.shots++;
      for (var i = 0; i < state.bots.length; i++) {
        if (!state.bots[i].alive && !state.bots[i]._countedKill) {
          state.stats.kills++;
          state.bots[i]._countedKill = true;
        }
      }
      updateHUD();

      if (result.magazineEmpty) {
        if (sharedStartReload(w, now, state.currentHeroId)) {
          sharedSetReloadingUI(true, state.hud.reloadIndicator);
        }
      }
    }
  }

  function updateReload(now) {
    if (state.player.weapon.meleeOnly) return;
    if (sharedHandleReload(state.player.weapon, now, state.currentHeroId)) {
      sharedSetReloadingUI(false, state.hud.reloadIndicator);
      updateHUD();
    }
  }

  // ── Main loop ──

  function tick(ts) {
    if (!window.trainingRangeActive || !state) return;

    var dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    // Don't process game input while hero select is open
    if (window._heroSelectOpen) {
      state.loopHandle = requestAnimationFrame(tick);
      return;
    }

    var input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };

    // Ignore initial stuck fire
    if (!state.inputArmed) {
      if (input.fireDown) { input.fireDown = false; }
      else { state.inputArmed = true; }
    }

    sharedSetCrosshairBySprint(!!input.sprint, state.player.weapon.spreadRad, state.player.weapon.sprintSpreadRad);
    sharedSetSprintUI(!!input.sprint, state.hud.sprintIndicator);

    // Player physics
    var prevGrounded = state.player.grounded;
    updateFullPhysics(
      state.player,
      { moveX: input.moveX || 0, moveZ: input.moveZ || 0, sprint: !!input.sprint, jump: !!input.jump },
      { colliders: state.arena.colliders, solids: state.arena.solids },
      dt
    );
    state.player._hitboxYaw = camera.rotation.y;
    state.player._syncMeshPosition();
    state.player.syncCameraFromPlayer();

    // Movement sounds
    if (typeof playGameSound === 'function') {
      var _hid = state.currentHeroId || undefined;
      if (prevGrounded && !state.player.grounded) playGameSound('jump', { heroId: _hid });
      if (!prevGrounded && state.player.grounded) playGameSound('land', { heroId: _hid });
      var moving = (input.moveX !== 0 || input.moveZ !== 0);
      if (moving && state.player.grounded && typeof playFootstepIfDue === 'function') {
        playFootstepIfDue(!!input.sprint, state.currentHeroId, performance.now());
      }
    }

    // Update bots and targets BEFORE shooting/projectiles so hitboxes are fresh
    for (var i = 0; i < state.bots.length; i++) {
      state.bots[i].update(dt, camera.position);
      // Reset kill-counted flag on respawn
      if (state.bots[i].alive) {
        state.bots[i]._countedKill = false;
      }
    }
    for (var t = 0; t < state.targets.length; t++) {
      state.targets[t].update();
    }

    // Ability update + input activation
    if (state.player.abilityManager) {
      state.player.abilityManager.update(dt * 1000);
      var abilities = state.player.abilityManager.getHUDState();
      for (var ai = 0; ai < abilities.length; ai++) {
        if (input[abilities[ai].key]) {
          state.player.abilityManager.activate(abilities[ai].id);
        }
      }
    }

    // Scope/ADS: if hero has weapon.scope and no ability consumed secondaryDown
    _trainingScopeResult = { adsActive: false, spreadMultiplier: 1.0 };
    var hasSecondaryAbility = false;
    if (state.player.abilityManager) {
      var hudState = state.player.abilityManager.getHUDState();
      for (var si = 0; si < hudState.length; si++) {
        if (hudState[si].key === 'secondaryDown') { hasSecondaryAbility = true; break; }
      }
    }
    if (!hasSecondaryAbility && window.updateScopeADS && state.player.weapon) {
      _trainingScopeResult = window.updateScopeADS(state.player.weapon, !!input.secondaryDown, dt);
    } else if (window.updateScopeADS) {
      window.updateScopeADS(state.player.weapon, false, dt);
    }

    // Melee + Shooting
    var now = performance.now();
    // Melee-only weapons: left-click triggers melee swing, not fire
    if (state.player.weapon.meleeOnly && input.fireDown) {
      input.meleePressed = true;
      input.fireDown = false;
    }
    // Sprint lockout: heroes with sprintLockout passive can't fire while sprinting
    var sprintLocked = input.sprint && state.player.abilityManager && state.player.abilityManager.hasPassive('sprintLockout');
    if (sprintLocked) {
      input.fireDown = false;
      input.meleePressed = false;
    }
    // Meditate freeze: block ALL input during meditate
    if (state.player._meditating) {
      input.moveX = 0;
      input.moveZ = 0;
      input.sprint = false;
      input.jump = false;
      input.fireDown = false;
      input.secondaryDown = false;
    }
    handleMelee(input, now);
    if (!_meleeSwinging) handlePlayerShooting(input, now);
    updateReload(now);

    // Update live projectiles (all entity hitboxes are now fresh)
    if (typeof updateProjectiles === 'function') updateProjectiles(dt);
    if (typeof window.sharedUpdateBursts === 'function') window.sharedUpdateBursts(performance.now());

    // Update hitbox visualization after all positions are current
    if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();

    updateHUD();

    // Update ability HUD
    if (state.player.abilityManager && typeof window.updateAbilityHUD === 'function') {
      window.updateAbilityHUD(state.player.abilityManager.getHUDState());
    }
    // Mana HUD
    if (state.player.abilityManager) {
      var _tam = state.player.abilityManager;
      if (_tam.hasMana && _tam.hasMana()) {
        if (window.updateManaHUD) window.updateManaHUD(_tam.getMana(), _tam.getMaxMana());
      } else if (window.updateManaHUD) {
        window.updateManaHUD(null);
      }
    }

    // Update audio listener for spatial sound
    if (typeof window.updateAudioListener === 'function') {
      window.updateAudioListener(camera.position, camera.quaternion);
    }

    state.loopHandle = requestAnimationFrame(tick);
  }

  // ── Start / Stop ──

  window.startTrainingRange = function (opts) {
    if (window.trainingRangeActive) {
      try { if (typeof stopTrainingRangeInternal === 'function') stopTrainingRangeInternal(); } catch (e) {}
    }
    // Cross-mode cleanup: stop FFA if active
    if (window.ffaActive && typeof window.stopFFAInternal === 'function') {
      try { window.stopFFAInternal(); } catch (e) {}
    }
    // Defensive cleanup: remove any leftover arena groups from the scene
    if (typeof scene !== 'undefined' && scene) {
      for (var ci = scene.children.length - 1; ci >= 0; ci--) {
        var cname = scene.children[ci].name;
        if (cname === 'PaintballArena' || cname === 'TrainingRangeArena') {
          scene.remove(scene.children[ci]);
        }
      }
    }
    var requestedHeroId = (opts && opts._heroId) || (window.getCurrentHeroId ? window.getCurrentHeroId() : 'marksman');
    var hero = window.getHeroById ? window.getHeroById(requestedHeroId) : null;
    var weaponOpts = hero ? hero.weapon : {};
    var tracerColor = hero ? hero.color : 0x66ffcc;
    var heroId = hero ? hero.id : 'marksman';

    var arena = buildTrainingRangeArena();

    // Create targets
    var targets = [];
    for (var i = 0; i < arena.targetPositions.length; i++) {
      targets.push(createTarget(arena.targetPositions[i]));
    }

    // Create bots
    var bots = [];
    for (var b = 0; b < arena.botPatrolPaths.length; b++) {
      bots.push(new TrainingBot({
        patrolPath: arena.botPatrolPaths[b],
        arena: arena,
        maxHealth: 60,
        color: 0xff5555
      }));
    }

    // Create player
    var player = new Player({
      cameraAttached: true,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      radius: PLAYER_RADIUS,
      maxHealth: PLAYER_HEALTH,
      color: 0x66ffcc,
      weapon: new Weapon(weaponOpts)
    });

    // Apply full hero config (stats, weapon model, crosshair, first-person viewmodel)
    if (typeof window.applyHeroToPlayer === 'function') {
      window.applyHeroToPlayer(player, heroId);
    }

    player.resetForRound(arena.spawns.A);
    player.syncCameraFromPlayer();
    camera.rotation.x = 0;
    camera.rotation.z = 0;

    state = {
      arena: arena,
      player: player,
      targets: targets,
      bots: bots,
      currentHeroId: heroId,
      tracerColor: tracerColor,
      hud: getHudElements(),
      stats: { shots: 0, hits: 0, kills: 0 },
      inputArmed: false,
      lastTs: 0,
      loopHandle: 0
    };

    setHUDVisible(true);
    showOnlyMenu(null);
    showTrainingHUD(true);
    updateWeaponNameDisplay();
    sharedSetCrosshairBySprint(false);
    sharedSetReloadingUI(false, state.hud.reloadIndicator);
    updateHUD();

    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    window.trainingRangeActive = true;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  };

  window.stopTrainingRangeInternal = function (showMenu) {
    if (showMenu === undefined) showMenu = true;

    // Close hero select if open
    if (window._heroSelectOpen && typeof window.closeHeroSelect === 'function') {
      window.closeHeroSelect();
    }

    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch (e) {}
      state.loopHandle = 0;
    }

    // Destroy bots
    if (state && state.bots) {
      for (var i = 0; i < state.bots.length; i++) {
        try { state.bots[i].destroy(); } catch (e) {}
      }
      state.bots = [];
    }

    // Destroy targets
    if (state && state.targets) {
      for (var t = 0; t < state.targets.length; t++) {
        try { state.targets[t].destroy(); } catch (e) {}
      }
      state.targets = [];
    }

    // Destroy player
    if (state && state.player) {
      try { state.player.destroy(); } catch (e) {}
      state.player = null;
    }

    // Remove arena
    if (state && state.arena && state.arena.group && state.arena.group.parent) {
      state.arena.group.parent.remove(state.arena.group);
    }

    if (state) showTrainingHUD(false);

    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();
    if (typeof window.sharedClearBursts === 'function') window.sharedClearBursts();
    if (typeof window.resetScopeADS === 'function') window.resetScopeADS();
    setCrosshairDimmed(false);
    setCrosshairSpread(0);
    if (typeof clearFirstPersonWeapon === 'function') clearFirstPersonWeapon();

    _meleeSwinging = false;
    _meleeSwingEnd = 0;
    window.trainingRangeActive = false;
    if (showMenu) {
      try { document.exitPointerLock(); } catch (e) {}
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    }
    state = null;
  };

})();
