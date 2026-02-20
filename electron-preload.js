const { contextBridge } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BASE = path.join(__dirname);

// ---- Server process management ----
var _serverProc = null;
var _serverStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
var _serverError = null;
var _serverLog = [];       // ring buffer of {id, text} entries
var _serverLogId = 0;
var _serverLogMax = 500;

function _serverPushLog(text) {
  _serverLogId++;
  _serverLog.push({ id: _serverLogId, text: text });
  if (_serverLog.length > _serverLogMax) _serverLog.shift();
}

function _serverStart() {
  if (_serverProc) return { ok: false, error: 'Already running' };
  _serverStatus = 'starting';
  _serverError = null;
  _serverLog = [];
  _serverLogId = 0;

  var nodePath = '/opt/homebrew/bin/node';
  _serverProc = spawn(nodePath, ['server.js'], { cwd: BASE, stdio: ['ignore', 'pipe', 'pipe'] });

  _serverProc.stdout.on('data', function (data) {
    var lines = data.toString().split('\n');
    lines.forEach(function (line) {
      if (!line) return;
      _serverPushLog(line);
      if (line.indexOf('listening') !== -1) {
        _serverStatus = 'running';
      }
    });
  });

  _serverProc.stderr.on('data', function (data) {
    var lines = data.toString().split('\n');
    lines.forEach(function (line) {
      if (!line) return;
      _serverPushLog('[ERR] ' + line);
      if (line.indexOf('EADDRINUSE') !== -1) {
        _serverStatus = 'error';
        _serverError = 'Port already in use';
      }
    });
  });

  _serverProc.on('error', function (err) {
    _serverStatus = 'error';
    _serverError = err.message;
    _serverPushLog('[ERR] ' + err.message);
    _serverProc = null;
  });

  _serverProc.on('close', function (code) {
    if (_serverStatus !== 'error') {
      _serverStatus = 'stopped';
    }
    _serverPushLog('[Server exited with code ' + code + ']');
    _serverProc = null;
  });

  return { ok: true };
}

function _serverStop() {
  if (!_serverProc) return { ok: false, error: 'Not running' };
  var proc = _serverProc;
  proc.kill('SIGTERM');
  // Fallback SIGKILL after 3s
  var killTimer = setTimeout(function () {
    try { proc.kill('SIGKILL'); } catch (e) {}
  }, 3000);
  proc.on('close', function () { clearTimeout(killTimer); });
  return { ok: true };
}

// Clean up server on app quit
process.on('exit', function () {
  if (_serverProc) {
    try { _serverProc.kill('SIGKILL'); } catch (e) {}
  }
});

