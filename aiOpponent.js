// Simple AI opponent for Paintball mode
// Responsibilities: movement, LOS, firing with ammo + reload, taking damage.

class AIOpponent {
  constructor(opts) {
    const { difficulty = 'Easy', arena, spawn, color = 0xff5555 } = opts || {};
    this.difficulty = difficulty;
    this.arena = arena;
    this.walkSpeed = 3.6;
    this.radius = 0.3;
    this.health = 100;
    this.alive = true;

    // Difficulty tuning
    const diffs = {
      Easy:   { spreadRad: 0.020, cooldownMs: 350, damage: 14, magSize: 10 },
      Medium: { spreadRad: 0.012, cooldownMs: 280, damage: 16, magSize: 12 },
      Hard:   { spreadRad: 0.008, cooldownMs: 220, damage: 18, magSize: 14 },
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

    // Build a very simple humanoid
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), bodyMat);
    head.position.set(0, 1.6, 0);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.9, 16), bodyMat);
    torso.position.set(0, 1.1, 0);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    gun.position.set(0.35, 1.4, -0.1);
    group.add(head, torso, gun);
    group.position.copy(spawn || new THREE.Vector3());
    this.mesh = group;
    scene.add(group);

    // Align AI to ground (y = -1) based on its bounding box
    try {
      const bbox = new THREE.Box3().setFromObject(group);
      const dy = -1 - bbox.min.y;
      group.position.y += dy;
    } catch {}

    // Create a DOM health bar above the AI's head
    const container = document.getElementById('gameContainer');
    if (container) {
      const root = document.createElement('div');
      root.className = 'aiHealth';
      const bg = document.createElement('div');
      bg.className = 'aiHealthBg';
      const fill = document.createElement('div');
      fill.className = 'aiHealthFill';
      bg.appendChild(fill);
      root.appendChild(bg);
      container.appendChild(root);
      this._healthRoot = root;
      this._healthFill = fill;
      // Initialize
      this._healthFill.style.width = '100%';
    }

    // Internal movement helpers
    this._strafeSign = Math.random() < 0.5 ? 1 : -1;
    this._strafeTimer = 0;

    // Waypoint patrol data (move even without LOS)
    this.waypoints = (arena && arena.waypoints) ? arena.waypoints.slice() : [];
    this._wpTarget = null;
    this._repathTimer = 0;
  }

  get position() { return this.mesh.position; }
  get eyePos() { return this.mesh.position.clone().add(new THREE.Vector3(0, 1.6, 0)); }

  takeDamage(amount) {
    if (!this.alive) return;
    this.health -= amount;
    if (this._healthFill) {
      const pct = Math.max(0, Math.min(100, this.health)) + '%';
      this._healthFill.style.width = pct;
    }
    if (this.health <= 0) {
      this.alive = false;
      this.health = 0;
      // Hide mesh and health bar
      this.mesh.visible = false;
      if (this._healthRoot) this._healthRoot.style.display = 'none';
    }
  }

  destroy() {
    if (this.mesh && this.mesh.parent) {
      this.mesh.parent.remove(this.mesh);
    }
    if (this._healthRoot && this._healthRoot.parentNode) {
      this._healthRoot.parentNode.removeChild(this._healthRoot);
    }
    this._healthRoot = null;
    this._healthFill = null;
  }

  update(dt, ctx) {
    if (!this.alive) return;

    // Reload handling
    const now = performance.now();
    if (this.weapon.reloading) {
      if (performance.now() >= this.weapon.reloadEnd) {
        this.weapon.reloading = false;
        this.weapon.ammo = this.weapon.magSize;
      }
    }

    // Movement: simplistic chase/strafe based on LOS
    const playerPos = ctx.playerPos;
    const solids = this.arena.solids;

    const toPlayer = playerPos.clone().sub(this.position);
    const dist = Math.max(0.001, toPlayer.length());
    const dir = toPlayer.clone().divideScalar(dist);

    const blocked = hasBlockingBetween(this.eyePos, playerPos, solids);
    let moveVec = new THREE.Vector3();

    if (blocked) {
      // Patrol toward waypoints while trying to approach the player
      this._repathTimer -= dt;
      const needNew =
        !this._wpTarget ||
        this._repathTimer <= 0 ||
        this._wpTarget.distanceTo(this.position) < 1.0;

      if (needNew) {
        this._repathTimer = 1.0 + Math.random() * 1.0;
        if (this.waypoints && this.waypoints.length) {
          // Choose waypoint roughly toward the player (closer to player, not too far from AI)
          let best = this.waypoints[0];
          let bestScore = -Infinity;
          for (let i = 0; i < this.waypoints.length; i++) {
            const wp = this.waypoints[i];
            const toPlayer = playerPos.clone().sub(wp).length();
            const fromAI = wp.clone().sub(this.position).length();
            const score = -toPlayer - 0.25 * fromAI;
            if (score > bestScore) { bestScore = score; best = wp; }
          }
          this._wpTarget = best.clone();
        } else {
          this._wpTarget = playerPos.clone();
        }
      }

      const target = this._wpTarget || playerPos;
      const toTarget = target.clone().sub(this.position);
      toTarget.y = 0;
      if (toTarget.lengthSq() > 1e-4) {
        toTarget.normalize();
        moveVec.add(toTarget.multiplyScalar(this.walkSpeed * 0.9));
      }
    } else {
      // Has LOS: keep some distance and strafe
      const desired = 7.0;
      if (dist > desired + 1.0) {
        moveVec.add(dir.multiplyScalar(this.walkSpeed * 0.85));
      } else if (dist < desired - 1.0) {
        moveVec.add(dir.clone().multiplyScalar(-this.walkSpeed * 0.85));
      }
      // Strafe sideways
      this._strafeTimer -= dt;
      if (this._strafeTimer <= 0) {
        this._strafeTimer = 0.8 + Math.random() * 0.8;
        this._strafeSign *= -1;
      }
      const right = new THREE.Vector3(-dir.z, 0, dir.x).normalize(); // perpendicular on XZ
      moveVec.add(right.multiplyScalar(this._strafeSign * this.walkSpeed * 0.7));
    }

    // Integrate movement and resolve collisions (XZ only)
    if (moveVec.lengthSq() > 0) {
      const delta = moveVec.multiplyScalar(dt);
      this.position.add(delta);
      resolveCollisions2D(this.position, 0.3, this.arena.colliders);
    }

    // Face toward player (y-rotation only)
    const yaw = Math.atan2(toPlayer.x, toPlayer.z); // note: z axis forward in three.js screen space
    this.mesh.rotation.set(0, yaw, 0);

    // Update health bar overlay position (project head position)
    if (this._healthRoot) {
      const headPos = this.eyePos.clone().add(new THREE.Vector3(0, 0.35, 0));
      const ndc = headPos.project(camera);
      const w = window.innerWidth, h = window.innerHeight;
      const onScreen =
        ndc.z > 0 &&
        ndc.x >= -1 && ndc.x <= 1 &&
        ndc.y >= -1 && ndc.y <= 1;

      // Only show health if not occluded by solids
      const viewBlocked = hasBlockingBetween(camera.position.clone(), headPos, solids);

      if (onScreen && this.alive && !viewBlocked) {
        const sx = (ndc.x * 0.5 + 0.5) * w;
        const sy = (-ndc.y * 0.5 + 0.5) * h;
        this._healthRoot.style.display = 'block';
        // Center above the head; CSS handles transform offset
        this._healthRoot.style.left = `${sx}px`;
        this._healthRoot.style.top = `${sy}px`;
      } else {
        this._healthRoot.style.display = 'none';
      }
    }

    // Shooting
    if (!blocked && !this.weapon.reloading) {
      const canShoot = (now - this.weapon.lastShotTime) >= this.weapon.cooldownMs;
      if (canShoot && this.weapon.ammo > 0) {
        const origin = this.eyePos;
        const baseDir = playerPos.clone().sub(origin).normalize();
        const hit = fireHitscan(origin, baseDir, {
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
          this.weapon.reloadEnd = performance.now() + this.weapon.reloadTimeSec * 1000;
        }
      } else if (canShoot && this.weapon.ammo <= 0) {
        // start reload if empty
        this.weapon.reloading = true;
        this.weapon.reloadEnd = performance.now() + this.weapon.reloadTimeSec * 1000;
      }
    }
  }
}

// Expose
window.AIOpponent = AIOpponent;
