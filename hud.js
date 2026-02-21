/**
 * hud.js — Shared HUD (Heads-Up Display) management
 *
 * PURPOSE: Centralized HUD element references, visibility toggling, and update
 * functions used by all game modes. Eliminates duplication of getElementById calls,
 * show/hide functions, and health/ammo/reload/sprint display logic.
 *
 * EXPORTS (window):
 *   sharedUpdateHealthBar(fillEl, current, max)
 *   sharedUpdateAmmoDisplay(ammoEl, current, magSize)
 *   sharedSetReloadingUI(isReloading, reloadIndicatorEl)
 *   sharedSetSprintUI(sprinting, sprintIndicatorEl)
 *   sharedHandleReload(weapon, now)
 *   sharedStartReload(weapon, now)
 *   sharedCanShoot(weapon, now, cooldownMs)
 *   sharedSetMeleeOnlyHUD(isMeleeOnly, ammoEl, reloadEl, meleeCdEl)
 *   ABILITY_ICONS                    — SVG data URI registry for ability icons
 *
 * DEPENDENCIES: crosshair.js (setCrosshairDimmed)
 *
 * DESIGN NOTES:
 *   - HUD element references are collected per-mode at mode startup, not globally,
 *     because modes may need different subsets of HUD elements.
 *   - Weapon state machine functions (reload, canShoot) live here because they're
 *     tightly coupled with HUD updates (reload indicator, ammo display).
 *   - The actual crosshair rendering is in crosshair.js; this file only toggles
 *     the crosshair dimmed state during reload.
 *
 * TODO (future):
 *   - Ability cooldown HUD indicators (read from AbilityManager)
 *   - Damage direction indicator (red flash from hit direction)
 *   - Kill feed display
 *   - Weapon name display in all modes (currently only training range)
 *   - Score/round display in HUD during match
 */

