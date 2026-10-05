const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
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
    chatTimes: new Map(),
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
  if (room.game === 'cinema') {
    return room.members?.some((member) => member.token === token) ? 'member' : null;
  }
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

function pushChat(room, from, text, extra = {}) {
  const attachment = {
    text: text || '',
    reply: extra.reply || null,
    image: extra.image || '',
    sticker: extra.sticker || '',
  };
  if (room.game === 'cinema') {
    const system = from === 'system';
    const member = system ? null : room.members.find((item) => item.token === from);
    room.chat.push({
      id: room.chatSeq,
      system,
      token: system ? '' : from,
      name: system ? '' : (member?.name || 'Зритель'),
      at: Date.now(),
      ...attachment,
    });
  } else {
    room.chat.push({
      id: room.chatSeq,
      from,
      name: from === 'system' ? '' : playerLabel(room, from),
      at: Date.now(),
      ...attachment,
    });
  }
  room.chatSeq += 1;
  if (room.chat.length > MAX_CHAT) room.chat.splice(0, room.chat.length - MAX_CHAT);
}

function cleanImage(raw, limit) {
  const value = String(raw || '');
  if (!value) return '';
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return '';
  if (value.length > limit) return '';
  return value;
}

function cleanReply(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name) || 'Сообщение';
  const text = cleanText(raw.text).slice(0, 140);
  if (!text) return null;
  return { name, text };
}

function allowChat(room, key, socket) {
  const now = Date.now();
  if (!room.chatTimes) room.chatTimes = new Map();
  const recent = (room.chatTimes.get(key) || []).filter((stamp) => now - stamp < 10000);
  if (recent.length >= 8) {
    fail(socket, 'Слишком много сообщений. Подожди немного.');
    return false;
  }
  if (recent.length && now - recent[recent.length - 1] < 500) {
    fail(socket, 'Подожди секунду перед следующим сообщением.');
    return false;
  }
  recent.push(now);
  room.chatTimes.set(key, recent);
  return true;
}

function chatPayload(raw) {
  const source = raw && typeof raw === 'object' ? raw : { text: raw };
  const text = cleanText(source.text);
  const image = cleanImage(source.image, 180000);
  const sticker = cleanImage(source.sticker, 100000);
  return {
    text,
    image,
    sticker,
    reply: cleanReply(source.reply),
    badImage: Boolean(source.image) && !image,
    badSticker: Boolean(source.sticker) && !sticker,
  };
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 400);
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
  if (room.game === 'cinema') return cinemaView(room, token);
  if (room.game === 'battle') return battleView(room, token);
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
  if (room.game === 'cinema') return attachCinema(socket, room);
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
  room.winner = null;
  room.turn = 'host';
  room.deadline = null;
  if (room.game === 'battle') {
    room.fleet = { host: null, guest: null };
    room.ready = { host: false, guest: false };
    room.readyAt = null;
    room.shots = { host: [], guest: [] };
    room.firstPlayer = 'host';
    return;
  }
  room.target = { host: null, guest: null };
  room.submitted = { host: false, guest: false };
  room.boards = { host: [], guest: [] };
  room.drafts = { host: '', guest: '' };
  room.fixedLength = null;
}

function emptyBattle(code) {
  return {
    code,
    game: 'battle',
    phase: 'lobby',
    host: null,
    guest: null,
    chat: [],
    chatSeq: 1,
    chatTimes: new Map(),
    settings: { firstTurn: 'host' },
    fleet: { host: null, guest: null },
    ready: { host: false, guest: false },
    readyAt: null,
    shots: { host: [], guest: [] },
    turn: 'host',
    firstPlayer: 'host',
    winner: null,
    deadline: null,
  };
}

function shipCells(ship) {
  if (ship.r == null || ship.c == null) return [];
  const cells = [];
  for (let i = 0; i < ship.len; i += 1) {
    cells.push([
      ship.r + (ship.dir === 'v' ? i : 0),
      ship.c + (ship.dir === 'h' ? i : 0),
    ]);
  }
  return cells;
}

function fleetGeometryOk(ships) {
  const groups = ships.map((ship) => shipCells(ship));
  for (const cells of groups) {
    for (const [r, c] of cells) {
      if (r < 0 || c < 0 || r > 9 || c > 9) return false;
    }
  }
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      for (const [r1, c1] of groups[a]) {
        for (const [r2, c2] of groups[b]) {
          if (Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2)) < 2) return false;
        }
      }
    }
  }
  return true;
}

