/**
 * player.js — Unified Player class
 *
 * PURPOSE: Shared player entity used by all game modes (AI, LAN, Training Range).
 * Holds position/physics, health, weapon, 3D mesh, 3D health bar, and hitbox.
 * Compatible with updateFullPhysics() (same property shape).
 *
 * EXPORTS (window):
 *   Player — constructor function
 *
 * DEPENDENCIES: Three.js (THREE), game.js (scene global),
 *   physics.js (GROUND_Y, EYE_HEIGHT), weapon.js (Weapon),
 *   weaponModels.js (buildWeaponModel — optional, fallback if absent)
 *
 * WEAPON ATTACHMENT SYSTEM:
 *   The player mesh uses a swappable weapon attachment point (_weaponAttachPoint),
 *   a THREE.Group positioned where the gun is held. The active weapon model is a
 *   child of this group. When heroes.js applies a new hero, it calls
 *   swapWeaponModel(modelType) to replace the weapon mesh without rebuilding the
 *   entire player. If weaponModels.js is not loaded, a simple gray box fallback
 *   is used instead. Body-part meshes (head, torso) are tagged with
 *   userData.isBodyPart = true so that heroes.js can recolor them without
 *   accidentally recoloring the weapon.
 */

(function () {

  function Player(opts) {
    opts = opts || {};

    // --- Position / Physics (matches updateFullPhysics shape) ---
    this.position = opts.position ? opts.position.clone() : new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 0);
    this.feetY = (typeof opts.feetY === 'number') ? opts.feetY : GROUND_Y;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.walkSpeed = opts.walkSpeed || 4.5;
    this.sprintSpeed = opts.sprintSpeed || 8.5;
    this.radius = opts.radius || 0.5;

    // --- Health ---
    this.maxHealth = opts.maxHealth || 100;
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamagedAt = -Infinity;

    // --- Weapon ---
    if (opts.weapon instanceof Weapon) {
      this.weapon = opts.weapon;
    } else if (opts.weapon) {
      this.weapon = new Weapon(opts.weapon);
    } else {
      this.weapon = new Weapon();
    }

    // --- Jump velocity (overridable by heroes.js) ---
    this._jumpVelocity = (typeof JUMP_VELOCITY !== 'undefined') ? JUMP_VELOCITY : 8.5;

    // --- Camera attachment ---
    this.cameraAttached = !!opts.cameraAttached;

    // --- 3D Mesh ---
    this._color = opts.color || 0xff5555;
    this._meshGroup = new THREE.Group();
    this._buildMesh();
    this._computeMeshMetrics();

    // Place mesh at initial position
    this._syncMeshPosition();

    // Hide mesh if camera-attached
    if (this.cameraAttached) {
      this._meshGroup.visible = false;
    }

    // Add to scene
    if (typeof scene !== 'undefined' && scene) {
      scene.add(this._meshGroup);
    }

    // --- 3D Health Bar ---
    this._buildHealthBar3D();
  }

  // --- Mesh Construction ---

  Player.prototype._buildMesh = function () {
    var bodyMat = new THREE.MeshLambertMaterial({ color: this._color });

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
    head.position.set(0, 1.6, 0);
    head.userData.isBodyPart = true;
    this._headMesh = head;

    var torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 16), bodyMat);
    torso.position.set(0, 1.1, 0);
    torso.userData.isBodyPart = true;

    // Weapon attachment point — swappable weapon model sits here
    this._weaponAttachPoint = new THREE.Group();
    this._weaponAttachPoint.position.set(0.35, 1.4, -0.1);

    // Build initial weapon model (fall back to gray box if weaponModels.js not loaded)
    if (typeof buildWeaponModel === 'function') {
      var modelType = (this.weapon && this.weapon.modelType) ? this.weapon.modelType : 'default';
      var weaponModel = buildWeaponModel(modelType);
      this._weaponAttachPoint.add(weaponModel);
    } else {
      var fallbackGun = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.1, 0.1),
        new THREE.MeshLambertMaterial({ color: 0x333333 })
      );
      this._weaponAttachPoint.add(fallbackGun);
    }

    this._meshGroup.add(head, torso, this._weaponAttachPoint);
    this._meshGroup.scale.set(2.0, 2.0, 2.0);
  };

  Player.prototype._computeMeshMetrics = function () {
    // Compute feet offset: how much to shift mesh Y so feet sit at feetY
    try {
      this._meshGroup.position.set(0, 0, 0);
      var bbox = new THREE.Box3().setFromObject(this._meshGroup);
      this._meshFeetOffset = -bbox.min.y; // positive: add to feetY to get mesh.position.y

      // Hitbox: center height relative to feet, and radius
      var center = bbox.getCenter(new THREE.Vector3());
      // center.y is the center of the mesh when positioned at origin
      // _meshFeetOffset shifts the mesh up so feet are at feetY
      // So hit center relative to feet = center.y + _meshFeetOffset
      this._hitCenterRelative = center.y + this._meshFeetOffset;

      var size = bbox.getSize(new THREE.Vector3());
      this._hitRadius = Math.max(size.x, size.z) * 0.5;
    } catch (e) {
      console.warn('Player: failed to compute mesh metrics:', e);
      this._meshFeetOffset = 0;
      this._hitCenterRelative = EYE_HEIGHT * 0.5;
      this._hitRadius = 0.6;
    }
  };

  // --- Weapon Model Swap ---

  /**
   * Replace the current weapon model in the attachment point with a new one.
   * @param {string} modelType — key into WEAPON_MODEL_REGISTRY (e.g. 'rifle', 'shotgun')
   */
  Player.prototype.swapWeaponModel = function (modelType) {
    if (!this._weaponAttachPoint) return;

    // Remove and dispose old weapon children
    while (this._weaponAttachPoint.children.length > 0) {
      var old = this._weaponAttachPoint.children[0];
      this._weaponAttachPoint.remove(old);
      if (old.traverse) {
        old.traverse(function (c) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
      }
    }

    // Build and attach new model (fallback to gray box if weaponModels.js not loaded)
    if (typeof buildWeaponModel === 'function') {
      var weaponModel = buildWeaponModel(modelType || 'default');
      this._weaponAttachPoint.add(weaponModel);
    } else {
      var fallbackGun = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.1, 0.1),
        new THREE.MeshLambertMaterial({ color: 0x333333 })
      );
      this._weaponAttachPoint.add(fallbackGun);
    }
  };

  // --- 3D Health Bar ---

  Player.prototype._buildHealthBar3D = function () {
    var barWidth = 0.6;
    var barHeight = 0.06;
    var barDepth = 0.02;

    var bgGeom = new THREE.BoxGeometry(barWidth, barHeight, barDepth);
    var bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, depthTest: false });
    this._healthBarBg = new THREE.Mesh(bgGeom, bgMat);
    this._healthBarBg.renderOrder = 999;

    var fillGeom = new THREE.BoxGeometry(barWidth, barHeight, barDepth);
    var fillMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, depthTest: false });
    this._healthBarFill = new THREE.Mesh(fillGeom, fillMat);
    this._healthBarFill.renderOrder = 1000;
    this._healthBarFill.position.z = barDepth * 0.5 + 0.001;

    this._healthBarGroup = new THREE.Group();
    this._healthBarGroup.add(this._healthBarBg);
    this._healthBarGroup.add(this._healthBarFill);
    // Position above head (local coords, before parent scale)
    this._healthBarGroup.position.set(0, 2.05, 0);
    this._healthBarGroup.visible = false;
    this._healthBarWidth = barWidth;
    this._meshGroup.add(this._healthBarGroup);
  };

  // --- Position Sync ---

  Player.prototype._syncMeshPosition = function () {
    this._meshGroup.position.set(
      this.position.x,
      this.feetY + this._meshFeetOffset,
      this.position.z
    );
  };

  Player.prototype.syncCameraFromPlayer = function () {
    if (!this.cameraAttached) return;
    if (typeof camera !== 'undefined' && camera) {
      camera.position.set(this.position.x, this.feetY + EYE_HEIGHT, this.position.z);
    }
  };

  // --- Hitbox ---

  Player.prototype.getHitCenter = function () {
    return new THREE.Vector3(
      this.position.x,
      this.feetY + this._hitCenterRelative,
      this.position.z
    );
  };

  Player.prototype.getHitTarget = function () {
    return {
      position: this.getHitCenter(),
      radius: this._hitRadius
    };
  };

  // --- Eye Position ---

  Player.prototype.getEyePos = function () {
    return new THREE.Vector3(this.position.x, this.feetY + EYE_HEIGHT, this.position.z);
  };

  // --- Health Bar Update ---

  Player.prototype.update3DHealthBar = function (cameraPos, solids, opts) {
    if (!this._healthBarGroup) return;
    opts = opts || {};
    var checkLOS = !!opts.checkLOS;

    var now = performance.now();
    var recentlyDamaged = this.lastDamagedAt > 0 && (now - this.lastDamagedAt) <= 5000;
    var showBar = recentlyDamaged && this.alive && this.health < this.maxHealth;

    // LOS check: hide if blocked by world geometry
    if (showBar && checkLOS && cameraPos && solids) {
      var barWorldPos = new THREE.Vector3();
      this._healthBarGroup.getWorldPosition(barWorldPos);
      if (hasBlockingBetween(cameraPos, barWorldPos, solids)) {
        showBar = false;
      }
    }

    this._healthBarGroup.visible = showBar;

    if (showBar) {
      // Billboard: counter parent rotation to face camera
      var worldPos = new THREE.Vector3();
      this._healthBarGroup.getWorldPosition(worldPos);
      var lookDir = cameraPos.clone().sub(worldPos);
      lookDir.y = 0;
      if (lookDir.lengthSq() > 1e-6) {
        var worldYaw = Math.atan2(lookDir.x, lookDir.z);
        this._healthBarGroup.rotation.y = worldYaw - this._meshGroup.rotation.y;
      }

      // Fill width + color
      var pct = Math.max(0, Math.min(1, this.health / this.maxHealth));
      this._healthBarFill.scale.x = Math.max(0.001, pct);
      this._healthBarFill.position.x = -(1 - pct) * this._healthBarWidth * 0.5;
      var r = pct < 0.5 ? 1.0 : 1.0 - (pct - 0.5) * 2.0;
      var g = pct < 0.5 ? pct * 2.0 : 1.0;
      this._healthBarFill.material.color.setRGB(r, g, 0);

      // Fade out in the last second
      var timeSinceHit = now - this.lastDamagedAt;
      if (timeSinceHit > 4000) {
        var fadeAlpha = 1.0 - (timeSinceHit - 4000) / 1000;
        this._healthBarFill.material.opacity = Math.max(0, fadeAlpha);
        this._healthBarFill.material.transparent = true;
        this._healthBarBg.material.opacity = Math.max(0, fadeAlpha);
        this._healthBarBg.material.transparent = true;
      } else {
        this._healthBarFill.material.opacity = 1.0;
        this._healthBarFill.material.transparent = false;
        this._healthBarBg.material.opacity = 1.0;
        this._healthBarBg.material.transparent = false;
      }
    }
  };

  // --- Facing ---

  Player.prototype.faceToward = function (targetPos) {
    var dx = targetPos.x - this.position.x;
    var dz = targetPos.z - this.position.z;
    var yaw = Math.atan2(dx, dz);
    this._meshGroup.rotation.set(0, yaw, 0);
  };

  // --- Damage ---

  Player.prototype.takeDamage = function (amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamagedAt = performance.now();
    if (this.health <= 0) {
      this.alive = false;
      this.health = 0;
      this._meshGroup.visible = false;
      if (this._healthBarGroup) this._healthBarGroup.visible = false;
    }
  };

  // --- Round Reset ---

  Player.prototype.resetForRound = function (spawnPos) {
    this.health = this.maxHealth;
    this.alive = true;
    this.lastDamagedAt = -Infinity;
    this.feetY = GROUND_Y;
    this.verticalVelocity = 0;
    this.grounded = true;

    if (spawnPos) {
      this.position.set(spawnPos.x, GROUND_Y + EYE_HEIGHT, spawnPos.z);
    }

    this.weapon.reset();

    this._meshGroup.visible = !this.cameraAttached;
    this._syncMeshPosition();
    if (this._healthBarGroup) this._healthBarGroup.visible = false;
  };

  // --- Visibility ---

  Player.prototype.setVisible = function (visible) {
    this._meshGroup.visible = visible;
  };

  // --- Cleanup ---

  Player.prototype.destroy = function () {
    if (this._healthBarGroup) {
      if (this._healthBarFill) {
        this._healthBarFill.geometry.dispose();
        this._healthBarFill.material.dispose();
      }
      if (this._healthBarBg) {
        this._healthBarBg.geometry.dispose();
        this._healthBarBg.material.dispose();
      }
      this._healthBarGroup = null;
      this._healthBarFill = null;
      this._healthBarBg = null;
    }
    if (this._meshGroup && this._meshGroup.parent) {
      this._meshGroup.parent.remove(this._meshGroup);
    }
    // Dispose mesh children geometries/materials
    if (this._meshGroup) {
      this._meshGroup.traverse(function (child) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
  };

  window.Player = Player;

})();
