/**
 * trainingBot.js — Simple patrol bot for training range
 *
 * PURPOSE: Non-combatant bot that patrols predefined paths for target practice.
 * Does not shoot. Uses Player class via composition for mesh, health, hitbox,
 * and physics. Respawns 3 seconds after death at the first patrol waypoint.
 *
 * EXPORTS (window):
 *   TrainingBot — constructor function
 *
 * DEPENDENCIES: player.js (Player), weapon.js (Weapon), physics.js (updateFullPhysics)
 *
 * DESIGN NOTES:
 *   - Ping-pong patrol: walks forward along path, reverses at endpoints.
 *   - Moves at walking speed (3.0 m/s), no sprinting or jumping.
 *   - Health is configurable (default 60), lower than player for quick kills.
 *   - Weapon exists on the Player instance but is never fired.
 *
 * TODO (future):
 *   - Extract base BotEntity class shared with aiOpponent.js
 *   - Configurable patrol speed
 *   - Bot difficulty variants (some bots shoot back with poor aim)
 *   - Bot visual variants (different colors, sizes)
 *   - Non-linear patrol paths (random waypoint selection instead of ping-pong)
 */

(function () {

  function TrainingBot(opts) {
    opts = opts || {};

    this.patrolPath = opts.patrolPath || [];
    this._pathIndex = 0;
    this._pathDirection = 1; // 1 = forward, -1 = backward (ping-pong)

    this.arena = opts.arena || null;
    this.alive = true;
    this._respawnTimer = 0;
    this._respawnDelay = 3.0; // seconds

    // Create Player instance
    var spawnPos = this.patrolPath.length > 0 ? this.patrolPath[0] : new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 0);
    this.player = new Player({
      position: spawnPos.clone(),
      feetY: GROUND_Y,
      walkSpeed: 3.0,
      sprintSpeed: 3.0,
      radius: 0.5,
      maxHealth: opts.maxHealth || 60,
      color: opts.color || 0xff5555,
      cameraAttached: false,
      weapon: new Weapon()
    });
  }

  TrainingBot.prototype.update = function (dt, cameraPos) {
    if (!this.alive) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) {
        this.respawn();
      }
      return;
    }

    if (this.patrolPath.length < 2) return;

    // Move toward current target waypoint
    var target = this.patrolPath[this._pathIndex];
    var pos = this.player.position;
    var dx = target.x - pos.x;
    var dz = target.z - pos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 1.0) {
      // Reached waypoint, advance
      this._pathIndex += this._pathDirection;
      if (this._pathIndex >= this.patrolPath.length) {
        this._pathDirection = -1;
        this._pathIndex = this.patrolPath.length - 2;
      } else if (this._pathIndex < 0) {
        this._pathDirection = 1;
        this._pathIndex = 1;
      }
    }

    // Compute world move direction toward target
    var moveDir = new THREE.Vector3(dx, 0, dz);
    if (moveDir.lengthSq() > 1e-6) moveDir.normalize();

    // Use physics for movement
    if (this.arena) {
      updateFullPhysics(
        this.player,
        { worldMoveDir: moveDir, sprint: false, jump: false },
        { colliders: this.arena.colliders, solids: this.arena.solids },
        dt
      );
    }

    // Face movement direction
    if (moveDir.lengthSq() > 1e-6) {
      var lookTarget = pos.clone().add(moveDir);
      this.player.faceToward(lookTarget);
    }

    // Sync mesh
    this.player._syncMeshPosition();

    // Update 3D health bar
    if (cameraPos) {
      this.player.update3DHealthBar(cameraPos, this.arena ? this.arena.solids : []);
    }
  };

  TrainingBot.prototype.takeDamage = function (amount) {
    if (!this.alive) return;
    this.player.takeDamage(amount);
    if (!this.player.alive) {
      this.alive = false;
      this._respawnTimer = this._respawnDelay;
    }
  };

  TrainingBot.prototype.respawn = function () {
    var spawnPos = this.patrolPath.length > 0 ? this.patrolPath[0] : new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 0);
    this.player.resetForRound(spawnPos);
    this.player.setVisible(true);
    this.alive = true;
    this._pathIndex = 0;
    this._pathDirection = 1;
  };

  TrainingBot.prototype.getHitTarget = function () {
    if (!this.alive) return null;
    return this.player.getHitTarget();
  };

  TrainingBot.prototype.destroy = function () {
    if (this.player) {
      this.player.destroy();
      this.player = null;
    }
  };

  window.TrainingBot = TrainingBot;

})();
