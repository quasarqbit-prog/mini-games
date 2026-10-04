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

let token = (localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '').replace(/[^\w-]/g, '').slice(0, 80);
if (!token) token = makeToken();
localStorage.setItem(TOKEN_KEY, token);

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
let booting = true;
let onlineUsers = [];
let state = null;
let draft = '';
let chatDraft = '';
let setupDraft = '';
let stickChat = true;
let focusKind = null;
let popRole = null;
let mobilePane = 'mine';
let pendingPane = null;
let chatUnread = 0;
let chatNotice = '';
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

function roomFromUrl() {
  const code = new URLSearchParams(location.search).get('room') || '';
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

let inviteCode = roomFromUrl();

function inviteUrl(code) {
  return `${location.origin}/?room=${encodeURIComponent(code)}`;
}

function copyText(text, okMessage) {
  const done = (ok) => toast(ok ? okMessage : 'Не удалось скопировать');
  const fallback = () => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    done(ok);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => done(true), fallback);
    return;
  }
  fallback();
}

function copyCode(text) {
  copyText(text, 'Код скопирован');
}

let audioCtx = null;
function playChatSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  gain.connect(audioCtx.destination);
  const tone = audioCtx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(880, now);
  tone.frequency.setValueAtTime(660, now + 0.09);
  tone.connect(gain);
  tone.start(now);
  tone.stop(now + 0.24);
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, '0');
}

