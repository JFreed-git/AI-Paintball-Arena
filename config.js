/**
 * config.js — Cross-system shared constants
 *
 * PURPOSE: Single source of truth for timing and game-flow constants that are
 * referenced by multiple systems/modes. Constants that belong to a specific
 * system (e.g. GRAVITY in physics.js, SNAPSHOT_RATE in modeFFA.js) stay in
 * that system's file.
 *
 * EXPORTS (window):
 *   GAME_CONFIG — frozen object with shared constants
 *
 * DEPENDENCIES: None (loads first)
 *
 * CONSUMED BY:
 *   roundFlow.js — ROUND_BANNER_MS, COUNTDOWN_SECONDS
 *   heroSelectUI.js — HERO_SELECT_SECONDS
 *
 * TODO (future):
 *   - Could be loaded from a JSON file for external editor support
 *   - May add difficulty presets here (Easy/Medium/Hard reaction times, aim error)
 */

(function () {

  var GAME_CONFIG = {

    // --- Round Flow ---
    ROUND_BANNER_MS: 1200,               // ms to display round result banners
    COUNTDOWN_SECONDS: 3,                // default countdown duration (3-2-1-GO)

    // --- Hero Selection ---
    HERO_SELECT_SECONDS: 15,             // seconds for pre-round hero selection

    // --- Combat ---
    SHOT_DELAY_AFTER_COUNTDOWN: 300,     // ms grace period before firing after countdown
  };

  // Freeze to prevent accidental mutation
  Object.freeze(GAME_CONFIG);

  window.GAME_CONFIG = GAME_CONFIG;

})();
