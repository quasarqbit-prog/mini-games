(function lobbyShell() {
  const ICONS = {
    wordle: '/assets/wordle.png',
    battle: '/assets/sea_war.png',
    cinema: '/assets/cinema.png',
    mono: '/assets/monopoly.png',
  };
  const GAMES = ['wordle', 'battle', 'cinema', 'mono'];
  let page = 0;
  let inviteOpen = false;
  let inviteUsed = false;
  let motion = null;
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
        <span class="slot-face">${face(slot, '•')}</span>
        <span class="slot-name">${escapeHtml(slot.name || slot.id || '—')}</span>
        ${star}
      </div>`;
  }

  function cardHtml(id, hub) {
    const chosen = hub.game === id;
    return `
      <div class="pick-icon"><img src="${ICONS[id]}" alt=""></div>
      <h2>${escapeHtml(gameTitle(id))}</h2>
      <p>${escapeHtml(tr(`game.${id}.text`, ''))}</p>
      <button type="button" class="act" data-hub="choose" data-game="${id}">${escapeHtml(tr(chosen ? 'hub.chosen' : 'hub.choose', chosen ? 'Выбрано' : 'Выбрать'))}</button>`;
  }

  function inviteLayer(hub, online) {
    if (!inviteOpen) return '';
    const taken = new Set(hub.slots.filter((slot) => !slot.empty).map((slot) => slot.id));
    const people = (online || []).filter((person) => person.id && !person.you);
    const rows = people.length
      ? people.map((person) => {
        const blocked = inviteUsed || taken.has(person.id);
        const plus = blocked
          ? '<span class="slot-plus off" aria-hidden="true">+</span>'
          : `<button type="button" class="slot-plus" data-hub="send" data-id="${escapeHtml(person.id)}">+</button>`;
        return `
          <div class="slot">
            <span class="slot-face">${face(person, person.id)}</span>
            <span class="slot-name">${escapeHtml(person.name || person.id)}</span>
            ${plus}
          </div>`;
      }).join('')
      : `<p>${escapeHtml(tr('hub.nobody', 'Сейчас на сайте никого нет'))}</p>`;
    return `
      <div class="invite-layer" data-hub="invite-close">
        <div class="invite-sheet" data-hub="invite-hold">
          <div class="invite-head">
            <b>${escapeHtml(tr('hub.invite', 'Пригласить'))}</b>
            <button type="button" data-hub="invite-dismiss">${escapeHtml(tr('profile.close', 'Закрыть'))}</button>
          </div>
          ${rows}
        </div>
      </div>`;
  }

  function paint() {
    if (!last?.root) return;
    const hub = last.hub;
    const game = GAMES[page] || GAMES[0];
    const me = last.me || {};
    const enterClass = motion ? (motion.dir > 0 ? 'in-bottom' : 'in-top') : '';
    const leaveClass = motion ? (motion.dir > 0 ? 'out-up' : 'out-down') : '';
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
          <div class="hub-slots hub-frame">
            ${hub.slots.map(slotHtml).join('')}
          </div>
          <div class="hub-pick hub-frame">
            <div class="pick-col">
              <div class="pick-stage">
                ${motion ? `<article class="pick-card fly ${leaveClass}">${cardHtml(GAMES[motion.from], hub)}</article>` : ''}
                <article class="pick-card ${enterClass}">${cardHtml(game, hub)}</article>
              </div>
              <div class="pick-nav">
                <button type="button" class="act" data-hub="page" data-dir="-1" aria-label="Previous">↑</button>
                <button type="button" class="act" data-hub="page" data-dir="1" aria-label="Next">↓</button>
              </div>
            </div>
            <div class="gems">
              ${GAMES.map((id, index) => `
                <button type="button" class="gem-btn${index === page ? ' on' : ''}" data-hub="jump" data-index="${index}">
                  <i class="gem${index === page ? ' on' : ''}"></i>
                  <span>${escapeHtml(gameTitle(id))}</span>
                </button>`).join('')}
            </div>
          </div>
        </div>
        ${inviteLayer(hub, last.online)}
      </section>`;
    if (motion) {
      const node = last.root.querySelector('.pick-card.in-bottom, .pick-card.in-top');
      node?.addEventListener('animationend', () => { motion = null; }, { once: true });
    }
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
    if (act === 'invite-hold') return;
    if (act === 'invite-close' || act === 'invite-dismiss') {
      if (act === 'invite-close' && event.target !== el) return;
      inviteOpen = false;
      inviteUsed = false;
      paint();
      return;
    }
    if (act === 'slot') {
      inviteOpen = true;
      inviteUsed = false;
      paint();
      return;
    }
    if (act === 'page') {
      if (motion) return;
      const dir = Number(el.dataset.dir) || 1;
      motion = { dir, from: page };
      page = (page + dir + GAMES.length) % GAMES.length;
      paint();
      return;
    }
    if (act === 'jump') {
      const index = Number(el.dataset.index);
      if (!Number.isInteger(index) || index === page || index < 0 || index >= GAMES.length) return;
      motion = null;
      page = index;
      paint();
      return;
    }
    if (act === 'choose') {
      socket.emit('hub:game', { game: el.dataset.game });
      return;
    }
    if (act === 'send') {
      if (inviteUsed) return;
      socket.emit('hub:invite', { id: el.dataset.id });
      inviteUsed = true;
      paint();
      return;
    }
    if (act === 'leave') {
      inviteOpen = false;
      inviteUsed = false;
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
      last = { root, hub, me, online };
      paint();
    },
  };
  bindSocket();
})();
