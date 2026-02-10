/**
 * aiOpponent.js — AI opponent for competitive single-player mode
 *
 * PURPOSE: Full AI opponent with 7-state state machine, A* pathfinding on a
 * 25-point waypoint graph, cover system, layered strafing, and difficulty-scaled
 * aim error and reaction time. Uses Player class via composition for mesh, health,
 * hitbox, and physics state.
 *
 * EXPORTS (window):
 *   AIOpponent — constructor function
 *
 * DEPENDENCIES: player.js (Player), weapon.js (Weapon), game.js (camera global),
 *   physics.js (updateFullPhysics, GROUND_Y, EYE_HEIGHT, hasBlockingBetween),
 *   projectiles.js (sharedFireWeapon)
 *
 * STATE MACHINE:
 *   SPAWN_RUSH → PATROL → ENGAGE → SEEK_COVER → HOLD_COVER → FLANK → STUCK_RECOVER
 *
 * PLAYSTYLES (randomly selected per round):
 *   aggressive — close range, low cover threshold, high sprint/jump
 *   defensive  — long range, high cover threshold, frequent cover use
 *   balanced   — middle ground between aggressive and defensive
 *
 * DIFFICULTY (Easy/Medium/Hard):
 *   Aim error:     Easy 0.08rad, Medium 0.035rad, Hard 0.012rad
 *   Reaction time: Easy 400-650ms, Medium 200-380ms, Hard 100-220ms
 *
 * TODO (future):
 *   - AI hero selection (use hero system instead of default Marksman)
 *   - Difficulty could also affect weapon stats (not just aim/reaction)
 *   - Use sharedStartReload() instead of inline reload logic
 *   - Counter-picking: AI adapts playstyle based on player's hero choice
 *   - Ability usage by AI (when ability system is implemented)
 *   - Extract base BotEntity class shared with trainingBot.js
 */

class AIOpponent {
  constructor(opts) {
    const { difficulty = 'Easy', arena, spawn, color = 0xff5555 } = opts || {};
    this.difficulty = difficulty;
    this.arena = arena;

    // Aim error per difficulty — AI uses the same weapon as the player,
    // but intentionally aims slightly off-target based on difficulty.
    const aimErrors = {
      Easy:   0.08,   // ~4.6 degrees — misses most shots at range
      Medium: 0.035,  // ~2.0 degrees — hits roughly half
      Hard:   0.012,  // ~0.7 degrees — very accurate, rarely misses
    };
    this._aimErrorRad = aimErrors[this.difficulty] || aimErrors.Easy;

    // Create Player instance via composition
    this.player = new Player({
      position: spawn ? new THREE.Vector3(spawn.x, GROUND_Y + EYE_HEIGHT, spawn.z) : undefined,
      feetY: GROUND_Y,
      walkSpeed: 4.5,
      sprintSpeed: 8.5,
      radius: 0.5,
      maxHealth: 100,
      color: color,
      cameraAttached: false,
      weapon: new Weapon()
    });

    // Apply Marksman hero to get proper hitbox segments, weapon, and stats
    if (typeof applyHeroToPlayer === 'function') {
      applyHeroToPlayer(this.player, 'marksman');
    }

    // --- Playstyle System ---
    this._playstyles = {
      aggressive: {
        engageDistMin: 4, engageDistMax: 6,
        coverHealthThreshold: 30,
        sprintChance: 0.7, jumpChance: 0.15,
        strafeIntensity: 0.9,
        coverHoldTime: 1.5,
        flankAfterStalemateSec: 6,
        approachWeight: 1.0
      },
      defensive: {
        engageDistMin: 10, engageDistMax: 14,
        coverHealthThreshold: 60,
        sprintChance: 0.2, jumpChance: 0.03,
        strafeIntensity: 0.5,
        coverHoldTime: 4.0,
        flankAfterStalemateSec: 12,
        approachWeight: 0.5
      },
      balanced: {
        engageDistMin: 7, engageDistMax: 9,
        coverHealthThreshold: 45,
        sprintChance: 0.45, jumpChance: 0.08,
        strafeIntensity: 0.7,
        coverHoldTime: 2.5,
        flankAfterStalemateSec: 8,
        approachWeight: 0.75
      }
    };
    var styleNames = ['aggressive', 'defensive', 'balanced'];
    this._currentStyleName = styleNames[Math.floor(Math.random() * styleNames.length)];
    this._style = this._playstyles[this._currentStyleName];

    // Difficulty modifiers on top of playstyle
    // reactionDelayMin/Max: randomized delay (seconds) before AI can shoot after gaining LOS
    this._diffMods = {
      Easy:   { coverThresholdAdd: 10, jumpMult: 0.5, strafeMult: 0.7, reactionDelayMin: 0.40, reactionDelayMax: 0.65 },
      Medium: { coverThresholdAdd: 0, jumpMult: 1.0, strafeMult: 1.0, reactionDelayMin: 0.20, reactionDelayMax: 0.38 },
      Hard:   { coverThresholdAdd: -10, jumpMult: 1.3, strafeMult: 1.2, reactionDelayMin: 0.10, reactionDelayMax: 0.22 },
    };
    this._diffMod = this._diffMods[this.difficulty] || this._diffMods.Easy;

    // --- State Machine ---
    this._state = 'SPAWN_RUSH';
    this._stateTimer = 0;
    this._lastBehavior = 'RUSHING';

    // Movement helpers
    this._strafeSign = Math.random() < 0.5 ? 1 : -1;
    this._strafeTimer = 0;
    this._microJitterTimer = 0;
    this._damageDodgeTimer = 0;
    this._lastDamageTime = -Infinity;

    // LOS-based reaction time: tracks when AI first gains sight of player
    this._hadLOS = false;
    this._losGainedTime = 0;       // performance.now() when LOS was gained
    this._currentReactionDelay = 0; // randomized delay for this LOS window

    // Spawn rush target: mid-map
    this._rushTarget = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      GROUND_Y + EYE_HEIGHT,
      0
    );
    this._rushDuration = 2.5 + Math.random() * 1.0;

