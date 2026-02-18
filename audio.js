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
 *   updateAudioListener(position, quaternion) — sync listener to camera for spatial audio
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

  // --- Spatial audio ---

  function _getOutputNode(worldPos) {
    if (!worldPos || !_ctx) return _synthBus;
    var panner = _ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 5;
    panner.maxDistance = 200;
    panner.rolloffFactor = 2;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    if (panner.positionX) {
      panner.positionX.value = worldPos.x;
      panner.positionY.value = worldPos.y;
      panner.positionZ.value = worldPos.z;
    } else {
      panner.setPosition(worldPos.x, worldPos.y, worldPos.z);
    }
    panner.connect(_synthBus);
    return panner;
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

  function _synthesize(params, worldPos) {
    if (!params || !params.type) return;
    var ctx = ensureContext();
    if (!ctx) return;

    switch (params.type) {
      case 'noise_burst': _synthNoiseBurst(params, worldPos); break;
      case 'tone': _synthTone(params, worldPos); break;
      case 'sweep': _synthSweep(params, worldPos); break;
      case 'multi_tone': _synthMultiTone(params, worldPos); break;
      case 'fm': _synthFM(params, worldPos); break;
      case 'pluck': _synthPluck(params, worldPos); break;
      case 'filtered_osc': _synthFilteredOsc(params, worldPos); break;
      case 'impact': _synthImpact(params, worldPos); break;
      default: break;
    }
  }

  function _synthNoiseBurst(p, worldPos) {
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
    gain.connect(_getOutputNode(worldPos));

    source.start(now);
    source.stop(now + duration + 0.05);
  }

  function _synthTone(p, worldPos) {
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
    gain.connect(_getOutputNode(worldPos));

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function _synthSweep(p, worldPos) {
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

    var outNode = _getOutputNode(worldPos);

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
      noiseGain.connect(outNode);
      noiseSrc.start(now);
      noiseSrc.stop(now + duration + 0.05);
    }

    gain.connect(outNode);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function _synthMultiTone(p, worldPos) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var notes = p.notes || [];
    var waveform = p.waveform || 'sine';
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;
    var noteDecay = p.noteDecay || 0.15;

    var outNode = _getOutputNode(worldPos);

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
      gain.connect(outNode);

      osc.start(now + delay);
      osc.stop(now + delay + dur + 0.05);
    }
  }

  function _synthFM(p, worldPos) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var duration = p.duration || 0.15;
    var attack = p.attack || 0.005;
    var decay = p.decay || Math.max(0, duration - attack);
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;
    var carrierFreq = p.carrierFreq || 440;
    var carrierWaveform = p.carrierWaveform || 'sine';
    var modFreq = p.modFreq || 880;
    var modDepth = p.modDepth || 200;
    var modWaveform = p.modWaveform || 'sine';

    var modOsc = ctx.createOscillator();
    modOsc.type = modWaveform;
    modOsc.frequency.value = modFreq;

    var modGain = ctx.createGain();
    modGain.gain.value = modDepth;

    modOsc.connect(modGain);

    var carrier = ctx.createOscillator();
    carrier.type = carrierWaveform;
    carrier.frequency.value = carrierFreq;
    modGain.connect(carrier.frequency);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    carrier.connect(gain);
    gain.connect(_getOutputNode(worldPos));

    modOsc.start(now);
    carrier.start(now);
    modOsc.stop(now + duration + 0.05);
    carrier.stop(now + duration + 0.05);
  }

  function _synthPluck(p, worldPos) {
    if (!_ctx) return;
    if (!_noiseBuffer) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var frequency = p.frequency || 200;
    var damping = (typeof p.damping === 'number') ? p.damping : 0.5;
    var duration = p.duration || 0.5;
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;

    // Karplus-Strong: noise burst → short delay with feedback
    var delayTime = 1 / frequency;
    var source = ctx.createBufferSource();
    source.buffer = _noiseBuffer;

    // Short burst envelope to excite the delay line
    var burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(volume, now);
    burstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    var delay = ctx.createDelay(1 / 20); // max delay for 20Hz
    delay.delayTime.value = delayTime;

    // Feedback filter — lowpass controls damping (brightness decay)
    var feedbackFilter = ctx.createBiquadFilter();
    feedbackFilter.type = 'lowpass';
    feedbackFilter.frequency.value = frequency * (4 - damping * 3.5); // high damping = low cutoff

    var feedbackGain = ctx.createGain();
    feedbackGain.gain.value = 0.98 - damping * 0.15; // high damping = less feedback

    var outGain = ctx.createGain();
    outGain.gain.setValueAtTime(volume, now);
    outGain.gain.linearRampToValueAtTime(0, now + duration);

    var outNode = _getOutputNode(worldPos);

    // Signal path: source → burstGain → delay → feedbackFilter → feedbackGain → delay (loop)
    source.connect(burstGain);
    burstGain.connect(delay);
    delay.connect(feedbackFilter);
    feedbackFilter.connect(feedbackGain);
    feedbackGain.connect(delay); // feedback loop
    delay.connect(outGain);
    outGain.connect(outNode);

    source.start(now);
    source.stop(now + 0.03); // short excitation burst
  }

  function _synthFilteredOsc(p, worldPos) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var duration = p.duration || 0.2;
    var attack = p.attack || 0.005;
    var decay = p.decay || Math.max(0, duration - attack);
    var volume = (typeof p.volume === 'number') ? p.volume : 0.3;
    var frequency = p.frequency || 440;
    var waveform = p.waveform || 'sawtooth';
    var filterType = p.filterType || 'lowpass';
    var filterFreq = p.filterFreq || 2000;
    var filterEndFreq = p.filterEndFreq || null;
    var filterQ = (typeof p.filterQ === 'number') ? p.filterQ : 4;

    var osc = ctx.createOscillator();
    osc.type = waveform;
    osc.frequency.value = frequency;

    var filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFreq, now);
    if (filterEndFreq !== null) {
      filter.frequency.linearRampToValueAtTime(filterEndFreq, now + duration);
    }
    filter.Q.value = filterQ;

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + attack + decay);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(_getOutputNode(worldPos));

    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  function _synthImpact(p, worldPos) {
    if (!_ctx) return;
    var ctx = _ctx;
    var now = ctx.currentTime;
    var volume = (typeof p.volume === 'number') ? p.volume : 0.5;
    var mix = (typeof p.mix === 'number') ? p.mix : 0.5; // 0=all noise, 1=all body

    var outNode = _getOutputNode(worldPos);

    // --- Sine body component ---
    var bodyFreq = p.bodyFreq || 100;
    var bodyDecay = p.bodyDecay || 0.05;

    var bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'sine';
    bodyOsc.frequency.value = bodyFreq;

    var bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(volume * mix, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDecay);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(outNode);
    bodyOsc.start(now);
    bodyOsc.stop(now + bodyDecay + 0.05);

    // --- Noise transient component ---
    if (_noiseBuffer) {
      var noiseDuration = p.noiseDuration || 0.03;
      var noiseFreq = p.noiseFreq || 2000;
      var noiseFilterType = p.noiseFilterType || 'bandpass';
      var noiseFilterQ = (typeof p.noiseFilterQ === 'number') ? p.noiseFilterQ : 1;

      var noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = _noiseBuffer;
      var maxStart = Math.max(0, _noiseBuffer.duration - noiseDuration - 0.1);
      noiseSrc.loopStart = Math.random() * maxStart;

      var noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = noiseFilterType;
      noiseFilter.frequency.value = noiseFreq;
      noiseFilter.Q.value = noiseFilterQ;

      var noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(volume * (1 - mix), now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(outNode);

      noiseSrc.start(now);
      noiseSrc.stop(now + noiseDuration + 0.05);
    }
  }

  // --- Public API ---

  window.playGameSound = function (eventName, context) {
    if (!eventName) return;
    context = context || {};
    var worldPos = context._worldPos || null;
    var entries = _eventIndex[eventName];
    if (!entries || entries.length === 0) return;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (matchesFilter(entry.filter, context)) {
        _synthesize(entry.sound.synthesis, worldPos);
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

  // --- Listener positioning for spatial audio ---

  window.updateAudioListener = function (position, quaternion) {
    if (!_ctx) return;
    var listener = _ctx.listener;
    if (!listener) return;

    // Compute forward and up vectors from quaternion
    var fw = { x: 0, y: 0, z: -1 };
    var up = { x: 0, y: 1, z: 0 };
    // Apply quaternion rotation: v' = q * v * q^-1
    var qx = quaternion.x, qy = quaternion.y, qz = quaternion.z, qw = quaternion.w;
    function rotateVec(v) {
      var ix = qw * v.x + qy * v.z - qz * v.y;
      var iy = qw * v.y + qz * v.x - qx * v.z;
      var iz = qw * v.z + qx * v.y - qy * v.x;
      var iw = -qx * v.x - qy * v.y - qz * v.z;
      return {
        x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
        y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
        z: iz * qw + iw * -qz + ix * -qy - iy * -qx
      };
    }
    var fwd = rotateVec(fw);
    var upd = rotateVec(up);

    // Use deprecated API for broad browser compat
    if (listener.setPosition) {
      listener.setPosition(position.x, position.y, position.z);
    }
    if (listener.setOrientation) {
      listener.setOrientation(fwd.x, fwd.y, fwd.z, upd.x, upd.y, upd.z);
    }
  };

  // Auto-load sounds on startup
  if (typeof fetch === 'function') {
    window.loadSoundsFromServer();
  }

})();
