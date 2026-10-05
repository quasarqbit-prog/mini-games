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
const STICKER_KEY = 'leisure-stickers';

function loadStickers() {
  try {
    const data = JSON.parse(localStorage.getItem(STICKER_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((item) => /^data:image\/(png|jpeg|webp|gif);base64,/i.test(item)).slice(-30);
  } catch {
    return [];
  }
}

function saveStickers() {
  stickers = stickers.slice(-30);
  localStorage.setItem(STICKER_KEY, JSON.stringify(stickers));
}

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
let stickers = loadStickers();
let replyDraft = null;
let emojiOpen = false;
let emojiQuery = '';
let emojiCat = 0;
let pickerTab = 'emoji';
let stickerMenuId = '';
let emojiPack = null;

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
      <div class="sticker-box">
        <h3>Стикеры</h3>
        <p class="note">Они появляются в кнопке эмодзи и отправляются в чат.</p>
        <div class="sticker-grid">
          ${stickers.map((src, index) => `
            <span>
              <img src="${escapeHtml(src)}" alt="">
              <button type="button" data-act="sticker-delete" data-i="${index}" aria-label="Удалить стикер">×</button>
            </span>`).join('')}
        </div>
        <label class="btn ghost wide">Добавить стикер
          <input class="sticker-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
        </label>
      </div>
    </div>`;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('file'));
    reader.readAsDataURL(file);
  });
}

function fitImage(file, maxSize, type, quality, cover) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = cover
        ? Math.max(maxSize / image.width, maxSize / image.height)
        : Math.min(1, maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cover ? maxSize : width;
      canvas.height = cover ? maxSize : height;
      const ctx = canvas.getContext('2d');
      if (cover) ctx.drawImage(image, (maxSize - width) / 2, (maxSize - height) / 2, width, height);
      else ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL(type, quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

function resizeAvatar(file) {
  return fitImage(file, 96, 'image/jpeg', 0.72, true);
}

async function resizePhoto(file) {
  let quality = 0.72;
  let data = await fitImage(file, 960, 'image/jpeg', quality, false);
  while (data.length > 180000 && quality > 0.4) {
    quality -= 0.12;
    data = await fitImage(file, 960, 'image/jpeg', quality, false);
  }
  return data;
}

async function resizeSticker(file) {
  if (file.type === 'image/gif' && file.size <= 100000) return readFile(file);
  const type = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')
    ? 'image/webp'
    : 'image/png';
  let quality = 0.82;
  let data = await fitImage(file, 256, type, quality, false);
  while (data.length > 100000 && quality > 0.4 && type === 'image/webp') {
    quality -= 0.15;
    data = await fitImage(file, 256, type, quality, false);
  }
  return data;
}

function isSystemMessage(msg) {
  return Boolean(msg.system || msg.from === 'system');
}

function messageName(msg) {
  if (msg.name) return msg.name;
  if (msg.from && msg.from !== 'system') return displayName(msg.from);
  return 'Зритель';
}

function messageMine(msg) {
  if (state?.game === 'cinema') return Boolean(msg.mine);
  return msg.from === state?.you;
}

function messageBody(msg) {
  const parts = [];
  if (msg.reply?.text) {
    parts.push(`<span class="reply-quote"><span>${escapeHtml(msg.reply.name || '')}</span>${escapeHtml(msg.reply.text)}</span>`);
  }
  if (msg.text) parts.push(`<span class="msg-text">${escapeHtml(msg.text)}</span>`);
  if (msg.image) parts.push(`<img class="chat-photo" alt="Фото" src="${escapeHtml(msg.image)}">`);
  if (msg.sticker) {
    const open = stickerMenuId === String(msg.id);
    const owned = stickers.includes(msg.sticker);
    parts.push(`<span class="sticker-wrap">
      <button type="button" class="chat-sticker" data-act="sticker-menu" data-id="${escapeHtml(String(msg.id))}"><img alt="Стикер" src="${escapeHtml(msg.sticker)}"></button>
      ${open ? (owned
        ? '<span class="sticker-owned">Уже в стикерах</span>'
        : `<button type="button" class="btn ghost" data-act="sticker-save" data-id="${escapeHtml(String(msg.id))}">В стикеры</button>`) : ''}
    </span>`);
  }
  return parts.join('');
}

function messageHtml(msg) {
  if (isSystemMessage(msg)) return `<div class="msg system">${escapeHtml(msg.text)}</div>`;
  const who = messageName(msg);
  const cinema = state?.game === 'cinema';
  const head = cinema
    ? `${escapeHtml(who)} · ${chatStamp(msg.at)}`
    : `${avatarHtml(state?.[msg.from] || { name: who }, who)}${escapeHtml(who)}`;
  return `<div class="msg${messageMine(msg) ? ' mine' : ''}" data-id="${escapeHtml(String(msg.id))}"><b${cinema ? '' : ' class="person"'}>${head}</b>${messageBody(msg)}</div>`;
}

function chatComposer() {
  const reply = replyDraft ? `
    <div class="reply-draft">
      <span><b>${escapeHtml(replyDraft.name)}</b>${escapeHtml(replyDraft.text)}</span>
      <button type="button" data-act="reply-cancel" aria-label="Отменить ответ">×</button>
    </div>` : '';
  return `
    ${reply}
    <div class="emoji-pop" ${emojiOpen ? '' : 'hidden'}>
      <div class="emoji-tabs">
        <button type="button" class="${pickerTab === 'emoji' ? 'on' : ''}" data-act="picker-tab" data-tab="emoji">Эмодзи</button>
        <button type="button" class="${pickerTab === 'stickers' ? 'on' : ''}" data-act="picker-tab" data-tab="stickers">Стикеры</button>
      </div>
      <div class="emoji-body"></div>
    </div>
    <form class="chat-form" data-act="send-chat">
      <button class="icon-btn" type="button" data-act="emoji-open" aria-label="Эмодзи">☺</button>
      <button class="icon-btn" type="button" data-act="photo-open" aria-label="Прикрепить фото" title="Прикрепить фото">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M21 6h-3.2l-1.2-2H7.4L6.2 6H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zm-9 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>
      </button>
      <input class="photo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      <input class="chat-input" maxlength="400" placeholder="Сообщение" autocomplete="off">
      <button type="submit">Отправить</button>
    </form>`;
}

function chatHtml() {
  const lines = (state?.chat || []).map((msg) => messageHtml(msg)).join('');
  return `
    <section class="chat-panel">
      <div class="chat-log">${lines || '<div class="msg system">Сообщений пока нет</div>'}</div>
      ${chatComposer()}
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
      <p class="lead">Открой Wordle или кинотеатр и скинь ссылку другу. Он попадёт в ту же комнату.</p>
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
        <button class="game-card" type="button" data-act="create" data-game="cinema" ${connected ? '' : 'disabled'}>
          <div class="film-preview" aria-hidden="true"><i class="seek back"></i><i class="pause"></i><i class="seek fwd"></i></div>
          <h2>Кинотеатр</h2>
          <p>Смотрите вместе: YouTube, Twitch, Google Drive и Dropbox.</p>
          <span class="tag">вместе</span>
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
  if (state?.game === 'cinema') {
    renderCinema();
    return;
  }
  captureForm();
  document.body.classList.remove('in-cinema');
  document.body.classList.toggle('in-game', Boolean(state && state.phase !== 'lobby'));
  renderHeader();
  view.innerHTML = state ? (state.phase === 'lobby' ? lobbyHtml() : gameHtml()) : homeHtml();
  restoreForm();
  paintPicker();
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
  if (act === 'cinema-tab') {
    cinemaTab = el.dataset.tab === 'people' ? 'people' : 'chat';
    if (cinemaTab === 'chat') cinemaUnread = 0;
    patchCinemaSide();
  }
  if (act === 'screen-start') startScreenShare();
  if (act === 'screen-stop') stopScreenShare();
  if (act === 'give-host') socket.emit('cinema:host', { id: el.dataset.id });
  if (act === 'hud-toggle') toggleHud(el);
  if (act === 'hud-pause') hudTogglePause();
  if (act === 'hud-seek') hudSeek(Number(el.dataset.by) || 0);
  if (act === 'stage-full') toggleCinemaFull();
  if (act === 'fs-chat') document.querySelector('.cinema')?.classList.toggle('side-open');
  if (act === 'emoji-open') {
    emojiOpen = !emojiOpen;
    if (emojiOpen) pickerTab = pickerTab || 'emoji';
    paintPicker();
  }
  if (act === 'photo-open') document.querySelector('.photo-file')?.click();
  if (act === 'reply-cancel') {
    replyDraft = null;
    paintReply();
  }
  if (act === 'picker-tab') {
    pickerTab = el.dataset.tab === 'stickers' ? 'stickers' : 'emoji';
    emojiOpen = true;
    paintPicker();
  }
  if (act === 'emoji-cat') {
    emojiCat = Number(el.dataset.cat) || 0;
    emojiQuery = '';
    const search = document.querySelector('.emoji-search');
    if (search) search.value = '';
    paintPicker();
  }
  if (act === 'emoji-insert') insertEmoji(el.dataset.char || el.textContent || '');
  if (act === 'sticker-send') sendSticker(Number(el.dataset.i));
  if (act === 'sticker-menu') {
    stickerMenuId = stickerMenuId === el.dataset.id ? '' : el.dataset.id;
    refreshChatLog();
  }
  if (act === 'sticker-save') saveChatSticker(el.dataset.id);
  if (act === 'sticker-delete') {
    stickers.splice(Number(el.dataset.i), 1);
    saveStickers();
    renderModal();
    paintPicker();
  }
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
    const input = form.querySelector('input.chat-input');
    sendChat({ text: input.value });
    return;
  }
  if (act === 'cinema-url') {
    const input = form.querySelector('input');
    socket.emit('cinema:video', { url: input.value });
    return;
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

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target?.classList?.contains('cinema-url')) cinemaUrlDraft = target.value;
  if (target?.classList?.contains('cinema-volume')) {
    const value = Number(target.value);
    localStorage.setItem(CINEMA_VOL_KEY, String(value));
    localStorage.setItem(CINEMA_MUTE_KEY, value === 0 ? '1' : '0');
    applyCinemaVolume();
  }
  if (target?.classList?.contains('hud-scrub')) {
    hudScrub = true;
    const label = document.querySelector('.hud-now');
    if (label) label.textContent = formatClock(Number(target.value) / 10);
  }
  if (target?.classList?.contains('emoji-search')) {
    emojiQuery = target.value;
    paintEmojiGrid();
  }
});

