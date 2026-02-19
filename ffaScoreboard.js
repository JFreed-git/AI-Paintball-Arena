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

  var TEAM_NAMES = ['Team 1', 'Team 2'];
  var TEAM_CSS_CLASSES = ['team-1', 'team-2'];

  function getTeamDisplayName(team) {
    if (!team) return '';
    return TEAM_NAMES[(team - 1) % TEAM_NAMES.length] || ('Team ' + team);
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
        isAI: !!pEntry.isAI,
        team: pEntry.team || 0
      });
    }

    // Sort: team asc, then kills desc, then deaths asc
    entries.sort(function (a, b) {
      if (a.team !== b.team) return (a.team || 99) - (b.team || 99);
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    return entries;
  }

  function renderRows(container, entries) {
    if (!container) return;
    container.innerHTML = '';

    var lastTeam = -1;
    var rankInTeam = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];

      // Insert team divider header when team changes
      if (e.team && e.team !== lastTeam) {
        lastTeam = e.team;
        rankInTeam = 0;
        var divider = document.createElement('div');
        divider.className = 'scoreboard-team-divider ' + (TEAM_CSS_CLASSES[(e.team - 1) % TEAM_CSS_CLASSES.length] || '');
        divider.textContent = getTeamDisplayName(e.team);
        container.appendChild(divider);
      }
      rankInTeam++;

      var row = document.createElement('div');
      var teamClass = e.team ? (' ' + (TEAM_CSS_CLASSES[(e.team - 1) % TEAM_CSS_CLASSES.length] || '')) : '';
      row.className = 'scoreboard-row' + (e.isLocal ? ' sb-local' : '') + teamClass;

      row.innerHTML =
        '<span class="sb-rank">' + rankInTeam + '</span>' +
        '<span class="sb-player">' + escapeHTML(e.name) + '</span>' +
        '<span class="sb-hero">' + escapeHTML(getHeroName(e.heroId)) + '</span>' +
        '<span class="sb-kills">' + e.kills + '</span>' +
        '<span class="sb-deaths">' + e.deaths + '</span>' +
        '<span class="sb-score">' + e.score + '</span>';

      container.appendChild(row);
    }
  }

  // escapeHTML is defined on window by modeFFA.js (loaded before this file)
  var escapeHTML = window.escapeHTML;

  // ── Public: update in-game scoreboard ──

  window.updateFFAScoreboard = function () {
    var rows = document.getElementById('scoreboardRows');
    if (!rows) return;
    var entries = buildSortedScoreList();
    renderRows(rows, entries);

    // Show room ID if in a lobby/game with a room
    var roomIdEl = document.getElementById('scoreboardRoomId');
    if (roomIdEl) {
      var roomId = window._lobbyState && window._lobbyState.roomId;
      roomIdEl.textContent = roomId ? 'Room: ' + roomId : '';
    }
  };

  // ── Public: show post-match results ──

  window.showPostMatchResults = function (winnerId, winningTeam) {
    var state = (typeof window.getFFAState === 'function') ? window.getFFAState() : null;
    var entries = buildSortedScoreList();

    // Header text
    var headerEl = document.getElementById('postMatchHeader');
    if (headerEl) headerEl.textContent = 'Match Over';

    // Winner name — show team winner if available
    var winnerEl = document.getElementById('postMatchWinner');
    if (winnerEl) {
      if (winningTeam) {
        var teamName = getTeamDisplayName(winningTeam);
        // Calculate team total kills for display
        var teamKills = 0;
        for (var k = 0; k < entries.length; k++) {
          if (entries[k].team === winningTeam) teamKills += entries[k].kills;
        }
        winnerEl.textContent = teamName + ' wins!  (' + teamKills + ' total kills)';
        winnerEl.className = 'post-match-winner ' + (TEAM_CSS_CLASSES[(winningTeam - 1) % TEAM_CSS_CLASSES.length] || '');
      } else {
        var winnerName = 'Unknown';
        if (entries.length > 0) winnerName = entries[0].name;
        if (winnerId && state && winnerId === state.localId) {
          winnerName = 'You';
        } else if (winnerId) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].id === winnerId) { winnerName = entries[i].name; break; }
          }
        }
        winnerEl.textContent = winnerName + ' wins!';
        winnerEl.className = 'post-match-winner';
      }
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

  // Start/stop scoreboard polling when FFA mode activates/deactivates
  var _pollTimer = 0;

  window.startFFAScoreboardPolling = function () {
    stopFFAScoreboardPolling();
    startPeriodicUpdate();
  };

  function stopFFAScoreboardPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = 0; }
    stopPeriodicUpdate();
  }
  window.stopFFAScoreboardPolling = stopFFAScoreboardPolling;

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
