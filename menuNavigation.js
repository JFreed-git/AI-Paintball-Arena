// Menu navigation and HUD helpers

function bindUI() {
  // Reset saved settings on reload so defaults apply
  try {
    localStorage.removeItem('mouseSensitivity');
    localStorage.removeItem('fov');
    localStorage.removeItem('targetCount');
  } catch {}

  // Sensitivity: load, display, and wire
  const sensInput = document.getElementById('sensInput');
  const sensValue = document.getElementById('sensValue');

  if (sensInput && sensValue) {
    const saved = localStorage.getItem('mouseSensitivity');
    if (saved !== null) {
      mouseSensitivity = parseFloat(saved) || 1.0;
      sensInput.value = String(mouseSensitivity);
    } else {
      mouseSensitivity = parseFloat(sensInput.value) || 1.0;
    }
    sensValue.textContent = String(mouseSensitivity.toFixed(1));

    sensInput.addEventListener('input', () => {
      mouseSensitivity = parseFloat(sensInput.value) || 1.0;
      sensValue.textContent = String(mouseSensitivity.toFixed(1));
      try {
        localStorage.setItem('mouseSensitivity', String(mouseSensitivity));
      } catch {}
    });
  }

  // Field of View: load, display, and wire
  const fovInput = document.getElementById('fovInput');
  const fovValue = document.getElementById('fovValue');

  if (fovInput && fovValue) {
    let savedFov = null;
    try { savedFov = localStorage.getItem('fov'); } catch {}

    // Default to current camera FOV if available, else 75
    let fov = (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) ? camera.fov : 75;

    if (savedFov !== null) {
      const parsed = parseFloat(savedFov);
      if (!Number.isNaN(parsed)) {
        fov = Math.min(110, Math.max(50, parsed));
      }
    }

    // Sync UI
    fovInput.value = String(Math.round(fov));
    fovValue.textContent = String(Math.round(fov));

    // Apply to camera
    if (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    fovInput.addEventListener('input', () => {
      const newFov = Math.min(110, Math.max(50, parseFloat(fovInput.value) || 75));
      fovValue.textContent = String(Math.round(newFov));
      if (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) {
        camera.fov = newFov;
        camera.updateProjectionMatrix();
      }
      try { localStorage.setItem('fov', String(newFov)); } catch {}
    });
  }

  // Targets count: load, display, and wire
  const targetCountInput = document.getElementById('targetCountInput');
  const targetCountValue = document.getElementById('targetCountValue');

  if (targetCountInput && targetCountValue) {
    let savedCount = null;
    try { savedCount = localStorage.getItem('targetCount'); } catch {}

    let count = 5;
    if (savedCount !== null) {
      const parsed = parseInt(savedCount, 10);
      if (!Number.isNaN(parsed)) {
        count = Math.min(20, Math.max(1, parsed));
      }
    }
    // Initialize globals and UI
    targetCount = count;
    targetCountInput.value = String(count);
    targetCountValue.textContent = String(count);

    const applyTargetCount = (newCount) => {
      targetCount = newCount;
      try { localStorage.setItem('targetCount', String(newCount)); } catch {}
      targetCountValue.textContent = String(newCount);

      // Live adjust during gameplay to maintain desired concurrent targets
      if (gameActive) {
        if (targets.length < targetCount) {
          const toAdd = targetCount - targets.length;
          for (let i = 0; i < toAdd; i++) createTarget();
        } else if (targets.length > targetCount) {
          const toRemove = targets.length - targetCount;
          for (let i = 0; i < toRemove; i++) {
            const t = targets.pop();
            if (t) { scene.remove(t); removeIndicatorForTarget(t); }
          }
        }
      }
    };

    targetCountInput.addEventListener('input', () => {
      const newCount = Math.min(20, Math.max(1, parseInt(targetCountInput.value, 10) || 5));
      applyTargetCount(newCount);
    });
  }

  // Navigation
  const gotoTimed = document.getElementById('gotoTimed');
  const gotoUntimed = document.getElementById('gotoUntimed');
  const backFromTimed = document.getElementById('backFromTimed');
  const backFromUntimed = document.getElementById('backFromUntimed');

  if (gotoTimed) gotoTimed.addEventListener('click', () => showOnlyMenu('timedMenu'));
  if (gotoUntimed) gotoUntimed.addEventListener('click', () => showOnlyMenu('untimedMenu'));
  if (backFromTimed) backFromTimed.addEventListener('click', () => showOnlyMenu('mainMenu'));
  if (backFromUntimed) backFromUntimed.addEventListener('click', () => showOnlyMenu('mainMenu'));

  // Start buttons
  const startTimed = document.getElementById('startTimed');
  const startUntimed = document.getElementById('startUntimed');

  if (startTimed) {
    startTimed.addEventListener('click', () => {
      const modeSel = document.getElementById('modeSelectTimed');
      const timeInput = document.getElementById('timeInput');
      const mode = modeSel ? modeSel.value : 'Free Space';
      const duration = timeInput ? Math.max(1, parseInt(timeInput.value) || 30) : 30;
      startGame({ mode, isTimed: true, duration });
    });
  }
  if (startUntimed) {
    startUntimed.addEventListener('click', () => {
      const modeSel = document.getElementById('modeSelectUntimed');
      const mode = modeSel ? modeSel.value : 'Free Space';
      startGame({ mode, isTimed: false });
    });
  }

  // Results screen
  const backToMenu = document.getElementById('backToMenu');
  if (backToMenu) {
    backToMenu.addEventListener('click', () => {
      showOnlyMenu('mainMenu');
      setHUDVisible(false);
    });
  }
}

function setHUDVisible(visible) {
  const ui = document.getElementById('ui');
  const crosshair = document.getElementById('crosshair');
  if (ui) ui.classList.toggle('hidden', !visible);
  if (crosshair) crosshair.classList.toggle('hidden', !visible);
}

function showOnlyMenu(idOrNull) {
  const menus = document.querySelectorAll('.menu');
  menus.forEach(m => m.classList.add('hidden'));
  if (idOrNull) {
    const el = document.getElementById(idOrNull);
    if (el) el.classList.remove('hidden');
  }
}