document.addEventListener('change', async (event) => {
  if (event.target?.classList?.contains('hud-scrub')) {
    hudScrub = false;
    if (state?.youHost && state.video?.id && !state.video.live && !state.screen) {
      socket.emit('cinema:seek', { time: Number(event.target.value) / 10 });
    }
  }
  if (event.target?.classList?.contains('cinema-quality')) {
    localStorage.setItem(CINEMA_QUAL_KEY, event.target.value);
    applyCinemaQuality();
  }
  const setting = event.target.closest?.('[data-setting-num]');
  if (setting && state?.you === 'host' && state.phase === 'lobby') {
    socket.emit('settings', { ...state.settings, [setting.dataset.settingNum]: Number(setting.value) });
  }
  const input = event.target.closest?.('.avatar-file');
  if (input?.files?.[0] && profileDraft) {
    try {
      profileDraft.avatar = await resizeAvatar(input.files[0]);
      const typed = document.querySelector('.profile-name');
      if (typed) profileDraft.name = typed.value;
      renderModal();
    } catch {
      toast('Не удалось прочитать картинку');
    }
    return;
  }
  const stickerInput = event.target.closest?.('.sticker-file');
  if (stickerInput?.files?.[0]) {
    try {
      const data = await resizeSticker(stickerInput.files[0]);
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(data) || data.length > 100000) {
        toast('Стикер слишком большой');
      } else {
        stickers.push(data);
        saveStickers();
        renderModal();
        paintPicker();
        toast('Стикер сохранён');
      }
    } catch {
      toast('Не удалось прочитать стикер');
    }
    stickerInput.value = '';
    return;
  }
  const photoInput = event.target.closest?.('.photo-file');
  if (photoInput?.files?.[0]) {
    try {
      const image = await resizePhoto(photoInput.files[0]);
      const typed = document.querySelector('.chat-input');
      sendChat({ text: typed?.value || '', image });
    } catch {
      toast('Не удалось прочитать фото');
    }
    photoInput.value = '';
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
  if (next?.game === 'cinema') {
    handleCinemaState(next);
    return;
  }
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
  stopCinemaMedia();
  cinemaMounted = '';
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

let swipe = null;

document.addEventListener('pointerdown', (event) => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) {
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  if (emojiOpen && !event.target.closest('.emoji-pop, [data-act="emoji-open"]')) {
    emojiOpen = false;
    paintPicker();
  }
  const msg = event.target.closest?.('.msg[data-id]');
  if (!msg || event.target.closest('button, a, input, textarea')) {
    swipe = null;
    return;
  }
  swipe = { id: msg.dataset.id, x: event.clientX, y: event.clientY, el: msg, dx: 0, active: false };
});

document.addEventListener('pointermove', (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
    swipe.active = true;
  }
  swipe.dx = Math.max(-88, Math.min(88, dx));
  swipe.el.style.transition = 'none';
  swipe.el.style.transform = `translateX(${swipe.dx}px)`;
});