function formatLeft(deadline) {
  const total = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
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

function onlineHtml() {
  const people = onlineUsers.map((person) => `
    <li class="online-person">
      ${avatarHtml(person, person.name || 'Игрок')}
      <span>${escapeHtml(person.name || 'Без имени')}</span>
      ${person.you ? '<i>это ты</i>' : ''}
    </li>`).join('');
  return `
    <section class="online">
      <h2>Сейчас онлайн</h2>
      ${people ? `<ul>${people}</ul>` : '<p class="note">Пока никого нет</p>'}
    </section>`;
}

function homeHtml() {
  if ((inviteCode || booting) && !state) {
    return `
      <section class="home">
        <p class="lead">Подключаемся…</p>
      </section>`;
  }
  return `
    <section class="home">
      <p class="lead">Открой игру и скинь код или ссылку другу. По ссылке он сразу попадёт в лобби.</p>
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
      ${onlineHtml()}
    </section>`;
}

function lobbyHtml() {
  const guestHere = Boolean(state.guest?.connected);
  const isHost = state.you === 'host';
  return `
    <section class="lobby">
      <div class="code-block">
        <p class="hint">Код комнаты</p>
        <p class="code-value">${escapeHtml(state.code)}</p>
        <div class="code-actions">
          <button class="btn" type="button" data-act="copy-link">Скопировать ссылку</button>
          <button class="btn ghost" type="button" data-act="copy">Скопировать код</button>
        </div>
        <p class="note">Ссылка открывает это лобби сразу. Код можно ввести на главной.</p>
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
      ${rulesHtml()}
      ${chatHtml(true)}
    </section>`;
}

function lengthHint(settings) {
  if (settings.lengthMode === 'exact') return 'Оба слова должны быть ровно этой длины.';
  if (settings.lengthMode === 'max') return 'Слово может быть короче, но не длиннее этого числа.';
  if (settings.lengthMode === 'first') return 'Первое отправленное слово задаёт длину второму игроку.';
  return 'Ограничения нет: каждый выбирает длину сам, от 3 до 16 букв.';
}

function rulesSummary(settings) {
  const letters = {
    own: 'длина своя, 3–16',
    exact: `ровно ${settings.length} букв`,
    max: `до ${settings.length} букв`,
    first: 'длина по первому слову',
  }[settings.lengthMode];
  const time = settings.timerOn ? `таймер ${pad2(settings.minutes)}:${pad2(settings.seconds)}` : 'без таймера';
  const hidden = settings.hidden ? 'скрытый ввод' : 'ввод соперника виден';
  const first = settings.firstTurn === 'random' ? 'первый ход случайный' : 'первый ход у хоста';
  return `Буквы: ${letters}. ${time}. ${hidden}. ${first}.`;
}

function rulesHtml() {
  const settings = state.settings;
  if (state.you !== 'host') {
    return `<section class="rules"><h3>Правила хоста</h3><p class="note">${escapeHtml(rulesSummary(settings))}</p></section>`;
  }
  const modeBtn = (value, label) => `<button type="button" class="${settings.lengthMode === value ? 'on' : ''}" data-act="setting" data-key="lengthMode" data-value="${value}">${label}</button>`;
  const lengthPick = settings.lengthMode === 'exact' || settings.lengthMode === 'max'
    ? `<label class="num-line">Букв <input class="num" data-setting-num="length" type="number" min="3" max="16" value="${settings.length}"></label>`
    : '';
  const timePick = settings.timerOn
    ? `<div class="time-line">
        <input class="num" data-setting-num="minutes" type="number" min="0" max="5" value="${settings.minutes}">
        <span>:</span>
        <input class="num" data-setting-num="seconds" type="number" min="0" max="60" value="${settings.seconds}">
        <strong>${pad2(settings.minutes)}:${pad2(settings.seconds)}</strong>
      </div>`
    : '';
  const onOff = (key, on) => `
    <button type="button" class="${on ? 'on' : ''}" data-act="setting" data-key="${key}" data-value="1">Вкл</button>
    <button type="button" class="${on ? '' : 'on'}" data-act="setting" data-key="${key}" data-value="0">Выкл</button>`;
  return `
    <section class="rules">
      <h3>Настройки</h3>
      <div class="rule">
        <p>Количество букв</p>
        <div class="seg">${modeBtn('own', 'Свой')}${modeBtn('exact', 'Ручной')}${modeBtn('max', 'Ручной-до')}${modeBtn('first', 'Первейший')}</div>
        <p class="note">${escapeHtml(lengthHint(settings))}</p>
        ${lengthPick}
      </div>
      <div class="rule">
        <p>Ограничение по времени</p>
        <div class="seg">${onOff('timerOn', settings.timerOn)}</div>
        ${timePick}
        <p class="note">Нужно успеть ввести слово, иначе ход пропускается. Максимум 5 минут и 60 секунд.</p>
      </div>
      <div class="rule">
        <p>Скрытый режим</p>
        <div class="seg">${onOff('hidden', settings.hidden)}</div>
        <p class="note">Соперник не видит буквы, пока слово не отправлено.</p>
      </div>
      <div class="rule">
        <p>Первый ход</p>
        <div class="seg">
          <button type="button" class="${settings.firstTurn === 'host' ? 'on' : ''}" data-act="setting" data-key="firstTurn" data-value="host">Хост</button>
          <button type="button" class="${settings.firstTurn === 'random' ? 'on' : ''}" data-act="setting" data-key="firstTurn" data-value="random">Случайно</button>
        </div>
      </div>
    </section>`;
}

function setupHint() {
  const settings = state.settings;
  if (!settings) return 'Загадай слово сопернику. От 3 до 16 букв, русские или английские.';
  if (settings.lengthMode === 'exact') return `Загадай слово ровно из ${settings.length} букв.`;
  if (settings.lengthMode === 'max') return `Загадай слово от 3 до ${settings.length} букв.`;
  if (settings.lengthMode === 'first') {
    return state.fixedLength
      ? `Длина уже задана: ${state.fixedLength} букв.`
      : 'Если ты отправишь слово первым, его длина станет обязательной для соперника.';
  }
  return 'Загадай слово сопернику. От 3 до 16 букв, русские или английские.';
}

function setupMax() {
  const settings = state.settings;
  if (!settings) return 16;
  if (settings.lengthMode === 'exact' || settings.lengthMode === 'max') return settings.length;
  if (settings.lengthMode === 'first' && state.fixedLength) return state.fixedLength;
  return 16;
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
  const showLive = !mine && state.phase === 'play' && state.turn === role && !state.settings?.hidden;
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
          <p>${setupHint()}</p>
          <input class="setup-input" maxlength="${setupMax()}" autocomplete="off" placeholder="Слово">
          <button class="btn wide" type="submit">Загадать</button>
        </form>`;
    } else if (mine) {
      const word = state.yourWord ? ` Ты загадал <strong>${escapeHtml(state.yourWord.toUpperCase())}</strong>.` : '';
      body = `<div class="wait-box"><p>Слово загадано.${word} Ждём соперника.</p></div>`;
    } else {
      body = `<div class="wait-box"><p>${state.opponentSetWord ? 'Соперник уже загадал слово.' : 'Соперник загадывает слово…'}</p></div>`;
    }
  } else {
    body = boardHtml(role);
    if (!mine && state.yourWord) {
      body = `<div class="given-word">Ты загадал <strong>${escapeHtml(state.yourWord.toUpperCase())}</strong></div>${body}`;
    }
    if (state.phase === 'done' && state.answers) {
      const secret = state.answers[role] || '';
      body += `<div class="result"><strong>${mine ? 'Тебе загадали' : 'Ты загадал'}</strong>${escapeHtml(secret.toUpperCase())}</div>`;
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
    ? '<p class="note">Ждём, пока хост откроет лобби</p>'
    : '';

  const chatLabel = chatUnread ? `Чат <i class="badge">${chatUnread}</i>` : 'Чат';
  const chatNote = chatUnread && mobilePane !== 'chat'
    ? `<button type="button" class="chat-note" data-act="pane" data-pane="chat">${escapeHtml(chatNotice || 'Новое сообщение в чате')}</button>`
    : '';
  const confirm = pendingPane
    ? `<div class="turn-confirm"><p>${pendingPane === 'mine' ? 'Твой ход. Перейти к своему вордлу?' : 'Ход соперника. Перейти и посмотреть?'}</p><button type="button" class="btn" data-act="confirm-pane">Перейти</button></div>`
    : '';
  const clock = state.phase === 'play' && state.settings?.timerOn && state.deadline
    ? `<div class="clock" data-deadline="${state.deadline}">${formatLeft(state.deadline)}</div>`
    : '';
  const given = state.yourWord && (state.phase === 'play' || state.phase === 'done')
    ? `<div class="given-word mobile-given">Ты загадал сопернику <strong>${escapeHtml(state.yourWord.toUpperCase())}</strong></div>`
    : '';

  return `
    <section class="game-screen">
      <div class="mobile-tabs">
        <button type="button" class="${mobilePane === 'mine' ? 'on' : ''}" data-act="pane" data-pane="mine">Свой вордл</button>
        <button type="button" class="${mobilePane === 'theirs' ? 'on' : ''}" data-act="pane" data-pane="theirs">Вордл второго игрока</button>
        <button type="button" class="${mobilePane === 'chat' ? 'on' : ''}" data-act="pane" data-pane="chat">${chatLabel}</button>
      </div>
      ${chatNote}
      ${given}
      <div class="game-top">
        <div class="pill">
          <span>Код</span>
          <strong>${escapeHtml(state.code)}</strong>
          <button class="btn" type="button" data-act="copy">Скопировать</button>
        </div>
        <div class="turn-wrap">
          <div class="turn${turnClass}">${turnText}</div>
          ${clock}
          ${wait}
        </div>
        <div class="top-actions">${again}<button class="btn ghost" type="button" data-act="leave">Выйти</button></div>
      </div>
      <div class="game-grid" data-pane="${mobilePane}">
        ${columnHtml('host')}
        ${chatHtml()}
        ${columnHtml('guest')}
      </div>
      ${confirm}
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
    yourWord: snapshot.yourWord,
    settings: snapshot.settings,
    fixedLength: snapshot.fixedLength,
    deadline: snapshot.deadline,
    theirDraft: snapshot.drafts ? snapshot.drafts[other] : '',
  });
}

