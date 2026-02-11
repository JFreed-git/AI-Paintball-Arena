/**
 * environment.js — Scene environment setup
 *
 * PURPOSE: Sets up the global scene environment shared by all game modes:
 * sky background, fog, lighting (hemisphere + ambient + directional), and the
 * large grass ground plane. Called once at boot by game.js.
 *
 * EXPORTS (bare global): setupEnvironment()
 *
 * DEPENDENCIES: Three.js (THREE), game.js (scene global)
 *
 * DESIGN NOTES:
 *   - Lighting is identical for all modes. The outdoor paintball aesthetic uses
 *     warm sunlight with sky-colored hemisphere bounce.
 *   - The 400x400m grass plane extends well beyond any arena for seamless horizon.
 *   - Ground plane Y is hardcoded to -1 (should use GROUND_Y for consistency).
 *
 * TODO (future):
 *   - Use GROUND_Y constant instead of hardcoded -1 for ground plane position
 *   - Per-mode lighting presets (e.g. dimmer for indoor arenas)
 *   - Time-of-day system (dawn, noon, dusk, night)
 *   - Weather effects (rain, fog density changes)
 *   - Skybox texture instead of flat color
 */

function setupEnvironment() {
  // Sky blue background and fog
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 50, 160);

  // Outdoor lighting — hemisphere for sky/ground bounce
  const hemi = new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.6);
  scene.add(hemi);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambientLight);

  // Sun (warm directional light)
  const sun = new THREE.DirectionalLight(0xfffae6, 0.8);
  sun.position.set(20, 30, 10);
  scene.add(sun);

  // Fill light from opposite side
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(-15, 10, -10);
  scene.add(fill);

  // Grass ground (large plane extending well beyond arena)
  const groundGeometry = new THREE.PlaneGeometry(400, 400);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x355E2A });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  scene.add(ground);
}