function parseFleet(raw, full) {
  if (!Array.isArray(raw) || raw.length !== 10) return null;
  const expected = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  const ships = [];
  for (let i = 0; i < 10; i += 1) {
    const item = raw[i] || {};
    if (Number(item.len) !== expected[i]) return null;
    const dir = item.dir === 'v' ? 'v' : 'h';
    const placed = item.r != null && item.r !== '' && item.c != null && item.c !== '';
    if (!placed) {
      if (full) return null;
      ships.push({ len: expected[i], r: null, c: null, dir });
      continue;
    }
    const r = Number(item.r);
    const c = Number(item.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    ships.push({ len: expected[i], r, c, dir });
  }
  if (!fleetGeometryOk(ships.filter((ship) => ship.r != null))) return null;
  return ships;
}

function shipSunk(shots, ship) {
  return shipCells(ship).every(([r, c]) => shots.some((shot) => shot.hit && shot.r === r && shot.c === c));
}

function shipHalo(ship) {
  const body = new Set(shipCells(ship).map(([r, c]) => `${r},${c}`));
  const extra = [];
  const seen = new Set();
  for (const [r, c] of shipCells(ship)) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const rr = r + dr;
        const cc = c + dc;
        const key = `${rr},${cc}`;
        if (rr < 0 || cc < 0 || rr > 9 || cc > 9 || body.has(key) || seen.has(key)) continue;
        seen.add(key);
        extra.push([rr, cc]);
      }
    }
  }
  return extra;
}

function describeShots(shots, fleet) {
  const ships = fleet || [];
  return shots.map((shot) => {
    if (!shot.hit) return { r: shot.r, c: shot.c, mark: 'miss' };
    const ship = ships.find((item) => shipCells(item).some(([r, c]) => r === shot.r && c === shot.c));
    return { r: shot.r, c: shot.c, mark: ship && shipSunk(shots, ship) ? 'sunk' : 'hit' };
  });
}

function battleView(room, token) {
  const you = roleOf(room, token);
  const foe = you ? otherRole(you) : null;
  const player = (slot) => (slot ? {
    connected: Boolean(slot.connected),
    name: slot.name || '',
    avatar: slot.avatar || '',
  } : null);
  return {
    code: room.code,
    game: 'battle',
    phase: room.phase,
    you,
    host: player(room.host),
    guest: player(room.guest),
    settings: room.settings,
    youReady: you ? Boolean(room.ready[you]) : false,
    opponentReady: you ? Boolean(room.ready[foe]) : false,
    readyAt: room.readyAt,
    serverNow: Date.now(),
    yourFleet: you && room.fleet[you] ? room.fleet[you] : null,
    yourShots: you ? describeShots(room.shots[you], foe ? room.fleet[foe] : []) : [],
    incoming: you ? describeShots(room.shots[foe], room.fleet[you]) : [],
    turn: room.turn,
    winner: room.winner,
    chat: room.chat,
  };
}

function battleSettings(raw) {
  return { firstTurn: raw?.firstTurn === 'random' ? 'random' : 'host' };
}

function createBattle(socket) {
  const already = findByToken(socket.data.token);
  if (already) {
    attach(socket, already);
    return;
  }
  if (rooms.size > 500) return fail(socket, 'Слишком много комнат, попробуй позже');
  const room = emptyBattle(makeCode());
  room.host = { token: socket.data.token, connected: true, socketId: socket.id };
  applyProfile(room.host);
  rooms.set(room.code, room);
  socket.join(room.code);
  pushChat(room, 'system', 'Комната морского боя создана. Скинь код другу.');
  broadcast(room);
}

function startBattle(room) {
  room.settings = battleSettings(room.settings);
  room.phase = 'place';
  room.fleet = { host: null, guest: null };
  room.ready = { host: false, guest: false };
  room.readyAt = null;
  room.shots = { host: [], guest: [] };
  room.winner = null;
  room.turn = 'host';
  pushChat(room, 'system', 'Расставьте корабли. Между ними нужна пустая клетка. Когда оба нажмут «Готово», начнётся отсчёт.');
  broadcast(room);
}

function cancelBattleStart(room) {
  if (!room.readyAt) return;
  room.readyAt = null;
  pushChat(room, 'system', 'Старт отменён.');
}

function armBattleStart(room) {
  if (!(room.ready.host && room.ready.guest)) return;
  rollFirst(room);
  room.readyAt = Date.now() + 4000;
  pushChat(room, 'system', 'Оба готовы. Старт через 4 секунды.');
}

const CINEMA_LIMIT = 12;
const HOST_GRACE_MS = 20 * 1000;

function blankVideo() {
  return {
    kind: '',
    service: '',
    id: '',
    live: false,
    clip: false,
    upstream: '',
    direct: '',
    directCookie: '',
    playing: false,
    at: 0,
    updatedAt: 0,
    pauseAt: null,
  };
}

function emptyCinema(code) {
  return {
    code,
    game: 'cinema',
    phase: 'watch',
    hostToken: '',
    members: [],
    chat: [],
    chatSeq: 1,
    chatTimes: new Map(),
    screen: false,
    video: blankVideo(),
  };
}

