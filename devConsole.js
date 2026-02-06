// Dev Console — password-protected cheat menu
(function () {
  var PASSWORD = 'devpower5';
  var authenticated = false;
  window.devAuthenticated = false;
  window.devGodMode = false;

  var consoleEl = document.getElementById('devConsole');
  var passwordView = document.getElementById('devPassword');
  var commandsView = document.getElementById('devCommands');
  var passwordInput = document.getElementById('devPasswordInput');
  var passwordSubmit = document.getElementById('devPasswordSubmit');
  var passwordError = document.getElementById('devPasswordError');

  // Cheat state
  var cheats = {
    godMode: false,
    unlimitedAmmo: false,
    spectator: false
  };

  var spectatorSavedY = null;
  var spectatorKeys = { w: false, a: false, s: false, d: false, space: false, shift: false };

  // Toggle console visibility
  function isConsoleOpen() {
    return consoleEl && !consoleEl.classList.contains('hidden');
  }

  function openConsole() {
    if (!consoleEl) return;
    window.devConsoleOpen = true;
    consoleEl.classList.remove('hidden');
    try { document.exitPointerLock(); } catch (e) {}
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
    if ((window.paintballActive || window.multiplayerActive) && renderer && renderer.domElement) {
      try { renderer.domElement.requestPointerLock(); } catch (e) {}
    }
  }

  // Global key listener for 'c'
  document.addEventListener('keydown', function (e) {
    if (e.key === 'c' || e.key === 'C') {
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

  passwordSubmit.addEventListener('click', tryPassword);
  passwordInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      tryPassword();
    }
    e.stopPropagation();
  });
  // Prevent key events in password input from reaching the game
  passwordInput.addEventListener('keyup', function (e) { e.stopPropagation(); });

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
    var state = window.getPaintballState ? window.getPaintballState() : null;

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
        spectatorSavedY = camera ? camera.position.y : 2;
      } else if (camera && spectatorSavedY !== null) {
        camera.position.y = spectatorSavedY;
        spectatorSavedY = null;
      }
    } else if (cmd === 'killEnemy') {
      if (state && state.ai && state.ai.alive) {
        state.ai.takeDamage(9999);
        if (!state.ai.alive && window.endPaintballRound) {
          window.endPaintballRound('player');
        }
      }
    } else if (cmd === 'heal') {
      if (state && state.player) {
        state.player.health = 100;
        state.player.alive = true;
      }
    } else if (cmd === 'mapEditor') {
      closeConsole();
      if (typeof window.startMapEditor === 'function') {
        window.startMapEditor();
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

    var state = window.getPaintballState ? window.getPaintballState() : null;

    if (state) {
      // God mode: prevent health from dropping below 1
      if (cheats.godMode && state.player) {
        if (state.player.health < 1) state.player.health = 1;
        state.player.alive = true;
      }

      // Unlimited ammo: refill every frame
      if (cheats.unlimitedAmmo && state.player && state.player.weapon) {
        state.player.weapon.ammo = state.player.weapon.magSize;
        state.player.weapon.reloading = false;
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

    requestAnimationFrame(cheatLoop);
  }
  requestAnimationFrame(cheatLoop);
})();