function finishSwipe() {
  if (!swipe) return;
  const { el, dx, id, active } = swipe;
  swipe = null;
  el.style.transition = '';
  el.style.transform = '';
  if (!active || Math.abs(dx) < 56 || !state) return;
  const msg = (state.chat || []).find((item) => String(item.id) === String(id));
  if (!msg || isSystemMessage(msg)) return;
  const text = msg.text || (msg.sticker ? 'Стикер' : msg.image ? 'Фото' : '');
  if (!text) return;
  replyDraft = { name: messageName(msg), text: text.slice(0, 140) };
  paintReply();
}

document.addEventListener('pointerup', finishSwipe);
document.addEventListener('pointercancel', () => {
  if (!swipe) return;
  swipe.el.style.transition = '';
  swipe.el.style.transform = '';
  swipe = null;
});

function foldText(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function ensureEmoji() {
  if (emojiPack) return Promise.resolve(emojiPack);
  if (!ensureEmoji.pending) {
    ensureEmoji.pending = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = '/emoji.js';
      tag.onload = () => {
        emojiPack = window.EMOJI_PACK || [];
        resolve(emojiPack);
      };
      tag.onerror = () => reject(new Error('emoji'));
      document.head.appendChild(tag);
    });
  }
  return ensureEmoji.pending;
}

function sendChat(extra) {
  if (!state) return;
  socket.emit('chat', {
    text: extra?.text || '',
    image: extra?.image || '',
    sticker: extra?.sticker || '',
    reply: replyDraft,
  });
  replyDraft = null;
  chatDraft = '';
  emojiOpen = false;
  const input = document.querySelector('.chat-input');
  if (input) input.value = '';
  paintReply();
  paintPicker();
}

function sendSticker(index) {
  const src = stickers[index];
  if (!src) return;
  sendChat({ sticker: src });
}

function saveChatSticker(id) {
  const msg = (state?.chat || []).find((item) => String(item.id) === String(id));
  if (!msg?.sticker) return;
  if (!stickers.includes(msg.sticker)) {
    stickers.push(msg.sticker);
    saveStickers();
    toast('Стикер добавлен');
  }
  stickerMenuId = '';
  refreshChatLog();
  paintPicker();
}

function insertEmoji(char) {
  const input = document.querySelector('.chat-input');
  if (!input || !char) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = `${input.value.slice(0, start)}${char}${input.value.slice(end)}`;
  chatDraft = input.value;
  const caret = start + char.length;
  input.focus();
  input.setSelectionRange(caret, caret);
}

function paintReply() {
  const form = document.querySelector('.chat-form');
  if (!form) return;
  let bar = form.parentElement?.querySelector(':scope > .reply-draft');
  if (!replyDraft) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'reply-draft';
    form.before(bar);
  }
  bar.innerHTML = `<span><b>${escapeHtml(replyDraft.name)}</b>${escapeHtml(replyDraft.text)}</span><button type="button" data-act="reply-cancel" aria-label="Отменить ответ">×</button>`;
}

function refreshChatLog() {
  if (state?.game === 'cinema') {
    patchCinemaSide();
    return;
  }
  const log = document.querySelector('.chat-log');
  if (!log || !state) return;
  const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  log.innerHTML = (state.chat || []).map((msg) => messageHtml(msg)).join('') || '<div class="msg system">Сообщений пока нет</div>';
  if (stick) log.scrollTop = log.scrollHeight;
}

function paintPicker() {
  const pop = document.querySelector('.emoji-pop');
  if (!pop) return;
  pop.hidden = !emojiOpen;
  document.querySelectorAll('[data-act="picker-tab"]').forEach((button) => {
    button.classList.toggle('on', button.dataset.tab === pickerTab);
  });
  if (!emojiOpen) return;
  const body = pop.querySelector('.emoji-body');
  if (!body) return;
  if (pickerTab === 'stickers') {
    body.innerHTML = stickers.length
      ? `<div class="sticker-pick">${stickers.map((src, index) => `<button type="button" data-act="sticker-send" data-i="${index}"><img alt="" src="${escapeHtml(src)}"></button>`).join('')}</div>`
      : '<p class="note">Стикеров пока нет. Добавь их в профиле.</p>';
    return;
  }
  if (!body.querySelector('.emoji-search')) {
    body.innerHTML = `
      <input class="emoji-search" placeholder="Поиск" value="${escapeHtml(emojiQuery)}" autocomplete="off">
      <div class="emoji-cats"></div>
      <div class="emoji-grid"></div>`;
  }
  if (!emojiPack) {
    const grid = body.querySelector('.emoji-grid');
    if (grid) grid.textContent = 'Загрузка…';
    ensureEmoji().then(() => { if (emojiOpen && pickerTab === 'emoji') paintPicker(); }).catch(() => {
      const failed = document.querySelector('.emoji-grid');
      if (failed) failed.textContent = 'Не удалось загрузить эмодзи.';
    });
    return;
  }
  paintEmojiGrid();
}

