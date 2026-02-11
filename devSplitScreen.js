/**
 * devSplitScreen.js — Split-screen two-player mode via real LAN networking
 *
 * PURPOSE: Two iframes side by side, each loading localhost:3000 as a fully
 * independent game client. One hosts and one joins a real LAN game via
 * Socket.IO. A transparent overlay captures pointer lock and forwards
 * input to the active iframe via postMessage. Tab switches control.
 *
 * EXPORTS (window):
 *   startSplitScreen(opts) — start split-screen with {mapName}
 *   stopSplitScreen()      — tear down split-screen
 *   _splitScreenActive     — boolean flag checked by devApp.js render loop
 *
 * DEPENDENCIES: devAPI (electron-preload.js) for server auto-start
 */

(function () {

  window._splitScreenActive = false;
  window.getSplitScreenState = function () { return _state; };

  var _state = null;

  // ------- Start -------
  window.startSplitScreen = function (opts) {
    opts = opts || {};
    if (window._splitScreenActive) {
      window.stopSplitScreen();
    }

    var mapName = opts.mapName || '__default__';
    var roomId = 'ss_' + Date.now();

    _state = {
      activeIndex: 0,  // 0 = left (host), 1 = right (client)
      iframes: [],
      overlay: null,
      divider: null,
      indicator: null,
      roomId: roomId
    };

    // Ensure server is running, then create iframes
    ensureServerRunning(function () {
      if (!_state) return; // stopSplitScreen called during startup

      // Hide dev UI
      if (typeof hideGameModeUI === 'function') {
        hideGameModeUI();
      } else {
        var devSidebar = document.getElementById('devSidebar');
        if (devSidebar) devSidebar.classList.add('hidden');
      }

      // Hide the Three.js canvas
      var gc = document.getElementById('gameContainer');
      var threeCanvas = gc && gc.querySelector('canvas');
      if (threeCanvas) threeCanvas.style.display = 'none';

      // Build host URL
      var heroP1 = opts.heroP1 || '';
      var heroP2 = opts.heroP2 || '';
      var hostUrl = 'http://localhost:3000/?splitView=1&autoHost=' +
        encodeURIComponent(roomId) +
        '&map=' + encodeURIComponent(mapName) +
        '&hero=' + encodeURIComponent(heroP1) +
        '&rounds=2';

      // Build client URL (include map so client builds same arena)
      var clientUrl = 'http://localhost:3000/?splitView=1&autoJoin=' +
        encodeURIComponent(roomId) +
        '&map=' + encodeURIComponent(mapName) +
        '&hero=' + encodeURIComponent(heroP2);

      // Create left iframe (host) immediately
      var leftIframe = createIframe(hostUrl, false);
      _state.iframes.push(leftIframe);

      // Create right iframe (client) after delay so host can create room
      setTimeout(function () {
        if (!_state) return;
        var rightIframe = createIframe(clientUrl, true);
        _state.iframes.push(rightIframe);
        updateDimming();
      }, 2000);

      // Create overlay for input capture
      createOverlay();

      // Create viewport divider
      var divider = document.createElement('div');
      divider.id = 'ssViewportDivider';
      if (gc) gc.appendChild(divider);
      _state.divider = divider;

      // Create control indicator
      var indicator = document.getElementById('ssControlIndicator');
      if (indicator) {
        indicator.textContent = 'CONTROLLING P1';
        indicator.classList.remove('hidden');
      }
      _state.indicator = indicator;

      window._splitScreenActive = true;
      if (typeof window.resizeRenderer === 'function') window.resizeRenderer();
    });
  };

  // ------- Stop -------
  window.stopSplitScreen = function () {
    window._splitScreenActive = false;

    if (_state) {
      // Remove iframes
      _state.iframes.forEach(function (iframe) {
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      });

      // Remove overlay
      if (_state.overlay && _state.overlay.parentNode) {
        _state.overlay.parentNode.removeChild(_state.overlay);
      }

      // Remove divider
      if (_state.divider && _state.divider.parentNode) {
        _state.divider.parentNode.removeChild(_state.divider);
      }

      // Hide control indicator
      var indicator = document.getElementById('ssControlIndicator');
      if (indicator) indicator.classList.add('hidden');

      _state = null;
    }

    // Remove listeners
    document.removeEventListener('keydown', onOverlayKeyDown);
    document.removeEventListener('keyup', onOverlayKeyUp);
    window.removeEventListener('message', onIframeMessage);

    // Exit pointer lock
    try { document.exitPointerLock(); } catch (e) {}

    // Restore Three.js canvas
    var gc = document.getElementById('gameContainer');
    var threeCanvas = gc && gc.querySelector('canvas');
    if (threeCanvas) threeCanvas.style.display = '';

    // Restore sidebar (preserve collapsed state)
    var devSidebar = document.getElementById('devSidebar');
    if (devSidebar) {
      devSidebar.classList.remove('hidden');
      var sidebarExpandTab = document.getElementById('devSidebarExpand');
      if (sidebarExpandTab) sidebarExpandTab.classList.toggle('hidden', !devSidebar.classList.contains('collapsed'));
    }
    // Restore right panel and toolbar if hero editor was active
    if (typeof _activePanel !== 'undefined' && _activePanel === 'heroEditor') {
      var rightPanel = document.getElementById('devRightPanel');
      var toolbar = document.getElementById('heViewportToolbar');
      var rightExpandTab = document.getElementById('devRightPanelExpand');
      if (rightPanel) {
        rightPanel.classList.remove('hidden');
        if (rightExpandTab) rightExpandTab.classList.toggle('hidden', !rightPanel.classList.contains('collapsed'));
      }
      if (toolbar) toolbar.classList.remove('hidden');
    }
    if (typeof window.resizeRenderer === 'function') {
      setTimeout(window.resizeRenderer, 50);
    }
  };

  // ------- Server auto-start -------
  function ensureServerRunning(callback) {
    if (!window.devAPI) {
      callback();
      return;
    }

    var info = window.devAPI.serverStatus();
    if (info.status === 'running') {
      callback();
      return;
    }

    // Start server
    window.devAPI.serverStart();

    // Poll until running (up to 10s)
    var attempts = 0;
    var poll = setInterval(function () {
      attempts++;
      var s = window.devAPI.serverStatus();
      if (s.status === 'running') {
        clearInterval(poll);
        callback();
      } else if (attempts > 20 || s.status === 'error') {
        clearInterval(poll);
        console.warn('devSplitScreen: server failed to start:', s.error);
        callback(); // try anyway
      }
    }, 500);
  }

  // ------- Iframe creation -------
  function createIframe(url, isRight) {
    var iframe = document.createElement('iframe');
    iframe.className = 'ss-iframe' + (isRight ? ' ss-iframe-right' : '');
    iframe.src = url;
    iframe.setAttribute('allow', 'autoplay');

    var gc = document.getElementById('gameContainer');
    if (gc) gc.appendChild(iframe);
    return iframe;
  }

  // ------- Hero select passthrough -------
  // When an iframe shows hero select, disable overlay so clicks reach the iframe
  function onIframeMessage(evt) {
    if (!_state || !window._splitScreenActive) return;
    var d = evt.data;
    if (!d || !d.type) return;

    if (d.type === 'svHeroSelectOpen') {
      setOverlayPassthrough(true);
    } else if (d.type === 'svHeroSelectClosed') {
      setOverlayPassthrough(false);
    }
  }

  function setOverlayPassthrough(passthrough) {
    if (!_state || !_state.overlay) return;
    if (passthrough) {
      // Let clicks through to iframe, release pointer lock so cursor is visible
      _state.overlay.style.pointerEvents = 'none';
      try { document.exitPointerLock(); } catch (e) {}
    } else {
      // Re-capture input on overlay
      _state.overlay.style.pointerEvents = '';
      // User will click overlay to re-lock (automatic via click handler)
    }
  }

  // ------- Overlay for input capture -------
  function createOverlay() {
    var gc = document.getElementById('gameContainer');
    if (!gc) return;

    var overlay = document.createElement('div');
    overlay.id = 'ssInputOverlay';
    gc.appendChild(overlay);
    _state.overlay = overlay;

    // Listen for messages from iframes (hero select open/close)
    window.addEventListener('message', onIframeMessage);

    // Click to acquire pointer lock
    overlay.addEventListener('click', function () {
      overlay.requestPointerLock();
    });

    // Mouse move → forward to active iframe
    overlay.addEventListener('mousemove', function (e) {
      forwardToActive({ type: 'svMouseMove', movementX: e.movementX || 0, movementY: e.movementY || 0 });
    });

    // Mouse buttons
    overlay.addEventListener('mousedown', function (e) {
      if (e.button === 0) forwardToActive({ type: 'svMouseDown' });
    });
    overlay.addEventListener('mouseup', function (e) {
      if (e.button === 0) forwardToActive({ type: 'svMouseUp' });
    });

    // Keyboard — document-level only (pointer lock sends keys to document)
    document.addEventListener('keydown', onOverlayKeyDown);
    document.addEventListener('keyup', onOverlayKeyUp);
  }

  function onOverlayKeyDown(e) {
    if (!window._splitScreenActive || !_state) return;

    if (e.code === 'Tab') {
      e.preventDefault();
      switchActiveIframe();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      window.stopSplitScreen();
      // Update button states in panel
      var startBtn = document.getElementById('ssStart');
      var stopBtn = document.getElementById('ssStop');
      var status = document.getElementById('ssStatus');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      if (status) status.textContent = 'Stopped.';
      return;
    }

    // Forward game keys to active iframe
    forwardToActive({ type: 'svKeyDown', code: e.code, key: e.key });
  }

  function onOverlayKeyUp(e) {
    if (!window._splitScreenActive || !_state) return;
    forwardToActive({ type: 'svKeyUp', code: e.code, key: e.key });
  }

  // ------- Tab switch -------
  function switchActiveIframe() {
    if (!_state || _state.iframes.length < 2) return;

    // Send key-up for all tracked keys to the old active iframe (prevent stuck keys)
    var oldIframe = _state.iframes[_state.activeIndex];
    if (oldIframe && oldIframe.contentWindow) {
      oldIframe.contentWindow.postMessage({ type: 'svResetKeys' }, '*');
    }

    // Switch
    _state.activeIndex = _state.activeIndex === 0 ? 1 : 0;

    // Update indicator
    var indicator = document.getElementById('ssControlIndicator');
    if (indicator) {
      indicator.textContent = 'CONTROLLING P' + (_state.activeIndex + 1);
    }

    updateDimming();
  }

  function updateDimming() {
    if (!_state) return;
    _state.iframes.forEach(function (iframe, i) {
      if (!iframe) return;
      iframe.classList.toggle('ss-iframe-inactive', i !== _state.activeIndex);
    });
  }

  // ------- Forward message to active iframe -------
  function forwardToActive(msg) {
    if (!_state) return;
    var iframe = _state.iframes[_state.activeIndex];
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(msg, '*');
    }
  }

})();
