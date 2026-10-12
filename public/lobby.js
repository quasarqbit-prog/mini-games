(function lobbyShell() {
  const GAMES = [
    { id: 'wordle', icon: wordleIcon },
    { id: 'battle', icon: battleIcon },
    { id: 'cinema', icon: cinemaIcon },
    { id: 'mono', icon: monoIcon },
  ];
  let page = 0;
  let openSlot = null;
  let last = null;
  const notes = [];

  function tr(key, fallback) {
    const value = window.Leisure?.t(key);
    return value && value !== key ? value : fallback;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function gameTitle(id) {
    return tr(`game.${id}`, id);
  }

  function face(person, letter) {
    if (person?.avatar) return `<img src="${escapeHtml(person.avatar)}" alt="">`;
    const mark = (person?.name || letter || '?').trim().slice(0, 1).toUpperCase() || '?';
    return `<span>${escapeHtml(mark)}</span>`;
  }

  function slotHtml(slot, index) {
    if (slot.empty) {
      return `
        <button type="button" class="slot" data-hub="slot" data-index="${index}">
          <span class="slot-plus" aria-hidden="true">+</span>
          <span>${escapeHtml(tr('slot.empty', 'Слот для игрока'))}</span>
        </button>`;
    }
    const star = slot.host ? '<svg class="slot-star" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.2 9.8 5.6 14.6 6l-3.6 3.1.9 4.7L8 11.6 4.1 13.8l.9-4.7L1.4 6l4.8-.4Z"/></svg>' : '';
    return `
      <div class="slot">
        <span class="slot-face">${face(slot, '•')}${star}</span>
        <span>${escapeHtml(slot.name || slot.id || '—')}</span>
      </div>`;
  }

  function inviteHtml(hub, online) {
    if (openSlot == null || !hub.slots[openSlot]?.empty) return '';
    const taken = new Set(hub.slots.filter((slot) => !slot.empty).map((slot) => slot.id));
    const people = (online || []).filter((person) => person.id && !person.you && !taken.has(person.id));
    const rows = people.length
      ? people.map((person) => `
          <button type="button" data-hub="send" data-id="${escapeHtml(person.id)}">
            ${face(person, person.id)}
            <span>${escapeHtml(person.name || person.id)}</span>
          </button>`).join('')
      : `<p>${escapeHtml(tr('hub.nobody', 'Сейчас на сайте никого нет'))}</p>`;
    return `<div class="invite-pop"><p>${escapeHtml(tr('hub.invite', 'Пригласить'))}</p>${rows}</div>`;
  }

  function paint() {
    if (!last?.root) return;
    const hub = last.hub;
    const game = GAMES[page] || GAMES[0];
    const chosen = hub.game === game.id;
    const me = last.me || {};
    last.root.innerHTML = `
      <section class="hub">
        <header class="hub-bar">
          <button type="button" class="act" data-hub="leave">${escapeHtml(tr('hub.leave', 'Выйти'))}</button>
          <div class="hub-brand"><b>LEISURE</b><small>${escapeHtml(hub.code)}</small></div>
          <div class="hub-you">
            <div>
              <b>${escapeHtml(me.name || '—')}</b>
              <small>${escapeHtml(me.id || '')}</small>
            </div>
            <span class="hub-avatar">${face(me, me.id)}</span>
          </div>
        </header>
        <div class="hub-main">
          <div class="hub-slots">
            ${hub.slots.map(slotHtml).join('')}
            ${inviteHtml(hub, last.online)}
          </div>
          <div class="hub-pick">
            <article class="pick-card">
              <div class="pick-icon">${game.icon()}</div>
              <h2>${escapeHtml(gameTitle(game.id))}</h2>
              <p>${escapeHtml(tr(`game.${game.id}.text`, ''))}</p>
              <button type="button" class="act" data-hub="choose" data-game="${game.id}">${escapeHtml(tr(chosen ? 'hub.chosen' : 'hub.choose', chosen ? 'Выбрано' : 'Выбрать'))}</button>
            </article>
            <div class="hub-arrows">
              <button type="button" class="act" data-hub="page" data-dir="-1" aria-label="Previous">↑</button>
              <button type="button" class="act" data-hub="page" data-dir="1" aria-label="Next">↓</button>
            </div>
            <div class="gems">
              ${GAMES.map((item, index) => `<i class="gem${index === page ? ' on' : ''}"></i>`).join('')}
            </div>
          </div>
        </div>
      </section>`;
  }

  function paintNotes() {
    const root = document.getElementById('hub-notes');
    if (!root) return;
    root.innerHTML = notes.map((note) => {
      const who = note.from || 'Игрок';
      const line = document.documentElement.lang === 'en'
        ? (note.game ? `${who} invites you to ${gameTitle(note.game)}` : `${who} invites you`)
        : (note.game ? `${who} приглашает тебя в ${gameTitle(note.game)}` : `${who} приглашает тебя`);
      return `
        <article class="hub-note">
          <p>${escapeHtml(line)}</p>
          <div>
            <button type="button" class="act" data-hub="accept" data-code="${escapeHtml(note.code)}">${escapeHtml(tr('note.accept', 'Принять'))}</button>
            <button type="button" class="act" data-hub="decline" data-key="${note.key}">${escapeHtml(tr('note.decline', 'Отклонить'))}</button>
          </div>
        </article>`;
    }).join('');
  }

  function paintPeek(payload) {
    const list = document.getElementById('gate-people');
    if (!list) return;
    if (!payload || payload.missing || !payload.players?.length) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    list.hidden = false;
    list.innerHTML = payload.players.map((person) => `
      <li>${face(person, person.id)}<span>${escapeHtml(person.name || person.id)}${person.host ? ' ★' : ''}</span></li>`).join('');
  }

  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-hub]');
    const socket = window.leisureSocket;
    if (!el || !socket) return;
    const act = el.dataset.hub;
    if (act === 'slot') {
      const index = Number(el.dataset.index);
      openSlot = openSlot === index ? null : index;
      paint();
      return;
    }
    if (act === 'page') {
      const dir = Number(el.dataset.dir) || 1;
      page = (page + dir + GAMES.length) % GAMES.length;
      paint();
      return;
    }
    if (act === 'choose') {
      socket.emit('hub:game', { game: el.dataset.game });
      return;
    }
    if (act === 'send') {
      socket.emit('hub:invite', { id: el.dataset.id });
      openSlot = null;
      paint();
      return;
    }
    if (act === 'leave') {
      openSlot = null;
      socket.emit('hub:leave');
      return;
    }
    if (act === 'accept') {
      socket.emit('hub:answer', { code: el.dataset.code, accept: true });
      const code = el.dataset.code;
      for (let i = notes.length - 1; i >= 0; i -= 1) if (notes[i].code === code) notes.splice(i, 1);
      paintNotes();
      return;
    }
    if (act === 'decline') {
      const key = Number(el.dataset.key);
      const index = notes.findIndex((note) => note.key === key);
      if (index >= 0) notes.splice(index, 1);
      paintNotes();
    }
  });

  document.getElementById('gate-join')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const socket = window.leisureSocket;
    if (!socket) return;
    const name = document.getElementById('onboard-name')?.value.replace(/\s+/g, ' ').trim().slice(0, 20) || '';
    const image = document.getElementById('onboard-avatar');
    const avatar = image && !image.hidden && String(image.src).startsWith('data:') ? image.src : null;
    window.leisureJoin?.({ name, avatar, code: document.getElementById('gate-code')?.value || '' });
  });

  let peekTimer = 0;
  document.getElementById('gate-code')?.addEventListener('input', () => {
    const socket = window.leisureSocket;
    const code = document.getElementById('gate-code')?.value.trim() || '';
    clearTimeout(peekTimer);
    if (!socket || code.length < 5) {
      paintPeek(null);
      return;
    }
    peekTimer = setTimeout(() => socket.emit('hub:peek', { code }), 160);
  });

  function bindSocket() {
    const socket = window.leisureSocket;
    if (!socket || socket.__hubBound) return Boolean(socket);
    socket.__hubBound = true;
    socket.on('hub:peek', paintPeek);
    socket.on('hub:invited', (note) => {
      notes.push({ ...note, key: Date.now() + Math.random() });
      paintNotes();
    });
    return true;
  }

  window.LobbyShell = {
    render(root, hub, me, online) {
      bindSocket();
      if (openSlot != null && !hub?.slots?.[openSlot]?.empty) openSlot = null;
      last = { root, hub, me, online };
      paint();
    },
  };
  bindSocket();

  function wordleIcon() {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="10" height="10" fill="#3f8f5b"/><rect x="18" y="14" width="10" height="10" fill="#c48a2a"/><rect x="30" y="14" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"/><rect x="42" y="14" width="10" height="10" fill="#3f8f5b"/><rect x="54" y="14" width="6" height="10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
  function battleIcon() {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="8" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 24h48M8 40h48M24 8v48M40 8v48" stroke="currentColor" stroke-width="2"/></svg>';
  }
  function cinemaIcon() {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="6" y="14" width="52" height="36" fill="none" stroke="currentColor" stroke-width="2"/><path d="M28 24v16l14-8Z" fill="currentColor"/></svg>';
  }
  function monoIcon() {
    return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M8 30 32 10l24 20" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16" y="30" width="32" height="24" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }
})();