function paintEmojiGrid() {
  if (!emojiPack) return;
  const cats = document.querySelector('.emoji-cats');
  const grid = document.querySelector('.emoji-grid');
  if (!cats || !grid) return;
  const query = foldText(emojiQuery.trim());
  cats.innerHTML = emojiPack.map((group, index) => `<button type="button" class="${!query && index === emojiCat ? 'on' : ''}" data-act="emoji-cat" data-cat="${index}">${escapeHtml(group.title)}</button>`).join('');
  const items = [];
  if (query) {
    for (const group of emojiPack) {
      for (const item of group.items) {
        if (foldText(item[1]).includes(query) || item[0] === emojiQuery.trim()) items.push(item[0]);
        if (items.length >= 280) break;
      }
      if (items.length >= 280) break;
    }
  } else {
    items.push(...(emojiPack[emojiCat] || emojiPack[0]).items.map((item) => item[0]));
  }
  grid.innerHTML = items.length
    ? items.map((char) => `<button type="button" data-act="emoji-insert">${char}</button>`).join('')
    : '<p class="note">Ничего не нашлось</p>';
}

const CINEMA_VOL_KEY = 'leisure-cinema-volume';
const CINEMA_MUTE_KEY = 'leisure-cinema-muted';
const CINEMA_QUAL_KEY = 'leisure-cinema-quality';
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let cinemaTab = 'chat';
let cinemaUnread = 0;
let cinemaUrlDraft = '';
let cinemaMounted = '';
let cinemaClockOffset = 0;
let hudScrub = false;
let ytPlayer = null;
let ytReady = null;
let twitchPlayer = null;
let twitchReady = null;
let ytCatching = false;
let ytSawPlayback = false;
let remoteAction = 0;
let lastSample = 0;
let screenStream = null;
let watchPc = null;
const hostPeers = new Map();

function cinemaStructure(snapshot) {
  return JSON.stringify({
    code: snapshot.code,
    videoId: snapshot.video?.id || '',
    kind: snapshot.video?.kind || '',
    screen: Boolean(snapshot.screen),
    youHost: Boolean(snapshot.youHost),
  });
}

function savedVolume() {
  const raw = localStorage.getItem(CINEMA_VOL_KEY);
  if (raw == null || raw === '') return 80;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 80;
  return Math.min(100, Math.max(0, value));
}

function savedQuality() {
  return localStorage.getItem(CINEMA_QUAL_KEY) || 'auto';
}

function mediaClock(video) {
  if (!video?.id) return 0;
  if (!video.playing) return video.at || 0;
  const now = Date.now() + cinemaClockOffset;
  const time = (video.at || 0) + Math.max(0, (now - video.updatedAt) / 1000);
  if (video.pauseAt != null) return Math.min(time, video.pauseAt);
  return time;
}

function chatStamp(at) {
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function cinemaMessages() {
  const lines = (state?.chat || []).map((msg) => messageHtml(msg)).join('');
  return lines || '<div class="msg system">Сообщений пока нет</div>';
}

function cinemaPeople() {
  const rows = (state?.members || []).map((person) => `
    <li class="viewer${person.connected ? '' : ' off'}">
      ${avatarHtml(person, person.name || 'Зритель')}
      <span>${escapeHtml(person.name || 'Без имени')}${person.you ? ' · это ты' : ''}</span>
      ${person.host ? '<em>хост</em>' : ''}
      ${state.youHost && !person.host && person.connected ? `<button type="button" class="btn ghost" data-act="give-host" data-id="${escapeHtml(person.id)}">Передать</button>` : ''}
    </li>`).join('');
  return rows || '<li class="note">Пока никого нет</li>';
}

function hostRoomCard() {
  if (!state?.youHost) return '';
  return `
    <div class="room-card">
      <div class="room-code">
        <span>Код</span>
        <strong>${escapeHtml(state.code)}</strong>
      </div>
      <button class="btn" type="button" data-act="copy-link">Скопировать ссылку</button>
      ${state.video?.id && !state.screen ? `<form data-act="cinema-url">
        <input class="cinema-url" value="${escapeHtml(cinemaUrlDraft)}" placeholder="Другая ссылка" autocomplete="off">
        <button class="btn" type="submit">Сменить</button>
      </form>` : ''}
      ${state.screen
        ? '<button class="btn ghost wide" type="button" data-act="screen-stop">Остановить демонстрацию</button>'
        : '<button class="btn ghost wide" type="button" data-act="screen-start">Демонстрация экрана</button>'}
    </div>`;
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) return `${hours}:${pad2(mins)}:${pad2(secs)}`;
  return `${mins}:${pad2(secs)}`;
}

function coarsePointer() {
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

function toggleHud(el) {
  if (!coarsePointer()) return;
  el.closest('.stage-frame')?.classList.toggle('hud-on');
}

function hudTogglePause() {
  if (!state?.video?.id || state.video.live || state.video.clip || state.screen) return;
  const time = playbackAdapter()?.time?.() || mediaClock(state.video);
  if (state.video.playing || state.video.pauseAt != null) socket.emit('cinema:pause', { time });
  else socket.emit('cinema:play');
}

function hudSeek(delta) {
  if (!state?.youHost || !state.video?.id || state.video.live || state.video.clip || state.screen) return;
  const time = playbackAdapter()?.time?.() || mediaClock(state.video);
  socket.emit('cinema:seek', { time: Math.max(0, time + delta) });
}

function toggleCinemaFull() {
  const root = document.querySelector('.cinema');
  if (!root) return;
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  if (active) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
    return;
  }
  const ask = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!ask) {
    toast('Этот браузер не открывает полный экран');
    return;
  }
  Promise.resolve(ask.call(root)).catch(() => toast('Не удалось открыть на весь экран'));
}

