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
 * DEPENDENCIES: Three.js (THREE), camera global (for FOV-based spread calculation)
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
  var _currentSpreadPx = 0;

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
    _currentSpreadPx = px;
    var el = document.getElementById('crosshair');
    if (el) {
      el.style.setProperty('--spread', px + 'px');
      // Hide ring when spread is 0 in circle mode (just show center dot)
      if (_currentStyle === 'circle') {
        var ring = el.querySelector('.ch-ring');
        if (ring) ring.style.display = px <= 0 ? 'none' : '';
      }
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

  // --- Scope / ADS System ---

  var _adsActive = false;
  var _adsFOV = 75;
  var _adsTransitionSpeed = 12;
  var _defaultFOV = 75;

  function lerpTo(current, target, speed, dt) {
    var diff = target - current;
    if (Math.abs(diff) < 1) return target;
    return current + diff * Math.min(1, speed * dt);
  }

  /**
   * Update scope/ADS state each frame.
   * @param {object} weapon — player's Weapon (has .scope or null)
   * @param {boolean} isADSHeld — is right-click held?
   * @param {number} dt — delta time in seconds
   * @returns {{ adsActive: boolean, spreadMultiplier: number }}
   */
  function updateScopeADS(weapon, isADSHeld, dt) {
    var noScope = { adsActive: false, spreadMultiplier: 1.0 };
    if (!weapon || !weapon.scope) {
      // No scope — reset to defaults
      if (_adsFOV !== _defaultFOV) {
        _adsFOV = _defaultFOV;
        if (window.camera) {
          window.camera.fov = _adsFOV;
          window.camera.updateProjectionMatrix();
        }
      }
      if (_adsActive) {
        _adsActive = false;
        var el = document.getElementById('crosshair');
        if (el) el.style.opacity = '1';
      }
      return noScope;
    }

    var targetFOV = isADSHeld ? weapon.scope.zoomFOV : _defaultFOV;
    _adsFOV = lerpTo(_adsFOV, targetFOV, _adsTransitionSpeed, dt);

    // Determine active state
    if (isADSHeld && Math.abs(_adsFOV - weapon.scope.zoomFOV) < 1) {
      _adsActive = true;
    } else if (!isADSHeld && Math.abs(_adsFOV - _defaultFOV) < 1) {
      _adsActive = false;
    }

    // Apply FOV to camera
    if (window.camera) {
      window.camera.fov = _adsFOV;
      window.camera.updateProjectionMatrix();
    }

    // Crosshair opacity: fade based on zoom progress
    var el = document.getElementById('crosshair');
    if (el) {
      var zoomProgress = 1 - Math.abs(_adsFOV - _defaultFOV) / Math.max(1, Math.abs(weapon.scope.zoomFOV - _defaultFOV));
      el.style.opacity = String(Math.max(0, Math.min(1, zoomProgress)));
    }

    return {
      adsActive: _adsActive,
      spreadMultiplier: _adsActive ? (weapon.scope.spreadMultiplier || 1.0) : 1.0
    };
  }

  /**
   * Reset scope/ADS state. Called on hero switch, round end, death.
   */
  function resetScopeADS() {
    _adsActive = false;
    _adsFOV = _defaultFOV;
    if (window.camera) {
      window.camera.fov = _defaultFOV;
      window.camera.updateProjectionMatrix();
    }
    var el = document.getElementById('crosshair');
    if (el) el.style.opacity = '1';
  }

  // --- Expose ---
  window.ensureCrosshair = ensureCrosshair;
  window.setCrosshairSpread = setCrosshairSpread;
  window.setCrosshairDimmed = setCrosshairDimmed;
  window.setCrosshairStyle = setCrosshairStyle;
  window.updateScopeADS = updateScopeADS;
  window.resetScopeADS = resetScopeADS;

})();
