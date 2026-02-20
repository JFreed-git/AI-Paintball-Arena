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
    // Attach mana info if this hero uses mana
    result._mana = this._hasMana ? this._mana : null;
    result._maxMana = this._hasMana ? this._maxMana : null;
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

  // Helper: get look direction (horizontal only) for local/AI player
  function _getHorizontalLookDir(player) {
    var dir;
    if (typeof THREE !== 'undefined') {
      var quat;
      if (window.camera && player.cameraAttached) {
        quat = window.camera.quaternion;
      } else if (player._meshGroup) {
        quat = player._meshGroup.quaternion;
      } else if (player.mesh) {
        quat = player.mesh.quaternion;
      }
      if (quat) {
        dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      }
    }
    if (!dir) dir = new THREE.Vector3(0, 0, -1);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    return dir;
  }

  // Helper: get full look direction (with vertical component) for beam aiming
  function _getFullLookDir(player) {
    var dir;
    if (typeof THREE !== 'undefined') {
      var quat;
      if (window.camera && player.cameraAttached) {
        quat = window.camera.quaternion;
      } else if (player._meshGroup) {
        quat = player._meshGroup.quaternion;
      } else if (player.mesh) {
        quat = player.mesh.quaternion;
      }
      if (quat) {
        dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      }
    }
    if (!dir) dir = new THREE.Vector3(0, 0, -1);
    return dir.normalize();
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

  // ─── Teleport Effect ─────────────────────────────────────────────
  // Mage Q: Instant blink in look direction. Costs mana. Snaps to ground.

  AbilityManager.registerEffect('teleport', {
    onActivate: function (player, params) {
      var am = player.abilityManager;
      var manaCost = params.manaCost || 30;

      // Mana check (guarded)
      if (am && am.hasMana && am.hasMana()) {
        if (!am.consumeMana(manaCost)) {
          // Not enough mana — cooldown still applies (simplest approach)
          return;
        }
      }

      var maxRange = params.maxRange || 25;
      var snapTolerance = params.snapTolerance || 1.5;
      var dir = _getHorizontalLookDir(player);
      var origin = player.position.clone();
      var solids = _getMageSolids();

      // Visual burst at origin
      _spawnBurstParticle(origin.clone(), 0x9944ff, 0.4, 300);

      // Raycast forward to find wall — binary search for maximum clear distance
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

      var eyeH = window.EYE_HEIGHT || 1.6;
      player.position.x = dest.x;
      player.position.z = dest.z;
      player.feetY = groundY;
      player.position.y = groundY + eyeH;
      player.grounded = true;
      player.verticalVelocity = 0;

      // Sync camera for local player
      if (player.cameraAttached && window.camera) {
        window.camera.position.set(player.position.x, player.position.y, player.position.z);
      }
      if (typeof player._syncMeshPosition === 'function') player._syncMeshPosition();

      // Visual burst at destination
      _spawnBurstParticle(player.position.clone(), 0x9944ff, 0.4, 300);

      if (typeof window.playSound === 'function') window.playSound('teleport');
    },

    onEnd: function (player) {
      // No persistent visuals to clean up
    }
  });

  // ─── Piercing Blast Effect ───────────────────────────────────────
  // Mage right-click: Hold to charge (drains mana), release to fire beam.

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

      // Simple sphere intersection test
      var toC = c.position.clone().sub(origin);
      var dot = toC.dot(dir);
      if (dot < 0 || dot > beamRange) continue;
      var closest = origin.clone().add(dir.clone().multiplyScalar(dot));
      var dist = closest.distanceTo(c.position);
      var hitRadius = c.radius || 0.6;
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

      // Fade beam over 200ms
      var start = performance.now();
      function fadeBeam() {
        var elapsed = performance.now() - start;
        if (elapsed >= 200) {
          window.scene.remove(beamLine);
          geom.dispose();
          mat.dispose();
          return;
        }
        mat.opacity = 1.0 - (elapsed / 200);
        requestAnimationFrame(fadeBeam);
      }
      requestAnimationFrame(fadeBeam);
    }

    if (typeof window.playSound === 'function') window.playSound('beam');

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
  }

  AbilityManager.registerEffect('piercingBlast', {
    onActivate: function (player, params) {
      player._pbCharging = true;
      player._pbManaSpent = 0;
      player._pbStartTime = performance.now();

      // Create charge visual: small growing purple sphere in front of player
      if (typeof THREE !== 'undefined' && window.scene) {
        var geom = new THREE.SphereGeometry(0.15, 8, 8);
        var mat = new THREE.MeshBasicMaterial({ color: 0x9944ff, transparent: true, opacity: 0.6 });
        player._pbChargeVisual = new THREE.Mesh(geom, mat);
        player._pbChargeVisual.frustumCulled = false;
        var dir = _getFullLookDir(player);
        player._pbChargeVisual.position.copy(player.position).add(dir.multiplyScalar(1.5));
        window.scene.add(player._pbChargeVisual);
      }
    },

    onTick: function (player, params, dt) {
      if (!player._pbCharging) return;

      var dtSec = dt / 1000;
      var am = player.abilityManager;
      var drainRate = params.manaDrainRate || 20;
      var maxChargeMs = params.maxChargeMs || 3000;

      // Drain mana while charging
      var drainAmount = drainRate * dtSec;
      var drained = false;
      if (am && am.hasMana && am.hasMana()) {
        drained = am.consumeMana(drainAmount);
        if (drained) {
          player._pbManaSpent = (player._pbManaSpent || 0) + drainAmount;
        }
      } else {
        // No mana system — use time-based charge
        player._pbManaSpent = (player._pbManaSpent || 0) + drainAmount;
        drained = true;
      }

      // Update charge visual size and position
      if (player._pbChargeVisual) {
        var chargeElapsed = performance.now() - (player._pbStartTime || 0);
        var chargePct = Math.min(1, chargeElapsed / maxChargeMs);
        var scale = 0.5 + chargePct * 1.5;
        player._pbChargeVisual.scale.setScalar(scale);
        var dir = _getFullLookDir(player);
        player._pbChargeVisual.position.copy(player.position).add(dir.multiplyScalar(1.5));
      }

      // Auto-fire conditions: mana ran out, max charge reached, or right-click released
      var elapsed = performance.now() - (player._pbStartTime || 0);
      var shouldFire = false;
      if (!drained) shouldFire = true;
      if (elapsed >= maxChargeMs) shouldFire = true;
      if (player.input && player.input.secondaryDown === false) shouldFire = true;

      if (shouldFire) {
        _pbFireBeam(player, params);
      }
    },

    onEnd: function (player) {
      // If still charging when effect expires, fire the beam
      if (player._pbCharging) {
        _pbFireBeam(player, {});
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
    }
  });

  // ─── Meditate Effect ─────────────────────────────────────────────
  // Mage E: 5s channel, freezes player, restores mana. Interrupted by damage.

  AbilityManager.registerEffect('meditate', {
    onActivate: function (player, params) {
      player._meditating = true;
      player._meditateLastHP = player.health;

      var am = player.abilityManager;
      if (am && am.hasMana && am.hasMana()) {
        player._meditateStartMana = am.getMana();
      }

      // Visual: blue circle on ground
      if (typeof THREE !== 'undefined' && window.scene) {
        var ringGeom = new THREE.RingGeometry(1.0, 1.3, 32);
        var ringMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
        player._meditateRing = new THREE.Mesh(ringGeom, ringMat);
        player._meditateRing.rotation.x = -Math.PI / 2;
        player._meditateRing.position.set(player.position.x, (player.feetY || 0) + 0.05, player.position.z);
        player._meditateRing.frustumCulled = false;
        window.scene.add(player._meditateRing);
      }

      if (typeof window.playSound === 'function') window.playSound('meditate');
    },

    onTick: function (player, params, dt) {
      if (!player._meditating) return;

      // FREEZE player — override all movement/combat input
      if (player.input) {
        player.input.moveX = 0;
        player.input.moveZ = 0;
        player.input.sprint = false;
        player.input.jump = false;
        player.input.fireDown = false;
      }

      // Interrupt on damage
      var interruptOnDamage = params.interruptOnDamage !== false;
      if (interruptOnDamage && player.health < player._meditateLastHP) {
        player._meditating = false;
        if (player._meditateRing && window.scene) {
          window.scene.remove(player._meditateRing);
          if (player._meditateRing.geometry) player._meditateRing.geometry.dispose();
          if (player._meditateRing.material) player._meditateRing.material.dispose();
          delete player._meditateRing;
        }
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

      // Pulse ring visual
      if (player._meditateRing) {
        var t = performance.now() * 0.003;
        player._meditateRing.material.opacity = 0.3 + 0.2 * Math.sin(t);
      }
    },

    onEnd: function (player) {
      player._meditating = false;

      if (player._meditateRing && window.scene) {
        window.scene.remove(player._meditateRing);
        if (player._meditateRing.geometry) player._meditateRing.geometry.dispose();
        if (player._meditateRing.material) player._meditateRing.material.dispose();
        delete player._meditateRing;
      }

      var am = player.abilityManager;
      if (am && am.resetManaRegenDelay) am.resetManaRegenDelay();

      delete player._meditateLastHP;
      delete player._meditateStartMana;
    }
  });

})();
