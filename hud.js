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

  // ========== Weapon State Machine ==========

  /**
   * Check if a reload just finished and reset weapon state.
   * Returns true if reload completed this frame.
   */
  window.sharedHandleReload = function (weapon, now) {
    if (weapon.reloading && now >= weapon.reloadEnd) {
      weapon.reloading = false;
      weapon.ammo = weapon.magSize;
      return true;
    }
    return false;
  };

  /**
   * Start a reload if not already reloading and magazine isn't full.
   * Returns true if reload was initiated.
   */
  window.sharedStartReload = function (weapon, now) {
    if (weapon.reloading || weapon.ammo >= weapon.magSize) return false;
    weapon.reloading = true;
    weapon.reloadEnd = now + (weapon.reloadTimeSec || 2.5) * 1000;
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
    ammoEl.textContent = current + '/' + magSize;
  };

})();
