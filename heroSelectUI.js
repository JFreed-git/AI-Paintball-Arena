/**
 * heroSelectUI.js — Hero selection overlay UI
 *
 * PURPOSE: Manages the visual hero selection overlay — building hero cards,
 * handling clicks, running the countdown timer, and coordinating with game modes.
 * This is the UI layer. Hero DATA (stats, registry) lives in heroes.js.
 *
 * EXPORTS (window):
 *   showPreRoundHeroSelect(opts)  — show timed pre-round hero selection overlay
 *   closePreRoundHeroSelect()     — close overlay and clean up timer
 *   showHeroSelectWaiting()       — show "Waiting for opponent..." text (LAN)
 *   openHeroSelect()              — open overlay (training range, untimed)
 *   closeHeroSelect()             — close overlay (training range)
 *   isHeroSelectOpen()            — check if overlay is visible
 *   getCurrentHeroId()            — get currently selected hero id
 *   _heroSelectOpen               — boolean flag (read by other systems)
 *
 * DEPENDENCIES: heroes.js (HEROES, getHeroById), config.js (GAME_CONFIG)
 *
 * DESIGN NOTES:
 *   - Two modes of operation:
 *     1. Pre-round (timed): Used by AI and LAN modes before each round.
 *        showPreRoundHeroSelect() shows overlay with countdown, fires callbacks.
 *     2. Training (untimed): Toggled with 'H' key. No countdown, immediate apply.
 *   - Card rendering reads weapon stats from hero.weapon for display.
 *   - The actual hero application (stats, weapon swap) happens in heroes.js
 *     via applyHeroToPlayer(), called by the game mode after selection.
 *
 * TODO (future):
 *   - Display hero abilities on cards
 *   - Display hero stats (health, speed) on cards
 *   - Hero preview model on hover/select
 *   - Animated card transitions
 *   - Hero lock-in sound effect
 *   - Show opponent's pick in LAN (after both confirm)
 */

