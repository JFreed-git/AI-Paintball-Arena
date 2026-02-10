/**
 * devSplitScreen.js — Split-screen two-player game mode for dev workbench
 *
 * PURPOSE: Two viewports side by side, each showing a different player's
 * first-person perspective. Tab key switches which player you're controlling.
 * The inactive player stands still.
 *
 * EXPORTS (window):
 *   startSplitScreen(opts) — start split-screen with {heroP1, heroP2, mapName}
 *   stopSplitScreen()      — tear down split-screen
 *   _splitScreenActive     — boolean flag checked by devApp.js render loop
 *
 * DEPENDENCIES: Three.js, physics.js, player.js, heroes.js, projectiles.js,
 *   hud.js, crosshair.js, arenaCompetitive.js, mapFormat.js, weapon.js,
 *   input.js, devApp.js (scene, camera, renderer globals)
 */

(function () {

  window._splitScreenActive = false;
  window.getSplitScreenState = function () { return _state; };

  var _state = null;

  // Player data structure
  function PlayerState(playerNum) {
    return {
      num: playerNum,
      player: null,       // Player instance
      cam: null,          // THREE.PerspectiveCamera
      yaw: 0,
      pitch: 0,
      fpWeapon: null,     // first-person weapon group on camera
      heroId: 'marksman'
    };
  }

  function newState() {
    return {
      p1: PlayerState(1),
      p2: PlayerState(2),
      activePlayer: 1,   // 1 or 2
      arena: null,
      loopHandle: 0,
      lastTs: 0,
      divider: null
    };
  }

  /**
   * Apply hero crosshair style and color to a split-screen crosshair DOM element.
   */
  function applySSCrosshair(elementId, player) {
    var el = document.getElementById(elementId);
    if (!el || !player || !player.weapon) return;
    var ch = player.weapon.crosshair;
    if (!ch) return;

    // Rebuild children for the correct style
    if (ch.style === 'circle') {
      el.innerHTML = '';
      var ring = document.createElement('div');
      ring.className = 'ch-ring';
      el.appendChild(ring);
      var dot = document.createElement('div');
      dot.className = 'ch-dot';
      el.appendChild(dot);
    } else {
      el.innerHTML = '';
      ['ch-left', 'ch-right', 'ch-top', 'ch-bottom'].forEach(function (cls) {
        var d = document.createElement('div');
        d.className = 'ch-bar ' + cls;
        el.appendChild(d);
      });
    }

    if (ch.color) {
      el.style.setProperty('--ch-color', ch.color);
    }
  }

  // ------- Start -------
  window.startSplitScreen = function (opts) {
    opts = opts || {};
    if (window._splitScreenActive) {
      window.stopSplitScreen();
    }

    _state = newState();
    _state.p1.heroId = opts.heroP1 || 'marksman';
    _state.p2.heroId = opts.heroP2 || 'brawler';

    // Build arena
    var mapName = opts.mapName || '__default__';

    var buildAndStart = function (arenaResult) {
      _state.arena = arenaResult;
      scene.add(arenaResult.group);

      // Spawns
      var spawnA, spawnB;
      if (arenaResult.spawns) {
        if (arenaResult.spawns.A) {
          spawnA = arenaResult.spawns.A;
          spawnB = arenaResult.spawns.B;
        } else if (Array.isArray(arenaResult.spawns) && arenaResult.spawns.length >= 2) {
          spawnA = new THREE.Vector3(arenaResult.spawns[0].x, 0, arenaResult.spawns[0].z);
          spawnB = new THREE.Vector3(arenaResult.spawns[1].x, 0, arenaResult.spawns[1].z);
        }
      }
      if (!spawnA) spawnA = new THREE.Vector3(0, 0, -30);
      if (!spawnB) spawnB = new THREE.Vector3(0, 0, 30);

      // Create players
      _state.p1.player = new Player({
        position: new THREE.Vector3(spawnA.x, GROUND_Y + EYE_HEIGHT, spawnA.z)
      });
      _state.p2.player = new Player({
        position: new THREE.Vector3(spawnB.x, GROUND_Y + EYE_HEIGHT, spawnB.z)
      });

      // Apply heroes
      var allHeroes = (typeof window.getAllHeroes === 'function') ? window.getAllHeroes() : window.HEROES;
      applyHeroToPlayer(_state.p1.player, _state.p1.heroId);
      applyHeroToPlayer(_state.p2.player, _state.p2.heroId);

      // Apply crosshair style/color per hero to split-screen crosshair elements
      applySSCrosshair('ssCrosshairP1', _state.p1.player);
      applySSCrosshair('ssCrosshairP2', _state.p2.player);

      // Both players visible
      _state.p1.player.setVisible(true);
      _state.p2.player.setVisible(true);

      // Create cameras for each player
      var viewport = document.getElementById('devViewport');
      var w = viewport ? viewport.clientWidth : window.innerWidth;
      var h = viewport ? viewport.clientHeight : window.innerHeight;
      var aspect = (w / 2) / h;

      _state.p1.cam = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
      _state.p1.cam.rotation.order = 'YXZ';
      scene.add(_state.p1.cam);

      _state.p2.cam = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
      _state.p2.cam.rotation.order = 'YXZ';
      scene.add(_state.p2.cam);

      // Position cameras at player positions
      syncCamToPlayer(_state.p1);
      syncCamToPlayer(_state.p2);

      // P1 looks toward P2 initially, P2 looks toward P1
      _state.p1.yaw = Math.PI; // facing +Z (toward P2)
      _state.p2.yaw = 0;       // facing -Z (toward P1)
      _state.p1.cam.rotation.set(0, _state.p1.yaw, 0);
      _state.p2.cam.rotation.set(0, _state.p2.yaw, 0);

      // Attach first-person weapon viewmodels to each camera
      attachFPWeapon(_state.p1);
      attachFPWeapon(_state.p2);

      // Set the global camera to active player's camera
      setActiveCamera(_state.p1.cam);
      _state.activePlayer = 1;

      // Show HUD elements
      showSSHUD(true);

      // Add viewport divider
      var divider = document.createElement('div');
      divider.id = 'ssViewportDivider';
      var gc = document.getElementById('gameContainer');
      if (gc) gc.appendChild(divider);
      _state.divider = divider;

      // Tab listener
      document.addEventListener('keydown', onSSKeyDown);

      // Request pointer lock
      var canvas = renderer.domElement;
      canvas.addEventListener('click', requestPointerLockSS);

      // Hide all UI for full-screen split view
      if (typeof hideGameModeUI === 'function') {
        hideGameModeUI();
      } else {
        var devSidebar = document.getElementById('devSidebar');
        if (devSidebar) devSidebar.classList.add('hidden');
      }
      if (typeof window.resizeRenderer === 'function') window.resizeRenderer();

      window._splitScreenActive = true;
      _state.lastTs = performance.now();
      ssLoop();
    };

    if (mapName && mapName !== '__default__' && typeof fetchMapData === 'function' && typeof buildArenaFromMap === 'function') {
      fetchMapData(mapName).then(function (mapData) {
        var result = buildArenaFromMap(mapData);
        buildAndStart(result);
      }).catch(function () {
        var result = buildPaintballArenaSymmetric();
        buildAndStart(result);
      });
    } else {
      var result = buildPaintballArenaSymmetric();
      buildAndStart(result);
    }
  };

  // ------- Stop -------
  window.stopSplitScreen = function () {
    window._splitScreenActive = false;

    if (typeof clearAllProjectiles === 'function') clearAllProjectiles();

    if (_state) {
      if (_state.loopHandle) cancelAnimationFrame(_state.loopHandle);

      // Remove arena
      if (_state.arena && _state.arena.group) {
        scene.remove(_state.arena.group);
      }

      // Destroy players
      if (_state.p1.player) _state.p1.player.destroy();
      if (_state.p2.player) _state.p2.player.destroy();

      // Remove cameras
      if (_state.p1.cam) {
        removeFPWeapon(_state.p1);
        scene.remove(_state.p1.cam);
      }
      if (_state.p2.cam) {
        removeFPWeapon(_state.p2);
        scene.remove(_state.p2.cam);
      }

      // Remove divider
      if (_state.divider && _state.divider.parentNode) {
        _state.divider.parentNode.removeChild(_state.divider);
      }

      _state = null;
    }

    // Hide HUD
    showSSHUD(false);

    document.removeEventListener('keydown', onSSKeyDown);

    var canvas = renderer.domElement;
    canvas.removeEventListener('click', requestPointerLockSS);

    // Restore global camera
    camera.aspect = renderer.domElement.width / renderer.domElement.height;
    camera.updateProjectionMatrix();

    // Restore sidebar (preserve collapsed state)
    var devSidebar = document.getElementById('devSidebar');
    if (devSidebar) {
      devSidebar.classList.remove('hidden');
      var sidebarExpandTab = document.getElementById('devSidebarExpand');
      if (sidebarExpandTab) sidebarExpandTab.classList.toggle('hidden', !devSidebar.classList.contains('collapsed'));
    }
    // Restore right panel and toolbar if hero editor was active
    if (typeof _activePanel !== 'undefined' && _activePanel === 'heroEditor') {
      var rightPanel = document.getElementById('devRightPanel');
      var toolbar = document.getElementById('heViewportToolbar');
      var rightExpandTab = document.getElementById('devRightPanelExpand');
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (toolbar) toolbar.classList.remove('hidden');
    }
    if (typeof window.resizeRenderer === 'function') {
      setTimeout(window.resizeRenderer, 50);
    }

    // Reset renderer
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    renderer.setScissorTest(false);
  };

  // ------- Pointer Lock -------
  function requestPointerLockSS() {
    if (!window._splitScreenActive) return;
    renderer.domElement.requestPointerLock();
  }

  // ------- Camera/Player Sync -------
  function syncCamToPlayer(ps) {
    if (!ps.player || !ps.cam) return;
    ps.cam.position.set(
      ps.player.position.x,
      ps.player.feetY + EYE_HEIGHT,
      ps.player.position.z
    );
  }

  function setActiveCamera(cam) {
    // The global 'camera' variable is used by input.js for mouse look
    // We swap it to the active player's camera
    camera = cam;
  }

  // ------- First-Person Weapon -------
  function attachFPWeapon(ps) {
    if (!ps.cam || !ps.player) return;
    removeFPWeapon(ps);

    var modelType = (ps.player.weapon && ps.player.weapon.modelType) ? ps.player.weapon.modelType : 'default';
    if (typeof buildWeaponModel !== 'function') return;

    var model = buildWeaponModel(modelType);
    var group = new THREE.Group();
    group.add(model);
    group.position.set(0.28, -0.22, -0.45);
    group.rotation.set(0.05, -0.15, 0);

    group.traverse(function (c) {
      if (c.isMesh && c.material) {
        c.material = c.material.clone();
        c.material.depthTest = false;
        c.material.depthWrite = false;
        c.renderOrder = 999;
      }
    });

    ps.cam.add(group);
    ps.fpWeapon = group;
  }

  function removeFPWeapon(ps) {
    if (ps.fpWeapon && ps.cam) {
      ps.cam.remove(ps.fpWeapon);
      ps.fpWeapon.traverse(function (c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      ps.fpWeapon = null;
    }
  }

  // ------- Tab to Switch -------
  function onSSKeyDown(e) {
    if (!window._splitScreenActive || !_state) return;

    if (e.code === 'Tab') {
      e.preventDefault();
      switchActivePlayer();
    }
  }

  function switchActivePlayer() {
    if (!_state) return;

    var active = getActivePS();
    var inactive = getInactivePS();

    // Save current camera rotation into the now-inactive player
    active.yaw = camera.rotation.y;
    active.pitch = camera.rotation.x;

    // Swap active
    _state.activePlayer = (_state.activePlayer === 1) ? 2 : 1;

    var newActive = getActivePS();

    // Set global camera to new active player's camera
    setActiveCamera(newActive.cam);
    camera.rotation.set(newActive.pitch, newActive.yaw, 0);
    camera.rotation.order = 'YXZ';

    // Update control indicator
    var indicator = document.getElementById('ssControlIndicator');
    if (indicator) {
      indicator.textContent = 'CONTROLLING P' + _state.activePlayer;
    }

    // Update HUD dimming
    updateHUDDimming();
  }

  function getActivePS() {
    if (!_state) return null;
    return _state.activePlayer === 1 ? _state.p1 : _state.p2;
  }

  function getInactivePS() {
    if (!_state) return null;
    return _state.activePlayer === 1 ? _state.p2 : _state.p1;
  }

  // ------- HUD -------
  function showSSHUD(show) {
    var ids = ['ssHudP1', 'ssHudP2', 'ssControlIndicator', 'ssCrosshairP1', 'ssCrosshairP2'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', !show);
    });
    if (show) {
      var indicator = document.getElementById('ssControlIndicator');
      if (indicator && _state) {
        indicator.textContent = 'CONTROLLING P' + _state.activePlayer;
      }
      updateHUDDimming();
    }
  }

  function updateHUDDimming() {
    if (!_state) return;
    var hud1 = document.getElementById('ssHudP1');
    var hud2 = document.getElementById('ssHudP2');
    var ch1 = document.getElementById('ssCrosshairP1');
    var ch2 = document.getElementById('ssCrosshairP2');
    if (hud1) hud1.classList.toggle('dimmed', _state.activePlayer !== 1);
    if (hud2) hud2.classList.toggle('dimmed', _state.activePlayer !== 2);
    if (ch1) ch1.classList.toggle('dimmed', _state.activePlayer !== 1);
    if (ch2) ch2.classList.toggle('dimmed', _state.activePlayer !== 2);
  }

  function updateSSHUD() {
    if (!_state) return;

    // P1
    var p1 = _state.p1.player;
    if (p1) {
      sharedUpdateHealthBar(document.getElementById('ssHealthFillP1'), p1.health, p1.maxHealth);
      sharedUpdateAmmoDisplay(document.getElementById('ssAmmoP1'), p1.weapon.ammo, p1.weapon.magSize);
      var r1 = document.getElementById('ssReloadP1');
      if (r1) r1.classList.toggle('hidden', !p1.weapon.reloading);
    }

    // P2
    var p2 = _state.p2.player;
    if (p2) {
      sharedUpdateHealthBar(document.getElementById('ssHealthFillP2'), p2.health, p2.maxHealth);
      sharedUpdateAmmoDisplay(document.getElementById('ssAmmoP2'), p2.weapon.ammo, p2.weapon.magSize);
      var r2 = document.getElementById('ssReloadP2');
      if (r2) r2.classList.toggle('hidden', !p2.weapon.reloading);
    }
  }

  // ------- Game Loop -------
  function ssLoop() {
    if (!window._splitScreenActive || !_state) return;
    _state.loopHandle = requestAnimationFrame(ssLoop);

    var now = performance.now();
    var dt = Math.min((now - _state.lastTs) / 1000, 0.05);
    _state.lastTs = now;

    // Get input
    var input = getInputState();

    // Update active player with input
    var active = getActivePS();
    var inactive = getInactivePS();

    if (active && active.player && active.player.alive) {
      // Physics
      var speed = input.sprint ? active.player.sprintSpeed : active.player.walkSpeed;

      // Movement direction from camera
      var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      forward.y = 0;
      forward.normalize();
      var right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      right.normalize();

      var moveDir = new THREE.Vector3();
      moveDir.addScaledVector(forward, input.moveZ);
      moveDir.addScaledVector(right, input.moveX);
      if (moveDir.lengthSq() > 0) moveDir.normalize();

      // Apply physics through updateFullPhysics
      var physInput = {
        moveX: input.moveX,
        moveZ: input.moveZ,
        sprint: input.sprint,
        jump: input.jump
      };

      if (typeof updateFullPhysics === 'function' && _state.arena) {
        updateFullPhysics(active.player, physInput, _state.arena, dt);
      }

      // Sync mesh/hitbox after physics so hitboxes are fresh for projectile testing
      active.player._hitboxYaw = camera.rotation.y;
      active.player._syncMeshPosition();

      // Sync camera to player position
      syncCamToPlayer(active);

      // Shooting
      var weapon = active.player.weapon;
      sharedHandleReload(weapon, now);

      if (input.reloadPressed) {
        sharedStartReload(weapon, now);
      }

      if (input.fireDown && sharedCanShoot(weapon, now, weapon.cooldownMs)) {
        var eyePos = active.player.getEyePos();
        var dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

        // Determine target: the other player
        var targetPlayer = inactive.player;
        var targets = [];
        var targetEntities = [];
        if (targetPlayer && targetPlayer.alive) {
          targets.push({ segments: targetPlayer.getHitSegments(), entity: targetPlayer });
          targetEntities.push(targetPlayer);
        }

        sharedFireWeapon(weapon, eyePos, dir, {
          sprinting: input.sprint,
          maxRange: weapon.maxRange,
          targets: targets,
          projectileTargetEntities: targetEntities,
          solids: _state.arena.solids || [],
          tracerColor: weapon.tracerColor,
          onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
            if (targetPlayer && targetPlayer.alive) {
              targetPlayer.takeDamage(weapon.damage * (damageMultiplier || 1.0));
            }
          }
        });
      }

      // Crosshair spread for active player
      var activeSpread = input.sprint ? weapon.sprintSpreadRad : weapon.spreadRad;
      var chId = _state.activePlayer === 1 ? 'ssCrosshairP1' : 'ssCrosshairP2';
      var chEl = document.getElementById(chId);
      if (chEl) {
        var fov = camera.fov || 75;
        var fovRad = fov * Math.PI / 180;
        var focalPx = (window.innerHeight / 2) / Math.tan(fovRad / 2);
        var px = Math.tan(Math.max(0, activeSpread)) * focalPx;
        px = Math.max(0, Math.min(150, px));
        chEl.style.setProperty('--spread', px + 'px');
      }
    }

    // Update live projectiles
    if (typeof updateProjectiles === 'function') updateProjectiles(dt);

    // Update inactive player's weapon reload state
    if (inactive && inactive.player && inactive.player.alive) {
      sharedHandleReload(inactive.player.weapon, now);
    }

    // Sync inactive camera (stays at last position)
    if (inactive && inactive.player) {
      syncCamToPlayer(inactive);
      inactive.cam.rotation.set(inactive.pitch, inactive.yaw, 0);
      inactive.cam.rotation.order = 'YXZ';
    }

    // Update player meshes - face direction of their own cameras
    if (_state.p1.player) {
      var p1Yaw = (_state.activePlayer === 1) ? camera.rotation.y : (_state.p1.yaw || 0);
      _state.p1.player._hitboxYaw = p1Yaw;
      _state.p1.player._meshGroup.rotation.set(0, p1Yaw, 0);
      _state.p1.player._syncMeshPosition();
    }
    if (_state.p2.player) {
      var p2Yaw = (_state.activePlayer === 2) ? camera.rotation.y : (_state.p2.yaw || 0);
      _state.p2.player._hitboxYaw = p2Yaw;
      _state.p2.player._meshGroup.rotation.set(0, p2Yaw, 0);
      _state.p2.player._syncMeshPosition();
    }

    // Update 3D health bars
    [_state.p1, _state.p2].forEach(function (ps) {
      if (ps.player) {
        ps.player.update3DHealthBar(camera.position, _state.arena ? _state.arena.solids : []);
      }
    });

    // Update hitbox visualization after all positions are current
    if (window.devShowHitboxes && window.updateHitboxVisuals) window.updateHitboxVisuals();

    // HUD
    updateSSHUD();

    // Render both viewports
    renderSplitScreen();

    // Check for deaths and respawn
    if (_state.p1.player && !_state.p1.player.alive) {
      setTimeout(function () {
        if (_state && _state.p1.player) {
          var spawn = (_state.arena && _state.arena.spawns && _state.arena.spawns.A) || { x: 0, z: -30 };
          _state.p1.player.resetForRound(spawn);
          _state.p1.player.setVisible(true);
          applyHeroToPlayer(_state.p1.player, _state.p1.heroId);
          attachFPWeapon(_state.p1);
        }
      }, 1500);
    }
    if (_state.p2.player && !_state.p2.player.alive) {
      setTimeout(function () {
        if (_state && _state.p2.player) {
          var spawn = (_state.arena && _state.arena.spawns && _state.arena.spawns.B) || { x: 0, z: 30 };
          _state.p2.player.resetForRound(spawn);
          _state.p2.player.setVisible(true);
          applyHeroToPlayer(_state.p2.player, _state.p2.heroId);
          attachFPWeapon(_state.p2);
        }
      }, 1500);
    }
  }

  // ------- Rendering -------
  function renderSplitScreen() {
    if (!_state || !renderer) return;

    var canvas = renderer.domElement;
    var fullW = canvas.width;
    var fullH = canvas.height;
    var halfW = Math.floor(fullW / 2);

    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clear();

    // Left viewport: P1's camera
    renderer.setViewport(0, 0, halfW, fullH);
    renderer.setScissor(0, 0, halfW, fullH);

    // Hide P1 mesh in P1's viewport, show P2
    if (_state.p1.player) _state.p1.player.setVisible(false);
    if (_state.p2.player && _state.p2.player.alive) _state.p2.player.setVisible(true);

    var cam1 = _state.p1.cam;
    if (_state.activePlayer === 1) {
      // Active player uses live camera (which is the global camera)
      cam1 = camera;
    }
    cam1.aspect = halfW / fullH;
    cam1.updateProjectionMatrix();
    renderer.render(scene, cam1);

    // Right viewport: P2's camera
    renderer.setViewport(halfW, 0, fullW - halfW, fullH);
    renderer.setScissor(halfW, 0, fullW - halfW, fullH);

    // Hide P2 mesh in P2's viewport, show P1
    if (_state.p2.player) _state.p2.player.setVisible(false);
    if (_state.p1.player && _state.p1.player.alive) _state.p1.player.setVisible(true);

    var cam2 = _state.p2.cam;
    if (_state.activePlayer === 2) {
      cam2 = camera;
    }
    cam2.aspect = (fullW - halfW) / fullH;
    cam2.updateProjectionMatrix();
    renderer.render(scene, cam2);

    // Restore visibility for both players
    if (_state.p1.player && _state.p1.player.alive) _state.p1.player.setVisible(true);
    if (_state.p2.player && _state.p2.player.alive) _state.p2.player.setVisible(true);

    renderer.setScissorTest(false);
    renderer.autoClear = true;
  }

})();
