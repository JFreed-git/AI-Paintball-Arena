/**
 * ffaScoreboard.js — FFA scoreboard overlay and post-match results
 *
 * PURPOSE: Populates the scoreboard overlay (Tab key), kill feed updates,
 *          and post-match results screen with live FFA game data.
 * EXPORTS (window): updateFFAScoreboard, showPostMatchResults, clearFFAScoreboard
 * DEPENDENCIES: modeFFA.js (getFFAState), heroes.js (getHeroById),
 *               menuNavigation.js (showOnlyMenu, setHUDVisible)
 */

(function () {
  var SCOREBOARD_UPDATE_INTERVAL = 1000; // 1Hz periodic update
  var _updateTimer = 0;

  function getHeroName(heroId) {
    if (!heroId) return '—';
    var hero = (typeof window.getHeroById === 'function') ? window.getHeroById(heroId) : null;
    return hero ? hero.name : heroId;
  }

  function getPlayerDisplayName(id, entry) {
    if (!entry) return 'Player ' + (id || '').substring(0, 4);
    var prefix = entry.isAI ? '[AI] ' : '';
    // Use entry.name if available (from server player list), otherwise short ID
    if (entry.name) return prefix + entry.name;
    return prefix + 'Player ' + (id || '').substring(0, 4);
  }

  function buildSortedScoreList() {
    var state = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    if (!state || !state.match || !state.match.scores) return [];

    var entries = [];
    var scores = state.match.scores;
    var players = state.players || {};

    for (var id in scores) {
      var s = scores[id];
      var pEntry = players[id] || {};
      entries.push({
        id: id,
        name: getPlayerDisplayName(id, pEntry),
        heroId: pEntry.heroId || 'marksman',
        kills: s.kills || 0,
        deaths: s.deaths || 0,
        score: (s.kills || 0) * 100 - (s.deaths || 0) * 25,
        isLocal: (id === state.localId),
        isAI: !!pEntry.isAI
      });
    }

    // Sort: kills desc, then deaths asc
    entries.sort(function (a, b) {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    return entries;
  }

  function renderRows(container, entries) {
    if (!container) return;
    container.innerHTML = '';

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var row = document.createElement('div');
      row.className = 'scoreboard-row' + (e.isLocal ? ' sb-local' : '');

      row.innerHTML =
        '<span class="sb-rank">' + (i + 1) + '</span>' +
        '<span class="sb-player">' + escapeHTML(e.name) + '</span>' +
        '<span class="sb-hero">' + escapeHTML(getHeroName(e.heroId)) + '</span>' +
        '<span class="sb-kills">' + e.kills + '</span>' +
        '<span class="sb-deaths">' + e.deaths + '</span>' +
        '<span class="sb-score">' + e.score + '</span>';

      container.appendChild(row);
    }
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ── Public: update in-game scoreboard ──

  window.updateFFAScoreboard = function () {
    var rows = document.getElementById('scoreboardRows');
    if (!rows) return;
    var entries = buildSortedScoreList();
    renderRows(rows, entries);
  };

  // ── Public: show post-match results ──

  window.showPostMatchResults = function (winnerId) {
    var state = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    var entries = buildSortedScoreList();

    // Winner name
    var winnerEl = document.getElementById('postMatchWinner');
    if (winnerEl) {
      var winnerName = 'Unknown';
      if (entries.length > 0) {
        winnerName = entries[0].name; // top scorer
      }
      if (winnerId && state && winnerId === state.localId) {
        winnerName = 'You';
      } else if (winnerId) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].id === winnerId) {
            winnerName = entries[i].name;
            break;
          }
        }
      }
      winnerEl.textContent = winnerName + ' wins!';
    }

    // Populate final scoreboard
    var postRows = document.getElementById('postMatchRows');
    renderRows(postRows, entries);

    // Show the results screen
    if (typeof showOnlyMenu === 'function') showOnlyMenu('postMatchResults');
    if (typeof setHUDVisible === 'function') setHUDVisible(false);
  };

  // ── Public: clear scoreboard state ──

  window.clearFFAScoreboard = function () {
    stopPeriodicUpdate();
    var rows = document.getElementById('scoreboardRows');
    if (rows) rows.innerHTML = '';
    var postRows = document.getElementById('postMatchRows');
    if (postRows) postRows.innerHTML = '';
  };

  // ── Periodic update (1Hz while FFA active) ──

  function startPeriodicUpdate() {
    stopPeriodicUpdate();
    _updateTimer = setInterval(function () {
      if (!window.ffaActive) { stopPeriodicUpdate(); return; }
      window.updateFFAScoreboard();
    }, SCOREBOARD_UPDATE_INTERVAL);
  }

  function stopPeriodicUpdate() {
    if (_updateTimer) { clearInterval(_updateTimer); _updateTimer = 0; }
  }

  // Watch for FFA mode activation to start periodic updates
  var _wasActive = false;
  function checkFFAActive() {
    if (window.ffaActive && !_wasActive) {
      _wasActive = true;
      startPeriodicUpdate();
    } else if (!window.ffaActive && _wasActive) {
      _wasActive = false;
      stopPeriodicUpdate();
    }
  }
  setInterval(checkFFAActive, 500);

  // ── Post-match button wiring ──

  document.addEventListener('DOMContentLoaded', function () {
    var toMenu = document.getElementById('postMatchToMenu');
    if (toMenu) {
      toMenu.addEventListener('click', function () {
        if (typeof window.stopFFAInternal === 'function') {
          try { window.stopFFAInternal(); } catch (e) {}
        }
        if (typeof window.clearFFAScoreboard === 'function') window.clearFFAScoreboard();
        if (typeof showOnlyMenu === 'function') showOnlyMenu('mainMenu');
        if (typeof setHUDVisible === 'function') setHUDVisible(false);
      });
    }

    var toLobby = document.getElementById('postMatchToLobby');
    if (toLobby) {
      toLobby.addEventListener('click', function () {
        // Return to lobby (keep room alive)
        if (typeof showOnlyMenu === 'function') showOnlyMenu('lobbyMenu');
        if (typeof setHUDVisible === 'function') setHUDVisible(false);
      });
    }
  });
})();