function cinemaMember(room, token) {
  return room.members.find((member) => member.token === token) || null;
}

function cinemaName(member) {
  return member?.name || 'Зритель';
}

function mediaNow(video, now = Date.now()) {
  if (!video?.id) return 0;
  if (!video.playing) return video.at;
  const elapsed = Math.max(0, (now - video.updatedAt) / 1000);
  const time = video.at + elapsed;
  if (video.pauseAt != null) return Math.min(time, video.pauseAt);
  return time;
}

function freezeVideo(video, at, now = Date.now()) {
  video.playing = false;
  video.at = Math.max(0, at);
  video.pauseAt = null;
  video.updatedAt = now;
}

function connectedCinema(room) {
  return room.members.filter((member) => member.connected).sort((a, b) => a.joinedAt - b.joinedAt);
}

function passCinemaHost(room, next) {
  room.members.forEach((member) => {
    member.host = member === next;
  });
  room.hostToken = next?.token || '';
}

function endScreen(room, text) {
  if (!room.screen) return;
  room.screen = false;
  pushChat(room, 'system', text || 'Демонстрация экрана закончилась.');
  io.to(room.code).emit('cinema:screen-off');
}

function cinemaView(room, token) {
  const you = cinemaMember(room, token);
  return {
    game: 'cinema',
    code: room.code,
    phase: 'watch',
    youHost: Boolean(you?.host),
    youId: you?.id || '',
    serverNow: Date.now(),
    screen: room.screen,
    video: {
      kind: room.video.kind || '',
      service: room.video.service || '',
      id: room.video.id,
      live: Boolean(room.video.live),
      clip: Boolean(room.video.clip),
      playing: room.video.playing,
      at: room.video.at,
      updatedAt: room.video.updatedAt,
      pauseAt: room.video.pauseAt,
    },
    members: room.members.map((member) => ({
      id: member.id,
      name: member.name || '',
      avatar: member.avatar || '',
      host: member.host,
      connected: member.connected,
      you: member.token === token,
    })),
    chat: room.chat.map((msg) => ({
      id: msg.id,
      system: Boolean(msg.system),
      name: msg.name || '',
      text: msg.text,
      at: msg.at,
      mine: Boolean(msg.token) && msg.token === token,
      reply: msg.reply || null,
      image: msg.image || '',
      sticker: msg.sticker || '',
    })),
  };
}

function youtubeId(raw) {
  const text = String(raw || '').trim();
  const ok = (id) => /^[\w-]{11}$/.test(id || '');
  if (ok(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return ok(id) ? id : '';
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
      const fromQuery = url.searchParams.get('v');
      if (ok(fromQuery)) return fromQuery;
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && ok(parts[1])) return parts[1];
    }
  } catch {
    return '';
  }
  return '';
}

const TWITCH_RESERVED = new Set(['videos', 'directory', 'settings', 'downloads', 'jobs', 'p', 'search', 'subscriptions', 'wallet', 'turbo', 'products', 'friends', 'inventory', 'prime', 'signup', 'login']);

function parseTwitch(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'clips.twitch.tv') {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    if (!slug || !/^[\w-]+$/.test(slug)) return null;
    return { kind: 'twitch', service: 'twitch', id: slug, live: true, clip: true, upstream: '' };
  }
  if (host === 'player.twitch.tv') {
    const channel = url.searchParams.get('channel') || '';
    const video = (url.searchParams.get('video') || '').replace(/^v/, '');
    if (/^\d+$/.test(video)) return { kind: 'twitch', service: 'twitch', id: video, live: false, clip: false, upstream: '' };
    if (/^[a-zA-Z0-9_]{3,25}$/.test(channel)) return { kind: 'twitch', service: 'twitch', id: channel.toLowerCase(), live: true, clip: false, upstream: '' };
    return null;
  }
  if (host !== 'twitch.tv') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'videos' && /^\d+$/.test(parts[1] || '')) {
    return { kind: 'twitch', service: 'twitch', id: parts[1], live: false, clip: false, upstream: '' };
  }
  if (parts[1] === 'clip' && parts[2] && /^[\w-]+$/.test(parts[2])) {
    return { kind: 'twitch', service: 'twitch', id: parts[2], live: true, clip: true, upstream: '' };
  }
  const channel = (parts[0] || '').toLowerCase();
  if (channel && !TWITCH_RESERVED.has(channel) && /^[a-z0-9_]{3,25}$/.test(channel)) {
    return { kind: 'twitch', service: 'twitch', id: channel, live: true, clip: false, upstream: '' };
  }
  return null;
}

function parseDrive(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;
  const fromPath = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  const id = fromPath?.[1] || url.searchParams.get('id') || '';
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return null;
  return {
    kind: 'file',
    service: 'drive',
    id,
    live: false,
    clip: false,
    upstream: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
  };
}

