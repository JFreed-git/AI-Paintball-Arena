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

  // --- DOM refs ---
  var _elName, _elId, _elType;
  var _elFrequency, _elFilterType, _elFilterQ, _elDuration, _elVolume, _elAttack, _elDecay;
  var _elWaveform, _elStartFreq, _elEndFreq, _elNoiseAmount;
  var _elNotes;
  var _elBindingsList, _elAddBinding;
  var _elPlayBtn, _elSaveBtn, _elNewBtn, _elDeleteBtn, _elDuplicateBtn, _elRandomizeBtn;

  // Synthesis type param sections
  var _secNoiseBurst, _secSweep, _secMultiTone, _secWaveform;

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

  function renderSoundTable() {
    if (!_elSoundTable) return;

    var html = '<table class="am-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Event</th><th>Filters</th>' +
      '<th>Duration</th><th>Volume</th><th></th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < _soundList.length; i++) {
      var name = _soundList[i];
      var data = _soundCache[name];
      if (!data) continue;

      var syn = data.synthesis || {};
      var type = syn.type || '?';
      var evt = '';
      var filters = '';
      if (data.bindings && data.bindings.length > 0) {
        evt = data.bindings[0].event || '';
        var filterObj = data.bindings[0].filter || {};
        var filterKeys = Object.keys(filterObj);
        for (var f = 0; f < filterKeys.length; f++) {
          filters += '<span class="am-filter-pill">' + filterKeys[f] + ':' + filterObj[filterKeys[f]] + '</span>';
        }
      }

      var dur = (typeof syn.duration === 'number') ? syn.duration.toFixed(3) : '-';
      var vol = (typeof syn.volume === 'number') ? syn.volume.toFixed(2) : '-';
      var selected = (_currentSoundId === name) ? ' am-row-selected' : '';

      html += '<tr class="am-sound-row' + selected + '" data-name="' + name + '">' +
        '<td>' + (data.name || name) + '</td>' +
        '<td><span class="am-type-badge ' + type + '">' + type + '</span></td>' +
        '<td>' + evt + '</td>' +
        '<td>' + (filters || '<span style="color:#555">none</span>') + '</td>' +
        '<td>' + dur + 's</td>' +
        '<td>' + vol + '</td>' +
        '<td><button class="am-table-btn am-play-btn" data-name="' + name + '" title="Play">&#9654;</button></td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    _elSoundTable.innerHTML = html;

    // Wire table row clicks
    var rows = _elSoundTable.querySelectorAll('.am-sound-row');
    rows.forEach(function (row) {
      row.addEventListener('click', function (e) {
        if (e.target.classList.contains('am-play-btn') || e.target.closest('.am-play-btn')) return;
        var name = row.getAttribute('data-name');
        selectSound(name);
      });
    });

    // Wire play buttons
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

  function highlightTableRow(name) {
    if (!_elSoundTable) return;
    var rows = _elSoundTable.querySelectorAll('.am-sound-row');
    rows.forEach(function (row) {
      row.classList.toggle('am-row-selected', row.getAttribute('data-name') === name);
    });
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
    if (_elBindingsList) _elBindingsList.innerHTML = '';
    onTypeChange();
    drawEnvelope();
  }

  function onTypeChange() {
    var type = _elType ? _elType.value : 'noise_burst';
    if (_secNoiseBurst) _secNoiseBurst.classList.toggle('hidden', type !== 'noise_burst');
    if (_secSweep) _secSweep.classList.toggle('hidden', type !== 'sweep');
    if (_secMultiTone) _secMultiTone.classList.toggle('hidden', type !== 'multi_tone');
    // Shared waveform: show for tone, sweep, multi_tone
    if (_secWaveform) _secWaveform.classList.toggle('hidden', type === 'noise_burst');
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
                     _elStartFreq, _elEndFreq, _elNoiseAmount];
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

  function startWaveformAnimation() {
    _isPlaying = true;
    if (_waveformAnimFrame) cancelAnimationFrame(_waveformAnimFrame);

    var duration = parseFloat(_elDuration ? _elDuration.value : 0.06) || 0.06;
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
