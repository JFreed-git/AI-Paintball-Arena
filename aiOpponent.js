// AI opponent for Paintball mode
// Responsibilities: A* pathfinding, movement, LOS, firing with ammo + reload, taking damage.
// 3D health bar floats above the AI's head (billboarded toward camera).

class AIOpponent {
  constructor(opts) {
    const { difficulty = 'Easy', arena, spawn, color = 0xff5555 } = opts || {};
    this.difficulty = difficulty;
    this.arena = arena;
    this.walkSpeed = 3.6;
    this.radius = 0.5;
    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.alive = true;

    // Difficulty tuning
    const diffs = {
      Easy:   { spreadRad: 0.020, cooldownMs: 250, damage: 15, magSize: 8 },
      Medium: { spreadRad: 0.012, cooldownMs: 166, damage: 20, magSize: 6 },
      Hard:   { spreadRad: 0.008, cooldownMs: 166, damage: 20, magSize: 6 },
    };
    const d = diffs[this.difficulty] || diffs.Easy;

    this.weapon = {
      spreadRad: d.spreadRad,
      cooldownMs: d.cooldownMs,
      damage: d.damage,
      magSize: d.magSize,
      ammo: d.magSize,
      reloading: false,
      reloadEnd: 0,
      lastShotTime: 0,
      reloadTimeSec: 2.0
    };

    // Build a simple humanoid mesh
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
    head.position.set(0, 1.6, 0);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 16), bodyMat);
    torso.position.set(0, 1.1, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    gun.position.set(0.35, 1.4, -0.1);
    group.add(head, torso, gun);
    group.scale.set(1.5, 1.5, 1.5);
    group.position.copy(spawn || new THREE.Vector3());
    this.mesh = group;
    scene.add(group);

    // Align AI to ground
    try {
      const bbox = new THREE.Box3().setFromObject(group);
      const dy = -1 - bbox.min.y;
      group.position.y += dy;
    } catch {}

    // --- 3D Health Bar ---
    this._buildHealthBar3D();
    this.lastDamagedAt = -Infinity;

    // Movement helpers
    this._strafeSign = Math.random() < 0.5 ? 1 : -1;
    this._strafeTimer = 0;

    // A* pathfinding data
    this.waypoints = (arena && arena.waypoints) ? arena.waypoints.slice() : [];
    this._currentPath = [];
    this._pathIndex = 0;
    this._repathTimer = 0;
    this._waypointGraph = this._buildWaypointGraph();
  }

  // --- 3D Health Bar ---

  _buildHealthBar3D() {
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
    this.mesh.add(this._healthBarGroup);
  }

  // --- Waypoint Graph for A* ---

  _buildWaypointGraph() {
    var wps = this.waypoints;
    var solids = this.arena ? this.arena.solids : [];
    var n = wps.length;
    var graph = new Array(n);
    for (var i = 0; i < n; i++) graph[i] = [];

    var losY = 1.0;
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dist = wps[i].distanceTo(wps[j]);
        if (dist > 40) continue;
        var a = new THREE.Vector3(wps[i].x, losY, wps[i].z);
        var b = new THREE.Vector3(wps[j].x, losY, wps[j].z);
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

  _computePathToPlayer(playerPos) {
    if (!this.waypoints || this.waypoints.length === 0) {
      this._currentPath = [];
      this._pathIndex = 0;
      return;
    }
    var startIdx = this._findNearestWaypointIndex(this.position);
    var goalIdx = this._findNearestWaypointIndex(playerPos);
    var pathIndices = this._astar(startIdx, goalIdx);
    this._currentPath = pathIndices.map(function (i) { return this.waypoints[i].clone(); }.bind(this));
    this._pathIndex = 0;
  }

  get position() { return this.mesh.position; }
  get eyePos() {
    var sy = (this.mesh && this.mesh.scale) ? this.mesh.scale.y : 1;
    return this.mesh.position.clone().add(new THREE.Vector3(0, 1.6 * sy, 0));
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    this.lastDamagedAt = performance.now();
    if (this.health <= 0) {
      this.alive = false;
      this.health = 0;
      this.mesh.visible = false;
      if (this._healthBarGroup) this._healthBarGroup.visible = false;
    }
  }

  destroy() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    if (this._healthBarGroup) {
      if (this._healthBarFill) { this._healthBarFill.geometry.dispose(); this._healthBarFill.material.dispose(); }
      if (this._healthBarBg) { this._healthBarBg.geometry.dispose(); this._healthBarBg.material.dispose(); }
      if (this._healthBarGroup.parent) this._healthBarGroup.parent.remove(this._healthBarGroup);
      this._healthBarGroup = null;
      this._healthBarFill = null;
      this._healthBarBg = null;
    }
  }

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

    // Movement
    var playerPos = ctx.playerPos;
    var solids = this.arena.solids;
    var toPlayer = playerPos.clone().sub(this.position);
    var dist = Math.max(0.001, toPlayer.length());
    var dir = toPlayer.clone();
    dir.y = 0; // flatten to XZ — AI should never move vertically
    if (dir.lengthSq() > 1e-6) dir.normalize(); else dir.set(0, 0, -1);
    var blocked = hasBlockingBetween(this.eyePos, playerPos, solids);
    var moveVec = new THREE.Vector3();

    if (blocked) {
      // A* navigation when no line of sight
      this._repathTimer -= dt;
      var atEnd = this._pathIndex >= this._currentPath.length;
      if (!atEnd && this._currentPath[this._pathIndex] &&
          this._currentPath[this._pathIndex].distanceTo(this.position) < 1.5) {
        this._pathIndex++;
      }
      if (this._currentPath.length === 0 || this._pathIndex >= this._currentPath.length || this._repathTimer <= 0) {
        this._repathTimer = 1.5 + Math.random();
        this._computePathToPlayer(playerPos);
      }
      if (this._pathIndex < this._currentPath.length) {
        var target = this._currentPath[this._pathIndex];
        var toTarget = target.clone().sub(this.position);
        toTarget.y = 0;
        if (toTarget.lengthSq() > 1e-4) {
          toTarget.normalize();
          moveVec.add(toTarget.multiplyScalar(this.walkSpeed * 0.9));
        }
      } else {
        var toP = playerPos.clone().sub(this.position);
        toP.y = 0;
        if (toP.lengthSq() > 1e-4) {
          toP.normalize();
          moveVec.add(toP.multiplyScalar(this.walkSpeed * 0.5));
        }
      }
    } else {
      // Has LOS — clear path, strafe and maintain distance
      this._currentPath = [];
      this._pathIndex = 0;
      var desired = 7.0;
      if (dist > desired + 1.0) {
        moveVec.add(dir.multiplyScalar(this.walkSpeed * 0.85));
      } else if (dist < desired - 1.0) {
        moveVec.add(dir.clone().multiplyScalar(-this.walkSpeed * 0.85));
      }
      this._strafeTimer -= dt;
      if (this._strafeTimer <= 0) {
        this._strafeTimer = 0.8 + Math.random() * 0.8;
        this._strafeSign *= -1;
      }
      var right = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
      moveVec.add(right.multiplyScalar(this._strafeSign * this.walkSpeed * 0.7));
    }

    if (moveVec.lengthSq() > 0) {
      moveVec.y = 0; // enforce XZ-only movement
      var savedY = this.position.y;
      this.position.add(moveVec.multiplyScalar(dt));
      this.position.y = savedY; // restore Y — AI never moves vertically
      resolveCollisions2D(this.position, this.radius, this.arena.colliders);
    }

    // Face player
    var yaw = Math.atan2(toPlayer.x, toPlayer.z);
    this.mesh.rotation.set(0, yaw, 0);

    // --- Update 3D Health Bar ---
    if (this._healthBarGroup) {
      var recentlyDamaged = this.lastDamagedAt > 0 && (now - this.lastDamagedAt) <= 5000;
      var showBar = recentlyDamaged && this.alive && this.health < this.maxHealth;
      this._healthBarGroup.visible = showBar;

      if (showBar) {
        // Billboard: counter parent rotation to face camera
        var worldPos = new THREE.Vector3();
        this._healthBarGroup.getWorldPosition(worldPos);
        var lookDir = camera.position.clone().sub(worldPos);
        lookDir.y = 0;
        if (lookDir.lengthSq() > 1e-6) {
          var worldYaw = Math.atan2(lookDir.x, lookDir.z);
          this._healthBarGroup.rotation.y = worldYaw - this.mesh.rotation.y;
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
    }

    // Shooting (only when has LOS and not reloading)
    if (!blocked && !this.weapon.reloading) {
      var canShoot = (now - this.weapon.lastShotTime) >= this.weapon.cooldownMs;
      if (canShoot && this.weapon.ammo > 0) {
        var origin = this.eyePos;
        var baseDir = playerPos.clone().sub(origin).normalize();
        var hit = fireHitscan(origin, baseDir, {
          spreadRad: this.weapon.spreadRad,
          solids: solids,
          playerTarget: { position: playerPos, radius: ctx.playerRadius || 0.35 },
          tracerColor: 0xff6666,
          maxDistance: 200
        });
        if (hit.hit && hit.hitType === 'player') {
          ctx.onPlayerHit && ctx.onPlayerHit(this.weapon.damage);
        }
        this.weapon.ammo--;
        this.weapon.lastShotTime = now;
        if (this.weapon.ammo <= 0) {
          this.weapon.reloading = true;
          this.weapon.reloadEnd = now + this.weapon.reloadTimeSec * 1000;
        }
      } else if (canShoot && this.weapon.ammo <= 0) {
        this.weapon.reloading = true;
        this.weapon.reloadEnd = now + this.weapon.reloadTimeSec * 1000;
      }
    }
  }
}

window.AIOpponent = AIOpponent;
