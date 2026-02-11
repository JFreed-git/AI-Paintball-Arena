/**
 * abilities.js — Ability system runtime
 *
 * PURPOSE: Manages ability state (cooldowns, activation, effect dispatch) for heroes
 * and weapons during gameplay. Ability DEFINITIONS live on hero/weapon configs in
 * heroes.js and weapon.js. This file handles the RUNTIME: tracking which abilities
 * are on cooldown, processing activation inputs, and triggering effects.
 *
 * EXPORTS (window):
 *   AbilityManager — constructor for per-player ability tracking
 *
 * DEPENDENCIES: None (standalone — timing and input are passed in via update())
 *
 * ABILITY TYPES:
 *
 *   Passive abilities (defined on hero.passives[]):
 *     - Always active, no cooldown, no activation input
 *     - Checked by relevant systems (e.g. physics.js checks 'doubleJump')
 *     - Examples: doubleJump, damageResistance, quickReload
 *     - Shape: { id: 'doubleJump', type: 'passive', description: '...' }
 *
 *   Active abilities (defined on hero.abilities[] or weapon.abilities[]):
 *     - Triggered by keybind, have cooldown duration
 *     - Effect dispatched through callback system
 *     - Examples: dash, shield, chargedShot
 *     - Shape: {
 *         id: 'dash',
 *         type: 'active',
 *         cooldownSec: 8,
 *         duration: 0.3,        // how long the effect lasts (seconds), 0 for instant
 *         keybind: 'q',         // keyboard key to activate
 *         description: '...'
 *       }
 *
 * USAGE (future):
 *   var mgr = new AbilityManager(heroAbilities, weaponAbilities);
 *   // Each frame:
 *   mgr.update(dt, inputState, callbacks);
 *   // Check passives:
 *   mgr.hasPassive('doubleJump'); // returns true/false
 *   // Check cooldowns for HUD display:
 *   mgr.getCooldownPercent('dash'); // returns 0.0 - 1.0
 *
 * TODO (implement):
 *   - AbilityManager.activate(abilityId): manually trigger an ability
 *   - Effect callback registry: { 'dash': function(player, dt) { ... } }
 *   - Input-driven activation in update() (check keybinds, activate if ready)
 *   - Integration with physics.js for movement abilities
 *   - Integration with projectiles.js for weapon abilities
 *   - HUD integration in hud.js (cooldown indicators)
 *   - Networking: ability activation events for LAN mode
 *   - Ultimate abilities (charge-based, not cooldown-based) — lower priority
 */

(function () {

  /**
   * AbilityManager — tracks ability state for a single player.
   *
   * @param {Array} heroPassives   - passive ability definitions from hero config
   * @param {Array} heroAbilities  - active ability definitions from hero config
   * @param {Array} weaponAbilities - active ability definitions from weapon config
   */
  function AbilityManager(heroPassives, heroAbilities, weaponAbilities) {
    this._passives = heroPassives || [];
    this._actives = [].concat(heroAbilities || [], weaponAbilities || []);

    // Cooldown tracking: { abilityId: { remaining: seconds, total: seconds } }
    this._cooldowns = {};

    // Active effect tracking: { abilityId: { remaining: seconds } }
    this._activeEffects = {};
  }

  /**
   * Check if this player has a specific passive ability.
   * Used by systems like physics.js to check for movement passives.
   */
  AbilityManager.prototype.hasPassive = function (passiveId) {
    for (var i = 0; i < this._passives.length; i++) {
      if (this._passives[i].id === passiveId) return true;
    }
    return false;
  };

  /**
   * Get cooldown progress for an ability (0 = ready, 1 = just activated).
   * Used by hud.js to render cooldown indicators.
   */
  AbilityManager.prototype.getCooldownPercent = function (abilityId) {
    var cd = this._cooldowns[abilityId];
    if (!cd || cd.total <= 0) return 0;
    return Math.max(0, Math.min(1, cd.remaining / cd.total));
  };

  /**
   * Check if an ability is ready to use (off cooldown).
   */
  AbilityManager.prototype.isReady = function (abilityId) {
    var cd = this._cooldowns[abilityId];
    return !cd || cd.remaining <= 0;
  };

  /**
   * Update cooldowns and active effects each frame.
   * TODO: Also check input state and fire ability callbacks.
   *
   * @param {number} dt - delta time in seconds
   * @param {Object} inputState - current input (from input.js)
   * @param {Object} callbacks - { abilityId: function(player, dt) } effect handlers
   */
  AbilityManager.prototype.update = function (dt /*, inputState, callbacks */) {
    // Tick down cooldowns
    for (var id in this._cooldowns) {
      if (this._cooldowns[id].remaining > 0) {
        this._cooldowns[id].remaining -= dt;
      }
    }

    // Tick down active effects
    for (var eid in this._activeEffects) {
      if (this._activeEffects[eid].remaining > 0) {
        this._activeEffects[eid].remaining -= dt;
        if (this._activeEffects[eid].remaining <= 0) {
          delete this._activeEffects[eid];
        }
      }
    }

    // TODO: Check inputState for ability keybinds and activate if ready
    // TODO: Call effect callbacks for active effects
  };

  /**
   * Reset all cooldowns and active effects (called between rounds).
   */
  AbilityManager.prototype.reset = function () {
    this._cooldowns = {};
    this._activeEffects = {};
  };

  window.AbilityManager = AbilityManager;

})();
