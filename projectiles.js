/**
 * projectiles.js — Weapon firing, hitscan/projectile raycasting, and tracer visuals
 *
 * PURPOSE: Handles all weapon firing logic. Supports both hitscan (instant raycast)
 * and projectile (traveling bullet) weapons. All game modes call sharedFireWeapon()
 * to fire — it handles the pellet loop, spread cone, hit testing, tracer spawning,
 * and ammo management. Mode-specific behavior (damage, networking) is expressed
 * through onHit and onPelletFired callbacks.
 *
 * EXPORTS (window):
 *   applySpread(dir, spreadRad)       — apply random cone spread to a direction
 *   rayHitsSphere(...)                — sphere intersection test (legacy/training targets)
 *   rayHitsAABB(origin, dir, boxMin, boxMax, maxDist) — ray-AABB slab intersection
 *   testHitSegments(origin, dir, segments, maxDist)   — test ray against hitbox segments
 *   spawnTracer(origin, end, ...)     — visual tracer from origin to endpoint
 *   fireHitscan(origin, dir, opts)    — single-ray hitscan (low-level)
 *   sharedFireWeapon(weapon, origin, dir, opts) — unified multi-pellet firing
 *   spawnProjectile(opts)             — spawn a traveling projectile entity
 *   updateProjectiles(dt)             — per-frame update of all live projectiles
 *   clearAllProjectiles()             — remove all live projectiles
 *
 * DEPENDENCIES: Three.js (scene, THREE), weapon.js (Weapon instance for stats)
 *
 * DESIGN NOTES:
 *   - sharedFireWeapon checks weapon.projectileSpeed. If null/0, it uses hitscan.
 *     When projectileSpeed > 0, it spawns projectile entities instead.
 *   - Targets can have either `segments` (array of {box, damageMultiplier}) for
 *     segmented hitboxes or `position`+`radius` for legacy sphere hitboxes.
 *   - Projectiles move each frame, test collision against solids and target segments,
 *     and self-clean on hit, wall collision, or max range.
 */

