/**
 * projectiles.js — Weapon firing, hitscan raycasting, and tracer visuals
 *
 * PURPOSE: Handles all weapon firing logic. Currently implements hitscan (instant
 * raycast) weapons. All game modes call sharedFireWeapon() to fire — it handles
 * the pellet loop, spread cone, multi-target sphere raycasting, tracer spawning,
 * and ammo management. Mode-specific behavior (damage, networking) is expressed
 * through onHit and onPelletFired callbacks.
 *
 * EXPORTS (window):
 *   applySpread(dir, spreadRad)    — apply random cone spread to a direction
 *   rayHitsSphere(...)             — sphere intersection test for hitboxes
 *   spawnTracer(origin, end, ...)  — visual tracer from origin to endpoint
 *   fireHitscan(origin, dir, opts) — single-ray hitscan (low-level)
 *   sharedFireWeapon(weapon, origin, dir, opts) — unified multi-pellet firing
 *
 * DEPENDENCIES: Three.js (scene, THREE), weapon.js (Weapon instance for stats)
 *
 * DESIGN NOTES:
 *   - sharedFireWeapon checks weapon.projectileSpeed. If null/undefined, it uses
 *     hitscan (current behavior). When projectileSpeed is a number, the projectile
 *     path should be used instead (not yet implemented).
 *   - Tracers are visual-only (small spheres that animate from origin to hit point).
 *     They don't affect gameplay and self-clean after their lifetime.
 *   - The raycaster checks world solids first, then sphere hitboxes. A hit is only
 *     registered if no world geometry blocks the path to the target.
 *
 * TODO (future):
 *   - Projectile-speed weapon path: spawn a moving entity per shot, check collision
 *     each frame, apply projectileGravity for drop, despawn on hit or max range
 *   - Splash damage: on projectile impact, find all targets within splashRadius
 *     and apply damage falloff by distance
 *   - Headshot detection: check which hitbox segment (head/torso/legs) was hit
 *     and apply damage multiplier
 *   - Bullet penetration (shoot through thin walls)
 *   - Tracer visual customization per weapon (size, trail, glow)
 *   - Muzzle flash particle effect at origin
 */

// Projectiles and hitscan utilities

