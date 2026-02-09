/**
 * roundFlow.js — Round and match flow management
 *
 * PURPOSE: Shared functions for round banners, countdowns, and match scoring used
 * by competitive game modes (AI and LAN). Training range has no round flow.
 *
 * EXPORTS (window):
 *   sharedShowRoundBanner(text, bannerEl, timerRef, ms)
 *   sharedStartRoundCountdown(opts)
 *
 * DEPENDENCIES: config.js (GAME_CONFIG for timing defaults)
 *
 * DESIGN NOTES:
 *   - Banner and countdown functions take DOM elements as parameters rather than
 *     looking them up internally. This keeps them mode-agnostic.
 *   - Timer refs are objects like { id: 0 } used to track setTimeout/setInterval
 *     handles and prevent stacking.
 *   - onStart callback fires immediately when countdown begins (used to lock input).
 *   - onReady callback fires when countdown finishes (used to enable input).
 *
 * TODO (future):
 *   - Match scoring helper (centralize win tracking from mode files)
 *   - Intermission screen between rounds (stats, hero swap prompt)
 *   - Match MVP display at game end
 *   - Overtime / tiebreaker logic
 */

(function () {

  var cfg = (typeof window.GAME_CONFIG === 'object') ? window.GAME_CONFIG : {};

  /**
   * Show a text banner for `ms` milliseconds.
   * bannerEl: the DOM element to show
   * timerRef: an object like { id: 0 } to track the timeout (prevents stacking)
   */
  window.sharedShowRoundBanner = function (text, bannerEl, timerRef, ms) {
    ms = ms || cfg.ROUND_BANNER_MS || 1200;
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

  /**
   * Run a 3-2-1-GO countdown with callbacks.
   * opts.seconds       - countdown duration (default from GAME_CONFIG)
   * opts.countdownEl   - DOM element to display numbers
   * opts.timerRef      - object like { id: 0 } for setInterval tracking
   * opts.onStart()     - called immediately (lock input, reset weapons, etc.)
   * opts.onReady()     - called when countdown finishes (enable input)
   */
  window.sharedStartRoundCountdown = function (opts) {
    var seconds = opts.seconds || cfg.COUNTDOWN_SECONDS || 3;
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

})();
