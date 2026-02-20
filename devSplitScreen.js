/**
 * devSplitScreen.js — Split-screen mode: two independent browser windows
 *
 * PURPOSE: Two iframes side by side, each loading localhost:3000/?splitView=1
 * as a fully independent game client starting at the main menu. The user hosts
 * a lobby from one window and joins from the other. A transparent overlay
 * captures pointer lock and forwards input to the active iframe via postMessage.
 * Tab switches control between windows.
 *
 * Two states:
 *   Menu mode (no pointer lock): overlay is pointer-events:none so clicks
 *     reach iframes directly. Control bar shows "Click to lock cursor".
 *   Play mode (pointer lock active): overlay captures all input and forwards
 *     to active iframe. Tab switches. ESC releases lock → back to menu mode.
 *
 * EXPORTS (window):
 *   startSplitScreen()    — start split-screen
 *   stopSplitScreen()     — tear down split-screen
 *   _splitScreenActive    — boolean flag checked by devApp.js render loop
 *
 * DEPENDENCIES: devAPI (electron-preload.js) for server auto-start
 */

(function () {

  window._splitScreenActive = false;
  window.getSplitScreenState = function () { return _state; };

  var _state = null;

  // ------- Start -------
  window.startSplitScreen = function () {
    if (window._splitScreenActive) {
      window.stopSplitScreen();
    }

    _state = {
      activeIndex: 0,  // 0 = left, 1 = right
      iframes: [],
      overlay: null,
      divider: null,
      controlBar: null,
      locked: false
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

      // Both iframes load the same URL — each starts at the main menu
      var iframeUrl = 'http://localhost:3000/?splitView=1';

      // Create left iframe
      var leftIframe = createIframe(iframeUrl, false);
      _state.iframes.push(leftIframe);

      // Create right iframe
      var rightIframe = createIframe(iframeUrl, true);
      _state.iframes.push(rightIframe);

      // Create overlay (starts as pass-through, blocks clicks when locked)
      createOverlay();

      // Create viewport divider
      var divider = document.createElement('div');
      divider.id = 'ssViewportDivider';
      if (gc) gc.appendChild(divider);
      _state.divider = divider;

      // Create control bar
      createControlBar();

      // Listen for iframe messages
      window.addEventListener('message', onIframeMessage);

      // Document-level input listeners (pointer lock dispatches events to document)
      document.addEventListener('keydown', onOverlayKeyDown);
      document.addEventListener('keyup', onOverlayKeyUp);
      document.addEventListener('mousemove', onDocMouseMove);
      document.addEventListener('mousedown', onDocMouseDown);
      document.addEventListener('mouseup', onDocMouseUp);

      // Pointer lock change + error handlers
      document.addEventListener('pointerlockchange', onPointerLockChange);
      document.addEventListener('pointerlockerror', onPointerLockError);

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

      // Remove control bar
      if (_state.controlBar && _state.controlBar.parentNode) {
        _state.controlBar.parentNode.removeChild(_state.controlBar);
      }

      _state = null;
    }

    // Remove listeners
    document.removeEventListener('keydown', onOverlayKeyDown);
    document.removeEventListener('keyup', onOverlayKeyUp);
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('mouseup', onDocMouseUp);
    document.removeEventListener('pointerlockchange', onPointerLockChange);
    document.removeEventListener('pointerlockerror', onPointerLockError);
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

    // Update button states in panel
    var startBtn = document.getElementById('ssStart');
    var stopBtn = document.getElementById('ssStop');
    var status = document.getElementById('ssStatus');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (status) status.textContent = 'Stopped.';
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

  // ------- Control bar -------
  function createControlBar() {
    var gc = document.getElementById('gameContainer');
    if (!gc) return;

    var bar = document.createElement('div');
    bar.className = 'ss-control-bar';

    var textSpan = document.createElement('span');
    textSpan.className = 'ss-control-bar-text';
    textSpan.textContent = 'Click to lock cursor';
    bar.appendChild(textSpan);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'ss-control-bar-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Stop split screen';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.stopSplitScreen();
    });
    bar.appendChild(closeBtn);

    // Clicking the bar text acquires pointer lock
    bar.addEventListener('click', function (e) {
      if (e.target === closeBtn) return;
      requestLock();
    });

    gc.appendChild(bar);
    _state.controlBar = bar;
  }

  function updateControlBarText(text) {
    if (!_state || !_state.controlBar) return;
    var textSpan = _state.controlBar.querySelector('.ss-control-bar-text');
    if (textSpan) textSpan.textContent = text;
  }

  // ------- Pointer lock request -------
  function requestLock() {
    // Try the overlay first (mouse events dispatch to locked element)
    var target = _state && _state.overlay;
    if (!target) target = document.getElementById('gameContainer');
    if (!target) return;

    try {
      var result = target.requestPointerLock();
      // Modern browsers return a Promise
      if (result && typeof result.catch === 'function') {
        result.catch(function (err) {
          console.warn('devSplitScreen: pointer lock denied on overlay, trying body:', err);
          // Fallback: try document.body
          try {
            document.body.requestPointerLock();
          } catch (e2) {
            console.warn('devSplitScreen: pointer lock failed on body:', e2);
          }
        });
      }
    } catch (e) {
      console.warn('devSplitScreen: requestPointerLock error:', e);
    }
  }

  // ------- Overlay -------
  function createOverlay() {
    var gc = document.getElementById('gameContainer');
    if (!gc) return;

    var overlay = document.createElement('div');
    overlay.id = 'ssInputOverlay';
    // Start in menu mode — clicks pass through to iframes
    overlay.style.pointerEvents = 'none';
    gc.appendChild(overlay);
    _state.overlay = overlay;

    // Click overlay to re-lock (when it has pointer-events in play mode)
    overlay.addEventListener('click', function () {
      requestLock();
    });
  }

  // ------- Document-level mouse handlers -------
  function onDocMouseMove(e) {
    if (!_state || !_state.locked) return;
    forwardToActive({ type: 'svMouseMove', movementX: e.movementX || 0, movementY: e.movementY || 0 });
  }

  function onDocMouseDown(e) {
    if (!_state || !_state.locked) return;
    if (e.button === 0) forwardToActive({ type: 'svMouseDown' });
  }

  function onDocMouseUp(e) {
    if (!_state || !_state.locked) return;
    if (e.button === 0) forwardToActive({ type: 'svMouseUp' });
  }

  // ------- Pointer lock change -------
  function onPointerLockChange() {
    if (!_state) return;

    var locked = !!document.pointerLockElement;
    _state.locked = locked;

    var overlay = _state.overlay;

    if (locked) {
      // Play mode: overlay blocks clicks to iframes
      if (overlay) {
        overlay.style.pointerEvents = '';
        overlay.style.cursor = 'none';
      }
      updateControlBarText('CONTROLLING P' + (_state.activeIndex + 1) + ' \u2014 1 to switch');
      updateDimming();
    } else {
      // Menu mode: overlay is pass-through, user clicks directly in iframes
      if (overlay) {
        overlay.style.pointerEvents = 'none';
        overlay.style.cursor = '';
      }
      updateControlBarText('Click to lock cursor');
      // Clear dimming — both iframes fully visible in menu mode
      clearDimming();
      // Reset keys on the active iframe so nothing sticks
      var activeIframe = _state.iframes[_state.activeIndex];
      if (activeIframe && activeIframe.contentWindow) {
        activeIframe.contentWindow.postMessage({ type: 'svResetKeys' }, '*');
      }
    }
  }

  function onPointerLockError() {
    console.warn('devSplitScreen: pointerlockerror — lock request was denied');
    if (_state) updateControlBarText('Lock failed — click to retry');
  }

  // ------- Iframe messages (hero select passthrough) -------
  function onIframeMessage(evt) {
    if (!_state || !window._splitScreenActive) return;
    var d = evt.data;
    if (!d || !d.type) return;

    if (d.type === 'svHeroSelectOpen') {
      // Release pointer lock so user can click hero cards in the iframe
      try { document.exitPointerLock(); } catch (e) {}
      updateControlBarText('Click to resume');
    } else if (d.type === 'svHeroSelectClosed') {
      updateControlBarText('Click to resume');
    } else if (d.type === 'svEscape') {
      // ESC pressed inside an iframe while cursor not locked — stop split screen
      if (!_state.locked) {
        window.stopSplitScreen();
      }
    }
  }

  // ------- Keyboard handlers -------
  function onOverlayKeyDown(e) {
    if (!window._splitScreenActive || !_state) return;

    // Only handle keys when pointer is locked (play mode)
    if (_state.locked) {
      if (e.code === 'Digit1') {
        e.preventDefault();
        switchActiveIframe();
        return;
      }

      if (e.key === 'Escape') {
        // ESC while locked → browser releases pointer lock automatically
        e.preventDefault();
        return;
      }

      // Forward game keys to active iframe
      forwardToActive({ type: 'svKeyDown', code: e.code, key: e.key });
      return;
    }

    // Menu mode (not locked): ESC stops split screen
    if (e.key === 'Escape') {
      e.preventDefault();
      window.stopSplitScreen();
    }
  }

  function onOverlayKeyUp(e) {
    if (!window._splitScreenActive || !_state) return;
    if (!_state.locked) return;
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

    // Update control bar
    updateControlBarText('CONTROLLING P' + (_state.activeIndex + 1) + ' \u2014 1 to switch');

    updateDimming();
  }

  function updateDimming() {
    if (!_state) return;
    _state.iframes.forEach(function (iframe, i) {
      if (!iframe) return;
      iframe.classList.toggle('ss-iframe-inactive', i !== _state.activeIndex);
    });
  }

  function clearDimming() {
    if (!_state) return;
    _state.iframes.forEach(function (iframe) {
      if (!iframe) return;
      iframe.classList.remove('ss-iframe-inactive');
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
