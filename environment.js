// Environment setup (background, fog, lights, ground)
function setupEnvironment() {
  // Background and fog
  scene.background = new THREE.Color(0xf5f5f5);
  scene.fog = new THREE.Fog(0xf5f5f5, 10, 220);

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.6);
  scene.add(hemi);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambientLight);

  const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
  dir1.position.set(12, 18, 8);
  scene.add(dir1);

  const dir2 = new THREE.DirectionalLight(0xffffff, 0.4);
  dir2.position.set(-12, 12, -8);
  scene.add(dir2);

  // Ground
  const groundGeometry = new THREE.PlaneGeometry(300, 300);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);
}