(function () {
  var DEFAULT_MAX_DIST = 200;

  // --- Live projectile storage ---
  var _liveProjectiles = [];

  // Random unit vector within a cone of angle 'spreadRad' around 'dir'
  function applySpread(dir, spreadRad) {
    if (!spreadRad || spreadRad <= 0) return dir.clone().normalize();
    var forward = dir.clone().normalize();
    var up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(forward.dot(up)) > 0.99) {
      up = new THREE.Vector3(1, 0, 0);
    }
    var right = new THREE.Vector3().crossVectors(forward, up).normalize();
    var trueUp = new THREE.Vector3().crossVectors(right, forward).normalize();

    var u = Math.random();
    var v = Math.random();
    var theta = 2 * Math.PI * u;
    var r = spreadRad * Math.sqrt(v);
    var offset = right.clone().multiplyScalar(Math.cos(theta) * r)
      .add(trueUp.clone().multiplyScalar(Math.sin(theta) * r));

    return forward.clone().add(offset).normalize();
  }

  // Ray-sphere intersection: distance from ray to center <= radius
  function rayHitsSphere(origin, dir, center, radius, maxDist) {
    if (Math.abs(dir.lengthSq() - 1.0) > 0.01) {
      dir = dir.clone().normalize();
    }
    var oc = center.clone().sub(origin);
    var t = oc.dot(dir);
    if (t < 0 || t > maxDist) return false;
    var closest = origin.clone().add(dir.clone().multiplyScalar(t));
    var dist2 = closest.distanceToSquared(center);
    return dist2 <= radius * radius;
  }

  // Ray-AABB intersection using slab method
  // Returns {hit: true, distance, point} or {hit: false}
  function rayHitsAABB(origin, dir, boxMin, boxMax, maxDist) {
    var tmin = 0;
    var tmax = maxDist;

    for (var i = 0; i < 3; i++) {
      var axis = (i === 0) ? 'x' : (i === 1) ? 'y' : 'z';
      var o = origin[axis];
      var d = dir[axis];
      var bmin = boxMin[axis];
      var bmax = boxMax[axis];

      if (Math.abs(d) < 1e-8) {
        // Ray parallel to slab — miss if origin outside
        if (o < bmin || o > bmax) return { hit: false };
      } else {
        var t1 = (bmin - o) / d;
        var t2 = (bmax - o) / d;
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return { hit: false };
      }
    }

    if (tmin > maxDist) return { hit: false };
    var point = origin.clone().add(dir.clone().multiplyScalar(tmin));
    return { hit: true, distance: tmin, point: point };
  }

  // Test ray against an array of hitbox segments, return closest hit
  // segments: [{box: THREE.Box3, damageMultiplier: number, name: string}, ...]
  // Returns {hit: true, segment, distance, point, damageMultiplier} or {hit: false}
  function testHitSegments(origin, dir, segments, maxDist) {
    var closestDist = maxDist;
    var closestResult = { hit: false };

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var box = seg.box;
      var result = rayHitsAABB(origin, dir, box.min, box.max, closestDist);
      if (result.hit && result.distance < closestDist) {
        closestDist = result.distance;
        closestResult = {
          hit: true,
          segment: seg,
          distance: result.distance,
          point: result.point,
          damageMultiplier: seg.damageMultiplier || 1.0
        };
      }
    }

    return closestResult;
  }

  // Visual bullet: small sphere that travels from origin to hit point
  function spawnTracer(origin, end, color, lifetimeMs) {
    if (color === undefined) color = 0x00ff88;
    if (lifetimeMs === undefined) lifetimeMs = 60;
    try {
      var radius = 0.06;
      var geom = new THREE.SphereGeometry(radius, 12, 12);
      var mat = new THREE.MeshBasicMaterial({ color: color });
      var bullet = new THREE.Mesh(geom, mat);
      bullet.frustumCulled = false;
      bullet.position.copy(origin);
      scene.add(bullet);

      var totalDist = origin.distanceTo(end);
      var speed = 120;
      var travelMs = (totalDist / Math.max(0.001, speed)) * 1000;
      var duration = Math.max(lifetimeMs, travelMs);

      var start = performance.now();
      function step() {
        var now = performance.now();
        var t = Math.min(1, (now - start) / duration);
        var pos = new THREE.Vector3().lerpVectors(origin, end, t);
        bullet.position.copy(pos);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          scene.remove(bullet);
          try { geom.dispose(); mat.dispose(); } catch(e) {}
        }
      }
      requestAnimationFrame(step);
    } catch(e) { console.warn('projectiles: tracer spawn error', e); }
  }

  // Fire a single hitscan shot. (low-level, kept for backward compat)
  function fireHitscan(origin, baseDir, options) {
    options = options || {};
    var spreadRad = options.spreadRad || 0;
    var solids = Array.isArray(options.solids) ? options.solids : [];
    var playerTarget = options.playerTarget || null;
    var maxDist = options.maxDistance || DEFAULT_MAX_DIST;
    var tracerColor = options.tracerColor || 0xffee66;

    var dir = applySpread(baseDir, spreadRad);
    var raycaster = new THREE.Raycaster(origin, dir, 0, maxDist);

    var hitInfo = { hit: false, hitType: null, object: null, point: origin.clone().add(dir.clone().multiplyScalar(maxDist)), distance: maxDist };

    var intersects = [];
    try {
      intersects = raycaster.intersectObjects(solids, true);
    } catch(e) {
      intersects = [];
    }

    if (intersects.length > 0) {
      var first = intersects[0];
      hitInfo.hit = true;
      hitInfo.point = first.point.clone();
      hitInfo.distance = first.distance;
      hitInfo.object = first.object;
      hitInfo.hitType = 'world';
    }

    if (playerTarget && playerTarget.position && playerTarget.radius != null) {
      var playerHit = rayHitsSphere(origin, dir, playerTarget.position, playerTarget.radius, maxDist);
      if (playerHit) {
        var blocked = false;
        if (solids.length > 0) {
          var distToPlayer = playerTarget.position.clone().sub(origin).dot(dir);
          var rc = new THREE.Raycaster(origin, dir, 0, Math.max(0.001, distToPlayer));
          var worldHits = rc.intersectObjects(solids, true);
          blocked = worldHits && worldHits.length > 0;
        }
        if (!blocked) {
          var t = playerTarget.position.clone().sub(origin).dot(dir);
          var pointOnRay = origin.clone().add(dir.clone().multiplyScalar(Math.min(t, maxDist)));
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

    spawnTracer(origin.clone(), hitInfo.point.clone(), tracerColor, 70);
    return hitInfo;
  }

  // --- Unified weapon firing ---
  //
  // opts:
  //   sprinting      - boolean, use sprintSpreadRad instead of spreadRad
  //   spreadOverride  - number, overrides automatic spread (e.g. for AI aim error)
  //   solids          - Array<Object3D> world geometry for raycast
  //   targets         - Array<{segments?, position?, radius?, ...}> hitboxes
  //                     segments: use testHitSegments (new segmented hitbox)
  //                     position+radius: use rayHitsSphere (legacy sphere)
  //   tracerColor     - hex color for tracers
  //   onHit(target, point, dist, pelletIdx, damageMultiplier)
  //   onPelletFired(result, pelletIdx)
  //   skipAmmo        - boolean, skip ammo/lastShotTime management
  //   projectileTargetEntities - Array of Player/entity objects for projectile mode
  //                              (projectiles re-read segments each frame)
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

    // Projectile mode: spawn traveling projectiles instead of hitscan
    var projSpeed = weapon.projectileSpeed;
    if (projSpeed && projSpeed > 0) {
      var projTargetEntities = opts.projectileTargetEntities || [];
      var projResults = [];

      for (var pi = 0; pi < pelletCount; pi++) {
        var projDir = applySpread(baseDir, spread);
        var vel = projDir.clone().multiplyScalar(projSpeed);

        spawnProjectile({
          position: origin.clone(),
          velocity: vel,
          gravity: weapon.projectileGravity || 0,
          damage: weapon.damage || 20,
          maxRange: maxDist,
          solids: solids,
          targetEntities: projTargetEntities,
          onHit: onHit,
          tracerColor: tracerColor,
          origin: origin.clone()
        });

        var projResult = { hit: false, dir: projDir };
        projResults.push(projResult);

        if (onPelletFired) {
          onPelletFired(projResult, pi);
        }
      }

      // Ammo management
      var projMagEmpty = false;
      if (!opts.skipAmmo) {
        weapon.ammo--;
        weapon.lastShotTime = performance.now();
        if (weapon.ammo <= 0) projMagEmpty = true;
      }

      return { pelletsFired: pelletCount, hits: 0, results: projResults, magazineEmpty: projMagEmpty };
    }

    // Hitscan mode (projectileSpeed is null/0)
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
      var closestMultiplier = 1.0;

      for (var t = 0; t < targets.length; t++) {
        var tgt = targets[t];
        if (!tgt) continue;

        // Segmented hitbox path
        if (tgt.segments && tgt.segments.length > 0) {
          var segResult = testHitSegments(origin, dir, tgt.segments, closestDist);
          if (segResult.hit && segResult.distance < closestDist) {
            closestDist = segResult.distance;
            closestTarget = tgt;
            closestPoint = segResult.point;
            closestMultiplier = segResult.damageMultiplier;
          }
        }
        // Legacy sphere hitbox path
        else if (tgt.position) {
          var r = tgt.radius || 0.35;
          if (rayHitsSphere(origin, dir, tgt.position, r, closestDist)) {
            var d = tgt.position.clone().sub(origin).dot(dir);
            if (d > 0 && d < closestDist) {
              closestDist = d;
              closestTarget = tgt;
              closestPoint = origin.clone().add(dir.clone().multiplyScalar(d));
              closestMultiplier = 1.0;
            }
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
        dir: dir,
        damageMultiplier: closestMultiplier
      };
      results.push(result);

      // Hit callback (now passes damageMultiplier as 5th arg)
      if (closestTarget && onHit) {
        hits++;
        var cont = onHit(closestTarget, closestPoint, closestDist, p, closestMultiplier);
        if (cont === false) stopped = true;
      } else if (closestTarget) {
        hits++;
      }

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

  // --- Projectile Manager ---

  function spawnProjectile(opts) {
    var geom = new THREE.SphereGeometry(0.06, 8, 8);
    var mat = new THREE.MeshBasicMaterial({ color: opts.tracerColor || 0xffee66 });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.position.copy(opts.position);
    scene.add(mesh);

    _liveProjectiles.push({
      position: opts.position.clone(),
      velocity: opts.velocity.clone(),
      gravity: opts.gravity || 0,
      damage: opts.damage || 20,
      maxRange: opts.maxRange || DEFAULT_MAX_DIST,
      distanceTraveled: 0,
      mesh: mesh,
      geom: geom,
      mat: mat,
      solids: opts.solids || [],
      targetEntities: opts.targetEntities || [],
      onHit: opts.onHit || null,
      origin: opts.origin ? opts.origin.clone() : opts.position.clone()
    });
  }

  // Spawn a visual-only projectile (no damage, for client-side LAN visuals)
  function spawnVisualProjectile(opts) {
    var geom = new THREE.SphereGeometry(0.06, 8, 8);
    var mat = new THREE.MeshBasicMaterial({ color: opts.tracerColor || 0xffee66 });
    var mesh = new THREE.Mesh(geom, mat);
    mesh.frustumCulled = false;
    mesh.position.copy(opts.position);
    scene.add(mesh);

    _liveProjectiles.push({
      position: opts.position.clone(),
      velocity: opts.velocity.clone(),
      gravity: opts.gravity || 0,
      damage: 0,
      maxRange: opts.maxRange || DEFAULT_MAX_DIST,
      distanceTraveled: 0,
      mesh: mesh,
      geom: geom,
      mat: mat,
      solids: opts.solids || [],
      targetEntities: [],
      onHit: null,
      origin: opts.position.clone(),
      visualOnly: true
    });
  }

  function updateProjectiles(dt) {
    if (_liveProjectiles.length === 0) return;

    var toRemove = [];
    var _tmpRaycaster = new THREE.Raycaster();

    for (var i = 0; i < _liveProjectiles.length; i++) {
      var proj = _liveProjectiles[i];

      // Apply gravity
      proj.velocity.y -= proj.gravity * dt;

      // Compute frame movement
      var delta = proj.velocity.clone().multiplyScalar(dt);
      var frameDistance = delta.length();

      // Wall collision: short raycast along movement direction
      var hitWall = false;
      if (proj.solids.length > 0 && frameDistance > 0.001) {
        var moveDir = delta.clone().normalize();
        _tmpRaycaster.set(proj.position, moveDir);
        _tmpRaycaster.near = 0;
        _tmpRaycaster.far = frameDistance;
        try {
          var wallHits = _tmpRaycaster.intersectObjects(proj.solids, true);
          if (wallHits.length > 0) {
            hitWall = true;
          }
        } catch (e) {}
      }

      if (hitWall) {
        toRemove.push(i);
        continue;
      }

      // Target collision (only for non-visual projectiles)
      var hitTarget = false;
      if (!proj.visualOnly && proj.targetEntities.length > 0) {
        var newPos = proj.position.clone().add(delta);

        for (var te = 0; te < proj.targetEntities.length; te++) {
          var entity = proj.targetEntities[te];
          if (!entity || !entity.alive) continue;

          var segments = (typeof entity.getHitSegments === 'function') ? entity.getHitSegments() : [];
          if (segments.length === 0) continue;

          // Test ray from current position along delta against segments
          if (frameDistance > 0.001) {
            var moveDir2 = delta.clone().normalize();
            var segResult = testHitSegments(proj.position, moveDir2, segments, frameDistance);
            if (segResult.hit) {
              hitTarget = true;
              if (proj.onHit) {
                proj.onHit(entity, segResult.point, segResult.distance, 0, segResult.damageMultiplier);
              }
              toRemove.push(i);
              break;
            }
          }
        }
      }

      if (hitTarget) continue;

      // Move projectile
      proj.position.add(delta);
      proj.distanceTraveled += frameDistance;
      proj.mesh.position.copy(proj.position);

      // Max range check
      if (proj.distanceTraveled >= proj.maxRange) {
        toRemove.push(i);
      }
    }

    // Remove dead projectiles (iterate in reverse to preserve indices)
    for (var r = toRemove.length - 1; r >= 0; r--) {
      var idx = toRemove[r];
      var dead = _liveProjectiles[idx];
      scene.remove(dead.mesh);
      try { dead.geom.dispose(); dead.mat.dispose(); } catch (e) {}
      _liveProjectiles.splice(idx, 1);
    }
  }

  function clearAllProjectiles() {
    for (var i = 0; i < _liveProjectiles.length; i++) {
      var proj = _liveProjectiles[i];
      scene.remove(proj.mesh);
      try { proj.geom.dispose(); proj.mat.dispose(); } catch (e) {}
    }
    _liveProjectiles.length = 0;
  }

  // Expose
  window.applySpread = applySpread;
  window.rayHitsSphere = rayHitsSphere;
  window.rayHitsAABB = rayHitsAABB;
  window.testHitSegments = testHitSegments;
  window.spawnTracer = spawnTracer;
  window.fireHitscan = fireHitscan;
  window.sharedFireWeapon = sharedFireWeapon;
  window.spawnProjectile = spawnProjectile;
  window.spawnVisualProjectile = spawnVisualProjectile;
  window.updateProjectiles = updateProjectiles;
  window.clearAllProjectiles = clearAllProjectiles;
})();