function parseDropbox(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'dropbox.com' && host !== 'dl.dropboxusercontent.com') return null;
  if (url.pathname.split('/').filter(Boolean).length < 2) return null;
  if (host === 'dropbox.com') {
    url.hostname = 'www.dropbox.com';
    url.hash = '';
    url.searchParams.set('dl', '1');
  }
  const upstream = url.toString();
  return {
    kind: 'file',
    service: 'dropbox',
    id: crypto.createHash('sha1').update(upstream).digest('hex').slice(0, 12),
    live: false,
    clip: false,
    upstream,
  };
}

function parseWatchUrl(raw) {
  const text = String(raw || '').trim();
  const youtube = youtubeId(text);
  if (youtube) return { kind: 'youtube', service: 'youtube', id: youtube, live: false, clip: false, upstream: '' };
  return parseTwitch(text) || parseDrive(text) || parseDropbox(text);
}

function watchLabel(parsed) {
  if (parsed.service === 'twitch' && parsed.clip) return 'клип Twitch';
  if (parsed.service === 'twitch' && parsed.live) return 'трансляцию Twitch';
  if (parsed.service === 'twitch') return 'запись Twitch';
  if (parsed.service === 'drive') return 'видео из Google Drive';
  if (parsed.service === 'dropbox') return 'видео из Dropbox';
  return 'видео';
}

function attachCinema(socket, room) {
  const member = cinemaMember(room, socket.data.token);
  if (!member) return;
  member.socketId = socket.id;
  member.connected = true;
  member.disconnectedAt = 0;
  applyProfile(member);
  socket.join(room.code);
  broadcast(room);
}

function createCinema(socket) {
  const already = findByToken(socket.data.token);
  if (already) {
    attach(socket, already);
    return;
  }
  if (rooms.size > 500) return fail(socket, 'Слишком много комнат, попробуй позже');
  const room = emptyCinema(makeCode());
  const member = {
    token: socket.data.token,
    id: crypto.randomBytes(4).toString('hex'),
    socketId: socket.id,
    name: '',
    avatar: '',
    host: true,
    connected: true,
    joinedAt: Date.now(),
    disconnectedAt: 0,
  };
  applyProfile(member);
  room.members.push(member);
  room.hostToken = member.token;
  rooms.set(room.code, room);
  socket.join(room.code);
  pushChat(room, 'system', `${cinemaName(member)} открыл кинотеатр.`);
  broadcast(room);
}

function joinCinema(socket, room) {
  const already = cinemaMember(room, socket.data.token);
  if (already) {
    attachCinema(socket, room);
    return;
  }
  const elsewhere = findByToken(socket.data.token);
  if (elsewhere && elsewhere.code !== room.code) {
    return fail(socket, 'Ты уже в другой комнате. Сначала выйди из неё.');
  }
  if (room.members.length >= CINEMA_LIMIT) return fail(socket, 'В кинотеатре уже максимум зрителей');
  const member = {
    token: socket.data.token,
    id: crypto.randomBytes(4).toString('hex'),
    socketId: socket.id,
    name: '',
    avatar: '',
    host: false,
    connected: true,
    joinedAt: Date.now(),
    disconnectedAt: 0,
  };
  applyProfile(member);
  room.members.push(member);
  socket.join(room.code);
  pushChat(room, 'system', `${cinemaName(member)} вошёл в кинотеатр.`);
  broadcast(room);
}

function leaveCinema(socket, room) {
  const member = cinemaMember(room, socket.data.token);
  if (!member) {
    socket.emit('closed', { message: 'Ты вышел' });
    return;
  }
  const wasHost = member.host;
  if (wasHost && room.screen) endScreen(room, 'Демонстрация остановилась: хост вышел.');
  room.members = room.members.filter((item) => item.token !== member.token);
  socket.leave(room.code);
  socket.emit('closed', { message: 'Ты вышел из кинотеатра' });
  const next = connectedCinema(room)[0];
  if (!next) {
    rooms.delete(room.code);
    return;
  }
  if (wasHost) {
    passCinemaHost(room, next);
    pushChat(room, 'system', `${cinemaName(member)} вышел. Хост теперь ${cinemaName(next)}.`);
  } else {
    pushChat(room, 'system', `${cinemaName(member)} вышел.`);
  }
  broadcast(room);
}

function disconnectCinema(socket, room) {
  const member = cinemaMember(room, socket.data.token);
  if (!member || member.socketId !== socket.id) return;
  member.connected = false;
  member.disconnectedAt = Date.now();
  if (member.host && room.screen) endScreen(room, 'Демонстрация прервалась: у хоста пропала связь.');
  broadcast(room);
}

