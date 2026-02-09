// Shared game utilities used by both Paintball (AI) and LAN Multiplayer modes.
// Eliminates duplication of HUD helpers, round flow, crosshair, and reload logic.

(function () {

  // ========== Crosshair / Spread UI ==========

  function spreadRadToPx(spreadRad) {
    const fov = (camera && camera.isPerspectiveCamera) ? camera.fov : 75;
    const fovRad = fov * Math.PI / 180;
    const focalPx = (window.innerHeight / 2) / Math.tan(fovRad / 2);
    const px = Math.tan(Math.max(0, spreadRad)) * focalPx;
    return Math.max(0, Math.min(60, px));
  }

  window.sharedSetCrosshairBySprint = function (sprinting, sprintSpreadRad) {
    if (typeof sprintSpreadRad !== 'number') sprintSpreadRad = 0.012;
    const spread = sprinting ? sprintSpreadRad : 0;
    setCrosshairSpread(spreadRadToPx(spread));
  };

  // Toggle reload indicator + crosshair dimming
  window.sharedSetReloadingUI = function (isReloading, reloadIndicatorEl) {
    if (reloadIndicatorEl) {
      reloadIndicatorEl.classList.toggle('hidden', !isReloading);
    }
    setCrosshairDimmed(isReloading);
  };

  // Toggle sprint indicator
  window.sharedSetSprintUI = function (sprinting, sprintIndicatorEl) {
    if (sprintIndicatorEl) {
      sprintIndicatorEl.classList.toggle('hidden', !sprinting);
    }
  };

  // ========== Round Flow & Timing ==========

  // Show a text banner for `ms` milliseconds.
  // bannerEl: the DOM element to show
  // timerRef: an object like { id: 0 } to track the timeout (prevents stacking)
  window.sharedShowRoundBanner = function (text, bannerEl, timerRef, ms) {
    ms = ms || 1200;
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.classList.remove('hidden');
    if (timerRef.id) {
      try { clearTimeout(timerRef.id); } catch (e) { console.warn('clearTimeout failed:', e); }
      timerRef.id = 0;
    }
    timerRef.id = setTimeout(function () {
      if (!timerRef || timerRef.id === null) return;
      bannerEl.classList.add('hidden');
      timerRef.id = 0;
    }, ms);
  };

  // Runs a 3-2-1-GO countdown with callbacks.
  // opts.seconds       - countdown duration (default 3)
  // opts.countdownEl   - DOM element to display numbers
  // opts.timerRef      - object like { id: 0 } for setInterval tracking
  // opts.onStart()     - called immediately (lock input, reset weapons, etc.)
  // opts.onReady()     - called when countdown finishes (enable input)
  window.sharedStartRoundCountdown = function (opts) {
    var seconds = opts.seconds || 3;
    var el = opts.countdownEl;

    if (opts.onStart) opts.onStart();

    if (!el) {
      setTimeout(function () {
        if (opts.onReady) opts.onReady();
      }, seconds * 1000);
      return;
    }

    var remain = Math.max(1, Math.floor(seconds));
    el.classList.remove('hidden');
    el.textContent = String(remain);

    if (opts.timerRef && opts.timerRef.id) {
      try { clearInterval(opts.timerRef.id); } catch (e) { console.warn('clearInterval failed:', e); }
      opts.timerRef.id = 0;
    }

    var timer = setInterval(function () {
      if (opts.timerRef && opts.timerRef.id === null) return;
      remain -= 1;
      if (remain > 0) {
        el.textContent = String(remain);
      } else {
        el.textContent = 'GO!';
        setTimeout(function () { el.classList.add('hidden'); }, 1000);
        try { clearInterval(timer); } catch (e) { console.warn('clearInterval failed:', e); }
        if (opts.timerRef) opts.timerRef.id = 0;
        if (opts.onReady) opts.onReady();
      }
    }, 1000);

    if (opts.timerRef) opts.timerRef.id = timer;
  };

  // ========== Weapon State Machine ==========

  // Check if a reload just finished and reset weapon state. Returns true if reload completed.
  window.sharedHandleReload = function (weapon, now) {
    if (weapon.reloading && now >= weapon.reloadEnd) {
      weapon.reloading = false;
      weapon.ammo = weapon.magSize;
      return true;
    }
    return false;
  };

  // Start a reload if not already reloading and magazine isn't full.
  window.sharedStartReload = function (weapon, now) {
    if (weapon.reloading || weapon.ammo >= weapon.magSize) return false;
    weapon.reloading = true;
    weapon.reloadEnd = now + (weapon.reloadTimeSec || 2.5) * 1000;
    return true;
  };

  // Check whether a weapon is ready to fire (not reloading, has ammo, cooldown elapsed).
  window.sharedCanShoot = function (weapon, now, cooldownMs) {
    return !weapon.reloading && weapon.ammo > 0 && (now - weapon.lastShotTime) >= cooldownMs;
  };

  // ========== HUD Rendering ==========

  // Update a health bar fill element (width %) given current and max health.
  window.sharedUpdateHealthBar = function (fillEl, current, max) {
    if (!fillEl) return;
    current = Number(current) || 0;
    max = Number(max) || 1;
    var pct = Math.max(0, Math.min(100, (current / Math.max(1, max)) * 100));
    fillEl.style.width = pct + '%';
  };

  // Update ammo display text.
  window.sharedUpdateAmmoDisplay = function (ammoEl, current, magSize) {
    if (!ammoEl) return;
    ammoEl.textContent = current + '/' + magSize;
  };

})();
