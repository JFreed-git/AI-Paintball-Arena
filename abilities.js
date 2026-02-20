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
   * Clean up all active effects by calling onEnd for each, then clear the map.
   * Prevents leaked visuals (grapple line) and stale player properties.
   */
  AbilityManager.prototype._cleanupActiveEffects = function () {
    for (var eid in this._activeEffects) {
      var effect = _effectRegistry[eid];
      if (effect && effect.onEnd) {
        effect.onEnd(this._player, this._activeEffects[eid].params);
      }
    }
    this._activeEffects = {};
  };

  /**
   * Remove all registered abilities and passives (used when switching heroes).
   */
  AbilityManager.prototype.clearAbilities = function () {
    this._cleanupActiveEffects();
    this._passives = {};
    this._abilities = {};
    this._cooldowns = {};
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
    this._cleanupActiveEffects();
    this._cooldowns = {};
  };

  window.AbilityManager = AbilityManager;

  // === ABILITY EFFECT IMPLEMENTATIONS BELOW ===
  // ─── Dash Effect ───────────────────────────────────────────────────
  // Burst of velocity in the player's look direction (200ms duration).
  // Used by Slicer hero. params.speed defaults to 30.

  AbilityManager.registerEffect('dash', {

    onActivate: function (player, params) {
      var speed = params.speed || 30;
      var yaw = 0;
      var gotYaw = false;

      // Get yaw from camera (local player) or mesh (AI/remote)
      if (window.camera && player.cameraAttached) {
        yaw = window.camera.rotation.y;
        gotYaw = true;
      } else if (player._meshGroup) {
        yaw = player._meshGroup.rotation.y;
        gotYaw = true;
      }

      // Compute horizontal dash direction from yaw (no pitch — dash is always level)
      var dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };

      // Store dash direction for onTick
      player._dashDir = dir;
      player._dashSpeed = speed;

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

  // ─── Grapple Hook Effect ─────────────────────────────────────────
  // Fires a hook forward; if an enemy is within range and cone angle,
  // pulls them toward the Brawler over the duration. params: maxRange, pullSpeed.

  function _getGrappleColliders() {
    var ffaState = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    if (ffaState && ffaState.arena && ffaState.arena.colliders) return ffaState.arena.colliders;
    var trainState = (typeof window.getTrainingRangeState === 'function') ? window.getTrainingRangeState() : null;
    if (trainState && trainState.arena && trainState.arena.colliders) return trainState.arena.colliders;
    return null;
  }

  function _getGrappleCandidates() {
    var candidates = [];
    // FFA mode players
    var ffaState = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    if (ffaState && ffaState.players) {
      var ids = Object.keys(ffaState.players);
      for (var i = 0; i < ids.length; i++) {
        var entry = ffaState.players[ids[i]];
        if (entry && entry.entity && entry.entity.alive) {
          candidates.push(entry.entity);
        }
      }
    }
    // Training mode bots
    var trainState = (typeof window.getTrainingRangeState === 'function') ? window.getTrainingRangeState() : null;
    if (trainState && trainState.bots) {
      for (var b = 0; b < trainState.bots.length; b++) {
        var bot = trainState.bots[b];
        if (bot && bot.alive && bot.player && bot.player.position) {
          candidates.push(bot.player);
        }
      }
    }
    return candidates;
  }

  AbilityManager.registerEffect('grappleHook', {

    onActivate: function (player, params) {
      var maxRange = params.maxRange || 30;
      var pullSpeed = params.pullSpeed || 20;
      var CONE_HALF_ANGLE = 0.3; // radians

      // Get aim direction
      var dir;
      if (typeof THREE !== 'undefined') {
        var quat;
        if (window.camera && player.cameraAttached) {
          quat = window.camera.quaternion;
        } else if (player._meshGroup) {
          quat = player._meshGroup.quaternion;
        }
        if (quat) {
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
        }
      }
      if (!dir) dir = new THREE.Vector3(0, 0, -1);

      // Get player position
      var origin = player.position.clone();

      // Find best target in cone
      var candidates = _getGrappleCandidates();
      var bestTarget = null;
      var bestDist = maxRange + 1;

      for (var i = 0; i < candidates.length; i++) {
        var candidate = candidates[i];
        if (candidate === player) continue; // don't grapple self

        var toTarget = candidate.position.clone().sub(origin);
        var dist = toTarget.length();
        if (dist > maxRange || dist < 0.5) continue;

        toTarget.normalize();
        var angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(toTarget))));
        if (angle > CONE_HALF_ANGLE) continue;

        if (dist < bestDist) {
          bestDist = dist;
          bestTarget = candidate;
        }
      }

      // Store grapple state on player
      player._grappleTarget = bestTarget;
      player._grapplePullSpeed = pullSpeed;

      // Create visual chain line
      if (bestTarget && typeof THREE !== 'undefined' && window.scene) {
        var geom = new THREE.BufferGeometry();
        var positions = new Float32Array([
          origin.x, origin.y, origin.z,
          bestTarget.position.x, bestTarget.position.y, bestTarget.position.z
        ]);
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        var mat = new THREE.LineBasicMaterial({ color: 0x44ff44, linewidth: 2 });
        player._grappleLine = new THREE.Line(geom, mat);
        // Disable frustum culling — vertices are updated dynamically each tick
        // and the bounding sphere won't auto-recompute, causing the line to be culled
        player._grappleLine.frustumCulled = false;
        window.scene.add(player._grappleLine);
      }

      if (typeof window.playSound === 'function') window.playSound('grapple');
    },

    onTick: function (player, params, dt) {
      if (!player._grappleTarget) return;

      var target = player._grappleTarget;

      // If target died during pull, clean up chain line immediately
      if (!target.alive) {
        if (player._grappleLine && window.scene) {
          window.scene.remove(player._grappleLine);
          if (player._grappleLine.geometry) player._grappleLine.geometry.dispose();
          if (player._grappleLine.material) player._grappleLine.material.dispose();
          delete player._grappleLine;
        }
        player._grappleTarget = null;
        return;
      }

      var pullSpeed = player._grapplePullSpeed || params.pullSpeed || 20;
      var dtSec = dt / 1000;

      // Calculate direction from target toward brawler
      var dx = player.position.x - target.position.x;
      var dy = player.position.y - target.position.y;
      var dz = player.position.z - target.position.z;
      var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Stop pulling if target is close enough
      if (dist < 3) {
        player._grappleTarget = null;
        return;
      }

      // Normalize direction and move target
      var invDist = 1 / Math.max(dist, 0.01);
      target.position.x += dx * invDist * pullSpeed * dtSec;
      target.position.z += dz * invDist * pullSpeed * dtSec;

      // Resolve wall collisions so target doesn't get pulled through geometry
      var colliders = _getGrappleColliders();
      if (colliders && typeof window.resolveCollisions3D === 'function') {
        window.resolveCollisions3D(target, colliders);
      }

      // Sync target mesh
      if (typeof target._syncMeshPosition === 'function') {
        target._syncMeshPosition();
      }

      // Update visual chain line
      if (player._grappleLine && player._grappleLine.geometry) {
        var posAttr = player._grappleLine.geometry.getAttribute('position');
        if (posAttr) {
          posAttr.array[0] = player.position.x;
          posAttr.array[1] = player.position.y;
          posAttr.array[2] = player.position.z;
          posAttr.array[3] = target.position.x;
          posAttr.array[4] = target.position.y;
          posAttr.array[5] = target.position.z;
          posAttr.needsUpdate = true;
        }
      }
    },

    onEnd: function (player) {
      // Remove visual chain
      if (player._grappleLine) {
        if (window.scene) window.scene.remove(player._grappleLine);
        if (player._grappleLine.geometry) player._grappleLine.geometry.dispose();
        if (player._grappleLine.material) player._grappleLine.material.dispose();
      }
      delete player._grappleTarget;
      delete player._grapplePullSpeed;
      delete player._grappleLine;
    }
  });

  // ─── Unlimited Ammo Effect ──────────────────────────────────────
  // Marksman's "Overdrive" ability: weapon stops consuming ammo for the duration.
  // Ammo is kept at magSize each tick; original count restored when effect ends.

  AbilityManager.registerEffect('unlimitedAmmo', {
    onActivate: function (player, params) {
      if (player.weapon) {
        player._unlimitedAmmoActive = true;
        player._savedAmmo = player.weapon.ammo;
      }
      if (typeof window.playSound === 'function') window.playSound('powerup');
    },
    onTick: function (player, params, dt) {
      if (player.weapon && player._unlimitedAmmoActive) {
        player.weapon.ammo = player.weapon.magSize;
      }
    },
    onEnd: function (player, params) {
      if (player.weapon && player._savedAmmo !== undefined) {
        player.weapon.ammo = player._savedAmmo;
      }
      delete player._unlimitedAmmoActive;
      delete player._savedAmmo;
    }
  });

})();
