// Weapon class — shared by player, AI, and multiplayer.
// Holds static stats (define the weapon type) and per-instance mutable state.

(function () {

  function Weapon(opts) {
    opts = opts || {};

    // Static stats (define the weapon type)
    this.cooldownMs      = opts.cooldownMs      || 166;
    this.magSize         = opts.magSize         || 6;
    this.reloadTimeSec   = opts.reloadTimeSec   || 2.5;
    this.damage          = opts.damage          || 20;
    this.spreadRad       = (typeof opts.spreadRad === 'number') ? opts.spreadRad : 0;
    this.sprintSpreadRad = (typeof opts.sprintSpreadRad === 'number') ? opts.sprintSpreadRad : 0.012;
    this.maxRange        = opts.maxRange        || 200;

    // Per-instance mutable state
    this.ammo        = this.magSize;
    this.reloading   = false;
    this.reloadEnd   = 0;
    this.lastShotTime = 0;
  }

  Weapon.prototype.reset = function () {
    this.ammo        = this.magSize;
    this.reloading   = false;
    this.reloadEnd   = 0;
    this.lastShotTime = 0;
  };

  window.Weapon = Weapon;

})();