(function () {

  // ========== Ability Icon Registry ==========

  var ABILITY_ICONS = {
    // Slicer
    dash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M8 24h24l-8-8M32 24l-8 8" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><line x1="36" y1="12" x2="36" y2="36" stroke="#fff" stroke-width="2" opacity="0.5"/></svg>',

    // Brawler
    grappleHook: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="36" cy="12" r="4" stroke="#fff" stroke-width="2" fill="none"/><path d="M32 16L16 32" stroke="#fff" stroke-width="2" stroke-dasharray="4 2"/><path d="M16 32l-4 4M16 32l4 4M16 32l0 6" stroke="#fff" stroke-width="2" fill="none"/></svg>',

    // Marksman
    unlimitedAmmo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M14 34V14h6l8 10-8 10h-6z" stroke="#fff" stroke-width="2" fill="none"/><path d="M26 20h8M26 24h10M26 28h8" stroke="#fff" stroke-width="2" opacity="0.7"/></svg>',

    // Mage
    teleport: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="14" cy="24" r="6" stroke="#aa88ff" stroke-width="2" fill="none" stroke-dasharray="3 2"/><circle cx="34" cy="24" r="6" stroke="#aa88ff" stroke-width="2" fill="none"/><path d="M20 24h8" stroke="#aa88ff" stroke-width="2" stroke-dasharray="2 2"/><path d="M24 20l4 4-4 4" stroke="#aa88ff" stroke-width="2" fill="none"/></svg>',

    piercingBlast: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="16" cy="24" r="8" stroke="#aa88ff" stroke-width="2" fill="rgba(170,136,255,0.2)"/><line x1="24" y1="24" x2="44" y2="24" stroke="#aa88ff" stroke-width="3"/><path d="M40 20l4 4-4 4" stroke="#aa88ff" stroke-width="2" fill="none"/></svg>',

    meditate: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="20" r="6" stroke="#4488ff" stroke-width="2" fill="none"/><path d="M18 30c0-3 3-4 6-4s6 1 6 4" stroke="#4488ff" stroke-width="2" fill="none"/><path d="M12 38c3-2 6-3 12-3s9 1 12 3" stroke="#4488ff" stroke-width="1.5" fill="none" opacity="0.5"/><path d="M20 14l4-4 4 4" stroke="#4488ff" stroke-width="1.5" fill="none" opacity="0.6"/></svg>'
  };

  window.ABILITY_ICONS = ABILITY_ICONS;

  // ========== Weapon State Machine ==========

  /**
   * Check if a reload just finished and reset weapon state.
   * Returns true if reload completed this frame.
   */
  window.sharedHandleReload = function (weapon, now, heroId) {
    if (weapon.reloading && now >= weapon.reloadEnd) {
      weapon.reloading = false;
      weapon.ammo = weapon.magSize;
      if (typeof playGameSound === 'function') playGameSound('reload_end', { heroId: heroId || undefined });
      return true;
    }
    return false;
  };

  /**
   * Start a reload if not already reloading and magazine isn't full.
   * Returns true if reload was initiated.
   */
  window.sharedStartReload = function (weapon, now, heroId) {
    if (weapon.magSize === 0) return false; // infinite ammo — no reload
    if (weapon.reloading || weapon.ammo >= weapon.magSize) return false;
    weapon.reloading = true;
    var reloadSec = weapon.reloadTimeSec || 2.5;
    weapon.reloadEnd = now + reloadSec * 1000;
    if (typeof playGameSound === 'function') playGameSound('reload_start', { heroId: heroId || undefined, _duration: reloadSec });
    return true;
  };

  /**
   * Check whether a weapon is ready to fire (not reloading, has ammo, cooldown elapsed).
   */
  window.sharedCanShoot = function (weapon, now, cooldownMs) {
    return !weapon.reloading && weapon.ammo > 0 && (now - weapon.lastShotTime) >= cooldownMs;
  };

  // ========== HUD Element Updates ==========

  /**
   * Toggle reload indicator visibility + crosshair dimming.
   */
  window.sharedSetReloadingUI = function (isReloading, reloadIndicatorEl) {
    if (reloadIndicatorEl) {
      reloadIndicatorEl.classList.toggle('hidden', !isReloading);
    }
    if (typeof setCrosshairDimmed === 'function') {
      setCrosshairDimmed(isReloading);
    }
  };

  /**
   * Toggle sprint indicator visibility.
   */
  window.sharedSetSprintUI = function (sprinting, sprintIndicatorEl) {
    if (sprintIndicatorEl) {
      sprintIndicatorEl.classList.toggle('hidden', !sprinting);
    }
  };

  /**
   * Update a health bar fill element (width %) given current and max health.
   */
  window.sharedUpdateHealthBar = function (fillEl, current, max) {
    if (!fillEl) return;
    current = Number(current) || 0;
    max = Number(max) || 1;
    var pct = Math.max(0, Math.min(100, (current / Math.max(1, max)) * 100));
    fillEl.style.width = pct + '%';
  };

  /**
   * Update ammo display text.
   */
  window.sharedUpdateAmmoDisplay = function (ammoEl, current, magSize) {
    if (!ammoEl) return;
    if (magSize === 0) {
      ammoEl.textContent = '\u221E'; // infinity symbol
    } else {
      ammoEl.textContent = current + '/' + magSize;
    }
  };

  /**
   * Toggle HUD elements for meleeOnly weapons vs gun weapons.
   * meleeOnly: hide ammo + reload, keep melee cooldown visible.
   * gun: show ammo + reload as normal, melee cooldown managed elsewhere.
   */
  window.sharedSetMeleeOnlyHUD = function (isMeleeOnly, ammoEl, reloadEl, meleeCdEl) {
    if (ammoEl) ammoEl.style.display = isMeleeOnly ? 'none' : '';
    if (reloadEl) reloadEl.classList.add('hidden'); // always hide reload on switch
    if (meleeCdEl) meleeCdEl.classList.toggle('hidden', !isMeleeOnly);
  };

  // ========== Ability HUD ==========

  var KEY_LABELS = { ability1: 'Q', ability2: 'E', ability3: 'F', ability4: 'C', secondaryDown: 'RMB' };

  /**
   * Update ability cooldown HUD slots.
   * @param {Array|null} hudState - array of {id, name, key, cooldownPct, isActive, isReady}
   */
  window.updateAbilityHUD = function (hudState) {
    var container = document.getElementById('abilityHUD');
    if (!container) return;

    if (!hudState || hudState.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Reconcile slot count
    while (container.children.length > hudState.length) {
      container.removeChild(container.lastChild);
    }
    while (container.children.length < hudState.length) {
      var slot = document.createElement('div');
      slot.className = 'ability-slot';
      var icon = document.createElement('img');
      icon.className = 'ability-icon';
      icon.alt = '';
      slot.appendChild(icon);
      var label = document.createElement('span');
      label.className = 'key-label';
      slot.appendChild(label);
      var overlay = document.createElement('div');
      overlay.className = 'cooldown-overlay';
      slot.appendChild(overlay);
      container.appendChild(slot);
    }

    // Update each slot
    for (var i = 0; i < hudState.length; i++) {
      var state = hudState[i];
      var el = container.children[i];
      var iconEl = el.querySelector('.ability-icon');
      var keyLabel = el.querySelector('.key-label');
      var cdOverlay = el.querySelector('.cooldown-overlay');

      keyLabel.textContent = KEY_LABELS[state.key] || state.key;

      // Set icon from registry (look up by icon override, then by ability id)
      var iconKey = state.icon || state.id;
      var svgData = ABILITY_ICONS[iconKey];
      if (iconEl) {
        if (svgData) {
          iconEl.src = 'data:image/svg+xml,' + encodeURIComponent(svgData);
          iconEl.style.display = '';
        } else {
          iconEl.style.display = 'none';
        }
      }

      // Cooldown overlay: gray covers entire slot, recedes upward from bottom as cooldown progresses
      var pct = Math.max(0, Math.min(1, state.cooldownPct || 0));
      if (pct > 0) {
        var bottomPct = (1 - pct) * 100;
        cdOverlay.style.clipPath = 'inset(0 0 ' + bottomPct + '% 0)';
        cdOverlay.style.display = '';
      } else {
        cdOverlay.style.display = 'none';
      }

      // Toggle state classes
      el.classList.toggle('ready', !!state.isReady);
      el.classList.toggle('active', !!state.isActive);
      el.classList.toggle('on-cooldown', pct > 0 && !state.isActive);
    }
  };

  /**
   * Update melee cooldown circular timer.
   * Shows remaining cooldown as a filling arc; hidden when no weapon has melee.
   */
  var MELEE_CD_CIRCUMFERENCE = 2 * Math.PI * 11; // r=11 matches SVG
  window.sharedUpdateMeleeCooldown = function (containerEl, weapon, now) {
    if (!containerEl) return;
    if (!weapon || !weapon.meleeCooldownMs) {
      containerEl.classList.add('hidden');
      return;
    }
    containerEl.classList.remove('hidden');
    var elapsed = now - (weapon.lastMeleeTime || 0);
    var progress = Math.min(1, elapsed / weapon.meleeCooldownMs);
    var offset = MELEE_CD_CIRCUMFERENCE * (1 - progress);
    var fillCircle = containerEl.querySelector('.melee-cd-fill');
    if (fillCircle) {
      fillCircle.style.strokeDashoffset = offset;
    }
    containerEl.classList.toggle('on-cooldown', progress < 1);
  };

  /**
   * Update the mana bar HUD.
   * @param {number|null} mana - current mana (null to hide)
   * @param {number|null} maxMana - max mana
   */
  window.updateManaHUD = function (mana, maxMana) {
    var container = document.getElementById('manaBarContainer');
    if (!container) return;

    if (mana === null || mana === undefined || !maxMana) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    var fill = document.getElementById('manaFill');
    var text = document.getElementById('manaText');
    var pct = Math.max(0, Math.min(100, (mana / maxMana) * 100));
    if (fill) fill.style.width = pct + '%';
    if (text) text.textContent = Math.floor(mana) + '/' + Math.floor(maxMana);
  };

})();
