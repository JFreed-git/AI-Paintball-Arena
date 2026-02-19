/**
 * devAudioManager.js — Audio Manager workbench panel
 *
 * PURPOSE: CRUD editor for sound definitions (sounds/*.json). Features a viewport
 * sound library table, envelope/waveform visualization canvas, and sidebar editor
 * with duplicate/randomize buttons.
 *
 * DEPENDENCIES: audio.js (playRawSound, loadSoundsFromServer, getSoundRegistry,
 *               getAudioAnalyser), devApp.js (fetch shim for /api/sounds)
 */

(function () {

  var _currentSoundId = null;
  var _soundList = [];       // array of sound names (filenames)
  var _soundCache = {};      // name → full sound data
  var _isPlaying = false;
  var _waveformAnimFrame = 0;
  var _expandedGroups = {};    // groupKey → boolean

  // --- DOM refs ---
  var _elName, _elId, _elType;
  var _elFrequency, _elFilterType, _elFilterQ, _elDuration, _elVolume, _elAttack, _elDecay;
  var _elWaveform, _elStartFreq, _elEndFreq, _elNoiseAmount;
  var _elNotes;
  var _elBindingsList, _elAddBinding;
  var _elPlayBtn, _elSaveBtn, _elNewBtn, _elDeleteBtn, _elDuplicateBtn, _elRandomizeBtn;

  // New synth type DOM refs
  var _elCarrierFreq, _elCarrierWaveform, _elModFreq, _elModDepth, _elModWaveform;
  var _elPluckFreq, _elPluckDamping;
  var _elFOscFreq, _elFOscFilterType, _elFOscFilterFreq, _elFOscFilterEnd, _elFOscFilterQ;
  var _elImpactBodyFreq, _elImpactBodyDecay, _elImpactNoiseFreq, _elImpactNoiseFilterType;
  var _elImpactNoiseQ, _elImpactNoiseDur, _elImpactMix;

  // Synthesis type param sections
  var _secNoiseBurst, _secSweep, _secMultiTone, _secWaveform;
  var _secFM, _secPluck, _secFilteredOsc, _secImpact;

  // Viewport refs
  var _elSoundTable, _elEnvelopeCanvas, _elWaveformCanvas;
  var _envelopeCtx, _waveformCtx;

  // Event types with available filters
  var EVENT_TYPES = [
    { value: 'weapon_fire', label: 'weapon_fire', filters: ['weaponModelType', 'heroId'] },
    { value: 'reload_start', label: 'reload_start', filters: ['heroId'] },
    { value: 'reload_end', label: 'reload_end', filters: ['heroId'] },
    { value: 'melee_swing', label: 'melee_swing', filters: ['heroId'] },
    { value: 'melee_hit', label: 'melee_hit', filters: ['heroId'] },
    { value: 'footstep', label: 'footstep', filters: ['heroId', 'sprinting'] },
    { value: 'jump', label: 'jump', filters: ['heroId'] },
    { value: 'land', label: 'land', filters: ['heroId'] },
    { value: 'hit_marker', label: 'hit_marker', filters: [] },
    { value: 'damage_taken', label: 'damage_taken', filters: [] },
    { value: 'elimination', label: 'elimination', filters: [] },
    { value: 'ui_click', label: 'ui_click', filters: [] }
  ];

  function init() {
    _elName = document.getElementById('amName');
    _elId = document.getElementById('amId');
    _elType = document.getElementById('amType');
    _elFrequency = document.getElementById('amFrequency');
    _elFilterType = document.getElementById('amFilterType');
    _elFilterQ = document.getElementById('amFilterQ');
    _elDuration = document.getElementById('amDuration');
    _elVolume = document.getElementById('amVolume');
    _elAttack = document.getElementById('amAttack');
    _elDecay = document.getElementById('amDecay');
    _elWaveform = document.getElementById('amWaveform');
    _elStartFreq = document.getElementById('amStartFreq');
    _elEndFreq = document.getElementById('amEndFreq');
    _elNoiseAmount = document.getElementById('amNoiseAmount');
    _elNotes = document.getElementById('amNotes');
    _elBindingsList = document.getElementById('amBindingsList');
    _elAddBinding = document.getElementById('amAddBinding');
    _elPlayBtn = document.getElementById('amPlay');
    _elSaveBtn = document.getElementById('amSave');
    _elNewBtn = document.getElementById('amNew');
    _elDeleteBtn = document.getElementById('amDelete');
    _elDuplicateBtn = document.getElementById('amDuplicate');
    _elRandomizeBtn = document.getElementById('amRandomize');

    _secNoiseBurst = document.getElementById('amSecNoiseBurst');
    _secSweep = document.getElementById('amSecSweep');
    _secMultiTone = document.getElementById('amSecMultiTone');
    _secWaveform = document.getElementById('amSecWaveform');
    _secFM = document.getElementById('amSecFM');
    _secPluck = document.getElementById('amSecPluck');
    _secFilteredOsc = document.getElementById('amSecFilteredOsc');
    _secImpact = document.getElementById('amSecImpact');

    // FM refs
    _elCarrierFreq = document.getElementById('amCarrierFreq');
    _elCarrierWaveform = document.getElementById('amCarrierWaveform');
    _elModFreq = document.getElementById('amModFreq');
    _elModDepth = document.getElementById('amModDepth');
    _elModWaveform = document.getElementById('amModWaveform');

    // Pluck refs
    _elPluckFreq = document.getElementById('amPluckFreq');
    _elPluckDamping = document.getElementById('amPluckDamping');

    // Filtered osc refs
    _elFOscFreq = document.getElementById('amFOscFreq');
    _elFOscFilterType = document.getElementById('amFOscFilterType');
    _elFOscFilterFreq = document.getElementById('amFOscFilterFreq');
    _elFOscFilterEnd = document.getElementById('amFOscFilterEnd');
    _elFOscFilterQ = document.getElementById('amFOscFilterQ');

    // Impact refs
    _elImpactBodyFreq = document.getElementById('amImpactBodyFreq');
    _elImpactBodyDecay = document.getElementById('amImpactBodyDecay');
    _elImpactNoiseFreq = document.getElementById('amImpactNoiseFreq');
    _elImpactNoiseFilterType = document.getElementById('amImpactNoiseFilterType');
    _elImpactNoiseQ = document.getElementById('amImpactNoiseQ');
    _elImpactNoiseDur = document.getElementById('amImpactNoiseDur');
    _elImpactMix = document.getElementById('amImpactMix');

    // Viewport elements
    _elSoundTable = document.getElementById('amSoundTable');
    _elEnvelopeCanvas = document.getElementById('amEnvelopeCanvas');
    _elWaveformCanvas = document.getElementById('amWaveformCanvas');

    if (_elEnvelopeCanvas) _envelopeCtx = _elEnvelopeCanvas.getContext('2d');
    if (_elWaveformCanvas) _waveformCtx = _elWaveformCanvas.getContext('2d');

    if (!_elType) return; // Panel not in DOM

    // Event listeners
    if (_elType) _elType.addEventListener('change', function () { onTypeChange(); drawEnvelope(); });
    if (_elPlayBtn) _elPlayBtn.addEventListener('click', onPlay);
    if (_elSaveBtn) _elSaveBtn.addEventListener('click', onSave);
    if (_elNewBtn) _elNewBtn.addEventListener('click', onNew);
    if (_elDeleteBtn) _elDeleteBtn.addEventListener('click', onDelete);
    if (_elDuplicateBtn) _elDuplicateBtn.addEventListener('click', onDuplicate);
    if (_elRandomizeBtn) _elRandomizeBtn.addEventListener('click', onRandomize);
    if (_elAddBinding) _elAddBinding.addEventListener('click', function () { addBindingRow(); });

    // Live envelope redraw on param changes
    var envInputs = [_elDuration, _elVolume, _elAttack, _elDecay, _elStartFreq, _elEndFreq];
    envInputs.forEach(function (el) {
      if (el) el.addEventListener('input', drawEnvelope);
    });

    onTypeChange();
  }

  // --- Load ---

  function loadAllSounds() {
    fetch('/api/sounds').then(function (r) { return r.json(); }).then(function (names) {
      _soundList = names || [];
      // Fetch all sound data for the table
      var promises = _soundList.map(function (name) {
        return fetch('/api/sounds/' + encodeURIComponent(name))
          .then(function (r) { return r.json(); })
          .then(function (data) { _soundCache[name] = data; return data; })
          .catch(function () { return null; });
      });
      return Promise.all(promises);
    }).then(function () {
      renderSoundTable();
      // If we had a selected sound, re-select it
      if (_currentSoundId && _soundCache[_currentSoundId]) {
        highlightTableRow(_currentSoundId);
      } else if (_soundList.length > 0) {
        selectSound(_soundList[0]);
      } else {
        clearForm();
      }
    }).catch(function () {
      _soundList = [];
      _soundCache = {};
      renderSoundTable();
    });
  }

  // --- Sound Table ---

  var GROUP_DISPLAY_NAMES = {
    'weapon_fire|weaponModelType=rifle': 'Rifle Fire',
    'weapon_fire|weaponModelType=shotgun': 'Shotgun Fire',
    'weapon_fire|weaponModelType=sniper': 'Sniper Fire',
    'hit_marker|': 'Hit Marker',
    'hit_marker|headshot=true': 'Headshot Hit Marker',
    'elimination|': 'Elimination',
    'damage_taken|': 'Damage Taken',
    'own_death|': 'Death',
    'melee_swing|': 'Melee Swing',
    'melee_hit|': 'Melee Hit',
    'footstep|': 'Footstep',
    'jump|': 'Jump',
    'land|': 'Land',
    'reload_start|': 'Reload Start',
    'reload_end|': 'Reload End',
    'ui_click|': 'UI Click',
    'countdown_tick|': 'Countdown Tick',
    'countdown_go|': 'Countdown Go',
    'respawn|': 'Respawn',
    'dry_fire|': 'Dry Fire'
  };

  function buildSoundGroups() {
    var groups = {};
    var order = [];
    for (var i = 0; i < _soundList.length; i++) {
      var name = _soundList[i];
      var data = _soundCache[name];
      if (!data) continue;

      var evt = '';
      var filter = {};
      if (data.bindings && data.bindings.length > 0) {
        evt = data.bindings[0].event || '';
        filter = data.bindings[0].filter || {};
      }

      var filterParts = Object.keys(filter).sort().map(function (k) {
        return k + '=' + filter[k];
      });
      var key = evt + '|' + filterParts.join(',');

      if (!groups[key]) {
        groups[key] = { key: key, event: evt, filter: filter, sounds: [] };
        order.push(key);
      }
      groups[key].sounds.push(name);
    }
    return order.map(function (k) { return groups[k]; });
  }

  function getGroupDisplayName(group) {
    if (GROUP_DISPLAY_NAMES[group.key]) return GROUP_DISPLAY_NAMES[group.key];
    var evt = group.event || 'Unknown';
    return evt.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function renderSoundTable() {
    if (!_elSoundTable) return;

    var groups = buildSoundGroups();
    var html = '<table class="am-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Event</th><th>Filters</th>' +
      '<th>Duration</th><th>Volume</th><th></th>' +
      '</tr></thead><tbody>';

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var isMulti = group.sounds.length > 1;
      var isExpanded = !!_expandedGroups[group.key];
      var escKey = group.key.replace(/"/g, '&quot;');

      if (isMulti) {
        // Compute max duration
        var maxDur = 0;
        for (var s = 0; s < group.sounds.length; s++) {
          var sd = _soundCache[group.sounds[s]];
          if (sd && sd.synthesis && typeof sd.synthesis.duration === 'number') {
            maxDur = Math.max(maxDur, sd.synthesis.duration);
          }
        }

        // Build filter pills
        var filterPills = '';
        var filterObj = group.filter || {};
        var filterKeys = Object.keys(filterObj);
        for (var f = 0; f < filterKeys.length; f++) {
          filterPills += '<span class="am-filter-pill">' + filterKeys[f] + ':' + filterObj[filterKeys[f]] + '</span>';
        }

        // Group header row
        html += '<tr class="am-group-row' + (isExpanded ? ' am-expanded' : '') + '" data-group-key="' + escKey + '">' +
          '<td><span class="am-expand-icon">' + (isExpanded ? '&#9660;' : '&#9654;') + '</span> ' +
          '<span class="am-group-name">' + getGroupDisplayName(group) + '</span></td>' +
          '<td><span class="am-layer-count">' + group.sounds.length + ' layers</span></td>' +
          '<td>' + group.event + '</td>' +
          '<td>' + (filterPills || '<span style="color:#555">none</span>') + '</td>' +
          '<td>' + maxDur.toFixed(3) + 's</td>' +
          '<td></td>' +
          '<td><button class="am-table-btn am-play-all-btn" data-group-key="' + escKey + '" title="Play All Layers">&#9654; All</button></td>' +
          '</tr>';

        // Layer rows
        for (var s = 0; s < group.sounds.length; s++) {
          var lName = group.sounds[s];
          var lData = _soundCache[lName];
          if (!lData) continue;

          var lSyn = lData.synthesis || {};
          var lType = lSyn.type || '?';
          var lDur = (typeof lSyn.duration === 'number') ? lSyn.duration.toFixed(3) : '-';
          var lVol = (typeof lSyn.volume === 'number') ? lSyn.volume.toFixed(2) : '-';
          var lSel = (_currentSoundId === lName) ? ' am-row-selected' : '';
          var lHid = isExpanded ? '' : ' hidden';

          html += '<tr class="am-layer-row' + lSel + lHid + '" data-group-key="' + escKey + '" data-name="' + lName + '">' +
            '<td class="am-layer-indent">' + (lData.name || lName) + '</td>' +
            '<td><span class="am-type-badge ' + lType + '">' + lType + '</span></td>' +
            '<td></td><td></td>' +
            '<td>' + lDur + 's</td>' +
            '<td>' + lVol + '</td>' +
            '<td><button class="am-table-btn am-play-btn" data-name="' + lName + '" title="Play">&#9654;</button></td>' +
            '</tr>';
        }
      } else {
        // Single-layer: render as simple row
        var name = group.sounds[0];
        var data = _soundCache[name];
        if (!data) continue;

        var syn = data.synthesis || {};
        var type = syn.type || '?';
        var dur = (typeof syn.duration === 'number') ? syn.duration.toFixed(3) : '-';
        var vol = (typeof syn.volume === 'number') ? syn.volume.toFixed(2) : '-';
        var selected = (_currentSoundId === name) ? ' am-row-selected' : '';

        var filterPills = '';
        var filterObj = group.filter || {};
        var filterKeys = Object.keys(filterObj);
        for (var f = 0; f < filterKeys.length; f++) {
          filterPills += '<span class="am-filter-pill">' + filterKeys[f] + ':' + filterObj[filterKeys[f]] + '</span>';
        }

        html += '<tr class="am-sound-row' + selected + '" data-name="' + name + '">' +
          '<td>' + (data.name || name) + '</td>' +
          '<td><span class="am-type-badge ' + type + '">' + type + '</span></td>' +
          '<td>' + group.event + '</td>' +
          '<td>' + (filterPills || '<span style="color:#555">none</span>') + '</td>' +
          '<td>' + dur + 's</td>' +
          '<td>' + vol + '</td>' +
          '<td><button class="am-table-btn am-play-btn" data-name="' + name + '" title="Play">&#9654;</button></td>' +
          '</tr>';
      }
    }

    html += '</tbody></table>';
    _elSoundTable.innerHTML = html;
    wireTableEvents();
  }

  function highlightTableRow(name) {
    if (!_elSoundTable) return;
    var rows = _elSoundTable.querySelectorAll('.am-sound-row, .am-layer-row');
    rows.forEach(function (row) {
      row.classList.toggle('am-row-selected', row.getAttribute('data-name') === name);
    });
  }

  function wireTableEvents() {
    if (!_elSoundTable) return;

    // Group row clicks → toggle expand
    var groupRows = _elSoundTable.querySelectorAll('.am-group-row');
    groupRows.forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.classList.contains('am-play-all-btn') || e.target.closest('.am-play-all-btn')) return;
        var key = row.getAttribute('data-group-key');
        toggleGroup(key);
      });
    });

    // Play All buttons
    var playAllBtns = _elSoundTable.querySelectorAll('.am-play-all-btn');
    playAllBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var key = btn.getAttribute('data-group-key');
        playAllLayers(key);
      });
    });

    // Single-row and layer-row clicks → select sound
    var soundRows = _elSoundTable.querySelectorAll('.am-sound-row, .am-layer-row');
    soundRows.forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.classList.contains('am-play-btn') || e.target.closest('.am-play-btn')) return;
        var name = row.getAttribute('data-name');
        selectSound(name);
      });
    });

    // Individual play buttons
    var playBtns = _elSoundTable.querySelectorAll('.am-play-btn');
    playBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var name = btn.getAttribute('data-name');
        var data = _soundCache[name];
        if (data && data.synthesis && typeof playRawSound === 'function') {
          playRawSound(data.synthesis);
          startWaveformAnimation();
        }
      });
    });
  }

  function toggleGroup(groupKey) {
    _expandedGroups[groupKey] = !_expandedGroups[groupKey];
    var isExpanded = _expandedGroups[groupKey];

    var allRows = _elSoundTable.querySelectorAll('tr[data-group-key]');
    allRows.forEach(function (row) {
      if (row.getAttribute('data-group-key') !== groupKey) return;

      if (row.classList.contains('am-group-row')) {
        row.classList.toggle('am-expanded', isExpanded);
        var icon = row.querySelector('.am-expand-icon');
        if (icon) icon.innerHTML = isExpanded ? '&#9660;' : '&#9654;';
      } else if (row.classList.contains('am-layer-row')) {
        row.classList.toggle('hidden', !isExpanded);
      }
    });
  }

  function playAllLayers(groupKey) {
    var groups = buildSoundGroups();
    var group = null;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].key === groupKey) { group = groups[i]; break; }
    }
    if (!group) return;

    var maxDuration = 0;
    for (var s = 0; s < group.sounds.length; s++) {
      var data = _soundCache[group.sounds[s]];
      if (data && data.synthesis) {
        if (typeof playRawSound === 'function') playRawSound(data.synthesis);
        var dur = data.synthesis.duration || 0;
        if (dur > maxDuration) maxDuration = dur;
      }
    }
    startWaveformAnimation(maxDuration);
  }

  function selectSound(name) {
    if (!name) return;
    var data = _soundCache[name];
    if (!data) {
      // Fetch it
      fetch('/api/sounds/' + encodeURIComponent(name)).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.synthesis) return;
        _soundCache[name] = d;
        _currentSoundId = name;
        populateForm(d);
        highlightTableRow(name);
        drawEnvelope();
      }).catch(function () {});
      return;
    }
    _currentSoundId = name;
    populateForm(data);
    highlightTableRow(name);
    drawEnvelope();
  }

  // --- Form population ---

  function populateForm(data) {
    if (_elName) _elName.value = data.name || '';
    if (_elId) _elId.value = data.id || '';

    var syn = data.synthesis || {};
    if (_elType) _elType.value = syn.type || 'noise_burst';
    onTypeChange();

    // Common params
    if (_elDuration) _elDuration.value = syn.duration || 0.06;
    if (_elVolume) _elVolume.value = (typeof syn.volume === 'number') ? syn.volume : 0.5;
    if (_elAttack) _elAttack.value = syn.attack || 0.002;
    if (_elDecay) _elDecay.value = syn.decay || 0.058;

    // noise_burst
    if (_elFrequency) _elFrequency.value = syn.frequency || 3000;
    if (_elFilterType) _elFilterType.value = syn.filterType || 'bandpass';
    if (_elFilterQ) _elFilterQ.value = (typeof syn.filterQ === 'number') ? syn.filterQ : 1;

    // Shared waveform
    if (_elWaveform) _elWaveform.value = syn.waveform || 'sine';

    // sweep
    if (_elStartFreq) _elStartFreq.value = syn.startFreq || 800;
    if (_elEndFreq) _elEndFreq.value = syn.endFreq || 200;
    if (_elNoiseAmount) _elNoiseAmount.value = (typeof syn.noiseAmount === 'number') ? syn.noiseAmount : 0;

    // multi_tone
    if (_elNotes) _elNotes.value = syn.notes ? JSON.stringify(syn.notes, null, 2) : '[]';

    // fm
    if (_elCarrierFreq) _elCarrierFreq.value = syn.carrierFreq || 440;
    if (_elCarrierWaveform) _elCarrierWaveform.value = syn.carrierWaveform || 'sine';
    if (_elModFreq) _elModFreq.value = syn.modFreq || 880;
    if (_elModDepth) _elModDepth.value = syn.modDepth || 200;
    if (_elModWaveform) _elModWaveform.value = syn.modWaveform || 'sine';

    // pluck
    if (_elPluckFreq) _elPluckFreq.value = syn.frequency || 200;
    if (_elPluckDamping) _elPluckDamping.value = (typeof syn.damping === 'number') ? syn.damping : 0.5;

    // filtered_osc
    if (_elFOscFreq) _elFOscFreq.value = syn.frequency || 440;
    if (_elFOscFilterType) _elFOscFilterType.value = syn.filterType || 'lowpass';
    if (_elFOscFilterFreq) _elFOscFilterFreq.value = syn.filterFreq || 2000;
    if (_elFOscFilterEnd) _elFOscFilterEnd.value = (syn.filterEndFreq != null) ? syn.filterEndFreq : '';
    if (_elFOscFilterQ) _elFOscFilterQ.value = (typeof syn.filterQ === 'number') ? syn.filterQ : 4;

    // impact
    if (_elImpactBodyFreq) _elImpactBodyFreq.value = syn.bodyFreq || 100;
    if (_elImpactBodyDecay) _elImpactBodyDecay.value = syn.bodyDecay || 0.05;
    if (_elImpactNoiseFreq) _elImpactNoiseFreq.value = syn.noiseFreq || 2000;
    if (_elImpactNoiseFilterType) _elImpactNoiseFilterType.value = syn.noiseFilterType || 'bandpass';
    if (_elImpactNoiseQ) _elImpactNoiseQ.value = (typeof syn.noiseFilterQ === 'number') ? syn.noiseFilterQ : 1;
    if (_elImpactNoiseDur) _elImpactNoiseDur.value = syn.noiseDuration || 0.03;
    if (_elImpactMix) _elImpactMix.value = (typeof syn.mix === 'number') ? syn.mix : 0.5;

    // Bindings
    populateBindings(data.bindings || []);
    drawEnvelope();
  }

  function clearForm() {
    _currentSoundId = null;
    if (_elName) _elName.value = '';
    if (_elId) _elId.value = '';
    if (_elType) _elType.value = 'noise_burst';
    if (_elDuration) _elDuration.value = '0.06';
    if (_elVolume) _elVolume.value = '0.5';
    if (_elAttack) _elAttack.value = '0.002';
    if (_elDecay) _elDecay.value = '0.058';
    if (_elFrequency) _elFrequency.value = '3000';
    if (_elFilterType) _elFilterType.value = 'bandpass';
    if (_elFilterQ) _elFilterQ.value = '1';
    if (_elWaveform) _elWaveform.value = 'sine';
    if (_elStartFreq) _elStartFreq.value = '800';
    if (_elEndFreq) _elEndFreq.value = '200';
    if (_elNoiseAmount) _elNoiseAmount.value = '0';
    if (_elNotes) _elNotes.value = '[]';
    // fm
    if (_elCarrierFreq) _elCarrierFreq.value = '440';
    if (_elCarrierWaveform) _elCarrierWaveform.value = 'sine';
    if (_elModFreq) _elModFreq.value = '880';
    if (_elModDepth) _elModDepth.value = '200';
    if (_elModWaveform) _elModWaveform.value = 'sine';
    // pluck
    if (_elPluckFreq) _elPluckFreq.value = '200';
    if (_elPluckDamping) _elPluckDamping.value = '0.5';
    // filtered_osc
    if (_elFOscFreq) _elFOscFreq.value = '440';
    if (_elFOscFilterType) _elFOscFilterType.value = 'lowpass';
    if (_elFOscFilterFreq) _elFOscFilterFreq.value = '2000';
    if (_elFOscFilterEnd) _elFOscFilterEnd.value = '';
    if (_elFOscFilterQ) _elFOscFilterQ.value = '4';
    // impact
    if (_elImpactBodyFreq) _elImpactBodyFreq.value = '100';
    if (_elImpactBodyDecay) _elImpactBodyDecay.value = '0.05';
    if (_elImpactNoiseFreq) _elImpactNoiseFreq.value = '2000';
    if (_elImpactNoiseFilterType) _elImpactNoiseFilterType.value = 'bandpass';
    if (_elImpactNoiseQ) _elImpactNoiseQ.value = '1';
    if (_elImpactNoiseDur) _elImpactNoiseDur.value = '0.03';
    if (_elImpactMix) _elImpactMix.value = '0.5';
    if (_elBindingsList) _elBindingsList.innerHTML = '';
    onTypeChange();
    drawEnvelope();
  }

  function onTypeChange() {
    var type = _elType ? _elType.value : 'noise_burst';
    if (_secNoiseBurst) _secNoiseBurst.classList.toggle('hidden', type !== 'noise_burst');
    if (_secSweep) _secSweep.classList.toggle('hidden', type !== 'sweep');
    if (_secMultiTone) _secMultiTone.classList.toggle('hidden', type !== 'multi_tone');
    if (_secFM) _secFM.classList.toggle('hidden', type !== 'fm');
    if (_secPluck) _secPluck.classList.toggle('hidden', type !== 'pluck');
    if (_secFilteredOsc) _secFilteredOsc.classList.toggle('hidden', type !== 'filtered_osc');
    if (_secImpact) _secImpact.classList.toggle('hidden', type !== 'impact');
    // Shared waveform: show for tone, sweep, multi_tone, filtered_osc
    var showWaveform = (type === 'tone' || type === 'sweep' || type === 'multi_tone' || type === 'filtered_osc');
    if (_secWaveform) _secWaveform.classList.toggle('hidden', !showWaveform);
  }

  // --- Build synthesis params from form ---

  function buildSynthesis() {
    var type = _elType ? _elType.value : 'noise_burst';
    var syn = { type: type };

    syn.duration = parseFloat(_elDuration ? _elDuration.value : 0.06) || 0.06;
    syn.volume = parseFloat(_elVolume ? _elVolume.value : 0.5) || 0.5;
    syn.attack = parseFloat(_elAttack ? _elAttack.value : 0.002) || 0.002;
    syn.decay = parseFloat(_elDecay ? _elDecay.value : 0.058) || 0.058;

    if (type === 'noise_burst') {
      syn.frequency = parseFloat(_elFrequency ? _elFrequency.value : 3000) || 3000;
      syn.filterType = _elFilterType ? _elFilterType.value : 'bandpass';
      syn.filterQ = parseFloat(_elFilterQ ? _elFilterQ.value : 1) || 1;
    } else if (type === 'tone') {
      syn.waveform = _elWaveform ? _elWaveform.value : 'sine';
      syn.frequency = parseFloat(_elFrequency ? _elFrequency.value : 440) || 440;
    } else if (type === 'sweep') {
      syn.waveform = _elWaveform ? _elWaveform.value : 'sine';
      syn.startFreq = parseFloat(_elStartFreq ? _elStartFreq.value : 800) || 800;
      syn.endFreq = parseFloat(_elEndFreq ? _elEndFreq.value : 200) || 200;
      syn.noiseAmount = parseFloat(_elNoiseAmount ? _elNoiseAmount.value : 0) || 0;
    } else if (type === 'multi_tone') {
      syn.waveform = _elWaveform ? _elWaveform.value : 'sine';
      try { syn.notes = JSON.parse(_elNotes ? _elNotes.value : '[]'); } catch (e) { syn.notes = []; }
    } else if (type === 'fm') {
      syn.carrierFreq = parseFloat(_elCarrierFreq ? _elCarrierFreq.value : 440) || 440;
      syn.carrierWaveform = _elCarrierWaveform ? _elCarrierWaveform.value : 'sine';
      syn.modFreq = parseFloat(_elModFreq ? _elModFreq.value : 880) || 880;
      syn.modDepth = parseFloat(_elModDepth ? _elModDepth.value : 200) || 200;
      syn.modWaveform = _elModWaveform ? _elModWaveform.value : 'sine';
    } else if (type === 'pluck') {
      syn.frequency = parseFloat(_elPluckFreq ? _elPluckFreq.value : 200) || 200;
      syn.damping = parseFloat(_elPluckDamping ? _elPluckDamping.value : 0.5) || 0.5;
    } else if (type === 'filtered_osc') {
      syn.waveform = _elWaveform ? _elWaveform.value : 'sawtooth';
      syn.frequency = parseFloat(_elFOscFreq ? _elFOscFreq.value : 440) || 440;
      syn.filterType = _elFOscFilterType ? _elFOscFilterType.value : 'lowpass';
      syn.filterFreq = parseFloat(_elFOscFilterFreq ? _elFOscFilterFreq.value : 2000) || 2000;
      var fEnd = _elFOscFilterEnd ? _elFOscFilterEnd.value.trim() : '';
      if (fEnd !== '') syn.filterEndFreq = parseFloat(fEnd) || null;
      syn.filterQ = parseFloat(_elFOscFilterQ ? _elFOscFilterQ.value : 4) || 4;
    } else if (type === 'impact') {
      syn.bodyFreq = parseFloat(_elImpactBodyFreq ? _elImpactBodyFreq.value : 100) || 100;
      syn.bodyDecay = parseFloat(_elImpactBodyDecay ? _elImpactBodyDecay.value : 0.05) || 0.05;
      syn.noiseFreq = parseFloat(_elImpactNoiseFreq ? _elImpactNoiseFreq.value : 2000) || 2000;
      syn.noiseFilterType = _elImpactNoiseFilterType ? _elImpactNoiseFilterType.value : 'bandpass';
      syn.noiseFilterQ = parseFloat(_elImpactNoiseQ ? _elImpactNoiseQ.value : 1) || 1;
      syn.noiseDuration = parseFloat(_elImpactNoiseDur ? _elImpactNoiseDur.value : 0.03) || 0.03;
      syn.mix = parseFloat(_elImpactMix ? _elImpactMix.value : 0.5);
    }

    return syn;
  }

  // --- Bindings ---

  function populateBindings(bindings) {
    if (!_elBindingsList) return;
    _elBindingsList.innerHTML = '';
    for (var i = 0; i < bindings.length; i++) {
      addBindingRow(bindings[i]);
    }
  }

  function addBindingRow(data) {
    if (!_elBindingsList) return;
    var row = document.createElement('div');
    row.className = 'am-binding-row';

    // Event select
    var evtSel = document.createElement('select');
    evtSel.className = 'am-binding-event';
    for (var i = 0; i < EVENT_TYPES.length; i++) {
      var opt = document.createElement('option');
      opt.value = EVENT_TYPES[i].value;
      opt.textContent = EVENT_TYPES[i].label;
      evtSel.appendChild(opt);
    }
    if (data && data.event) evtSel.value = data.event;
    row.appendChild(evtSel);

    // Filter container
    var filterDiv = document.createElement('div');
    filterDiv.className = 'am-binding-filters';
    row.appendChild(filterDiv);

    function buildFilterFields() {
      filterDiv.innerHTML = '';
      var evtType = EVENT_TYPES.find(function (et) { return et.value === evtSel.value; });
      if (!evtType) return;
      var filters = evtType.filters;
      for (var f = 0; f < filters.length; f++) {
        var key = filters[f];
        var label = document.createElement('label');
        label.textContent = key + ':';
        label.className = 'am-filter-label';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'am-filter-input';
        input.setAttribute('data-filter-key', key);
        input.placeholder = '(any)';
        if (data && data.filter && data.filter[key] !== undefined) {
          input.value = String(data.filter[key]);
        }
        filterDiv.appendChild(label);
        filterDiv.appendChild(input);
      }
    }

    evtSel.addEventListener('change', function () {
      data = null; // Clear stored data when event changes
      buildFilterFields();
    });
    buildFilterFields();

    // Remove button
    var removeBtn = document.createElement('button');
    removeBtn.textContent = 'X';
    removeBtn.className = 'am-binding-remove';
    removeBtn.addEventListener('click', function () {
      row.parentNode.removeChild(row);
    });
    row.appendChild(removeBtn);

    _elBindingsList.appendChild(row);
  }

  function readBindings() {
    var bindings = [];
    if (!_elBindingsList) return bindings;
    var rows = _elBindingsList.querySelectorAll('.am-binding-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var evtSel = row.querySelector('.am-binding-event');
      var evt = evtSel ? evtSel.value : '';
      var filter = {};
      var inputs = row.querySelectorAll('.am-filter-input');
      for (var j = 0; j < inputs.length; j++) {
        var key = inputs[j].getAttribute('data-filter-key');
        var val = inputs[j].value.trim();
        if (val) {
          // Parse booleans
          if (val === 'true') filter[key] = true;
          else if (val === 'false') filter[key] = false;
          else filter[key] = val;
        }
      }
      bindings.push({ event: evt, filter: filter });
    }
    return bindings;
  }

  // --- Actions ---

  function onPlay() {
    var syn = buildSynthesis();
    if (typeof playRawSound === 'function') playRawSound(syn);
    startWaveformAnimation();
  }

  function onSave() {
    var id = _elId ? _elId.value.trim() : '';
    if (!id) { alert('Sound ID is required'); return; }
    var name = _elName ? _elName.value.trim() : id;

    var soundData = {
      id: id,
      name: name,
      synthesis: buildSynthesis(),
      bindings: readBindings()
    };

    fetch('/api/sounds/' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(soundData)
    }).then(function (r) { return r.json(); }).then(function () {
      _currentSoundId = id;
      _soundCache[id] = soundData;
      loadAllSounds();
      // Refresh game audio
      if (typeof loadSoundsFromServer === 'function') loadSoundsFromServer();
    }).catch(function (e) {
      alert('Failed to save sound: ' + e.message);
    });
  }

  function onNew() {
    clearForm();
    if (_elId) _elId.value = 'new_sound';
    if (_elName) _elName.value = 'New Sound';
    _currentSoundId = null;
    highlightTableRow(null);
  }

  function onDelete() {
    var id = _elId ? _elId.value.trim() : '';
    if (!id) return;
    if (!confirm('Delete sound "' + id + '"?')) return;

    fetch('/api/sounds/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function () {
        _currentSoundId = null;
        delete _soundCache[id];
        loadAllSounds();
        if (typeof loadSoundsFromServer === 'function') loadSoundsFromServer();
      }).catch(function () {});
  }

  function onDuplicate() {
    var id = _elId ? _elId.value.trim() : '';
    if (!id) return;

    var newId = id + '_copy';
    // Ensure unique name
    var counter = 1;
    while (_soundCache[newId]) {
      newId = id + '_copy' + counter;
      counter++;
    }

    var soundData = {
      id: newId,
      name: (_elName ? _elName.value.trim() : id) + ' Copy',
      synthesis: buildSynthesis(),
      bindings: readBindings()
    };

    fetch('/api/sounds/' + encodeURIComponent(newId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(soundData)
    }).then(function (r) { return r.json(); }).then(function () {
      _currentSoundId = newId;
      _soundCache[newId] = soundData;
      loadAllSounds();
      if (typeof loadSoundsFromServer === 'function') loadSoundsFromServer();
    }).catch(function (e) {
      alert('Failed to duplicate: ' + e.message);
    });
  }

  function onRandomize() {
    // Apply ±15% random variation to numeric synthesis params
    var numInputs = [_elDuration, _elVolume, _elAttack, _elDecay, _elFrequency, _elFilterQ,
                     _elStartFreq, _elEndFreq, _elNoiseAmount,
                     _elCarrierFreq, _elModFreq, _elModDepth,
                     _elPluckFreq, _elPluckDamping,
                     _elFOscFreq, _elFOscFilterFreq, _elFOscFilterEnd, _elFOscFilterQ,
                     _elImpactBodyFreq, _elImpactBodyDecay, _elImpactNoiseFreq,
                     _elImpactNoiseQ, _elImpactNoiseDur, _elImpactMix];
    numInputs.forEach(function (el) {
      if (!el || el.offsetParent === null) return; // skip hidden
      var val = parseFloat(el.value);
      if (isNaN(val) || val === 0) return;
      var factor = 1 + (Math.random() * 0.3 - 0.15);
      var newVal = val * factor;
      // Respect min/max
      var min = parseFloat(el.min);
      var max = parseFloat(el.max);
      if (!isNaN(min) && newVal < min) newVal = min;
      if (!isNaN(max) && newVal > max) newVal = max;
      el.value = parseFloat(newVal.toFixed(4));
    });
    drawEnvelope();
  }

  // --- Envelope Visualization ---

  function drawEnvelope() {
    if (!_envelopeCtx || !_elEnvelopeCanvas) return;

    var canvas = _elEnvelopeCanvas;
    var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: canvas.clientWidth, height: canvas.clientHeight };
    var w = Math.floor(rect.width / 2);
    var h = Math.floor(rect.height);
    if (w < 10 || h < 10) return;

    canvas.width = w;
    canvas.height = h;

    var ctx = _envelopeCtx;
    var type = _elType ? _elType.value : 'noise_burst';
    var duration = parseFloat(_elDuration ? _elDuration.value : 0.06) || 0.06;
    var volume = parseFloat(_elVolume ? _elVolume.value : 0.5) || 0.5;
    var attack = parseFloat(_elAttack ? _elAttack.value : 0.002) || 0.002;
    var decay = parseFloat(_elDecay ? _elDecay.value : 0.058) || 0.058;

    var pad = 40;
    var plotW = w - pad * 2;
    var plotH = h - pad * 2;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i++) {
      var gy = pad + plotH * i / 4;
      ctx.beginPath();
      ctx.moveTo(pad, gy);
      ctx.lineTo(pad + plotW, gy);
      ctx.stroke();
    }
    for (var j = 0; j <= 5; j++) {
      var gx = pad + plotW * j / 5;
      ctx.beginPath();
      ctx.moveTo(gx, pad);
      ctx.lineTo(gx, pad + plotH);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, pad + plotH);
    ctx.lineTo(pad + plotW, pad + plotH);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('0', pad, pad + plotH + 14);
    ctx.fillText(duration.toFixed(3) + 's', pad + plotW, pad + plotH + 14);
    ctx.fillText('Time', pad + plotW / 2, pad + plotH + 28);

    ctx.textAlign = 'right';
    ctx.fillText('0', pad - 4, pad + plotH + 4);
    ctx.fillText(volume.toFixed(2), pad - 4, pad + 4);

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ENVELOPE', pad, pad - 10);

    // Draw envelope curve
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2;
    ctx.beginPath();

    // ADSR points
    var attackEnd = Math.min(attack, duration);
    var decayEnd = Math.min(attack + decay, duration);

    function timeToX(t) { return pad + (t / duration) * plotW; }
    function ampToY(a) { return pad + plotH - (a / Math.max(volume, 0.01)) * plotH; }

    ctx.moveTo(timeToX(0), ampToY(0));
    ctx.lineTo(timeToX(attackEnd), ampToY(volume));
    ctx.lineTo(timeToX(decayEnd), ampToY(0));
    if (decayEnd < duration) {
      ctx.lineTo(timeToX(duration), ampToY(0));
    }
    ctx.stroke();

    // Fill under curve
    ctx.fillStyle = 'rgba(0, 255, 136, 0.08)';
    ctx.beginPath();
    ctx.moveTo(timeToX(0), ampToY(0));
    ctx.lineTo(timeToX(attackEnd), ampToY(volume));
    ctx.lineTo(timeToX(decayEnd), ampToY(0));
    if (decayEnd < duration) {
      ctx.lineTo(timeToX(duration), ampToY(0));
    }
    ctx.closePath();
    ctx.fill();

    // For sweep type, overlay frequency curve
    if (type === 'sweep') {
      var startFreq = parseFloat(_elStartFreq ? _elStartFreq.value : 800) || 800;
      var endFreq = parseFloat(_elEndFreq ? _elEndFreq.value : 200) || 200;
      var maxFreq = Math.max(startFreq, endFreq, 1);

      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();

      for (var t = 0; t <= 1; t += 0.01) {
        var freq = startFreq + (endFreq - startFreq) * t;
        var x = pad + t * plotW;
        var y = pad + plotH - (freq / maxFreq) * plotH;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Freq label
      ctx.fillStyle = '#4488ff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(startFreq + 'Hz', pad + plotW + 2, pad + plotH - (startFreq / maxFreq) * plotH + 4);
      ctx.fillText(endFreq + 'Hz', pad + plotW + 2, pad + plotH - (endFreq / maxFreq) * plotH + 4);
    }
  }

  // --- Waveform Visualization ---

  function startWaveformAnimation(overrideDuration) {
    _isPlaying = true;
    if (_waveformAnimFrame) cancelAnimationFrame(_waveformAnimFrame);

    var duration = (typeof overrideDuration === 'number') ? overrideDuration :
      (parseFloat(_elDuration ? _elDuration.value : 0.06) || 0.06);
    var startTime = performance.now();
    // Keep animating for duration + buffer
    var totalMs = (duration + 0.2) * 1000;

    function animateWaveform() {
      drawWaveform();
      if (performance.now() - startTime < totalMs) {
        _waveformAnimFrame = requestAnimationFrame(animateWaveform);
      } else {
        _isPlaying = false;
        // One final draw to freeze last frame
        drawWaveform();
      }
    }
    _waveformAnimFrame = requestAnimationFrame(animateWaveform);
  }

  function drawWaveform() {
    if (!_waveformCtx || !_elWaveformCanvas) return;

    var canvas = _elWaveformCanvas;
    var rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: canvas.clientWidth, height: canvas.clientHeight };
    var w = Math.floor(rect.width / 2);
    var h = Math.floor(rect.height);
    if (w < 10 || h < 10) return;

    canvas.width = w;
    canvas.height = h;

    var ctx = _waveformCtx;
    var pad = 40;
    var plotW = w - pad * 2;
    var plotH = h - pad * 2;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Center line
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad + plotH / 2);
    ctx.lineTo(pad + plotW, pad + plotH / 2);
    ctx.stroke();

    // Border
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad, pad + plotH);
    ctx.lineTo(pad + plotW, pad + plotH);
    ctx.lineTo(pad + plotW, pad);
    ctx.closePath();
    ctx.stroke();

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(_isPlaying ? 'WAVEFORM (live)' : 'WAVEFORM', pad, pad - 10);

    // Get analyser data
    var analyser = (typeof getAudioAnalyser === 'function') ? getAudioAnalyser() : null;
    if (!analyser) {
      // Draw flat line
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, pad + plotH / 2);
      ctx.lineTo(pad + plotW, pad + plotH / 2);
      ctx.stroke();
      return;
    }

    var bufferLength = analyser.fftSize;
    var dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.strokeStyle = _isPlaying ? '#00ff88' : '#336644';
    ctx.lineWidth = _isPlaying ? 2 : 1;
    ctx.beginPath();

    var sliceWidth = plotW / bufferLength;
    var x = pad;

    for (var i = 0; i < bufferLength; i++) {
      var v = dataArray[i] / 128.0;
      var y = pad + (plotH / 2) * (2 - v);

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);

      x += sliceWidth;
    }

    ctx.stroke();
  }

  // --- Public ---

  window._initAudioManager = function () {
    loadAllSounds();
    // Resize canvases on next frame
    setTimeout(function () {
      drawEnvelope();
      drawWaveform();
    }, 100);
  };

  window._closeAudioManager = function () {
    if (_waveformAnimFrame) {
      cancelAnimationFrame(_waveformAnimFrame);
      _waveformAnimFrame = 0;
    }
    _isPlaying = false;
  };

  // Init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