function sanitize(name) {
  if (typeof name !== 'string') return null;
  var clean = name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
  return clean.length > 0 ? clean : null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function listJSON(subdir) {
  var dir = path.join(BASE, subdir);
  ensureDir(dir);
  return fs.readdirSync(dir)
    .filter(function (f) { return f.endsWith('.json'); })
    .map(function (f) { return f.replace(/\.json$/, ''); });
}

function readJSON(subdir, name) {
  var clean = sanitize(name);
  if (!clean) return { error: 'Invalid name', status: 400 };
  var filePath = path.join(BASE, subdir, clean + '.json');
  if (!fs.existsSync(filePath)) return { error: 'Not found', status: 404 };
  return { data: JSON.parse(fs.readFileSync(filePath, 'utf8')), status: 200 };
}

function writeJSON(subdir, name, data) {
  var clean = sanitize(name);
  if (!clean) return { error: 'Invalid name', status: 400 };
  var dir = path.join(BASE, subdir);
  ensureDir(dir);
  try {
    fs.writeFileSync(path.join(dir, clean + '.json'), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    return { error: err.message, status: 500 };
  }
  return { ok: true, status: 200 };
}

function deleteJSON(subdir, name) {
  var clean = sanitize(name);
  if (!clean) return { error: 'Invalid name', status: 400 };
  var filePath = path.join(BASE, subdir, clean + '.json');
  if (!fs.existsSync(filePath)) return { error: 'Not found', status: 404 };
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    return { error: err.message, status: 500 };
  }
  return { ok: true, status: 200 };
}

contextBridge.exposeInMainWorld('devAPI', {
  listMaps:          function ()           { return listJSON('maps'); },
  readMap:           function (name)       { return readJSON('maps', name); },
  writeMap:          function (name, data) { return writeJSON('maps', name, data); },
  deleteMap:         function (name)       { return deleteJSON('maps', name); },

  listHeroes:        function ()           { return listJSON('heroes'); },
  readHero:          function (name)       { return readJSON('heroes', name); },
  writeHero:         function (name, data) { return writeJSON('heroes', name, data); },
  deleteHero:        function (name)       { return deleteJSON('heroes', name); },

  listWeaponModels:  function ()           { return listJSON('weapon-models'); },
  readWeaponModel:   function (name)       { return readJSON('weapon-models', name); },
  writeWeaponModel:  function (name, data) { return writeJSON('weapon-models', name, data); },
  deleteWeaponModel: function (name)       { return deleteJSON('weapon-models', name); },

  listMenus:         function ()           { return listJSON('menus'); },
  readMenu:          function (name)       { return readJSON('menus', name); },
  writeMenu:         function (name, data) { return writeJSON('menus', name, data); },
  deleteMenu:        function (name)       { return deleteJSON('menus', name); },

  listSounds:        function ()           { return listJSON('sounds'); },
  readSound:         function (name)       { return readJSON('sounds', name); },
  writeSound:        function (name, data) { return writeJSON('sounds', name, data); },
  deleteSound:       function (name)       { return deleteJSON('sounds', name); },

  readHeroSounds:    function () {
    var filePath = path.join(BASE, 'sounds', 'hero_sounds.json');
    if (!fs.existsSync(filePath)) return {};
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return {}; }
  },
  writeHeroSounds:   function (data) {
    ensureDir(path.join(BASE, 'sounds'));
    try {
      fs.writeFileSync(path.join(BASE, 'sounds', 'hero_sounds.json'), JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  },
  listSoundFiles:    function () {
    var dir = path.join(BASE, 'sounds', 'files');
    ensureDir(dir);
    return fs.readdirSync(dir);
  },
  writeSoundFile:    function (filename, base64Data) {
    var dir = path.join(BASE, 'sounds', 'files');
    ensureDir(dir);
    try {
      var buf = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(path.join(dir, filename), buf);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  },
  deleteSoundFile:   function (filename) {
    var filePath = path.join(BASE, 'sounds', 'files', filename);
    if (!fs.existsSync(filePath)) return { error: 'Not found' };
    try { fs.unlinkSync(filePath); return { ok: true }; } catch (e) { return { error: e.message }; }
  },
  listWeaponModelFiles: function () {
    var dir = path.join(BASE, 'weapon-models', 'files');
    ensureDir(dir);
    return fs.readdirSync(dir);
  },
  readWeaponModelFile: function (filename) {
    var filePath = path.join(BASE, 'weapon-models', 'files', filename);
    if (!fs.existsSync(filePath)) return { error: 'Not found' };
    try {
      var buf = fs.readFileSync(filePath);
      // Return as Uint8Array (can be used as ArrayBuffer source)
      return new Uint8Array(buf).buffer;
    } catch (e) { return { error: e.message }; }
  },
  writeWeaponModelFile: function (filename, base64Data) {
    var dir = path.join(BASE, 'weapon-models', 'files');
    ensureDir(dir);
    try {
      var buf = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(path.join(dir, filename), buf);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  },
  deleteWeaponModelFile: function (filename) {
    var filePath = path.join(BASE, 'weapon-models', 'files', filename);
    if (!fs.existsSync(filePath)) return { error: 'Not found' };
    try { fs.unlinkSync(filePath); return { ok: true }; } catch (e) { return { error: e.message }; }
  },

  serverStart:       function ()           { return _serverStart(); },
  serverStop:        function ()           { return _serverStop(); },
  serverStatus:      function ()           { return { status: _serverStatus, error: _serverError }; },
  serverLogs:        function (sinceId)    {
    var since = sinceId || 0;
    var newLines = _serverLog.filter(function (entry) { return entry.id > since; });
    return newLines;
  }
});
