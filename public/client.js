const TOKEN_KEY = 'mg-token';

const RU_ROWS = ['йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбюё'];
const EN_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

const view = document.getElementById('view');
const headerSlot = document.getElementById('header-slot');
const toasts = document.getElementById('toasts');

function makeToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let token = sessionStorage.getItem(TOKEN_KEY) || '';
if (!token) {
  token = makeToken();
  sessionStorage.setItem(TOKEN_KEY, token);
}

const socket = io({ auth: { token } });

let connected = false;
let state = null;
let draft = '';
let chatDraft = '';
let setupDraft = '';
let stickChat = true;
let focusKind = null;
let popRole = null;

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function captureForm() {
  const chat = document.querySelector('.chat-input');
  const setup = document.querySelector('.setup-input');
  const log = document.querySelector('.chat-log');
  if (chat) chatDraft = chat.value;
  if (setup) setupDraft = setup.value;
  if (log) stickChat = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const active = document.activeElement;
  focusKind = active?.classList.contains('chat-input')
    ? 'chat'
    : active?.classList.contains('setup-input')
      ? 'setup'
      : null;
}

function restoreForm() {
  const chat = document.querySelector('.chat-input');
  const setup = document.querySelector('.setup-input');
  const log = document.querySelector('.chat-log');
  if (chat) chat.value = chatDraft;
  if (setup) setup.value = setupDraft;
  if (log && stickChat) log.scrollTop = log.scrollHeight;
  if (focusKind === 'chat' && chat) chat.focus();
  if (focusKind === 'setup' && setup) setup.focus();
}

function roleName(role) {
  return role === 'host' ? 'Хост' : 'Друг';
}

function chatHtml(compact) {
  const lines = (state?.chat || []).map((msg) => {
    if (msg.from === 'system') {
      return `<div class="msg system">${escapeHtml(msg.text)}</div>`;
    }
    const mine = msg.from === state.you;
    const who = roleName(msg.from);
    return `<div class="msg${mine ? ' mine' : ''}"><b>${who}</b>${escapeHtml(msg.text)}</div>`;
  }).join('');
  return `
    <section class="chat-panel" style="${compact ? '' : ''}">
      <div class="chat-log">${lines || '<div class="msg system">Сообщений пока нет</div>'}</div>
      <form class="chat-form" data-act="send-chat">
        <input class="chat-input" maxlength="400" placeholder="Сообщение" autocomplete="off">
        <button type="submit">Отправить</button>
      </form>
    </section>`;
}

function homeHtml() {
  return `
    <section class="home">
      <p class="lead">Открой игру и скинь код другу. Он вводит код здесь и подключается в ту же комнату.</p>
      <form class="join" data-act="join">
        <label for="room-code">Код комнаты</label>
        <input id="room-code" maxlength="8" autocomplete="off" placeholder="ABCDE" ${connected ? '' : 'disabled'}>
        <button class="btn wide" type="submit" ${connected ? '' : 'disabled'}>Присоединиться</button>
      </form>
      <div class="sep"><span>Игры</span></div>
      <div class="games">
        <button class="game-card" type="button" data-act="create" data-game="wordle" ${connected ? '' : 'disabled'}>
          <div class="tiles-preview"><i class="g"></i><i class="y"></i><i class="a"></i><i class="g"></i><i class="a"></i></div>
          <h2>Wordle</h2>
          <p>Загадайте слово друг другу и угадывайте по очереди. Кто первый угадает — победил.</p>
          <span class="tag">2 игрока</span>
        </button>
      </div>
    </section>`;
}

