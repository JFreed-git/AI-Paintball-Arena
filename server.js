/**
 * LAN relay server for Paintball Arena multiplayer (up to 8 players per room).
 * - Serves static files from this directory
 * - Socket.IO for signaling: create/join rooms, relay client inputs to host, host snapshots to clients
 * - Stores per-room settings (rounds to win, max players)
 * - Lobby infrastructure: player names, ready state, player list broadcast
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
  '/electron-main.js', '/electron-preload.js', '/electron-fetch-shim.js', '/mapEditor.js', '/menuBuilder.js',
  '/devConsole.js', '/devAudioManager.js', '/build.js'];
app.use(function (req, res, next) {
  if (DEV_BLOCKED.indexOf(req.path) !== -1) return res.status(404).end();
  next();
});

// ── Production mode: serve minified bundle instead of source files ──
var BUNDLE_PATH = path.join(__dirname, 'bundle.min.js');
var PRODUCTION = fs.existsSync(BUNDLE_PATH);
if (PRODUCTION) {
  // Build a production index.html that loads the bundle instead of individual scripts
  var rawHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  // Replace individual game script tags with a single bundle reference
  var productionHtml = rawHtml
    .replace(/\s*<!-- Core systems[\s\S]*?<script src="devConsole\.js"><\/script>/, '\n    <script src="bundle.min.js"></script>')
    .replace(/<div id="devConsole"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');

  app.get('/', function (req, res) { res.type('html').send(productionHtml); });
  app.get('/index.html', function (req, res) { res.type('html').send(productionHtml); });

  // Block all game source .js files (allow bundle, socket.io, and CDN)
  app.use(function (req, res, next) {
    if (req.path.endsWith('.js') && req.path !== '/bundle.min.js'
        && !req.path.startsWith('/socket.io')) {
      return res.status(404).end();
    }
    next();
  });
  console.log('[server] Production mode: serving minified bundle');
} else {
  console.log('[server] Dev mode: serving individual source files');
}

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

// ── Sound REST API ──
const SOUNDS_DIR = path.join(__dirname, 'sounds');

function ensureSoundsDir() {
  if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });
}

app.get('/api/sounds', function (req, res) {
  ensureSoundsDir();
  try {
    var files = fs.readdirSync(SOUNDS_DIR).filter(function (f) { return f.endsWith('.json'); });
    var names = files.map(function (f) { return f.replace(/\.json$/, ''); });
    res.json(names);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sounds' });
  }
});

app.get('/api/sounds/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid sound name' });
  var filePath = path.join(SOUNDS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Sound not found' });
  try {
    var data = fs.readFileSync(filePath, 'utf8');
    res.type('json').send(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read sound' });
  }
});

app.post('/api/sounds/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid sound name' });
  ensureSoundsDir();
  try {
    fs.writeFileSync(path.join(SOUNDS_DIR, name + '.json'), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save sound' });
  }
});

app.delete('/api/sounds/:name', function (req, res) {
  var name = sanitizeMapName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid sound name' });
  var filePath = path.join(SOUNDS_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Sound not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sound' });
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
    {
      id: 'marksman', name: 'Marksman', description: 'Precise single-shot marker. High accuracy, moderate fire rate.', color: 0x66ffcc,
      maxHealth: 100, walkSpeed: 4.5, sprintSpeed: 8.5, jumpVelocity: 8.5,
      hitbox: [
        { name: "head", width: 0.5, height: 0.5, depth: 0.5, offsetY: 2.95, damageMultiplier: 2.0 },
        { name: "torso", width: 0.6, height: 0.9, depth: 0.5, offsetY: 2.05, damageMultiplier: 1.0 },
        { name: "legs", width: 0.5, height: 1.1, depth: 0.5, offsetY: 0.55, damageMultiplier: 0.75 }
      ],
      modelType: 'standard',
      weapon: { cooldownMs: 166, magSize: 6, reloadTimeSec: 2.5, damage: 20, spreadRad: 0, sprintSpreadRad: 0.012, maxRange: 200, pellets: 1, projectileSpeed: 120, projectileGravity: 0, splashRadius: 0, scope: { type: 'scope', zoomFOV: 35, overlay: null, spreadMultiplier: 0.15 }, modelType: 'rifle', tracerColor: 0x66ffcc, crosshair: { style: 'cross', baseSpreadPx: 8, sprintSpreadPx: 20, color: '#00ffaa' }, meleeDamage: 25, meleeRange: 2.0, meleeCooldownMs: 600, meleeSwingMs: 350, meleeUseHitMultiplier: true, abilities: [] },
      bodyParts: [
        { name: "head", shape: "sphere", radius: 0.25, offsetX: 0, offsetY: 1.6, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
        { name: "torso", shape: "cylinder", radius: 0.275, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
      ],
      passives: [], abilities: []
    },
    {
      id: 'brawler', name: 'Brawler', description: 'Devastating close-range shotgun. 8 pellets per blast.', color: 0xff8844,
      maxHealth: 120, walkSpeed: 4.2, sprintSpeed: 8.0, jumpVelocity: 8.5,
      hitbox: [
        { name: "head", width: 0.55, height: 0.5, depth: 0.55, offsetY: 2.95, damageMultiplier: 2.0 },
        { name: "torso", width: 0.7, height: 0.9, depth: 0.55, offsetY: 2.05, damageMultiplier: 1.0 },
        { name: "legs", width: 0.55, height: 1.1, depth: 0.55, offsetY: 0.55, damageMultiplier: 0.75 }
      ],
      modelType: 'standard',
      weapon: { cooldownMs: 600, magSize: 4, reloadTimeSec: 3.0, damage: 8, spreadRad: 0.06, sprintSpreadRad: 0.10, maxRange: 60, pellets: 8, projectileSpeed: 120, projectileGravity: 0, splashRadius: 0, scope: { type: 'ironsights', zoomFOV: 55, overlay: null, spreadMultiplier: 0.5 }, modelType: 'shotgun', tracerColor: 0xff8844, crosshair: { style: 'circle', baseSpreadPx: 24, sprintSpreadPx: 40, color: '#ff8844' }, meleeDamage: 40, meleeRange: 3.0, meleeCooldownMs: 600, meleeSwingMs: 350, meleeUseHitMultiplier: true, abilities: [] },
      bodyParts: [
        { name: "head", shape: "sphere", radius: 0.275, offsetX: 0, offsetY: 1.6, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 },
        { name: "torso", shape: "cylinder", radius: 0.3, height: 0.9, offsetX: 0, offsetY: 1.1, offsetZ: 0, rotationX: 0, rotationY: 0, rotationZ: 0 }
      ],
      passives: [], abilities: []
    }
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

// Save a hero
app.post('/api/heroes/:id', function (req, res) {
  var name = sanitizeMapName(req.params.id);
  if (!name) return res.status(400).json({ error: 'Invalid hero id' });
  ensureHeroesDir();
  try {
    fs.writeFileSync(path.join(HEROES_DIR, name + '.json'), JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save hero' });
  }
});

// Delete a hero
app.delete('/api/heroes/:id', function (req, res) {
  var name = sanitizeMapName(req.params.id);
  if (!name) return res.status(400).json({ error: 'Invalid hero id' });
  var filePath = path.join(HEROES_DIR, name + '.json');
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Hero not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete hero' });
  }
});

// roomId -> { hostId, players: Set, settings, playerNames: Map, readyState: Map }
const rooms = new Map();

// Build the player list payload for a room
function buildPlayerList(room) {
  var list = [];
  room.players.forEach(function (id) {
    list.push({
      id: id,
      name: room.playerNames.get(id) || 'Player',
      ready: room.readyState.get(id) || false,
      isHost: id === room.hostId
    });
  });
  return list;
}

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
    var sanitized = sanitizeSettings(settings);
    var playerNames = new Map();
    var readyState = new Map();
    var hostName = (settings && typeof settings.playerName === 'string') ? settings.playerName.substring(0, 30) : 'Host';
    playerNames.set(socket.id, hostName);
    readyState.set(socket.id, true); // host is always ready
    rooms.set(roomId, { hostId: socket.id, players: new Set([socket.id]), settings: sanitized, playerNames: playerNames, readyState: readyState });
    socket.join(roomId);
    currentRoom = roomId;
    io.to(roomId).emit('playerList', buildPlayerList(rooms.get(roomId)));
    typeof ack === 'function' && ack({ ok: true, role: 'host', playerNumber: 1 });
  });

  // Join an existing room as a client (non-host)
  socket.on('joinRoom', (roomId, playerName, ack) => {
    // Backward compat: if playerName is a function, it's the old 2-arg call
    if (typeof playerName === 'function') {
      ack = playerName;
      playerName = null;
    }
    const room = rooms.get(roomId);
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (room.players.size >= room.settings.maxPlayers) return typeof ack === 'function' && ack({ ok: false, error: 'Room full' });

    room.players.add(socket.id);
    var name = (playerName && typeof playerName === 'string') ? playerName.substring(0, 30) : ('Player ' + room.players.size);
    room.playerNames.set(socket.id, name);
    room.readyState.set(socket.id, false);
    socket.join(roomId);
    currentRoom = roomId;

    // Notify host that client joined (backward compat)
    io.to(room.hostId).emit('clientJoined', { clientId: socket.id });

    // Broadcast updated player list to all room members
    io.to(roomId).emit('playerList', buildPlayerList(room));

    // Tell joiner who the host is and the settings
    var playerNumber = Array.from(room.players).indexOf(socket.id) + 1;
    typeof ack === 'function' && ack({ ok: true, role: 'client', playerNumber: playerNumber, hostId: room.hostId, settings: room.settings || {} });
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
  relayHostEvent('betweenRoundHeroSelect');
  relayHostEvent('ffaKill');

  // heroSelect — bidirectional relay (either player to the other)
  socket.on('heroSelect', function (payload) {
    var room = rooms.get(currentRoom);
    if (!room) return;
    socket.to(currentRoom).emit('heroSelect', payload);
  });

  // Set ready state for a player in a room
  socket.on('setReady', (roomId, ready) => {
    const room = rooms.get(roomId || currentRoom);
    if (!room || !room.players.has(socket.id)) return;
    room.readyState.set(socket.id, !!ready);
    io.to(roomId || currentRoom).emit('playerList', buildPlayerList(room));
  });

  // Host starts the game — solo start allowed (AI bots are client-side)
  socket.on('startGame', (roomId, ack) => {
    const rid = roomId || currentRoom;
    const room = rooms.get(rid);
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Room not found' });
    if (socket.id !== room.hostId) return typeof ack === 'function' && ack({ ok: false, error: 'Only host can start' });
    var allReady = true;
    room.players.forEach(function (id) {
      if (id !== room.hostId && !room.readyState.get(id)) allReady = false;
    });
    if (!allReady) return typeof ack === 'function' && ack({ ok: false, error: 'Not all players are ready' });
    io.to(rid).emit('gameStarted', { players: buildPlayerList(room), settings: room.settings });
    typeof ack === 'function' && ack({ ok: true });
  });

  // Relay melee visual events from host to clients
  relayHostEvent('melee');

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
      try { socket.leave(currentRoom); } catch (e) { console.warn('socket.leave failed:', e); }
    } else {
      // Client leaving: remove from room and notify host
      var rid = currentRoom;
      room.players.delete(socket.id);
      room.playerNames.delete(socket.id);
      room.readyState.delete(socket.id);
      try { socket.leave(rid); } catch (e) { console.warn('socket.leave failed:', e); }
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
      // Broadcast updated player list
      io.to(rid).emit('playerList', buildPlayerList(room));
    }
    currentRoom = null;
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) { currentRoom = null; return; }

    room.players.delete(socket.id);
    room.playerNames.delete(socket.id);
    room.readyState.delete(socket.id);

    if (socket.id === room.hostId) {
      // Host left: close room
      io.to(currentRoom).emit('roomClosed');
      rooms.delete(currentRoom);
    } else {
      // Client left
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
      // Broadcast updated player list to remaining players
      io.to(currentRoom).emit('playerList', buildPlayerList(room));
    }
    currentRoom = null;
  });
});

function sanitizeSettings(s) {
  s = s || {};
  const out = {
    roundsToWin: clampInt(s.roundsToWin, 1, 10, 2),
    maxPlayers: clampInt(s.maxPlayers, 2, 8, 8),
    killLimit: clampInt(s.killLimit, 1, 50, 10),
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
