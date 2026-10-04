const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_GUESSES = 40;
const MAX_CHAT = 120;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const rooms = new Map();
const profiles = new Map();
const presence = new Map();

function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return rooms.has(code) ? makeCode() : code;
}

function normalizeWord(raw) {
  return String(raw || '').trim().toLowerCase();
}

function classifyWord(word) {
  if (/^[а-яё]{3,16}$/.test(word)) return 'ru';
  if (/^[a-z]{3,16}$/.test(word)) return 'en';
  return null;
}

function markGuess(secret, guess) {
  const marks = Array(guess.length).fill('absent');
  const leftover = {};
  for (let i = 0; i < secret.length; i += 1) {
    if (guess[i] === secret[i]) marks[i] = 'correct';
    else leftover[secret[i]] = (leftover[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < guess.length; i += 1) {
    if (marks[i] === 'correct') continue;
    if (leftover[guess[i]]) {
      marks[i] = 'present';
      leftover[guess[i]] -= 1;
    }
  }
  return marks;
}

function emptyRoom(code) {
  return {
    code,
    game: 'wordle',
    phase: 'lobby',
    host: null,
    guest: null,
    target: { host: null, guest: null },
    submitted: { host: false, guest: false },
    boards: { host: [], guest: [] },
    turn: 'host',
    winner: null,
    chat: [],
    chatSeq: 1,
    drafts: { host: '', guest: '' },
    settings: defaultSettings(),
    fixedLength: null,
    firstPlayer: 'host',
    deadline: null,
  };
}

function defaultSettings() {
  return {
    lengthMode: 'own',
    length: 5,
    timerOn: false,
    minutes: 1,
    seconds: 0,
    hidden: false,
    firstTurn: 'host',
  };
}

function sanitizeSettings(raw) {
  const source = raw || {};
  const lengthMode = ['own', 'exact', 'max', 'first'].includes(source.lengthMode) ? source.lengthMode : 'own';
  const length = clampInt(source.length, 3, 16, 5);
  const minutes = clampInt(source.minutes, 0, 5, 0);
  const seconds = clampInt(source.seconds, 0, 60, 0);
  const timerOn = Boolean(source.timerOn);
  return {
    lengthMode,
    length,
    timerOn,
    minutes: timerOn && minutes === 0 && seconds === 0 ? 0 : minutes,
    seconds: timerOn && minutes === 0 && seconds === 0 ? 1 : seconds,
    hidden: Boolean(source.hidden),
    firstTurn: source.firstTurn === 'random' ? 'random' : 'host',
  };
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function timerMs(settings) {
  return (settings.minutes * 60 + settings.seconds) * 1000;
}

function rollFirst(room) {
  room.firstPlayer = room.settings.firstTurn === 'random'
    ? (crypto.randomInt(2) ? 'guest' : 'host')
    : 'host';
}

function beginTurn(room) {
  room.drafts.host = '';
  room.drafts.guest = '';
  room.deadline = room.phase === 'play' && room.settings.timerOn
    ? Date.now() + timerMs(room.settings)
    : null;
}

function rulesText(room) {
  const settings = room.settings;
  const letters = {
    own: 'от 3 до 16 букв, длину выбирает каждый',
    exact: `ровно ${settings.length} букв`,
    max: `от 3 до ${settings.length} букв`,
    first: 'кто первый отправит слово, задаст длину второму',
  }[settings.lengthMode];
  const timer = settings.timerOn
    ? ` На ход ${String(settings.minutes).padStart(2, '0')}:${String(settings.seconds).padStart(2, '0')}.`
    : '';
  return `Загадайте слово сопернику: ${letters}.${timer}`;
}

function lengthProblem(room, word) {
  const settings = room.settings;
  if (settings.lengthMode === 'exact' && word.length !== settings.length) {
    return `Нужно ровно ${settings.length} букв`;
  }
  if (settings.lengthMode === 'max' && word.length > settings.length) {
    return `Не больше ${settings.length} букв`;
  }
  if (settings.lengthMode === 'first' && room.fixedLength && word.length !== room.fixedLength) {
    return `Первое слово задало длину: ${room.fixedLength} букв`;
  }
  return '';
}

function roleOf(room, token) {
  if (room.host?.token === token) return 'host';
  if (room.guest?.token === token) return 'guest';
  return null;
}

function otherRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

function findByToken(token) {
  if (!token) return null;
  for (const room of rooms.values()) {
    if (roleOf(room, token)) return room;
  }
  return null;
}

function pushChat(room, from, text) {
  room.chat.push({
    id: room.chatSeq,
    from,
    name: from === 'system' ? '' : playerLabel(room, from),
    text,
    at: Date.now(),
  });
  room.chatSeq += 1;
  if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
}

function cleanText(raw) {
  return String(raw || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, 400);
}

function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function cleanAvatar(raw) {
  const value = String(raw || '');
  if (!value) return '';
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return '';
  if (value.length > 100000) return '';
  return value;
}

function playerLabel(room, role) {
  return room[role]?.name || (role === 'host' ? 'Хост' : 'Друг');
}

function applyProfile(slot) {
  const saved = profiles.get(slot.token);
  slot.name = saved?.name || '';
  slot.avatar = saved?.avatar || '';
}

function presenceEntry(token) {
  let entry = presence.get(token);
  if (!entry) {
    entry = { name: '', avatar: '', sockets: new Set() };
    presence.set(token, entry);
  }
  return entry;
}

function notePresence(socket) {
  const entry = presenceEntry(socket.data.token);
  entry.sockets.add(socket.id);
  const saved = profiles.get(socket.data.token);
  if (saved) {
    entry.name = saved.name;
    entry.avatar = saved.avatar;
  }
}

function forgetPresence(socket) {
  const entry = presence.get(socket.data.token);
  if (!entry) return;
  entry.sockets.delete(socket.id);
  if (!entry.sockets.size) presence.delete(socket.data.token);
}

function onlinePayload(forToken) {
  const list = [];
  for (const [token, entry] of presence) {
    if (!entry.sockets.size) continue;
    list.push({
      name: entry.name || '',
      avatar: entry.avatar || '',
      you: token === forToken,
    });
  }
  list.sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name, 'ru'));
  return list;
}

function broadcastOnline() {
  for (const socket of io.sockets.sockets.values()) {
    socket.emit('online', onlinePayload(socket.data.token));
  }
}

function publicView(room, token) {
  const you = roleOf(room, token);
  const player = (slot) => (slot ? {
    connected: Boolean(slot.connected),
    name: slot.name || '',
    avatar: slot.avatar || '',
  } : null);
  return {
    code: room.code,
    game: room.game,
    phase: room.phase,
    you,
    host: player(room.host),
    guest: player(room.guest),
    youSetWord: you ? room.submitted[you] : false,
    opponentSetWord: you ? room.submitted[otherRole(you)] : false,
    lengths: {
      host: room.target.host ? room.target.host.length : null,
      guest: room.target.guest ? room.target.guest.length : null,
    },
    script: {
      host: room.target.host ? classifyWord(room.target.host) : null,
      guest: room.target.guest ? classifyWord(room.target.guest) : null,
    },
    boards: room.boards,
    drafts: room.settings.hidden
      ? { host: '', guest: '' }
      : {
        host: room.turn === 'host' ? room.drafts.host : '',
        guest: room.turn === 'guest' ? room.drafts.guest : '',
      },
    settings: room.settings,
    fixedLength: room.fixedLength,
    deadline: room.deadline,
    turn: room.turn,
    winner: room.winner,
    yourWord: you && room.submitted[you] ? (room.target[otherRole(you)] || '') : '',
    answers: room.phase === 'done'
      ? { host: room.target.host, guest: room.target.guest }
      : null,
    chat: room.chat,
  };
}

function broadcast(room) {
  const ids = io.sockets.adapter.rooms.get(room.code);
  if (!ids) return;
  for (const id of ids) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) continue;
    socket.emit('state', publicView(room, socket.data.token));
  }
}

