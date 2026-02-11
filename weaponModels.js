/**
 * weaponModels.js — 3D weapon model builders
 *
 * PURPOSE: Registry of functions that build distinct 3D weapon meshes per weapon type.
 * Each weapon's modelType (string key from weapon.js) maps to a builder function here.
 * Models are attached to the player mesh as a swappable child group.
 *
 * EXPORTS (window):
 *   buildWeaponModel(modelType) — returns a THREE.Group with the weapon mesh
 *   WEAPON_MODEL_REGISTRY       — the raw registry object (for extensibility)
 *
 * DEPENDENCIES: Three.js (THREE global)
 *
 * DESIGN NOTES:
 *   - Models are third-person representations (what opponents see).
 *   - First-person viewmodels (full arms + gun from player POV) are a future feature.
 *     When implemented, this file will export a separate buildWeaponViewModel(modelType)
 *     that returns a camera-attached group.
 *   - Models use simple geometric shapes (boxes, cylinders) for now, matching the
 *     game's boxy/angled art style. As models get more complex, these builders can
 *     be replaced with loaded GLTF/GLB models.
 *   - Each builder returns a THREE.Group positioned at local origin. The caller
 *     (player.js) handles attaching it at the correct offset on the player mesh.
 *
 * ADDING A NEW WEAPON MODEL:
 *   1. Add a builder function: function buildMyWeapon() { ... return group; }
 *   2. Register it: WEAPON_MODEL_REGISTRY['myweapon'] = buildMyWeapon;
 *   3. Set modelType: 'myweapon' in the weapon config (heroes.js)
 *
 * TODO (future):
 *   - First-person viewmodel builders (camera-attached, with arms)
 *   - GLTF/GLB model loading for detailed weapon art
 *   - Weapon animation support (recoil, reload, inspect)
 *   - Muzzle flash position per weapon (for particle effects)
 *   - Shell ejection point per weapon
 */

(function () {

  var WEAPON_MODEL_REGISTRY = {};

  // --- Rifle: Long barrel, angular design, scope detail ---
  function buildRifle() {
    var group = new THREE.Group();
    group.name = 'weapon_rifle';

    var darkMetal = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    var lightMetal = new THREE.MeshLambertMaterial({ color: 0x4a4a4a });
    var accent = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });

    // Main body / receiver
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.40), darkMetal);
    body.position.set(0, 0, -0.05);
    group.add(body);

    // Barrel (extends forward)
    var barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), lightMetal);
    barrel.position.set(0, 0.02, -0.40);
    group.add(barrel);

    // Stock (extends backward)
    var stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.20), darkMetal);
    stock.position.set(0, -0.01, 0.22);
    group.add(stock);

    // Scope rail
    var scope = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.12), accent);
    scope.position.set(0, 0.08, -0.10);
    group.add(scope);

    // Magazine
    var mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.06), lightMetal);
    mag.position.set(0, -0.10, 0.0);
    group.add(mag);

    return group;
  }
  WEAPON_MODEL_REGISTRY['rifle'] = buildRifle;

  // --- Shotgun: Short wide barrel, pump detail, warm tones ---
  function buildShotgun() {
    var group = new THREE.Group();
    group.name = 'weapon_shotgun';

    var woodBrown = new THREE.MeshLambertMaterial({ color: 0x5C3A1E });
    var darkMetal = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    var chrome = new THREE.MeshLambertMaterial({ color: 0x6a6a6a });

    // Main body / receiver
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, 0.30), darkMetal);
    body.position.set(0, 0, -0.02);
    group.add(body);

    // Double barrel (wider, shorter)
    var barrel = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.06, 0.28), chrome);
    barrel.position.set(0, 0.02, -0.30);
    group.add(barrel);

    // Pump grip
    var pump = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.10), woodBrown);
    pump.position.set(0, -0.06, -0.18);
    group.add(pump);

    // Stock (wood)
    var stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.22), woodBrown);
    stock.position.set(0, -0.02, 0.22);
    group.add(stock);

    return group;
  }
  WEAPON_MODEL_REGISTRY['shotgun'] = buildShotgun;

  // --- Fallback: Simple rectangle (legacy, for unregistered types) ---
  function buildDefault() {
    var group = new THREE.Group();
    group.name = 'weapon_default';

    var mat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.1), mat);
    group.add(mesh);

    return group;
  }
  WEAPON_MODEL_REGISTRY['default'] = buildDefault;

  /**
   * Build a 3D weapon model for the given type.
   * Returns a THREE.Group positioned at local origin.
   * Falls back to 'default' if the type is not registered.
   */
  function buildWeaponModel(modelType) {
    var builder = WEAPON_MODEL_REGISTRY[modelType] || WEAPON_MODEL_REGISTRY['default'];
    return builder();
  }

  window.buildWeaponModel = buildWeaponModel;
  window.WEAPON_MODEL_REGISTRY = WEAPON_MODEL_REGISTRY;

})();