function lobbyHtml() {
  const guestHere = Boolean(state.guest?.connected);
  const isHost = state.you === 'host';
  return `
    <section class="lobby">
      <div class="code-block">
        <p class="hint">Код комнаты</p>
        <div class="code-row">
          <p class="code-value">${escapeHtml(state.code)}</p>
          <button class="btn" type="button" data-act="copy">Скопировать</button>
        </div>
        <p class="note">Скинь этот код другу. Он вводит его на главной и нажимает «Присоединиться».</p>
      </div>
      <div class="players">
        <div class="player online">
          <strong>Хост</strong>
          <span><i class="status-dot on"></i>${state.you === 'host' ? 'это ты' : 'в комнате'}</span>
        </div>
        <div class="player${guestHere ? ' online' : ''}">
          <strong>Друг</strong>
          <span><i class="status-dot${guestHere ? ' on' : ''}"></i>${guestHere ? (state.you === 'guest' ? 'это ты' : 'в комнате') : 'ждём'}</span>
        </div>
      </div>
      <div class="lobby-actions">
        ${isHost
          ? `<button class="btn" type="button" data-act="start" ${guestHere ? '' : 'disabled'}>Начать игру</button>`
          : `<button class="btn" type="button" disabled>Ждём, пока хост начнёт</button>`}
        <button class="btn ghost" type="button" data-act="leave">Выйти</button>
      </div>
      ${chatHtml(true)}
    </section>`;
}

function keyRanks(board) {
  const rank = { absent: 1, present: 2, correct: 3 };
  const map = {};
  for (const row of board || []) {
    for (let i = 0; i < row.guess.length; i += 1) {
      const ch = row.guess[i];
      const mark = row.marks[i];
      if (!map[ch] || rank[mark] > rank[map[ch]]) map[ch] = mark;
    }
  }
  return map;
}

function boardHtml(role) {
  const length = state.lengths[role];
  if (!length) return '<p class="wait-box">Слово ещё не загадано</p>';
  const rows = state.boards[role].map((row, index, all) => {
    const fresh = popRole === role && index === all.length - 1 ? ' pop' : '';
    const tiles = [...row.guess].map((ch, i) => (
      `<span class="tile ${row.marks[i]}">${escapeHtml(ch)}</span>`
    )).join('');
    return `<div class="row${fresh}" style="grid-template-columns: repeat(${length}, minmax(0, 1fr))">${tiles}</div>`;
  });

  const mine = state.you === role;
  const canType = mine && state.phase === 'play' && state.turn === role;
  if (canType) {
    const chars = draft.slice(0, length).split('');
    while (chars.length < length) chars.push('');
    const tiles = chars.map((ch) => `<span class="tile${ch ? ' filled' : ''}">${escapeHtml(ch)}</span>`).join('');
    rows.push(`<div class="row is-draft" style="grid-template-columns: repeat(${length}, minmax(0, 1fr))">${tiles}</div>`);
  } else if (!rows.length && state.phase === 'play') {
    const tiles = Array.from({ length }, () => '<span class="tile"></span>').join('');
    rows.push(`<div class="row" style="grid-template-columns: repeat(${length}, minmax(0, 1fr))">${tiles}</div>`);
  }

  const legend = mine
    ? '<p class="legend">Зелёная — буква на своём месте. Жёлтая — буква есть в слове. Серая — такой буквы нет.</p>'
    : '';
  return `<div class="board-wrap">${rows.join('')}${legend}</div>`;
}

function keyboardHtml() {
  const script = state.script[state.you] || 'ru';
  const rows = script === 'en' ? EN_ROWS : RU_ROWS;
  const ranks = keyRanks(state.boards[state.you]);
  const locked = state.phase !== 'play' || state.turn !== state.you;
  const keys = rows.map((row, index) => {
    const buttons = [...row].map((ch) => {
      const mark = ranks[ch] ? ` ${ranks[ch]}` : '';
      return `<button type="button" class="key${mark}" data-act="key" data-key="${ch}">${ch}</button>`;
    }).join('');
    const side = index === rows.length - 1
      ? `<button type="button" class="key wide" data-act="backspace">Стереть</button>${buttons}<button type="button" class="key wide" data-act="submit-guess">Ввод</button>`
      : buttons;
    return `<div class="keyboard-row">${side}</div>`;
  }).join('');
  return `<div class="keyboard${locked ? ' is-locked' : ''}">${keys}</div>`;
}

