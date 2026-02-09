/**
 * arenaTraining.js — Training Range arena
 *
 * Builds the training range arena: 3 shooting lanes with static targets at
 * 15/25/35m distances, an open field with scattered cover and patrol bot
 * routes, and perimeter scenery trees. Used by the Training Range mode for
 * free-practice target shooting and bot tracking.
 *
 * EXPORTS (window):
 *   buildTrainingRangeArena() → { group, colliders, solids, spawns, targetPositions, botPatrolPaths }
 *
 * DEPENDENCIES: Three.js, game.js (scene global), physics.js (GROUND_Y, EYE_HEIGHT),
 *   arenaBuilder.js (arenaAddSolidBox, arenaAddFloor, arenaAddPerimeterWalls, arenaAddTrees)
 */

(function () {

  function buildTrainingRangeArena() {
    var group = new THREE.Group();
    group.name = 'TrainingRangeArena';

    var solids = [];
    var colliders = [];

    var arenaHalfW = 40; // 80m wide
    var arenaHalfL = 50; // 100m long
    var wallHeight = 3.5;

    var wallMat = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
    var coverPalette = [
      new THREE.MeshLambertMaterial({ color: 0x6B5B4F }),
      new THREE.MeshLambertMaterial({ color: 0x5A5A5A }),
      new THREE.MeshLambertMaterial({ color: 0x7A6A55 }),
      new THREE.MeshLambertMaterial({ color: 0x4A4A4A }),
    ];
    var _coverIdx = 0;

    function addCover(x, z, sx, sy, sz) {
      var y = GROUND_Y + sy / 2;
      var mat = coverPalette[_coverIdx++ % coverPalette.length];
      return arenaAddSolidBox(group, solids, colliders, x, y, z, sx, sy, sz, mat);
    }

    // Floor
    arenaAddFloor(group, solids, arenaHalfW, arenaHalfL);

    // Perimeter walls
    arenaAddPerimeterWalls(group, solids, colliders, arenaHalfW, arenaHalfL, wallHeight, wallMat);

    // ── SHOOTING LANES (Z < -10) ──
    // 3 lanes separated by waist-high walls, targets at far ends
    var laneDividerMat = new THREE.MeshLambertMaterial({ color: 0x5A5A5A });

    // Lane dividers (waist-high walls along Z, from Z=-10 to Z=-48)
    arenaAddSolidBox(group, solids, colliders, -13, GROUND_Y + 0.75, -29, 0.5, 1.5, 38, laneDividerMat);
    arenaAddSolidBox(group, solids, colliders, 13, GROUND_Y + 0.75, -29, 0.5, 1.5, 38, laneDividerMat);

    // Back wall behind lanes already covered by perimeter wall at Z=-50

    // Static target positions (at end of each lane at different distances)
    var targetPositions = [
      // Left lane (X ~ -26)
      new THREE.Vector3(-26, GROUND_Y, -25),  // 15m
      new THREE.Vector3(-26, GROUND_Y, -35),  // 25m
      new THREE.Vector3(-26, GROUND_Y, -45),  // 35m
      // Center lane (X ~ 0)
      new THREE.Vector3(0, GROUND_Y, -25),
      new THREE.Vector3(0, GROUND_Y, -35),
      new THREE.Vector3(0, GROUND_Y, -45),
      // Right lane (X ~ 26)
      new THREE.Vector3(26, GROUND_Y, -25),
      new THREE.Vector3(26, GROUND_Y, -35),
      new THREE.Vector3(26, GROUND_Y, -45),
    ];

    // ── OPEN FIELD (Z > 5) ──
    // Scattered cover blocks
    addCover(-15, 15, 3.0, 2.5, 2.0);
    addCover(10, 12, 2.5, 3.0, 2.5);
    addCover(25, 20, 3.5, 2.0, 2.0);
    addCover(-25, 25, 2.0, 2.5, 3.0);
    addCover(0, 22, 4.0, 3.0, 1.5);
    addCover(15, 30, 2.5, 2.5, 2.0);
    addCover(-10, 35, 3.0, 3.0, 2.0);
    addCover(20, 38, 2.0, 2.0, 2.5);
    addCover(-20, 42, 3.5, 2.5, 2.0);
    addCover(5, 40, 2.5, 3.0, 1.5);

    // Bot patrol paths (arrays of Vector3 waypoints)
    var botPatrolPaths = [
      // Path 1: horizontal sweep across the field
      [
        new THREE.Vector3(-30, GROUND_Y + EYE_HEIGHT, 15),
        new THREE.Vector3(30, GROUND_Y + EYE_HEIGHT, 15),
      ],
      // Path 2: diagonal route
      [
        new THREE.Vector3(-25, GROUND_Y + EYE_HEIGHT, 10),
        new THREE.Vector3(25, GROUND_Y + EYE_HEIGHT, 35),
      ],
      // Path 3: vertical patrol
      [
        new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 10),
        new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, 45),
      ],
    ];

    // Player spawn
    var playerSpawn = new THREE.Vector3(0, GROUND_Y + EYE_HEIGHT, -5);

    // Scenery trees outside
    var trees = [
      [46, -30, 1.2], [48, 10, 1.0], [45, 40, 1.1],
      [-46, -20, 1.0], [-48, 15, 1.3], [-45, 45, 0.9],
      [-20, 56, 1.1], [10, 55, 1.0], [30, 56, 0.8],
      [-15, -56, 1.0], [15, -55, 1.2], [0, -58, 0.9],
    ];
    arenaAddTrees(group, trees);

    scene.add(group);

    return {
      group: group,
      colliders: colliders,
      solids: solids,
      spawns: { A: playerSpawn },
      targetPositions: targetPositions,
      botPatrolPaths: botPatrolPaths
    };
  }

  window.buildTrainingRangeArena = buildTrainingRangeArena;

})();