function syncDraft() {
  if (!state || state.phase !== 'play' || state.turn !== state.you || state.settings?.hidden) return;
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
    copyCode(state.code);
    return;
  }
  if (act === 'copy-link' && state) {
    copyText(inviteUrl(state.code), 'Ссылка скопирована');
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
    if (mobilePane === 'chat') {
      chatUnread = 0;
      chatNotice = '';
    }
    if (pendingPane === mobilePane) pendingPane = null;
    render();
  }
  if (act === 'confirm-pane' && pendingPane) {
    mobilePane = pendingPane;
    pendingPane = null;
    render();
  }
  if (act === 'setting') {
    const key = el.dataset.key;
    let value = el.dataset.value;
    if (key === 'timerOn' || key === 'hidden') value = value === '1';
    socket.emit('settings', { ...state.settings, [key]: value });
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
  const setting = event.target.closest?.('[data-setting-num]');
  if (setting && state?.you === 'host' && state.phase === 'lobby') {
    socket.emit('settings', { ...state.settings, [setting.dataset.settingNum]: Number(setting.value) });
  }
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
  if (inviteCode && !state) socket.emit('join', { code: inviteCode });
});

socket.on('disconnect', () => {
  connected = false;
  booting = false;
  toast('Нет связи с сервером');
  if (!state) render();
});

