/**
 * devConsole.js — Developer tools and cheat console
 *
 * PURPOSE: Password-protected developer console with debug tools: god mode,
 * unlimited ammo, spectator camera, kill enemy, heal player, hitbox visualization,
 * AI state display, and map editor access. Toggled with the 'C' key.
 *
 * EXPORTS (window):
 *   devAuthenticated, devGodMode, devShowHitboxes, devConsoleOpen, devSpectatorMode
 *
 * DEPENDENCIES: Three.js, modeFFA.js (getFFAState, AI state),
 *   player.js (Player), mapEditor.js (editor functions),
 *   game.js (scene, camera, renderer globals)
 *
 * TODO (future):
 *   - Network debug overlay (ping, packet loss, snapshot rate)
 *   - Ability cooldown reset
 *   - Spawn bot commands
 *   - Teleport to coordinates
 *   - Performance profiler
 */

(function () {
  var PASSWORD = 'devpower5';
  var authenticated = false;
  window.devAuthenticated = false;

  // Auto-authenticate in dev workbench (Electron)
  if (window.devAPI) {
    authenticated = true;
    window.devAuthenticated = true;
  }
  window.devGodMode = false;
  window.devShowHitboxes = false;
  window.updateHitboxVisuals = updateHitboxVisuals;

  // Helper: get the active game state
  function getActiveState() {
    if (window.ffaActive && window.getFFAState) return window.getFFAState();
    if (window.trainingRangeActive && window.getTrainingRangeState) return window.getTrainingRangeState();
    if (window._splitScreenActive && window.getSplitScreenState) return window.getSplitScreenState();
    return null;
  }

  // Helper: get the local player from whichever mode is active
  function getLocalPlayer() {
    var state = getActiveState();
    if (!state) return null;
    // FFA mode: state.players[state.localId].entity
    if (state.players && state.localId && state.players[state.localId]) {
      return state.players[state.localId].entity;
    }
    return null;
  }

  var consoleEl = document.getElementById('devConsole');
  if (!consoleEl) {
    console.warn('devConsole: DOM elements not found, skipping initialization');
    return; // exit the IIFE early
  }
  var passwordView = document.getElementById('devPassword');
  var commandsView = document.getElementById('devCommands');
  var passwordInput = document.getElementById('devPasswordInput');
  var passwordSubmit = document.getElementById('devPasswordSubmit');
  var passwordError = document.getElementById('devPasswordError');

  // Cheat state
  var cheats = {
    godMode: false,
    unlimitedAmmo: false,
    spectator: false,
    showHitboxes: false,
    showAIState: false
  };

  var spectatorSavedY = null;
  var spectatorKeys = { w: false, a: false, s: false, d: false, space: false, shift: false };

  // Hitbox visualization state
  var hitboxVisuals = [];

  // AI state label element
  var aiStateLabel = null;

  // Toggle console visibility
  function isConsoleOpen() {
    return consoleEl && !consoleEl.classList.contains('hidden');
  }

  function openConsole() {
    if (!consoleEl) return;
    window.devConsoleOpen = true;
    consoleEl.classList.remove('hidden');
    try { document.exitPointerLock(); } catch (e) { console.warn('devConsole: exitPointerLock failed', e); }
    if (authenticated) {
      passwordView.classList.add('hidden');
      commandsView.classList.remove('hidden');
    } else {
      passwordView.classList.remove('hidden');
      commandsView.classList.add('hidden');
      passwordInput.value = '';
      passwordError.classList.add('hidden');
      setTimeout(function () { passwordInput.focus(); }, 50);
    }
  }

  function closeConsole() {
    if (!consoleEl) return;
    window.devConsoleOpen = false;
    consoleEl.classList.add('hidden');
    // Re-engage pointer lock if in game
    if ((window.ffaActive || window.trainingRangeActive || window._splitScreenActive) && renderer && renderer.domElement) {
      try { renderer.domElement.requestPointerLock(); } catch (e) { console.warn('devConsole: requestPointerLock failed', e); }
    }
  }

  // Global key listener for 'c'
  document.addEventListener('keydown', function (e) {
    if (window._splitScreenActive) return; // input belongs to iframes
    if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Don't toggle if typing in an input/textarea (other than dev console inputs)
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // Allow if it's the dev password input (don't block typing 'c' there)
        if (document.activeElement === passwordInput) return;
        return;
      }
      e.preventDefault();
      if (isConsoleOpen()) {
        closeConsole();
      } else {
        openConsole();
      }
    }
  });

  // Password submission
  function tryPassword() {
    var val = passwordInput.value.trim();
    if (val === PASSWORD) {
      authenticated = true;
      window.devAuthenticated = true;
      passwordView.classList.add('hidden');
      commandsView.classList.remove('hidden');
      passwordError.classList.add('hidden');
    } else {
      passwordError.classList.remove('hidden');
      passwordInput.value = '';
      passwordInput.focus();
    }
  }

  if (passwordSubmit) passwordSubmit.addEventListener('click', tryPassword);
  if (passwordInput) {
    passwordInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryPassword();
      }
      e.stopPropagation();
    });
    // Prevent key events in password input from reaching the game
    passwordInput.addEventListener('keyup', function (e) { e.stopPropagation(); });
  }

  // Command buttons
  var cmdButtons = commandsView.querySelectorAll('.dev-cmd');
  for (var i = 0; i < cmdButtons.length; i++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-cmd');
        handleCommand(cmd, btn);
      });
    })(cmdButtons[i]);
  }

  function handleCommand(cmd, btn) {
    var state = getActiveState();
    var localPlayer = getLocalPlayer();

    if (cmd === 'godMode') {
      cheats.godMode = !cheats.godMode;
      window.devGodMode = cheats.godMode;
      btn.textContent = 'God Mode: ' + (cheats.godMode ? 'ON' : 'OFF');
      btn.classList.toggle('active', cheats.godMode);
    } else if (cmd === 'unlimitedAmmo') {
      cheats.unlimitedAmmo = !cheats.unlimitedAmmo;
      btn.textContent = 'Unlimited Ammo: ' + (cheats.unlimitedAmmo ? 'ON' : 'OFF');
      btn.classList.toggle('active', cheats.unlimitedAmmo);
    } else if (cmd === 'spectator') {
      cheats.spectator = !cheats.spectator;
      btn.textContent = 'Spectator Camera: ' + (cheats.spectator ? 'ON' : 'OFF');
      btn.classList.toggle('active', cheats.spectator);
      window.devSpectatorMode = cheats.spectator;

      if (cheats.spectator) {
        // Enter spectator: show player mesh, detach camera
        spectatorSavedY = camera ? camera.position.y : 2;
        if (localPlayer) {
          localPlayer.cameraAttached = false;
          localPlayer.setVisible(true);
          localPlayer._syncMeshPosition();
        }
      } else {
        // Exit spectator: hide player mesh, re-attach camera
        if (localPlayer) {
          localPlayer.cameraAttached = true;
          localPlayer.setVisible(false);
          localPlayer.syncCameraFromPlayer();
        } else if (camera && spectatorSavedY !== null) {
          camera.position.y = spectatorSavedY;
        }
        spectatorSavedY = null;
      }
    } else if (cmd === 'showHitboxes') {
      cheats.showHitboxes = !cheats.showHitboxes;
      window.devShowHitboxes = cheats.showHitboxes;
      btn.textContent = 'Show Hitboxes: ' + (cheats.showHitboxes ? 'ON' : 'OFF');
      btn.classList.toggle('active', cheats.showHitboxes);
      if (!cheats.showHitboxes) {
        clearHitboxVisuals();
      }
    } else if (cmd === 'showAIState') {
      cheats.showAIState = !cheats.showAIState;
      btn.textContent = 'AI State: ' + (cheats.showAIState ? 'ON' : 'OFF');
      btn.classList.toggle('active', cheats.showAIState);
      if (!cheats.showAIState) {
        hideAIStateLabel();
      }
    } else if (cmd === 'killEnemy') {
      if (state && state.ai && state.ai.alive) {
        state.ai.takeDamage(9999);
        if (!state.ai.alive && window.endPaintballRound) {
          window.endPaintballRound('player');
        }
      }
    } else if (cmd === 'heal') {
      if (localPlayer) {
        localPlayer.health = localPlayer.maxHealth;
        localPlayer.alive = true;
      }
    }
  }

  // --- Hitbox Visualization ---

  function clearHitboxVisuals() {
    for (var i = 0; i < hitboxVisuals.length; i++) {
      try {
        if (hitboxVisuals[i].parent) hitboxVisuals[i].parent.remove(hitboxVisuals[i]);
        if (hitboxVisuals[i].geometry) hitboxVisuals[i].geometry.dispose();
        if (hitboxVisuals[i].material) hitboxVisuals[i].material.dispose();
      } catch (e) { /* ignore cleanup errors */ }
    }
    hitboxVisuals = [];
  }

  function updateHitboxVisuals() {
    if (!cheats.showHitboxes || typeof scene === 'undefined' || !scene) return;

    var state = getActiveState();

    // Collect all Player objects that should show hitboxes
    var players = [];
    if (state) {
      // AI mode
      if (state.ai && state.ai.alive && state.ai.player) {
        players.push(state.ai.player);
      }
      if (state.player && state.player.alive) {
        players.push(state.player);
      }
      // LAN mode
      if (state.players) {
        if (state.players.host && state.players.host.alive) {
          players.push(state.players.host);
        }
        if (state.players.client && state.players.client.alive) {
          players.push(state.players.client);
        }
      }
      // Training Range bots
      if (state.bots) {
        for (var bi = 0; bi < state.bots.length; bi++) {
          if (state.bots[bi].alive && state.bots[bi].player) {
            players.push(state.bots[bi].player);
          }
        }
      }
      // Split Screen mode
      if (state.p1 && state.p1.player && state.p1.player.alive) {
        players.push(state.p1.player);
      }
      if (state.p2 && state.p2.player && state.p2.player.alive) {
        players.push(state.p2.player);
      }
    }

    // Collect collider boxes from arena
    var arenaColliders = (state && state.arena && state.arena.colliders) ? state.arena.colliders : [];

    // Count total expected visuals: segments per player + arena colliders
    var totalSegments = 0;
    for (var pi = 0; pi < players.length; pi++) {
      var segs = (typeof players[pi].getHitSegments === 'function') ? players[pi].getHitSegments() : [];
      totalSegments += segs.length;
    }
    var expectedCount = totalSegments + arenaColliders.length;

    // Rebuild visuals if count changed
    if (hitboxVisuals.length !== expectedCount) {
      clearHitboxVisuals();

      var segColorMap = { head: 0xff4444, torso: 0x44ff44, legs: 0x4488ff };
      var defaultSegColor = 0xffff44;

      // Create wireframe shapes for each player's hitbox segments
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var segments = (typeof p.getHitSegments === 'function') ? p.getHitSegments() : [];
        for (var s = 0; s < segments.length; s++) {
          var seg = segments[s];
          var segColor = segColorMap[seg.name] || defaultSegColor;
          var shape = seg.shape || 'box';
          var geom;

          if (shape === 'sphere') {
            geom = new THREE.SphereGeometry(seg.radius || 0.25, 16, 12);
          } else if (shape === 'cylinder') {
            geom = new THREE.CylinderGeometry(seg.radius, seg.radius, seg.halfHeight * 2, 16);
          } else if (shape === 'capsule') {
            geom = (typeof buildCapsuleGeometry === 'function')
              ? buildCapsuleGeometry(seg.radius, seg.halfHeight * 2, 16, 8)
              : new THREE.CylinderGeometry(seg.radius, seg.radius, seg.halfHeight * 2, 16);
          } else {
            geom = new THREE.BoxGeometry(1, 1, 1);
          }

          var boxMat = new THREE.MeshBasicMaterial({ color: segColor, wireframe: true, transparent: true, opacity: 0.5 });
          var boxMesh = new THREE.Mesh(geom, boxMat);
          boxMesh.renderOrder = 998;
          boxMesh._isHitboxSegment = true;
          boxMesh._playerIdx = i;
          boxMesh._segIdx = s;
          boxMesh._segShape = shape;
          boxMesh._segRadius = seg.radius || 0;
          boxMesh._segHalfHeight = seg.halfHeight || 0;
          scene.add(boxMesh);
          hitboxVisuals.push(boxMesh);
        }
      }

      // Create wireframe boxes for arena colliders
      for (var j = 0; j < arenaColliders.length; j++) {
        var box = arenaColliders[j];
        var size = box.getSize(new THREE.Vector3());
        var center = box.getCenter(new THREE.Vector3());
        var cBoxGeom = new THREE.BoxGeometry(size.x, size.y, size.z);
        var cBoxMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true, transparent: true, opacity: 0.3 });
        var cBoxMesh = new THREE.Mesh(cBoxGeom, cBoxMat);
        cBoxMesh.position.copy(center);
        cBoxMesh._isColliderBox = true;
        scene.add(cBoxMesh);
        hitboxVisuals.push(cBoxMesh);
      }
    }

    // Update segment positions and sizes from live hitbox data
    for (var vi = 0; vi < hitboxVisuals.length; vi++) {
      var vis = hitboxVisuals[vi];
      if (vis._isHitboxSegment) {
        var playerIdx = vis._playerIdx;
        var segIdx = vis._segIdx;
        if (playerIdx < players.length) {
          var segments = (typeof players[playerIdx].getHitSegments === 'function') ? players[playerIdx].getHitSegments() : [];
          if (segIdx < segments.length) {
            var seg = segments[segIdx];
            var shape = seg.shape || 'box';

            if (shape === 'sphere' || shape === 'cylinder' || shape === 'capsule') {
              vis.position.copy(seg.center);
              vis.scale.set(1, 1, 1);

              // Rebuild geometry if shape/dimensions changed
              var needsRebuild = (vis._segShape !== shape) ||
                (vis._segRadius !== seg.radius) ||
                (vis._segHalfHeight !== seg.halfHeight);
              if (needsRebuild) {
                if (vis.geometry) vis.geometry.dispose();
                if (shape === 'sphere') {
                  vis.geometry = new THREE.SphereGeometry(seg.radius, 16, 12);
                } else if (shape === 'cylinder') {
                  vis.geometry = new THREE.CylinderGeometry(seg.radius, seg.radius, seg.halfHeight * 2, 16);
                } else if (shape === 'capsule') {
                  vis.geometry = (typeof buildCapsuleGeometry === 'function')
                    ? buildCapsuleGeometry(seg.radius, seg.halfHeight * 2, 16, 8)
                    : new THREE.CylinderGeometry(seg.radius, seg.radius, seg.halfHeight * 2, 16);
                }
                vis._segShape = shape;
                vis._segRadius = seg.radius;
                vis._segHalfHeight = seg.halfHeight;
              }
            } else {
              // box: OBB with center + half-extents + yaw
              vis.position.copy(seg.center);
              vis.scale.set(seg.halfW * 2, seg.halfH * 2, seg.halfD * 2);
              vis.rotation.set(0, seg.yaw || 0, 0);
            }
          }
        }
      }
    }
  }

  // --- AI State Display ---

  function ensureAIStateLabel() {
    if (aiStateLabel) return aiStateLabel;
    aiStateLabel = document.createElement('div');
    aiStateLabel.id = 'aiStateLabel';
    document.body.appendChild(aiStateLabel);
    return aiStateLabel;
  }

  function hideAIStateLabel() {
    if (aiStateLabel) {
      aiStateLabel.style.display = 'none';
    }
  }

  function updateAIStateDisplay() {
    if (!cheats.showAIState) return;
    if (!window.ffaActive) {
      hideAIStateLabel();
      return;
    }

    var state = window.getFFAState ? window.getFFAState() : null;
    if (!state || !state.players) {
      hideAIStateLabel();
      return;
    }

    // Find first alive AI player in FFA
    var aiEntry = null;
    var ids = Object.keys(state.players);
    for (var i = 0; i < ids.length; i++) {
      var entry = state.players[ids[i]];
      if (entry && entry.isAI && entry.aiInstance && entry.alive) {
        aiEntry = entry;
        break;
      }
    }

    if (!aiEntry) {
      hideAIStateLabel();
      return;
    }

    var label = ensureAIStateLabel();
    var behavior = aiEntry.aiInstance.getCurrentBehavior ? aiEntry.aiInstance.getCurrentBehavior() : '?';
    label.textContent = behavior;
    label.style.display = 'block';

    // Project AI head position to screen coordinates
    if (typeof camera !== 'undefined' && camera && typeof renderer !== 'undefined' && renderer) {
      var headWorldPos = aiEntry.entity.getEyePos();
      headWorldPos.y += 1.0; // above head
      var projected = headWorldPos.clone().project(camera);

      // Convert from NDC (-1..1) to screen pixels
      var halfW = renderer.domElement.clientWidth * 0.5;
      var halfH = renderer.domElement.clientHeight * 0.5;
      var screenX = projected.x * halfW + halfW;
      var screenY = -projected.y * halfH + halfH;

      // Only show if in front of camera
      if (projected.z > 0 && projected.z < 1) {
        label.style.transform = 'translate(' + Math.round(screenX) + 'px, ' + Math.round(screenY) + 'px)';
        label.style.display = 'block';
      } else {
        label.style.display = 'none';
      }
    }
  }

  // Spectator camera key tracking
  document.addEventListener('keydown', function (e) {
    if (!cheats.spectator) return;
    var k = e.key.toLowerCase();
    if (k in spectatorKeys) spectatorKeys[k] = true;
    if (k === ' ') spectatorKeys.space = true;
  });
  document.addEventListener('keyup', function (e) {
    if (!cheats.spectator) return;
    var k = e.key.toLowerCase();
    if (k in spectatorKeys) spectatorKeys[k] = false;
    if (k === ' ') spectatorKeys.space = false;
  });

  // Cheat application loop
  var lastCheatTs = 0;
  function cheatLoop(ts) {
    var dt = lastCheatTs ? Math.min(0.05, (ts - lastCheatTs) / 1000) : 0;
    lastCheatTs = ts;

    var loopLocalPlayer = getLocalPlayer();

    if (loopLocalPlayer) {
      // God mode: prevent health from dropping below 1
      if (cheats.godMode) {
        if (loopLocalPlayer.health < 1) loopLocalPlayer.health = 1;
        loopLocalPlayer.alive = true;
      }

      // Unlimited ammo: refill every frame
      if (cheats.unlimitedAmmo && loopLocalPlayer.weapon) {
        loopLocalPlayer.weapon.ammo = loopLocalPlayer.weapon.magSize;
        loopLocalPlayer.weapon.reloading = false;
      }
    }

    // Spectator camera movement
    if (cheats.spectator && typeof camera !== 'undefined' && camera && !isConsoleOpen()) {
      var speed = 12 * dt;
      var dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      var right = new THREE.Vector3();
      right.crossVectors(dir, camera.up).normalize();

      if (spectatorKeys.w) camera.position.addScaledVector(dir, speed);
      if (spectatorKeys.s) camera.position.addScaledVector(dir, -speed);
      if (spectatorKeys.a) camera.position.addScaledVector(right, -speed);
      if (spectatorKeys.d) camera.position.addScaledVector(right, speed);
      if (spectatorKeys.space) camera.position.y += speed;
      if (spectatorKeys.shift) camera.position.y -= speed;
    }

    // Update hitbox visuals
    if (cheats.showHitboxes) {
      updateHitboxVisuals();
    }

    // Update AI state display
    if (cheats.showAIState) {
      updateAIStateDisplay();
    }

    requestAnimationFrame(cheatLoop);
  }
  requestAnimationFrame(cheatLoop);
})();