(function () {
  const DEFAULT_MAX_DIST = 200;

  // Random unit vector within a cone of angle 'spreadRad' around 'dir'
  function applySpread(dir, spreadRad) {
    if (!spreadRad || spreadRad <= 0) return dir.clone().normalize();
    // Build orthonormal basis around dir
    const forward = dir.clone().normalize();
    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(forward.dot(up)) > 0.99) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();

    // Random small yaw/pitch within cone
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const r = spreadRad * Math.sqrt(v); // more dense near center
    const offset = right.clone().multiplyScalar(Math.cos(theta) * r)
      .add(trueUp.clone().multiplyScalar(Math.sin(theta) * r));

    const out = forward.clone().add(offset).normalize();
    return out;
  }

  // Ray-sphere intersection: distance from ray to center <= radius
  function rayHitsSphere(origin, dir, center, radius, maxDist) {
    // Ensure dir is normalized for correct distance calculations
    if (Math.abs(dir.lengthSq() - 1.0) > 0.01) {
      dir = dir.clone().normalize();
    }
    const oc = center.clone().sub(origin);
    const t = oc.dot(dir);
    if (t < 0 || t > maxDist) return false;
    const closest = origin.clone().add(dir.clone().multiplyScalar(t));
    const dist2 = closest.distanceToSquared(center);
    return dist2 <= radius * radius;
  }

  // Visual bullet: small sphere that travels from origin to hit point
  function spawnTracer(origin, end, color = 0x00ff88, lifetimeMs = 60) {
    try {
      const radius = 0.06;
      const geom = new THREE.SphereGeometry(radius, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color });
      const bullet = new THREE.Mesh(geom, mat);
      bullet.frustumCulled = false;
      bullet.position.copy(origin);
      scene.add(bullet);

      const totalDist = origin.distanceTo(end);
      const speed = 120; // units per second
      const travelMs = (totalDist / Math.max(0.001, speed)) * 1000;
      const duration = Math.max(lifetimeMs, travelMs);

      const start = performance.now();
      function step() {
        const now = performance.now();
        const t = Math.min(1, (now - start) / duration);
        const pos = new THREE.Vector3().lerpVectors(origin, end, t);
        bullet.position.copy(pos);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          scene.remove(bullet);
          try { geom.dispose(); mat.dispose(); } catch(e) { console.warn('projectiles: tracer cleanup error', e); }
        }
      }
      requestAnimationFrame(step);
    } catch(e) { console.warn('projectiles: tracer spawn error', e); }
  }

  // Fire a single hitscan shot.
  // options:
  //  - spreadRad: radians of inaccuracy cone
  //  - solids: array<Object3D> to raycast against for blocking world
  //  - playerTarget: { position: Vector3, radius: number } sphere hitbox (optional)
  //  - maxDistance: number
  //  - tracerColor: hex
  function fireHitscan(origin, baseDir, options = {}) {
    const spreadRad = options.spreadRad || 0;
    const solids = Array.isArray(options.solids) ? options.solids : [];
    const playerTarget = options.playerTarget || null;
    const maxDist = options.maxDistance || DEFAULT_MAX_DIST;
    const tracerColor = options.tracerColor || 0xffee66;

    const dir = applySpread(baseDir, spreadRad);
    const raycaster = new THREE.Raycaster(origin, dir, 0, maxDist);

    let hitInfo = { hit: false, hitType: null, object: null, point: origin.clone().add(dir.clone().multiplyScalar(maxDist)), distance: maxDist };

    // Raycast against world solids
    let intersects = [];
    try {
      intersects = raycaster.intersectObjects(solids, true);
    } catch(e) {
      console.warn('projectiles: raycast error', e);
      intersects = [];
    }

    if (intersects.length > 0) {
      const first = intersects[0];
      hitInfo.hit = true;
      hitInfo.point = first.point.clone();
      hitInfo.distance = first.distance;
      hitInfo.object = first.object;
      hitInfo.hitType = 'world';
    }

    // Check player/AI hit via sphere test
    if (playerTarget && playerTarget.position && playerTarget.radius != null) {
      const playerHit = rayHitsSphere(origin, dir, playerTarget.position, playerTarget.radius, maxDist);
      if (playerHit) {
        // Ensure no world blocker before the player
        let blocked = false;
        if (solids.length > 0) {
          const distToPlayer = playerTarget.position.clone().sub(origin).dot(dir);
          const rc = new THREE.Raycaster(origin, dir, 0, Math.max(0.001, distToPlayer));
          const worldHits = rc.intersectObjects(solids, true);
          blocked = worldHits && worldHits.length > 0;
        }
        if (!blocked) {
          const t = playerTarget.position.clone().sub(origin).dot(dir);
          const pointOnRay = origin.clone().add(dir.clone().multiplyScalar(Math.min(t, maxDist)));
          if (!hitInfo.hit || (pointOnRay.distanceTo(origin) < hitInfo.distance)) {
            hitInfo.hit = true;
            hitInfo.hitType = 'player';
            hitInfo.object = null;
            hitInfo.point = pointOnRay;
            hitInfo.distance = pointOnRay.distanceTo(origin);
          }
        }
      }
    }

    // Tracer visualization from origin to actual hit point (or max dist)
    spawnTracer(origin.clone(), hitInfo.point.clone(), tracerColor, 70);

    return hitInfo;
  }

  // Unified weapon firing: pellet loop, spread, multi-target raycast, tracers, ammo.
  // All game modes call this instead of inline pellet loops.
  //
  // opts:
  //   sprinting     - boolean, use sprintSpreadRad instead of spreadRad
  //   spreadOverride - number, overrides automatic spread (e.g. for AI aim error)
  //   solids        - Array<Object3D> world geometry for raycast
  //   targets       - Array<{position, radius, ...}> sphere hitboxes (extra fields flow to onHit)
  //   tracerColor   - hex color for tracers
  //   onHit(target, point, dist, pelletIdx) - called per pellet-target hit; return false to stop
  //   onPelletFired(result, pelletIdx)      - called per pellet after raycast
  //   skipAmmo      - boolean, skip ammo/lastShotTime management
  //
  // Returns { pelletsFired, hits, results[], magazineEmpty }
  function sharedFireWeapon(weapon, origin, baseDir, opts) {
    opts = opts || {};
    var pelletCount = weapon.pellets || 1;
    var spread = (typeof opts.spreadOverride === 'number')
      ? opts.spreadOverride
      : (opts.sprinting ? weapon.sprintSpreadRad : weapon.spreadRad);
    var maxDist = weapon.maxRange || DEFAULT_MAX_DIST;
    var solids = Array.isArray(opts.solids) ? opts.solids : [];
    var targets = Array.isArray(opts.targets) ? opts.targets : [];
    var tracerColor = (typeof opts.tracerColor === 'number') ? opts.tracerColor : 0xffee66;
    var onHit = opts.onHit || null;
    var onPelletFired = opts.onPelletFired || null;

    var hits = 0;
    var results = [];
    var stopped = false;

    for (var p = 0; p < pelletCount; p++) {
      if (stopped) break;

      var dir = applySpread(baseDir, spread);
      var raycaster = new THREE.Raycaster(origin, dir, 0, maxDist);

      // Find wall hit distance
      var wallDist = maxDist;
      var endPoint = origin.clone().add(dir.clone().multiplyScalar(maxDist));
      try {
        var worldHits = raycaster.intersectObjects(solids, true);
        if (worldHits.length > 0) {
          wallDist = worldHits[0].distance;
          endPoint = worldHits[0].point.clone();
        }
      } catch (e) {}

      // Check all targets for closest hit before wall
      var closestDist = wallDist;
      var closestTarget = null;
      var closestPoint = endPoint;

      for (var t = 0; t < targets.length; t++) {
        var tgt = targets[t];
        if (!tgt || !tgt.position) continue;
        var r = tgt.radius || 0.35;
        if (rayHitsSphere(origin, dir, tgt.position, r, closestDist)) {
          var d = tgt.position.clone().sub(origin).dot(dir);
          if (d > 0 && d < closestDist) {
            closestDist = d;
            closestTarget = tgt;
            closestPoint = origin.clone().add(dir.clone().multiplyScalar(d));
          }
        }
      }

      // Tracer
      spawnTracer(origin.clone(), closestPoint.clone(), tracerColor, 70);

      var result = {
        hit: !!closestTarget,
        hitTarget: closestTarget,
        point: closestPoint,
        distance: closestDist,
        wallDist: wallDist,
        dir: dir
      };
      results.push(result);

      // Hit callback
      if (closestTarget && onHit) {
        hits++;
        var cont = onHit(closestTarget, closestPoint, closestDist, p);
        if (cont === false) stopped = true;
      } else if (closestTarget) {
        hits++;
      }

      // Per-pellet callback
      if (onPelletFired) {
        onPelletFired(result, p);
      }
    }

    // Ammo management
    var magazineEmpty = false;
    if (!opts.skipAmmo) {
      weapon.ammo--;
      weapon.lastShotTime = performance.now();
      if (weapon.ammo <= 0) magazineEmpty = true;
    }

    return { pelletsFired: stopped ? results.length : pelletCount, hits: hits, results: results, magazineEmpty: magazineEmpty };
  }

  // Expose
  window.applySpread = applySpread;
  window.rayHitsSphere = rayHitsSphere;
  window.spawnTracer = spawnTracer;
  window.fireHitscan = fireHitscan;
  window.sharedFireWeapon = sharedFireWeapon;
})();
