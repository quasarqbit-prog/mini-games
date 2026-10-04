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

const PROFILE_KEY = 'mg-profile';

function loadProfile() {
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
    return {
      name: String(data.name || '').slice(0, 20),
      avatar: String(data.avatar || ''),
    };
  } catch {
    return { name: '', avatar: '' };
  }
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
let mobilePane = 'mine';
let profile = loadProfile();
let profileOpen = false;
let profileDraft = null;

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

function displayName(role) {
  return state?.[role]?.name || roleName(role);
}

function avatarHtml(person, fallback) {
  if (person?.avatar) {
    return `<img class="avatar" src="${escapeHtml(person.avatar)}" alt="">`;
  }
  const letter = (person?.name || fallback || '?').trim().slice(0, 1).toUpperCase() || '?';
  return `<span class="avatar letter">${escapeHtml(letter)}</span>`;
}

function renderHeader() {
  headerSlot.innerHTML = `
    <button type="button" class="profile-chip" data-act="profile">
      ${avatarHtml(profile, 'Я')}
      <span>${escapeHtml(profile.name || 'Профиль')}</span>
    </button>`;
}

function renderModal() {
  const modal = document.getElementById('modal');
  if (!profileOpen || !profileDraft) {
    modal.hidden = true;
    modal.innerHTML = '';
    return;
  }
  const preview = profileDraft.avatar
    ? `<img class="avatar-preview" src="${escapeHtml(profileDraft.avatar)}" alt="">`
    : `<span class="avatar-preview letter">${escapeHtml((profileDraft.name || 'Я').trim().slice(0, 1).toUpperCase() || 'Я')}</span>`;
  modal.hidden = false;
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Профиль</h2>
      <p class="note">Это имя и аватарка видны другу в комнате.</p>
      <label class="avatar-pick">
        ${preview}
        <span>Выбрать аватарку</span>
        <input class="avatar-file" type="file" accept="image/png,image/jpeg,image/webp">
      </label>
      <form data-act="save-profile">
        <input class="profile-name" maxlength="20" placeholder="Имя" value="${escapeHtml(profileDraft.name)}">
        <div class="lobby-actions">
          <button class="btn" type="submit">Сохранить</button>
          <button class="btn ghost" type="button" data-act="close-profile">Закрыть</button>
        </div>
      </form>
      ${profileDraft.avatar ? '<button class="btn ghost wide" type="button" data-act="clear-avatar">Убрать аватарку</button>' : ''}
    </div>`;
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const size = 96;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / image.width, size / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

function chatHtml(compact) {
  const lines = (state?.chat || []).map((msg) => {
    if (msg.from === 'system') {
      return `<div class="msg system">${escapeHtml(msg.text)}</div>`;
    }
    const mine = msg.from === state.you;
    const who = msg.name || displayName(msg.from);
    const face = avatarHtml(state[msg.from] || { name: who }, who);
    return `<div class="msg${mine ? ' mine' : ''}"><b class="person">${face}${escapeHtml(who)}</b>${escapeHtml(msg.text)}</div>`;
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
          <div class="person">${avatarHtml(state.host, 'Хост')}<div><strong>${escapeHtml(displayName('host'))}</strong><span><i class="status-dot on"></i>${state.you === 'host' ? 'это ты' : 'в комнате'}</span></div></div>
        </div>
        <div class="player${guestHere ? ' online' : ''}">
          <div class="person">${state.guest ? avatarHtml(state.guest, 'Друг') : avatarHtml(null, '?')}<div><strong>${escapeHtml(state.guest?.name || 'Друг')}</strong><span><i class="status-dot${guestHere ? ' on' : ''}"></i>${guestHere ? (state.you === 'guest' ? 'это ты' : 'в комнате') : 'ждём'}</span></div></div>
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
  const showLive = !mine && state.phase === 'play' && state.turn === role;
  if (canType || showLive || (!rows.length && state.phase === 'play')) {
    const live = canType ? draft : (showLive ? (state.drafts?.[role] || '') : '');
    const chars = live.slice(0, length).split('');
    while (chars.length < length) chars.push('');
    const tiles = chars.map((ch) => `<span class="tile${ch ? ' filled' : ''}">${escapeHtml(ch)}</span>`).join('');
    const kind = canType ? ' is-draft' : ' is-live';
    rows.push(`<div class="row${kind}" style="grid-template-columns: repeat(${length}, minmax(0, 1fr))">${tiles}</div>`);
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
    if (state.phase === 'done' && state.answers) {
      const secret = state.answers[role] || '';
      body += `<div class="result"><strong>${mine ? 'Тебе загадали' : 'Сопернику загадали'}</strong>${escapeHtml(secret.toUpperCase())}</div>`;
    }
  }

  const meta = [
    length ? `${length} букв` : (online ? 'в сети' : ''),
    online ? '' : 'нет связи',
  ].filter(Boolean).join(' · ');
  const who = state[role] ? displayName(role) : roleName(role);
  const keyboard = mine && state.phase === 'play' && state[role] ? keyboardHtml() : '';
  return `
    <section class="side${state.phase === 'play' && state.turn === role ? ' is-turn' : ''}${mine ? ' is-mine' : ' is-theirs'}">
      <div class="side-head">
        <h2 class="person">${state[role] ? avatarHtml(state[role], who) : ''}${escapeHtml(who)} ${mine ? '<span class="you-badge">ты</span>' : ''}</h2>
        <span><i class="status-dot${online ? ' on' : ''}"></i>${meta}</span>
      </div>
      <div class="side-body">${body}</div>
      ${keyboard}
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
      turnText = `Ход: ${displayName(state.turn)}`;
    }
  } else if (state.phase === 'done') {
    if (state.winner === state.you) turnText = 'Ты победил';
    else turnText = `Победил ${displayName(state.winner)}`;
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
      <div class="mobile-tabs">
        <button type="button" class="${mobilePane === 'mine' ? 'on' : ''}" data-act="pane" data-pane="mine">Свой вордл</button>
        <button type="button" class="${mobilePane === 'theirs' ? 'on' : ''}" data-act="pane" data-pane="theirs">Вордл второго игрока</button>
        <button type="button" class="${mobilePane === 'chat' ? 'on' : ''}" data-act="pane" data-pane="chat">Чат</button>
      </div>
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
      <div class="game-grid" data-pane="${mobilePane}">
        ${columnHtml('host')}
        ${chatHtml()}
        ${columnHtml('guest')}
      </div>
    </section>`;
}

function render() {
  captureForm();
  document.body.classList.toggle('in-game', Boolean(state && state.phase !== 'lobby'));
  renderHeader();
  view.innerHTML = state ? (state.phase === 'lobby' ? lobbyHtml() : gameHtml()) : homeHtml();
  restoreForm();
}

function viewKey(snapshot) {
  if (!snapshot) return '';
  const other = snapshot.you === 'host' ? 'guest' : 'host';
  return JSON.stringify({
    code: snapshot.code,
    phase: snapshot.phase,
    turn: snapshot.turn,
    you: snapshot.you,
    boards: snapshot.boards,
    chat: snapshot.chat,
    winner: snapshot.winner,
    host: snapshot.host,
    guest: snapshot.guest,
    youSetWord: snapshot.youSetWord,
    opponentSetWord: snapshot.opponentSetWord,
    lengths: snapshot.lengths,
    script: snapshot.script,
    answers: snapshot.answers,
    theirDraft: snapshot.drafts ? snapshot.drafts[other] : '',
  });
}

function syncDraft() {
  if (!state || state.phase !== 'play' || state.turn !== state.you) return;
  socket.emit('draft', { word: draft });
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
  syncDraft();
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
    syncDraft();
  }
  if (act === 'pane' && el.dataset.pane) {
    mobilePane = el.dataset.pane;
    render();
  }
  if (act === 'profile') {
    profileDraft = { name: profile.name, avatar: profile.avatar };
    profileOpen = true;
    renderModal();
  }
  if (act === 'close-profile') {
    profileOpen = false;
    profileDraft = null;
    renderModal();
  }
  if (act === 'clear-avatar' && profileDraft) {
    const typed = document.querySelector('.profile-name');
    if (typed) profileDraft.name = typed.value;
    profileDraft.avatar = '';
    renderModal();
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
  if (act === 'save-profile') {
    const name = form.querySelector('.profile-name').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    profile = { name, avatar: profileDraft?.avatar || '' };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    socket.emit('profile', profile);
    profileOpen = false;
    profileDraft = null;
    renderModal();
    render();
    toast('Профиль сохранён');
  }
});

document.addEventListener('change', async (event) => {
  const input = event.target.closest?.('.avatar-file');
  if (!input?.files?.[0] || !profileDraft) return;
  try {
    profileDraft.avatar = await resizeAvatar(input.files[0]);
    const typed = document.querySelector('.profile-name');
    if (typed) profileDraft.name = typed.value;
    renderModal();
  } catch {
    toast('Не удалось прочитать картинку');
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
    syncDraft();
    return;
  }
  if (event.key.length === 1) typeLetter(event.key);
});

socket.on('connect', () => {
  connected = true;
  socket.emit('profile', profile);
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
  const prev = state;
  popRole = null;
  if (!prev || prev.code !== next.code || prev.phase !== next.phase) {
    draft = '';
  } else if (next.you && prev.boards[next.you].length !== next.boards[next.you].length) {
    draft = '';
  }
  if (prev && prev.code === next.code) {
    if (next.boards.host.length > prev.boards.host.length) popRole = 'host';
    else if (next.boards.guest.length > prev.boards.guest.length) popRole = 'guest';
  }
  if (next.phase === 'play' && (!prev || prev.phase !== 'play' || prev.turn !== next.turn)) {
    mobilePane = next.turn === next.you ? 'mine' : 'theirs';
  }
  if (next.phase === 'setup' && (!prev || prev.phase !== 'setup')) mobilePane = 'mine';
  state = next;
  if (prev && viewKey(prev) === viewKey(next)) return;
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
