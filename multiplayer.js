/**
 * Multiplayer (LAN) module — host-authoritative 2-player mode.
 * Uses shared functions from gameShared.js for HUD, round flow, crosshair, and reload.
 */

(function () {
  window.multiplayerActive = false;

  var PLAYER_RADIUS = 0.5;
  var WALK_SPEED = 4.5;
  var SPRINT_SPEED = 8.5;

  var socket = null;
  var isHost = false;
  var currentRoomId = null;
  var hostId = null;
  var state = null;

  function defaultSettings() {
    return {
      fireCooldownMs: 166,
      magSize: 6,
      reloadTimeSec: 2.5,
      playerHealth: 100,
      playerDamage: 20,
      roundsToWin: 2,
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
    sharedUpdateHealthBar(state.hud.healthFill, p.health, state.settings.playerHealth);
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
        state.inputEnabled = false;
        if (state.match) state.match.roundActive = false;
        state.inputArmed = false;
        var now = performance.now();
        if (state.players && state.players.host && state.players.host.weapon) {
          state.players.host.weapon.lastShotTime = now + 300;
        }
        if (state.players && state.players.client && state.players.client.weapon) {
          state.players.client.weapon.lastShotTime = now + 300;
        }
      },
      onReady: function () {
        state.inputEnabled = true;
        if (state.match) state.match.roundActive = true;
      }
    });
  }

  function resetEntitiesForRound() {
    if (!state) return;
    var A = state.spawns.A;
    var B = state.spawns.B;
    var eyeY = GROUND_Y + EYE_HEIGHT;

    state.players.host.position.copy(A); state.players.host.position.y = eyeY;
    state.players.host.feetY = GROUND_Y; state.players.host.verticalVelocity = 0; state.players.host.grounded = true;
    state.players.client.position.copy(B); state.players.client.position.y = eyeY;
    state.players.client.feetY = GROUND_Y; state.players.client.verticalVelocity = 0; state.players.client.grounded = true;

    camera.position.copy(A); camera.position.y = eyeY;
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.lookAt(B);

    var s = state.settings;
    [state.players.host, state.players.client].forEach(function (p) {
      p.health = s.playerHealth;
      p.alive = true;
      p.weapon.ammo = p.weapon.magSize;
      p.weapon.reloading = false;
      p.weapon.reloadEnd = 0;
      p.weapon.lastShotTime = 0;
    });

    updateHUDForPlayer(isHost ? state.players.host : state.players.client);
  }

  function endRound(who) {
    if (!state || !state.match) return;
    state.match.roundActive = false;

    if (who === 'p1') state.match.player1Wins++;
    else if (who === 'p2') state.match.player2Wins++;

    var wText = who === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!';
    showRoundBanner(wText, 1200);
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
      resetEntitiesForRound();
      updateHUDForPlayer(isHost ? state.players.host : state.players.client);
      startRoundCountdown(3);
      if (socket) socket.emit('startRound', { seconds: 3 });
    }, 1200);
  }

  function newPlayer(opts) {
    var s = state.settings;
    return {
      position: (opts && opts.position) ? opts.position.clone() : new THREE.Vector3(),
      yaw: (opts && typeof opts.yaw === 'number') ? opts.yaw : 0,
      pitch: (opts && typeof opts.pitch === 'number') ? opts.pitch : 0,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      radius: PLAYER_RADIUS,
      feetY: GROUND_Y,
      verticalVelocity: 0,
      grounded: true,
      health: s.playerHealth,
      alive: true,
      input: { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false, forward: new THREE.Vector3(0, 0, -1) },
      weapon: {
        magSize: s.magSize,
        ammo: s.magSize,
        reloading: false,
        reloadEnd: 0,
        lastShotTime: 0,
        reloadTimeSec: s.reloadTimeSec,
        cooldownMs: s.fireCooldownMs
      }
    };
  }

  function newState(settingsFromServer) {
    var merged = Object.assign({}, defaultSettings(), settingsFromServer || {});
    return {
      settings: merged,
      arena: null,
      spawns: { A: new THREE.Vector3(), B: new THREE.Vector3() },
      players: { host: null, client: null },
      otherMesh: null,
      hud: mkHudRefs(),
      lastTs: 0,
      loopHandle: 0,
      inputArmed: false,
      inputEnabled: false,
      remoteInputLatest: null,
      playerNumber: 0,
      bannerTimerRef: { id: 0 },
      countdownTimerRef: { id: 0 },
      match: {
        player1Wins: 0,
        player2Wins: 0,
        toWin: merged.roundsToWin || 2,
        roundActive: false
      }
    };
  }

  function ensureOtherPlayerMesh(color) {
    color = color || 0x55aaff;
    var group = new THREE.Group();
    var bodyMat = new THREE.MeshLambertMaterial({ color: color });
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
    head.position.set(0, 1.6, 0);
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 16), bodyMat);
    torso.position.set(0, 1.1, 0);
    var gun = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    gun.position.set(0.35, 1.4, -0.1);
    group.add(head, torso, gun);
    group.scale.set(1.5, 1.5, 1.5);
    scene.add(group);
    try {
      group.position.set(0, 0, 0);
      var bbox = new THREE.Box3().setFromObject(group);
      group._meshFeetOffset = -bbox.min.y; // add to feetY to get mesh.position.y
      group.position.y = GROUND_Y + group._meshFeetOffset;
      // Compute hitbox from actual mesh geometry
      var center = bbox.getCenter(new THREE.Vector3());
      group._hitCenterY = center.y;
      var size = bbox.getSize(new THREE.Vector3());
      group._hitRadius = Math.max(size.x, size.z) * 0.5;
    } catch {}
    return group;
  }

  function placePlayersAtSpawns() {
    var A = state.spawns.A;
    var B = state.spawns.B;
    var eyeY = GROUND_Y + EYE_HEIGHT;

    if (isHost) {
      state.players.host.position.copy(A); state.players.host.position.y = eyeY;
      state.players.client.position.copy(B); state.players.client.position.y = eyeY;
      camera.position.copy(A); camera.position.y = eyeY;
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.lookAt(new THREE.Vector3(B.x, eyeY, B.z));
    } else {
      camera.position.copy(B);
      camera.position.y = eyeY;
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

    // Use mesh-computed hitbox center and radius
    var tarPos = null;
    var hitRadius = 0.6;
    if (other && state.otherMesh) {
      var meshHitCenterY = (typeof state.otherMesh._hitCenterY === 'number') ? state.otherMesh._hitCenterY : (GROUND_Y + EYE_HEIGHT);
      tarPos = new THREE.Vector3(other.position.x, meshHitCenterY, other.position.z);
      hitRadius = (typeof state.otherMesh._hitRadius === 'number') ? state.otherMesh._hitRadius : 0.6;
    } else if (other) {
      tarPos = other.position.clone();
    }

    var hit = fireHitscan(origin, dir, {
      solids: state.arena.solids,
      playerTarget: tarPos ? { position: tarPos, radius: hitRadius } : null,
      tracerColor: isLocalPlayer(p) ? 0x66ffcc : 0x66aaff,
      maxDistance: 200
    });

    if (isHost && socket && hit && hit.point) {
      try {
        socket.emit('shot', {
          o: [origin.x, origin.y, origin.z],
          e: [hit.point.x, hit.point.y, hit.point.z],
          c: isLocalPlayer(p) ? 0x66ffcc : 0x66aaff
        });
      } catch {}
    }

    if (hit.hit && hit.hitType === 'player' && other && other.alive) {
      if (window.devGodMode && isLocalPlayer(other)) {
        // God mode: skip damage for local player
      } else {
        other.health = Math.max(0, other.health - state.settings.playerDamage);
        if (isLocalPlayer(other)) updateHUDForPlayer(other);
        if (isHost && state.match && state.match.roundActive && other.health <= 0) {
          other.alive = false;
          endRound((p === state.players.host) ? 'p1' : 'p2');
        }
      }
    }

    w.ammo--;
    w.lastShotTime = now;
    if (isLocalPlayer(p)) updateHUDForPlayer(p);
    if (w.ammo <= 0) {
      if (sharedStartReload(w, now)) {
        if (isLocalPlayer(p)) sharedSetReloadingUI(true, state.hud.reloadIndicator);
      }
    }
  }

  function simulateHostTick(dt) {
    var localInput = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false };
    var enabledLocal = !!state.inputEnabled;
    state.players.host.input.moveX = enabledLocal ? (localInput.moveX || 0) : 0;
    state.players.host.input.moveZ = enabledLocal ? (localInput.moveZ || 0) : 0;
    state.players.host.input.sprint = enabledLocal && !!localInput.sprint;
    state.players.host.input.jump = enabledLocal && !!localInput.jump;
    state.players.host.input.fireDown = enabledLocal && !!localInput.fireDown;
    if (enabledLocal && localInput.reloadPressed) state.players.host.input.reloadPressed = true;

    sharedSetCrosshairBySprint(!!localInput.sprint);
    sharedSetSprintUI(!!localInput.sprint, state.hud.sprintIndicator);

    // Host player physics via updateFullPhysics
    updateFullPhysics(
      state.players.host,
      { moveX: state.players.host.input.moveX, moveZ: state.players.host.input.moveZ, sprint: state.players.host.input.sprint, jump: state.players.host.input.jump },
      { colliders: state.arena.colliders, solids: state.arena.solids },
      dt
    );
    camera.position.copy(state.players.host.position);

    // Remote input
    var ri = state.remoteInputLatest || {};
    var activeRound = !!(state.match && state.match.roundActive);
    state.players.client.input.moveX = activeRound ? (ri.moveX || 0) : 0;
    state.players.client.input.moveZ = activeRound ? (ri.moveZ || 0) : 0;
    state.players.client.input.sprint = activeRound && !!ri.sprint;
    state.players.client.input.jump = activeRound && !!ri.jump;
    state.players.client.input.fireDown = activeRound && !!ri.fireDown;
    if (activeRound && ri.reloadPressed) state.players.client.input.reloadPressed = true;

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

    // Update other mesh position using feetY
    if (state.otherMesh) {
      state.otherMesh.position.x = state.players.client.position.x;
      state.otherMesh.position.z = state.players.client.position.z;
      var meshOffset = (typeof state.otherMesh._meshFeetOffset === 'number') ? state.otherMesh._meshFeetOffset : 0;
      state.otherMesh.position.y = state.players.client.feetY + meshOffset;
      var toHost = state.players.host.position.clone().sub(state.players.client.position);
      state.otherMesh.rotation.set(0, Math.atan2(toHost.x, toHost.z), 0);
    }

    maybeSendSnapshot(now);
  }

  var lastSnapshotMs = 0;
  function maybeSendSnapshot(nowMs) {
    if (!socket) return;
    if ((nowMs - lastSnapshotMs) < 50) return;
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
  var LERP_RATE = 0.3; // how aggressively to snap toward server position per snapshot

  function applySnapshotOnClient(snap) {
    if (!snap) return;
    var H = snap.host;
    if (H && state.otherMesh) {
      state.otherMesh.position.x = H.pos[0];
      state.otherMesh.position.z = H.pos[2];
      var meshOffset = (typeof state.otherMesh._meshFeetOffset === 'number') ? state.otherMesh._meshFeetOffset : 0;
      var hostFeetY = (typeof H.feetY === 'number') ? H.feetY : GROUND_Y;
      state.otherMesh.position.y = hostFeetY + meshOffset;
    }

    var C = snap.client;
    if (C) {
      // Reconcile: lerp predicted position toward authoritative server position
      var serverPos = new THREE.Vector3(C.pos[0], C.pos[1], C.pos[2]);
      var serverFeetY = (typeof C.feetY === 'number') ? C.feetY : GROUND_Y;
      var serverGrounded = (typeof C.grounded === 'boolean') ? C.grounded : true;

      if (_predictedPos) {
        var diff = serverPos.clone().sub(_predictedPos);
        if (diff.lengthSq() > 25) {
          // Too far off — snap directly
          _predictedPos.copy(serverPos);
          _predictedFeetY = serverFeetY;
          _predictedGrounded = serverGrounded;
          _predictedVVel = 0;
        } else {
          // Smooth correction
          _predictedPos.lerp(serverPos, LERP_RATE);
          _predictedFeetY += (serverFeetY - _predictedFeetY) * LERP_RATE;
          _predictedGrounded = serverGrounded;
        }
        camera.position.copy(_predictedPos);
      } else {
        _predictedPos = serverPos.clone();
        _predictedFeetY = serverFeetY;
        _predictedGrounded = serverGrounded;
        _predictedVVel = 0;
        camera.position.copy(serverPos);
      }

      var localP = state.players.client;
      if (localP) {
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

    var dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    if (isHost) {
      simulateHostTick(dt);
    } else {
      var input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, jump: false, fireDown: false, reloadPressed: false };
      var forward = new THREE.Vector3();
      if (camera && camera.getWorldDirection) camera.getWorldDirection(forward);

      // Client-side prediction: apply movement + vertical physics locally
      if (_predictedPos && state.inputEnabled) {
        var fwd = forward.clone();
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        var right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
        var moveDir = new THREE.Vector3();
        moveDir.addScaledVector(fwd, input.moveZ || 0);
        moveDir.addScaledVector(right, input.moveX || 0);
        if (moveDir.lengthSq() > 1e-6) moveDir.normalize(); else moveDir.set(0, 0, 0);

        var speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        _predictedPos.x += moveDir.x * speed * dt;
        _predictedPos.z += moveDir.z * speed * dt;

        // Vertical physics prediction
        var solids = (state.arena && state.arena.solids) ? state.arena.solids : [];
        var groundH = getGroundHeight(_predictedPos, solids, _predictedFeetY, _predictedGrounded);

        if (input.jump && _predictedGrounded) {
          _predictedVVel = JUMP_VELOCITY;
          _predictedGrounded = false;
        }
        if (!_predictedGrounded) {
          _predictedVVel += GRAVITY * dt;
          _predictedFeetY += _predictedVVel * dt;
          if (_predictedFeetY <= groundH) {
            _predictedFeetY = groundH;
            _predictedVVel = 0;
            _predictedGrounded = true;
          }
        } else {
          if (groundH < _predictedFeetY - MAX_STEP_HEIGHT) {
            _predictedGrounded = false;
            _predictedVVel = 0;
          } else {
            _predictedFeetY = groundH;
          }
        }

        _predictedPos.y = _predictedFeetY + EYE_HEIGHT;

        if (state.arena && state.arena.colliders) {
          resolveCollisions2D(_predictedPos, PLAYER_RADIUS, state.arena.colliders, _predictedFeetY);
        }
        camera.position.copy(_predictedPos);
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

      sharedSetCrosshairBySprint(!!input.sprint);
      sharedSetSprintUI(!!input.sprint, state.hud.sprintIndicator);
    }

    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public starts
  window.hostLanGame = function (roomId, settings, mapName) {
    if (!roomId || typeof roomId !== 'string') { alert('Please enter a Room ID'); return; }
    if (window.paintballActive) { try { stopPaintballInternal(); } catch {} }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch {} }

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
    if (window.paintballActive) { try { stopPaintballInternal(); } catch {} }
    if (window.multiplayerActive) { try { stopMultiplayerInternal(); } catch {} }

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
        showRoundBanner('Player 2 left', 1200);
        if (state) state.inputEnabled = false;
      }
    });

    socket.on('clientJoined', function () {
      if (!isHost || !state) return;
      showRoundBanner('Player 2 joined', 1000);
      resetEntitiesForRound();
      updateHUDForPlayer(state.players.host);
      startRoundCountdown(3);
      socket.emit('startRound', { seconds: 3 });
    });

    socket.on('input', function (payload) {
      if (!isHost) return;
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
      startRoundCountdown((payload && payload.seconds) || 3);
    });

    socket.on('roundResult', function (payload) {
      var winner = payload && payload.winner;
      if (!winner) return;
      showRoundBanner(winner === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!', 1200);
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
      if (!payload || !Array.isArray(payload.o) || !Array.isArray(payload.e)) return;
      var o = new THREE.Vector3(payload.o[0], payload.o[1], payload.o[2]);
      var e = new THREE.Vector3(payload.e[0], payload.e[1], payload.e[2]);
      var color = (typeof payload.c === 'number') ? payload.c : 0x66ffcc;
      if (typeof spawnTracer === 'function') {
        try { spawnTracer(o, e, color, 70); } catch {}
      }
    });
  }

  function startMultiplayerSession(settings, playerNumber, mapData) {
    state = newState(settings);
    state.arena = (mapData && typeof buildArenaFromMap === 'function')
      ? buildArenaFromMap(mapData)
      : (typeof buildArenaFromMap === 'function' ? buildArenaFromMap(getDefaultMapData()) : buildPaintballArenaSymmetric());
    state.spawns = state.arena.spawns;

    var eyeY = GROUND_Y + EYE_HEIGHT;
    var posA = state.spawns.A.clone(); posA.y = eyeY;
    var posB = state.spawns.B.clone(); posB.y = eyeY;
    state.players.host = newPlayer({ position: posA });
    state.players.client = newPlayer({ position: posB });

    setHUDVisible(true);
    showOnlyMenu(null);
    showMultiplayerHUD(true);
    setCrosshairDimmed(false);
    setCrosshairSpread(0);
    updateHUDForPlayer(isHost ? state.players.host : state.players.client);

    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    state.otherMesh = ensureOtherPlayerMesh(isHost ? 0x55aaff : 0xffaa55);
    placePlayersAtSpawns();

    // Initialize client-side prediction position
    if (!isHost) {
      _predictedPos = state.spawns.B.clone();
      _predictedPos.y = eyeY;
      _predictedFeetY = GROUND_Y;
      _predictedVVel = 0;
      _predictedGrounded = true;
    } else {
      _predictedPos = null;
    }

    state.playerNumber = playerNumber || (isHost ? 1 : 2);
    showRoundBanner('You are Player ' + state.playerNumber, 1200);

    if (isHost) {
      showRoundBanner('Waiting for Player 2...', 999999);
    }

    window.multiplayerActive = true;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  }

  window.stopMultiplayerInternal = function () {
    try { if (socket && currentRoomId) socket.emit('leaveRoom'); } catch {}
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch {}
      state.loopHandle = 0;
    }
    if (state) {
      if (state.otherMesh && state.otherMesh.parent) state.otherMesh.parent.remove(state.otherMesh);
      if (state.arena && state.arena.group && state.arena.group.parent) state.arena.group.parent.remove(state.arena.group);
      showMultiplayerHUD(false);
      setCrosshairDimmed(false);
      setCrosshairSpread(0);
    }
    _predictedPos = null;
    _predictedFeetY = GROUND_Y;
    _predictedVVel = 0;
    _predictedGrounded = true;
    window.multiplayerActive = false;
    state = null;
  };
})();
