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

// ── Логгер ──────────────────────────────────────────────
function log(level, roomId, message, extra = {}) {
  const ts = new Date().toISOString();
  const room = roomId || '-';
  const extraStr = Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  console.log(`[${ts}] [${level}] [room:${room}] ${message}${extraStr}`);
}

// ── Хранилище комнат ─────────────────────────────────────
// rooms: Map<roomId, { token, host: WebSocket|null, viewer: WebSocket|null, createdAt }>
const rooms = new Map();

// ── REST: создать комнату ─────────────────────────────────
app.post('/api/create-room', (req, res) => {
  const roomId = crypto.randomBytes(4).toString('hex');
  const token = crypto.randomBytes(24).toString('hex');
  rooms.set(roomId, { token, host: null, viewer: null, createdAt: Date.now() });

  setTimeout(() => {
    rooms.delete(roomId);
    log('INFO', roomId, 'Комната удалена по таймауту (24ч)');
  }, 24 * 3600 * 1000);

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const joinUrl = `${proto}://${req.get('host')}/join/${roomId}?token=${token}`;
  log('INFO', roomId, 'Комната создана', { ip: req.ip });
  res.json({ roomId, token, joinUrl });
});

// ── REST: приём логов с клиента ───────────────────────────
app.post('/api/log', (req, res) => {
  const { level = 'INFO', roomId, message, data } = req.body || {};
  log(`CLIENT:${level}`, roomId, message, data || {});
  res.sendStatus(204);
});

// ── WebSocket: сигнальный сервер ──────────────────────────
wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const roomId = params.get('roomId');
  const token = params.get('token');
  const role = params.get('role');

  const room = rooms.get(roomId);

  if (!room || room.token !== token || !['host', 'viewer'].includes(role)) {
    log('WARN', roomId, `Отклонено подключение: неверный токен или роль`, { role });
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.roomId = roomId;
  ws.role = role;
  room[role] = ws;

  log('INFO', roomId, `${role === 'host' ? 'Хост' : 'Зритель'} подключился`);

  if (role === 'viewer') {
    if (room.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'viewer-joined' }));
      log('INFO', roomId, 'Хост уведомлён о зрителе');
    }
  } else if (role === 'host') {
    if (room.viewer?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'viewer-joined' }));
      log('INFO', roomId, 'Хост уведомлён о ждущем зрителе');
    }
  }

  ws.on('message', (data) => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'candidate') {
        log('DEBUG', ws.roomId, `Сигнал: ${msg.type}`, { from: ws.role });
      }
    } catch {}
    const peer = ws.role === 'host' ? room.viewer : room.host;
    if (peer?.readyState === WebSocket.OPEN) peer.send(data.toString());
  });

  ws.on('close', (code) => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    room[ws.role] = null;

    log('INFO', ws.roomId, `${ws.role === 'host' ? 'Хост' : 'Зритель'} отключился`, { code });

    if (ws.role === 'host') {
      room.viewer?.close(4002, 'Host disconnected');
      rooms.delete(ws.roomId);
      log('INFO', ws.roomId, 'Комната закрыта');
    } else if (room.host?.readyState === WebSocket.OPEN) {
      room.host.send(JSON.stringify({ type: 'viewer-left' }));
    }
  });

  ws.on('error', (err) => {
    log('ERROR', ws.roomId, `WebSocket ошибка (${ws.role})`, { error: err.message });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log('INFO', null, `RemoteView запущен на порту ${PORT}`);
});
