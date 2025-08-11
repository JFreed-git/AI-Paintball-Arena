// Projectiles and hitscan utilities for Paintball mode (fast, no drop)

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

  // Quick LOS test for player hit: distance from ray to point <= radius
  function rayHitsSphere(origin, dir, center, radius, maxDist) {
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
          try { geom.dispose(); mat.dispose(); } catch {}
        }
      }
      requestAnimationFrame(step);
    } catch {}
  }

  // Fire a single hitscan shot.
  // options:
  //  - spreadRad: radians of inaccuracy cone
  //  - solids: array<Object3D> to raycast against for blocking world
  //  - aiTarget: { mesh: Object3D } target AI (optional)
  //  - playerTarget: { position: Vector3, radius: number } player capsule approx (optional)
  //  - maxDistance: number
  //  - tracerColor: hex
  function fireHitscan(origin, baseDir, options = {}) {
    const spreadRad = options.spreadRad || 0;
    const solids = Array.isArray(options.solids) ? options.solids : [];
    const aiTarget = options.aiTarget || null;
    const playerTarget = options.playerTarget || null;
    const maxDist = options.maxDistance || DEFAULT_MAX_DIST;
    const tracerColor = options.tracerColor || 0xffee66;

    const dir = applySpread(baseDir, spreadRad);
    const raycaster = new THREE.Raycaster(origin, dir, 0, maxDist);

    // Build raycast set: solids + (optionally) AI mesh
    const raycastObjects = solids.slice();
    if (aiTarget && aiTarget.mesh) {
      raycastObjects.push(aiTarget.mesh);
    }

    let hitInfo = { hit: false, hitType: null, object: null, point: origin.clone().add(dir.clone().multiplyScalar(maxDist)), distance: maxDist };

    // Raycast against world and AI
    let intersects = [];
    try {
      intersects = raycaster.intersectObjects(raycastObjects, true);
    } catch {
      intersects = [];
    }

    // Determine nearest hit among world/AI
    if (intersects.length > 0) {
      const first = intersects[0];
      hitInfo.hit = true;
      hitInfo.point = first.point.clone();
      hitInfo.distance = first.distance;
      hitInfo.object = first.object;
      // Classify
      if (aiTarget && aiTarget.mesh && (first.object === aiTarget.mesh || aiTarget.mesh.children.includes(first.object))) {
        hitInfo.hitType = 'ai';
      } else {
        hitInfo.hitType = 'world';
      }
    }

    // Check player hit if requested and not already blocked before reaching player
    if (playerTarget && playerTarget.position && playerTarget.radius != null) {
      const playerHit = rayHitsSphere(origin, dir, playerTarget.position, playerTarget.radius, maxDist);
      if (playerHit) {
        // Also ensure no world blocker before the player
        let blocked = false;
        if (solids.length > 0) {
          const distToPlayer = playerTarget.position.clone().sub(origin).dot(dir);
          const rc = new THREE.Raycaster(origin, dir, 0, Math.max(0.001, distToPlayer));
          const worldHits = rc.intersectObjects(solids, true);
          blocked = worldHits && worldHits.length > 0;
        }
        if (!blocked) {
          // Compute where the ray gets closest to the player's center to draw tracer end
          const t = playerTarget.position.clone().sub(origin).dot(dir);
          const pointOnRay = origin.clone().add(dir.clone().multiplyScalar(Math.min(t, maxDist)));
          // If previous world/AI hit was further than player, override to player
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

  // Expose
  window.spawnTracer = spawnTracer;
  window.fireHitscan = fireHitscan;
})();