function columnHtml(role) {
  const mine = state.you === role;
  const online = Boolean(state[role]?.connected);
  const length = state.lengths[role];
  let body = '';

  if (!state[role]) {
    body = '<div class="wait-box"><p>Игрок ещё не зашёл</p></div>';
  } else if (state.phase === 'setup') {
    if (mine && !state.youSetWord) {
      body = `
        <form class="setup-box" data-act="set-word">
          <p>Загадай слово сопернику. От 3 до 16 букв, русские или английские.</p>
          <input class="setup-input" maxlength="16" autocomplete="off" placeholder="Слово">
          <button class="btn wide" type="submit">Загадать</button>
        </form>`;
    } else if (mine) {
      body = '<div class="wait-box"><p>Слово загадано. Ждём соперника.</p></div>';
    } else {
      body = `<div class="wait-box"><p>${state.opponentSetWord ? 'Соперник уже загадал слово.' : 'Соперник загадывает слово…'}</p></div>`;
    }
  } else {
    body = boardHtml(role);
    if (mine && state.phase === 'play') body += keyboardHtml();
    if (state.phase === 'done' && state.answers) {
      const secret = state.answers[role] || '';
      body += `<div class="result"><strong>${mine ? 'Тебе загадали' : 'Сопернику загадали'}</strong>${escapeHtml(secret.toUpperCase())}</div>`;
    }
  }

  const meta = [
    length ? `${length} букв` : (online ? 'в сети' : ''),
    online ? '' : 'нет связи',
  ].filter(Boolean).join(' · ');
  return `
    <section class="side${state.phase === 'play' && state.turn === role ? ' is-turn' : ''}">
      <div class="side-head">
        <h2>${roleName(role)} ${mine ? '<span class="you-badge">ты</span>' : ''}</h2>
        <span><i class="status-dot${online ? ' on' : ''}"></i>${meta}</span>
      </div>
      ${body}
    </section>`;
}

function gameHtml() {
  let turnText = 'Загадайте слова';
  let turnClass = '';
  if (state.phase === 'play') {
    if (state.turn === state.you) {
      turnText = 'Твой ход';
      turnClass = ' you';
    } else {
      turnText = state.turn === 'host' ? 'Ход хоста' : 'Ход друга';
    }
  } else if (state.phase === 'done') {
    if (state.winner === state.you) turnText = 'Ты победил';
    else turnText = state.winner === 'host' ? 'Победил хост' : 'Победил друг';
    turnClass = ' you';
  }

  const again = state.phase === 'done' && state.you === 'host'
    ? '<button class="btn" type="button" data-act="again">Сыграть ещё</button>'
    : '';
  const wait = state.phase === 'done' && state.you !== 'host'
    ? '<p class="note">Ждём, пока хост начнёт новый раунд</p>'
    : '';

  return `
    <section class="game-screen">
      <div class="game-top">
        <div class="pill">
          <span>Код</span>
          <strong>${escapeHtml(state.code)}</strong>
          <button class="btn" type="button" data-act="copy">Скопировать</button>
        </div>
        <div class="turn-wrap">
          <div class="turn${turnClass}">${turnText}</div>
          ${wait}
        </div>
        <div class="top-actions">${again}<button class="btn ghost" type="button" data-act="leave">Выйти</button></div>
      </div>
      <div class="game-grid">
        ${columnHtml('host')}
        ${chatHtml()}
        ${columnHtml('guest')}
      </div>
    </section>`;
}

function render() {
  captureForm();
  if (!state) {
    headerSlot.innerHTML = '';
    view.innerHTML = homeHtml();
    return;
  }
  headerSlot.innerHTML = state.phase === 'lobby'
    ? ''
    : '';
  view.innerHTML = state.phase === 'lobby' ? lobbyHtml() : gameHtml();
  restoreForm();
}

function currentLength() {
  if (!state || state.phase !== 'play' || !state.you) return 0;
  return state.lengths[state.you] || 0;
}

function typeLetter(letter) {
  if (!state || state.phase !== 'play' || state.turn !== state.you) return;
  const max = currentLength();
  const script = state.script[state.you];
  const ch = String(letter || '').toLowerCase();
  const ok = script === 'en' ? /^[a-z]$/.test(ch) : /^[а-яё]$/.test(ch);
  if (!ok || draft.length >= max) return;
  draft += ch;
  paintDraft();
}

