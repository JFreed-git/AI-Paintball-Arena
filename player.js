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
 * SEGMENTED HITBOX SYSTEM:
 *   Each player has an array of hitbox segments (head, torso, legs, etc.) stored
 *   in _hitboxConfig. Supports 4 shape types via `shape` field:
 *     - 'box' (default): width, height, depth → AABB Box3
 *     - 'sphere': radius → center Vector3 + radius
 *     - 'cylinder': radius, height → center Vector3 + radius + halfHeight
 *     - 'capsule': radius, height → center Vector3 + radius + halfHeight
 *   All shapes have: name, offsetX, offsetY, offsetZ, damageMultiplier.
 *   Segments without a shape field default to 'box' for backward compat.
 *   Segments are repositioned each frame in _syncMeshPosition() via
 *   _updateHitboxes(). getHitSegments() returns the current positioned segments
 *   for collision testing. getHitTarget() returns a bounding sphere enclosing
 *   all segments (works with all shapes).
 *
 * CAPSULE GEOMETRY:
 *   buildCapsuleGeometry(radius, totalHeight, radialSegs, heightSegs) creates a
 *   capsule using LatheGeometry (Three.js r128 has no CapsuleGeometry). Exposed
 *   on window for use by devHeroEditor.js and devConsole.js.
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

  var DEFAULT_HITBOX_CONFIG = [
    { name: "head",  width: 0.5, height: 0.5, depth: 0.5, offsetX: 0, offsetY: 2.95, offsetZ: 0, damageMultiplier: 2.0 },
    { name: "torso", width: 0.6, height: 0.9, depth: 0.5, offsetX: 0, offsetY: 2.05, offsetZ: 0, damageMultiplier: 1.0 },
    { name: "legs",  width: 0.5, height: 1.1, depth: 0.5, offsetX: 0, offsetY: 0.55, offsetZ: 0, damageMultiplier: 0.75 }
  ];

  var DEFAULT_BODY_PARTS = [
    { name: "head", shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 1.6, offsetZ: 0 },
    { name: "torso", shape: "cylinder", radius: 0.275, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0 }
  ];

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

    // --- Body parts (custom hero visual model) ---
    this._bodyParts = opts.bodyParts || null;

    // --- 3D Mesh ---
    this._color = opts.color || 0xff5555;
    this._meshGroup = new THREE.Group();
    this._buildMesh();
    this._computeMeshMetrics();

    // Segmented hitbox
    this._hitboxConfig = DEFAULT_HITBOX_CONFIG;
    this._hitSegments = [];
    this._hitboxYaw = 0;  // Player's own facing yaw (set by game mode, independent of visual mesh rotation)
    this._buildHitSegments();

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
    var parts = (this._bodyParts && this._bodyParts.length > 0)
      ? this._bodyParts : DEFAULT_BODY_PARTS;
    this._buildMeshFromBodyParts(parts);
  };

  /**
   * Build mesh from custom bodyParts array.
   * Each part: { name, shape, color, offsetX, offsetY, offsetZ, rotationX, rotationY, rotationZ,
   *              width, height, depth (box), radius (sphere/cylinder/capsule), height (cylinder/capsule) }
   */
  Player.prototype._buildMeshFromBodyParts = function (bodyParts) {
    var heroColor = this._color;

    for (var i = 0; i < bodyParts.length; i++) {
      var part = bodyParts[i];
      var shape = part.shape || 'box';
      var geom;

      if (shape === 'sphere') {
        geom = new THREE.SphereGeometry(part.radius || 0.25, 16, 12);
      } else if (shape === 'cylinder') {
        var r = part.radius || 0.3;
        var h = part.height || 0.5;
        geom = new THREE.CylinderGeometry(r, r, h, 16);
      } else if (shape === 'capsule') {
        geom = buildCapsuleGeometry(part.radius || 0.3, part.height || 0.5, 16, 8);
      } else {
        geom = new THREE.BoxGeometry(part.width || 0.5, part.height || 0.5, part.depth || 0.5);
      }

      var color = part.color ? new THREE.Color(part.color) : new THREE.Color(heroColor);
      var mat = new THREE.MeshLambertMaterial({ color: color });
      var mesh = new THREE.Mesh(geom, mat);

      mesh.position.set(part.offsetX || 0, part.offsetY || 0, part.offsetZ || 0);
      mesh.rotation.set(part.rotationX || 0, part.rotationY || 0, part.rotationZ || 0);
      mesh.userData.isBodyPart = true;

      this._meshGroup.add(mesh);
    }

    // Weapon attachment point
    this._weaponAttachPoint = new THREE.Group();
    this._weaponAttachPoint.position.set(0.35, 1.4, -0.1);

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

    this._meshGroup.add(this._weaponAttachPoint);
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

  // --- Capsule Geometry (Three.js r128 has no CapsuleGeometry) ---

  function buildCapsuleGeometry(radius, totalHeight, radialSegs, heightSegs) {
    radialSegs = radialSegs || 16;
    heightSegs = heightSegs || 8;
    var halfH = totalHeight / 2;
    var bodyHalfH = Math.max(0, halfH - radius);

    // Build 2D profile for LatheGeometry: south pole → bottom equator → top equator → north pole
    // LatheGeometry revolves a 2D profile (x, y) around the Y axis.
    // Profile traces the right edge of the capsule from bottom to top.
    var points = [];
    var hemiSegs = Math.max(4, Math.floor(heightSegs / 2));

    // Bottom hemisphere (south pole up to equator)
    // angle: -PI/2 (south pole, x=0) to 0 (equator, x=radius)
    for (var i = 0; i <= hemiSegs; i++) {
      var angle = -Math.PI / 2 + (Math.PI / 2) * (i / hemiSegs);
      var x = Math.cos(angle) * radius;
      var y = Math.sin(angle) * radius - bodyHalfH;
      points.push(new THREE.Vector2(x, y));
    }

    // Top hemisphere (equator up to north pole)
    // angle: 0 (equator, x=radius) to PI/2 (north pole, x=0)
    // LatheGeometry connects last bottom point to first top point → straight side
    for (var j = 0; j <= hemiSegs; j++) {
      var angle2 = (Math.PI / 2) * (j / hemiSegs);
      var x2 = Math.cos(angle2) * radius;
      var y2 = Math.sin(angle2) * radius + bodyHalfH;
      points.push(new THREE.Vector2(x2, y2));
    }

    return new THREE.LatheGeometry(points, radialSegs);
  }

  // --- Segmented Hitbox ---

  Player.prototype.setHitboxConfig = function (config) {
    if (Array.isArray(config) && config.length > 0) {
      this._hitboxConfig = config;
    } else {
      this._hitboxConfig = DEFAULT_HITBOX_CONFIG;
    }
    this._buildHitSegments();
    this._updateHitboxes();
  };

  Player.prototype._buildHitSegments = function () {
    this._hitSegments = [];
    for (var i = 0; i < this._hitboxConfig.length; i++) {
      var cfg = this._hitboxConfig[i];
      var shape = cfg.shape || 'box';
      if (shape === 'sphere') {
        this._hitSegments.push({
          name: cfg.name,
          shape: 'sphere',
          center: new THREE.Vector3(),
          radius: cfg.radius || 0.25,
          damageMultiplier: cfg.damageMultiplier || 1.0
        });
      } else if (shape === 'cylinder') {
        this._hitSegments.push({
          name: cfg.name,
          shape: 'cylinder',
          center: new THREE.Vector3(),
          radius: cfg.radius || 0.3,
          halfHeight: (cfg.height || 0.5) / 2,
          damageMultiplier: cfg.damageMultiplier || 1.0
        });
      } else if (shape === 'capsule') {
        this._hitSegments.push({
          name: cfg.name,
          shape: 'capsule',
          center: new THREE.Vector3(),
          radius: cfg.radius || 0.3,
          halfHeight: (cfg.height || 0.5) / 2,
          damageMultiplier: cfg.damageMultiplier || 1.0
        });
      } else {
        this._hitSegments.push({
          name: cfg.name,
          shape: 'box',
          center: new THREE.Vector3(),
          halfW: (cfg.width || 0.5) / 2,
          halfH: (cfg.height || 0.5) / 2,
          halfD: (cfg.depth || 0.5) / 2,
          yaw: 0,
          damageMultiplier: cfg.damageMultiplier || 1.0
        });
      }
    }
  };

  Player.prototype._updateHitboxes = function () {
    var posX = this.position.x;
    var posZ = this.position.z;
    var feetY = this.feetY;
    var yaw = this._hitboxYaw;
    var cosY = Math.cos(yaw);
    var sinY = Math.sin(yaw);
    for (var i = 0; i < this._hitboxConfig.length; i++) {
      var cfg = this._hitboxConfig[i];
      var seg = this._hitSegments[i];
      var ox = cfg.offsetX || 0;
      var oz = cfg.offsetZ || 0;
      // Rotate offset by player yaw
      var rx = cosY * ox + sinY * oz;
      var rz = -sinY * ox + cosY * oz;
      var cx = posX + rx;
      var cy = feetY + cfg.offsetY;
      var cz = posZ + rz;

      seg.center.set(cx, cy, cz);
      if (seg.shape === 'box') {
        seg.yaw = yaw;
      }
    }
  };

  Player.prototype.getHitSegments = function () {
    return this._hitSegments;
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

  // --- Mesh Rebuild ---

  Player.prototype.rebuildMesh = function () {
    // Preserve health bar before clearing children
    var healthBarGroup = this._healthBarGroup;
    if (healthBarGroup && healthBarGroup.parent === this._meshGroup) {
      this._meshGroup.remove(healthBarGroup);
    }

    // Dispose old mesh children (body parts + weapon attach point)
    while (this._meshGroup.children.length > 0) {
      var old = this._meshGroup.children[0];
      this._meshGroup.remove(old);
      if (old.traverse) {
        old.traverse(function (c) {
          if (c.geometry) c.geometry.dispose();
          if (c.material) c.material.dispose();
        });
      }
    }
    this._weaponAttachPoint = null;

    // Rebuild from current _bodyParts (or DEFAULT_BODY_PARTS)
    this._buildMesh();
    this._computeMeshMetrics();
    this._syncMeshPosition();

    // Re-attach health bar
    if (healthBarGroup) {
      this._meshGroup.add(healthBarGroup);
    }

    // Re-hide if camera-attached
    if (this.cameraAttached) {
      this._meshGroup.visible = false;
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
    this._updateHitboxes();
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
    // Backward compat: bounding sphere enclosing all segments
    if (this._hitSegments.length > 0) {
      var merged = new THREE.Box3();
      var initialized = false;
      for (var i = 0; i < this._hitSegments.length; i++) {
        var seg = this._hitSegments[i];
        var segBox;
        var shape = seg.shape || 'box';
        if (shape === 'sphere') {
          segBox = new THREE.Box3(
            new THREE.Vector3(seg.center.x - seg.radius, seg.center.y - seg.radius, seg.center.z - seg.radius),
            new THREE.Vector3(seg.center.x + seg.radius, seg.center.y + seg.radius, seg.center.z + seg.radius)
          );
        } else if (shape === 'cylinder' || shape === 'capsule') {
          segBox = new THREE.Box3(
            new THREE.Vector3(seg.center.x - seg.radius, seg.center.y - seg.halfHeight, seg.center.z - seg.radius),
            new THREE.Vector3(seg.center.x + seg.radius, seg.center.y + seg.halfHeight, seg.center.z + seg.radius)
          );
        } else {
          // OBB: compute axis-aligned bounding box of rotated box
          var cosY = Math.abs(Math.cos(seg.yaw || 0));
          var sinY = Math.abs(Math.sin(seg.yaw || 0));
          var aabbHalfW = cosY * seg.halfW + sinY * seg.halfD;
          var aabbHalfD = sinY * seg.halfW + cosY * seg.halfD;
          segBox = new THREE.Box3(
            new THREE.Vector3(seg.center.x - aabbHalfW, seg.center.y - seg.halfH, seg.center.z - aabbHalfD),
            new THREE.Vector3(seg.center.x + aabbHalfW, seg.center.y + seg.halfH, seg.center.z + aabbHalfD)
          );
        }
        if (!initialized) {
          merged.copy(segBox);
          initialized = true;
        } else {
          merged.union(segBox);
        }
      }
      var center = merged.getCenter(new THREE.Vector3());
      var sphere = merged.getBoundingSphere(new THREE.Sphere());
      return { position: center, radius: sphere.radius };
    }
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
    this._hitboxYaw = yaw;
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
  window.buildCapsuleGeometry = buildCapsuleGeometry;

})();
