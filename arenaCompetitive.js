/**
 * arenaCompetitive.js — Competitive paintball arena
 *
 * Builds the symmetric competitive arena used by AI single-player and LAN
 * multiplayer modes. Contains the cover layout (zones A-D), AI waypoint graph,
 * player/AI spawn positions with gold rings, and perimeter scenery trees.
 *
 * The arena is Z-symmetric: cover blocks are mirrored across Z=0 so neither
 * spawn side has a layout advantage. Spawns are at opposite ends of the Z axis.
 *
 * EXPORTS (bare global):
 *   buildPaintballArenaSymmetric() → { group, colliders, solids, waypoints, spawns: { A, B } }
 *
 * DEPENDENCIES: Three.js, game.js (scene global), physics.js (GROUND_Y),
 *   arenaBuilder.js (arenaAddSolidBox, arenaAddFloor, arenaAddPerimeterWalls, arenaAddTrees)
 */

function buildPaintballArenaSymmetric() {
  var group = new THREE.Group();
  group.name = 'PaintballArena';

  var solids = [];   // meshes that block LOS and bullets
  var colliders = []; // Box3 for movement collisions
  var waypoints = [];

  // Arena size (tighter: ~90m end-to-end along Z, 60m wide)
  var arenaHalfW = 30; // X extent 60
  var arenaHalfL = 45; // Z extent 90
  var wallHeight = 3.5;

  // Materials
  var wallMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });  // wood-brown walls
  var ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });

  // Muted cover palette (browns and grays)
  var coverPalette = [
    new THREE.MeshLambertMaterial({ color: 0x6B5B4F }), // warm brown
    new THREE.MeshLambertMaterial({ color: 0x5A5A5A }), // medium gray
    new THREE.MeshLambertMaterial({ color: 0x7A6A55 }), // tan brown
    new THREE.MeshLambertMaterial({ color: 0x4A4A4A }), // dark gray
    new THREE.MeshLambertMaterial({ color: 0x5C4A3A }), // dark brown
  ];
  var _coverIdx = 0;

  // Cover sits on the floor (y = GROUND_Y), cycles through palette colors
  function addCover(x, z, sx, sy, sz) {
    var y = GROUND_Y + sy / 2;
    var mat = coverPalette[_coverIdx++ % coverPalette.length];
    return arenaAddSolidBox(group, solids, colliders, x, y, z, sx, sy, sz, mat);
  }
  // Z-symmetric cover: places block at (x,z) and mirror at (x,-z)
  function mirroredCover(x, z, sx, sy, sz) {
    addCover(x, z, sx, sy, sz);
    if (Math.abs(z) > 0.5) addCover(x, -z, sx, sy, sz);
  }

  // Floor mesh for ground-height raycasting (surface at Y = GROUND_Y, not a collider)
  arenaAddFloor(group, solids, arenaHalfW, arenaHalfL);

  // Perimeter walls (short wooden fence panels)
  arenaAddPerimeterWalls(group, solids, colliders, arenaHalfW, arenaHalfL, wallHeight, wallMat);

  // ── ZONE A: CENTER CONTESTED AREA (|Z| < 7) ──
  // Split pillars + L-walls creating peek corners

  // Split pillars flanking dead center (gap at X=0)
  addCover(-3,    0,    2.5, 3.5, 2.0);
  addCover( 3,    0,    2.5, 3.5, 2.0);

  // Left L-wall
  addCover(-7,    0,    1.5, 3.0, 4.0);
  addCover(-5,    3,    3.0, 3.0, 1.5);

  // Right L-wall (X-mirrored, Z-flipped)
  addCover( 7,    0,    1.5, 3.0, 4.0);
  addCover( 5,   -3,    3.0, 3.0, 1.5);

  // Mid-width peek blocks
  mirroredCover(-14,   4,    2.0, 2.5, 2.0);
  mirroredCover( 14,   4,    2.0, 2.5, 2.0);

  // Edge lane cover
  mirroredCover(-26,   3,    2.5, 2.0, 2.0);
  mirroredCover( 26,   3,    2.5, 2.0, 2.0);

  // ── ZONE B: MID-FIELD (7 < |Z| <= 19) ──
  // Clusters of 2-3 blocks with gaps; corridors and rooms

  // B1: Near transition (Z ~ 9-13)
  mirroredCover(-10,  10,    4.0, 3.0, 2.0);
  mirroredCover(-13,  13,    2.0, 2.5, 1.5);
  mirroredCover( 10,   9,    2.5, 3.5, 2.5);
  mirroredCover( 14,   9,    1.5, 2.0, 1.5);
  mirroredCover(  0,  10,    3.0, 3.5, 1.5);
  mirroredCover(-27,  11,    2.5, 2.5, 3.0);
  mirroredCover( 27,  11,    2.5, 2.5, 3.0);

  // B2: Deep mid-field (Z ~ 15-19)
  mirroredCover( -9,  16,    5.0, 3.0, 1.5);
  mirroredCover(  6,  15,    2.5, 3.5, 1.5);
  mirroredCover( 10,  18,    2.0, 2.5, 1.5);
  mirroredCover(-24,  16,    3.0, 2.5, 2.0);
  mirroredCover(-21,  13,    1.5, 1.8, 1.5);   // low block
  mirroredCover( 24,  16,    3.0, 2.5, 2.0);
  mirroredCover( 21,  13,    1.5, 1.8, 1.5);   // low block

  // ── ZONE C: CORRIDOR ZONE (19 < |Z| <= 30) ──
  // Funneling lanes with staggered center and side walls

  mirroredCover( -4,  23,    2.5, 3.0, 2.0);
  mirroredCover(  4,  27,    2.5, 3.0, 2.0);
  mirroredCover(-18,  23,    3.5, 3.0, 1.5);
  mirroredCover( 18,  23,    3.5, 3.0, 1.5);
  mirroredCover(-15,  27,    3.0, 2.5, 2.0);
  mirroredCover( 15,  27,    3.0, 2.5, 2.0);
  mirroredCover(-28,  25,    2.0, 2.5, 2.5);
  mirroredCover( 28,  25,    2.0, 2.5, 2.5);
  mirroredCover(-12,  26,    1.5, 2.5, 1.5);
  mirroredCover( 12,  26,    1.5, 2.5, 1.5);

  // ── ZONE D: SPAWN APPROACH (30 < |Z| <= 40) ──
  // Heavy cover protecting spawn exits with multiple routes

  mirroredCover(  0,  33,    8.0, 3.5, 2.0);
  mirroredCover(-13,  34,    4.0, 3.0, 2.0);
  mirroredCover( 13,  34,    4.0, 3.0, 2.0);
  mirroredCover(-24,  36,    3.0, 2.5, 1.5);
  mirroredCover( 24,  36,    3.0, 2.5, 1.5);
  mirroredCover( -7,  37,    2.0, 2.0, 1.5);
  mirroredCover(  7,  37,    2.0, 2.0, 1.5);

  // Spawns opposite along Z axis
  var spawnZ = arenaHalfL - 8;
  var spawnA = new THREE.Vector3(0, 2, -spawnZ); // Player (camera/eye)
  var spawnB = new THREE.Vector3(0, 0,  spawnZ); // AI (grounded body)

  // Gold spawn rings on floor (use RingGeometry rotated flat)
  function addGoldSpawnRing(pos) {
    var ring = new THREE.RingGeometry(0.8, 1.2, 64);
    var ringMesh = new THREE.Mesh(ring, ringMat);
    ringMesh.position.set(pos.x, GROUND_Y + 0.01, pos.z);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.renderOrder = 1;
    group.add(ringMesh);
  }

  addGoldSpawnRing(spawnA);
  addGoldSpawnRing(spawnB);

  // Waypoints (5x5 grid scaled for smaller arena)
  for (var x of [-20, -10, 0, 10, 20]) {
    for (var z of [-35, -17, 0, 17, 35]) {
      waypoints.push(new THREE.Vector3(x, GROUND_Y, z));
    }
  }

  // ── SCENERY: Trees around the perimeter ──
  var trees = [
    // Along +X side
    [36, -30, 1.2], [39, -12, 0.9], [35, 5, 1.1], [40, 20, 1.0], [37, 35, 0.8],
    [42, -20, 0.7], [38, 40, 1.3],
    // Along -X side
    [-36, -25, 1.0], [-40, -5, 1.3], [-35, 15, 0.9], [-38, 30, 1.1], [-37, -40, 0.8],
    [-42, 10, 0.7], [-36, 42, 1.2],
    // Along +Z side
    [-20, 50, 1.1], [-5, 52, 0.9], [10, 50, 1.2], [25, 52, 1.0], [0, 55, 0.8],
    // Along -Z side
    [-15, -50, 1.0], [0, -52, 1.2], [20, -50, 0.8], [-25, -52, 1.1], [8, -55, 0.9],
    // Corners and scattered further out
    [45, 45, 1.4], [-45, 45, 1.3], [45, -45, 1.0], [-45, -45, 1.1],
    [50, 0, 1.4], [-50, 10, 1.3],
  ];
  arenaAddTrees(group, trees);

  // Attach to scene
  scene.add(group);

  return {
    group: group,
    colliders: colliders,
    solids: solids,
    waypoints: waypoints,
    spawns: { A: spawnA, B: spawnB }
  };
}