function mediaDuration() {
  try {
    const youtube = ytPlayer?.getDuration?.();
    if (youtube > 0) return youtube;
  } catch { /* player is still starting */ }
  try {
    const twitch = twitchPlayer?.getDuration?.();
    if (twitch > 0) return twitch;
  } catch { /* player is still starting */ }
  const node = document.querySelector('.cloud-video');
  if (node && Number.isFinite(node.duration) && node.duration > 0) return node.duration;
  return 0;
}

function paintHud() {
  try {
  const hud = document.querySelector('.stage-hud');
  if (!hud || !state?.video?.id || state.screen || state.video.live || state.video.clip) return;
  const playing = Boolean(state.video.playing && state.video.pauseAt == null);
  hud.querySelector('.hud-pause')?.classList.toggle('is-paused', !playing);
  const time = playbackAdapter()?.time?.() || mediaClock(state.video);
  const duration = mediaDuration();
  const now = hud.querySelector('.hud-now');
  const end = hud.querySelector('.hud-dur');
  if (now && !hudScrub) now.textContent = formatClock(time);
  if (end) end.textContent = duration ? formatClock(duration) : '–:––';
  const scrub = hud.querySelector('.hud-scrub');
  if (scrub && !hudScrub && duration > 0) {
    scrub.max = String(Math.round(duration * 10));
    scrub.value = String(Math.round(Math.min(duration, Math.max(0, time)) * 10));
  }
  } catch { /* player is still starting */ }
}

function cinemaHtml() {
  const host = state.youHost;
  const volume = savedVolume();
  const quality = savedQuality();
  const badge = cinemaUnread && cinemaTab !== 'chat' ? `<i class="badge">${cinemaUnread}</i>` : '';
  const hasMedia = Boolean(state.screen || state.video?.id);
  const timeline = Boolean(state.video?.id && !state.video.live && !state.video.clip && !state.screen);
  const showQuality = state.video?.id && !state.screen && !state.video.clip && (state.video.kind === 'youtube' || state.video.kind === 'twitch' || !state.video.kind);
  const showVolume = state.screen || (state.video?.id && !state.video.clip);
  let stage = '';
  if (state.screen) {
    stage = '<video class="screen-video" autoplay playsinline></video>';
  } else if (state.video?.kind === 'twitch' && state.video.clip) {
    const parent = encodeURIComponent(location.hostname);
    stage = `<iframe class="twitch-clip" src="https://clips.twitch.tv/embed?clip=${encodeURIComponent(state.video.id)}&parent=${parent}&autoplay=true"></iframe>`;
  } else if (state.video?.kind === 'twitch' && state.video.id) {
    stage = '<div id="tw-player"></div><p class="stage-error" hidden></p>';
  } else if (state.video?.kind === 'file' && state.video.id) {
    stage = '<video class="cloud-video" playsinline></video><p class="stage-error" hidden></p>';
  } else if (state.video?.id) {
    stage = '<div id="yt-player"></div><p class="stage-error" hidden></p>';
  } else {
    stage = `
      <div class="source-box">
        <p>${host ? 'Вставь ссылку на YouTube, Twitch, Google Drive или Dropbox. Или начни демонстрацию экрана.' : 'Хост ещё не выбрал, что смотреть.'}</p>
        ${host ? `<form data-act="cinema-url">
          <input class="cinema-url" value="${escapeHtml(cinemaUrlDraft)}" placeholder="YouTube, Twitch, Drive или Dropbox" autocomplete="off">
          <button class="btn" type="submit">Смотреть вместе</button>
        </form>
        <button class="btn ghost" type="button" data-act="screen-start">Демонстрация экрана</button>` : ''}
      </div>`;
  }
  const hud = hasMedia ? `
    <button class="stage-shield" type="button" data-act="hud-toggle" aria-label="Управление"></button>
    <div class="stage-hud">
      <div class="hud-top">
        <div class="hud-audio">
          ${showQuality ? `<select class="cinema-quality" aria-label="Качество">
            ${[['auto', 'Авто'], ['small', '240p'], ['medium', '360p'], ['large', '480p'], ['hd720', '720p'], ['hd1080', '1080p']].map(([item, label]) => `<option value="${item}" ${item === quality ? 'selected' : ''}>${label}</option>`).join('')}
          </select>` : ''}
          ${showVolume ? `<label class="hud-volume"><span>Громкость</span><input class="cinema-volume" type="range" min="0" max="100" value="${volume}"></label>` : ''}
        </div>
        <button class="hud-btn hud-fs" type="button" data-act="stage-full" aria-label="На весь экран">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9V4h5v2H6v3H4zm10-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 3h-3v2h5v-5h-2v3z"/></svg>
        </button>
      </div>
      ${timeline ? `<div class="hud-bottom">
        <div class="hud-actions">
          <button class="hud-btn hud-pause" type="button" data-act="hud-pause" aria-label="Пауза">
            <svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
            <svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
          </button>
          ${host ? `<button class="hud-btn" type="button" data-act="hud-seek" data-by="-5" aria-label="Назад на 5 секунд">−5</button>
          <button class="hud-btn" type="button" data-act="hud-seek" data-by="5" aria-label="Вперёд на 5 секунд">+5</button>` : ''}
        </div>
        <div class="hud-line">
          <span class="hud-now">0:00</span>
          <input class="hud-scrub" type="range" min="0" max="1000" value="0" aria-label="Таймлайн" ${host ? '' : 'disabled'}>
          <span class="hud-dur">–:––</span>
        </div>
      </div>` : ''}
    </div>` : '';
  return `
    <section class="cinema">
      <div class="stage">
        <div class="stage-frame">${stage}${hud}</div>
        <div class="fs-edge" aria-hidden="true"></div>
        <button class="fs-toggle" type="button" data-act="fs-chat" aria-label="Чат">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.4 5.4 9.8 11l5.6 5.6L14 18l-7-7 7-7z"/></svg>
        </button>
      </div>
      <aside class="cinema-side">
        <div class="cinema-head">
          <div class="cinema-tabs">
            <button type="button" class="${cinemaTab === 'chat' ? 'on' : ''}" data-act="cinema-tab" data-tab="chat">Чат ${badge}</button>
            <button type="button" class="${cinemaTab === 'people' ? 'on' : ''}" data-act="cinema-tab" data-tab="people">Зрители</button>
          </div>
          <div class="cinema-head-actions">
            <button type="button" class="profile-chip" data-act="profile">${avatarHtml(profile, 'Я')}</button>
            <button class="btn ghost" type="button" data-act="leave">Выйти</button>
          </div>
        </div>
        <div class="cinema-chat" ${cinemaTab === 'chat' ? '' : 'hidden'}>
          <div class="chat-log cinema-log">${cinemaMessages()}</div>
          ${chatComposer()}
        </div>
        <div class="cinema-people-pane" ${cinemaTab === 'people' ? '' : 'hidden'}>
          ${hostRoomCard()}
          <ul class="cinema-people">${cinemaPeople()}</ul>
        </div>
      </aside>
    </section>`;
}