(function () {

  window._heroSelectOpen = false;

  var _currentHeroId = 'marksman';
  var _built = false;

  // Pre-round mode state
  var _preRoundMode = false;
  var _preRoundTimerRef = null;
  var _preRoundLockedIn = false;
  var _preRoundHasSelected = false;
  var _preRoundCallbacks = null;

  function buildOverlay() {
    if (_built) return;
    _built = true;

    var overlay = document.getElementById('heroSelectOverlay');
    if (!overlay) return;

    // Build hero cards from HEROES registry
    var heroes = window.HEROES || [];
    heroes.forEach(function (hero) {
      var card = document.createElement('div');
      card.className = 'hero-card';
      card.dataset.heroId = hero.id;

      var w = hero.weapon;
      card.innerHTML =
        '<h3>' + hero.name + '</h3>' +
        '<div class="hero-desc">' + hero.description + '</div>' +
        '<div class="hero-stats">' +
          'Damage: <span>' + w.damage + (w.pellets > 1 ? ' x' + w.pellets : '') + '</span><br>' +
          'Fire Rate: <span>' + Math.round(1000 / w.cooldownMs * 10) / 10 + '/s</span><br>' +
          'Mag: <span>' + w.magSize + '</span> | Reload: <span>' + w.reloadTimeSec + 's</span><br>' +
          'Range: <span>' + w.maxRange + 'm</span>' +
        '</div>';

      card.addEventListener('click', function () {
        if (_preRoundMode) {
          handlePreRoundCardClick(hero.id);
        } else if (typeof window._ffaRespawnHeroCallback === 'function') {
          _currentHeroId = hero.id;
          updateCardSelection();
          closeHeroSelect();
          window._ffaRespawnHeroCallback(hero.id);
        } else {
          selectHero(hero.id);
          closeHeroSelect();
        }
      });

      overlay.appendChild(card);
    });

    updateCardSelection();
  }

  function updateCardSelection() {
    var overlay = document.getElementById('heroSelectOverlay');
    if (!overlay) return;
    var cards = overlay.querySelectorAll('.hero-card');
    cards.forEach(function (card) {
      card.classList.toggle('selected', card.dataset.heroId === _currentHeroId);
    });
  }

  function clearConfirmedState() {
    var overlay = document.getElementById('heroSelectOverlay');
    if (!overlay) return;
    var cards = overlay.querySelectorAll('.hero-card');
    cards.forEach(function (card) {
      card.classList.remove('confirmed');
      card.classList.remove('soft-selected');
      card.style.pointerEvents = '';
    });
    var waitingEl = document.getElementById('heroSelectWaiting');
    if (waitingEl) waitingEl.classList.add('hidden');
  }

  function selectHero(heroId) {
    var hero = null;
    var heroes = window.HEROES || [];
    for (var i = 0; i < heroes.length; i++) {
      if (heroes[i].id === heroId) { hero = heroes[i]; break; }
    }
    if (!hero) return;
    _currentHeroId = heroId;
    updateCardSelection();
    if (typeof window.switchTrainingHero === 'function') {
      window.switchTrainingHero(heroId);
    }
  }

  function openHeroSelect() {
    if (window._heroSelectOpen) return;
    buildOverlay();
    window._heroSelectOpen = true;
    var overlay = document.getElementById('heroSelectOverlay');
    if (overlay) overlay.classList.remove('hidden');
    try { document.exitPointerLock(); } catch (e) {}
  }

  function closeHeroSelect() {
    if (!window._heroSelectOpen) return;
    window._heroSelectOpen = false;
    var overlay = document.getElementById('heroSelectOverlay');
    if (overlay) overlay.classList.add('hidden');
    if (window._splitViewMode) return; // parent overlay owns pointer lock
    // Re-lock pointer
    if (typeof renderer !== 'undefined' && renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }
  }

  function toggleHeroSelect() {
    if (window._heroSelectOpen) {
      closeHeroSelect();
    } else {
      openHeroSelect();
    }
  }

  // ── Pre-round hero select mode ──

  function handlePreRoundCardClick(heroId) {
    if (_preRoundLockedIn) return;
    _currentHeroId = heroId;
    _preRoundHasSelected = true;
    updateCardSelection();

    // Show checkmark on selected card, but keep all cards clickable
    var overlay = document.getElementById('heroSelectOverlay');
    if (overlay) {
      var cards = overlay.querySelectorAll('.hero-card');
      cards.forEach(function (card) {
        card.classList.toggle('soft-selected', card.dataset.heroId === heroId);
        card.classList.remove('confirmed');
      });
    }

    // Show "Waiting..." indicator
    var waitingEl = document.getElementById('heroSelectWaiting');
    if (waitingEl) {
      waitingEl.textContent = 'Waiting for other players...';
      waitingEl.classList.remove('hidden');
    }

    if (_preRoundCallbacks && typeof _preRoundCallbacks.onSelected === 'function') {
      _preRoundCallbacks.onSelected(heroId);
    }
  }

  /**
   * Show pre-round hero selection overlay with countdown timer.
   * opts.seconds — countdown duration (default from GAME_CONFIG)
   * opts.onSelected(heroId) — called each time player clicks a card (soft selection)
   * opts.onLockIn(heroId) — called once when timer expires or lockInPreRoundHeroSelect() is called
   *
   * Legacy support: opts.onConfirmed/onTimeout still work — onConfirmed maps to onSelected,
   * onTimeout maps to onLockIn.
   */
  window.showPreRoundHeroSelect = function (opts) {
    opts = opts || {};
    var cfg = window.GAME_CONFIG || {};
    var seconds = opts.seconds || cfg.HERO_SELECT_SECONDS || 15;

    _preRoundMode = true;
    _preRoundLockedIn = false;
    _preRoundHasSelected = false;
    _preRoundCallbacks = {
      onSelected: opts.onSelected || opts.onConfirmed || null,
      onLockIn: opts.onLockIn || opts.onTimeout || null
    };

    buildOverlay();
    clearConfirmedState();
    updateCardSelection();

    // Show overlay
    window._heroSelectOpen = true;
    var overlay = document.getElementById('heroSelectOverlay');
    if (overlay) overlay.classList.remove('hidden');
    try { document.exitPointerLock(); } catch (e) {}

    // Show timer
    var timerEl = document.getElementById('heroSelectTimer');
    if (timerEl) {
      timerEl.textContent = String(seconds);
      timerEl.classList.remove('hidden');
    }

    // Hide training hint, show title
    var hintEl = document.getElementById('heroSelectHint');
    if (hintEl) hintEl.textContent = 'Click a hero to select';

    // Notify parent (dev workbench) that hero select opened so overlay passthrough activates
    if (window._splitViewMode && window.parent !== window) {
      window.parent.postMessage({ type: 'svHeroSelectOpen' }, '*');
    }

    // Start countdown
    var remaining = seconds;
    if (_preRoundTimerRef) clearInterval(_preRoundTimerRef);
    _preRoundTimerRef = setInterval(function () {
      remaining--;
      if (timerEl) timerEl.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(_preRoundTimerRef);
        _preRoundTimerRef = null;
        if (!_preRoundLockedIn) {
          _preRoundLockedIn = true;
          if (_preRoundCallbacks && typeof _preRoundCallbacks.onLockIn === 'function') {
            _preRoundCallbacks.onLockIn(_currentHeroId);
          }
        }
      }
    }, 1000);
  };

  /**
   * Lock in current hero selection early (before timer expires).
   * Called externally when all players have made a selection.
   */
  window.lockInPreRoundHeroSelect = function () {
    if (!_preRoundMode || _preRoundLockedIn) return;
    _preRoundLockedIn = true;
    if (_preRoundTimerRef) {
      clearInterval(_preRoundTimerRef);
      _preRoundTimerRef = null;
    }
    if (_preRoundCallbacks && typeof _preRoundCallbacks.onLockIn === 'function') {
      _preRoundCallbacks.onLockIn(_currentHeroId);
    }
  };

  window.closePreRoundHeroSelect = function () {
    if (_preRoundTimerRef) {
      clearInterval(_preRoundTimerRef);
      _preRoundTimerRef = null;
    }
    _preRoundMode = false;
    _preRoundLockedIn = false;
    _preRoundHasSelected = false;
    _preRoundCallbacks = null;

    // Hide timer
    var timerEl = document.getElementById('heroSelectTimer');
    if (timerEl) timerEl.classList.add('hidden');

    // Restore hint text for training mode
    var hintEl = document.getElementById('heroSelectHint');
    if (hintEl) hintEl.textContent = 'Press H to close';

    clearConfirmedState();

    // Close overlay
    window._heroSelectOpen = false;
    var overlay = document.getElementById('heroSelectOverlay');
    if (overlay) overlay.classList.add('hidden');

    // Notify parent that hero select closed so overlay recaptures input
    if (window._splitViewMode && window.parent !== window) {
      window.parent.postMessage({ type: 'svHeroSelectClosed' }, '*');
      return; // skip pointer lock — parent overlay owns it
    }

    // Re-lock pointer
    if (typeof renderer !== 'undefined' && renderer && renderer.domElement && renderer.domElement.requestPointerLock) {
      renderer.domElement.requestPointerLock();
    }
  };

  /**
   * Show "Waiting for opponent..." text (LAN mode after confirming).
   */
  window.showHeroSelectWaiting = function () {
    var waitingEl = document.getElementById('heroSelectWaiting');
    if (waitingEl) waitingEl.classList.remove('hidden');
  };

  // Listen for 'H' key (training range + FFA respawn hero change)
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'KeyH' || window.devConsoleOpen) return;
    if (window.trainingRangeActive) {
      e.preventDefault();
      toggleHeroSelect();
    } else if (typeof window._ffaRespawnHeroCallback === 'function' && !window._heroSelectOpen) {
      e.preventDefault();
      var rhp = document.getElementById('respawnHeroPrompt');
      if (rhp) rhp.classList.add('hidden');
      // Cancel the auto-hide timer so it doesn't null the callback while overlay is open
      if (typeof window._cancelRespawnHeroTimer === 'function') window._cancelRespawnHeroTimer();
      openHeroSelect();
    } else if (typeof window._ffaRespawnHeroCallback === 'function' && window._heroSelectOpen) {
      e.preventDefault();
      closeHeroSelect();
      window._ffaRespawnHeroCallback = null;
    }
  });

  window.openHeroSelect = openHeroSelect;
  window.closeHeroSelect = closeHeroSelect;
  window.isHeroSelectOpen = function () { return window._heroSelectOpen; };
  window.getCurrentHeroId = function () { return _currentHeroId; };

})();
