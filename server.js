const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { createServer } = require('http');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/join/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// rooms: Map<roomId, { token, host: WebSocket|null, viewer: WebSocket|null }>
const rooms = new Map();

app.post('/api/create-room', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  const token = crypto.randomBytes(24).toString('hex');
  rooms.set(roomId, { token, host: null, viewer: null });

  // Удаляем комнату через 24 часа
  setTimeout(() => rooms.delete(roomId), 24 * 3600 * 1000);

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const joinUrl = `${proto}://${req.get('host')}/join/${roomId}?token=${token}`;
  res.json({ roomId, token, joinUrl });
});

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const roomId = params.get('roomId');
  const token = params.get('token');
  const role = params.get('role');

  const room = rooms.get(roomId);

  if (!room || room.token !== token || !['host', 'viewer'].includes(role)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.roomId = roomId;
  ws.role = role;
  room[role] = ws;

  if (role === 'viewer') {
    // Уведомляем хоста о новом зрителе
    if (room.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'viewer-joined' }));
    }
  } else if (role === 'host') {
    // Если зритель уже ждёт — сразу уведомляем хоста
    if (room.viewer?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'viewer-joined' }));
    }
  }

  ws.on('message', (data) => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    const peer = ws.role === 'host' ? room.viewer : room.host;
    if (peer?.readyState === WebSocket.OPEN) peer.send(data.toString());
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room[ws.role] = null;

    if (ws.role === 'host') {
      room.viewer?.close(4002, 'Host disconnected');
      rooms.delete(ws.roomId);
    } else if (room.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'viewer-left' }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`RemoteView запущен: http://localhost:${PORT}`);
});
