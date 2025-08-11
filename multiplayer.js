/**
 * Multiplayer (LAN) module
 * - Host-authoritative 2-player mode using Socket.IO
 * - Host sets room settings: fire rate, mag size, reload time, player health, player damage
 * - Second player spawns at the AI spawn point (spawn B)
 * - AI is disabled in multiplayer
 *
 * Requires:
 *  - server.js running with Express + Socket.IO
 *  - <script src="/socket.io/socket.io.js"></script> included
 */

(function () {
  // Public flag
  window.multiplayerActive = false;

  // Constants
  const PLAYER_RADIUS = 0.5;
  const WALK_SPEED = 4.5;
  const SPRINT_SPEED = 8.5;

  // Alignment constants to match visible models and camera eye
  const EYE_WORLD_Y = 0.85;          // world Y for player eye/camera (near top of model head)
  const MODEL_CENTER_OFFSET = 1.1;   // approx model center above ground for hitbox when mesh is available
  const HIT_RADIUS = 0.6;            // spherical hitbox radius to match model torso

  // State
  let socket = null;
  let isHost = false;
  let currentRoomId = null;
  let hostId = null;

  let state = null;

  function defaultSettings() {
    return {
      fireCooldownMs: 166,
      magSize: 6,
      reloadTimeSec: 2.5,
      playerHealth: 100,
      playerDamage: 20,
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

  function spreadRadToPx(spreadRad) {
    const fov = (camera && camera.isPerspectiveCamera) ? camera.fov : 75;
    const fovRad = fov * Math.PI / 180;
    const focalPx = (window.innerHeight / 2) / Math.tan(fovRad / 2);
    const px = Math.tan(Math.max(0, spreadRad)) * focalPx;
    return Math.max(0, Math.min(60, px));
  }
  function setCrosshairBySprint(sprinting) {
    const SPRINT_SPREAD_BONUS_RAD = 0.012;
    const spread = sprinting ? SPRINT_SPREAD_BONUS_RAD : 0;
    setCrosshairSpread(spreadRadToPx(spread));
  }

  // Round UI helpers and flow (host authoritative)
  function showRoundBanner(text, ms = 1200) {
    const el = state && state.hud && state.hud.bannerEl;
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    if (state._bannerTimer) { try { clearTimeout(state._bannerTimer); } catch {} }
    state._bannerTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, ms);
  }

  function startRoundCountdown(seconds = 3) {
    if (!state) return;
    // Lock input and round state during countdown
    state.inputEnabled = false;
    if (state.match) state.match.roundActive = false;
    state.inputArmed = false;

    // Buffer to prevent instant shots after countdown
    const now = performance.now();
    if (state.players && state.players.host && state.players.host.weapon) {
      state.players.host.weapon.lastShotTime = now + 300;
    }
    if (state.players && state.players.client && state.players.client.weapon) {
      state.players.client.weapon.lastShotTime = now + 300;
    }

    const el = state && state.hud && state.hud.countdownEl;
    if (!el) {
      setTimeout(() => {
        state.inputEnabled = true;
        if (state.match) state.match.roundActive = true;
      }, seconds * 1000);
      return;
    }

    let remain = Math.max(1, Math.floor(seconds));
    el.classList.remove('hidden');
    el.textContent = String(remain);

    if (state._countdownTimer) { try { clearInterval(state._countdownTimer); } catch {} }
    state._countdownTimer = setInterval(() => {
      remain -= 1;
      if (remain > 0) {
        el.textContent = String(remain);
      } else {
        el.textContent = 'GO!';
        setTimeout(() => { el.classList.add('hidden'); }, 1000);
        try { clearInterval(state._countdownTimer); } catch {}
        state._countdownTimer = 0;
        state.inputEnabled = true;
        if (state.match) state.match.roundActive = true;
      }
    }, 1000);
  }

  function resetEntitiesForRound() {
    if (!state) return;
    // Place at spawns
    const A = state.spawns.A;
    const B = state.spawns.B;

    state.players.host.position.copy(A); state.players.host.position.y = EYE_WORLD_Y;
    state.players.client.position.copy(B); state.players.client.position.y = EYE_WORLD_Y;

    // Face toward the other spawn for the host camera
    camera.position.copy(A);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.lookAt(B);

    // Reset stats
    const s = state.settings;
    const h = state.players.host;
    const c = state.players.client;
    [h, c].forEach(p => {
      p.health = s.playerHealth;
      p.alive = true;
      p.weapon.ammo = p.weapon.magSize;
      p.weapon.reloading = false;
      p.weapon.reloadEnd = 0;
      p.weapon.lastShotTime = 0;
    });

    updateHUDForPlayer(isHost ? h : c);
  }

  function endRound(who) {
    if (!state || !state.match) return;
    state.match.roundActive = false;

    if (who === 'p1') state.match.player1Wins++;
    else if (who === 'p2') state.match.player2Wins++;

    const wText = who === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!';
    showRoundBanner(wText, 1200);
    if (socket) socket.emit('roundResult', { winner: who, score: { p1: state.match.player1Wins, p2: state.match.player2Wins } });

    // Match end?
    if (state.match.player1Wins >= state.match.toWin || state.match.player2Wins >= state.match.toWin) {
      if (socket) socket.emit('matchOver', { p1: state.match.player1Wins, p2: state.match.player2Wins });
      const finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) {
        finalScoreEl.textContent = `Player 1 ${state.match.player1Wins} - ${state.match.player2Wins} Player 2`;
      }
      window.stopMultiplayerInternal();
      showOnlyMenu('resultMenu');
      setHUDVisible(false);
      return;
    }

    // Next round
    setTimeout(() => {
      resetEntitiesForRound();
      updateHUDForPlayer(isHost ? state.players.host : state.players.client);
      startRoundCountdown(3);
      if (socket) socket.emit('startRound', { seconds: 3 });
    }, 1200);
  }

  function showMultiplayerHUD(show) {
    const hud = state && state.hud;
    if (!hud) return;
    if (hud.healthContainer) hud.healthContainer.classList.toggle('hidden', !show);
  }

  function updateHUDForPlayer(p) {
    if (!state) return;
    if (state.hud.healthFill) {
      const clamped = Math.max(0, Math.min(100, (p.health / Math.max(1, state.settings.playerHealth)) * 100));
      state.hud.healthFill.style.width = `${clamped}%`;
    }
    if (state.hud.ammoDisplay) {
      state.hud.ammoDisplay.textContent = `${p.weapon.ammo}/${p.weapon.magSize}`;
    }
  }

  function newPlayer(opts) {
    const s = state.settings;
    return {
      position: (opts && opts.position) ? opts.position.clone() : new THREE.Vector3(),
      yaw: (opts && typeof opts.yaw === 'number') ? opts.yaw : 0,
      pitch: (opts && typeof opts.pitch === 'number') ? opts.pitch : 0,
      walkSpeed: WALK_SPEED,
      sprintSpeed: SPRINT_SPEED,
      radius: PLAYER_RADIUS,
      health: s.playerHealth,
      alive: true,
      input: { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false, forward: new THREE.Vector3(0, 0, -1) },
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
    return {
      settings: { ...defaultSettings(), ...(settingsFromServer || {}) },
      arena: null,
      spawns: { A: new THREE.Vector3(), B: new THREE.Vector3() },
      // Players: host and client representations
      players: {
        host: null,   // exists on host sim; visible as mesh on client
        client: null, // exists on host sim; camera on client follows this
      },
      // Rendering meshes for "the other player"
      otherMesh: null,
      hud: mkHudRefs(),
      lastTs: 0,
      loopHandle: 0,
      inputArmed: false,
      inputEnabled: false,
      // For host: last input received from client
      remoteInputLatest: null,
      // Multiplayer metadata
      playerNumber: 0,
      // Match state (best of 3 by default)
      match: {
        player1Wins: 0,
        player2Wins: 0,
        toWin: 2,
        roundActive: false
      }
    };
  }

  function ensureOtherPlayerMesh(color = 0x55aaff) {
    // Simple humanoid-like shape
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
    head.position.set(0, 1.6, 0);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 16), bodyMat);
    torso.position.set(0, 1.1, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    gun.position.set(0.35, 1.4, -0.1);
    group.add(head, torso, gun);
    group.scale.set(1.5, 1.5, 1.5);
    scene.add(group);
    // Precompute ground alignment so the mesh sits on the floor (y = -1)
    try {
      const bbox = new THREE.Box3().setFromObject(group);
      group._groundY = -1 - bbox.min.y;
      group.position.y = group._groundY;
    } catch {}
    return group;
  }

  function placePlayersAtSpawns() {
    const A = state.spawns.A;
    const B = state.spawns.B;

    if (isHost) {
      // Host camera/player at A, client at B (AI spawn)
      state.players.host.position.copy(A);
      state.players.host.position.y = EYE_WORLD_Y;
      state.players.host.yaw = 0;
      state.players.host.pitch = 0;

      state.players.client.position.copy(B);
      state.players.client.position.y = EYE_WORLD_Y;
      state.players.client.yaw = Math.PI; // face toward A
      state.players.client.pitch = 0;

      // Place camera at eye height
      camera.position.copy(A);
      camera.position.y = EYE_WORLD_Y;
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.lookAt(new THREE.Vector3(B.x, EYE_WORLD_Y, B.z));
    } else {
      // Client camera follows client snapshot; until first snapshot, park at spawn B
      camera.position.copy(B.clone().add(new THREE.Vector3(0, 2, 0)));
      camera.rotation.set(0, Math.PI, 0, 'YXZ');
    }
  }

  function applyCollisionsFor(p) {
    resolveCollisions2D(p.position, p.radius, state.arena.colliders);
  }

  function handleReload(p, now) {
    const w = p.weapon;
    if (w.reloading && now >= w.reloadEnd) {
      w.reloading = false;
      w.ammo = w.magSize;
      if (isLocalPlayer(p)) setReloadingUI(false);
    }
  }

  function isLocalPlayer(p) {
    // Local camera's player is: host -> players.host, client -> players.client
    return (isHost && p === state.players.host) || (!isHost && p === state.players.client);
  }

  function handleShooting(p, now) {
    const w = p.weapon;
    const inp = p.input;
    if (inp.reloadPressed) {
      if (!w.reloading && w.ammo < w.magSize) {
        w.reloading = true;
        w.reloadEnd = now + w.reloadTimeSec * 1000;
        if (isLocalPlayer(p)) setReloadingUI(true);
      }
      inp.reloadPressed = false;
      return;
    }
    if (w.reloading) return;
    if (!inp.fireDown) return;
    if ((now - w.lastShotTime) < w.cooldownMs) return;
    if (w.ammo <= 0) {
      w.reloading = true;
      w.reloadEnd = now + w.reloadTimeSec * 1000;
      if (isLocalPlayer(p)) setReloadingUI(true);
      return;
    }

    // Determine direction
    let dir;
    if (isLocalPlayer(p) && isHost) {
      // Host local: use camera
      dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
    } else {
      // Use provided forward vector from input (client) or stored yaw/pitch if needed
      if (inp.forward && inp.forward.isVector3) {
        dir = inp.forward.clone().normalize();
      } else if (inp.forward && Array.isArray(inp.forward) && inp.forward.length === 3) {
        dir = new THREE.Vector3(inp.forward[0], inp.forward[1], inp.forward[2]).normalize();
      } else {
        dir = new THREE.Vector3(0, 0, -1);
      }
    }

    // Fire hitscan from eye height
    // Use camera position for the local shooter to avoid "above head" visuals
    const EYE_OFFSET_REMOTE = 1.0;
    const origin = isLocalPlayer(p)
      ? camera.position.clone().add(dir.clone().multiplyScalar(0.2)).add(new THREE.Vector3(0, -0.05, 0))
      : p.position.clone().add(dir.clone().multiplyScalar(0.2)).add(new THREE.Vector3(0, -0.05, 0));
    const other = (p === state.players.host) ? state.players.client : state.players.host;

    // Build target center aligned with visible mesh when available, else use the other player's eye position
    let tarPos = null;
    if (other) {
      // If host is shooting client and we have the client mesh, center hitbox on model center
      if (p === state.players.host && state.otherMesh && typeof state.otherMesh._groundY === 'number') {
        tarPos = new THREE.Vector3(other.position.x, state.otherMesh._groundY + MODEL_CENTER_OFFSET, other.position.z);
      } else {
        tarPos = other.position.clone();
      }
    }

    const hit = fireHitscan(origin, dir, {
      solids: state.arena.solids,
      playerTarget: tarPos ? { position: tarPos, radius: HIT_RADIUS } : null,
      tracerColor: isLocalPlayer(p) ? 0x66ffcc : 0x66aaff,
      maxDistance: 200
    });

    // Relay shot for remote tracer rendering (host -> client)
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
      other.health = Math.max(0, other.health - state.settings.playerDamage);
      if (isLocalPlayer(other)) {
        // Local took damage: update HUD immediately
        updateHUDForPlayer(other);
      }
      // Host decides round outcome
      if (isHost && state.match && state.match.roundActive && other.health <= 0) {
        other.alive = false;
        const winner = (p === state.players.host) ? 'p1' : 'p2';
        endRound(winner);
      }
    }

    w.ammo--;
    w.lastShotTime = now;
    if (isLocalPlayer(p)) updateHUDForPlayer(p);
    if (w.ammo <= 0) {
      w.reloading = true;
      w.reloadEnd = now + w.reloadTimeSec * 1000;
      if (isLocalPlayer(p)) setReloadingUI(true);
    }
  }

  function simulateHostTick(dt) {
    // Read local input for host
    const localInput = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };
    const enabledLocal = !!state.inputEnabled;
    state.players.host.input.moveX = enabledLocal ? (localInput.moveX || 0) : 0;
    state.players.host.input.moveZ = enabledLocal ? (localInput.moveZ || 0) : 0;
    state.players.host.input.sprint = enabledLocal && !!localInput.sprint;
    state.players.host.input.fireDown = enabledLocal && !!localInput.fireDown;
    if (enabledLocal && localInput.reloadPressed) state.players.host.input.reloadPressed = true;

    // Update crosshair/sprint UI for local
    setCrosshairBySprint(!!localInput.sprint);
    setSprintUI(!!localInput.sprint);

    // Move host player
    updateXZPhysics(
      state.players.host,
      { moveX: state.players.host.input.moveX, moveZ: state.players.host.input.moveZ, sprint: state.players.host.input.sprint },
      { colliders: state.arena.colliders },
      dt
    );
    applyCollisionsFor(state.players.host);
    // Host camera follows host player position
    camera.position.copy(state.players.host.position);

    // Remote input (last received)
    const ri = state.remoteInputLatest || {};
    // Gate remote inputs on round active to avoid movement/shooting before countdown ends
    const activeRound = !!(state.match && state.match.roundActive);
    state.players.client.input.moveX = activeRound ? (ri.moveX || 0) : 0;
    state.players.client.input.moveZ = activeRound ? (ri.moveZ || 0) : 0;
    state.players.client.input.sprint = activeRound && !!ri.sprint;
    state.players.client.input.fireDown = activeRound && !!ri.fireDown;
    if (activeRound && ri.reloadPressed) state.players.client.input.reloadPressed = true;

    // Client forward
    if (ri.forward && Array.isArray(ri.forward) && ri.forward.length === 3) {
      state.players.client.input.forward = new THREE.Vector3(ri.forward[0], ri.forward[1], ri.forward[2]);
    }

    // Move client player in host sim using the client's forward vector (not the host camera)
    (function moveClientWithForward() {
      const inp = state.players.client.input;
      // Build movement basis from client's reported forward
      let fwd = (inp.forward && inp.forward.isVector3) ? inp.forward.clone() :
                (Array.isArray(inp.forward) && inp.forward.length === 3 ? new THREE.Vector3(inp.forward[0], inp.forward[1], inp.forward[2]) :
                 new THREE.Vector3(0, 0, -1));
      // Flatten to XZ
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

      const moveZ = inp.moveZ || 0;
      const moveX = inp.moveX || 0;

      const dir = new THREE.Vector3();
      dir.addScaledVector(fwd, moveZ);
      dir.addScaledVector(right, moveX);
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        const speed = inp.sprint ? state.players.client.sprintSpeed : state.players.client.walkSpeed;
        const delta = dir.multiplyScalar(speed * dt);
        state.players.client.position.add(delta);
      }

      resolveCollisions2D(state.players.client.position, state.players.client.radius, state.arena.colliders);
    })();

    // Shooting
    const now = performance.now();
    handleShooting(state.players.host, now);
    handleShooting(state.players.client, now);

    // Reload timers
    handleReload(state.players.host, now);
    handleReload(state.players.client, now);

    // Update "other" mesh (client avatar) for host to see
    if (state.otherMesh) {
      state.otherMesh.position.x = state.players.client.position.x;
      state.otherMesh.position.z = state.players.client.position.z;
      if (typeof state.otherMesh._groundY === 'number') {
        state.otherMesh.position.y = state.otherMesh._groundY;
      }
      const toHost = state.players.host.position.clone().sub(state.players.client.position);
      const yaw = Math.atan2(toHost.x, toHost.z); // face approximately toward host
      state.otherMesh.rotation.set(0, yaw, 0);
    }

    // Broadcast snapshot to client at ~20Hz
    maybeSendSnapshot(now);
  }

  let lastSnapshotMs = 0;
  function maybeSendSnapshot(nowMs) {
    if (!socket) return;
    if ((nowMs - lastSnapshotMs) < 50) return; // 20 Hz
    lastSnapshotMs = nowMs;

    const H = packPlayer(state.players.host);
    const C = packPlayer(state.players.client);

    socket.emit('snapshot', {
      roomId: currentRoomId,
      host: H,
      client: C,
      t: nowMs
    });
  }

  function packPlayer(p) {
    return {
      pos: [p.position.x, p.position.y, p.position.z],
      health: p.health,
      ammo: p.weapon.ammo,
      magSize: p.weapon.magSize,
      reloading: p.weapon.reloading,
      reloadEnd: p.weapon.reloadEnd,
      // Optional: include a rough forward for remote rendering if needed
    };
    // We do not send yaw/pitch because camera orientation on client follows input;
    // position is authoritative for reconciliation on client.
  }

  function applySnapshotOnClient(snap) {
    if (!snap) return;
    // Host avatar
    const H = snap.host;
    if (H && state.otherMesh) {
      state.otherMesh.position.x = H.pos[0];
      state.otherMesh.position.z = H.pos[2];
      if (typeof state.otherMesh._groundY === 'number') {
        state.otherMesh.position.y = state.otherMesh._groundY;
      }
    }

    // Client (local camera)
    const C = snap.client;
    if (C) {
      camera.position.set(C.pos[0], C.pos[1], C.pos[2]);
      // Keep current camera rotation (local feel); authoritative position from host
      // Update HUD
      const localP = state.players.client;
      if (localP) {
        localP.health = C.health;
        localP.weapon.ammo = C.ammo;
        localP.weapon.reloading = !!C.reloading;
        localP.weapon.reloadEnd = C.reloadEnd || 0;
        if (localP.weapon.reloading) setReloadingUI(true);
        else setReloadingUI(false);
        updateHUDForPlayer(localP);
      }
    }
  }

  function tick(ts) {
    if (!window.multiplayerActive || !state) return;

    const dt = state.lastTs ? Math.min(0.05, (ts - state.lastTs) / 1000) : 0;
    state.lastTs = ts;

    if (isHost) {
      simulateHostTick(dt);
    } else {
      // Client: read inputs and send to host; camera orientation drives forward vector
      const input = window.getInputState ? window.getInputState() : { moveX: 0, moveZ: 0, sprint: false, fireDown: false, reloadPressed: false };
      const forward = new THREE.Vector3();
      if (camera && camera.getWorldDirection) camera.getWorldDirection(forward);

      // Send inputs to host (can be ~every frame on LAN)
      // Always send inputs; host will gate on roundActive
      const enabledRemote = true;
      if (socket) {
        socket.emit('input', {
          roomId: currentRoomId,
          moveX: enabledRemote ? (input.moveX || 0) : 0,
          moveZ: enabledRemote ? (input.moveZ || 0) : 0,
          sprint: enabledRemote && !!input.sprint,
          fireDown: enabledRemote && !!input.fireDown,
          reloadPressed: enabledRemote && !!input.reloadPressed,
          forward: [forward.x, forward.y, forward.z],
          t: performance.now()
        });
      }

      // Crosshair + sprint UI locally (visual only)
      setCrosshairBySprint(!!input.sprint);
      setSprintUI(!!input.sprint);

      // Reload UI is driven by snapshot reloading flag
    }

    state.loopHandle = requestAnimationFrame(tick);
  }

  // Public starts
  window.hostLanGame = function hostLanGame(roomId, settings) {
    if (!roomId || typeof roomId !== 'string') {
      alert('Please enter a Room ID');
      return;
    }
    if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    }
    if (window.multiplayerActive) {
      try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
    }

    ensureSocket();

    socket.emit('createRoom', roomId, settings || {}, (res) => {
      if (!res || !res.ok) {
        alert(res && res.error ? res.error : 'Failed to create room');
        return;
      }
      isHost = true;
      currentRoomId = roomId;

      startMultiplayerSession(settings || {}, res.playerNumber || 1);
    });
  };

  window.joinLanGame = function joinLanGame(roomId) {
    if (!roomId || typeof roomId !== 'string') {
      alert('Please enter a Room ID');
      return;
    }
    if (window.paintballActive) {
      try { if (typeof stopPaintballInternal === 'function') stopPaintballInternal(); } catch {}
    }
    if (window.multiplayerActive) {
      try { if (typeof stopMultiplayerInternal === 'function') stopMultiplayerInternal(); } catch {}
    }

    ensureSocket();

    socket.emit('joinRoom', roomId, (res) => {
      if (!res || !res.ok) {
        alert(res && res.error ? res.error : 'Failed to join room');
        return;
      }
      isHost = false;
      currentRoomId = roomId;
      hostId = res.hostId || null;

      startMultiplayerSession(res.settings || {}, res.playerNumber || 2);
    });
  };

  function ensureSocket() {
    if (socket) return;
    if (typeof io !== 'function') {
      alert('Socket.IO client not found. Make sure the server is running and /socket.io/socket.io.js is included.');
      return;
    }
    socket = io();

    // Common handlers
    socket.on('roomClosed', () => {
      alert('Host left. Room closed.');
      stopMultiplayerInternal();
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });

    socket.on('clientLeft', () => {
      if (isHost) {
        // Keep room open; optionally notify
        showRoundBanner('Player 2 left', 1200);
        // Gate input until a new player joins
        if (state) state.inputEnabled = false;
      }
    });

    // Host-only: when a client joins, start the round countdown and broadcast
    socket.on('clientJoined', () => {
      if (!isHost || !state) return;
      showRoundBanner('Player 2 joined', 1000);
      resetEntitiesForRound();
      updateHUDForPlayer(state.players.host);
      startRoundCountdown(3);
      socket.emit('startRound', { seconds: 3 });
    });

    // Host-only: receive client inputs
    socket.on('input', (payload) => {
      if (!isHost) return;
      state.remoteInputLatest = payload || {};
    });

    // Client-only: receive snapshots
    socket.on('snapshot', (payload) => {
      if (isHost) return;
      applySnapshotOnClient(payload);
    });

    socket.on('settings', (s) => {
      if (!isHost && state) {
        state.settings = { ...state.settings, ...(s || {}) };
      }
    });

    // Round control relays from host
    socket.on('startRound', (payload) => {
      startRoundCountdown((payload && payload.seconds) || 3);
    });

    socket.on('roundResult', (payload) => {
      const winner = payload && payload.winner;
      if (!winner) return;
      const text = winner === 'p1' ? 'Player 1 wins the round!' : 'Player 2 wins the round!';
      showRoundBanner(text, 1200);
    });

    socket.on('matchOver', (payload) => {
      const p1 = (payload && payload.p1) || 0;
      const p2 = (payload && payload.p2) || 0;
      const finalScoreEl = document.getElementById('finalScore');
      if (finalScoreEl) {
        finalScoreEl.textContent = `Player 1 ${p1} - ${p2} Player 2`;
      }
      window.stopMultiplayerInternal();
      showOnlyMenu('resultMenu');
      setHUDVisible(false);
    });

    // Tracer rendering from host shots (client-side)
    socket.on('shot', (payload) => {
      if (isHost) return; // server only relays to non-hosts, but guard anyway
      if (!payload || !Array.isArray(payload.o) || !Array.isArray(payload.e)) return;
      const o = new THREE.Vector3(payload.o[0], payload.o[1], payload.o[2]);
      const e = new THREE.Vector3(payload.e[0], payload.e[1], payload.e[2]);
      const color = (typeof payload.c === 'number') ? payload.c : 0x66ffcc;
      if (typeof spawnTracer === 'function') {
        try { spawnTracer(o, e, color, 70); } catch {}
      }
    });
  }

  function startMultiplayerSession(settings, playerNumber) {
    state = newState(settings);

    // Build arena and spawns
    state.arena = buildPaintballArenaSymmetric();
    state.spawns = state.arena.spawns;

    // Prepare players on host sim (set eye/capsule center to y=2 for both)
    const posA = state.spawns.A.clone(); posA.y = 2;
    const posB = state.spawns.B.clone(); posB.y = 2;
    state.players.host = newPlayer({ position: posA });
    state.players.client = newPlayer({ position: posB });

    // Show HUD and lock pointer
    setHUDVisible(true);
    showOnlyMenu(null);
    showMultiplayerHUD(true);
    setCrosshairDimmed(false);
    setCrosshairSpread(0);
    updateHUDForPlayer(isHost ? state.players.host : state.players.client);

    // Request pointer lock
    if (renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }

    // Place camera and other mesh
    if (isHost) {
      state.otherMesh = ensureOtherPlayerMesh(0x55aaff);
    } else {
      state.otherMesh = ensureOtherPlayerMesh(0xffaa55);
    }
    placePlayersAtSpawns();

    // Set player number and inform the player
    state.playerNumber = playerNumber || (isHost ? 1 : 2);
    showRoundBanner(`You are Player ${state.playerNumber}`, 1200);

    // Kick off round flow (host authoritative)
    if (isHost) {
      // Wait for a second player before starting the countdown
      // Show a persistent banner so the host knows we are waiting
      showRoundBanner('Waiting for Player 2...', 999999);
    }

    window.multiplayerActive = true;
    state.lastTs = 0;
    state.loopHandle = requestAnimationFrame(tick);
  }

  window.stopMultiplayerInternal = function stopMultiplayerInternal() {
    // Notify server we are leaving (host will close room; client will just leave)
    try {
      if (socket && currentRoomId) {
        socket.emit('leaveRoom');
      }
    } catch {}
    if (state && state.loopHandle) {
      try { cancelAnimationFrame(state.loopHandle); } catch {}
      state.loopHandle = 0;
    }

    if (state) {
      // Remove other mesh
      if (state.otherMesh && state.otherMesh.parent) {
        state.otherMesh.parent.remove(state.otherMesh);
      }
      // Remove arena
      if (state.arena && state.arena.group && state.arena.group.parent) {
        state.arena.group.parent.remove(state.arena.group);
      }
      showMultiplayerHUD(false);
      setCrosshairDimmed(false);
      setCrosshairSpread(0);
    }

    window.multiplayerActive = false;
    state = null;
  };

  // Convenience wrappers for UI module
  function setHUDVisible(visible) {
    const ui = document.getElementById('ui');
    const crosshair = document.getElementById('crosshair');
    if (ui) ui.classList.toggle('hidden', !visible);
    if (crosshair) crosshair.classList.toggle('hidden', !visible);
  }
  function showOnlyMenu(idOrNull) {
    const menus = document.querySelectorAll('.menu');
    menus.forEach(m => m.classList.add('hidden'));
    if (idOrNull) {
      const el = document.getElementById(idOrNull);
      if (el) el.classList.remove('hidden');
    }
  }
})();