function patchCinemaSide() {
  const chat = document.querySelector('.cinema-log');
  if (chat) {
    const stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
    chat.innerHTML = cinemaMessages();
    if (stick) chat.scrollTop = chat.scrollHeight;
  }
  const people = document.querySelector('.cinema-people');
  if (people) people.innerHTML = cinemaPeople();
  const peoplePane = document.querySelector('.cinema-people-pane');
  if (peoplePane) peoplePane.hidden = cinemaTab !== 'people';
  const chatPane = document.querySelector('.cinema-chat');
  if (chatPane) chatPane.hidden = cinemaTab !== 'chat';
  document.querySelectorAll('[data-act="cinema-tab"]').forEach((button) => {
    const on = button.dataset.tab === cinemaTab;
    button.classList.toggle('on', on);
    if (button.dataset.tab === 'chat') {
      const badge = cinemaUnread && cinemaTab !== 'chat' ? ` <i class="badge">${cinemaUnread}</i>` : '';
      button.innerHTML = `Чат${badge}`;
    }
  });
}

function renderCinema() {
  const key = cinemaStructure(state);
  document.body.classList.add('in-game', 'in-cinema');
  if (key !== cinemaMounted || !document.querySelector('.cinema')) {
    cinemaMounted = key;
    captureForm();
    renderHeader();
    view.innerHTML = cinemaHtml();
    restoreForm();
    const log = document.querySelector('.cinema-log');
    if (log) log.scrollTop = log.scrollHeight;
    mountCinemaStage();
    paintPicker();
    return;
  }
  patchCinemaSide();
}

function handleCinemaState(next) {
  const prev = state?.game === 'cinema' ? state : null;
  booting = false;
  inviteCode = '';
  cinemaClockOffset = (next.serverNow || Date.now()) - Date.now();
  if (prev && prev.code === next.code) {
    const prevLast = prev.chat.at(-1)?.id || 0;
    const fresh = next.chat.filter((msg) => msg.id > prevLast && !msg.system && !msg.mine);
    if (fresh.length) {
      playChatSound();
      if (cinemaTab !== 'chat') cinemaUnread += fresh.length;
    }
  }
  state = next;
  renderCinema();
  syncYouTube();
  if (next.screen && !next.youHost) ensureWatching();
  if (!next.screen) closeWatch();
}

function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytReady) {
    ytReady = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') previous();
        resolve();
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }
  return ytReady;
}

function mountCinemaStage() {
  ytCatching = false;
  ytSawPlayback = false;
  lastSample = 0;
  destroyYouTube();
  destroyTwitch();
  if (state.screen) {
    applyCinemaVolume();
    if (state.youHost && screenStream) attachLocalPreview();
    return;
  }
  closeWatch();
  const video = state.video;
  if (!video?.id) return;
  if (video.kind === 'twitch') {
    if (!video.clip) mountTwitch();
    return;
  }
  if (video.kind === 'file') {
    mountCloud();
    return;
  }
  const mount = document.getElementById('yt-player');
  if (!mount) return;
  loadYouTube().then(() => {
    if (state?.video?.kind === 'file' || state?.video?.kind === 'twitch') return;
    if (!state?.video?.id || state.screen || !document.getElementById('yt-player')) return;
    destroyYouTube();
    ytPlayer = new YT.Player('yt-player', {
      videoId: state.video.id,
      host: 'https://www.youtube.com',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        rel: 0,
        modestbranding: 1,
        iv_load_policy: 3,
        playsinline: 1,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          applyCinemaVolume();
          applyCinemaQuality();
          syncYouTube(true);
        },
        onStateChange: onYouTubeState,
        onError: onYouTubeError,
        onPlaybackQualityChange: (event) => {
          if (!event?.data || event.data === 'unknown') return;
          localStorage.setItem(CINEMA_QUAL_KEY, event.data);
          const select = document.querySelector('.cinema-quality');
          if (select) select.value = event.data;
        },
      },
    });
  }).catch(() => showStageError('Не удалось загрузить плеер YouTube.'));
}

function destroyYouTube() {
  if (!ytPlayer) return;
  try { ytPlayer.destroy(); } catch { /* already gone */ }
  ytPlayer = null;
}

function destroyTwitch() {
  twitchPlayer = null;
  const mount = document.getElementById('tw-player');
  if (mount) mount.innerHTML = '';
}

function loadTwitch() {
  if (window.Twitch?.Player) return Promise.resolve();
  if (!twitchReady) {
    twitchReady = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://player.twitch.tv/js/embed/v1.js';
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error('twitch'));
      document.head.appendChild(tag);
    });
  }
  return twitchReady;
}

function mountTwitch() {
  const mount = document.getElementById('tw-player');
  if (!mount || !state?.video?.id) return;
  loadTwitch().then(() => {
    if (!state?.video || state.video.kind !== 'twitch' || state.video.clip || state.screen) return;
    if (!document.getElementById('tw-player') || !window.Twitch?.Player) return;
    destroyTwitch();
    const options = {
      width: '100%',
      height: '100%',
      parent: [location.hostname],
      autoplay: true,
      controls: false,
    };
    if (state.video.live) options.channel = state.video.id;
    else options.video = state.video.id;
    twitchPlayer = new Twitch.Player('tw-player', options);
    const player = twitchPlayer;
    player.addEventListener(Twitch.Player.READY, () => {
      applyCinemaVolume();
      applyCinemaQuality();
      if (!state.video.live) syncYouTube(true);
    });
    player.addEventListener(Twitch.Player.PLAY, () => {
      noteMediaPlay(player.getCurrentTime?.() || 0);
    });
    player.addEventListener(Twitch.Player.PAUSE, () => {
      noteMediaPause(player.getCurrentTime?.() || 0);
    });
    player.addEventListener(Twitch.Player.OFFLINE, () => {
      showStageError('Этот канал сейчас не в эфире.');
    });
  }).catch(() => showStageError('Не удалось загрузить плеер Twitch.'));
}