socket.on('hello', (payload) => {
  if (payload?.token && payload.token !== token) {
    token = payload.token;
    localStorage.setItem(TOKEN_KEY, token);
  }
  if (!payload?.inRoom) {
    booting = false;
    if (!state) render();
  }
});

socket.on('online', (list) => {
  onlineUsers = Array.isArray(list) ? list : [];
  if (!state && !booting) render();
});

socket.on('state', (next) => {
  const prev = state;
  booting = false;
  popRole = null;
  if (!prev || prev.code !== next.code || prev.phase !== next.phase) {
    draft = '';
  } else if (next.you && prev.boards[next.you].length !== next.boards[next.you].length) {
    draft = '';
  }
  if (prev && prev.code === next.code) {
    if (next.boards.host.length > prev.boards.host.length) popRole = 'host';
    else if (next.boards.guest.length > prev.boards.guest.length) popRole = 'guest';
    const prevLast = prev.chat.at(-1)?.id || 0;
    const fresh = next.chat.filter((msg) => msg.id > prevLast && msg.from !== 'system' && msg.from !== next.you);
    if (fresh.length) {
      playChatSound();
      if (window.matchMedia('(max-width: 800px)').matches && mobilePane !== 'chat') {
        chatUnread += fresh.length;
        const last = fresh.at(-1);
        chatNotice = `${last.name || 'Сообщение'}: ${last.text}`;
      }
    }
  }
  if (next.phase === 'play' && (!prev || prev.phase !== 'play' || prev.turn !== next.turn)) {
    const target = next.turn === next.you ? 'mine' : 'theirs';
    pendingPane = mobilePane === target ? null : target;
  }
  if (next.phase !== 'play') pendingPane = null;
  if (next.phase === 'setup' && (!prev || prev.phase !== 'setup')) mobilePane = 'mine';
  if (inviteCode && next.code === inviteCode) inviteCode = '';
  state = next;
  if (prev && viewKey(prev) === viewKey(next)) return;
  render();
});

socket.on('closed', ({ message }) => {
  state = null;
  draft = '';
  pendingPane = null;
  chatUnread = 0;
  chatNotice = '';
  render();
  toast(message || 'Комната закрыта');
});

socket.on('errorMsg', (payload) => {
  const text = typeof payload === 'string' ? payload : payload.text;
  if (inviteCode && !state) {
    inviteCode = '';
    render();
  }
  toast(text || 'Ошибка');
  if (payload?.shake) shakeDraft();
});

render();

setInterval(() => {
  document.querySelectorAll('.clock').forEach((el) => {
    el.textContent = formatLeft(Number(el.dataset.deadline));
  });
}, 250);

document.addEventListener('pointerdown', () => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
});
