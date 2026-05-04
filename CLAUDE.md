# RemoteView — Контекст проекта

## Что это

Браузерный сервис трансляции экрана (аналог TeamViewer). Хост делится экраном через уникальную магик-ссылку, зритель открывает ссылку и видит экран в реальном времени. Без установки, только браузер.

## Ссылки

- **Продакшн:** https://remote-view-production.up.railway.app
- **GitHub:** https://github.com/ivanforgegames-lang/remote-view
- **Хостинг:** Railway (бесплатный тариф, $5/месяц кредит)
- **Локально:** http://localhost:3000

## Архитектура

```
[Хост-браузер] <-- WebRTC P2P видео --> [Зритель-браузер]
      |                                         |
      +------- WebSocket сигналинг --------+
                      |
              [Node.js сервер]
           (только relay, не видео)
```

**Безопасность:** каждая сессия получает уникальный токен (48 hex символов). Без токена в ссылке — доступ закрыт (код 4001).

## Файлы

| Файл | Назначение |
|------|-----------|
| `server.js` | Express + WebSocket сервер. Создаёт комнаты, релеит сигналы между хостом и зрителем. In-memory хранение комнат. |
| `public/index.html` | Страница хоста. Три состояния: старт → сессия активна → ошибка. |
| `public/join.html` | Страница зрителя. Открывается по `/join/:roomId?token=...` |
| `public/style.css` | Общие стили. Тёмная тема, CSS переменные. |

## Запуск локально

```bash
cd C:\Projects\remote-view
npm install
node server.js
# Открыть: http://localhost:3000
```

## Деплой на Railway

Railway автоматически деплоит при пуше в GitHub.

```bash
git add .
git commit -m "описание изменений"
git push
```

**Переменные Railway:** `PORT=3000`

Логи: Railway → проект → Deployments → View logs

## WebRTC flow

1. Хост: `POST /api/create-room` → получает roomId + token + joinUrl
2. Хост: показывает ссылку → подключается к WS как `role=host` → вызывает `getDisplayMedia()`
3. Зритель: открывает ссылку → подключается к WS как `role=viewer`
4. Сервер: отправляет хосту `{type: 'viewer-joined'}`
5. Хост: создаёт RTCPeerConnection → addTracks → createOffer → отправляет через WS
6. Зритель: setRemoteDescription → createAnswer → отправляет через WS
7. Обмен ICE кандидатами через WS
8. P2P соединение установлено → видео идёт напрямую

## ICE серверы

```js
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]
```

## Логирование

- Сервер логирует всё в stdout: `[timestamp] [level] [room:id] message`
- Клиент отправляет события через `POST /api/log` → попадают в те же логи с префиксом `CLIENT:`
- Детектор чёрного экрана в `join.html`: каждые 5 сек сэмплирует 16×16 пикселей видео, логирует если яркость < 8

## Известные ограничения

- **iOS (iPhone/iPad):** `getDisplayMedia` не поддерживается — только просмотр, не трансляция
- **Один зритель:** архитектура поддерживает только одного зрителя на комнату
- **In-memory:** комнаты хранятся в памяти сервера, при перезапуске удаляются
- **TURN:** используется бесплатный публичный сервер openrelay — для продакшна с нагрузкой лучше свой

## Что можно добавить

- [ ] Несколько зрителей одновременно (нужен SFU или mesh)
- [ ] Чат между хостом и зрителем (через WebSocket data channel)
- [ ] Управление мышью/клавиатурой (нужен нативный агент на хосте)
- [ ] Своё доменное имя
- [ ] Аутентификация пользователей
- [ ] История сессий в БД