function mountCloud() {
  const node = document.querySelector('.cloud-video');
  if (!node || !state?.video?.id) return;
  node.src = `/media/${encodeURIComponent(state.code)}?t=${encodeURIComponent(token)}&v=${encodeURIComponent(state.video.id)}`;
  applyCinemaVolume();
  node.addEventListener('error', () => {
    showStageError('Файл не открывается. Проверь, что ссылка доступна всем, у кого она есть, и это видео.');
  });
  node.addEventListener('play', () => noteMediaPlay(node.currentTime || 0));
  node.addEventListener('pause', () => {
    if (node.seeking) return;
    noteMediaPause(node.currentTime || 0);
  });
  node.addEventListener('loadeddata', () => syncYouTube(true));
}

function noteMediaPlay(time) {
  if (!state?.video?.id || state.screen || state.video.live) return;
  ytSawPlayback = true;
  if (remoteAction || document.hidden) return;
  if (!state.video.playing) socket.emit('cinema:play', { time });
}

function noteMediaPause(time) {
  if (!state?.video?.id || state.screen || state.video.live) return;
  if (remoteAction || document.hidden || !ytSawPlayback) return;
  if (state.video.playing || state.video.pauseAt != null) socket.emit('cinema:pause', { time });
}

function showStageError(text) {
  const error = document.querySelector('.stage-error');
  if (!error) {
    toast(text);
    return;
  }
  error.hidden = false;
  error.textContent = text;
}

function onYouTubeError(event) {
  const messages = {
    2: 'Не получилось открыть это видео.',
    5: 'Плеер YouTube не смог воспроизвести ролик.',
    100: 'Ролик недоступен. Его могли удалить или скрыть.',
    101: 'Автор запретил встраивание этого ролика на другие сайты.',
    150: 'Автор запретил встраивание этого ролика на другие сайты.',
  };
  showStageError(messages[event.data] || 'Это видео не удаётся показать.');
}

function withRemote(fn) {
  remoteAction += 1;
  try { fn(); } catch { /* player may be mid-load */ }
  setTimeout(() => { remoteAction = Math.max(0, remoteAction - 1); }, 800);
}

function applyCinemaVolume() {
  const volume = savedVolume();
  const muted = volume === 0 || localStorage.getItem(CINEMA_MUTE_KEY) === '1';
  if (ytPlayer?.setVolume) {
    ytPlayer.setVolume(volume);
    if (muted) ytPlayer.mute();
    else ytPlayer.unMute();
  }
  if (twitchPlayer?.setVolume) {
    try {
      twitchPlayer.setVolume(volume / 100);
      twitchPlayer.setMuted(muted);
    } catch { /* player is still starting */ }
  }
  document.querySelectorAll('.cloud-video').forEach((node) => {
    node.volume = volume / 100;
    node.muted = muted;
  });
  const screen = document.querySelector('.screen-video');
  if (screen && !state?.youHost) {
    screen.volume = volume / 100;
    screen.muted = muted;
  }
}

function applyCinemaQuality() {
  const quality = savedQuality();
  if (quality === 'auto') return;
  if (ytPlayer) {
    try { ytPlayer.setPlaybackQuality(quality); } catch { /* quality hint is best-effort */ }
  }
  if (twitchPlayer?.setQuality) {
    const names = { small: '160p', medium: '360p', large: '480p', hd720: '720p', hd1080: '1080p' };
    try { twitchPlayer.setQuality(names[quality] || quality); } catch { /* ignore */ }
  }
}

function onYouTubeState(event) {
  if (!state?.video?.id || state.screen || state.video.live) return;
  if (event.data === YT.PlayerState.PLAYING) noteMediaPlay(ytPlayer?.getCurrentTime?.() || 0);
  else if (event.data === YT.PlayerState.PAUSED) noteMediaPause(ytPlayer?.getCurrentTime?.() || 0);
}

function playbackAdapter() {
  const video = state?.video;
  if (!video?.id || video.live || state?.screen) return null;
  if (video.kind !== 'twitch' && video.kind !== 'file' && ytPlayer?.getCurrentTime && window.YT?.PlayerState) {
    return {
      time: () => ytPlayer.getCurrentTime() || 0,
      status: () => ytPlayer.getPlayerState?.(),
      seek: (t) => ytPlayer.seekTo(t, true),
      play: () => ytPlayer.playVideo(),
      pause: () => ytPlayer.pauseVideo(),
      rate: (n) => { try { ytPlayer.setPlaybackRate(n); } catch { /* ignore */ } },
      PLAYING: YT.PlayerState.PLAYING,
      BUFFERING: YT.PlayerState.BUFFERING,
    };
  }
  if (video.kind === 'twitch' && twitchPlayer && typeof twitchPlayer.getCurrentTime === 'function') {
    let status = 1;
    try { status = twitchPlayer.isPaused() ? 2 : 1; } catch { status = 1; }
    return {
      time: () => { try { return twitchPlayer.getCurrentTime() || 0; } catch { return 0; } },
      status: () => status,
      seek: (t) => twitchPlayer.seek(t),
      play: () => twitchPlayer.play(),
      pause: () => twitchPlayer.pause(),
      rate: () => {},
      PLAYING: 1,
      BUFFERING: -99,
      jumpCatchup: true,
    };
  }
  const node = document.querySelector('.cloud-video');
  if (video.kind === 'file' && node) {
    return {
      time: () => node.currentTime || 0,
      status: () => ((node.seeking || node.readyState < 3) && !node.paused ? 3 : (node.paused ? 2 : 1)),
      seek: (t) => { node.currentTime = t; },
      play: () => node.play().catch(() => {}),
      pause: () => node.pause(),
      rate: (n) => { node.playbackRate = n; },
      PLAYING: 1,
      BUFFERING: 3,
    };
  }
  return null;
}

