 // Wall mode helpers

const WALL_DISTANCE = 20;
const WALL_WIDTH = 24;
const WALL_HEIGHT = 10;

function prepareWall() {
  const worldUp = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.normalize();

  let right = new THREE.Vector3().crossVectors(forward, worldUp);
  if (right.lengthSq() < 1e-6) {
    // Fallback if looking straight up/down
    right = new THREE.Vector3(1, 0, 0);
  } else {
    right.normalize();
  }
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const wallDistance = WALL_DISTANCE;
  const wallWidth = WALL_WIDTH;
  const wallHeight = WALL_HEIGHT;

  const center = camera.position.clone().add(forward.clone().multiplyScalar(wallDistance));

  // Visual wall panel (lighter gray than floor)
  const wallGeom = new THREE.PlaneGeometry(wallWidth, wallHeight);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x666666, side: THREE.DoubleSide });
  const wallMesh = new THREE.Mesh(wallGeom, wallMat);
  wallMesh.position.copy(center);
  // Make plane face the camera (plane front +Z should face toward camera => align +Z with -forward)
  wallMesh.lookAt(center.clone().sub(forward));
  // Ensure consistent world-scale
  wallMesh.scale.set(1, 1, 1);
  scene.add(wallMesh);

  const normal = forward.clone().negate();

  wallConfig = {
    center,
    right,
    up,
    width: wallWidth,
    height: wallHeight,
    distance: wallDistance,
    mesh: wallMesh,
    normal
  };
}

function clearWall() {
  if (wallConfig && wallConfig.mesh) {
    scene.remove(wallConfig.mesh);
    wallConfig.mesh.geometry.dispose();
    wallConfig.mesh.material.dispose();
  }
  wallConfig = null;
}

// Returns a random position on the prepared wall surface, using the same constraints
// as the original game logic (Y clamped between -0.4 and 3.0 world height).
function getWallSpawnPosition() {
  if (!wallConfig) {
    // Fallback to a reasonable default in case wall wasn't prepared
    return camera.position.clone().add(new THREE.Vector3(0, 0, -wallConfig?.distance || -20));
  }

  const u = (Math.random() - 0.5) * wallConfig.width;

  const minY = -0.4;
  const maxY = 3.0;
  let vMin = minY - wallConfig.center.y;
  let vMax = maxY - wallConfig.center.y;
  const halfH = wallConfig.height / 2;
  vMin = Math.max(vMin, -halfH);
  vMax = Math.min(vMax, halfH);
  if (vMax <= vMin) {
    vMin = -halfH;
    vMax = halfH;
  }
  const v = vMin + Math.random() * (vMax - vMin);

  const pos = wallConfig.center.clone()
    .add(wallConfig.right.clone().multiplyScalar(u))
    .add(wallConfig.up.clone().multiplyScalar(v));

  // Offset outward so the sphere sits on the wall surface (radius = 0.5)
  if (wallConfig.normal) {
    pos.add(wallConfig.normal.clone().multiplyScalar(0.5));
  }

  return pos;
}
