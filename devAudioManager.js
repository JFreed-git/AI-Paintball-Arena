/**
 * devAudioManager.js — Audio Manager workbench panel
 *
 * PURPOSE: Hero sound assignment UI. Assign .wav/.mp3 files to sound events
 * per hero. Renders hero list and sound slot detail views into #amContent.
 *
 * DEPENDENCIES: audio.js (loadHeroSoundsFromServer, getHeroSoundMap),
 *               heroes.js (loadHeroesFromServer), devApp.js (fetch shim)
 */

(function () {

  var _heroSoundMap = {};     // hero_sounds.json data
  var _heroList = [];         // [{id, name, color}]
  var _currentHeroId = null;  // null = hero list view, string = detail view

  // Per-hero events
  var HERO_EVENTS = ['weapon_fire', 'reload_start', 'reload_end', 'melee_swing', 'melee_hit', 'footstep', 'jump', 'land'];
  // Global-only events
  var GLOBAL_EVENTS = ['hit_marker', 'damage_taken', 'elimination', 'dry_fire'];

  // Visual categories
  var CATEGORIES = [
    { name: 'Weapon', events: ['weapon_fire', 'reload_start', 'reload_end'] },
    { name: 'Melee', events: ['melee_swing', 'melee_hit'] },
    { name: 'Movement', events: ['footstep', 'jump', 'land'] },
    { name: 'Combat', events: ['hit_marker', 'damage_taken', 'elimination'], globalOnly: true },
    { name: 'Other', events: ['dry_fire'], globalOnly: true }
  ];

  // --- Data loading ---

  function loadData(cb) {
    var done = 0;
    var total = 2;

    function check() { if (++done >= total && cb) cb(); }

    // Load hero sounds mapping
    fetch('/api/hero-sounds').then(function (r) { return r.json(); }).then(function (data) {
      _heroSoundMap = (data && typeof data === 'object') ? data : {};
      check();
    }).catch(function () { _heroSoundMap = {}; check(); });

    // Load heroes list
    fetch('/api/heroes').then(function (r) { return r.json(); }).then(function (names) {
      if (!Array.isArray(names)) { check(); return; }
      var promises = names.map(function (name) {
        return fetch('/api/heroes/' + encodeURIComponent(name)).then(function (r) { return r.json(); });
      });
      return Promise.all(promises).then(function (heroes) {
        _heroList = heroes.filter(function (h) { return h && h.id; }).map(function (h) {
          return { id: h.id, name: h.name || h.id, color: h.color || 0x888888 };
        });
        check();
      });
    }).catch(function () { _heroList = []; check(); });
  }

  function saveHeroSounds(cb) {
    fetch('/api/hero-sounds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_heroSoundMap)
    }).then(function () {
      // Refresh game audio's hero sound map
      if (typeof loadHeroSoundsFromServer === 'function') loadHeroSoundsFromServer();
      if (cb) cb();
    }).catch(function (e) {
      console.warn('Failed to save hero sounds:', e);
      if (cb) cb();
    });
  }

  // --- Helpers ---

  function colorToHex(c) {
    if (typeof c === 'number') return '#' + c.toString(16).padStart(6, '0');
    return '#888888';
  }

  function countAssigned(heroId) {
    var map = _heroSoundMap[heroId];
    if (!map) return 0;
    var events = heroId === 'global' ? GLOBAL_EVENTS : HERO_EVENTS;
    var count = 0;
    for (var i = 0; i < events.length; i++) {
      if (map[events[i]] && map[events[i]].file) count++;
    }
    return count;
  }

  function totalEvents(heroId) {
    return heroId === 'global' ? GLOBAL_EVENTS.length : HERO_EVENTS.length;
  }

  function formatEventName(evt) {
    return evt.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // --- Render: Hero List ---

  function renderHeroList() {
    var container = document.getElementById('amContent');
    if (!container) return;

    var html = '<div class="am-hero-grid gallery-grid">';

    // Global card
    var gCount = countAssigned('global');
    var gTotal = totalEvents('global');
    html += '<div class="am-hero-card gallery-card" data-hero-id="global">' +
      '<div class="am-hero-card-accent" style="background:#888"></div>' +
      '<div class="am-hero-card-body">' +
      '<div class="am-hero-card-name">Global</div>' +
      '<div class="am-hero-card-count">' + gCount + '/' + gTotal + '</div>' +
      '</div></div>';

    // Hero cards
    for (var i = 0; i < _heroList.length; i++) {
      var hero = _heroList[i];
      var hCount = countAssigned(hero.id);
      var hTotal = totalEvents(hero.id);
      var color = colorToHex(hero.color);
      html += '<div class="am-hero-card gallery-card" data-hero-id="' + hero.id + '">' +
        '<div class="am-hero-card-accent" style="background:' + color + '"></div>' +
        '<div class="am-hero-card-body">' +
        '<div class="am-hero-card-name">' + hero.name + '</div>' +
        '<div class="am-hero-card-count">' + hCount + '/' + hTotal + '</div>' +
        '</div></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Wire click events
    var cards = container.querySelectorAll('.am-hero-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        _currentHeroId = card.getAttribute('data-hero-id');
        renderHeroDetail(_currentHeroId);
      });
    });
  }

  // --- Render: Hero Detail ---

  function renderHeroDetail(heroId) {
    var container = document.getElementById('amContent');
    if (!container) return;

    var isGlobal = (heroId === 'global');
    var heroInfo = null;
    if (!isGlobal) {
      for (var i = 0; i < _heroList.length; i++) {
        if (_heroList[i].id === heroId) { heroInfo = _heroList[i]; break; }
      }
    }

    var color = isGlobal ? '#888' : (heroInfo ? colorToHex(heroInfo.color) : '#888');
    var name = isGlobal ? 'Global' : (heroInfo ? heroInfo.name : heroId);

    if (!_heroSoundMap[heroId]) _heroSoundMap[heroId] = {};

    var html = '<div class="am-detail">';
    html += '<button class="am-back-btn">&larr; Back</button>';
    html += '<div class="am-hero-header"><span class="am-color-dot" style="background:' + color + '"></span> ' + name + '</div>';

    // Build categories
    for (var c = 0; c < CATEGORIES.length; c++) {
      var cat = CATEGORIES[c];
      if (cat.globalOnly && !isGlobal) continue;
      if (!isGlobal && cat.globalOnly) continue;

      // Filter events for this hero type
      var events = [];
      for (var e = 0; e < cat.events.length; e++) {
        var evt = cat.events[e];
        if (isGlobal && GLOBAL_EVENTS.indexOf(evt) !== -1) events.push(evt);
        if (!isGlobal && HERO_EVENTS.indexOf(evt) !== -1) events.push(evt);
      }
      if (events.length === 0) continue;

      html += '<div class="am-category">';
      html += '<div class="am-category-title">' + cat.name + '</div>';

      for (var j = 0; j < events.length; j++) {
        var eventName = events[j];
        var mapping = _heroSoundMap[heroId][eventName];
        var hasFile = mapping && mapping.file;
        var filename = hasFile ? mapping.file : '';
        var volume = hasFile ? (mapping.volume || 0.8) : 0.8;

        html += '<div class="am-slot" data-event="' + eventName + '">';
        html += '<div class="am-slot-name">' + formatEventName(eventName) + '</div>';
        html += '<div class="am-slot-file">' + (filename || '<span class="am-no-file">No file</span>') + '</div>';
        html += '<div class="am-slot-volume"><input type="range" min="0" max="1" step="0.05" value="' + volume + '" class="am-vol-slider"' + (hasFile ? '' : ' disabled') + ' /></div>';
        html += '<div class="am-slot-actions">';
        html += '<button class="am-slot-btn am-play-btn" title="Play"' + (hasFile ? '' : ' disabled') + '>&#9654;</button>';
        html += '<button class="am-slot-btn am-remove-btn" title="Remove"' + (hasFile ? '' : ' disabled') + '>&times;</button>';
        html += '<button class="am-slot-btn am-upload-btn" title="Upload">&#8593;</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Wire events
    container.querySelector('.am-back-btn').addEventListener('click', function () {
      _currentHeroId = null;
      renderHeroList();
    });

    var slots = container.querySelectorAll('.am-slot');
    slots.forEach(function (slot) {
      var eventName = slot.getAttribute('data-event');

      // Volume slider
      var slider = slot.querySelector('.am-vol-slider');
      slider.addEventListener('input', function () {
        if (_heroSoundMap[heroId] && _heroSoundMap[heroId][eventName] && _heroSoundMap[heroId][eventName].file) {
          _heroSoundMap[heroId][eventName].volume = parseFloat(slider.value);
          saveHeroSounds();
        }
      });

      // Play button
      slot.querySelector('.am-play-btn').addEventListener('click', function () {
        var mapping = _heroSoundMap[heroId] && _heroSoundMap[heroId][eventName];
        if (mapping && mapping.file) {
          var audio = new Audio('sounds/files/' + mapping.file);
          audio.volume = mapping.volume || 0.8;
          audio.play().catch(function () {});
        }
      });

      // Remove button
      slot.querySelector('.am-remove-btn').addEventListener('click', function () {
        if (_heroSoundMap[heroId]) {
          _heroSoundMap[heroId][eventName] = null;
          saveHeroSounds(function () {
            renderHeroDetail(heroId);
          });
        }
      });

      // Upload button
      slot.querySelector('.am-upload-btn').addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.wav,.mp3';
        input.addEventListener('change', function () {
          if (!input.files || !input.files[0]) return;
          var file = input.files[0];
          var filename = file.name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
          if (!/\.(wav|mp3)$/i.test(filename)) return;

          var reader = new FileReader();
          reader.onload = function () {
            // Strip data URL prefix to get base64
            var base64 = reader.result.split(',')[1];
            fetch('/api/sound-files/' + encodeURIComponent(filename), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: base64 })
            }).then(function (r) { return r.json(); }).then(function () {
              // Update mapping
              if (!_heroSoundMap[heroId]) _heroSoundMap[heroId] = {};
              _heroSoundMap[heroId][eventName] = {
                file: filename,
                volume: parseFloat(slider.value) || 0.8
              };
              saveHeroSounds(function () {
                renderHeroDetail(heroId);
              });
            }).catch(function (e) {
              console.warn('Failed to upload sound file:', e);
            });
          };
          reader.readAsDataURL(file);
        });
        input.click();
      });
    });
  }

  // --- Public API ---

  window._initAudioManager = function () {
    loadData(function () {
      if (_currentHeroId) {
        renderHeroDetail(_currentHeroId);
      } else {
        renderHeroList();
      }
    });
  };

  window._closeAudioManager = function () {
    // No animation frames to cancel in new UI
  };

})();