    // A* pathfinding data
    this.waypoints = (arena && arena.waypoints) ? arena.waypoints.slice() : [];
    this._currentPath = [];
    this._pathIndex = 0;
    this._repathTimer = 0;
    this._waypointGraph = this._buildWaypointGraph();

    // Cover system
    this._coverSpots = [];
    this._currentCoverSpot = null;
    this._coverPeekState = 'hiding'; // hiding, peeking_out, shooting, peeking_back
    this._coverPeekTimer = 0;
    this._coverOriginalPos = null;
    this._buildCoverSpots();

    // Stuck detection
    this._stuckCheckPos = this.position.clone();
    this._stuckCheckTimer = 0;
    this._stuckCount = 0;
    this._stuckRecoverDir = new THREE.Vector3();
    this._stuckRecoverTimer = 0;

    // Flank state
    this._flankTarget = null;

    // Engage timer (for stalemate → flank transition)
    this._engageTimer = 0;

    // Jump cooldown
    this._jumpCooldown = 0;
  }

  // --- Delegation getters for backward compatibility ---
  get mesh() { return this.player._meshGroup; }
  get position() { return this.player.position; }
  get health() { return this.player.health; }
  set health(v) { this.player.health = v; }
  get maxHealth() { return this.player.maxHealth; }
  get alive() { return this.player.alive; }
  set alive(v) { this.player.alive = v; }
  get feetY() { return this.player.feetY; }
  set feetY(v) { this.player.feetY = v; }
  get verticalVelocity() { return this.player.verticalVelocity; }
  set verticalVelocity(v) { this.player.verticalVelocity = v; }
  get grounded() { return this.player.grounded; }
  set grounded(v) { this.player.grounded = v; }
  get walkSpeed() { return this.player.walkSpeed; }
  get sprintSpeed() { return this.player.sprintSpeed; }
  get radius() { return this.player.radius; }
  get weapon() { return this.player.weapon; }
  get lastDamagedAt() { return this.player.lastDamagedAt; }
  set lastDamagedAt(v) { this.player.lastDamagedAt = v; }

  get eyePos() {
    return this.player.getEyePos();
  }

  getCurrentBehavior() {
    var style = this._currentStyleName.toUpperCase().charAt(0);
    return this._lastBehavior + ' [' + style + ']';
  }

  takeDamage(amount) {
    this.player.takeDamage(amount);
    this._lastDamageTime = performance.now();
    // Damage dodge: sharp direction change
    this._damageDodgeTimer = 0.2;
    this._strafeSign *= -1;
  }

  destroy() {
    this.player.destroy();
  }

  // --- Cover System ---

  _buildCoverSpots() {
    if (!this.arena || !this.arena.colliders) return;
    var colliders = this.arena.colliders;
    var arenaHalfW = 30;
    var arenaHalfL = 45;
    var spots = [];
    var offset = 1.2;

    for (var i = 0; i < colliders.length; i++) {
      var box = colliders[i];
      var size = new THREE.Vector3();
      box.getSize(size);
      var center = new THREE.Vector3();
      box.getCenter(center);

      // Skip perimeter walls (very large) and very short blocks
      if (size.y < 1.0) continue;
      if (size.x > 50 || size.z > 50) continue;

      // Emit 4 positions offset from each face
      var faces = [
        new THREE.Vector3(center.x + size.x / 2 + offset, GROUND_Y, center.z),
        new THREE.Vector3(center.x - size.x / 2 - offset, GROUND_Y, center.z),
        new THREE.Vector3(center.x, GROUND_Y, center.z + size.z / 2 + offset),
        new THREE.Vector3(center.x, GROUND_Y, center.z - size.z / 2 - offset)
      ];

      for (var f = 0; f < faces.length; f++) {
        var spot = faces[f];
        // Filter: outside arena bounds?
        if (Math.abs(spot.x) > arenaHalfW - 1 || Math.abs(spot.z) > arenaHalfL - 1) continue;
        // Filter: inside another collider?
        var inside = false;
        for (var j = 0; j < colliders.length; j++) {
          if (j === i) continue;
          if (colliders[j].containsPoint(new THREE.Vector3(spot.x, center.y, spot.z))) {
            inside = true;
            break;
          }
        }
        if (!inside) {
          spots.push({ position: spot.clone(), colliderIndex: i });
        }
      }
    }
    this._coverSpots = spots;
  }

  _findBestCoverSpot(playerPos) {
    if (this._coverSpots.length === 0) return null;
    var bestSpot = null;
    var bestScore = -Infinity;
    var aiPos = this.position;
    var solids = this.arena.solids;

    for (var i = 0; i < this._coverSpots.length; i++) {
      var spot = this._coverSpots[i];
      var spotEye = new THREE.Vector3(spot.position.x, GROUND_Y + EYE_HEIGHT, spot.position.z);

      // Distance from AI (prefer closer)
      var distFromAI = aiPos.distanceTo(spot.position);
      var distScore = -distFromAI * 0.5;

      // Does this spot actually block LOS from the player? (prefer spots that do)
      var blocked = hasBlockingBetween(spotEye, playerPos, solids);
      var losScore = blocked ? 20 : 0;

      // Alignment: prefer spots that are roughly between AI and player direction
      var toPlayer = playerPos.clone().sub(aiPos);
      toPlayer.y = 0;
      if (toPlayer.lengthSq() > 1e-6) toPlayer.normalize();
      var toSpot = spot.position.clone().sub(aiPos);
      toSpot.y = 0;
      if (toSpot.lengthSq() > 1e-6) toSpot.normalize();
      var alignment = toPlayer.dot(toSpot);
      // Slightly prefer cover to the side (not directly toward player)
      var alignScore = alignment > 0 ? alignment * 5 : alignment * 2;

      // Distance from player (don't go too close to them when seeking cover)
      var distFromPlayer = spot.position.distanceTo(playerPos);
      var playerDistScore = distFromPlayer > 8 ? 5 : 0;

      var totalScore = distScore + losScore + alignScore + playerDistScore;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestSpot = spot;
      }
    }
    return bestSpot;
  }

  // --- Waypoint Graph for A* ---

  _buildWaypointGraph() {
    var wps = this.waypoints;
    var solids = this.arena ? this.arena.solids : [];
    var n = wps.length;
    var graph = new Array(n);
    for (var i = 0; i < n; i++) graph[i] = [];

    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dist = wps[i].distanceTo(wps[j]);
        if (dist > 40) continue;
        // Pathfinding LOS checks at walking-body height (~1m above waypoint Y)
        var losH = 1.0;
        var a = new THREE.Vector3(wps[i].x, wps[i].y + losH, wps[i].z);
        var b = new THREE.Vector3(wps[j].x, wps[j].y + losH, wps[j].z);
        if (!hasBlockingBetween(a, b, solids)) {
          graph[i].push({ neighbor: j, cost: dist });
          graph[j].push({ neighbor: i, cost: dist });
        }
      }
    }
    return graph;
  }

  _findNearestWaypointIndex(pos) {
    var wps = this.waypoints;
    var bestIdx = 0, bestDist = Infinity;
    for (var i = 0; i < wps.length; i++) {
      var d = pos.distanceTo(wps[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  _astar(startIdx, goalIdx) {
    var graph = this._waypointGraph;
    var wps = this.waypoints;
    var n = wps.length;
    if (startIdx === goalIdx) return [startIdx];
    if (!graph || n === 0) return [];

    var gScore = new Float64Array(n).fill(Infinity);
    var fScore = new Float64Array(n).fill(Infinity);
    var cameFrom = new Int32Array(n).fill(-1);
    var closed = new Uint8Array(n);

    gScore[startIdx] = 0;
    fScore[startIdx] = wps[startIdx].distanceTo(wps[goalIdx]);

    var open = [startIdx];
    var inOpen = new Uint8Array(n);
    inOpen[startIdx] = 1;

    while (open.length > 0) {
      var bestI = 0;
      for (var i = 1; i < open.length; i++) {
        if (fScore[open[i]] < fScore[open[bestI]]) bestI = i;
      }
      var current = open[bestI];
      open.splice(bestI, 1);
      inOpen[current] = 0;

      if (current === goalIdx) {
        var path = [];
        var node = goalIdx;
        while (node !== -1) { path.push(node); node = cameFrom[node]; }
        path.reverse();
        return path;
      }

      closed[current] = 1;
      var neighbors = graph[current];
      for (var i = 0; i < neighbors.length; i++) {
        var nb = neighbors[i].neighbor, cost = neighbors[i].cost;
        if (closed[nb]) continue;
        var tentG = gScore[current] + cost;
        if (tentG < gScore[nb]) {
          cameFrom[nb] = current;
          gScore[nb] = tentG;
          fScore[nb] = tentG + wps[nb].distanceTo(wps[goalIdx]);
          if (!inOpen[nb]) { open.push(nb); inOpen[nb] = 1; }
        }
      }
    }
    return [];
  }

  // --- Helper: Generalized pathfinding ---

  _computePathToPosition(target) {
    if (!this.waypoints || this.waypoints.length === 0) {
      this._currentPath = [];
      this._pathIndex = 0;
      return;
    }
    var startIdx = this._findNearestWaypointIndex(this.position);
    var goalIdx = this._findNearestWaypointIndex(target);
    var pathIndices = this._astar(startIdx, goalIdx);
    this._currentPath = pathIndices.map(function (i) { return this.waypoints[i].clone(); }.bind(this));
    this._pathIndex = 0;
  }

  _followPath(dt) {
    var moveDir = new THREE.Vector3();
    if (this._pathIndex < this._currentPath.length) {
      var target = this._currentPath[this._pathIndex];
      var toTarget = target.clone().sub(this.position);
      toTarget.y = 0;
      var dist = toTarget.length();
      if (dist < 1.5) {
        this._pathIndex++;
        if (this._pathIndex < this._currentPath.length) {
          target = this._currentPath[this._pathIndex];
          toTarget = target.clone().sub(this.position);
          toTarget.y = 0;
        }
      }
      if (toTarget.lengthSq() > 1e-4) {
        toTarget.normalize();
        moveDir.copy(toTarget);
      }
    }
    return moveDir;
  }

  // --- Helper: Aim error model ---
  // Rotates a direction vector by a random angle (up to maxRad) around a random
  // axis perpendicular to the direction. This makes the AI "miss" by aiming
  // slightly off-target rather than relying on weapon spread.

  _applyAimError(dir, maxRad) {
    if (maxRad <= 0) return dir;
    // Random angle uniformly distributed in [0, maxRad]
    var angle = Math.random() * maxRad;
    // Random rotation axis perpendicular to dir
    var arbitrary = (Math.abs(dir.y) < 0.9)
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    var perp = new THREE.Vector3().crossVectors(dir, arbitrary).normalize();
    // Rotate perp around dir by a random azimuth to get a random perpendicular axis
    var azimuth = Math.random() * Math.PI * 2;
    perp.applyAxisAngle(dir, azimuth);
    // Rotate dir around perp by the error angle
    var result = dir.clone().applyAxisAngle(perp, angle);
    return result.normalize();
  }

  // --- Helper: Shooting logic ---

  _tryShoot(ctx, hasLOS) {
    if (!hasLOS || this.weapon.reloading) return;
    var now = performance.now();
    var canShoot = (now - this.weapon.lastShotTime) >= this.weapon.cooldownMs;

    // Per-LOS-acquisition reaction delay: AI can't shoot until reaction time has passed
    // since it first gained line of sight (resets each time LOS is lost and regained)
    if ((now - this._losGainedTime) < this._currentReactionDelay * 1000) return;

    if (canShoot && this.weapon.ammo > 0) {
      var origin = this.eyePos;
      var perfectDir = ctx.playerPos.clone().sub(origin).normalize();
      // Apply aim error: AI intentionally aims slightly off-target
      var aimDir = this._applyAimError(perfectDir, this._aimErrorRad);
      var self = this;
      // Build target with segments if available, else fall back to position+radius
      var aiTargets = [];
      var aiTargetEntities = [];
      if (ctx.playerSegments && ctx.playerSegments.length > 0) {
        aiTargets.push({ segments: ctx.playerSegments });
        if (ctx.playerEntity) aiTargetEntities.push(ctx.playerEntity);
      } else {
        aiTargets.push({ position: ctx.playerPos, radius: ctx.playerRadius || 0.35 });
      }
      var result = sharedFireWeapon(this.weapon, origin, aimDir, {
        spreadOverride: this.weapon.spreadRad,
        solids: this.arena.solids,
        targets: aiTargets,
        projectileTargetEntities: aiTargetEntities,
        tracerColor: 0xff6666,
        onHit: function (target, point, dist, pelletIdx, damageMultiplier) {
          if (ctx.onPlayerHit) ctx.onPlayerHit(self.weapon.damage * (damageMultiplier || 1.0));
        }
      });
      if (result.magazineEmpty) {
        this.weapon.reloading = true;
        this.weapon.reloadEnd = now + this.weapon.reloadTimeSec * 1000;
      }
    } else if (canShoot && this.weapon.ammo <= 0) {
      this.weapon.reloading = true;
      this.weapon.reloadEnd = now + this.weapon.reloadTimeSec * 1000;
    }
  }

  // --- Helper: Apply movement through physics ---

  _applyMovement(moveDir, wantSprint, wantJump, dt) {
    moveDir.y = 0;
    if (moveDir.lengthSq() > 1e-6) moveDir.normalize(); else moveDir.set(0, 0, 0);

    updateFullPhysics(
      this.player,
      { worldMoveDir: moveDir, sprint: wantSprint, jump: wantJump },
      { colliders: this.arena.colliders, solids: this.arena.solids },
      dt
    );
    this.player._syncMeshPosition();
  }

  // --- Helper: Layered strafe direction ---

  _computeStrafeDir(dir, dt) {
    // Base strafe: irregular intervals (0.5–2.5s, weighted toward short)
    this._strafeTimer -= dt;
    if (this._strafeTimer <= 0) {
      this._strafeTimer = 0.5 + Math.random() * Math.random() * 2.0; // weighted short
      this._strafeSign *= -1;
    }

    // Micro-jitter: 30% chance of quick reversal every 150-400ms
    this._microJitterTimer -= dt;
    if (this._microJitterTimer <= 0) {
      this._microJitterTimer = 0.15 + Math.random() * 0.25;
      if (Math.random() < 0.30) {
        this._strafeSign *= -1;
      }
    }

    // Damage dodge: already handled in takeDamage, just tick timer
    if (this._damageDodgeTimer > 0) {
      this._damageDodgeTimer -= dt;
    }

    var right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    var intensity = this._style.strafeIntensity * this._diffMod.strafeMult;
    return right.multiplyScalar(this._strafeSign * intensity);
  }

  // --- Helper: Should the AI want to jump? ---

  _shouldJump(dt) {
    this._jumpCooldown -= dt;
    if (this._jumpCooldown > 0) return false;
    var chance = this._style.jumpChance * this._diffMod.jumpMult;
    if (Math.random() < chance * dt) {
      this._jumpCooldown = 1.0 + Math.random() * 1.5;
      return true;
    }
    return false;
  }

  // --- Stuck Detection ---

  _checkStuck(dt) {
    this._stuckCheckTimer += dt;
    if (this._stuckCheckTimer >= 0.5) {
      this._stuckCheckTimer = 0;
      var moved = this.position.distanceTo(this._stuckCheckPos);
      if (moved < 0.15) {
        this._stuckCount++;
      } else {
        this._stuckCount = 0;
      }
      this._stuckCheckPos.copy(this.position);

      // If stuck for 1.5s (3 checks), enter recovery
      if (this._stuckCount >= 3 && this._state !== 'STUCK_RECOVER') {
        this._enterState('STUCK_RECOVER');
      }
    }
  }

  // --- State Transitions ---

  _enterState(newState) {
    this._state = newState;
    this._stateTimer = 0;

    switch (newState) {
      case 'SPAWN_RUSH':
        this._lastBehavior = 'RUSHING';
        break;
      case 'PATROL':
        this._lastBehavior = 'PATHING';
        this._currentPath = [];
        this._pathIndex = 0;
        this._repathTimer = 0;
        break;
      case 'ENGAGE':
        this._lastBehavior = 'ENGAGING';
        this._engageTimer = 0;
        break;
      case 'SEEK_COVER':
        this._lastBehavior = 'SEEKING_COVER';
        this._currentCoverSpot = null;
        this._currentPath = [];
        this._pathIndex = 0;
        break;
      case 'HOLD_COVER':
        this._lastBehavior = 'IN_COVER';
        this._coverPeekState = 'hiding';
        this._coverPeekTimer = 0.8 + Math.random() * 0.5;
        this._coverOriginalPos = this.position.clone();
        break;
      case 'FLANK':
        this._lastBehavior = 'FLANKING';
        this._flankTarget = null;
        this._currentPath = [];
        this._pathIndex = 0;
        break;
      case 'STUCK_RECOVER':
        this._lastBehavior = 'UNSTICKING';
        this._stuckCount = 0;
        // Random direction + jump
        var angle = Math.random() * Math.PI * 2;
        this._stuckRecoverDir.set(Math.cos(angle), 0, Math.sin(angle));
        this._stuckRecoverTimer = 1.0 + Math.random() * 0.5;
        break;
    }
  }

  // --- Main Update ---

  update(dt, ctx) {
    if (!this.alive) return;

    var now = performance.now();

    // Reload
    if (this.weapon.reloading) {
      if (now >= this.weapon.reloadEnd) {
        this.weapon.reloading = false;
        this.weapon.ammo = this.weapon.magSize;
      }
    }

    // Increment state timer
    this._stateTimer += dt;

    // Compute common context
    var playerPos = ctx.playerPos;
    var solids = this.arena.solids;
    var toPlayer = playerPos.clone().sub(this.position);
    toPlayer.y = 0;
    var dist = Math.max(0.001, toPlayer.length());
    var dir = toPlayer.clone().normalize();
    var hasLOS = !hasBlockingBetween(this.eyePos, playerPos, solids);

    // Track LOS transitions for reaction time
    if (hasLOS && !this._hadLOS) {
      // Just gained LOS — start reaction timer with randomized delay
      this._losGainedTime = now;
      var dm = this._diffMod;
      this._currentReactionDelay = dm.reactionDelayMin + Math.random() * (dm.reactionDelayMax - dm.reactionDelayMin);
    }
    this._hadLOS = hasLOS;

    // Stuck detection (runs in all states except STUCK_RECOVER)
    if (this._state !== 'STUCK_RECOVER') {
      this._checkStuck(dt);
    }

    // Effective cover health threshold (playstyle + difficulty modifier)
    var coverThreshold = this._style.coverHealthThreshold + this._diffMod.coverThresholdAdd;

    // State machine
    var moveDir = new THREE.Vector3();
    var wantSprint = false;
    var wantJump = false;

    switch (this._state) {

      case 'SPAWN_RUSH':
        this._lastBehavior = 'RUSHING';
        // Sprint toward mid-map
        var toRush = this._rushTarget.clone().sub(this.position);
        toRush.y = 0;
        if (toRush.lengthSq() > 1e-4) {
          moveDir.copy(toRush.normalize());
        }
        wantSprint = true;
        // Occasional jump during rush
        if (Math.random() < 0.02) wantJump = true;

        // Transition: if has LOS and close enough, engage
        if (hasLOS && dist < 20) {
          this._enterState('ENGAGE');
        }
        // Transition: rush timer expired
        else if (this._stateTimer > this._rushDuration) {
          if (hasLOS) {
            this._enterState('ENGAGE');
          } else {
            this._enterState('PATROL');
          }
        }
        break;

      case 'PATROL':
        this._lastBehavior = 'PATHING';
        // A* navigate toward player
        this._repathTimer -= dt;
        if (this._currentPath.length === 0 || this._pathIndex >= this._currentPath.length || this._repathTimer <= 0) {
          this._repathTimer = 1.5 + Math.random();
          this._computePathToPosition(playerPos);
        }
        moveDir = this._followPath(dt);
        // Sprint when far from player
        wantSprint = dist > 15 && Math.random() < this._style.sprintChance;

        // Transition: gained LOS → engage
        if (hasLOS) {
          this._enterState('ENGAGE');
        }
        break;

      case 'ENGAGE':
        this._engageTimer += dt;
        var idealDist = (this._style.engageDistMin + this._style.engageDistMax) / 2;

        if (dist > idealDist + 1.5) {
          // Approach
          moveDir.add(dir.clone().multiplyScalar(this._style.approachWeight));
          this._lastBehavior = 'APPROACHING';
          wantSprint = dist > idealDist + 5;
        } else if (dist < idealDist - 1.5) {
          // Retreat
          moveDir.add(dir.clone().multiplyScalar(-0.85));
          this._lastBehavior = 'RETREATING';
        } else {
          this._lastBehavior = 'STRAFING';
        }

        // Add strafe
        moveDir.add(this._computeStrafeDir(dir, dt));

        // Jump during engagement
        wantJump = this._shouldJump(dt);

        // Shoot
        this._tryShoot(ctx, hasLOS);

        if (this.weapon.reloading) {
          this._lastBehavior = 'RELOADING';
        }

        // Transitions
        // Lost LOS → patrol
        if (!hasLOS) {
          this._enterState('PATROL');
        }
        // Low health or reloading → seek cover (if cover spots exist)
        else if ((this.health < coverThreshold || (this.weapon.reloading && this.health < 70)) && this._coverSpots.length > 0) {
          this._enterState('SEEK_COVER');
        }
        // Stalemate → flank (if balanced or aggressive and engaged too long)
        else if (this._engageTimer > this._style.flankAfterStalemateSec && this._currentStyleName !== 'defensive') {
          this._enterState('FLANK');
        }
        break;

      case 'SEEK_COVER':
        this._lastBehavior = 'SEEKING_COVER';
        wantSprint = true;

        // Find cover spot if we don't have one
        if (!this._currentCoverSpot) {
          this._currentCoverSpot = this._findBestCoverSpot(playerPos);
          if (this._currentCoverSpot) {
            this._computePathToPosition(this._currentCoverSpot.position);
          }
        }

        if (this._currentCoverSpot) {
          var toCover = this._currentCoverSpot.position.clone().sub(this.position);
          toCover.y = 0;
          var coverDist = toCover.length();

          if (coverDist < 2.0) {
            // Arrived at cover
            this._enterState('HOLD_COVER');
          } else {
            // Path toward cover
            moveDir = this._followPath(dt);
            // If path is empty, move directly
            if (moveDir.lengthSq() < 1e-6) {
              if (toCover.lengthSq() > 1e-4) {
                moveDir.copy(toCover.normalize());
              }
            }
          }
        } else {
          // No cover found, just retreat
          moveDir.add(dir.clone().multiplyScalar(-0.85));
          // After a bit, go back to engage
          if (this._stateTimer > 2.0) {
            this._enterState('ENGAGE');
          }
        }

        // Still shoot while seeking cover
        this._tryShoot(ctx, hasLOS);
        break;

      case 'HOLD_COVER':
        // Peek cycle: hide → step out → shoot → step back
        this._coverPeekTimer -= dt;
        wantSprint = false;

        switch (this._coverPeekState) {
          case 'hiding':
            this._lastBehavior = 'IN_COVER';
            moveDir.set(0, 0, 0); // Stay still
            if (this._coverPeekTimer <= 0) {
              this._coverPeekState = 'peeking_out';
              this._coverPeekTimer = 0.4 + Math.random() * 0.3;
              // Peek direction: perpendicular to player direction
              var peekRight = new THREE.Vector3(-dir.z, 0, dir.x);
              this._peekDir = peekRight.multiplyScalar(Math.random() < 0.5 ? 1.5 : -1.5);
            }
            break;
          case 'peeking_out':
            this._lastBehavior = 'PEEKING';
            moveDir.copy(this._peekDir || dir);
            if (this._coverPeekTimer <= 0) {
              this._coverPeekState = 'shooting';
              this._coverPeekTimer = 0.6 + Math.random() * 0.4;
            }
            break;
          case 'shooting':
            this._lastBehavior = 'PEEKING';
            moveDir.set(0, 0, 0);
            this._tryShoot(ctx, hasLOS);
            if (this._coverPeekTimer <= 0) {
              this._coverPeekState = 'peeking_back';
              this._coverPeekTimer = 0.3 + Math.random() * 0.2;
            }
            break;
          case 'peeking_back':
            this._lastBehavior = 'IN_COVER';
            if (this._coverOriginalPos) {
              var toOrig = this._coverOriginalPos.clone().sub(this.position);
              toOrig.y = 0;
              if (toOrig.lengthSq() > 0.1) {
                moveDir.copy(toOrig.normalize());
              }
            }
            if (this._coverPeekTimer <= 0) {
              this._coverPeekState = 'hiding';
              this._coverPeekTimer = 0.8 + Math.random() * this._style.coverHoldTime;
            }
            break;
        }

        // Transition: healed enough or reloaded → back to engage
        if (this.health > coverThreshold + 15 && !this.weapon.reloading) {
          this._enterState('ENGAGE');
        }
        // Timeout: don't camp forever
        if (this._stateTimer > this._style.coverHoldTime * 3) {
          this._enterState('ENGAGE');
        }
        break;

      case 'FLANK':
        this._lastBehavior = 'FLANKING';
        wantSprint = true;

        // Compute flank target: perpendicular to player direction
        if (!this._flankTarget) {
          var perpSign = Math.random() < 0.5 ? 1 : -1;
          var perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(perpSign * 12);
          this._flankTarget = this.position.clone().add(perp);
          this._flankTarget.y = GROUND_Y;
          // Clamp to arena bounds
          this._flankTarget.x = Math.max(-28, Math.min(28, this._flankTarget.x));
          this._flankTarget.z = Math.max(-43, Math.min(43, this._flankTarget.z));
          this._computePathToPosition(this._flankTarget);
        }

        moveDir = this._followPath(dt);
        // If path done or close to flank target, engage
        if (moveDir.lengthSq() < 1e-6 || this.position.distanceTo(this._flankTarget) < 3.0) {
          this._enterState('ENGAGE');
        }

        // If gained LOS during flank and close enough, engage early
        if (hasLOS && dist < this._style.engageDistMax + 3) {
          this._enterState('ENGAGE');
        }

        // Timeout: don't flank forever
        if (this._stateTimer > 6.0) {
          this._enterState('ENGAGE');
        }

        // Shoot if has LOS while flanking
        this._tryShoot(ctx, hasLOS);
        break;

      case 'STUCK_RECOVER':
        this._lastBehavior = 'UNSTICKING';
        this._stuckRecoverTimer -= dt;
        moveDir.copy(this._stuckRecoverDir);
        wantSprint = true;
        wantJump = true;

        if (this._stuckRecoverTimer <= 0) {
          // Done recovering, go back to patrol
          this._stuckCheckPos.copy(this.position);
          this._stuckCount = 0;
          if (hasLOS) {
            this._enterState('ENGAGE');
          } else {
            this._enterState('PATROL');
          }
        }
        break;
    }

    // Apply movement through physics
    this._applyMovement(moveDir, wantSprint, wantJump, dt);

    // Face player
    this.player.faceToward(playerPos);

    // Update 3D Health Bar (with LOS check)
    this.player.update3DHealthBar(camera.position, solids, { checkLOS: true });
  }
}

window.AIOpponent = AIOpponent;
