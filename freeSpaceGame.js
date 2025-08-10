// Free Space mode helpers

// Returns a random position in front of the camera within the allowed bounds,
// matching the original game's Free Space spawning behavior.
function getFreeSpaceSpawnPosition() {
  const angle = Math.random() * Math.PI * 2;
  const distance = 10 + Math.random() * 20;

  const pos = new THREE.Vector3();
  pos.x = Math.cos(angle) * distance;

  // Keep targets above ground (ground at -1, target radius ~0.5)
  const minY = -0.4;
  const maxY = 3.0;
  pos.y = minY + Math.random() * (maxY - minY);

  pos.z = Math.sin(angle) * distance - 10;

  return pos;
}

// Placeholder for future mode-specific setup if needed.
// Currently Free Space requires no additional setup beyond standard scene init.
function setupFreeSpace() {
  // no-op for now
}
