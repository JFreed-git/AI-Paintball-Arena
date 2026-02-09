/**
 * crosshair.js — Crosshair rendering and control
 *
 * PURPOSE: Creates and controls the in-game crosshair overlay. The crosshair
 * appearance (style, spread, color) is driven by the active weapon's crosshair
 * config (weapon.crosshair in weapon.js). This file handles the DOM rendering.
 *
 * EXPORTS (window):
 *   ensureCrosshair()                        — create crosshair DOM if not present
 *   setCrosshairSpread(px)                   — set spread distance in pixels
 *   setCrosshairDimmed(dim)                  — toggle dimmed state (during reload)
 *   setCrosshairStyle(style, color)          — switch crosshair style ('cross' or 'circle')
 *   sharedSetCrosshairBySprint(sprinting, baseSpreadRad, sprintSpreadRad) — set spread based on sprint state
 *
 * DEPENDENCIES: Three.js (THREE), game.js (camera global for FOV-based spread calculation)
 *
 * DESIGN NOTES:
 *   - The crosshair is a pure CSS/DOM overlay (not rendered in 3D). It sits in the
 *     #gameContainer div and uses CSS variables (--spread, --ch-color) to control
 *     bar/ring positions and color.
 *   - Supported styles:
 *       'cross'  — 4-bar crosshair (default, for precision weapons)
 *       'circle' — circle ring + center dot (for spread weapons like shotguns)
 *   - Spread is calculated by converting weapon spread (radians) to screen pixels
 *     using the camera's FOV. This ensures the crosshair accurately represents
 *     where shots will land regardless of FOV settings.
 */

(function () {

  var _currentStyle = 'cross';

  /**
   * Convert a spread angle (radians) to screen pixels using camera FOV.
   * This ensures the crosshair visually matches the weapon's accuracy cone.
   */
  function spreadRadToPx(spreadRad) {
    var fov = (typeof camera !== 'undefined' && camera && camera.isPerspectiveCamera) ? camera.fov : 75;
    var fovRad = fov * Math.PI / 180;
    var focalPx = (window.innerHeight / 2) / Math.tan(fovRad / 2);
    var px = Math.tan(Math.max(0, spreadRad)) * focalPx;
    return Math.max(0, Math.min(150, px));
  }

  /** Build 4-bar cross children inside the crosshair element. */
  function buildCrossChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var mk = function (cls) {
      var d = document.createElement('div');
      d.className = 'ch-bar ' + cls;
      return d;
    };
    el.appendChild(mk('ch-left'));
    el.appendChild(mk('ch-right'));
    el.appendChild(mk('ch-top'));
    el.appendChild(mk('ch-bottom'));
    _currentStyle = 'cross';
  }

  /** Build circle ring + center dot children inside the crosshair element. */
  function buildCircleChildren(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var ring = document.createElement('div');
    ring.className = 'ch-ring';
    el.appendChild(ring);
    var dot = document.createElement('div');
    dot.className = 'ch-dot';
    el.appendChild(dot);
    _currentStyle = 'circle';
  }

  /**
   * Create the crosshair DOM element if it doesn't exist.
   * Builds a 4-bar crosshair structure controlled by CSS --spread variable.
   */
  function ensureCrosshair() {
    var container = document.getElementById('gameContainer');
    if (!container) return;
    var el = document.getElementById('crosshair');
    if (!el) {
      el = document.createElement('div');
      el.id = 'crosshair';
      container.appendChild(el);
    }
    buildCrossChildren(el);
  }

  /**
   * Switch crosshair style and color.
   * @param {string} style — 'cross' or 'circle'
   * @param {string} [color] — CSS color string (e.g. '#ff8844')
   */
  function setCrosshairStyle(style, color) {
    var el = document.getElementById('crosshair');
    if (!el) return;
    if (style === 'circle' && _currentStyle !== 'circle') {
      buildCircleChildren(el);
    } else if (style !== 'circle' && _currentStyle !== 'cross') {
      buildCrossChildren(el);
    }
    if (color) {
      el.style.setProperty('--ch-color', color);
    } else {
      el.style.removeProperty('--ch-color');
    }
  }

  /**
   * Set crosshair spread distance in pixels.
   */
  function setCrosshairSpread(px) {
    var el = document.getElementById('crosshair');
    if (el) {
      el.style.setProperty('--spread', px + 'px');
    }
  }

  /**
   * Toggle crosshair dimmed state (used during reload).
   */
  function setCrosshairDimmed(dim) {
    var el = document.getElementById('crosshair');
    if (el) {
      el.classList.toggle('dimmed', !!dim);
    }
  }

  /**
   * Set crosshair spread based on sprint state.
   * Uses weapon's baseSpreadRad when standing, sprintSpreadRad when sprinting.
   * Called every frame by game modes.
   */
  window.sharedSetCrosshairBySprint = function (sprinting, baseSpreadRad, sprintSpreadRad) {
    if (typeof baseSpreadRad !== 'number') baseSpreadRad = 0;
    if (typeof sprintSpreadRad !== 'number') sprintSpreadRad = 0.012;
    var spread = sprinting ? sprintSpreadRad : baseSpreadRad;
    setCrosshairSpread(spreadRadToPx(spread));
  };

  // --- Expose ---
  window.ensureCrosshair = ensureCrosshair;
  window.setCrosshairSpread = setCrosshairSpread;
  window.setCrosshairDimmed = setCrosshairDimmed;
  window.setCrosshairStyle = setCrosshairStyle;

})();
