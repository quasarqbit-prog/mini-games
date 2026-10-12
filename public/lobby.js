(function lobbyShell() {
  const ICONS = {
    wordle: '/assets/wordle.png?v=2',
    battle: '/assets/sea_war.png?v=2',
    cinema: '/assets/cinema.png?v=2',
    mono: '/assets/monopoly.png?v=2',
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
    if (person?.avatar) return `<img draggable="false" src="${escapeHtml(person.avatar)}" alt="">`;
    const mark = (person?.name || letter || '?').trim().slice(0, 1).toUpperCase() || '?';
    return `<span>${escapeHtml(mark)}</span>`;
  }

  function duoGame(id) {
    return id === 'wordle' || id === 'battle';
  }

  function slotHtml(slot, index, watch) {
    const label = watch ? tr('slot.watch', 'Слот для наблюдателя') : tr('slot.empty', 'Слот для игрока');
    if (slot.empty) {
      return `
        <button type="button" class="slot" data-hub="slot" data-slot="${index}">
          <span class="slot-plus" aria-hidden="true">+</span>
          <span>${escapeHtml(label)}</span>
        </button>`;
    }
    const star = slot.host ? '<img class="slot-star" draggable="false" src="/assets/host.png" alt="">' : '';
    const drag = last?.hub?.youHost ? 'draggable="true"' : '';
    return `
      <div class="slot" data-slot="${index}" ${drag}>
        <span class="slot-face">${face(slot, '•')}</span>
        <span class="slot-name">${escapeHtml(slot.name || slot.id || '—')}</span>
        ${star}
      </div>`;
  }

  function inviteSlot(watch) {
    return slotHtml({ empty: true }, 'invite', watch);
  }

  function slotsBlock(hub) {
    const filled = hub.slots.filter((slot) => !slot.empty);
    if (!duoGame(hub.game)) {
      return filled.map((slot, index) => slotHtml(slot, index, false)).join('') + inviteSlot(false);
    }
    const players = filled.slice(0, 2);
    const watchers = filled.slice(2);
    const playerRows = players.map((slot, index) => slotHtml(slot, index, false)).join('');
    if (players.length < 2) {
      return `
        <p class="slot-split">${escapeHtml(tr('hub.players', 'Игроки'))}</p>
        ${playerRows}
        ${inviteSlot(false)}`;
    }
    return `
      <p class="slot-split">${escapeHtml(tr('hub.players', 'Игроки'))}</p>
      ${playerRows}
      <p class="slot-split">${escapeHtml(tr('hub.watchers', 'Наблюдатели'))}</p>
      ${watchers.map((slot, index) => slotHtml(slot, index + 2, true)).join('')}
      ${inviteSlot(true)}`;
  }

  function opt(settings, key, value, label) {
    const on = String(settings[key]) === String(value) ? ' on' : '';
    if (!last?.hub?.youHost) return `<span class="mode-opt${on}">${escapeHtml(label)}</span>`;
    return `<button type="button" class="mode-opt${on}" data-hub="opt" data-key="${key}" data-value="${value}">${escapeHtml(label)}</button>`;
  }

  function modeHtml(hub) {
    const settings = hub.settings || {};
    const lock = hub.youHost ? '' : ' disabled';
    const actions = `
      <div class="mode-actions">
        <button type="button" class="act" data-hub="begin"${lock}>${escapeHtml(tr('hub.begin', 'Начать'))}</button>
        <button type="button" class="act" data-hub="back"${lock}>${escapeHtml(tr('hub.back', 'Вернуться'))}</button>
      </div>`;
    if (hub.game === 'cinema') {
      return `${actions}<p class="mode-note">${escapeHtml(tr('hub.cinema.note', 'Для кинотеатра отдельных настроек нет.'))}</p>`;
    }
    if (hub.game === 'battle' || hub.game === 'mono') {
      return `${actions}
        <div class="mode-field">
          <p>${escapeHtml(tr('hub.first', 'Первый ход'))}</p>
          <div class="mode-row">${opt(settings, 'firstTurn', 'host', tr('hub.host', 'Хост'))}${opt(settings, 'firstTurn', 'random', tr('hub.random', 'Случайно'))}</div>
        </div>`;
    }
    const length = settings.lengthMode === 'exact' || settings.lengthMode === 'max'
      ? `<label class="mode-num">${escapeHtml(tr('hub.letters', 'Букв'))} <input data-hub-num="length" type="number" min="3" max="16" value="${Number(settings.length) || 5}"${hub.youHost ? '' : ' disabled'}></label>`
      : '';
    const time = settings.timerOn
      ? `<div class="mode-time">
          <input data-hub-num="minutes" type="number" min="0" max="5" value="${Number(settings.minutes) || 0}"${hub.youHost ? '' : ' disabled'}>
          <span>:</span>
          <input data-hub-num="seconds" type="number" min="0" max="60" value="${Number(settings.seconds) || 0}"${hub.youHost ? '' : ' disabled'}>
        </div>`
      : '';
    return `${actions}
      <div class="mode-field">
        <p>${escapeHtml(tr('hub.letters.mode', 'Количество букв'))}</p>
        <div class="mode-row">${opt(settings, 'lengthMode', 'own', tr('hub.len.own', 'Свой'))}${opt(settings, 'lengthMode', 'exact', tr('hub.len.exact', 'Ручной'))}${opt(settings, 'lengthMode', 'max', tr('hub.len.max', 'Ручной-до'))}${opt(settings, 'lengthMode', 'first', tr('hub.len.first', 'Первейший'))}</div>
        ${length}
      </div>
      <div class="mode-field">
        <p>${escapeHtml(tr('hub.timer', 'Ограничение по времени'))}</p>
        <div class="mode-row">${opt(settings, 'timerOn', true, tr('hub.on', 'Вкл'))}${opt(settings, 'timerOn', false, tr('hub.off', 'Выкл'))}</div>
        ${time}
      </div>
      <div class="mode-field">
        <p>${escapeHtml(tr('hub.hidden', 'Скрытый режим'))}</p>
        <div class="mode-row">${opt(settings, 'hidden', true, tr('hub.on', 'Вкл'))}${opt(settings, 'hidden', false, tr('hub.off', 'Выкл'))}</div>
      </div>
      <div class="mode-field">
        <p>${escapeHtml(tr('hub.first', 'Первый ход'))}</p>
        <div class="mode-row">${opt(settings, 'firstTurn', 'host', tr('hub.host', 'Хост'))}${opt(settings, 'firstTurn', 'random', tr('hub.random', 'Случайно'))}</div>
      </div>`;
  }

  function cardHtml(id, hub) {
    const chosen = hub.game === id;
    return `
      <div class="pick-icon"><img src="${ICONS[id]}" alt=""></div>
      <h2>${escapeHtml(gameTitle(id))}</h2>
      <p>${escapeHtml(tr(`game.${id}.text`, ''))}</p>
      <button type="button" class="act" data-hub="choose" data-game="${id}"${last?.hub?.youHost ? '' : ' disabled'}>${escapeHtml(tr(chosen ? 'hub.chosen' : 'hub.choose', chosen ? 'Выбрано' : 'Выбрать'))}</button>`;
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
          <div class="hub-brand"><b>LEISURE</b><button type="button" class="hub-code" data-hub="copy-link">${escapeHtml(hub.code)}</button></div>
          <button type="button" class="hub-you" data-hub="profile">
            <div>
              <b>${escapeHtml(me.name || '—')}</b>
              <small>${escapeHtml(me.id || '')}</small>
            </div>
            <span class="hub-avatar">${face(me, me.id)}</span>
          </button>
        </header>
        <div class="hub-main">
          <div class="hub-slots hub-frame">
            ${slotsBlock(hub)}
          </div>
          ${hub.setup && hub.game ? `
            <div class="setup-wrap">
              ${hub.youHost ? '<button type="button" class="setup-x" data-hub="back" aria-label="Close">×</button>' : ''}
              <div class="hub-pick hub-frame is-setup"><div class="mode-setup">${modeHtml(hub)}</div></div>
            </div>` : `
          <div class="hub-pick hub-frame">
            <div class="pick-col">
              <button type="button" class="act" data-hub="page" data-dir="-1" aria-label="Previous"${hub.youHost ? '' : ' disabled'}>↑</button>
              <div class="pick-stage">
                ${motion ? `<article class="pick-card fly ${leaveClass}">${cardHtml(GAMES[motion.from], hub)}</article>` : ''}
                <article class="pick-card ${enterClass}">${cardHtml(game, hub)}</article>
              </div>
              <button type="button" class="act" data-hub="page" data-dir="1" aria-label="Next"${hub.youHost ? '' : ' disabled'}>↓</button>
            </div>
            <div class="gems">
              ${GAMES.map((id, index) => `
                <button type="button" class="gem-btn${index === page ? ' on' : ''}" data-hub="jump" data-index="${index}"${hub.youHost ? '' : ' disabled'}>
                  <i class="gem${index === page ? ' on' : ''}"></i>
                  <span>${escapeHtml(gameTitle(id))}</span>
                </button>`).join('')}
            </div>
          </div>`}
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
    if (!el) return;
    const act = el.dataset.hub;
    if (act === 'profile') {
      window.leisureProfile?.();
      return;
    }
    const socket = window.leisureSocket;
    if (!socket) return;
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
    if (!last?.hub?.youHost && ['page', 'jump', 'choose', 'back', 'begin', 'opt'].includes(act)) return;
    if (act === 'page') {
      if (motion) return;
      const dir = Number(el.dataset.dir) || 1;
      socket.emit('hub:page', { page: (page + dir + GAMES.length) % GAMES.length, slide: true });
      return;
    }
    if (act === 'jump') {
      const index = Number(el.dataset.index);
      if (!Number.isInteger(index) || index === page || index < 0 || index >= GAMES.length) return;
      socket.emit('hub:page', { page: index, slide: false });
      return;
    }
    if (act === 'choose') {
      last.hub = { ...last.hub, game: el.dataset.game, setup: true };
      socket.emit('hub:game', { game: el.dataset.game });
      paint();
      return;
    }
    if (act === 'back') {
      last.hub = { ...last.hub, setup: false };
      socket.emit('hub:back');
      paint();
      return;
    }
    if (act === 'begin') {
      socket.emit('hub:start');
      return;
    }
    if (act === 'opt') {
      if (!last?.hub?.youHost) return;
      let value = el.dataset.value;
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      socket.emit('hub:config', { settings: { ...(last.hub.settings || {}), [el.dataset.key]: value } });
      return;
    }
    if (act === 'send') {
      if (inviteUsed) return;
      socket.emit('hub:invite', { id: el.dataset.id });
      inviteUsed = true;
      paint();
      return;
    }
    if (act === 'copy-link') {
      const code = last?.hub?.code || '';
      if (code) window.leisureCopy?.( `${location.origin}/?room=${encodeURIComponent(code)}`, tr('hub.link', 'Ссылка скопирована'));
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

  document.addEventListener('change', (event) => {
    const input = event.target.closest('[data-hub-num]');
    const socket = window.leisureSocket;
    if (!input || !socket || !last?.hub?.youHost) return;
    socket.emit('hub:config', { settings: { ...(last.hub.settings || {}), [input.dataset.hubNum]: Number(input.value) } });
  });

  let dragFrom = null;
  let dragGhost = null;

  function clearDrag() {
    dragFrom = null;
    dragGhost?.remove();
    dragGhost = null;
    document.querySelectorAll('.slot.is-dragging, .slot.is-drop').forEach((node) => {
      node.classList.remove('is-dragging', 'is-drop');
    });
  }

  function placeGhost(event) {
    if (!dragGhost) return;
    dragGhost.style.left = `${event.clientX - dragGhost.offsetWidth / 2}px`;
    dragGhost.style.top = `${event.clientY - dragGhost.offsetHeight / 2}px`;
  }

  document.addEventListener('dragstart', (event) => {
    const slot = event.target.closest('[data-slot][draggable="true"]');
    if (!slot || !last?.hub?.youHost) return;
    dragFrom = slot.dataset.slot;
    event.dataTransfer.setData('text/plain', dragFrom);
    event.dataTransfer.effectAllowed = 'move';
    const blank = document.createElement('canvas');
    blank.width = 1;
    blank.height = 1;
    event.dataTransfer.setDragImage(blank, 0, 0);
    slot.classList.add('is-dragging');
    dragGhost = slot.cloneNode(true);
    dragGhost.classList.remove('is-dragging');
    dragGhost.classList.add('slot-ghost');
    dragGhost.style.width = `${slot.getBoundingClientRect().width}px`;
    document.body.appendChild(dragGhost);
    placeGhost(event);
  });

  document.addEventListener('dragover', (event) => {
    if (dragFrom == null || !last?.hub?.youHost) return;
    event.preventDefault();
    placeGhost(event);
    document.querySelectorAll('.slot.is-drop').forEach((node) => node.classList.remove('is-drop'));
    const slot = event.target.closest('[data-slot]');
    if (!slot || slot.dataset.slot === String(dragFrom) || slot.dataset.slot === 'invite') return;
    slot.classList.add('is-drop');
  });

  document.addEventListener('drop', (event) => {
    const slot = event.target.closest('[data-slot]');
    const socket = window.leisureSocket;
    const from = Number(dragFrom);
    if (!slot || !socket || !last?.hub?.youHost) {
      clearDrag();
      return;
    }
    event.preventDefault();
    const to = Number(slot.dataset.slot);
    clearDrag();
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
    socket.emit('hub:move', { from, to });
  });

  document.addEventListener('dragend', () => clearDrag());

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
      const nextPage = Number.isInteger(hub?.page) ? hub.page : 0;
      if (last?.hub?.code === hub?.code && nextPage !== page) {
        if (hub.slide) {
          const forward = (nextPage - page + GAMES.length) % GAMES.length;
          const back = (page - nextPage + GAMES.length) % GAMES.length;
          motion = { dir: forward <= back ? 1 : -1, from: page };
        } else motion = null;
      }
      page = nextPage;
      last = { root, hub, me, online };
      paint();
    },
  };
  bindSocket();
})();
