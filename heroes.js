/**
 * heroes.js — Hero registry and hero-to-player application
 *
 * PURPOSE: Single source of truth for all hero definitions. Each hero defines the
 * complete character: stats (health, speed, jump), weapon config, visual identity,
 * hitbox dimensions, and abilities. This is the DATA layer — the UI for hero
 * selection lives in heroSelectUI.js.
 *
 * EXPORTS (window):
 *   HEROES              — array of hero definition objects (frozen)
 *   getHeroById(id)     — lookup a hero by string id
 *   applyHeroToPlayer(player, heroId) — apply hero stats + weapon + visuals to a Player
 *
 * DEPENDENCIES: weapon.js (Weapon class), player.js (Player.swapWeaponModel)
 *
 * HERO DATA MODEL:
 *   {
 *     id:            string    — unique identifier
 *     name:          string    — display name
 *     description:   string    — short description for UI
 *     color:         number    — hex color for mesh, tracers, UI accents
 *
 *     maxHealth:     number    — starting/max health
 *     walkSpeed:     number    — walk speed (m/s)
 *     sprintSpeed:   number    — sprint speed (m/s)
 *     jumpVelocity:  number    — initial jump velocity (m/s upward)
 *
 *     hitbox: [               — array of named hitbox segments
 *       {
 *         name: string,       — label (e.g. "head", "torso", "legs")
 *         width: number,      — X extent (meters)
 *         height: number,     — Y extent
 *         depth: number,      — Z extent
 *         offsetY: number,    — center Y relative to player feet
 *         damageMultiplier: number — damage scaling on hit (2.0 = headshot)
 *       }
 *     ]
 *
 *     modelType:     string    — key into a hero model builder (future)
 *     weapon:        object    — weapon config passed to new Weapon(hero.weapon)
 *
 *     passives:      array     — passive ability definitions (checked by game systems)
 *     abilities:     array     — active ability definitions (managed by abilities.js)
 *   }
 *
 * TODO (future):
 *   - More heroes (sniper, medic, engineer, etc.)
 *   - Hero-specific 3D character models (modelType → heroModels.js)
 *   - Hitbox segments for headshot/limb damage multipliers
 *   - Per-hero voice lines / sound effects
 *   - Hero unlock/progression system
 *   - External hero editor tool (read/write hero configs without touching code)
 *   - AI hero selection (random or counter-pick based on difficulty)
 */