function paintDraft() {
  const row = document.querySelector('.row.is-draft');
  if (!row) return;
  const max = currentLength();
  const chars = draft.slice(0, max).split('');
  while (chars.length < max) chars.push('');
  [...row.children].forEach((tile, i) => {
    tile.textContent = chars[i] || '';
    tile.classList.toggle('filled', Boolean(chars[i]));
  });
}

function shakeDraft() {
  const row = document.querySelector('.row.is-draft');
  if (!row) return;
  row.classList.remove('shake');
  void row.offsetWidth;
  row.classList.add('shake');
}

function submitGuess() {
  if (!state || state.phase !== 'play' || state.turn !== state.you) return;
  const max = currentLength();
  if (draft.length !== max) {
    shakeDraft();
    toast(`Нужно ${max} букв`);
    return;
  }
  socket.emit('guess', { word: draft });
  draft = '';
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (!el || el.tagName === 'FORM') return;
  const act = el.dataset.act;
  if (act === 'home') {
    if (state) {
      event.preventDefault();
      toast('Сначала выйди из комнаты');
    }
    return;
  }
  if (act === 'create') {
    socket.emit('create', { game: el.dataset.game });
    return;
  }
  if (act === 'copy' && state) {
    navigator.clipboard.writeText(state.code).then(
      () => toast('Код скопирован'),
      () => toast('Не удалось скопировать'),
    );
    return;
  }
  if (act === 'start') socket.emit('start');
  if (act === 'leave') socket.emit('leave');
  if (act === 'again') socket.emit('again');
  if (act === 'key') typeLetter(el.dataset.key);
  if (act === 'backspace') {
    draft = draft.slice(0, -1);
    paintDraft();
  }
  if (act === 'submit-guess') submitGuess();
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form');
  if (!form) return;
  event.preventDefault();
  const act = form.dataset.act;
  if (act === 'join') {
    const code = form.querySelector('input').value;
    socket.emit('join', { code });
    return;
  }
  if (act === 'set-word') {
    const word = form.querySelector('input').value;
    socket.emit('setWord', { word });
    setupDraft = '';
    return;
  }
  if (act === 'send-chat') {
    const input = form.querySelector('input');
    socket.emit('chat', { text: input.value });
    chatDraft = '';
    input.value = '';
  }
});

document.addEventListener('keydown', (event) => {
  if (!state || state.phase !== 'play') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (event.key === 'Enter') {
    event.preventDefault();
    submitGuess();
    return;
  }
  if (event.key === 'Backspace') {
    event.preventDefault();
    draft = draft.slice(0, -1);
    paintDraft();
    return;
  }
  if (event.key.length === 1) typeLetter(event.key);
});

socket.on('connect', () => {
  connected = true;
  if (!state) render();
});

socket.on('disconnect', () => {
  connected = false;
  toast('Нет связи с сервером');
});

socket.on('hello', (payload) => {
  if (payload?.token && payload.token !== token) {
    token = payload.token;
    sessionStorage.setItem(TOKEN_KEY, token);
  }
});

socket.on('state', (next) => {
  popRole = null;
  if (!state || state.code !== next.code || state.phase !== next.phase) {
    draft = '';
  } else if (next.you && state.boards[next.you].length !== next.boards[next.you].length) {
    draft = '';
  }
  if (state && state.code === next.code) {
    if (next.boards.host.length > state.boards.host.length) popRole = 'host';
    else if (next.boards.guest.length > state.boards.guest.length) popRole = 'guest';
  }
  state = next;
  render();
});

socket.on('closed', ({ message }) => {
  state = null;
  draft = '';
  render();
  toast(message || 'Комната закрыта');
});

socket.on('errorMsg', (payload) => {
  const text = typeof payload === 'string' ? payload : payload.text;
  toast(text || 'Ошибка');
  if (payload?.shake) shakeDraft();
});

render();
