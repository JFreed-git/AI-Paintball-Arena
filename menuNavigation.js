// Menu navigation and HUD helpers

function bindUI() {
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