function syncYouTube(force) {
  const player = playbackAdapter();
  if (!player || !state?.video?.id) return;
  const target = mediaClock(state.video);
  const local = player.time() || 0;
  const playerState = player.status();
  const pauseAt = state.video.pauseAt;
  const playing = state.video.playing;
  if (state.youHost && !remoteAction && Math.abs(local - lastSample) > 2.4 && Math.abs(local - target) > 2.4) {
    lastSample = local;
    socket.emit('cinema:seek', { time: local });
    return;
  }
  if (!state.youHost && !remoteAction && Math.abs(local - lastSample) > 2.4 && Math.abs(local - target) > 1.5 && playerState !== player.BUFFERING) {
    lastSample = local;
    withRemote(() => player.seek(Math.max(0, target)));
    return;
  }
  lastSample = local;
  if (pauseAt != null && local >= pauseAt - 0.25) {
    ytCatching = false;
    player.rate(1);
    if (playerState === player.PLAYING) withRemote(() => player.pause());
    return;
  }
  if (!playing && pauseAt == null) {
    ytCatching = false;
    player.rate(1);
    if (Math.abs(local - state.video.at) > 1.2) withRemote(() => player.seek(state.video.at));
    if (playerState === player.PLAYING) withRemote(() => player.pause());
    return;
  }
  const behind = target - local;
  if (player.jumpCatchup) {
    if (behind >= 5) withRemote(() => player.seek(Math.max(0, target)));
    else if (behind < -1.5 && !state.youHost) withRemote(() => player.seek(Math.max(0, target)));
    if (force) {
      withRemote(() => {
        player.seek(Math.max(0, target));
        if (playing && pauseAt == null) player.play();
      });
    }
    return;
  }
  if (!ytCatching && behind >= 5) ytCatching = true;
  if (ytCatching && behind <= 0.35) ytCatching = false;
  player.rate(ytCatching ? (behind >= 12 ? 2 : 1.5) : 1);
  if (!state.youHost && behind < -1.5) {
    withRemote(() => player.seek(Math.max(0, target)));
    return;
  }
  if (force) {
    withRemote(() => {
      player.seek(Math.max(0, target));
      if (playing && pauseAt == null) player.play();
    });
    return;
  }
  const stalled = playerState !== player.PLAYING && playerState !== player.BUFFERING;
  if (stalled && playing && pauseAt == null) withRemote(() => player.play());
}

function stopCinemaMedia() {
  destroyYouTube();
  destroyTwitch();
  closeHostPeers();
  closeWatch();
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }
}

async function startScreenShare() {
  if (!state?.youHost) return;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast('Этот браузер не умеет показывать экран');
    return;
  }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      toast('Браузер не передал звук. Зрители увидят картинку без звука.');
    } catch {
      toast('Демонстрация отменена');
      return;
    }
  }
  const track = screenStream.getVideoTracks()[0];
  if (track) track.addEventListener('ended', () => stopScreenShare());
  socket.emit('cinema:screen', { start: true });
}

function stopScreenShare() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }
  closeHostPeers();
  if (state?.screen) socket.emit('cinema:screen', { start: false });
}

function attachLocalPreview() {
  const video = document.querySelector('.screen-video');
  if (!video || !screenStream) return;
  video.srcObject = screenStream;
  video.muted = true;
  video.play().catch(() => {});
}

function closeHostPeers() {
  hostPeers.forEach((pc) => pc.close());
  hostPeers.clear();
}

function closeWatch() {
  if (watchPc) {
    watchPc.close();
    watchPc = null;
  }
  const video = document.querySelector('.screen-video');
  if (video && !state?.youHost) video.srcObject = null;
}

function ensureWatching() {
  if (watchPc || !state?.screen || state.youHost) return;
  const video = document.querySelector('.screen-video');
  if (!video) return;
  watchPc = new RTCPeerConnection(ICE);
  watchPc.ontrack = (event) => {
    video.srcObject = event.streams[0];
    applyCinemaVolume();
    video.play().catch(() => toast('Нажми на экран, чтобы включить звук демонстрации'));
  };
  watchPc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('cinema:signal', { candidate: event.candidate });
  };
  socket.emit('cinema:watch');
}

async function hostOffer(viewerId) {
  if (!screenStream || hostPeers.has(viewerId)) return;
  const pc = new RTCPeerConnection(ICE);
  hostPeers.set(viewerId, pc);
  screenStream.getTracks().forEach((track) => pc.addTrack(track, screenStream));
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit('cinema:signal', { to: viewerId, candidate: event.candidate });
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('cinema:signal', { to: viewerId, description: pc.localDescription });
}

socket.on('cinema:viewer', ({ id } = {}) => {
  if (id) hostOffer(id).catch(() => toast('Не удалось подключить зрителя к демонстрации'));
});

socket.on('cinema:signal', async ({ from, description, candidate } = {}) => {
  try {
    if (state?.youHost) {
      const pc = hostPeers.get(from);
      if (!pc) return;
      if (description) await pc.setRemoteDescription(description);
      if (candidate) await pc.addIceCandidate(candidate);
      return;
    }
    if (!watchPc) ensureWatching();
    if (!watchPc) return;
    if (description?.type === 'offer') {
      await watchPc.setRemoteDescription(description);
      const answer = await watchPc.createAnswer();
      await watchPc.setLocalDescription(answer);
      socket.emit('cinema:signal', { to: from, description: watchPc.localDescription });
    }
    if (candidate) await watchPc.addIceCandidate(candidate);
  } catch { /* ignore late signaling */ }
});

socket.on('cinema:screen-off', () => {
  closeHostPeers();
  closeWatch();
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }
});

setInterval(() => {
  if (state?.game === 'cinema' && !state.screen) syncYouTube(false);
  if (state?.game === 'cinema') paintHud();
}, 500);

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.querySelector('.cinema')?.classList.remove('side-open');
});