function fail(socket, text, extra) {
  socket.emit('errorMsg', { text, ...extra });
}

function attach(socket, room) {
  const role = roleOf(room, socket.data.token);
  if (!role) return;
  room[role].socketId = socket.id;
  room[role].connected = true;
  room[role].disconnectedAt = null;
  socket.join(room.code);
  broadcast(room);
}

function closeRoom(room, message) {
  io.to(room.code).emit('closed', { message });
  rooms.delete(room.code);
}

function returnToLobby(room) {
  room.phase = 'lobby';
  room.target = { host: null, guest: null };
  room.submitted = { host: false, guest: false };
  room.boards = { host: [], guest: [] };
  room.drafts = { host: '', guest: '' };
  room.fixedLength = null;
  room.deadline = null;
  room.winner = null;
  room.turn = 'host';
}

io.use((socket, next) => {
  const incoming = String(socket.handshake.auth?.token || '').replace(/[^\w-]/g, '').slice(0, 80);
  socket.data.token = incoming || crypto.randomUUID();
  next();
});

io.on('connection', (socket) => {
  notePresence(socket);
  const existing = findByToken(socket.data.token);
  socket.emit('hello', { token: socket.data.token, inRoom: Boolean(existing) });
  broadcastOnline();
  if (existing) attach(socket, existing);

  socket.on('create', ({ game } = {}) => {
    if (game !== 'wordle') return fail(socket, 'Такой игры пока нет');
    const already = findByToken(socket.data.token);
    if (already) {
      attach(socket, already);
      return;
    }
    if (rooms.size > 500) return fail(socket, 'Слишком много комнат, попробуй позже');
    const room = emptyRoom(makeCode());
    room.host = { token: socket.data.token, connected: true, socketId: socket.id };
    applyProfile(room.host);
    rooms.set(room.code, room);
    socket.join(room.code);
    pushChat(room, 'system', 'Комната создана. Скинь код другу.');
    broadcast(room);
  });

  socket.on('join', ({ code } = {}) => {
    const normalized = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
    const room = rooms.get(normalized);
    if (!room) return fail(socket, 'Комната не найдена');

    const already = roleOf(room, socket.data.token);
    if (already) {
      attach(socket, room);
      return;
    }

    const elsewhere = findByToken(socket.data.token);
    if (elsewhere && elsewhere.code !== room.code) {
      return fail(socket, 'Ты уже в другой комнате. Сначала выйди из неё.');
    }
    if (room.phase !== 'lobby') return fail(socket, 'Игра в этой комнате уже началась');
    if (room.guest) return fail(socket, 'В комнате уже два игрока');

    room.guest = { token: socket.data.token, connected: true, socketId: socket.id };
    applyProfile(room.guest);
    socket.join(room.code);
    pushChat(room, 'system', `${playerLabel(room, 'guest')} подключился.`);
    broadcast(room);
  });

  socket.on('start', () => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    if (roleOf(room, socket.data.token) !== 'host') return fail(socket, 'Начать игру может только хост');
    if (room.phase !== 'lobby') return fail(socket, 'Игра уже началась');
    if (!room.guest?.connected) return fail(socket, 'Сначала пусть друг введёт код комнаты');
    room.settings = sanitizeSettings(room.settings);
    if (room.settings.timerOn && timerMs(room.settings) <= 0) {
      return fail(socket, 'Укажи время на ход');
    }
    room.phase = 'setup';
    room.fixedLength = null;
    rollFirst(room);
    pushChat(room, 'system', rulesText(room));
    broadcast(room);
  });

  socket.on('setWord', ({ word } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    const role = roleOf(room, socket.data.token);
    if (room.phase !== 'setup') return fail(socket, 'Сейчас не время загадывать слово');
    if (room.submitted[role]) return fail(socket, 'Слово уже загадано');
    const clean = normalizeWord(word);
    const script = classifyWord(clean);
    if (!script) {
      return fail(socket, 'Нужно от 3 до 16 букв: либо только русские, либо только английские');
    }
    const problem = lengthProblem(room, clean);
    if (problem) return fail(socket, problem);
    if (room.settings.lengthMode === 'first' && !room.fixedLength) room.fixedLength = clean.length;
    const opponent = otherRole(role);
    room.target[opponent] = clean;
    room.submitted[role] = true;
    if (room.submitted.host && room.submitted.guest) {
      room.phase = 'play';
      room.turn = room.firstPlayer || 'host';
      beginTurn(room);
      pushChat(room, 'system', `Слова загаданы. Первый ход — у ${playerLabel(room, room.turn)}.`);
    }
    broadcast(room);
  });

  socket.on('guess', ({ word } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    const role = roleOf(room, socket.data.token);
    if (room.phase !== 'play') return fail(socket, 'Игра ещё не идёт');
    if (room.turn !== role) return fail(socket, 'Сейчас ход соперника');
    if (!room[role]?.connected || !room[otherRole(role)]?.connected) {
      return fail(socket, 'Соперник отключился. Подожди, пока он вернётся.');
    }
    const secret = room.target[role];
    const clean = normalizeWord(word);
    if (clean.length !== secret.length || classifyWord(clean) !== classifyWord(secret)) {
      return fail(socket, `Нужно слово из ${secret.length} букв`, { shake: true });
    }
    if (room.boards[role].length >= MAX_GUESSES) {
      return fail(socket, 'Слишком много попыток');
    }
    room.boards[role].push({ guess: clean, marks: markGuess(secret, clean) });
    if (clean === secret) {
      room.phase = 'done';
      room.winner = role;
      pushChat(room, 'system', `${playerLabel(room, role)} угадал слово и победил.`);
    } else {
      room.turn = otherRole(role);
      beginTurn(room);
    }
    if (room.phase === 'done') {
      room.drafts.host = '';
      room.drafts.guest = '';
      room.deadline = null;
    }
    broadcast(room);
  });

  socket.on('settings', (raw) => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    if (roleOf(room, socket.data.token) !== 'host') return fail(socket, 'Настройки меняет хост');
    if (room.phase !== 'lobby') return fail(socket, 'Настройки можно менять только в лобби');
    room.settings = sanitizeSettings(raw);
    broadcast(room);
  });

  socket.on('draft', ({ word } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room || room.phase !== 'play' || room.settings.hidden) return;
    const role = roleOf(room, socket.data.token);
    if (room.turn !== role || !room.target[role]) return;
    const secret = room.target[role];
    const script = classifyWord(secret);
    const clean = String(word || '').toLowerCase().slice(0, secret.length);
    const ok = script === 'en' ? /^[a-z]*$/.test(clean) : /^[а-яё]*$/.test(clean);
    if (!ok || clean === room.drafts[role]) return;
    room.drafts[role] = clean;
    broadcast(room);
  });

  socket.on('profile', ({ name, avatar } = {}) => {
    const clean = cleanName(name);
    let picture = cleanAvatar(avatar);
    if (avatar && !picture) {
      fail(socket, 'Аватарка слишком большая или неподходящего формата');
    }
    profiles.set(socket.data.token, { name: clean, avatar: picture });
    const entry = presence.get(socket.data.token);
    if (entry) {
      entry.name = clean;
      entry.avatar = picture;
    }
    broadcastOnline();
    const room = findByToken(socket.data.token);
    if (!room) return;
    const role = roleOf(room, socket.data.token);
    room[role].name = clean;
    room[role].avatar = picture;
    broadcast(room);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    const role = roleOf(room, socket.data.token);
    const message = cleanText(text);
    if (!message) return;
    pushChat(room, role, message);
    broadcast(room);
  });

  socket.on('again', () => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    if (roleOf(room, socket.data.token) !== 'host') return fail(socket, 'Новый раунд запускает хост');
    if (room.phase !== 'done') return fail(socket, 'Раунд ещё не закончен');
    returnToLobby(room);
    pushChat(room, 'system', 'Хост открыл лобби. Можно поменять правила и начать заново.');
    broadcast(room);
  });

  socket.on('leave', () => {
    const room = findByToken(socket.data.token);
    if (!room) {
      socket.emit('closed', { message: 'Ты вышел' });
      return;
    }
    const role = roleOf(room, socket.data.token);
    if (role === 'guest' && room.phase === 'lobby') {
      room.guest = null;
      socket.leave(room.code);
      socket.emit('closed', { message: 'Ты вышел' });
      pushChat(room, 'system', 'Друг вышел.');
      broadcast(room);
      return;
    }
    closeRoom(room, role === 'host' ? 'Хост закрыл комнату' : 'Друг вышел из игры');
  });

  socket.on('disconnect', () => {
    forgetPresence(socket);
    broadcastOnline();
    const room = findByToken(socket.data.token);
    if (!room) return;
    const role = roleOf(room, socket.data.token);
    if (!role || room[role].socketId !== socket.id) return;
    room[role].connected = false;
    room[role].disconnectedAt = Date.now();
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'play' && room.deadline && now >= room.deadline) {
      const skipped = room.turn;
      room.turn = otherRole(skipped);
      beginTurn(room);
      pushChat(room, 'system', `Время вышло. Ход ${playerLabel(room, skipped)} пропущен.`);
      broadcast(room);
    }
  }
}, 400).unref();

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const hostGone = room.host && !room.host.connected && now - (room.host.disconnectedAt || now) > 10 * 60 * 1000;
    const guestGone = room.guest && !room.guest.connected && now - (room.guest.disconnectedAt || now) > 10 * 60 * 1000;
    const empty = (!room.host || !room.host.connected) && (!room.guest || !room.guest.connected);
    if (empty && (hostGone || !room.host) && (!room.guest || guestGone)) {
      rooms.delete(room.code);
      continue;
    }
    if (room.phase !== 'lobby' && (hostGone || guestGone)) {
      const who = hostGone ? 'Хост' : 'Друг';
      closeRoom(room, `${who} отключился`);
    }
  }
}, 60 * 1000).unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`leisure listening on http://localhost:${PORT}`);
  });
}

module.exports = { markGuess, normalizeWord, classifyWord };
