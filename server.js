/**
 * Simple LAN relay server for Paintball Arena multiplayer (2 players per room).
 * - Serves static files from this directory
 * - Socket.IO for signaling: create/join rooms, relay client inputs to host, host snapshots to clients
 * - Stores per-room settings (rounds to win)
 *
 * Run:
 *   npm init -y
 *   npm install express socket.io
 *   node server.js
 *
 * Then allow Windows Defender on Private networks if prompted.
 * Join from other device on LAN via: http://YOUR_LAN_IP:3000
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// JSON body parsing for map API
app.use(express.json({ limit: '1mb' }));

// Block dev workbench files from being served to LAN players
var DEV_BLOCKED = ['/dev.html', '/devApp.js', '/devApp.css', '/devHeroEditor.js', '/devSplitScreen.js',
  '/electron-main.js', '/electron-preload.js', '/electron-fetch-shim.js', '/mapEditor.js', '/menuBuilder.js'];
app.use(function (req, res, next) {
  if (DEV_BLOCKED.indexOf(req.path) !== -1) return res.status(404).end();
  next();
});

// Serve static files from this directory
app.use(express.static(__dirname));

// ── Map REST API ──
const MAPS_DIR = path.join(__dirname, 'maps');

function sanitizeMapName(name) {
  if (typeof name !== 'string') return null;
  var clean = name.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
  return clean.length > 0 ? clean : null;
}

// Ensure maps/ directory exists
function ensureMapsDir() {
  if (!fs.existsSync(MAPS_DIR)) {
    fs.mkdirSync(MAPS_DIR, { recursive: true });
  }
}

// List all map names
app.get('/api/maps', function (req, res) {
  ensureMapsDir();
  try {
    var files = fs.readdirSync(MAPS_DIR).filter(function (f) { return f.endsWith('.json'); });
    var names = files.map(function (f) { return f.replace(/\.json$/, ''); });
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list maps' });
  }
});

// Get a specific map
app.get('/api/maps/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid map name' });
  var filePath = path.join(MAPS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Map not found' });
  try {
    var data = fs.readFileSync(filePath, 'utf8');
    res.type('json').send(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read map' });
  }
});

// Save a map
app.post('/api/maps/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid map name' });
  ensureMapsDir();
  try {
    fs.writeFileSync(path.join(MAPS_DIR, name + '.json'), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save map' });
  }
});

// Delete a map
app.delete('/api/maps/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid map name' });
  var filePath = path.join(MAPS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Map not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete map' });
  }
});

// ── Menu REST API ──
const MENUS_DIR = path.join(__dirname, 'menus');

function ensureMenusDir() {
  if (!fs.existsSync(MENUS_DIR)) fs.mkdirSync(MENUS_DIR, { recursive: true });
}

app.get('/api/menus', function (req, res) {
  ensureMenusDir();
  try {
    var files = fs.readdirSync(MENUS_DIR).filter(function (f) { return f.endsWith('.json'); });
    var names = files.map(function (f) { return f.replace(/\.json$/, ''); });
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list menus' });
  }
});

app.get('/api/menus/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid menu name' });
  var filePath = path.join(MENUS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Menu not found' });
  try {
    var data = fs.readFileSync(filePath, 'utf8');
    res.type('json').send(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read menu' });
  }
});

app.post('/api/menus/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid menu name' });
  ensureMenusDir();
  try {
    fs.writeFileSync(path.join(MENUS_DIR, name + '.json'), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save menu' });
  }
});

app.delete('/api/menus/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid menu name' });
  var filePath = path.join(MENUS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Menu not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete menu' });
  }
});

// ── Hero REST API (read-only — editing happens in the Electron dev workbench) ──
const HEROES_DIR = path.join(__dirname, 'heroes');

function ensureHeroesDir() {
  if (!fs.existsSync(HEROES_DIR)) {
    fs.mkdirSync(HEROES_DIR, { recursive: true });
  }
}

// Seed built-in heroes as JSON files if they don't already exist.
// The canonical hero data lives in heroes.js (browser-side), so we duplicate
// just enough here to bootstrap the files. The dev workbench is the editor.
(function seedBuiltinHeroes() {
  ensureHeroesDir();
  var builtins = [
    { id: 'marksman', name: 'Marksman', description: 'Precise single-shot marker. High accuracy, moderate fire rate.', color: 0x66ffcc, maxHealth: 100, walkSpeed: 4.5, sprintSpeed: 8.5, jumpVelocity: 8.5, hitbox: { width: 0.8, height: 3.2, depth: 0.8 }, modelType: 'standard', weapon: { cooldownMs: 166, magSize: 6, reloadTimeSec: 2.5, damage: 20, spreadRad: 0, sprintSpreadRad: 0.012, maxRange: 200, pellets: 1, projectileSpeed: null, projectileGravity: 0, splashRadius: 0, scope: { type: 'scope', zoomFOV: 35, overlay: null, spreadMultiplier: 0.15 }, modelType: 'rifle', tracerColor: 0x66ffcc, crosshair: { style: 'cross', baseSpreadPx: 8, sprintSpreadPx: 20, color: '#00ffaa' }, abilities: [] }, passives: [], abilities: [] },
    { id: 'brawler', name: 'Brawler', description: 'Devastating close-range shotgun. 8 pellets per blast.', color: 0xff8844, maxHealth: 120, walkSpeed: 4.2, sprintSpeed: 8.0, jumpVelocity: 8.5, hitbox: { width: 0.9, height: 3.2, depth: 0.9 }, modelType: 'standard', weapon: { cooldownMs: 600, magSize: 4, reloadTimeSec: 3.0, damage: 8, spreadRad: 0.06, sprintSpreadRad: 0.10, maxRange: 60, pellets: 8, projectileSpeed: null, projectileGravity: 0, splashRadius: 0, scope: { type: 'ironsights', zoomFOV: 55, overlay: null, spreadMultiplier: 0.5 }, modelType: 'shotgun', tracerColor: 0xff8844, crosshair: { style: 'circle', baseSpreadPx: 24, sprintSpreadPx: 40, color: '#ff8844' }, abilities: [] }, passives: [], abilities: [] }
  ];
  builtins.forEach(function (hero) {
    var filePath = path.join(HEROES_DIR, hero.id + '.json');
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(hero, null, 2), 'utf8');
    }
  });
})();

app.get('/api/heroes', function (req, res) {
  ensureHeroesDir();
  try {
    var files = fs.readdirSync(HEROES_DIR).filter(function (f) { return f.endsWith('.json'); });
    var names = files.map(function (f) { return f.replace(/\.json$/, ''); });
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list heroes' });
  }
});

app.get('/api/heroes/:id', function (req, res) {
  var name = sanitizeMapName(req.params.id);
  if (!name) return res.status(400).json({ error: 'Invalid hero id' });
  var filePath = path.join(HEROES_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Hero not found' });
  try {
    var data = fs.readFileSync(filePath, 'utf8');
    res.type('json').send(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read hero' });
  }
});

// roomId -> { hostId: string, players: Set<string>, settings: object }
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  // Create a room and mark this socket as host
  socket.on('createRoom', (roomId, settings, ack) => {
    if (!roomId || typeof roomId !== 'string') {
      return typeof ack === 'function' && ack({ ok: false, error: 'Invalid roomId' });
    }
    if (rooms.has(roomId)) {
      return typeof ack === 'function' && ack({ ok: false, error: 'Room already exists' });
    }
    rooms.set(roomId, { hostId: socket.id, players: new Set([socket.id]), settings: sanitizeSettings(settings) });
    socket.join(roomId);
    currentRoom = roomId;
    typeof ack === 'function' && ack({ ok: true, role: 'host', playerNumber: 1 });
  });

  // Join an existing room as a client (non-host)
  socket.on('joinRoom', (roomId, ack) => {
    const room = rooms.get(roomId);
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (room.players.size >= 2) return typeof ack === 'function' && ack({ ok: false, error: 'Room full' });

    room.players.add(socket.id);
    socket.join(roomId);
    currentRoom = roomId;

    // Notify host that client joined
    io.to(room.hostId).emit('clientJoined', { clientId: socket.id });

    // Tell joiner who the host is and the settings
    typeof ack === 'function' && ack({ ok: true, role: 'client', playerNumber: 2, hostId: room.hostId, settings: room.settings || {} });
  });

  // Client input -> to host
  socket.on('input', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (socket.id !== room.hostId) {
      io.to(room.hostId).emit('input', { clientId: socket.id, ...payload });
    }
  });

  // Host snapshots -> to everyone else
  socket.on('snapshot', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    socket.to(currentRoom).emit('snapshot', payload);
  });

  // Optional: host can update settings mid-room and notify client
  socket.on('updateSettings', (settings) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    room.settings = sanitizeSettings(settings);
    socket.to(currentRoom).emit('settings', room.settings);
  });

  // Host-triggered round control relays
  function relayHostEvent(eventName) {
    socket.on(eventName, function (payload) {
      var room = rooms.get(currentRoom);
      if (!room || socket.id !== room.hostId) return;
      socket.to(currentRoom).emit(eventName, payload);
    });
  }
  relayHostEvent('startRound');
  relayHostEvent('roundResult');
  relayHostEvent('matchOver');
  relayHostEvent('startHeroSelect');
  relayHostEvent('heroesConfirmed');

  // heroSelect — bidirectional relay (either player to the other)
  socket.on('heroSelect', function (payload) {
    var room = rooms.get(currentRoom);
    if (!room) return;
    socket.to(currentRoom).emit('heroSelect', payload);
  });

  // Relay shot visual events from host to clients (for tracers)
  socket.on('shot', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    // payload: { o:[x,y,z], e:[x,y,z], c:number }
    socket.to(currentRoom).emit('shot', payload);
  });

  // Explicit leave: if host calls this, close the room; if client, just leave
  socket.on('leaveRoom', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) {
      currentRoom = null;
      return;
    }
    if (socket.id === room.hostId) {
      // Host leaving: close room and notify any clients
      io.to(currentRoom).emit('roomClosed');
      rooms.delete(currentRoom);
      // Host implicitly leaves via disconnect or socket.leave
      try { socket.leave(currentRoom); } catch (e) { console.warn('socket.leave failed:', e); }
    } else {
      // Client leaving: remove from room and notify host
      room.players.delete(socket.id);
      try { socket.leave(currentRoom); } catch (e) { console.warn('socket.leave failed:', e); }
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
    }
    currentRoom = null;
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) { currentRoom = null; return; }

    room.players.delete(socket.id);

    if (socket.id === room.hostId) {
      // Host left: close room
      io.to(currentRoom).emit('roomClosed');
      rooms.delete(currentRoom);
    } else {
      // Client left
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
    }
    currentRoom = null;
  });
});

function sanitizeSettings(s) {
  s = s || {};
  const out = {
    roundsToWin: clampInt(s.roundsToWin, 1, 10, 2),
  };
  if (s.mapName && typeof s.mapName === 'string') out.mapName = s.mapName.substring(0, 100);
  return out;
}

function clampInt(v, min, max, def) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function clampNumber(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`LAN server listening at http://${HOST}:${PORT}`);
});
