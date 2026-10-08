window.MonopolyUI = (() => {
  let tab = 'play';
  let focusId = '';
  let view = { scale: 1, x: 0, y: 0 };
  let seenDice = 0;
  let seenMove = 0;
  let primed = false;
  let clock = 0;
  let walkTimer = 0;
  let resizeBound = false;
  const shown = new Map();
  const queues = new Map();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function money(value) {
    return `${new Intl.NumberFormat('ru-RU').format(value || 0)} ₽`;
  }

  function nameOf(player) {
    return player?.name || 'Игрок';
  }

  function place(index) {
    if (index === 0) return [11, 11];
    if (index === 10) return [1, 11];
    if (index === 20) return [1, 1];
    if (index === 30) return [11, 1];
    if (index < 10) return [11 - index, 11];
    if (index < 20) return [1, 11 - (index - 10)];
    if (index < 30) return [1 + (index - 20), 1];
    return [11, 1 + (index - 30)];
  }

  function side(index) {
    if (index === 20 || (index > 20 && index < 30)) return 'north';
    if (index === 10 || (index > 10 && index < 20)) return 'left';
    if (index === 30 || index > 30) return 'right';
    return 'bottom';
  }

  function you(state) {
    return state.players.find((player) => player.you) || null;
  }

  function turn(state) {
    return state.players.find((player) => player.id === state.turn) || null;
  }

  function mine(state) {
    return Boolean(you(state) && state.turn === you(state).id && !you(state).bankrupt);
  }

  function page(state) {
    noteMove(state);
    if (state.phase === 'lobby') return lobby(state);
    if (state.phase === 'done') return finished(state);
    return match(state);
  }

  function lobby(state) {
    const self = you(state);
    const seats = state.players.map((player) => `
      <div class="player${player.connected ? ' online' : ''}">
        <div class="person"><span class="mono-piece" style="background:${esc(player.color)}">${esc(player.token)}</span>
        <div><strong>${esc(nameOf(player))}</strong><span>${player.you ? 'это ты' : (player.connected ? 'в комнате' : 'отошёл')}</span></div></div>
      </div>`).join('');
    const ready = state.players.filter((player) => player.connected).length;
    return `
      <section class="lobby">
        <div class="code-block">
          <p class="hint">Код комнаты</p>
          <p class="code-value">${esc(state.code)}</p>
          <div class="code-actions">
            <button class="btn" type="button" data-act="copy-link">Скопировать ссылку</button>
            <button class="btn ghost" type="button" data-act="copy">Скопировать код</button>
          </div>
          <p class="note">За стол садятся от 2 до 6. Сейчас ${ready}.</p>
        </div>
        <div class="players">${seats}</div>
        ${piecePicker(state)}
        <section class="rules">
          <h3>Старт</h3>
          <div class="rule">
            <p>Первый ход</p>
            <div class="seg">
              <button type="button" class="${state.settings?.firstTurn !== 'random' ? 'on' : ''}" data-act="setting" data-key="firstTurn" data-value="host" ${self?.host ? '' : 'disabled'}>Хост</button>
              <button type="button" class="${state.settings?.firstTurn === 'random' ? 'on' : ''}" data-act="setting" data-key="firstTurn" data-value="random" ${self?.host ? '' : 'disabled'}>Случайно</button>
            </div>
          </div>
          <p class="note">У каждого 1 500 ₽. Дубль даёт ещё ход, третий дубль — тюрьма. Отказ от покупки открывает аукцион.</p>
        </section>
        <div class="lobby-actions">
          ${self?.host
            ? `<button class="btn" type="button" data-act="start" ${ready >= 2 ? '' : 'disabled'}>Начать партию</button>`
            : '<button class="btn" type="button" disabled>Ждём, пока хост начнёт</button>'}
          <button class="btn ghost" type="button" data-act="leave">Выйти</button>
        </div>
        ${chat(state)}
      </section>`;
  }

  function finished(state) {
    const winner = state.players.find((player) => player.id === state.winner);
    return `
      <section class="result-screen">
        <h2>${winner ? `${esc(nameOf(winner))} забирает банк` : 'Партия закончена'}</h2>
        <p class="note">${winner ? `Осталось ${money(winner.cash)}.` : ''}</p>
        <div class="lobby-actions">
          <button class="btn ghost" type="button" data-act="leave">Выйти</button>
        </div>
      </section>`;
  }

  function match(state) {
    if (!focusId || !state.players.some((player) => player.id === focusId)) focusId = you(state)?.id || state.players[0]?.id || '';
    return `
      <section class="mono">
        <aside class="mono-log">
          <h3>История</h3>
          <div class="mono-history">${history(state)}</div>
          ${chat(state)}
        </aside>
        <div class="mono-stage">
          <div class="mono-tools">
            <button type="button" data-act="mono-zoom" data-zoom="in">+</button>
            <button type="button" data-act="mono-zoom" data-zoom="out">−</button>
            <button type="button" data-act="mono-zoom" data-zoom="reset">Всё поле</button>
          </div>
          <div class="mono-zoom">${board(state)}</div>
        </div>
        <aside class="mono-side">
          ${peopleBlock(state)}
          ${assets(state, focusId)}
          ${actions(state)}
        </aside>
        <div class="mono-dock">
          ${rollButton(state)}
          <div class="mono-tabs">
            ${['play', 'assets', 'trade', 'history', 'chat'].map((item) => {
              const label = { play: 'Ход', assets: 'Активы', trade: 'Торговля', history: 'История', chat: 'Чат' }[item];
              return `<button type="button" class="${tab === item ? 'on' : ''}" data-act="mono-tab" data-tab="${item}">${label}</button>`;
            }).join('')}
          </div>
          <div class="mono-sheet">
            ${tab === 'assets' ? assets(state, you(state)?.id) : ''}
            ${tab === 'trade' ? tradeBox(state) : ''}
            ${tab === 'history' ? `<div class="mono-history">${history(state)}</div>` : ''}
            ${tab === 'chat' ? chat(state) : ''}
            ${tab === 'play' ? `${peopleBlock(state)}${actions(state)}` : ''}
          </div>
        </div>
      </section>`;
  }

  function board(state) {
    const cells = state.tiles.map((tile) => {
      const [column, row] = place(tile.i);
      const here = state.players.filter((player) => !player.bankrupt && cellOf(player) === tile.i);
      const owner = state.players.find((player) => player.id === tile.owner);
      const marks = tile.houses === 5
        ? '<i class="hotel">H</i>'
        : Array.from({ length: tile.houses }, () => '<i class="house"></i>').join('');
      return `
        <article class="cell ${side(tile.i)}${tile.mortgaged ? ' mortgaged' : ''}${here.length ? ' here' : ''}" data-i="${tile.i}" style="grid-column:${column};grid-row:${row}${owner ? `;box-shadow:inset 0 0 0 2px ${owner.color}` : ''}">
          ${tile.color ? `<b class="swatch" style="background:${esc(tile.color)}"></b>` : ''}
          <span>${esc(tile.name)}</span>
          ${tile.price && !tile.owner ? `<small>${tile.price}</small>` : ''}
          ${marks ? `<em class="builds">${marks}</em>` : ''}
          ${tile.mortgaged ? '<small>залог</small>' : ''}
        </article>`;
    }).join('');
    return `
      <div class="mono-board" data-dice="${state.diceId || 0}" style="transform: translate(${view.x}px, ${view.y}px) scale(${view.scale})">
        ${cells}
        <div class="mono-center">
          ${dice(state)}
          ${center(state)}
        </div>
        ${pieces(state)}
      </div>`;
  }

  function dice(state) {
    if (!state.dice) return '<div class="dice-row idle" aria-hidden="true"><span></span><span></span></div>';
    const faces = state.dice;
    return `<div class="dice-row">${faces.map((face) => `
      <div class="cube" data-face="${face}">
        ${[1, 2, 3, 4, 5, 6].map((n) => `<b class="f f${n}">${n}</b>`).join('')}
      </div>`).join('')}</div>`;
  }

  function center(state) {
    const pending = state.pending;
    if (pending?.kind === 'buy') {
      const tile = state.tiles[pending.tile];
      const can = mine(state);
      return `
        <div class="mono-pop">
          <strong>${esc(tile.name)}</strong>
          <p>Купить за ${money(tile.price)}?</p>
          <div class="mono-actions">
            <button class="btn" type="button" data-act="mono" data-op="buy" ${can ? '' : 'disabled'}>Купить</button>
            <button class="btn ghost" type="button" data-act="mono" data-op="decline" ${can ? '' : 'disabled'}>На аукцион</button>
          </div>
          <em data-until="${pending.until}"> </em>
        </div>`;
    }
    if (pending?.kind === 'auction') {
      const tile = state.tiles[pending.tile];
      const bidder = state.players.find((player) => player.id === pending.bidder);
      const next = Math.max(10, (pending.bid || 0) + 10);
      return `
        <div class="mono-pop">
          <strong>Аукцион: ${esc(tile.name)}</strong>
          <p>${bidder ? `${esc(nameOf(bidder))} ставит ${money(pending.bid)}` : 'Ставок пока нет'}</p>
          <div class="mono-actions">
            <input class="mono-bid num" type="number" min="${next}" step="10" value="${next}">
            <button class="btn" type="button" data-act="mono" data-op="bid">Поставить</button>
          </div>
          <em data-until="${pending.until}"> </em>
        </div>`;
    }
    if (pending?.kind === 'trade') return tradePop(state);
    if (pending?.kind === 'debt' && pending.from === you(state)?.id) {
      return `
        <div class="mono-pop">
          <strong>Нужно ${money(pending.amount)}</strong>
          <p>${esc(pending.reason || 'Долг')}. Заложи улицы или продай дома.</p>
          <div class="mono-actions">
            <button class="btn" type="button" data-act="mono" data-op="pay">Заплатить</button>
            <button class="btn ghost" type="button" data-act="mono" data-op="bankrupt">Сдаться</button>
          </div>
        </div>`;
    }
    if (state.card) {
      return `<div class="mono-pop card"><strong>${esc(state.card.title)}</strong><p>${esc(state.card.text)}</p></div>`;
    }
    const last = state.log.at(-1);
    return `<p class="mono-last">${esc(last?.text || 'Бросьте кубики')}</p>`;
  }

  function peopleBlock(state) {
    return `${players(state)}${piecePicker(state)}`;
  }

  function piecePicker(state) {
    const self = you(state);
    if (!self || self.bankrupt) return '';
    const options = state.tokens || ['🚗', '🐕', '🚢', '🎩', '👢', '🐈'];
    return `
      <div class="piece-pick">
        <span>Фишка</span>
        ${options.map((piece) => {
          const owner = state.players.find((player) => player.token === piece);
          const mine = self.token === piece;
          const taken = Boolean(owner && !mine);
          return `<button type="button" class="${mine ? 'on' : ''}" data-act="mono" data-op="piece" data-piece="${piece}" ${taken ? 'disabled' : ''} title="${taken ? esc(nameOf(owner)) : 'Выбрать фишку'}">${piece}</button>`;
        }).join('')}
      </div>`;
  }

  function cellOf(player) {
    return shown.has(player.id) ? shown.get(player.id) : player.pos;
  }

  function pieces(state) {
    return `<div class="pieces">${state.players.filter((player) => !player.bankrupt).map((player) => `
      <i class="piece" data-id="${esc(player.id)}" data-cell="${cellOf(player)}" style="background:${esc(player.color)}" title="${esc(nameOf(player))}">${esc(player.token)}</i>
    `).join('')}</div>`;
  }

  function noteMove(state) {
    state.players.forEach((player) => {
      if (!shown.has(player.id)) shown.set(player.id, player.pos);
    });
    if (!primed) {
      primed = true;
      seenMove = state.move?.id || 0;
      state.players.forEach((player) => shown.set(player.id, player.pos));
      return;
    }
    const move = state.move;
    if (!move || move.id === seenMove) return;
    seenMove = move.id;
    if (move.who && Array.isArray(move.path) && move.path.length) {
      shown.set(move.who, move.from);
      queues.set(move.who, move.path.slice());
      kick();
    } else if (move.who != null) {
      const player = state.players.find((item) => item.id === move.who);
      if (player) shown.set(player.id, player.pos);
    }
  }

  function kick() {
    if (walkTimer) return;
    walkTimer = setInterval(() => {
      let pending = false;
      queues.forEach((path, id) => {
        if (!path.length) return;
        shown.set(id, path.shift());
        if (path.length) pending = true;
      });
      placePieces();
      if (!pending) {
        clearInterval(walkTimer);
        walkTimer = 0;
      }
    }, 180);
  }

  function placePieces() {
    const board = document.querySelector('.mono-board');
    if (!board) return;
    const groups = new Map();
    board.querySelectorAll('.piece').forEach((el) => {
      const cell = shown.has(el.dataset.id) ? shown.get(el.dataset.id) : Number(el.dataset.cell);
      if (!groups.has(cell)) groups.set(cell, []);
      groups.get(cell).push(el);
    });
    board.querySelectorAll('.cell.here').forEach((el) => el.classList.remove('here'));
    groups.forEach((list, cell) => {
      const tile = board.querySelector(`.cell[data-i="${cell}"]`);
      if (!tile) return;
      tile.classList.add('here');
      list.forEach((el, index) => {
        const shift = (index - (list.length - 1) / 2) * 18;
        el.style.left = `${tile.offsetLeft + tile.offsetWidth / 2 + shift}px`;
        el.style.top = `${tile.offsetTop + tile.offsetHeight * 0.62}px`;
      });
    });
    requestAnimationFrame(() => {
      board.querySelectorAll('.piece:not([data-ready])').forEach((el) => { el.dataset.ready = '1'; });
    });
  }

  function players(state) {
    return `<div class="mono-people">${state.players.map((player) => `
      <button type="button" class="mono-person${player.id === state.turn ? ' turn' : ''}${player.bankrupt ? ' out' : ''}${player.id === focusId ? ' on' : ''}" data-act="mono-focus" data-id="${esc(player.id)}" style="--c:${esc(player.color)}">
        <span>${esc(player.token)}</span>
        <b>${esc(nameOf(player))}</b>
        <em>${money(player.cash)}</em>
        <small>${player.bankrupt ? 'выбыл' : player.inJail ? 'в тюрьме' : player.id === state.turn ? 'ходит' : player.connected ? 'ждёт' : 'отошёл'}</small>
      </button>`).join('')}</div>`;
  }

  function assets(state, id) {
    const owner = state.players.find((player) => player.id === id) || you(state);
    if (!owner) return '';
    const tiles = state.tiles.filter((tile) => tile.owner === owner.id);
    const groups = new Map();
    tiles.forEach((tile) => {
      const key = tile.group || tile.type;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tile);
    });
    const rows = [...groups.values()].map((list) => list.map((tile) => {
      const mineTurn = mine(state) && owner.you;
      const label = tile.houses === 5 ? 'отель' : tile.houses ? `${tile.houses} дом.` : (tile.mortgaged ? 'залог' : 'пусто');
      return `
        <li>
          <i style="background:${esc(tile.color || '#3a332c')}"></i>
          <span>${esc(tile.name)} <small>${label}</small></span>
          ${mineTurn ? `
            <button type="button" data-act="mono" data-op="build" data-tile="${tile.i}">Дом</button>
            <button type="button" data-act="mono" data-op="sell" data-tile="${tile.i}">Снять</button>
            <button type="button" data-act="mono" data-op="${tile.mortgaged ? 'redeem' : 'mortgage'}" data-tile="${tile.i}">${tile.mortgaged ? 'Выкуп' : 'Залог'}</button>` : ''}
        </li>`;
    }).join('')).join('');
    return `
      <section class="mono-assets">
        <h3>${esc(nameOf(owner))}: ${money(owner.cash)}</h3>
        <p class="note">Домов в банке ${state.housesLeft}, отелей ${state.hotelsLeft}. Карт выхода: ${owner.cards}.</p>
        <ul>${rows || '<li class="note">Имущества пока нет</li>'}</ul>
      </section>`;
  }

  function actions(state) {
    const self = you(state);
    const active = mine(state);
    const buttons = [];
    if (active && state.step === 'jail') {
      buttons.push('<button class="btn big" type="button" data-act="mono" data-op="roll">Бросить из тюрьмы</button>');
      buttons.push('<button class="btn ghost" type="button" data-act="mono" data-op="jailPay">Заплатить 50</button>');
      if (self.cards) buttons.push('<button class="btn ghost" type="button" data-act="mono" data-op="jailCard">Карта выхода</button>');
    } else if (active && state.step === 'roll') {
      buttons.push('<button class="btn big" type="button" data-act="mono" data-op="roll">Бросить кубики</button>');
    } else if (active && state.step === 'manage') {
      buttons.push('<button class="btn big" type="button" data-act="mono" data-op="end">Завершить ход</button>');
      if (state.doubles) buttons.push('<button class="btn" type="button" data-act="mono" data-op="roll">Ещё бросок</button>');
    } else if (!active) {
      const who = turn(state);
      buttons.push(`<p class="note">${who ? `Ходит ${esc(nameOf(who))}` : 'Ждём'}.</p>`);
    }
    if (active && state.step !== 'buy' && state.step !== 'auction' && state.step !== 'trade') {
      buttons.push('<button class="btn ghost" type="button" data-act="mono-tab" data-tab="trade">Торговля</button>');
    }
    buttons.push('<button class="btn ghost" type="button" data-act="leave">Выйти</button>');
    return `<div class="mono-actions">${buttons.join('')}</div>${state.pending?.kind === 'debt' ? '' : ''}`;
  }

  function rollButton(state) {
    if (!mine(state)) return '';
    if (state.step === 'roll' || state.step === 'jail') {
      return '<button class="btn big roll" type="button" data-act="mono" data-op="roll">Бросить кубики</button>';
    }
    if (state.step === 'manage') return '<button class="btn big roll" type="button" data-act="mono" data-op="end">Завершить ход</button>';
    return '';
  }

  function tradeBox(state) {
    const self = you(state);
    if (!self) return '';
    const others = state.players.filter((player) => !player.you && !player.bankrupt);
    const mineTiles = state.tiles.filter((tile) => tile.owner === self.id && tile.houses === 0);
    const their = (id) => state.tiles.filter((tile) => tile.owner === id && tile.houses === 0);
    return `
      <form class="mono-trade">
        <label>Кому
          <select class="trade-to">${others.map((player) => `<option value="${esc(player.id)}">${esc(nameOf(player))}</option>`).join('')}</select>
        </label>
        <label>Отдаю ₽ <input class="give-cash num" type="number" min="0" step="10" value="0"></label>
        <label>Прошу ₽ <input class="take-cash num" type="number" min="0" step="10" value="0"></label>
        <p>Мои клетки</p>
        ${mineTiles.map((tile) => `<label><input class="give-tile" type="checkbox" value="${tile.i}"> ${esc(tile.name)}</label>`).join('') || '<p class="note">Нечего отдать</p>'}
        <p>Его клетки</p>
        ${others.map((player) => their(player.id).map((tile) => `<label class="take-own" data-owner="${esc(player.id)}"><input class="take-tile" type="checkbox" value="${tile.i}"> ${esc(tile.name)}</label>`).join('')).join('')}
        ${self.cards ? '<label><input class="give-card" type="checkbox"> Карта выхода</label>' : ''}
        <label><input class="take-card" type="checkbox"> Его карта выхода</label>
        <button class="btn" type="button" data-act="mono-trade" ${mine(state) ? '' : 'disabled'}>Предложить</button>
        <p class="note">На ответ есть 45 секунд. Клетки с домами сначала нужно освободить.</p>
      </form>`;
  }

  function tradePop(state) {
    const pending = state.pending;
    const from = state.players.find((player) => player.id === pending.from);
    const to = state.players.find((player) => player.id === pending.to);
    const names = (indexes) => indexes.map((index) => state.tiles[index]?.name).filter(Boolean).join(', ') || '—';
    const self = you(state);
    const can = self && self.id === pending.to;
    return `
      <div class="mono-pop">
        <strong>Сделка</strong>
        <p>${esc(nameOf(from))} отдаёт ${money(pending.giveCash)} и ${esc(names(pending.giveTiles))}${pending.giveCard ? ', карту выхода' : ''}.</p>
        <p>Просит ${money(pending.takeCash)} и ${esc(names(pending.takeTiles))}${pending.takeCard ? ', карту выхода' : ''}.</p>
        <div class="mono-actions">
          <button class="btn" type="button" data-act="mono" data-op="tradeYes" ${can ? '' : 'disabled'}>Принять</button>
          <button class="btn ghost" type="button" data-act="mono" data-op="tradeNo">Отказать</button>
        </div>
        <em data-until="${pending.until}"> </em>
      </div>`;
  }

  function history(state) {
    return state.log.slice().reverse().map((line) => `<p>${esc(line.text)}</p>`).join('') || '<p class="note">Пока тихо</p>';
  }

  function chat(state) {
    const lines = (state.chat || []).map((msg) => {
      if (msg.system) return `<div class="msg system">${esc(msg.text)}</div>`;
      return `<div class="msg${msg.mine ? ' mine' : ''}"><b>${esc(msg.name || 'Игрок')}</b><span>${esc(msg.text)}</span></div>`;
    }).join('');
    return `
      <section class="chat-panel mono-chat">
        <div class="chat-log">${lines || '<div class="msg system">Сообщений пока нет</div>'}</div>
        <form class="chat-form" data-act="send-chat">
          <input class="chat-input" maxlength="400" placeholder="Сообщение" autocomplete="off">
          <button type="submit">Отправить</button>
        </form>
      </section>`;
  }

  function setTab(next) { tab = next || 'play'; }
  function focus(id) { focusId = id; }

  function mount() {
    clearInterval(clock);
    placePieces();
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', placePieces);
    }
    const boardEl = document.querySelector('.mono-board');
    if (boardEl) {
      const id = Number(boardEl.dataset.dice || 0);
      if (id && id !== seenDice) {
        seenDice = id;
        boardEl.querySelectorAll('.cube').forEach((cube) => {
          cube.classList.add('spin');
          setTimeout(() => cube.classList.remove('spin'), 720);
        });
      }
    }
    const zoom = document.querySelector('.mono-zoom');
    if (zoom && !zoom.dataset.bound) {
      zoom.dataset.bound = '1';
      zoom.addEventListener('wheel', (event) => {
        event.preventDefault();
        view.scale = Math.min(2.6, Math.max(0.7, view.scale + (event.deltaY < 0 ? 0.12 : -0.12)));
        applyView();
      }, { passive: false });
      let pinch = null;
      zoom.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button, input, a')) return;
        zoom.setPointerCapture(event.pointerId);
        pinch = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: view.x, oy: view.y };
      });
      zoom.addEventListener('pointermove', (event) => {
        if (!pinch || pinch.id !== event.pointerId) return;
        view.x = pinch.ox + event.clientX - pinch.x;
        view.y = pinch.oy + event.clientY - pinch.y;
        applyView();
      });
      zoom.addEventListener('pointerup', () => { pinch = null; });
    }
    const select = document.querySelector('.trade-to');
    if (select) {
      const syncTrade = () => {
        document.querySelectorAll('.take-own').forEach((row) => {
          row.hidden = row.dataset.owner !== select.value;
        });
      };
      select.addEventListener('change', syncTrade);
      syncTrade();
    }
    if (document.querySelector('[data-until]')) {
      const paint = () => {
        document.querySelectorAll('[data-until]').forEach((el) => {
          const left = Math.max(0, Math.ceil((Number(el.dataset.until) - Date.now()) / 1000));
          el.textContent = `${left} с`;
        });
      };
      paint();
      clock = setInterval(paint, 250);
    }
  }

  function applyView() {
    const boardEl = document.querySelector('.mono-board');
    if (boardEl) boardEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  }

  document.addEventListener('click', (event) => {
    const zoom = event.target.closest?.('[data-act="mono-zoom"]');
    if (!zoom) return;
    const kind = zoom.dataset.zoom;
    if (kind === 'reset') view = { scale: 1, x: 0, y: 0 };
    if (kind === 'in') view.scale = Math.min(2.6, view.scale + 0.2);
    if (kind === 'out') view.scale = Math.max(0.7, view.scale - 0.2);
    applyView();
  });

  return { page, mount, setTab, focus };
})();
