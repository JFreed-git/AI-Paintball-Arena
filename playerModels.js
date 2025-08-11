/**
 * Player models: weapon mesh and crosshair overlay.
 * Models remain exactly the same as before; only relocated to this file.
 */

function ensureCrosshair() {
  const container = document.getElementById('gameContainer');
  if (!container) return;
  let el = document.getElementById('crosshair');
  if (!el) {
    el = document.createElement('div');
    el.id = 'crosshair';

    // Build enhanced 4-bar crosshair structure so we can control spread via CSS var
    const mk = (cls) => {
      const d = document.createElement('div');
      d.className = `ch-bar ${cls}`;
      return d;
    };
    el.appendChild(mk('ch-left'));
    el.appendChild(mk('ch-right'));
    el.appendChild(mk('ch-top'));
    el.appendChild(mk('ch-bottom'));

    container.appendChild(el);
  }
}

// Helpers to control crosshair from gameplay code
function setCrosshairSpread(px) {
  const el = document.getElementById('crosshair');
  if (el) {
    el.style.setProperty('--spread', `${px}px`);
  }
}
function setCrosshairDimmed(dim) {
  const el = document.getElementById('crosshair');
  if (el) {
    el.classList.toggle('dimmed', !!dim);
  }
}

function createWeaponModel() {
  // Simple weapon - just a basic rectangle for now (unchanged)
  const weaponGeometry = new THREE.BoxGeometry(0.1, 0.1, 1);
  const weaponMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
  weapon.position.set(0.5, -0.5, -2);
  weapon.rotation.x = 0.2;
  camera.add(weapon);
  scene.add(camera);
}
