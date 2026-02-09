const { contextBridge } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE = path.join(__dirname);

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
  fs.writeFileSync(path.join(dir, clean + '.json'), JSON.stringify(data, null, 2), 'utf8');
  return { ok: true, status: 200 };
}

function deleteJSON(subdir, name) {
  var clean = sanitize(name);
  if (!clean) return { error: 'Invalid name', status: 400 };
  var filePath = path.join(BASE, subdir, clean + '.json');
  if (!fs.existsSync(filePath)) return { error: 'Not found', status: 404 };
  fs.unlinkSync(filePath);
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
  deleteWeaponModel: function (name)       { return deleteJSON('weapon-models', name); }
});