function cinemaChat(socket, room, raw) {
  const member = cinemaMember(room, socket.data.token);
  if (!member) return;
  const payload = chatPayload(raw);
  if (payload.badImage) return fail(socket, 'Фото слишком большое или не подходит');
  if (payload.badSticker) return fail(socket, 'Стикер слишком большой или не подходит');
  if (!payload.text && !payload.image && !payload.sticker) return;
  if (!allowChat(room, member.token, socket)) return;
  pushChat(room, member.token, payload.text, payload);
  broadcast(room);
}

function requireCinema(socket) {
  const room = findByToken(socket.data.token);
  if (!room || room.game !== 'cinema') return null;
  const member = cinemaMember(room, socket.data.token);
  if (!member) return null;
  return { room, member };
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
    if (game === 'cinema') return createCinema(socket);
    if (game === 'battle') return createBattle(socket);
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
    if (room.game === 'cinema') return joinCinema(socket, room);

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
    if (room.game === 'cinema') return;
    if (roleOf(room, socket.data.token) !== 'host') return fail(socket, 'Начать игру может только хост');
    if (room.phase !== 'lobby') return fail(socket, 'Игра уже началась');
    if (!room.guest?.connected) return fail(socket, 'Сначала пусть друг введёт код комнаты');
    if (room.game === 'battle') return startBattle(room);
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
    if (!room || room.game !== 'wordle') return fail(socket, room ? 'Сейчас не время загадывать слово' : 'Комната не найдена');
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
    if (!room || room.game !== 'wordle') return fail(socket, room ? 'Игра ещё не идёт' : 'Комната не найдена');
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
    if (room.game === 'cinema') return;
    if (roleOf(room, socket.data.token) !== 'host') return fail(socket, 'Настройки меняет хост');
    if (room.phase !== 'lobby') return fail(socket, 'Настройки можно менять только в лобби');
    if (room.game === 'battle') {
      room.settings = battleSettings(raw);
      broadcast(room);
      return;
    }
    room.settings = sanitizeSettings(raw);
    broadcast(room);
  });

  socket.on('draft', ({ word } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room || room.game !== 'wordle' || room.phase !== 'play' || room.settings.hidden) return;
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
    if (room.game === 'cinema') {
      const member = cinemaMember(room, socket.data.token);
      if (!member) return;
      member.name = clean;
      member.avatar = picture;
      broadcast(room);
      return;
    }
    const role = roleOf(room, socket.data.token);
    room[role].name = clean;
    room[role].avatar = picture;
    broadcast(room);
  });

  socket.on('chat', (raw) => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    if (room.game === 'cinema') return cinemaChat(socket, room, raw);
    const role = roleOf(room, socket.data.token);
    const payload = chatPayload(raw);
    if (payload.badImage) return fail(socket, 'Фото слишком большое или не подходит');
    if (payload.badSticker) return fail(socket, 'Стикер слишком большой или не подходит');
    if (!payload.text && !payload.image && !payload.sticker) return;
    if (!allowChat(room, role, socket)) return;
    pushChat(room, role, payload.text, payload);
    broadcast(room);
  });

  socket.on('battle:layout', ({ ships } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room || room.game !== 'battle') return;
    const role = roleOf(room, socket.data.token);
    if (!role || room.phase !== 'place') return fail(socket, 'Сейчас не расстановка');
    if (room.ready[role]) return fail(socket, 'Сначала отмени готовность');
    const fleet = parseFleet(ships, false);
    if (!fleet) return fail(socket, 'Так корабли поставить нельзя');
    room.fleet[role] = fleet;
    broadcast(room);
  });

  socket.on('battle:ready', ({ on } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room || room.game !== 'battle') return;
    const role = roleOf(room, socket.data.token);
    if (!role || room.phase !== 'place') return fail(socket, 'Сейчас не расстановка');
    if (!on) {
      room.ready[role] = false;
      cancelBattleStart(room);
      broadcast(room);
      return;
    }
    const fleet = parseFleet(room.fleet[role], true);
    if (!fleet) return fail(socket, 'Сначала поставь весь флот: линкор, два крейсера, три эсминца и четыре катера');
    room.fleet[role] = fleet;
    room.ready[role] = true;
    if (room.ready.host && room.ready.guest) armBattleStart(room);
    else pushChat(room, 'system', `${playerLabel(room, role)} готов.`);
    broadcast(room);
  });

  socket.on('battle:shot', ({ r, c } = {}) => {
    const room = findByToken(socket.data.token);
    if (!room || room.game !== 'battle') return;
    const role = roleOf(room, socket.data.token);
    if (!role) return;
    if (room.phase !== 'play') return fail(socket, 'Бой ещё не начался');
    if (room.turn !== role) return fail(socket, 'Сейчас ход соперника');
    const foe = otherRole(role);
    if (!room[role]?.connected || !room[foe]?.connected) {
      return fail(socket, 'Соперник отключился. Подожди, пока он вернётся.');
    }
    const row = Number(r);
    const col = Number(c);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row > 9 || col > 9) return;
    if (room.shots[role].some((shot) => shot.r === row && shot.c === col)) return fail(socket, 'Сюда уже стреляли');
    const fleet = room.fleet[foe] || [];
    const ship = fleet.find((item) => shipCells(item).some(([sr, sc]) => sr === row && sc === col));
    room.shots[role].push({ r: row, c: col, hit: Boolean(ship) });
    if (ship && shipSunk(room.shots[role], ship)) {
      for (const [rr, cc] of shipHalo(ship)) {
        if (!room.shots[role].some((shot) => shot.r === rr && shot.c === cc)) {
          room.shots[role].push({ r: rr, c: cc, hit: false });
        }
      }
    }
    if (fleet.length && fleet.every((item) => item.r != null && shipSunk(room.shots[role], item))) {
      room.phase = 'done';
      room.winner = role;
      room.turn = null;
      pushChat(room, 'system', `${playerLabel(room, role)} потопил весь флот.`);
    } else if (!ship) {
      room.turn = foe;
    }
    broadcast(room);
  });

  socket.on('again', () => {
    const room = findByToken(socket.data.token);
    if (!room) return fail(socket, 'Комната не найдена');
    if (room.game === 'cinema') return;
    if (!roleOf(room, socket.data.token)) return fail(socket, 'Комната не найдена');
    if (room.phase !== 'done') return fail(socket, 'Раунд ещё не закончен');
    returnToLobby(room);
    pushChat(room, 'system', 'Лобби открыто. Можно поменять правила и начать заново.');
    broadcast(room);
  });

  socket.on('cinema:video', ({ url } = {}) => {
    const found = requireCinema(socket);
    if (!found) return fail(socket, 'Комната не найдена');
    const { room, member } = found;
    if (!member.host) return fail(socket, 'Ссылку ставит хост');
    const parsed = parseWatchUrl(url);
    if (!parsed) return fail(socket, 'Нужна ссылка на YouTube, Twitch, Google Drive или Dropbox');
    if (room.screen) endScreen(room, 'Демонстрация экрана закончилась.');
    const now = Date.now();
    room.video = {
      ...blankVideo(),
      kind: parsed.kind,
      service: parsed.service,
      id: parsed.id,
      live: parsed.live,
      clip: parsed.clip,
      upstream: parsed.upstream,
      playing: Boolean(parsed.live),
      updatedAt: now,
    };
    pushChat(room, 'system', `${cinemaName(member)} включил ${watchLabel(parsed)}.`);
    broadcast(room);
  });

  socket.on('cinema:pause', ({ time } = {}) => {
    const found = requireCinema(socket);
    if (!found) return;
    const { room } = found;
    if (!room.video.id || room.screen || room.video.live) return;
    const now = Date.now();
    const shared = mediaNow(room.video, now);
    const reported = Math.max(0, Number(time) || 0);
    if (reported < shared - 1) {
      freezeVideo(room.video, shared, now);
    } else {
      const pauseAt = Math.max(reported, shared);
      if (pauseAt - shared < 0.4) {
        freezeVideo(room.video, pauseAt, now);
      } else {
        room.video.playing = true;
        room.video.at = shared;
        room.video.updatedAt = now;
        room.video.pauseAt = pauseAt;
      }
    }
    broadcast(room);
  });

  socket.on('cinema:play', () => {
    const found = requireCinema(socket);
    if (!found) return;
    const { room } = found;
    if (!room.video.id || room.screen || room.video.live) return;
    const now = Date.now();
    const at = mediaNow(room.video, now);
    room.video.playing = true;
    room.video.at = at;
    room.video.pauseAt = null;
    room.video.updatedAt = now;
    broadcast(room);
  });

  socket.on('cinema:seek', ({ time } = {}) => {
    const found = requireCinema(socket);
    if (!found) return;
    const { room, member } = found;
    if (!member.host) return fail(socket, 'Перематывать может только хост');
    if (!room.video.id || room.screen || room.video.live) return;
    const at = Math.max(0, Number(time) || 0);
    const now = Date.now();
    room.video.at = at;
    room.video.updatedAt = now;
    room.video.pauseAt = null;
    broadcast(room);
  });

  socket.on('cinema:host', ({ id } = {}) => {
    const found = requireCinema(socket);
    if (!found) return fail(socket, 'Комната не найдена');
    const { room, member } = found;
    if (!member.host) return fail(socket, 'Передавать роль может только хост');
    const next = room.members.find((item) => item.id === id && item.connected && !item.host);
    if (!next) return fail(socket, 'Этого зрителя нет в комнате');
    if (room.screen) endScreen(room, 'Демонстрация остановилась: хост сменился.');
    passCinemaHost(room, next);
    pushChat(room, 'system', `Хост теперь ${cinemaName(next)}.`);
    broadcast(room);
  });

  socket.on('leave', () => {
    const room = findByToken(socket.data.token);
    if (!room) {
      socket.emit('closed', { message: 'Ты вышел' });
      return;
    }
    if (room.game === 'cinema') return leaveCinema(socket, room);
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
    if (room.game === 'cinema') return disconnectCinema(socket, room);
    const role = roleOf(room, socket.data.token);
    if (!role || room[role].socketId !== socket.id) return;
    room[role].connected = false;
    room[role].disconnectedAt = Date.now();
    if (room.game === 'battle' && room.phase === 'place' && room.readyAt) {
      room.ready[role] = false;
      cancelBattleStart(room);
    }
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.game === 'cinema') {
      const video = room.video;
      if (video.playing && video.pauseAt != null && mediaNow(video, now) >= video.pauseAt - 0.05) {
        freezeVideo(video, video.pauseAt, now);
        broadcast(room);
      }
      const host = room.members.find((member) => member.host);
      if (host && !host.connected && host.disconnectedAt && now - host.disconnectedAt > HOST_GRACE_MS) {
        const next = connectedCinema(room)[0];
        if (next) {
          passCinemaHost(room, next);
          pushChat(room, 'system', `${cinemaName(host)} не вернулся. Хост теперь ${cinemaName(next)}.`);
          broadcast(room);
        }
      }
      continue;
    }
    if (room.game === 'battle') {
      if (room.phase === 'place' && room.readyAt && now >= room.readyAt) {
        const live = room.ready.host && room.ready.guest && room.host?.connected && room.guest?.connected;
        room.readyAt = null;
        if (live) {
          room.phase = 'play';
          room.turn = room.firstPlayer || 'host';
          pushChat(room, 'system', `Бой начался. Первый ход — у ${playerLabel(room, room.turn)}.`);
        } else {
          if (room.host && !room.host.connected) room.ready.host = false;
          if (room.guest && !room.guest.connected) room.ready.guest = false;
          pushChat(room, 'system', 'Старт отменён.');
        }
        broadcast(room);
      }
      continue;
    }
    if (room.game !== 'wordle') continue;
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
    if (room.game === 'cinema') {
      room.members = room.members.filter((member) => member.connected || now - (member.disconnectedAt || now) < 10 * 60 * 1000);
      const alive = room.members.some((member) => member.connected);
      const stale = room.members.every((member) => !member.connected && now - (member.disconnectedAt || now) > 10 * 60 * 1000);
      if (!room.members.length || (!alive && stale)) rooms.delete(room.code);
      continue;
    }
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

function cloudHeaders(req, cookie) {
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  if (req.headers.range) headers.Range = String(req.headers.range);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function cookieHeader(response) {
  const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return list.map((item) => item.split(';')[0]).filter(Boolean).join('; ');
}

function driveConfirmUrl(id, html) {
  const action = html.match(/action="(https:\/\/drive\.usercontent\.google\.com\/download[^"]+)"/i);
  if (action) return action[1].replace(/&amp;/g, '&');
  const uuid = (html.match(/name="uuid"\s+value="([^"]+)"/i) || [])[1]
    || (html.match(/[?&]uuid=([0-9a-f-]{8,})/i) || [])[1];
  const confirm = (html.match(/name="confirm"\s+value="([^"]+)"/i) || [])[1]
    || (html.match(/confirm=([0-9A-Za-z_-]+)/) || [])[1]
    || 't';
  const next = new URL('https://drive.usercontent.google.com/download');
  next.searchParams.set('id', id);
  next.searchParams.set('export', 'download');
  next.searchParams.set('confirm', confirm);
  if (uuid) next.searchParams.set('uuid', uuid);
  return next.toString();
}

function pipeCloudResponse(response, res) {
  res.status(response.status);
  res.setHeader('Cache-Control', 'private, no-store');
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = response.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  if (!res.getHeader('accept-ranges')) res.setHeader('Accept-Ranges', 'bytes');
  if (!response.body) {
    res.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(res);
}

const browseHits = new Map();

function allowBrowse(token) {
  const now = Date.now();
  const hits = (browseHits.get(token) || []).filter((at) => now - at < 60000);
  if (hits.length >= 20) return false;
  hits.push(now);
  browseHits.set(token, hits);
  return true;
}

function youtubeText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  return (node.runs || []).map((part) => part.text || '').join('');
}

async function searchYouTube(query) {
  const response = await fetch('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20241001.00.00', hl: 'ru', gl: 'RU' } },
      query,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const data = await response.json();
  const items = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object' || items.length >= 12) return;
    const video = node.videoRenderer;
    if (video?.videoId && /^[\w-]{11}$/.test(video.videoId)) {
      const title = youtubeText(video.title).replace(/\s+/g, ' ').trim().slice(0, 140);
      const thumbs = video.thumbnail?.thumbnails || [];
      if (title && !items.some((item) => item.id === video.videoId)) {
        items.push({
          id: video.videoId,
          title,
          author: youtubeText(video.ownerText).replace(/\s+/g, ' ').trim().slice(0, 80),
          thumb: thumbs.at(-1)?.url || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
          url: `https://www.youtube.com/watch?v=${video.videoId}`,
          live: false,
        });
      }
    }
    const children = Array.isArray(node) ? node : Object.values(node);
    children.forEach(walk);
  };
  walk(data);
  return items;
}

