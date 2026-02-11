/**
 * audio.js — Web Audio sound system
 *
 * PURPOSE: Data-driven sound engine using Web Audio API synthesis. Sounds are
 * defined as JSON files in sounds/ directory. Each sound has synthesis params
 * and event bindings. Game code calls playGameSound(eventName, context) which
 * matches bindings and plays all matching sounds.
 *
 * EXPORTS (window):
 *   playGameSound(eventName, context)       — match event+filters, play all matching
 *   playRawSound(synthesis)                 — play from raw synthesis params (editor preview)
 *   playFootstepIfDue(sprinting, heroId, now) — footstep with built-in cooldown
 *   loadSoundsFromServer()                  — fetch sounds from server, rebuild index
 *   getSoundRegistry()                      — return current registry (for editor)
 *   getAudioAnalyser()                      — return AnalyserNode for visualization
 *
 * DEPENDENCIES: None (loaded after config.js, before weapon.js)
 */

(function () {

  var _ctx = null;
  var _masterGain = null;
  var _synthBus = null;    // gain node all synth output connects to
  var _analyser = null;    // AnalyserNode for visualization
  var _noiseBuffer = null;
  var _soundRegistry = [];
  var _eventIndex = {};

  // Footstep cooldown tracking
  var _lastFootstepTime = 0;
  var FOOTSTEP_WALK_CD = 400;
  var FOOTSTEP_SPRINT_CD = 280;

  // --- AudioContext management ---

  function ensureContext() {
    if (_ctx) {
      if (_ctx.state === 'suspended') {
        try { _ctx.resume(); } catch (e) {}
      }
      return _ctx;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _ctx = new AC();
      _masterGain = _ctx.createGain();
      _masterGain.gain.value = 0.3;
      _masterGain.connect(_ctx.destination);
      // Synth bus → analyser → master gain (analyser taps all synthesis output)
      _analyser = _ctx.createAnalyser();
      _analyser.fftSize = 2048;
      _synthBus = _ctx.createGain();
      _synthBus.gain.value = 1.0;
      _synthBus.connect(_analyser);
      _analyser.connect(_masterGain);
      _buildNoiseBuffer();
    } catch (e) {
      console.warn('audio: failed to create AudioContext', e);
      return null;
    }
    return _ctx;
  }

  function _buildNoiseBuffer() {
    if (!_ctx) return;
    var sampleRate = _ctx.sampleRate;
    var length = sampleRate * 2; // 2 seconds
    _noiseBuffer = _ctx.createBuffer(1, length, sampleRate);
    var data = _noiseBuffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  // --- Event index ---

  function rebuildEventIndex() {
    _eventIndex = {};
    for (var i = 0; i < _soundRegistry.length; i++) {
      var sound = _soundRegistry[i];
      if (!sound.bindings || !sound.bindings.length) continue;
      for (var b = 0; b < sound.bindings.length; b++) {
        var binding = sound.bindings[b];
        var evt = binding.event;
        if (!evt) continue;
        if (!_eventIndex[evt]) _eventIndex[evt] = [];
        _eventIndex[evt].push({ sound: sound, filter: binding.filter || {} });
      }
    }
  }

  function matchesFilter(filter, context) {
    if (!filter) return true;
    var keys = Object.keys(filter);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (context[key] !== filter[key]) return false;
    }
    return true;
  }

  // --- Synthesis ---

  function _synthesize(params) {
    if (!params || !params.type) return;
    var ctx = ensureContext();
    if (!ctx) return;

    switch (params.type) {
      case 'noise_burst': _synthNoiseBurst(params); break;
      case 'tone': _synthTone(params); break;
      case 'sweep': _synthSweep(params); break;
      case 'multi_tone': _synthMultiTone(params); break;
      default: break;
    }
  }

  function _synthNoiseBurst(p) {
    if (!_ctx) return;
    if (!_noiseBuffer) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var duration = p.duration || 0.06;
    var attack = p.attack || 0.002;
    var decay = p.decay || Math.max(0, duration - attack);
    var volume = (typeof p.volume === 'number') ? p.volume : 0.5;

    var source = ctx.createBufferSource();
    source.buffer = _noiseBuffer;

    // Random start offset for variety
    var maxStart = Math.max(0, _noiseBuffer.duration - duration - 0.1);
    source.loopStart = Math.random() * maxStart;
    source.loopEnd = source.loopStart + duration;

    var filter = ctx.createBiquadFilter();
    filter.type = p.filterType || 'bandpass';
    filter.frequency.value = p.frequency || 3000;
    filter.Q.value = (typeof p.filterQ === 'number') ? p.filterQ : 1;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(_synthBus);

    source.start(now);
    source.stop(now + duration + 0.05);
  }

  function _synthTone(p) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var duration = p.duration || 0.1;
    var attack = p.attack || 0.005;
    var decay = p.decay || Math.max(0, duration - attack);
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;

    var osc = ctx.createOscillator();
    osc.type = p.waveform || 'sine';
    osc.frequency.value = p.frequency || 440;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    osc.connect(gain);
    gain.connect(_synthBus);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function _synthSweep(p) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var duration = p.duration || 0.15;
    var attack = p.attack || 0.005;
    var decay = p.decay || Math.max(0, duration - attack);
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;
    var startFreq = p.startFreq || 800;
    var endFreq = p.endFreq || 200;
    var noiseAmount = (typeof p.noiseAmount === 'number') ? p.noiseAmount : 0;

    var osc = ctx.createOscillator();
    osc.type = p.waveform || 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.linearRampToValueAtTime(endFreq, now + duration);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    osc.connect(gain);

    // Optional noise mix
    if (noiseAmount > 0 && _noiseBuffer) {
      var noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = _noiseBuffer;
      var noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0, now);
      noiseGain.gain.linearRampToValueAtTime(volume * noiseAmount, now + attack);
      noiseGain.gain.linearRampToValueAtTime(0, now + attack + decay);
      noiseSrc.connect(noiseGain);
      noiseGain.connect(_synthBus);
      noiseSrc.start(now);
      noiseSrc.stop(now + duration + 0.05);
    }

    gain.connect(_synthBus);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function _synthMultiTone(p) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var notes = p.notes || [];
    var waveform = p.waveform || 'sine';
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;
    var noteDecay = p.noteDecay || 0.15;

    for (var i = 0; i < notes.length; i++) {
      var note = notes[i];
      var freq = note.freq || 440;
      var dur = note.duration || 0.1;
      var delay = note.delay || 0;

      var osc = ctx.createOscillator();
      osc.type = waveform;
      osc.frequency.value = freq;

      var gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(volume, now + delay + 0.005);
      gain.gain.linearRampToValueAtTime(0, now + delay + dur);

      osc.connect(gain);
      gain.connect(_synthBus);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    }
  }

  // --- Public API ---

  window.playGameSound = function (eventName, context) {
    if (!eventName) return;
    context = context || {};
    var entries = _eventIndex[eventName];
    if (!entries || entries.length === 0) return;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (matchesFilter(entry.filter, context)) {
        _synthesize(entry.sound.synthesis);
      }
    }
  };

  window.playRawSound = function (synthesis) {
    _synthesize(synthesis);
  };

  window.playFootstepIfDue = function (sprinting, heroId, now) {
    var cd = sprinting ? FOOTSTEP_SPRINT_CD : FOOTSTEP_WALK_CD;
    if ((now - _lastFootstepTime) < cd) return;
    _lastFootstepTime = now;
    var ctx = { heroId: heroId || undefined, sprinting: !!sprinting };
    window.playGameSound('footstep', ctx);
  };

  window.loadSoundsFromServer = function () {
    return fetch('/api/sounds').then(function (r) {
      return r.json();
    }).then(function (names) {
      if (!Array.isArray(names)) return;
      var promises = names.map(function (name) {
        return fetch('/api/sounds/' + encodeURIComponent(name)).then(function (r) {
          return r.json();
        });
      });
      return Promise.all(promises);
    }).then(function (sounds) {
      if (!sounds) return;
      _soundRegistry = sounds.filter(function (s) { return s && s.synthesis; });
      rebuildEventIndex();
    }).catch(function (e) {
      // No sounds available — silent operation
    });
  };

  window.getSoundRegistry = function () {
    return _soundRegistry;
  };

  window.getAudioAnalyser = function () {
    ensureContext();
    return _analyser;
  };

  // Auto-load sounds on startup
  if (typeof fetch === 'function') {
    window.loadSoundsFromServer();
  }

})();
