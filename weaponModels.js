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
  WEAPON_MODEL_REGISTRY['sniper'] = buildRifle;

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

  // --- Sword: Blade + crossguard + handle ---
  function buildSword() {
    var group = new THREE.Group();
    group.name = 'weapon_sword';

    var bladeMetal = new THREE.MeshLambertMaterial({ color: 0xccccdd });
    var bladeEdge  = new THREE.MeshLambertMaterial({ color: 0xeeeeff });
    var guardMetal = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
    var handleWrap = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
    var pommelMat  = new THREE.MeshLambertMaterial({ color: 0x8B7355 });

    // Blade (long flat piece extending forward/down)
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.55), bladeMetal);
    blade.position.set(0, 0, -0.35);
    group.add(blade);

    // Blade edge highlight (thin strip along one side)
    var edge = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.065, 0.50), bladeEdge);
    edge.position.set(0.018, 0, -0.33);
    group.add(edge);

    // Blade tip (tapered)
    var tip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), bladeMetal);
    tip.position.set(0, 0, -0.64);
    group.add(tip);

    // Crossguard (perpendicular bar)
    var guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.03), guardMetal);
    guard.position.set(0, 0, -0.06);
    group.add(guard);

    // Handle (grip)
    var handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.14), handleWrap);
    handle.position.set(0, 0, 0.04);
    group.add(handle);

    // Pommel (end cap)
    var pommel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), pommelMat);
    pommel.position.set(0, 0, 0.13);
    group.add(pommel);

    return group;
  }
  WEAPON_MODEL_REGISTRY['sword'] = buildSword;

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

  // --- GLTF/GLB model support ---

  var _gltfCache = {};  // modelType → THREE.Group (pre-loaded)

  /**
   * Register a GLTF-based weapon model from a cached scene.
   * The builder clones from cache with scale/rotation/offset applied.
   */
  function _registerGltfModel(modelDef, cachedScene) {
    if (!modelDef || !modelDef.modelType || !cachedScene) return;

    _gltfCache[modelDef.modelType] = cachedScene;

    WEAPON_MODEL_REGISTRY[modelDef.modelType] = function () {
      var group = new THREE.Group();
      group.name = 'weapon_' + modelDef.modelType;

      var clone = cachedScene.clone(true);

      // Apply scale
      var s = modelDef.scale || [1, 1, 1];
      clone.scale.set(s[0], s[1], s[2]);

      // Apply rotation
      var r = modelDef.rotation || [0, 0, 0];
      clone.rotation.set(r[0], r[1], r[2]);

      // Apply offset
      var o = modelDef.offset || [0, 0, 0];
      clone.position.set(o[0], o[1], o[2]);

      group.add(clone);
      return group;
    };
  }

  /**
   * Register a parts-based custom weapon model (boxes/cylinders).
   */
  function _registerPartsModel(modelDef) {
    if (!modelDef || !modelDef.modelType || !modelDef.parts) return;

    WEAPON_MODEL_REGISTRY[modelDef.modelType] = function () {
      var group = new THREE.Group();
      group.name = 'weapon_' + modelDef.modelType;

      modelDef.parts.forEach(function (part) {
        var geom, mesh;
        var color = part.color || '#444444';
        var mat = new THREE.MeshLambertMaterial({ color: color });

        if (part.type === 'cylinder') {
          var radius = (part.size && part.size[0]) ? part.size[0] / 2 : 0.05;
          var height = (part.size && part.size[1]) ? part.size[1] : 0.1;
          geom = new THREE.CylinderGeometry(radius, radius, height, 16);
        } else {
          var sx = (part.size && part.size[0]) ? part.size[0] : 0.1;
          var sy = (part.size && part.size[1]) ? part.size[1] : 0.1;
          var sz = (part.size && part.size[2]) ? part.size[2] : 0.1;
          geom = new THREE.BoxGeometry(sx, sy, sz);
        }

        mesh = new THREE.Mesh(geom, mat);
        if (part.position) mesh.position.set(part.position[0] || 0, part.position[1] || 0, part.position[2] || 0);
        if (part.rotation) mesh.rotation.set(part.rotation[0] || 0, part.rotation[1] || 0, part.rotation[2] || 0);
        group.add(mesh);
      });

      return group;
    };
  }

  /**
   * Load all custom weapon models from the server.
   * For GLTF models: loads the GLB binary, parses with GLTFLoader, caches, and registers.
   * For parts-based models: registers the builder directly.
   * Returns a Promise that resolves when all models are loaded.
   */
  function loadCustomWeaponModelsFromServer() {
    return fetch('/api/weapon-models').then(function (r) { return r.json(); }).then(function (names) {
      var promises = names.map(function (name) {
        return fetch('/api/weapon-models/' + encodeURIComponent(name))
          .then(function (r) { return r.json(); });
      });
      return Promise.all(promises);
    }).then(function (models) {
      var gltfPromises = [];

      (models || []).forEach(function (modelDef) {
        if (!modelDef || !modelDef.modelType) return;

        if (modelDef.source === 'gltf' && modelDef.gltfFile) {
          // GLTF model — load the GLB binary
          var p = fetch('/api/weapon-model-files/' + encodeURIComponent(modelDef.gltfFile))
            .then(function (r) {
              if (!r.ok) throw new Error('GLB file not found: ' + modelDef.gltfFile);
              return r.arrayBuffer();
            })
            .then(function (arrayBuffer) {
              return new Promise(function (resolve, reject) {
                if (!THREE.GLTFLoader) {
                  reject(new Error('GLTFLoader not available'));
                  return;
                }
                var loader = new THREE.GLTFLoader();
                loader.parse(arrayBuffer, '', function (gltf) {
                  _registerGltfModel(modelDef, gltf.scene);
                  resolve();
                }, function (err) {
                  reject(err);
                });
              });
            })
            .catch(function (err) {
              console.warn('[weaponModels] Failed to load GLTF model "' + modelDef.modelType + '":', err);
            });
          gltfPromises.push(p);
        } else if (modelDef.parts) {
          // Parts-based model
          _registerPartsModel(modelDef);
        }
      });

      return Promise.all(gltfPromises);
    }).catch(function (err) {
      console.warn('[weaponModels] Failed to load custom weapon models:', err);
    });
  }

  window.buildWeaponModel = buildWeaponModel;
  window.WEAPON_MODEL_REGISTRY = WEAPON_MODEL_REGISTRY;
  window.loadCustomWeaponModelsFromServer = loadCustomWeaponModelsFromServer;
  window._registerGltfModel = _registerGltfModel;
  window._registerPartsModel = _registerPartsModel;

})();