async function searchTwitch(query) {
  const response = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: {
      'client-id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: `query ($q: String!) {
        searchFor(platform: "web", userQuery: $q, options: { targets: [{ index: VOD }, { index: CHANNEL }] }) {
          videos { items { id title owner { displayName } previewThumbnailURL(width: 320, height: 180) } }
          channels { items { login displayName profileImageURL(width: 150) stream { id } } }
        }
      }`,
      variables: { q: query },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];
  const data = await response.json();
  const found = data?.data?.searchFor || {};
  const items = [];
  for (const channel of found.channels?.items || []) {
    if (!channel?.stream?.id || !/^[a-zA-Z0-9_]{3,25}$/.test(channel.login || '')) continue;
    items.push({
      id: channel.login.toLowerCase(),
      title: String(channel.displayName || channel.login).slice(0, 80),
      author: 'В эфире',
      thumb: String(channel.profileImageURL || ''),
      url: `https://www.twitch.tv/${channel.login.toLowerCase()}`,
      live: true,
    });
    if (items.length >= 4) break;
  }
  for (const video of found.videos?.items || []) {
    if (!/^\d+$/.test(String(video?.id || '')) || !video.title) continue;
    items.push({
      id: String(video.id),
      title: String(video.title).replace(/\s+/g, ' ').trim().slice(0, 140),
      author: String(video.owner?.displayName || '').slice(0, 80),
      thumb: String(video.previewThumbnailURL || ''),
      url: `https://www.twitch.tv/videos/${video.id}`,
      live: false,
    });
    if (items.length >= 12) break;
  }
  return items;
}

