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
 *     hitbox: {
 *       width:  number,        — X extent (meters)
 *       height: number,        — Y extent (full standing height)
 *       depth:  number         — Z extent
 *       // TODO (future): segments for headshot detection
 *       // segments: { head: { offsetY, w, h, d }, torso: {...}, legs: {...} }
 *     }
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

      // Hitbox dimensions (meters) — used for collision and hit detection
      hitbox: { width: 0.8, height: 3.2, depth: 0.8 },

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
        projectileSpeed: null,    // hitscan
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
        abilities: []
      },

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

      hitbox: { width: 0.9, height: 3.2, depth: 0.9 },

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
        projectileSpeed: null,    // hitscan
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
        abilities: []
      },

      passives: [],
      abilities: []
    }
  ];

  // Freeze hero objects to prevent accidental mutation during gameplay
  Object.freeze(HEROES);

  /**
   * Look up a hero by its string id.
   * Returns the hero object or null if not found.
   */
  function getHeroById(id) {
    for (var i = 0; i < HEROES.length; i++) {
      if (HEROES[i].id === id) return HEROES[i];
    }
    return null;
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
    var hero = getHeroById(heroId) || HEROES[0];

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

    // Apply visual color to mesh
    player._color = hero.color;
    if (player._meshGroup) {
      player._meshGroup.traverse(function (child) {
        // Only recolor body parts (tagged with isBodyPart), not weapon or health bar
        if (child.isMesh && child.material && child.userData && child.userData.isBodyPart) {
          if (child.material.color) {
            child.material.color.setHex(hero.color);
          }
        }
      });
    }

    // Swap weapon model on player mesh (uses Player.swapWeaponModel)
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
        setFirstPersonWeapon(hero.weapon.modelType || 'default');
      }
    }

    // Store hero id on player for reference
    player._heroId = heroId;

    return hero;
  }

  // --- Expose ---
  window.HEROES = HEROES;
  window.getHeroById = getHeroById;
  window.applyHeroToPlayer = applyHeroToPlayer;

})();