(function () {

  var HEROES = [
    {
      id: 'marksman',
      name: 'Marksman',
      description: 'Precise single-shot marker. High accuracy, moderate fire rate.',
      color: 0x66ffcc,

      // Character stats
      maxHealth: 100,
      walkSpeed: 4.5,
      sprintSpeed: 8.5,
      jumpVelocity: 8.5,

      // Hitbox segments — head/torso/legs with damage multipliers
      hitbox: [
        { name: "head",  width: 0.5, height: 0.5, depth: 0.5, offsetY: 2.95, damageMultiplier: 2.0 },
        { name: "torso", width: 0.6, height: 0.9, depth: 0.5, offsetY: 2.05, damageMultiplier: 1.0 },
        { name: "legs",  width: 0.5, height: 1.1, depth: 0.5, offsetY: 0.55, damageMultiplier: 0.75 }
      ],

      // Visual model key (future: maps to hero model builder)
      modelType: 'standard',

      // Weapon configuration — passed to new Weapon(hero.weapon)
      weapon: {
        cooldownMs: 166,
        magSize: 6,
        reloadTimeSec: 2.5,
        damage: 20,
        spreadRad: 0,
        sprintSpreadRad: 0.012,
        maxRange: 200,
        pellets: 1,
        projectileSpeed: 120,
        projectileGravity: 0,
        splashRadius: 0,
        scope: {
          type: 'scope',
          zoomFOV: 35,
          overlay: null,
          spreadMultiplier: 0.15
        },
        modelType: 'rifle',
        tracerColor: 0x66ffcc,
        crosshair: {
          style: 'cross',
          baseSpreadPx: 8,
          sprintSpreadPx: 20,
          color: '#00ffaa'
        },
        meleeDamage: 25,
        meleeRange: 2.0,
        meleeCooldownMs: 600,
        meleeSwingMs: 350,
        meleeUseHitMultiplier: true,
        abilities: []
      },

      // Visual body parts (custom 3D model pieces)
      bodyParts: [
        { name: "head", shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 1.6, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
        { name: "torso", shape: "cylinder", radius: 0.275, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
      ],

      // Passive abilities (checked by game systems like physics.js)
      passives: [],

      // Active abilities with cooldowns (managed by abilities.js)
      abilities: []
    },

    {
      id: 'brawler',
      name: 'Brawler',
      description: 'Devastating close-range shotgun. 8 pellets per blast.',
      color: 0xff8844,

      maxHealth: 120,
      walkSpeed: 4.2,
      sprintSpeed: 8.0,
      jumpVelocity: 8.5,

      hitbox: [
        { name: "head",  width: 0.55, height: 0.5, depth: 0.55, offsetY: 2.95, damageMultiplier: 2.0 },
        { name: "torso", width: 0.7,  height: 0.9, depth: 0.55, offsetY: 2.05, damageMultiplier: 1.0 },
        { name: "legs",  width: 0.55, height: 1.1, depth: 0.55, offsetY: 0.55, damageMultiplier: 0.75 }
      ],

      modelType: 'standard',

      weapon: {
        cooldownMs: 600,
        magSize: 4,
        reloadTimeSec: 3.0,
        damage: 8,
        spreadRad: 0.06,
        sprintSpreadRad: 0.10,
        maxRange: 60,
        pellets: 8,
        projectileSpeed: 120,
        projectileGravity: 0,
        splashRadius: 0,
        scope: {
          type: 'ironsights',
          zoomFOV: 55,
          overlay: null,
          spreadMultiplier: 0.5
        },
        modelType: 'shotgun',
        tracerColor: 0xff8844,
        crosshair: {
          style: 'circle',
          baseSpreadPx: 24,
          sprintSpreadPx: 40,
          color: '#ff8844'
        },
        meleeDamage: 40,
        meleeRange: 3.0,
        meleeCooldownMs: 600,
        meleeSwingMs: 350,
        meleeUseHitMultiplier: true,
        abilities: []
      },

      bodyParts: [
        { name: "head", shape: "sphere", radius: 0.275, offsetX: 0, offsetY: 1.6, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
        { name: "torso", shape: "cylinder", radius: 0.3, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
      ],

      passives: [],
      abilities: []
    }
  ];

  // These are the built-in defaults, used as fallbacks and for seeding.
  var BUILTIN_HEROES = HEROES;

  /**
   * Look up a hero by its string id.
   * Returns the hero object or null if not found.
   */
  function getHeroById(id) {
    var list = window.HEROES || BUILTIN_HEROES;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /**
   * Load all heroes from the server API and replace window.HEROES.
   * Falls back to built-in heroes on failure.
   * Returns a Promise that resolves when heroes are loaded.
   */
  function loadHeroesFromServer() {
    return fetch('/api/heroes').then(function (r) { return r.json(); }).then(function (names) {
      if (!names || !names.length) return;
      var promises = names.map(function (name) {
        return fetch('/api/heroes/' + encodeURIComponent(name)).then(function (r) { return r.json(); });
      });
      return Promise.all(promises);
    }).then(function (heroes) {
      if (heroes && heroes.length) {
        // Filter out any invalid entries (nulls from failed fetches)
        var valid = heroes.filter(function (h) { return h && h.id; });
        if (valid.length) window.HEROES = valid;
      }
    }).catch(function () {
      // Keep built-in heroes as fallback
    });
  }

  /**
   * Apply a hero's full configuration to a Player instance.
   * Updates weapon, stats (health, speed, jump), visuals (mesh color, weapon model),
   * and prepares ability tracking.
   *
   * Called when:
   *   - Player confirms hero selection (pre-round)
   *   - Player switches hero in training range
   *   - AI is assigned a hero
   *
   * @param {Player} player - the Player instance to update
   * @param {string} heroId - the hero id to apply
   * @returns {object|null} the hero object, or null if not found
   */
  function applyHeroToPlayer(player, heroId) {
    if (!player) return null;
    var hero = getHeroById(heroId) || window.HEROES[0] || BUILTIN_HEROES[0];

    // Apply weapon
    player.weapon = new Weapon(hero.weapon);
    player.weapon.reset();

    // Apply character stats
    player.maxHealth = hero.maxHealth;
    player.health = hero.maxHealth;
    player.walkSpeed = hero.walkSpeed;
    player.sprintSpeed = hero.sprintSpeed;
    // jumpVelocity is stored on player, read by updateFullPhysics() when jumping
    player._jumpVelocity = hero.jumpVelocity;

    // Apply visual color and body parts, then rebuild mesh
    player._color = hero.color;
    if (hero.bodyParts && hero.bodyParts.length > 0) {
      player._bodyParts = hero.bodyParts;
    } else {
      player._bodyParts = null;
    }
    if (typeof player.rebuildMesh === 'function') {
      player.rebuildMesh();
    }

    // Recolor body parts that don't have their own per-part color
    if (player._meshGroup && hero.bodyParts) {
      var partIndex = 0;
      player._meshGroup.traverse(function (child) {
        if (child.isMesh && child.material && child.userData && child.userData.isBodyPart) {
          if (!hero.bodyParts[partIndex] || !hero.bodyParts[partIndex].color) {
            if (child.material.color) {
              child.material.color.setHex(hero.color);
            }
          }
          partIndex++;
        }
      });
    } else if (player._meshGroup) {
      player._meshGroup.traverse(function (child) {
        if (child.isMesh && child.material && child.userData && child.userData.isBodyPart) {
          if (child.material.color) {
            child.material.color.setHex(hero.color);
          }
        }
      });
    }

    // Swap weapon model on player mesh (rebuildMesh created a fresh attach point)
    if (typeof player.swapWeaponModel === 'function') {
      player.swapWeaponModel(hero.weapon.modelType || 'default');
    }

    // For camera-attached (local) players: update crosshair style and first-person viewmodel
    if (player.cameraAttached) {
      var ch = hero.weapon.crosshair;
      if (typeof setCrosshairStyle === 'function' && ch) {
        setCrosshairStyle(ch.style || 'cross', ch.color || null);
      }
      if (typeof setFirstPersonWeapon === 'function') {
        setFirstPersonWeapon(
          hero.weapon.modelType || 'default',
          hero.weapon.fpOffset || null,
          hero.weapon.fpRotation || null
        );
      }
    }

    // Apply segmented hitbox config
    if (typeof player.setHitboxConfig === 'function') {
      player.setHitboxConfig(hero.hitbox);
    }

    // Apply camera offset if defined (for first-person eye position)
    if (hero.cameraOffset) {
      player._cameraOffset = {
        x: hero.cameraOffset.x || 0,
        y: hero.cameraOffset.y || 0,
        z: hero.cameraOffset.z || 0
      };
    } else {
      player._cameraOffset = null;
    }

    // Store hero id on player for reference
    player._heroId = heroId;

    return hero;
  }

  // --- Expose ---
  window.HEROES = HEROES;
  window.BUILTIN_HEROES = BUILTIN_HEROES;
  window.getHeroById = getHeroById;
  window.applyHeroToPlayer = applyHeroToPlayer;
  window.loadHeroesFromServer = loadHeroesFromServer;

})();
