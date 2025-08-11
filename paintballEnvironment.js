// Build a symmetric paintball arena with mirrored cover and two opposite spawns.
// Returns an object: { group, colliders, solids, waypoints, spawns: { A, B } }
function buildPaintballArenaSymmetric() {
  const group = new THREE.Group();
  group.name = 'PaintballArena';

  const solids = [];   // meshes that block LOS and bullets
  const colliders = []; // Box3 for movement collisions
  const waypoints = [];

  // Arena size (bigger: ~130m end-to-end along Z to match ~20s sprint)
  const arenaHalfW = 45; // X extent 90
  const arenaHalfL = 65; // Z extent 130
  const wallHeight = 6;

  // Materials
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const coverMat = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });

  // Helpers
  function addSolidBox(x, y, z, sx, sy, sz, mat) {
    const geom = new THREE.BoxGeometry(sx, sy, sz);
    const mesh = new THREE.Mesh(geom, mat || coverMat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    solids.push(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    colliders.push(box);
    return mesh;
  }
  // Cover sits on the floor (y = -1)
  function addCover(x, z, sx, sy, sz) {
    const y = -1 + sy / 2;
    return addSolidBox(x, y, z, sx, sy, sz, coverMat);
  }

  // Perimeter walls (thin boxes)
  // Front/back (along X)
  addSolidBox(0, wallHeight / 2 - 1, -arenaHalfL, arenaHalfW * 2, wallHeight, 0.5, wallMat);
  addSolidBox(0, wallHeight / 2 - 1,  arenaHalfL, arenaHalfW * 2, wallHeight, 0.5, wallMat);
  // Left/right (along Z)
  addSolidBox(-arenaHalfW, wallHeight / 2 - 1, 0, 0.5, wallHeight, arenaHalfL * 2, wallMat);
  addSolidBox( arenaHalfW, wallHeight / 2 - 1, 0, 0.5, wallHeight, arenaHalfL * 2, wallMat);

  // Visual white walls + ceiling with gray grid
  (function addWhiteBox() {
    // Build a grid texture on white background
    function buildGridTexture(size = 512, step = 32, bg = '#ffffff', line = '#d0d0d0') {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let i = 0; i <= size; i += step) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // Repeat roughly one grid every 10m
      tex.repeat.set((arenaHalfW * 2) / 10, (arenaHalfL * 2) / 10);
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      return tex;
    }

    const gridTex = buildGridTexture(512, 32);
    const gridMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: gridTex, side: THREE.DoubleSide });

    const wallY = 4;        // center Y for 8m height walls (from floor y=-1 to y=7)
    const wallH = 8;        // height of wall planes
    const ceilY = 8;        // ceiling height above floor(-1)

    // Front wall (+Z)
    const front = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalfW * 2, wallH), gridMat);
    front.position.set(0, wallY - 1, arenaHalfL);
    front.lookAt(new THREE.Vector3(0, wallY - 1, 0));
    group.add(front); solids.push(front);

    // Back wall (-Z)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalfW * 2, wallH), gridMat);
    back.position.set(0, wallY - 1, -arenaHalfL);
    back.lookAt(new THREE.Vector3(0, wallY - 1, 0));
    group.add(back); solids.push(back);

    // Right wall (+X)
    const rightW = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalfL * 2, wallH), gridMat);
    rightW.position.set(arenaHalfW, wallY - 1, 0);
    rightW.lookAt(new THREE.Vector3(0, wallY - 1, 0));
    group.add(rightW); solids.push(rightW);

    // Left wall (-X)
    const leftW = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalfL * 2, wallH), gridMat);
    leftW.position.set(-arenaHalfW, wallY - 1, 0);
    leftW.lookAt(new THREE.Vector3(0, wallY - 1, 0));
    group.add(leftW); solids.push(leftW);

    // Ceiling
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(arenaHalfW * 2, arenaHalfL * 2), gridMat);
    ceil.position.set(0, ceilY - 1, 0);
    // Face downward toward the arena center
    ceil.lookAt(new THREE.Vector3(0, -100, 0));
    group.add(ceil); solids.push(ceil);
  })();

  // Symmetric, taller, denser cover layout:
  // Central lanes and side lanes every 10m along Z, with varied widths/heights (2.0–3.5 m tall).
  const zStep = 10;
  for (let z = -arenaHalfL + 10; z <= arenaHalfL - 10; z += zStep) {
    // Central block
    addCover(0, z, 6, 3.0, 2.0);

    // Staggered wider blocks left/right
    const offsetX = 14 + (Math.abs(z / zStep) % 2) * 6; // alternate offsets 14/20
    addCover(offsetX, z, 5, 3.5, 2.0);
    addCover(-offsetX, z, 5, 3.5, 2.0);

    // Narrow pillars further out
    addCover(offsetX + 12, z, 2.5, 3.0, 2.0);
    addCover(-(offsetX + 12), z, 2.5, 3.0, 2.0);
  }

  // Larger cover near spawns to break spawn LOS
  addCover(0, -arenaHalfL + 18, 10, 3.5, 2.5);
  addCover(0,  arenaHalfL - 18, 10, 3.5, 2.5);
  addCover(20, -arenaHalfL + 14, 6, 3.0, 2.0);
  addCover(-20, -arenaHalfL + 14, 6, 3.0, 2.0);
  addCover(20,  arenaHalfL - 14, 6, 3.0, 2.0);
  addCover(-20,  arenaHalfL - 14, 6, 3.0, 2.0);

  // Spawns opposite along Z axis
  const spawnZ = arenaHalfL - 12;
  const spawnA = new THREE.Vector3(0, 2, -spawnZ); // Player (camera/eye)
  const spawnB = new THREE.Vector3(0, 0,  spawnZ); // AI (grounded body)

  // Gold spawn rings on floor (use RingGeometry rotated flat)
  function addGoldSpawnRing(pos) {
    const ring = new THREE.RingGeometry(0.8, 1.2, 64);
    const ringMesh = new THREE.Mesh(ring, ringMat);
    ringMesh.position.set(pos.x, -0.99, pos.z);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.renderOrder = 1;
    group.add(ringMesh);
  }

  addGoldSpawnRing(spawnA);
  addGoldSpawnRing(spawnB);

  // Waypoints (grid across the arena for simple navigation)
  for (let x of [-30, -15, 0, 15, 30]) {
    for (let z of [-50, -25, 0, 25, 50]) {
      waypoints.push(new THREE.Vector3(x, 0, z));
    }
  }

  // Attach to scene
  scene.add(group);

  return {
    group,
    colliders,
    solids,
    waypoints,
    spawns: { A: spawnA, B: spawnB }
  };
}
