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
 *   rayHitsSphereDetailed(...)        — sphere intersection returning {hit, distance, point}
 *   rayHitsCylinder(...)              — Y-axis cylinder intersection
 *   rayHitsCapsule(...)               — Y-axis capsule intersection (cylinder + hemispheres)
 *   rayHitsAABB(origin, dir, boxMin, boxMax, maxDist) — ray-AABB slab intersection
 *   testHitSegments(origin, dir, segments, maxDist)   — test ray against hitbox segments (dispatches by shape)
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
 *   - Targets can have `segments` (array of shape-typed hitboxes: box→{box},
 *     sphere→{center,radius}, cylinder/capsule→{center,radius,halfHeight})
 *     or `position`+`radius` for legacy sphere hitboxes.
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

  // Ray-sphere intersection returning {hit, distance, point}
  function rayHitsSphereDetailed(origin, dir, center, radius, maxDist) {
    var ocx = origin.x - center.x;
    var ocy = origin.y - center.y;
    var ocz = origin.z - center.z;
    var b = ocx * dir.x + ocy * dir.y + ocz * dir.z;
    var c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
    var disc = b * b - c;
    if (disc < 0) return { hit: false };
    var sqrtDisc = Math.sqrt(disc);
    var t0 = -b - sqrtDisc;
    var t1 = -b + sqrtDisc;
    var t = (t0 >= 0) ? t0 : t1;
    if (t < 0 || t > maxDist) return { hit: false };
    var point = origin.clone().add(dir.clone().multiplyScalar(t));
    return { hit: true, distance: t, point: point };
  }

  // Ray-cylinder intersection (Y-axis aligned, finite height with caps)
  // center = center of the cylinder, radius, halfHeight
  function rayHitsCylinder(origin, dir, center, radius, halfHeight, maxDist) {
    var ox = origin.x - center.x;
    var oz = origin.z - center.z;
    var dx = dir.x;
    var dz = dir.z;
    var dy = dir.y;
    var oy = origin.y - center.y;

    var bestT = maxDist + 1;
    var bestPoint = null;

    // Infinite cylinder test in XZ
    var a = dx * dx + dz * dz;
    if (a > 1e-12) {
      var b = 2 * (ox * dx + oz * dz);
      var c = ox * ox + oz * oz - radius * radius;
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sqrtDisc = Math.sqrt(disc);
        var inv2a = 1 / (2 * a);
        var t0 = (-b - sqrtDisc) * inv2a;
        var t1 = (-b + sqrtDisc) * inv2a;
        for (var ti = 0; ti < 2; ti++) {
          var t = ti === 0 ? t0 : t1;
          if (t < 0 || t > maxDist) continue;
          var hitY = oy + dy * t;
          if (hitY >= -halfHeight && hitY <= halfHeight && t < bestT) {
            bestT = t;
            bestPoint = origin.clone().add(dir.clone().multiplyScalar(t));
          }
        }
      }
    }

    // Cap disc tests (top and bottom)
    if (Math.abs(dy) > 1e-8) {
      for (var ci = 0; ci < 2; ci++) {
        var capY = ci === 0 ? halfHeight : -halfHeight;
        var tCap = (capY - oy) / dy;
        if (tCap < 0 || tCap > maxDist || tCap >= bestT) continue;
        var hx = ox + dx * tCap;
        var hz = oz + dz * tCap;
        if (hx * hx + hz * hz <= radius * radius) {
          bestT = tCap;
          bestPoint = origin.clone().add(dir.clone().multiplyScalar(tCap));
        }
      }
    }

    if (bestPoint && bestT <= maxDist) {
      return { hit: true, distance: bestT, point: bestPoint };
    }
    return { hit: false };
  }

  // Ray-capsule intersection (Y-axis aligned)
  // Capsule = cylinder body + 2 hemisphere caps
  // halfHeight = half of total capsule height (including caps)
  function rayHitsCapsule(origin, dir, center, radius, halfHeight, maxDist) {
    var bodyHalfH = Math.max(0, halfHeight - radius);

    // If degenerate (body height <= 0), it's just a sphere
    if (bodyHalfH <= 0) {
      return rayHitsSphereDetailed(origin, dir, center, radius, maxDist);
    }

    var bestT = maxDist + 1;
    var bestPoint = null;

    // Test cylinder body (no caps — capped by hemisphere tests)
    var ox = origin.x - center.x;
    var oz = origin.z - center.z;
    var dx = dir.x;
    var dz = dir.z;
    var dy = dir.y;
    var oy = origin.y - center.y;

    var a = dx * dx + dz * dz;
    if (a > 1e-12) {
      var b = 2 * (ox * dx + oz * dz);
      var c = ox * ox + oz * oz - radius * radius;
      var disc = b * b - 4 * a * c;
      if (disc >= 0) {
        var sqrtDisc = Math.sqrt(disc);
        var inv2a = 1 / (2 * a);
        var t0 = (-b - sqrtDisc) * inv2a;
        var t1 = (-b + sqrtDisc) * inv2a;
        for (var ti = 0; ti < 2; ti++) {
          var t = ti === 0 ? t0 : t1;
          if (t < 0 || t > maxDist) continue;
          var hitY = oy + dy * t;
          if (hitY >= -bodyHalfH && hitY <= bodyHalfH && t < bestT) {
            bestT = t;
            bestPoint = origin.clone().add(dir.clone().multiplyScalar(t));
          }
        }
      }
    }

    // Test top hemisphere (center at cy + bodyHalfH)
    var topCenter = new THREE.Vector3(center.x, center.y + bodyHalfH, center.z);
    var topResult = rayHitsSphereDetailed(origin, dir, topCenter, radius, maxDist);
    if (topResult.hit && topResult.distance < bestT) {
      // Only accept hits on the upper hemisphere (hit.y >= topCenter.y)
      if (topResult.point.y >= topCenter.y - 0.001) {
        bestT = topResult.distance;
        bestPoint = topResult.point;
      }
    }

    // Test bottom hemisphere (center at cy - bodyHalfH)
    var botCenter = new THREE.Vector3(center.x, center.y - bodyHalfH, center.z);
    var botResult = rayHitsSphereDetailed(origin, dir, botCenter, radius, maxDist);
    if (botResult.hit && botResult.distance < bestT) {
      if (botResult.point.y <= botCenter.y + 0.001) {
        bestT = botResult.distance;
        bestPoint = botResult.point;
      }
    }

    if (bestPoint && bestT <= maxDist) {
      return { hit: true, distance: bestT, point: bestPoint };
    }
    return { hit: false };
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

  // Ray-OBB intersection (Y-axis rotation only)
  // Transforms ray into box-local space, then uses slab method
  function rayHitsOBB(origin, dir, center, halfW, halfH, halfD, yaw, maxDist) {
    var cosY = Math.cos(yaw);
    var sinY = Math.sin(yaw);

    // Translate ray origin relative to box center, then rotate by -yaw into local space
    var relX = origin.x - center.x;
    var relY = origin.y - center.y;
    var relZ = origin.z - center.z;
    var localOX = cosY * relX - sinY * relZ;
    var localOY = relY;
    var localOZ = sinY * relX + cosY * relZ;

    var localDX = cosY * dir.x - sinY * dir.z;
    var localDY = dir.y;
    var localDZ = sinY * dir.x + cosY * dir.z;

    // Standard slab test against centered AABB [-halfW..halfW, -halfH..halfH, -halfD..halfD]
    var tmin = 0;
    var tmax = maxDist;

    // X axis
    if (Math.abs(localDX) < 1e-8) {
      if (localOX < -halfW || localOX > halfW) return { hit: false };
    } else {
      var t1x = (-halfW - localOX) / localDX;
      var t2x = (halfW - localOX) / localDX;
      if (t1x > t2x) { var tmp = t1x; t1x = t2x; t2x = tmp; }
      tmin = Math.max(tmin, t1x);
      tmax = Math.min(tmax, t2x);
      if (tmin > tmax) return { hit: false };
    }

    // Y axis
    if (Math.abs(localDY) < 1e-8) {
      if (localOY < -halfH || localOY > halfH) return { hit: false };
    } else {
      var t1y = (-halfH - localOY) / localDY;
      var t2y = (halfH - localOY) / localDY;
      if (t1y > t2y) { var tmp2 = t1y; t1y = t2y; t2y = tmp2; }
      tmin = Math.max(tmin, t1y);
      tmax = Math.min(tmax, t2y);
      if (tmin > tmax) return { hit: false };
    }

    // Z axis
    if (Math.abs(localDZ) < 1e-8) {
      if (localOZ < -halfD || localOZ > halfD) return { hit: false };
    } else {
      var t1z = (-halfD - localOZ) / localDZ;
      var t2z = (halfD - localOZ) / localDZ;
      if (t1z > t2z) { var tmp3 = t1z; t1z = t2z; t2z = tmp3; }
      tmin = Math.max(tmin, t1z);
      tmax = Math.min(tmax, t2z);
      if (tmin > tmax) return { hit: false };
    }

    if (tmin > maxDist) return { hit: false };
    // Hit point in world space (parameter t is preserved across rotation)
    var point = origin.clone().add(dir.clone().multiplyScalar(tmin));
    return { hit: true, distance: tmin, point: point };
  }

  // Test ray against an array of hitbox segments, return closest hit
  // Segments can be: {shape:'box', center, halfW, halfH, halfD, yaw}, {shape:'sphere', center, radius},
  //   {shape:'cylinder', center, radius, halfHeight}, {shape:'capsule', center, radius, halfHeight}
  // Default shape (absent or 'box') uses OBB path (supports Y-rotation).
  // Returns {hit: true, segment, distance, point, damageMultiplier} or {hit: false}
  function testHitSegments(origin, dir, segments, maxDist) {
    var closestDist = maxDist;
    var closestResult = { hit: false };

    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      var result;
      var shape = seg.shape || 'box';

      if (shape === 'sphere') {
        result = rayHitsSphereDetailed(origin, dir, seg.center, seg.radius, closestDist);
      } else if (shape === 'cylinder') {
        result = rayHitsCylinder(origin, dir, seg.center, seg.radius, seg.halfHeight, closestDist);
      } else if (shape === 'capsule') {
        result = rayHitsCapsule(origin, dir, seg.center, seg.radius, seg.halfHeight, closestDist);
      } else {
        // 'box' or absent — OBB path (supports Y-rotation)
        result = rayHitsOBB(origin, dir, seg.center, seg.halfW, seg.halfH, seg.halfD, seg.yaw || 0, closestDist);
      }

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

      // Fire sound
      if (typeof playGameSound === 'function') playGameSound('weapon_fire', { weaponModelType: weapon.modelType });

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

    // Fire sound
    if (typeof playGameSound === 'function') playGameSound('weapon_fire', { weaponModelType: weapon.modelType });

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
    // Guard: clearAllProjectiles() may have been called during onHit (e.g. endRound),
    // which empties _liveProjectiles mid-iteration. Skip already-removed entries.
    // Deduplicate toRemove to prevent double-removal shifting wrong indices.
    var seen = {};
    for (var r = toRemove.length - 1; r >= 0; r--) {
      var idx = toRemove[r];
      if (seen[idx] || idx >= _liveProjectiles.length) continue;
      seen[idx] = true;
      var dead = _liveProjectiles[idx];
      if (!dead) continue;
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

  // --- Melee Attack ---
  // Instant forward raycast for melee hit detection.
  // opts: { targets, solids, onHit }
  // Returns { hit, target, point, damageMultiplier }
  function sharedMeleeAttack(weapon, origin, dir, opts) {
    opts = opts || {};
    var maxDist = weapon.meleeRange || 2.5;
    var solids = Array.isArray(opts.solids) ? opts.solids : [];
    var targets = Array.isArray(opts.targets) ? opts.targets : [];
    var onHit = opts.onHit || null;
    var baseDamage = weapon.meleeDamage || 30;
    var useMultiplier = (weapon.meleeUseHitMultiplier !== undefined) ? weapon.meleeUseHitMultiplier : true;

    // Check wall block first — is there geometry closer than meleeRange?
    var wallDist = maxDist;
    try {
      var raycaster = new THREE.Raycaster(origin, dir, 0, maxDist);
      var worldHits = raycaster.intersectObjects(solids, true);
      if (worldHits.length > 0) wallDist = worldHits[0].distance;
    } catch (e) {}

    // Test targets for closest hit before wall
    var closestDist = wallDist;
    var closestTarget = null;
    var closestPoint = null;
    var closestMultiplier = 1.0;

    for (var t = 0; t < targets.length; t++) {
      var tgt = targets[t];
      if (!tgt) continue;
      if (tgt.segments && tgt.segments.length > 0) {
        var segResult = testHitSegments(origin, dir, tgt.segments, closestDist);
        if (segResult.hit && segResult.distance < closestDist) {
          closestDist = segResult.distance;
          closestTarget = tgt;
          closestPoint = segResult.point;
          closestMultiplier = segResult.damageMultiplier;
        }
      } else if (tgt.position) {
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

    var dmgMult = useMultiplier ? closestMultiplier : 1.0;
    var totalDamage = baseDamage * dmgMult;

    if (closestTarget && onHit) {
      onHit(closestTarget, closestPoint, closestDist, totalDamage, dmgMult);
    }

    // Melee hit sound
    if (closestTarget && typeof playGameSound === 'function') playGameSound('melee_hit');

    weapon.lastMeleeTime = performance.now();

    return {
      hit: !!closestTarget,
      target: closestTarget,
      point: closestPoint,
      damage: totalDamage,
      damageMultiplier: dmgMult
    };
  }

  // Expose
  window.applySpread = applySpread;
  window.rayHitsSphere = rayHitsSphere;
  window.rayHitsSphereDetailed = rayHitsSphereDetailed;
  window.rayHitsCylinder = rayHitsCylinder;
  window.rayHitsCapsule = rayHitsCapsule;
  window.rayHitsAABB = rayHitsAABB;
  window.testHitSegments = testHitSegments;
  window.spawnTracer = spawnTracer;
  window.fireHitscan = fireHitscan;
  window.sharedFireWeapon = sharedFireWeapon;
  window.spawnProjectile = spawnProjectile;
  window.spawnVisualProjectile = spawnVisualProjectile;
  window.updateProjectiles = updateProjectiles;
  window.clearAllProjectiles = clearAllProjectiles;
  window.sharedMeleeAttack = sharedMeleeAttack;
})();
