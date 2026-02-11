/**
 * weapon.js — Weapon class (stats + state)
 *
 * PURPOSE: Defines a weapon as a combination of static stats (what the weapon IS)
 * and per-instance mutable state (current ammo, reload progress, etc.). Every player,
 * AI, and bot gets a Weapon instance. Hero configs define weapon stats which are
 * passed to new Weapon(heroWeaponConfig).
 *
 * EXPORTS (window):
 *   Weapon — constructor function
 *
 * DEPENDENCIES: None
 *
 * DESIGN NOTES:
 *   - projectileSpeed: null/undefined = hitscan (instant raycast), number = m/s projectile
 *     Hitscan weapons resolve hits immediately via raycasting in projectiles.js.
 *     Projectile weapons (future) will spawn a moving entity per shot.
 *   - projectileGravity: 0 = straight line, >0 = drop over distance. Only applies
 *     when projectileSpeed is set. Default 0 (no gravity).
 *   - splashRadius: 0 = single-target, >0 = area-of-effect damage radius around impact.
 *     Default 0 (no splash).
 *   - scope: Configuration for ADS (aim-down-sights) behavior on right-click.
 *     null = no ADS. Object with type, zoomFOV, overlay, spreadMultiplier.
 *   - modelType: String key that maps to a 3D model builder in weaponModels.js.
 *     Used to render the correct weapon mesh on the player.
 *   - crosshair: Configuration object for crosshair rendering in crosshair.js.
 *     Defines style, spread values, and color.
 *   - tracerColor: Hex color for tracer/projectile visuals.
 *   - abilities: Array of weapon-specific abilities (e.g. alt-fire modes).
 *     Managed by abilities.js runtime.
 *
 * TODO (future):
 *   - Projectile weapon firing path in projectiles.js (spawn moving entity, per-frame update)
 *   - Splash damage calculation on impact
 *   - ADS (aim-down-sights) implementation: FOV transition, overlay rendering, spread reduction
 *   - Weapon ability activation and cooldown tracking
 *   - Headshot damage multiplier per weapon
 *   - Damage falloff over distance
 */

(function () {

  function Weapon(opts) {
    opts = opts || {};

    // --- Combat Stats ---
    this.cooldownMs      = opts.cooldownMs      || 166;      // ms between shots
    this.magSize         = opts.magSize         || 6;         // rounds per magazine
    this.reloadTimeSec   = opts.reloadTimeSec   || 2.5;       // seconds to reload
    this.damage          = opts.damage          || 20;        // damage per pellet
    this.spreadRad       = (typeof opts.spreadRad === 'number') ? opts.spreadRad : 0;        // base spread (radians)
    this.sprintSpreadRad = (typeof opts.sprintSpreadRad === 'number') ? opts.sprintSpreadRad : 0.012; // spread while sprinting
    this.maxRange        = opts.maxRange        || 200;       // max effective range (meters)
    this.pellets         = opts.pellets         || 1;         // pellets per shot (>1 for shotguns)

    // --- Projectile Behavior ---
    // null = hitscan (instant), number = projectile speed in m/s
    this.projectileSpeed   = (opts.projectileSpeed !== undefined)   ? opts.projectileSpeed   : null;
    // Gravity applied to projectile trajectory. 0 = straight line. Only used when projectileSpeed is set.
    this.projectileGravity = (opts.projectileGravity !== undefined) ? opts.projectileGravity : 0;
    // Area damage radius on impact. 0 = single-target only.
    this.splashRadius      = (opts.splashRadius !== undefined)      ? opts.splashRadius      : 0;

    // --- Melee ---
    this.meleeDamage         = (typeof opts.meleeDamage === 'number')         ? opts.meleeDamage         : 30;
    this.meleeRange          = (typeof opts.meleeRange === 'number')          ? opts.meleeRange          : 2.5;
    this.meleeCooldownMs     = (typeof opts.meleeCooldownMs === 'number')     ? opts.meleeCooldownMs     : 600;
    this.meleeSwingMs        = (typeof opts.meleeSwingMs === 'number')        ? opts.meleeSwingMs        : 350;
    this.meleeUseHitMultiplier = (opts.meleeUseHitMultiplier !== undefined)   ? !!opts.meleeUseHitMultiplier : true;
    // If true, left-click triggers melee swing instead of firing (for melee-only weapons like swords)
    this.meleeOnly           = !!opts.meleeOnly;

    // --- Scope / ADS (Aim Down Sights) ---
    // null = no ADS, or { type: 'scope'|'ironsights', zoomFOV: 30, overlay: null, spreadMultiplier: 0.2 }
    this.scope = opts.scope || null;

    // --- Visual Identity ---
    // Key into weaponModels.js model builder registry (e.g. 'rifle', 'shotgun')
    this.modelType    = opts.modelType    || 'rifle';
    // Hex color for tracer lines / projectile visuals
    this.tracerColor  = (typeof opts.tracerColor === 'number') ? opts.tracerColor : 0xffee66;

    // Crosshair configuration — read by crosshair.js
    // { style: 'cross'|'dot'|'circle'|'shotgun_ring', baseSpreadPx, sprintSpreadPx, color }
    this.crosshair = opts.crosshair || {
      style: 'cross',
      baseSpreadPx: 8,
      sprintSpreadPx: 20,
      color: '#00ffaa'
    };

    // --- Weapon-Specific Abilities ---
    // Array of ability definitions. Managed by abilities.js at runtime.
    // e.g. [{ id: 'chargedShot', type: 'active', cooldownSec: 5, keybind: 'e', description: '...' }]
    this.abilities = opts.abilities || [];

    // --- Per-Instance Mutable State ---
    this.ammo         = this.magSize;
    this.reloading    = false;
    this.reloadEnd    = 0;
    this.lastShotTime = 0;
    this.lastMeleeTime = 0;
  }

  /**
   * Reset mutable state to defaults (called between rounds).
   * Does NOT change static stats — those are defined by the weapon type.
   */
  Weapon.prototype.reset = function () {
    this.ammo         = this.magSize;
    this.reloading    = false;
    this.reloadEnd    = 0;
    this.lastShotTime = 0;
    this.lastMeleeTime = 0;
  };

  window.Weapon = Weapon;

})();