app.get('/browse', async (req, res) => {
  const token = String(req.query.t || '');
  const room = findByToken(token);
  const member = room?.game === 'cinema' ? cinemaMember(room, token) : null;
  if (!member?.host) {
    res.status(403).json({ items: [] });
    return;
  }
  if (!allowBrowse(token)) {
    res.status(429).json({ items: [], error: 'Слишком много запросов. Подожди минуту.' });
    return;
  }
  const service = req.query.service === 'twitch' ? 'twitch' : req.query.service === 'youtube' ? 'youtube' : '';
  const query = String(req.query.q || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  if (!service || !query) {
    res.status(400).json({ items: [] });
    return;
  }
  try {
    const items = service === 'twitch' ? await searchTwitch(query) : await searchYouTube(query);
    res.json({ items });
  } catch {
    res.status(502).json({ items: [], error: 'Поиск сейчас не отвечает.' });
  }
});

app.get('/media/:code', async (req, res) => {
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  try {
    const code = String(req.params.code || '').toUpperCase();
    const room = rooms.get(code);
    const token = String(req.query.t || '');
    if (!room || room.game !== 'cinema' || room.video?.kind !== 'file' || !room.video.upstream) {
      res.status(404).end();
      return;
    }
    if (!cinemaMember(room, token)) {
      res.status(403).end();
      return;
    }
    const video = room.video;
    let upstream = video.direct || video.upstream;
    let response = await fetch(upstream, {
      headers: cloudHeaders(req, video.directCookie),
      redirect: 'follow',
      signal: controller.signal,
    });
    let type = response.headers.get('content-type') || '';
    if (video.service === 'drive' && type.includes('text/html')) {
      const html = await response.text();
      const next = driveConfirmUrl(video.id, html);
      video.direct = next;
      video.directCookie = cookieHeader(response);
      response = await fetch(next, {
        headers: cloudHeaders(req, video.directCookie),
        redirect: 'follow',
        signal: controller.signal,
      });
      type = response.headers.get('content-type') || '';
    }
    if (type.includes('text/html') || !response.ok && response.status !== 206) {
      if (!res.headersSent) res.status(404).end();
      return;
    }
    pipeCloudResponse(response, res);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    if (!res.headersSent) res.status(502).end();
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`leisure listening on http://localhost:${PORT}`);
  });
}

module.exports = { markGuess, normalizeWord, classifyWord };
