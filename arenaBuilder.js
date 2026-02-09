/**
 * arenaBuilder.js — Shared arena construction helpers
 *
 * PURPOSE: Common building blocks used by arena builders (arenaCompetitive.js,
 * arenaTraining.js). Eliminates duplication of floor, wall, tree, and
 * solid-box creation that was previously copied in each arena file.
 *
 * EXPORTS (window):
 *   arenaAddSolidBox(group, solids, colliders, x, y, z, sx, sy, sz, mat)
 *   arenaAddFloor(group, solids, halfW, halfL)
 *   arenaAddPerimeterWalls(group, solids, colliders, halfW, halfL, wallHeight, wallMat)
 *   arenaAddTrees(group, treeCoords)
 *   ARENA_TREE_MATERIALS — { trunk, canopy, canopyDark }
 *
 * DEPENDENCIES: Three.js (THREE global), physics.js (GROUND_Y)
 *
 * DESIGN NOTES:
 *   - All Y positions use GROUND_Y from physics.js for consistency.
 *   - Arena-specific content (cover layouts, waypoints, lane dividers) stays in the
 *     individual arena files. Only truly shared geometry helpers live here.
 *   - addSolidBox pushes to both solids[] (for raycasting) and colliders[] (for
 *     movement collision). This is the standard pattern for all solid geometry.
 *
 * TODO (future):
 *   - Ramp/staircase helper (used by map editor, could be shared)
 *   - Prop placement helpers (barrels, crates, etc.)
 *   - Arena boundary visualization (for debugging)
 */

(function () {

  // --- Shared Tree Materials ---
  var ARENA_TREE_MATERIALS = {
    trunk:      new THREE.MeshLambertMaterial({ color: 0x5C4033 }),
    canopy:     new THREE.MeshLambertMaterial({ color: 0x2E5930 }),
    canopyDark: new THREE.MeshLambertMaterial({ color: 0x1E3E22 })
  };

  /**
   * Add a solid box to the arena. Pushes to both solids and colliders arrays.
   * Returns the created mesh.
   */
  function arenaAddSolidBox(group, solids, colliders, x, y, z, sx, sy, sz, mat) {
    var geom = new THREE.BoxGeometry(sx, sy, sz);
    var mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    solids.push(mesh);
    var box = new THREE.Box3().setFromObject(mesh);
    colliders.push(box);
    return mesh;
  }

  /**
   * Add an invisible floor plane for ground-height raycasting.
   * The floor is NOT added to colliders (movement doesn't collide with it).
   */
  function arenaAddFloor(group, solids, halfW, halfL) {
    var geom = new THREE.PlaneGeometry(halfW * 2 + 10, halfL * 2 + 10);
    var mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = GROUND_Y;
    group.add(mesh);
    solids.push(mesh);
    return mesh;
  }

  /**
   * Add 4 perimeter walls around the arena.
   */
  function arenaAddPerimeterWalls(group, solids, colliders, halfW, halfL, wallHeight, wallMat) {
    var wallY = wallHeight / 2 + GROUND_Y;
    // Front/back (along X axis)
    arenaAddSolidBox(group, solids, colliders, 0, wallY, -halfL, halfW * 2, wallHeight, 0.5, wallMat);
    arenaAddSolidBox(group, solids, colliders, 0, wallY,  halfL, halfW * 2, wallHeight, 0.5, wallMat);
    // Left/right (along Z axis)
    arenaAddSolidBox(group, solids, colliders, -halfW, wallY, 0, 0.5, wallHeight, halfL * 2, wallMat);
    arenaAddSolidBox(group, solids, colliders,  halfW, wallY, 0, 0.5, wallHeight, halfL * 2, wallMat);
  }

  /**
   * Add trees to the arena.
   * treeCoords: Array of [x, z, scale] tuples.
   */
  function arenaAddTrees(group, treeCoords) {
    var trunkMat = ARENA_TREE_MATERIALS.trunk;
    var canopyMat = ARENA_TREE_MATERIALS.canopy;
    var canopyDarkMat = ARENA_TREE_MATERIALS.canopyDark;

    for (var i = 0; i < treeCoords.length; i++) {
      var t = treeCoords[i];
      var x = t[0], z = t[1], scale = t[2] || 1;

      var trunkH = 3 * scale;
      var trunkR = 0.3 * scale;
      var canopyH = 4 * scale;
      var canopyR = 2 * scale;
      var mat = (scale > 1.1) ? canopyDarkMat : canopyMat;

      var trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 8),
        trunkMat
      );
      trunk.position.set(x, GROUND_Y + trunkH / 2, z);
      group.add(trunk);

      var canopy = new THREE.Mesh(
        new THREE.ConeGeometry(canopyR, canopyH, 8),
        mat
      );
      canopy.position.set(x, GROUND_Y + trunkH + canopyH / 2, z);
      group.add(canopy);
    }
  }

  // --- Expose ---
  window.arenaAddSolidBox = arenaAddSolidBox;
  window.arenaAddFloor = arenaAddFloor;
  window.arenaAddPerimeterWalls = arenaAddPerimeterWalls;
  window.arenaAddTrees = arenaAddTrees;
  window.ARENA_TREE_MATERIALS = ARENA_TREE_MATERIALS;

})();
