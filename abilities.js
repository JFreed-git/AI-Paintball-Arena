/**
 * abilities.js — Ability system runtime
 *
 * PURPOSE: Manages ability state (cooldowns, activation, effect dispatch) for heroes.
 * Ability DEFINITIONS live on hero configs in heroes.js. This file handles the
 * RUNTIME: registering abilities, tracking cooldowns, processing activation,
 * dispatching effect callbacks, and reporting HUD state.
 *
 * EXPORTS (window):
 *   AbilityManager — constructor for per-player ability tracking
 *
 * DEPENDENCIES: None (standalone — timing and input are passed in via update())
 */

(function () {

  // === Static effect registry (shared across all AbilityManager instances) ===
  // Registered once at load time via AbilityManager.registerEffect()
  // Shape: { abilityId: { onActivate, onTick?, onEnd? } }
  var _effectRegistry = {};

  /**
   * AbilityManager — tracks ability state for a single player.
   *
   * @param {Object} player - the player this manager belongs to
   */
  function AbilityManager(player) {
    this._player = player;

    // Passive set: { passiveId: {id} }
    this._passives = {};

    // Ability registry: { abilityId: {id, name, key, cooldownMs, duration?, params?} }
    this._abilities = {};

    // Cooldown tracking: { abilityId: { remaining: ms, total: ms } }
    this._cooldowns = {};

    // Active effect tracking: { abilityId: { remaining: ms, params: {} } }
    this._activeEffects = {};
  }

  // ─── Static: Effect Registry ───────────────────────────────────────

  /**
   * Register effect callbacks for an ability type (static/module-level).
   * Called once at load time, shared across all AbilityManager instances.
   *
   * @param {string} abilityId - the ability this effect handles
   * @param {Object} callbacks - { onActivate(player, params), onTick?(player, params, dt), onEnd?(player, params) }
   */
  AbilityManager.registerEffect = function (abilityId, callbacks) {
    _effectRegistry[abilityId] = callbacks;
  };

  // ─── Registration ──────────────────────────────────────────────────

  /**
   * Register a passive ability.
   * @param {Object} passiveDef - { id }
   */
  AbilityManager.prototype.registerPassive = function (passiveDef) {
    if (!passiveDef || !passiveDef.id) return;
    this._passives[passiveDef.id] = passiveDef;
  };

  /**
   * Register an active ability.
   * @param {Object} abilityDef - { id, name, key, cooldownMs, duration?, params? }
   */
  AbilityManager.prototype.registerAbility = function (abilityDef) {
    if (!abilityDef || !abilityDef.id) return;
    this._abilities[abilityDef.id] = abilityDef;
  };

  /**
   * Remove all registered abilities and passives (used when switching heroes).
   */
  AbilityManager.prototype.clearAbilities = function () {
    this._passives = {};
    this._abilities = {};
    this._cooldowns = {};
    this._activeEffects = {};
  };

  // ─── Queries ───────────────────────────────────────────────────────

  /**
   * Check if this player has a specific passive ability.
   */
  AbilityManager.prototype.hasPassive = function (passiveId) {
    return !!this._passives[passiveId];
  };

  /**
   * Check if an ability is ready to use (off cooldown).
   */
  AbilityManager.prototype.isReady = function (abilityId) {
    var cd = this._cooldowns[abilityId];
    return !cd || cd.remaining <= 0;
  };

  /**
   * Check if an ability is currently active (effect in progress).
   */
  AbilityManager.prototype.isActive = function (abilityId) {
    return !!this._activeEffects[abilityId];
  };

  /**
   * Get cooldown progress for an ability (0.0 = ready, 1.0 = just activated).
   */
  AbilityManager.prototype.getCooldownPercent = function (abilityId) {
    var cd = this._cooldowns[abilityId];
    if (!cd || cd.total <= 0) return 0;
    return Math.max(0, Math.min(1, cd.remaining / cd.total));
  };

  // ─── Activation ────────────────────────────────────────────────────

  /**
   * Activate an ability by ID.
   * Checks cooldown, dispatches onActivate callback, starts cooldown and duration tracking.
   *
   * @param {string} abilityId
   * @returns {boolean} true if the ability was activated
   */
  AbilityManager.prototype.activate = function (abilityId) {
    var def = this._abilities[abilityId];
    if (!def) return false;

    // Must be off cooldown
    if (!this.isReady(abilityId)) return false;

    // Look up effect callbacks
    var effect = _effectRegistry[abilityId];

    // Call onActivate if registered
    if (effect && effect.onActivate) {
      effect.onActivate(this._player, def.params || {});
    }

    // Start cooldown
    this._cooldowns[abilityId] = {
      remaining: def.cooldownMs,
      total: def.cooldownMs
    };

    // If the ability has a duration, track it as an active effect
    if (def.duration && def.duration > 0) {
      this._activeEffects[abilityId] = {
        remaining: def.duration,
        params: def.params || {}
      };
    }

    return true;
  };

  // ─── Update ────────────────────────────────────────────────────────

  /**
   * Tick all cooldowns and active effect durations each frame.
   * Calls onTick for active effects, and onEnd when effects expire.
   *
   * @param {number} dt - delta time in milliseconds
   */
  AbilityManager.prototype.update = function (dt) {
    // Tick down cooldowns
    for (var id in this._cooldowns) {
      if (this._cooldowns[id].remaining > 0) {
        this._cooldowns[id].remaining -= dt;
      }
    }

    // Tick down active effects
    for (var eid in this._activeEffects) {
      var ae = this._activeEffects[eid];
      var effect = _effectRegistry[eid];

      // Call onTick while active
      if (effect && effect.onTick) {
        effect.onTick(this._player, ae.params, dt);
      }

      ae.remaining -= dt;
      if (ae.remaining <= 0) {
        // Effect expired — call onEnd
        if (effect && effect.onEnd) {
          effect.onEnd(this._player, ae.params);
        }
        delete this._activeEffects[eid];
      }
    }
  };

  // ─── HUD State ─────────────────────────────────────────────────────

  /**
   * Returns HUD-ready state for all registered abilities (not passives).
   * @returns {Array} [{id, name, key, cooldownPct, isActive, isReady}]
   */
  AbilityManager.prototype.getHUDState = function () {
    var result = [];
    for (var id in this._abilities) {
      var def = this._abilities[id];
      result.push({
        id: def.id,
        name: def.name,
        key: def.key,
        cooldownPct: this.getCooldownPercent(def.id),
        isActive: this.isActive(def.id),
        isReady: this.isReady(def.id)
      });
    }
    return result;
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Reset all cooldowns and active effects (called between rounds).
   */
  AbilityManager.prototype.reset = function () {
    this._cooldowns = {};
    this._activeEffects = {};
  };

  window.AbilityManager = AbilityManager;

  // === ABILITY EFFECT IMPLEMENTATIONS BELOW ===
  // ─── Dash Effect ───────────────────────────────────────────────────
  // Burst of velocity in the player's look direction (200ms duration).
  // Used by Slicer hero. params.speed defaults to 30.

  AbilityManager.registerEffect('dash', {

    onActivate: function (player, params) {
      var speed = params.speed || 30;
      var dir;

      // Get forward direction from camera (local player) or mesh (AI/remote)
      if (typeof THREE !== 'undefined') {
        var quat;
        if (window.camera && player.cameraAttached) {
          quat = window.camera.quaternion;
        } else if (player.mesh) {
          quat = player.mesh.quaternion;
        }
        if (quat) {
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
        }
      }

      // Fallback: if no direction could be determined, dash forward (negative Z)
      if (!dir) {
        dir = { x: 0, y: 0, z: -1 };
      }

      // Store dash direction for onTick
      player._dashDir = { x: dir.x, y: dir.y, z: dir.z };
      player._dashSpeed = speed;

      // Apply initial velocity burst to vertical component (half strength to prevent flying)
      if (Math.abs(dir.y) > 0.15) {
        player.verticalVelocity = dir.y * speed * 0.5;
        if (player.grounded) player.grounded = false;
      }

      // Play dash sound if available
      if (window.playSound) window.playSound('dash');
    },

    onTick: function (player, params, dt) {
      if (!player._dashDir) return;
      var speed = player._dashSpeed || params.speed || 30;
      // Convert dt from milliseconds to seconds for position-based movement
      var dtSec = dt / 1000;

      // Override horizontal position directly (physics has no persistent vx/vz)
      player.position.x += player._dashDir.x * speed * dtSec;
      player.position.z += player._dashDir.z * speed * dtSec;
    },

    onEnd: function (player) {
      delete player._dashDir;
      delete player._dashSpeed;
    }
  });


})();
