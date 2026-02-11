/**
 * menuRenderer.js — Menu config defaults and DOM renderer
 *
 * PURPOSE: Defines all game menus as JSON configs (MENU_DEFAULTS), provides
 * functions to render those configs into real DOM elements, and supports
 * loading custom menu configs from the server to override defaults.
 *
 * EXPORTS (window):
 *   MENU_DEFAULTS            — all 5 menus as JSON config objects
 *   renderMenuFromConfig(config) — returns a document fragment of rendered elements
 *   renderAllMenus(configMap)    — replaces existing menu DOM with rendered configs
 *   getDefaultMenuConfigs()      — returns a copy of MENU_DEFAULTS
 *   loadCustomMenus()            — fetches custom configs, merges with defaults, renders
 *
 * DEPENDENCIES: menuNavigation.js (bindUI, showOnlyMenu, populateMapDropdown)
 *
 * LOAD ORDER: Before menuNavigation.js in both index.html and dev.html
 */
(function () {
  'use strict';

  // ===================================================================
  // Default Menu Configurations — converted from hardcoded HTML
  // ===================================================================
  // Every element uses absolute positioning (x/y relative to container top-left).
  // Container gets position:relative + padding:0 when rendered.

  var MENU_DEFAULTS = {

    // ── Main Menu ──
    mainMenu: {
      id: 'mainMenu',
      name: 'Main Menu',
      width: 420,
      height: 230,
      style: {},
      elements: [
        {
          uid: 'mm_1', type: 'heading', tag: 'h1', text: 'Paintball Arena',
          x: 0, y: 20, width: 420, height: 36,
          style: {}
        },
        {
          uid: 'mm_2', type: 'slider', label: 'Mouse Sensitivity',
          inputId: 'sensInput', valueId: 'sensValue',
          min: 0.2, max: 3, step: 0.1, defaultValue: 1.0,
          x: 24, y: 72, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'mm_3', type: 'slider', label: 'Field of View',
          inputId: 'fovInput', valueId: 'fovValue',
          min: 50, max: 110, step: 1, defaultValue: 75,
          x: 24, y: 116, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'mm_4', type: 'button', text: 'Play Paintball',
          elementId: 'gotoPaintball', variant: 'primary',
          action: 'showMenu:paintballMenu',
          x: 12, y: 172, width: 130, height: 40,
          style: {}
        },
        {
          uid: 'mm_5', type: 'button', text: 'Play LAN',
          elementId: 'gotoLAN', variant: 'primary',
          action: 'showMenu:lanMenu',
          x: 152, y: 172, width: 116, height: 40,
          style: {}
        },
        {
          uid: 'mm_6', type: 'button', text: 'Training Range',
          elementId: 'gotoTraining', variant: 'primary',
          action: 'showMenu:trainingMenu',
          x: 278, y: 172, width: 130, height: 40,
          style: {}
        }
      ]
    },

    // ── Paintball (AI) Menu ──
    paintballMenu: {
      id: 'paintballMenu',
      name: 'Paintball (AI)',
      width: 420,
      height: 270,
      style: {},
      elements: [
        {
          uid: 'pb_1', type: 'heading', tag: 'h2', text: 'Paintball (AI)',
          x: 0, y: 20, width: 420, height: 36,
          style: {}
        },
        {
          uid: 'pb_2', type: 'select', label: 'Difficulty',
          elementId: 'paintballDifficulty', defaultValue: 'Easy',
          options: [
            { value: 'Easy', text: 'Easy' },
            { value: 'Medium', text: 'Medium' },
            { value: 'Hard', text: 'Hard' }
          ],
          x: 24, y: 72, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'pb_3', type: 'select', label: 'Map',
          elementId: 'paintballMapSelect', defaultValue: '__default__',
          options: [
            { value: '__default__', text: 'Default Arena' }
          ],
          x: 24, y: 116, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'pb_4', type: 'numberInput', label: 'Rounds to Win',
          elementId: 'roundsToWinPaintball',
          min: 1, max: 10, step: 1, defaultValue: 2,
          x: 24, y: 160, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'pb_5', type: 'button', text: 'Start',
          elementId: 'startPaintball', variant: 'primary',
          action: 'startPaintball',
          x: 90, y: 212, width: 120, height: 40,
          style: {}
        },
        {
          uid: 'pb_6', type: 'button', text: 'Back',
          elementId: 'backFromPaintball', variant: 'secondary',
          action: 'showMenu:mainMenu',
          x: 220, y: 212, width: 120, height: 40,
          style: {}
        }
      ]
    },

    // ── Training Range Menu ──
    trainingMenu: {
      id: 'trainingMenu',
      name: 'Training Range',
      width: 420,
      height: 150,
      style: {},
      elements: [
        {
          uid: 'tr_1', type: 'heading', tag: 'h2', text: 'Training Range',
          x: 0, y: 20, width: 420, height: 36,
          style: {}
        },
        {
          uid: 'tr_2', type: 'button', text: 'Start Training',
          elementId: 'startTraining', variant: 'primary',
          action: 'startTraining',
          x: 62, y: 84, width: 140, height: 40,
          style: {}
        },
        {
          uid: 'tr_3', type: 'button', text: 'Back',
          elementId: 'backFromTraining', variant: 'secondary',
          action: 'showMenu:mainMenu',
          x: 218, y: 84, width: 140, height: 40,
          style: {}
        }
      ]
    },

    // ── LAN Multiplayer Menu ──
    lanMenu: {
      id: 'lanMenu',
      name: 'LAN Multiplayer',
      width: 420,
      height: 280,
      style: {},
      elements: [
        {
          uid: 'ln_1', type: 'heading', tag: 'h2', text: 'LAN Multiplayer',
          x: 0, y: 20, width: 420, height: 36,
          style: {}
        },
        {
          uid: 'ln_2', type: 'textInput', label: 'Room ID',
          elementId: 'roomId', placeholder: 'e.g., room1',
          x: 24, y: 72, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'ln_3', type: 'select', label: 'Map',
          elementId: 'lanMapSelect', defaultValue: '__default__',
          options: [
            { value: '__default__', text: 'Default Arena' }
          ],
          x: 24, y: 116, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'ln_4', type: 'numberInput', label: 'Rounds to Win',
          elementId: 'roundsToWin',
          min: 1, max: 10, step: 1, defaultValue: 2,
          x: 24, y: 160, width: 372, height: 30,
          style: {}
        },
        {
          uid: 'ln_5', type: 'button', text: 'Host LAN Game',
          elementId: 'hostLanBtn', variant: 'primary',
          action: 'hostLAN',
          x: 16, y: 216, width: 128, height: 40,
          style: {}
        },
        {
          uid: 'ln_6', type: 'button', text: 'Join LAN Game',
          elementId: 'joinLanBtn', variant: 'secondary',
          action: 'joinLAN',
          x: 154, y: 216, width: 120, height: 40,
          style: {}
        },
        {
          uid: 'ln_7', type: 'button', text: 'Back',
          elementId: 'backFromLAN', variant: 'secondary',
          action: 'showMenu:mainMenu',
          x: 284, y: 216, width: 120, height: 40,
          style: {}
        }
      ]
    },

    // ── Result Menu ──
    resultMenu: {
      id: 'resultMenu',
      name: 'Results',
      width: 420,
      height: 180,
      style: {},
      elements: [
        {
          uid: 'rs_1', type: 'heading', tag: 'h2', text: 'Session Complete',
          x: 0, y: 20, width: 420, height: 36,
          style: {}
        },
        {
          uid: 'rs_2', type: 'text',
          text: 'Final Score: <strong><span id="finalScore">0</span></strong>',
          x: 0, y: 72, width: 420, height: 24,
          style: { textAlign: 'center', margin: '0' }
        },
        {
          uid: 'rs_3', type: 'button', text: 'Back to Main Menu',
          elementId: 'backToMenu', variant: 'primary',
          action: 'backToMenu',
          x: 110, y: 118, width: 200, height: 40,
          style: {}
        }
      ]
    }
  };

  // ===================================================================
  // Element Renderer
  // ===================================================================

  /**
   * Apply an object of camelCase CSS properties as inline styles.
   */
  function applyStyles(el, styleObj) {
    if (!styleObj) return;
    var keys = Object.keys(styleObj);
    for (var i = 0; i < keys.length; i++) {
      el.style[keys[i]] = styleObj[keys[i]];
    }
  }

  /**
   * Render a single element config into a DOM node.
   * Returns the root DOM element.
   */
  function renderElement(cfg) {
    var root;

    switch (cfg.type) {

      case 'heading': {
        var tag = cfg.tag || 'h1';
        root = document.createElement(tag);
        root.textContent = cfg.text || '';
        break;
      }

      case 'text': {
        root = document.createElement('p');
        root.innerHTML = cfg.text || '';
        break;
      }

      case 'button': {
        root = document.createElement('button');
        root.textContent = cfg.text || '';
        if (cfg.variant === 'secondary') root.className = 'secondary';
        if (cfg.elementId) root.id = cfg.elementId;
        break;
      }

      case 'slider': {
        root = document.createElement('div');
        root.className = 'field';
        root.style.margin = '0';
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.justifyContent = 'space-between';
        root.style.gap = '12px';

        var slLabel = document.createElement('label');
        slLabel.textContent = cfg.label || '';
        if (cfg.inputId) slLabel.setAttribute('for', cfg.inputId);

        var slInput = document.createElement('input');
        slInput.type = 'range';
        if (cfg.inputId) slInput.id = cfg.inputId;
        if (cfg.min !== undefined) slInput.min = String(cfg.min);
        if (cfg.max !== undefined) slInput.max = String(cfg.max);
        if (cfg.step !== undefined) slInput.step = String(cfg.step);
        if (cfg.defaultValue !== undefined) slInput.value = String(cfg.defaultValue);

        var slSpan = document.createElement('span');
        if (cfg.valueId) slSpan.id = cfg.valueId;
        slSpan.textContent = cfg.defaultValue !== undefined ? String(cfg.defaultValue) : '';

        root.appendChild(slLabel);
        root.appendChild(slInput);
        root.appendChild(slSpan);
        break;
      }

      case 'select': {
        root = document.createElement('div');
        root.className = 'field';
        root.style.margin = '0';
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.justifyContent = 'space-between';
        root.style.gap = '12px';

        var seLabel = document.createElement('label');
        seLabel.textContent = cfg.label || '';

        var seSelect = document.createElement('select');
        if (cfg.elementId) seSelect.id = cfg.elementId;
        (cfg.options || []).forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.text;
          seSelect.appendChild(o);
        });
        if (cfg.defaultValue !== undefined) seSelect.value = String(cfg.defaultValue);

        seLabel.appendChild(seSelect);
        root.appendChild(seLabel);
        break;
      }

      case 'numberInput': {
        root = document.createElement('div');
        root.className = 'field';
        root.style.margin = '0';
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.justifyContent = 'space-between';
        root.style.gap = '12px';

        var niLabel = document.createElement('label');
        niLabel.textContent = cfg.label || '';

        var niInput = document.createElement('input');
        niInput.type = 'number';
        if (cfg.elementId) niInput.id = cfg.elementId;
        if (cfg.min !== undefined) niInput.min = String(cfg.min);
        if (cfg.max !== undefined) niInput.max = String(cfg.max);
        if (cfg.step !== undefined) niInput.step = String(cfg.step);
        if (cfg.defaultValue !== undefined) niInput.value = String(cfg.defaultValue);

        niLabel.appendChild(niInput);
        root.appendChild(niLabel);
        break;
      }

      case 'textInput': {
        root = document.createElement('div');
        root.className = 'field';
        root.style.margin = '0';
        root.style.display = 'flex';
        root.style.alignItems = 'center';
        root.style.justifyContent = 'space-between';
        root.style.gap = '12px';

        var tiLabel = document.createElement('label');
        tiLabel.textContent = cfg.label || '';

        var tiInput = document.createElement('input');
        tiInput.type = 'text';
        if (cfg.elementId) tiInput.id = cfg.elementId;
        if (cfg.placeholder) tiInput.placeholder = cfg.placeholder;

        tiLabel.appendChild(tiInput);
        root.appendChild(tiLabel);
        break;
      }

      case 'divider': {
        root = document.createElement('hr');
        root.style.border = 'none';
        root.style.borderTop = '1px solid rgba(255,255,255,0.1)';
        break;
      }

      case 'image': {
        root = document.createElement('img');
        if (cfg.src) root.src = cfg.src;
        if (cfg.alt) root.alt = cfg.alt;
        root.style.maxWidth = '100%';
        break;
      }

      default:
        root = document.createElement('div');
        root.textContent = cfg.text || '';
    }

    // Absolute positioning within menu container
    root.style.position = 'absolute';
    root.style.left = (cfg.x || 0) + 'px';
    root.style.top = (cfg.y || 0) + 'px';
    if (cfg.width) root.style.width = cfg.width + 'px';
    if (cfg.height) root.style.height = cfg.height + 'px';

    // Custom style overrides
    applyStyles(root, cfg.style);

    // Store uid for builder reference
    if (cfg.uid) root.setAttribute('data-mb-uid', cfg.uid);

    return root;
  }

  // ===================================================================
  // Menu Renderer
  // ===================================================================

  /**
   * Render a full menu config into the given container element.
   * Replaces all children. Preserves the element's class list.
   */
  function renderMenuIntoContainer(containerEl, config) {
    // Clear existing content
    containerEl.innerHTML = '';

    // Set container dimensions and layout
    if (config.fullScreen) {
      containerEl.style.width = '100%';
      containerEl.style.height = '100%';
      containerEl.style.top = '0';
      containerEl.style.left = '0';
      containerEl.style.transform = 'none';
      containerEl.style.maxWidth = 'none';
    } else {
      containerEl.style.width = (config.width || 420) + 'px';
      containerEl.style.height = (config.height || 240) + 'px';
    }
    containerEl.style.position = 'absolute';
    containerEl.style.padding = '0';
    containerEl.style.overflow = 'hidden';

    // Apply container style overrides
    applyStyles(containerEl, config.style);

    // Render each element
    (config.elements || []).forEach(function (elCfg) {
      var node = renderElement(elCfg);
      containerEl.appendChild(node);
    });
  }

  /**
   * Build a standalone DOM element from a config (used by the builder preview).
   * Returns a new div with .menu class containing rendered elements.
   */
  function renderMenuFromConfig(config) {
    var container = document.createElement('div');
    container.className = 'menu';
    container.style.position = 'relative';
    container.style.transform = 'none';
    container.style.top = 'auto';
    container.style.left = 'auto';
    renderMenuIntoContainer(container, config);
    return container;
  }

  /**
   * Replace all game menus in the DOM with rendered configs.
   * configMap: { menuId: config, ... }
   */
  function renderAllMenus(configMap) {
    var menuIds = Object.keys(configMap);
    for (var i = 0; i < menuIds.length; i++) {
      var menuId = menuIds[i];
      var config = configMap[menuId];
      var existing = document.getElementById(menuId);
      if (!existing) continue;

      // Preserve hidden state
      var wasHidden = existing.classList.contains('hidden');

      // Render into existing container
      renderMenuIntoContainer(existing, config);

      // Restore hidden state
      if (wasHidden) {
        existing.classList.add('hidden');
      } else {
        existing.classList.remove('hidden');
      }
    }
  }

  /**
   * Returns a deep copy of MENU_DEFAULTS as a { menuId: config } map.
   */
  function getDefaultMenuConfigs() {
    return JSON.parse(JSON.stringify(MENU_DEFAULTS));
  }

  /**
   * Fetch custom menu configs from the server, merge with defaults,
   * render all menus, and rebind UI.
   */
  function loadCustomMenus() {
    // Start with defaults
    var configs = getDefaultMenuConfigs();

    // Fetch custom menu list
    fetch('/api/menus').then(function (r) {
      if (!r.ok) return [];
      return r.json();
    }).then(function (names) {
      if (!names || !names.length) {
        // No custom menus — render defaults
        renderAllMenus(configs);
        if (typeof bindUI === 'function') bindUI();
        return;
      }

      // Fetch each custom menu
      var promises = names.map(function (name) {
        return fetch('/api/menus/' + encodeURIComponent(name))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; });
      });

      return Promise.all(promises).then(function (customMenus) {
        // Merge custom configs over defaults
        customMenus.forEach(function (custom) {
          if (custom && custom.id) {
            configs[custom.id] = custom;
          }
        });

        // Render all menus
        renderAllMenus(configs);

        // Rebind UI so event listeners attach to new DOM elements
        if (typeof bindUI === 'function') bindUI();
      });
    }).catch(function (err) {
      // On error, render defaults as fallback
      console.warn('menuRenderer: failed to load custom menus, using defaults', err);
      renderAllMenus(configs);
      if (typeof bindUI === 'function') bindUI();
    });
  }

  // ===================================================================
  // Exports
  // ===================================================================
  window.MENU_DEFAULTS = MENU_DEFAULTS;
  window.renderMenuFromConfig = renderMenuFromConfig;
  window.renderAllMenus = renderAllMenus;
  window.getDefaultMenuConfigs = getDefaultMenuConfigs;
  window.loadCustomMenus = loadCustomMenus;
})();
