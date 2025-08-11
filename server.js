/**
 * Simple LAN relay server for Paintball Arena multiplayer (2 players per room).
 * - Serves static files from this directory
 * - Socket.IO for signaling: create/join rooms, relay client inputs to host, host snapshots to clients
 * - Stores per-room settings (fire rate, mag size, reload time, player health, player damage)
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
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Serve static files from this directory
app.use(express.static(__dirname));

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
  socket.on('startRound', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    // forward to non-hosts
    socket.to(currentRoom).emit('startRound', payload);
  });

  socket.on('roundResult', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    socket.to(currentRoom).emit('roundResult', payload);
  });

  socket.on('matchOver', (payload) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    socket.to(currentRoom).emit('matchOver', payload);
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
      try { socket.leave(currentRoom); } catch {}
    } else {
      // Client leaving: remove from room and notify host
      room.players.delete(socket.id);
      try { socket.leave(currentRoom); } catch {}
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
    }
    currentRoom = null;
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.players.delete(socket.id);

    if (socket.id === room.hostId) {
      // Host left: close room
      io.to(currentRoom).emit('roomClosed');
      rooms.delete(currentRoom);
    } else {
      // Client left
      io.to(room.hostId).emit('clientLeft', { clientId: socket.id });
      if (room.players.size === 1) {
        // Only host remains; keep the room open
      }
    }
  });
});

function sanitizeSettings(s) {
  s = s || {};
  const out = {
    // ms between shots (fire cooldown)
    fireCooldownMs: clampInt(s.fireCooldownMs, 50, 2000, 166),
    // bullets per magazine
    magSize: clampInt(s.magSize, 1, 200, 6),
    // seconds to reload
    reloadTimeSec: clampNumber(s.reloadTimeSec, 0.2, 10, 2.5),
    // starting/max health
    playerHealth: clampInt(s.playerHealth, 1, 1000, 100),
    // damage per hit
    playerDamage: clampInt(s.playerDamage, 1, 500, 20),
  };
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
