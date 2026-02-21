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

    // Mana system (initialized via initMana if hero uses mana)
    this._mana = 0;
    this._maxMana = 0;
    this._manaRegenRate = 0;
    this._manaRegenDelay = 0;
    this._manaRegenTimer = 0;
    this._hasMana = false;
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

    // Call onActivate if registered (return false to abort activation)
    if (effect && effect.onActivate) {
      if (effect.onActivate(this._player, def.params || {}) === false) return false;
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

    // Mana regen
    if (this._hasMana) {
      if (this._manaRegenTimer > 0) {
        this._manaRegenTimer -= dt;
      } else if (this._mana < this._maxMana) {
        this._mana = Math.min(this._maxMana, this._mana + this._manaRegenRate * (dt / 1000));
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
    if (this._hasMana) {
      this._mana = this._maxMana;
      this._manaRegenTimer = 0;
    }
  };

  // ─── Mana System ──────────────────────────────────────────────────

  /**
   * Initialize the mana system for this player.
   * Called from applyHeroToPlayer() if the hero defines a mana config.
   * @param {Object} manaConfig - { maxMana, regenRate, regenDelay }
   */
  AbilityManager.prototype.initMana = function (manaConfig) {
    if (!manaConfig) return;
    this._hasMana = true;
    this._maxMana = manaConfig.maxMana || 100;
    this._mana = this._maxMana;
    this._manaRegenRate = manaConfig.regenRate || 10;
    this._manaRegenDelay = manaConfig.regenDelay || 2000;
    this._manaRegenTimer = 0;
  };

  AbilityManager.prototype.hasMana = function () {
    return this._hasMana;
  };

  AbilityManager.prototype.getMana = function () {
    return this._mana;
  };

  AbilityManager.prototype.getMaxMana = function () {
    return this._maxMana;
  };

  /**
   * Consume mana. Returns false if insufficient, otherwise deducts and resets regen timer.
   * @param {number} amount
   * @returns {boolean}
   */
  AbilityManager.prototype.consumeMana = function (amount) {
    if (!this._hasMana) return false;
    if (this._mana < amount) return false;
    this._mana -= amount;
    this._manaRegenTimer = this._manaRegenDelay;
    return true;
  };

  /**
   * Add mana (capped at maxMana).
   * @param {number} amount
   */
  AbilityManager.prototype.addMana = function (amount) {
    if (!this._hasMana) return;
    this._mana = Math.min(this._maxMana, this._mana + amount);
  };

  /**
   * Reset the mana regen delay timer (called when mana is consumed externally).
   */
  AbilityManager.prototype.resetManaRegenDelay = function () {
    this._manaRegenTimer = this._manaRegenDelay;
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
      // Camera convention: yaw=0 → facing -Z, forward = (-sin(yaw), -cos(yaw))
      // Mesh convention (faceToward): yaw = atan2(dx,dz), forward = (sin(yaw), cos(yaw))
      var dir;
      if (window.camera && player.cameraAttached) {
        yaw = window.camera.rotation.y;
        dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
        gotYaw = true;
      } else if (player._meshGroup) {
        yaw = player._meshGroup.rotation.y;
        dir = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
        gotYaw = true;
      } else {
        dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
      }

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
      // Camera convention: forward = (0,0,-1) rotated by camera quaternion
      // Mesh convention (faceToward): yaw = atan2(dx,dz), forward = (sin(yaw), 0, cos(yaw))
      var dir;
      if (typeof THREE !== 'undefined') {
        if (window.camera && player.cameraAttached) {
          dir = new THREE.Vector3(0, 0, -1).applyQuaternion(window.camera.quaternion);
        } else if (player._meshGroup) {
          var meshYaw = player._meshGroup.rotation.y;
          dir = new THREE.Vector3(Math.sin(meshYaw), 0, Math.cos(meshYaw));
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
        if (player._grappleLine && window.scene) {
          window.scene.remove(player._grappleLine);
          if (player._grappleLine.geometry) player._grappleLine.geometry.dispose();
          if (player._grappleLine.material) player._grappleLine.material.dispose();
          delete player._grappleLine;
        }
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

  // ─── Mage Effects ────────────────────────────────────────────────

  // Helper: get solids array from active game mode (for raycasting)
  function _getMageSolids() {
    var ffaState = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    if (ffaState && ffaState.arena && ffaState.arena.solids) return ffaState.arena.solids;
    var trainState = (typeof window.getTrainingRangeState === 'function') ? window.getTrainingRangeState() : null;
    if (trainState && trainState.arena && trainState.arena.solids) return trainState.arena.solids;
    return [];
  }

  // Helper: get horizontal look direction
  // Uses camera.rotation.y directly (same approach as the working dash ability).
  // Camera convention: yaw=0 faces -Z, forward = (-sin(yaw), 0, -cos(yaw))
  // Mesh convention: yaw=0 faces +Z, forward = (sin(yaw), 0, cos(yaw))
  function _getHorizontalLookDir(player) {
    if (typeof THREE === 'undefined') return { x: 0, y: 0, z: -1 };
    var yaw;
    if (window.camera && player.cameraAttached) {
      yaw = window.camera.rotation.y;
      return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else if (player._meshGroup) {
      yaw = player._meshGroup.rotation.y;
      return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    }
    return new THREE.Vector3(0, 0, -1);
  }

  // Helper: get full look direction (with vertical component) for beam aiming.
  // Builds a fresh quaternion from camera Euler angles to avoid auto-sync issues.
  function _getFullLookDir(player) {
    if (typeof THREE === 'undefined') return new THREE.Vector3(0, 0, -1);
    if (window.camera && player.cameraAttached) {
      var euler = new THREE.Euler(window.camera.rotation.x, window.camera.rotation.y, 0, 'YXZ');
      var q = new THREE.Quaternion().setFromEuler(euler);
      return new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    } else if (player._meshGroup) {
      return new THREE.Vector3(0, 0, -1).applyQuaternion(player._meshGroup.quaternion).normalize();
    }
    return new THREE.Vector3(0, 0, -1);
  }

  // Helper: create a temporary visual sphere that fades out
  function _spawnBurstParticle(pos, color, size, lifetimeMs) {
    if (typeof THREE === 'undefined' || !window.scene) return;
    var geom = new THREE.SphereGeometry(size, 6, 6);
    var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(pos);
    window.scene.add(mesh);
    var start = performance.now();
    function fade() {
      var elapsed = performance.now() - start;
      if (elapsed >= lifetimeMs) {
        window.scene.remove(mesh);
        geom.dispose();
        mat.dispose();
        return;
      }
      mat.opacity = 0.8 * (1 - elapsed / lifetimeMs);
      mesh.scale.setScalar(1 + elapsed / lifetimeMs);
      requestAnimationFrame(fade);
    }
    requestAnimationFrame(fade);
  }

  // Helper: create/remove a screen-space color overlay for the local player
  function _showScreenOverlay(id, color, opacity) {
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;transition:opacity 0.15s;';
      document.body.appendChild(el);
    }
    el.style.backgroundColor = color;
    el.style.opacity = String(opacity);
    el.style.display = '';
  }
  function _hideScreenOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // Helper: fallback teleport destination — horizontal projection with binary-search
  // Used when the 3D raycast misses everything (aiming at sky, beyond range).
  function _calcTeleportDestFallback(player, params) {
    var maxRange = params.maxRange || 25;
    var snapTolerance = params.snapTolerance || 1.5;
    var dir = _getHorizontalLookDir(player);
    var origin = player.position.clone();
    var solids = _getMageSolids();

    // Binary search for max clear distance before hitting a wall
    var safeDist = maxRange;
    if (typeof window.hasBlockingBetween === 'function' && solids.length > 0) {
      var lo = 0, hi = maxRange;
      for (var step = 0; step < 8; step++) {
        var mid = (lo + hi) / 2;
        var testPt = origin.clone().add(dir.clone().multiplyScalar(mid));
        if (window.hasBlockingBetween(origin, testPt, solids)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      safeDist = Math.max(0, lo - 0.5);
    }
    var dest = origin.clone().add(dir.clone().multiplyScalar(safeDist));

    // Snap to ground at destination
    var groundY = window.GROUND_Y || 0;
    if (typeof window.getGroundHeight === 'function') {
      var gh = window.getGroundHeight(dest, solids, dest.y, false);
      if (Math.abs(gh - (player.feetY || groundY)) <= snapTolerance || gh > groundY) {
        groundY = gh;
      }
    }

    return { x: dest.x, z: dest.z, groundY: groundY };
  }

  // Helper: calculate teleport destination using 3D cursor raycast
  // 1. Raycast along full look direction against arena solids
  // 2. Top surface hit → place ghost at hit point
  // 3. Side surface hit → above midpoint = on top, below midpoint = beside on ground
  // 4. No hit → fallback to horizontal max-range projection
  function _calcTeleportDest(player, params) {
    var maxRange = params.maxRange || 25;
    var solids = _getMageSolids();

    // Need THREE and solids for raycasting
    if (typeof THREE === 'undefined' || solids.length === 0) {
      return _calcTeleportDestFallback(player, params);
    }

    var dir = _getFullLookDir(player);
    var origin = player.position.clone();

    // Raycast along the full 3D aim direction
    var raycaster = new THREE.Raycaster(origin, dir, 0, maxRange);
    var hits = raycaster.intersectObjects(solids, true);

    if (hits.length === 0) {
      // No direct hit — try a horizontal raycast to find the block the player
      // is looking toward. When aiming slightly above a block, the 3D ray sails
      // over it, but the horizontal component still points at it.
      var horizDir = new THREE.Vector3(dir.x, 0, dir.z);
      if (horizDir.lengthSq() > 0.001) {
        horizDir.normalize();
        var horizRay = new THREE.Raycaster(origin, horizDir, 0, maxRange);
        var horizHits = horizRay.intersectObjects(solids, true);
        if (horizHits.length > 0) {
          var hh = horizHits[0];
          var blockBox = new THREE.Box3().setFromObject(hh.object);
          var topY = blockBox.max.y;
          // Only snap to block top if aiming upward (cursor is above horizon)
          // and the block top is above the base ground level
          var bgy = window.GROUND_Y || 0;
          if (dir.y > 0 && topY > bgy) {
            var destX = hh.point.x;
            var destZ = hh.point.z;
            var ddx = destX - origin.x;
            var ddz = destZ - origin.z;
            var dFlatDist = Math.sqrt(ddx * ddx + ddz * ddz);
            if (dFlatDist <= maxRange) {
              // LOS check: ray to standing height above block top
              var ghostStand = new THREE.Vector3(destX, topY + 1.5, destZ);
              if (typeof window.hasBlockingBetween !== 'function' ||
                  !window.hasBlockingBetween(origin, ghostStand, solids)) {
                return { x: destX, z: destZ, groundY: topY };
              }
            }
          }
        }
      }
      return _calcTeleportDestFallback(player, params);
    }

    var hit = hits[0];
    var hitPoint = hit.point.clone();

    // Transform face normal from local to world space
    var hitNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    if (hit.object && hit.object.matrixWorld) {
      hitNormal.transformDirection(hit.object.matrixWorld).normalize();
    }

    var baseGroundY = window.GROUND_Y || 0;
    var destX, destZ, destGroundY;

    if (hitNormal.y > 0.7) {
      // ── Top surface hit (floor or block top) ──
      // Place ghost directly at the hit point
      destX = hitPoint.x;
      destZ = hitPoint.z;
      destGroundY = hitPoint.y;
    } else {
      // ── Side surface hit ──
      // Determine if aiming at upper or lower half of the block
      var hitObj = hit.object;
      var bbox = new THREE.Box3().setFromObject(hitObj);
      var blockMidY = (bbox.min.y + bbox.max.y) / 2;

      if (hitPoint.y >= blockMidY) {
        // Upper half → place ghost on top of the block
        destX = hitPoint.x;
        destZ = hitPoint.z;
        destGroundY = bbox.max.y;
      } else {
        // Lower half → place ghost on ground beside the block
        // Step back along the face normal to avoid clipping into the wall
        var offset = hitNormal.clone();
        offset.y = 0;
        if (offset.length() > 0.01) offset.normalize();
        destX = hitPoint.x + offset.x * 1.0;
        destZ = hitPoint.z + offset.z * 1.0;
        // Snap to ground at destination
        destGroundY = baseGroundY;
        if (typeof window.getGroundHeight === 'function') {
          var testPt = new THREE.Vector3(destX, hitPoint.y, destZ);
          var gh = window.getGroundHeight(testPt, solids, hitPoint.y, false);
          if (gh >= baseGroundY) destGroundY = gh;
        }
      }
    }

    // Range clamp: if flat XZ distance exceeds maxRange, clamp and re-snap ground
    var dx = destX - origin.x;
    var dz = destZ - origin.z;
    var flatDist = Math.sqrt(dx * dx + dz * dz);
    if (flatDist > maxRange) {
      var scale = maxRange / flatDist;
      destX = origin.x + dx * scale;
      destZ = origin.z + dz * scale;
      // Re-snap ground at clamped position
      destGroundY = baseGroundY;
      if (typeof window.getGroundHeight === 'function') {
        var clampPt = new THREE.Vector3(destX, origin.y, destZ);
        var gh2 = window.getGroundHeight(clampPt, solids, origin.y, false);
        if (gh2 >= baseGroundY) destGroundY = gh2;
      }
    }

    // LOS check: ray to standing height above destination (not the surface
    // itself, which would clip through the block the player is landing on)
    if (typeof window.hasBlockingBetween === 'function') {
      var ghostBase = new THREE.Vector3(destX, destGroundY + 1.5, destZ);
      if (window.hasBlockingBetween(origin, ghostBase, solids)) {
        return _calcTeleportDestFallback(player, params);
      }
    }

    return { x: destX, z: destZ, groundY: destGroundY };
  }

  // Helper: create translucent ghost mesh for teleport preview
  function _createTeleportGhost(player) {
    if (typeof THREE === 'undefined' || !window.scene) return null;
    var group = new THREE.Group();
    // Solid silhouette: body cylinder + head sphere + wireframe outline
    var bodyGeom = new THREE.CylinderGeometry(0.35, 0.35, 1.5, 12);
    var headGeom = new THREE.SphereGeometry(0.25, 10, 8);
    var mat = new THREE.MeshBasicMaterial({ color: 0x9944ff, transparent: true, opacity: 0.45 });
    var body = new THREE.Mesh(bodyGeom, mat);
    body.position.y = 0.75;
    group.add(body);
    var head = new THREE.Mesh(headGeom, mat);
    head.position.y = 1.7;
    group.add(head);
    // Wireframe outline for visibility at distance
    var wireMat = new THREE.MeshBasicMaterial({ color: 0xcc88ff, wireframe: true, transparent: true, opacity: 0.6 });
    var wireBody = new THREE.Mesh(bodyGeom, wireMat);
    wireBody.position.y = 0.75;
    group.add(wireBody);
    // Ground ring indicator
    var ringGeom = new THREE.RingGeometry(0.5, 0.7, 24);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x9944ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    var ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    group.traverse(function (c) { c.frustumCulled = false; });
    window.scene.add(group);
    return group;
  }

  function _removeTeleportGhost(player) {
    if (!player._teleportGhost) return;
    if (window.scene) window.scene.remove(player._teleportGhost);
    player._teleportGhost.traverse(function (c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    delete player._teleportGhost;
  }

  // ─── Teleport Effect ─────────────────────────────────────────────
  // Mage Q: Press Q to show preview ghost at destination. Press Q again or
  // left-click to confirm and blink. Preview stays open until confirmed or
  // safety timeout (duration) expires.

  AbilityManager.registerEffect('teleport', {
    onActivate: function (player, params) {
      var am = player.abilityManager;
      var manaCost = params.manaCost || 30;

      // Mana check — return false to abort activation if not enough mana
      // (mana is NOT consumed here; it's deferred to confirmation in onEnd)
      if (am && am.hasMana && am.hasMana()) {
        if (am.getMana() < manaCost) {
          return false;
        }
      }

      // Calculate initial destination
      var dest = _calcTeleportDest(player, params);
      player._teleportDest = dest;
      player._teleportPreviewing = true;
      player._teleportCancelled = false;
      // Track fire state so we only confirm on a NEW click, not held fire
      var inp = player.input || {};
      player._teleportPrevFire = !!inp.fireDown;
      player._teleportPrevAbility1 = !!inp.ability1;
      player._teleportPrevSecondary = !!inp.secondaryDown;
      // Skip confirmation on the activation frame (Q is still down)
      player._teleportActivatedFrame = true;

      // Create ghost mesh at destination
      player._teleportGhost = _createTeleportGhost(player);
      if (player._teleportGhost) {
        player._teleportGhost.position.set(dest.x, dest.groundY, dest.z);
      }

      // Show purple screen tint to indicate preview mode
      if (player.cameraAttached) {
        _showScreenOverlay('teleportOverlay', 'rgba(153,68,255,0.12)', 1);
      }

      if (typeof window.playSound === 'function') window.playSound('teleport');
    },

    onTick: function (player, params, dt) {
      if (!player._teleportPreviewing) return;

      var inp = player.input || {};

      // ── Right-click cancel detection (rising edge of secondaryDown) ──
      if (!player._teleportActivatedFrame) {
        var secondaryRising = !!inp.secondaryDown && !player._teleportPrevSecondary;
        if (secondaryRising) {
          player._teleportCancelled = true;
          // Force-end the effect to trigger onEnd → cancel cleanup
          var am = player.abilityManager;
          if (am && am._activeEffects['teleport']) {
            am._activeEffects['teleport'].remaining = 0;
          }
          player._teleportPrevSecondary = !!inp.secondaryDown;
          return;
        }
      }

      // Check for confirmation: NEW Q press or NEW left-click (rising edge only)
      // This prevents instant confirmation when the player is holding fire.
      if (!player._teleportActivatedFrame) {
        var fireRising = !!inp.fireDown && !player._teleportPrevFire;
        var abilityRising = !!inp.ability1 && !player._teleportPrevAbility1;
        if (abilityRising || fireRising) {
          // Consume fireDown so weapon doesn't fire on the same frame
          if (inp.fireDown) inp.fireDown = false;
          // Force-end the effect to trigger onEnd → teleport
          var am2 = player.abilityManager;
          if (am2 && am2._activeEffects['teleport']) {
            am2._activeEffects['teleport'].remaining = 0;
          }
          player._teleportPrevFire = !!inp.fireDown;
          player._teleportPrevAbility1 = !!inp.ability1;
          player._teleportPrevSecondary = !!inp.secondaryDown;
          return;
        }
      }
      // Clear activation frame flag after first tick
      delete player._teleportActivatedFrame;
      player._teleportPrevFire = !!inp.fireDown;
      player._teleportPrevAbility1 = !!inp.ability1;
      player._teleportPrevSecondary = !!inp.secondaryDown;

      // Recalculate destination each frame based on current look direction
      var dest = _calcTeleportDest(player, params);
      player._teleportDest = dest;

      // Update ghost position
      if (player._teleportGhost) {
        player._teleportGhost.position.set(dest.x, dest.groundY, dest.z);
        // Pulse ghost opacity (fixed range to avoid feedback drift)
        var t = performance.now() * 0.006;
        var pulse = 0.35 + 0.2 * Math.sin(t);
        player._teleportGhost.traverse(function (c) {
          if (c.material && c.material.opacity !== undefined) {
            c.material.opacity = pulse;
          }
        });
      }

      // Pulse screen overlay
      if (player.cameraAttached) {
        var el = document.getElementById('teleportOverlay');
        if (el) {
          var a = 0.08 + 0.06 * Math.sin(performance.now() * 0.004);
          el.style.backgroundColor = 'rgba(153,68,255,' + a.toFixed(3) + ')';
        }
      }
    },

    onEnd: function (player, params) {
      var am = player.abilityManager;
      var manaCost = params.manaCost || 30;

      if (player._teleportCancelled) {
        // ── Cancelled: no teleport, no mana cost, clear cooldown ──
        if (am) delete am._cooldowns['teleport'];
      } else {
        // ── Confirmed: consume mana NOW and teleport ──
        var canAfford = true;
        if (am && am.hasMana && am.hasMana()) {
          if (!am.consumeMana(manaCost)) {
            // Insufficient mana at confirmation — treat as cancel
            canAfford = false;
            if (am) delete am._cooldowns['teleport'];
          }
        }

        var dest = player._teleportDest;
        if (dest && canAfford) {
          var eyeH = window.EYE_HEIGHT || 1.6;

          // Burst at origin
          _spawnBurstParticle(player.position.clone(), 0x9944ff, 0.4, 300);

          player.position.x = dest.x;
          player.position.z = dest.z;
          player.feetY = dest.groundY;
          player.position.y = dest.groundY + eyeH;
          player.grounded = true;
          player.verticalVelocity = 0;

          // Sync camera for local player
          if (player.cameraAttached && window.camera) {
            window.camera.position.set(player.position.x, player.position.y, player.position.z);
          }
          if (typeof player._syncMeshPosition === 'function') player._syncMeshPosition();

          // Burst at destination
          _spawnBurstParticle(player.position.clone(), 0x9944ff, 0.5, 400);
        }
      }

      // Clean up ghost + overlay + flags (always runs)
      _removeTeleportGhost(player);
      _hideScreenOverlay('teleportOverlay');
      delete player._teleportDest;
      delete player._teleportPreviewing;
      delete player._teleportCancelled;
      delete player._teleportActivatedFrame;
      delete player._teleportPrevFire;
      delete player._teleportPrevAbility1;
      delete player._teleportPrevSecondary;
    }
  });

  // ─── Piercing Blast Effect ───────────────────────────────────────
  // Mage right-click: Hold to charge (drains mana), release to fire beam.
  // Cooldown starts AFTER firing, not on activation.

  function _pbFireBeam(player, params) {
    var damage = (player._pbManaSpent || 0) * (params.damagePerMana || 2);
    var beamRange = params.beamRange || 50;
    var dir = _getFullLookDir(player);
    var origin = player.position.clone();

    // Simple hitscan: check all enemy candidates
    var candidates = _getGrappleCandidates();
    var bestHit = null;
    var bestDist = beamRange + 1;

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c === player) continue;
      if (!c.alive) continue;

      // Sphere intersection test — use getHitTarget for accurate bounding if available
      var hitTarget = (typeof c.getHitTarget === 'function') ? c.getHitTarget() : null;
      var targetPos = hitTarget ? hitTarget.position : c.position;
      var hitRadius = hitTarget ? hitTarget.radius : (c.radius || 1.0);
      var toC = targetPos.clone().sub(origin);
      var dot = toC.dot(dir);
      if (dot < 0 || dot > beamRange) continue;
      var closest = origin.clone().add(dir.clone().multiplyScalar(dot));
      var dist = closest.distanceTo(targetPos);
      if (dist < hitRadius && dot < bestDist) {
        bestDist = dot;
        bestHit = c;
      }
    }

    // Deal damage to first hit
    if (bestHit && typeof bestHit.takeDamage === 'function' && damage > 0) {
      bestHit.takeDamage(damage);
    }

    // Visual: beam line from player to hit/max range
    if (typeof THREE !== 'undefined' && window.scene) {
      var endPt = bestHit ? bestHit.position.clone() : origin.clone().add(dir.clone().multiplyScalar(beamRange));
      var geom = new THREE.BufferGeometry();
      var positions = new Float32Array([
        origin.x, origin.y, origin.z,
        endPt.x, endPt.y, endPt.z
      ]);
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      var mat = new THREE.LineBasicMaterial({ color: 0x9944ff, linewidth: 2, transparent: true, opacity: 1.0 });
      var beamLine = new THREE.Line(geom, mat);
      beamLine.frustumCulled = false;
      window.scene.add(beamLine);

      // Fade beam over 300ms
      var start = performance.now();
      function fadeBeam() {
        var elapsed = performance.now() - start;
        if (elapsed >= 300) {
          window.scene.remove(beamLine);
          geom.dispose();
          mat.dispose();
          return;
        }
        mat.opacity = 1.0 - (elapsed / 300);
        requestAnimationFrame(fadeBeam);
      }
      requestAnimationFrame(fadeBeam);

      // Impact burst if hit a target
      if (bestHit) {
        _spawnBurstParticle(bestHit.position.clone(), 0xcc66ff, 0.5, 300);
      }
    }

    if (typeof window.playSound === 'function') window.playSound('beam');

    // Override cooldown to post-fire duration (actual cooldown starts NOW)
    var am = player.abilityManager;
    if (am) {
      var postCd = params.postFireCooldownMs || 1000;
      am._cooldowns['piercingBlast'] = { remaining: postCd, total: postCd };
    }

    // Clean up charging state
    player._pbCharging = false;
    delete player._pbManaSpent;
    delete player._pbStartTime;

    // Clean up charge visual
    if (player._pbChargeVisual && window.scene) {
      window.scene.remove(player._pbChargeVisual);
      if (player._pbChargeVisual.geometry) player._pbChargeVisual.geometry.dispose();
      if (player._pbChargeVisual.material) player._pbChargeVisual.material.dispose();
      delete player._pbChargeVisual;
    }

    // Clean up screen overlay
    if (player.cameraAttached) _hideScreenOverlay('pbChargeOverlay');
  }

  AbilityManager.registerEffect('piercingBlast', {
    onActivate: function (player, params) {
      // Block activation if mana system is active but mana is empty
      var am = player.abilityManager;
      if (am && am.hasMana && am.hasMana() && am.getMana() <= 0) {
        return false;
      }

      player._pbCharging = true;
      player._pbManaSpent = 0;
      player._pbStartTime = performance.now();

      // Create charge visual: purple sphere in front of player
      if (typeof THREE !== 'undefined' && window.scene) {
        var geom = new THREE.SphereGeometry(0.2, 10, 10);
        var mat = new THREE.MeshBasicMaterial({ color: 0xbb77ff, transparent: true, opacity: 0.7 });
        player._pbChargeVisual = new THREE.Mesh(geom, mat);
        player._pbChargeVisual.frustumCulled = false;
        var dir = _getFullLookDir(player);
        player._pbChargeVisual.position.copy(player.position).add(dir.clone().multiplyScalar(1.2));
        window.scene.add(player._pbChargeVisual);
      }

      // Purple screen edge tint while charging
      if (player.cameraAttached) {
        _showScreenOverlay('pbChargeOverlay', 'transparent', 1);
        var el = document.getElementById('pbChargeOverlay');
        if (el) {
          el.style.background = 'radial-gradient(ellipse at center, transparent 50%, rgba(153,68,255,0.2) 100%)';
        }
      }
    },

    onTick: function (player, params, dt) {
      if (!player._pbCharging) return;

      var dtSec = dt / 1000;
      var am = player.abilityManager;
      var drainRate = params.manaDrainRate || 20;
      var maxChargeMs = params.maxChargeMs || 3000;

      // Drain mana while charging (partial drain if mana < full tick amount)
      var drainAmount = drainRate * dtSec;
      if (am && am.hasMana && am.hasMana()) {
        var available = am.getMana();
        if (available > 0) {
          var actualDrain = Math.min(drainAmount, available);
          am.consumeMana(actualDrain);
          player._pbManaSpent = (player._pbManaSpent || 0) + actualDrain;
        }
        // When mana runs out, charging simply stops draining (player releases to fire)
      } else {
        // No mana system — use time-based charge
        player._pbManaSpent = (player._pbManaSpent || 0) + drainAmount;
      }

      // Update charge visual: grow sphere + pulse + follow aim
      var chargeElapsed = performance.now() - (player._pbStartTime || 0);
      var chargePct = Math.min(1, chargeElapsed / maxChargeMs);

      if (player._pbChargeVisual) {
        var scale = 0.4 + chargePct * 1.6;
        player._pbChargeVisual.scale.setScalar(scale);
        player._pbChargeVisual.material.opacity = 0.5 + chargePct * 0.4;
        player._pbChargeVisual.material.color.setHex(chargePct < 0.5 ? 0xbb77ff : 0xdd99ff);
        var dir = _getFullLookDir(player);
        player._pbChargeVisual.position.copy(player.position).add(dir.clone().multiplyScalar(1.2));
      }

      // Update screen overlay intensity with charge
      if (player.cameraAttached) {
        var el = document.getElementById('pbChargeOverlay');
        if (el) {
          var alpha = 0.15 + chargePct * 0.25;
          el.style.background = 'radial-gradient(ellipse at center, transparent 40%, rgba(153,68,255,' + alpha.toFixed(2) + ') 100%)';
        }
      }

      // Auto-fire conditions: max charge reached, or right-click released
      var shouldFire = false;
      if (chargeElapsed >= maxChargeMs) shouldFire = true;
      if (player.input && player.input.secondaryDown === false) shouldFire = true;

      if (shouldFire) {
        _pbFireBeam(player, params);
      }
    },

    onEnd: function (player, params) {
      // If still charging when effect expires, fire the beam
      if (player._pbCharging) {
        _pbFireBeam(player, params);
      }
      delete player._pbCharging;
      delete player._pbManaSpent;
      delete player._pbStartTime;
      if (player._pbChargeVisual && window.scene) {
        window.scene.remove(player._pbChargeVisual);
        if (player._pbChargeVisual.geometry) player._pbChargeVisual.geometry.dispose();
        if (player._pbChargeVisual.material) player._pbChargeVisual.material.dispose();
        delete player._pbChargeVisual;
      }
      if (player.cameraAttached) _hideScreenOverlay('pbChargeOverlay');
    }
  });

  // ─── Meditate Effect ─────────────────────────────────────────────
  // Mage E: 5s channel, freezes player, restores mana. Interrupted by damage.
  // Movement freeze is handled by the game mode (before physics).
  // This effect handles: damage interrupt, mana restore, visuals.

  function _cleanupMeditateVisuals(player) {
    if (player._meditateRing && window.scene) {
      window.scene.remove(player._meditateRing);
      if (player._meditateRing.geometry) player._meditateRing.geometry.dispose();
      if (player._meditateRing.material) player._meditateRing.material.dispose();
      delete player._meditateRing;
    }
    if (player._meditateColumn && window.scene) {
      window.scene.remove(player._meditateColumn);
      player._meditateColumn.traverse(function (c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
      delete player._meditateColumn;
    }
    if (player.cameraAttached) _hideScreenOverlay('meditateOverlay');
  }

  AbilityManager.registerEffect('meditate', {
    onActivate: function (player, params) {
      player._meditating = true;
      player._meditateLastHP = player.health;

      var am = player.abilityManager;
      if (am && am.hasMana && am.hasMana()) {
        player._meditateStartMana = am.getMana();
      }

      // Visual: blue ring on ground
      if (typeof THREE !== 'undefined' && window.scene) {
        var ringGeom = new THREE.RingGeometry(1.0, 1.3, 32);
        var ringMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        player._meditateRing = new THREE.Mesh(ringGeom, ringMat);
        player._meditateRing.rotation.x = -Math.PI / 2;
        player._meditateRing.position.set(player.position.x, (player.feetY || 0) + 0.05, player.position.z);
        player._meditateRing.frustumCulled = false;
        window.scene.add(player._meditateRing);

        // Visual: translucent blue light column
        var colGeom = new THREE.CylinderGeometry(0.6, 0.8, 4, 16, 1, true);
        var colMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.08, side: THREE.DoubleSide });
        player._meditateColumn = new THREE.Mesh(colGeom, colMat);
        player._meditateColumn.position.set(player.position.x, (player.feetY || 0) + 2, player.position.z);
        player._meditateColumn.frustumCulled = false;
        window.scene.add(player._meditateColumn);
      }

      // Screen overlay for local player
      if (player.cameraAttached) {
        _showScreenOverlay('meditateOverlay', 'rgba(40,100,255,0.08)', 1);
      }

      if (typeof window.playSound === 'function') window.playSound('meditate');
    },

    onTick: function (player, params, dt) {
      if (!player._meditating) return;

      // Interrupt on damage
      var interruptOnDamage = params.interruptOnDamage !== false;
      if (interruptOnDamage && player.health < player._meditateLastHP) {
        player._meditating = false;
        _cleanupMeditateVisuals(player);
        return;
      }
      player._meditateLastHP = player.health;

      // Restore mana gradually over the duration
      var am = player.abilityManager;
      if (am && am.hasMana && am.hasMana() && am.addMana) {
        var duration = params.duration || 5000;
        var restoreFraction = params.manaRestoreFraction || 0.5;
        var maxMana = am.getMaxMana();
        var manaPerMs = maxMana * restoreFraction / duration;
        am.addMana(manaPerMs * dt);
      }

      // Animate visuals
      var t = performance.now() * 0.003;

      // Pulse ring
      if (player._meditateRing) {
        player._meditateRing.material.opacity = 0.3 + 0.25 * Math.sin(t);
        player._meditateRing.rotation.z += dt * 0.0005;
      }

      // Pulse column
      if (player._meditateColumn) {
        player._meditateColumn.material.opacity = 0.05 + 0.06 * Math.sin(t * 1.3);
        var colScale = 1.0 + 0.05 * Math.sin(t * 0.7);
        player._meditateColumn.scale.set(colScale, 1, colScale);
      }

      // Pulse screen overlay
      if (player.cameraAttached) {
        var el = document.getElementById('meditateOverlay');
        if (el) {
          var a = 0.06 + 0.04 * Math.sin(t * 1.5);
          el.style.backgroundColor = 'rgba(40,100,255,' + a.toFixed(3) + ')';
        }
      }
    },

    onEnd: function (player) {
      player._meditating = false;
      _cleanupMeditateVisuals(player);

      var am = player.abilityManager;
      if (am && am.resetManaRegenDelay) am.resetManaRegenDelay();

      delete player._meditateLastHP;
      delete player._meditateStartMana;
    }
  });

})();
