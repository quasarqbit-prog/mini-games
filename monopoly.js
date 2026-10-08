const crypto = require('crypto');

const GROUP = {
  brown: { color: '#8b5a3c', house: 50 },
  light: { color: '#7ec8e3', house: 50 },
  pink: { color: '#e07ab0', house: 100 },
  orange: { color: '#f0a04b', house: 100 },
  red: { color: '#d64545', house: 150 },
  yellow: { color: '#e2c15a', house: 150 },
  green: { color: '#3f8f5b', house: 200 },
  blue: { color: '#3a5fcd', house: 200 },
};

const BOARD = [
  { type: 'go', name: 'Старт' },
  { type: 'street', name: 'Житная', group: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250] },
  { type: 'chest', name: 'Казна' },
  { type: 'street', name: 'Нагатинская', group: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450] },
  { type: 'tax', name: 'Подоходный', tax: 200 },
  { type: 'rail', name: 'Рижская ж/д', price: 200 },
  { type: 'street', name: 'Варшавское', group: 'light', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { type: 'chance', name: 'Шанс' },
  { type: 'street', name: 'Огарёва', group: 'light', price: 100, rent: [6, 30, 90, 270, 400, 550] },
  { type: 'street', name: 'Парковая', group: 'light', price: 120, rent: [8, 40, 100, 300, 450, 600] },
  { type: 'jail', name: 'Тюрьма' },
  { type: 'street', name: 'Полянка', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { type: 'util', name: 'Электростанция', price: 150 },
  { type: 'street', name: 'Сретенка', group: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750] },
  { type: 'street', name: 'Ростовская', group: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900] },
  { type: 'rail', name: 'Курская ж/д', price: 200 },
  { type: 'street', name: 'Рязанский', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { type: 'chest', name: 'Казна' },
  { type: 'street', name: 'Вавилова', group: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950] },
  { type: 'street', name: 'Рублёвка', group: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000] },
  { type: 'park', name: 'Стоянка' },
  { type: 'street', name: 'Тверская', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { type: 'chance', name: 'Шанс' },
  { type: 'street', name: 'Пушкинская', group: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050] },
  { type: 'street', name: 'Маяковская', group: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100] },
  { type: 'rail', name: 'Казанская ж/д', price: 200 },
  { type: 'street', name: 'Грузинский', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { type: 'street', name: 'Смоленская', group: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150] },
  { type: 'util', name: 'Водопровод', price: 150 },
  { type: 'street', name: 'Цветной', group: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200] },
  { type: 'gotojail', name: 'В тюрьму' },
  { type: 'street', name: 'Гоголевский', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { type: 'street', name: 'Кутузовский', group: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275] },
  { type: 'chest', name: 'Казна' },
  { type: 'street', name: 'Бронная', group: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400] },
  { type: 'rail', name: 'Ленинградская', price: 200 },
  { type: 'chance', name: 'Шанс' },
  { type: 'street', name: 'Никитская', group: 'blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500] },
  { type: 'tax', name: 'Сверхналог', tax: 100 },
  { type: 'street', name: 'Арбат', group: 'blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000] },
];

const TOKENS = ['🚗', '🐕', '🚢', '🎩', '👢', '🐈'];
const COLORS = ['#e06a4a', '#3f8f5b', '#3a5fcd', '#f0a04b', '#e07ab0', '#7ec8e3'];
const START_CASH = 1500;
const MAX_PLAYERS = 6;

function tileName(index) {
  return BOARD[index]?.name || 'клетка';
}

function groupOf(group) {
  const list = [];
  BOARD.forEach((tile, index) => {
    if (tile.group === group) list.push(index);
  });
  return list;
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function emptyMono(code) {
  return {
    code,
    game: 'mono',
    phase: 'lobby',
    players: [],
    own: BOARD.map(() => ({ owner: '', houses: 0, mortgaged: false })),
    turn: 0,
    doubles: 0,
    step: 'roll',
    dice: null,
    diceId: 0,
    move: null,
    pending: null,
    card: null,
    log: [],
    housesLeft: 32,
    hotelsLeft: 12,
    rentBoost: 1,
    utilBoost: 0,
    chance: [],
    chest: [],
    settings: { firstTurn: 'host' },
    chat: [],
    chatSeq: 1,
    chatTimes: new Map(),
    winner: '',
  };
}

function refill(room, deck) {
  const cards = deck === 'chance' ? chanceCards() : chestCards();
  room[deck] = shuffle(cards);
}

function draw(room, deck) {
  if (!room[deck].length) refill(room, deck);
  return room[deck].pop();
}

function log(room, text) {
  room.log.push({ id: room.log.length + 1, text, at: Date.now() });
  if (room.log.length > 40) room.log.splice(0, room.log.length - 40);
}

function pname(player) {
  return player?.name || 'Игрок';
}

function current(room) {
  return room.players[room.turn] || null;
}

function alive(room) {
  return room.players.filter((player) => !player.bankrupt);
}

function findPlayer(room, id) {
  return room.players.find((player) => player.id === id) || null;
}

function owns(room, player, index) {
  return room.own[index]?.owner === player.id;
}

function countOwned(room, player, type) {
  return BOARD.filter((tile, index) => tile.type === type && room.own[index].owner === player.id && !room.own[index].mortgaged).length;
}

function fullGroup(room, player, group) {
  const tiles = groupOf(group);
  return tiles.length > 0 && tiles.every((index) => room.own[index].owner === player.id);
}

function groupClear(room, group) {
  return groupOf(group).every((index) => room.own[index].houses === 0);
}

function checkWinner(room) {
  const left = alive(room);
  if (room.phase === 'play' && left.length <= 1) {
    room.phase = 'done';
    room.winner = left[0]?.id || '';
    room.pending = null;
    room.step = 'done';
    if (left[0]) log(room, `${pname(left[0])} забирает банк.`);
  }
}

function nextTurn(room) {
  const total = room.players.length;
  if (!total) return;
  for (let step = 1; step <= total; step += 1) {
    const index = (room.turn + step) % total;
    const player = room.players[index];
    if (!player.bankrupt) {
      room.turn = index;
      room.doubles = 0;
      room.step = player.inJail ? 'jail' : 'roll';
      player.turnAt = Date.now();
      break;
    }
  }
  checkWinner(room);
}

function gain(room, player, amount, text) {
  player.cash += amount;
  if (text) log(room, text);
}

function charge(room, player, amount, creditorId, reason) {
  const creditor = creditorId ? findPlayer(room, creditorId) : null;
  if (player.cash >= amount) {
    player.cash -= amount;
    if (creditor) creditor.cash += amount;
    log(room, `${pname(player)} платит ${amount} — ${reason}.`);
    return true;
  }
  room.pending = {
    kind: 'debt',
    amount,
    paid: 0,
    from: player.id,
    to: creditorId || '',
    reason,
    until: player.connected ? 0 : Date.now() + 25000,
  };
  room.step = 'debt';
  log(room, `${pname(player)} должен ${amount} (${reason}), но денег не хватает.`);
  return false;
}

function forwardPath(from, to) {
  const path = [];
  let cursor = from;
  while (cursor !== to) {
    cursor = (cursor + 1) % 40;
    path.push(cursor);
    if (path.length > 40) break;
  }
  return path;
}

function backPath(from, steps) {
  const path = [];
  let cursor = from;
  for (let n = 0; n < steps; n += 1) {
    cursor = (cursor + 39) % 40;
    path.push(cursor);
  }
  return path;
}

function pushMove(room, player, from, path) {
  if (!path.length) return;
  if (room.move && room.move.who === player.id && room.move.stamp === room.diceId && room.diceId) {
    room.move.path.push(...path);
    room.move.to = path[path.length - 1];
    return;
  }
  room.move = {
    id: (room.move?.id || 0) + 1,
    stamp: room.diceId,
    who: player.id,
    from,
    to: path[path.length - 1],
    path,
  };
}

function sendJail(room, player, why) {
  const from = player.pos;
  player.pos = 10;
  player.inJail = true;
  player.jailTries = 0;
  room.doubles = 0;
  if (from !== 10) pushMove(room, player, from, [10]);
  log(room, `${pname(player)} отправляется в тюрьму${why ? `: ${why}` : ''}.`);
}

function passGo(room, player) {
  gain(room, player, 200, `${pname(player)} проходит Старт и получает 200.`);
}

function jump(room, player, index, collect) {
  const from = player.pos;
  if (collect && from !== index && (index < from || index === 0)) passGo(room, player);
  player.pos = index;
  pushMove(room, player, from, forwardPath(from, index));
  land(room, player);
}

function nearest(room, player, indexes, collect) {
  const ahead = indexes.map((index) => ({ index, dist: (index - player.pos + 40) % 40 || 40 }))
    .sort((a, b) => a.dist - b.dist)[0];
  jump(room, player, ahead.index, collect);
}

function land(room, player) {
  if (player.bankrupt || room.phase !== 'play') return;
  const tile = BOARD[player.pos];
  if (tile.type === 'go' || tile.type === 'jail' || tile.type === 'park') {
    if (tile.type === 'park') log(room, `${pname(player)} отдыхает на стоянке.`);
    if (tile.type === 'jail') log(room, `${pname(player)} просто в гостях у тюрьмы.`);
    room.rentBoost = 1;
    room.utilBoost = 0;
    return;
  }
  if (tile.type === 'gotojail') {
    sendJail(room, player, 'так выпала клетка');
    return;
  }
  if (tile.type === 'tax') {
    charge(room, player, tile.tax, '', tile.name);
    return;
  }
  if (tile.type === 'chance' || tile.type === 'chest') {
    const card = draw(room, tile.type);
    room.card = { title: tile.type === 'chance' ? 'Шанс' : 'Общественная казна', text: card.text };
    log(room, `${room.card.title}: ${card.text}`);
    card.run(room, player);
    return;
  }
  const own = room.own[player.pos];
  if (!own.owner) {
    room.pending = { kind: 'buy', tile: player.pos, until: Date.now() + 30000 };
    room.step = 'buy';
    log(room, `${tile.name} свободна. ${pname(player)} может купить за ${tile.price}.`);
    return;
  }
  if (own.owner === player.id || own.mortgaged) {
    if (own.owner === player.id) log(room, `${pname(player)} на своей клетке ${tile.name}.`);
    return;
  }
  const rent = rentOf(room, player.pos, (room.dice?.[0] || 0) + (room.dice?.[1] || 0));
  room.rentBoost = 1;
  room.utilBoost = 0;
  if (rent > 0) charge(room, player, rent, own.owner, `аренда «${tile.name}»`);
}

function clearBoost(room) {
  room.rentBoost = 1;
  room.utilBoost = 0;
}

function rentOf(room, index, diceSum) {
  const tile = BOARD[index];
  const own = room.own[index];
  if (!own.owner || own.mortgaged) return 0;
  const owner = findPlayer(room, own.owner);
  if (!owner) return 0;
  if (tile.type === 'street') {
    if (own.houses > 0) return tile.rent[own.houses];
    if (fullGroup(room, owner, tile.group) && groupOf(tile.group).every((item) => !room.own[item].mortgaged)) {
      return tile.rent[0] * 2;
    }
    return tile.rent[0];
  }
  if (tile.type === 'rail') {
    const count = countOwned(room, owner, 'rail');
    return 25 * (2 ** Math.max(0, count - 1)) * (room.rentBoost || 1);
  }
  if (tile.type === 'util') {
    const count = countOwned(room, owner, 'util');
    const mult = room.utilBoost || (count >= 2 ? 10 : 4);
    return mult * Math.max(1, diceSum || 0);
  }
  return 0;
}

function afterLand(room, player) {
  if (player.bankrupt) {
    checkWinner(room);
    if (room.phase === 'play') nextTurn(room);
    return;
  }
  if (room.pending) return;
  if (player.inJail) {
    nextTurn(room);
    return;
  }
  room.step = room.doubles ? 'roll' : 'manage';
  if (room.doubles) log(room, `Дубль. ${pname(player)} ходит ещё раз.`);
}

function rollDice() {
  return [1 + crypto.randomInt(6), 1 + crypto.randomInt(6)];
}

function doRoll(room, player) {
  if (room.phase !== 'play') return 'Игра ещё не началась';
  if (current(room)?.id !== player.id) return 'Сейчас не твой ход';
  if (room.pending) return 'Сначала закончи текущее действие';
  if (player.bankrupt) return 'Ты уже выбыл';
  if (room.step !== 'roll' && room.step !== 'jail') return 'Сейчас не бросок';
  const [a, b] = rollDice();
  const double = a === b;
  room.dice = [a, b];
  room.diceId += 1;
  room.card = null;
  if (player.inJail) {
    log(room, `${pname(player)} бросает ${a} и ${b}.`);
    if (double) {
      player.inJail = false;
      player.jailTries = 0;
      room.doubles = 0;
      walk(room, player, a + b, true);
      afterLand(room, player);
      return '';
    }
    player.jailTries += 1;
    if (player.jailTries >= 3) {
      if (player.cash < 50) {
        player.jailTries = 2;
        log(room, `${pname(player)} не может заплатить 50 и остаётся в тюрьме.`);
        nextTurn(room);
        return '';
      }
      player.cash -= 50;
      player.inJail = false;
      player.jailTries = 0;
      log(room, `${pname(player)} платит 50 после трёх попыток.`);
      walk(room, player, a + b, true);
      afterLand(room, player);
      return '';
    }
    log(room, `${pname(player)} остаётся в тюрьме.`);
    nextTurn(room);
    return '';
  }
  if (double) {
    room.doubles += 1;
    if (room.doubles >= 3) {
      log(room, `${pname(player)} бросает третий дубль: ${a} и ${b}.`);
      sendJail(room, player, 'три дубля подряд');
      nextTurn(room);
      return '';
    }
  } else room.doubles = 0;
  log(room, `${pname(player)} бросает ${a} и ${b}.`);
  walk(room, player, a + b, true);
  afterLand(room, player);
  return '';
}

function walk(room, player, steps, collect) {
  const from = player.pos;
  player.pos = (player.pos + steps) % 40;
  pushMove(room, player, from, forwardPath(from, player.pos));
  if (collect && player.pos < from) passGo(room, player);
  land(room, player);
}

function buy(room, player) {
  if (room.pending?.kind !== 'buy') return 'Сейчас нечего покупать';
  if (current(room)?.id !== player.id) return 'Покупает тот, кто ходит';
  const index = room.pending.tile;
  const tile = BOARD[index];
  if (player.cash < tile.price) return 'Не хватает денег';
  player.cash -= tile.price;
  room.own[index].owner = player.id;
  room.pending = null;
  log(room, `${pname(player)} покупает ${tile.name} за ${tile.price}.`);
  afterLand(room, player);
  return '';
}

function decline(room, player) {
  if (room.pending?.kind !== 'buy') return 'Сейчас нечего выставлять';
  if (current(room)?.id !== player.id) return 'Решает тот, кто ходит';
  const tile = room.pending.tile;
  room.pending = { kind: 'auction', tile, bid: 0, bidder: '', until: Date.now() + 20000 };
  room.step = 'auction';
  log(room, `${pname(player)} не берёт ${tileName(tile)}. Аукцион.`);
  return '';
}

function bid(room, player, amount) {
  if (room.pending?.kind !== 'auction') return 'Аукциона нет';
  if (player.bankrupt) return 'Ты выбыл';
  const next = Math.floor(Number(amount) || 0);
  const min = room.pending.bid + 10;
  if (next < Math.max(10, min)) return `Минимальная ставка ${Math.max(10, min)}`;
  if (player.cash < next) return 'Не хватает денег на ставку';
  room.pending.bid = next;
  room.pending.bidder = player.id;
  room.pending.until = Date.now() + 15000;
  log(room, `${pname(player)} ставит ${next}.`);
  return '';
}

function finishAuction(room) {
  const pending = room.pending;
  if (!pending || pending.kind !== 'auction') return;
  const tile = BOARD[pending.tile];
  const winner = pending.bidder ? findPlayer(room, pending.bidder) : null;
  room.pending = null;
  if (winner && winner.cash >= pending.bid) {
    winner.cash -= pending.bid;
    room.own[pending.tile].owner = winner.id;
    log(room, `${pname(winner)} забирает ${tile.name} за ${pending.bid}.`);
  } else {
    log(room, `${tile.name} остаётся у банка.`);
  }
  const player = current(room);
  if (player) afterLand(room, player);
}

function canManage(room, player) {
  if (room.phase !== 'play') return 'Игра ещё не началась';
  if (current(room)?.id !== player.id) return 'Это можно в свой ход';
  if (player.bankrupt) return 'Ты выбыл';
  if (room.pending && room.pending.kind !== 'debt') return 'Сначала закончи текущее действие';
  if (room.pending?.kind === 'debt' && room.pending.from !== player.id) return 'Сейчас платит другой';
  return '';
}

function build(room, player, index) {
  const problem = canManage(room, player);
  if (problem) return problem;
  const tile = BOARD[index];
  const own = room.own[index];
  if (!tile?.group || own?.owner !== player.id) return 'Это не твоя улица';
  if (!fullGroup(room, player, tile.group)) return 'Сначала собери всю цветовую группу';
  if (groupOf(tile.group).some((item) => room.own[item].mortgaged)) return 'Сними залог с группы';
  const levels = groupOf(tile.group).map((item) => room.own[item].houses);
  const min = Math.min(...levels);
  if (own.houses !== min || own.houses >= 5) return 'Дома ставятся равномерно';
  const cost = GROUP[tile.group].house;
  if (player.cash < cost) return 'Не хватает денег';
  if (own.houses === 4) {
    if (room.hotelsLeft < 1) return 'В банке кончились отели';
    if (room.housesLeft + 4 > 32) room.housesLeft = 32;
    room.housesLeft = Math.min(32, room.housesLeft + 4);
    room.hotelsLeft -= 1;
  } else if (room.housesLeft < 1) return 'В банке кончились дома';
  else room.housesLeft -= 1;
  player.cash -= cost;
  own.houses += 1;
  log(room, `${pname(player)} ставит ${own.houses === 5 ? 'отель' : 'дом'} на ${tile.name}.`);
  return '';
}

function sell(room, player, index) {
  const problem = canManage(room, player);
  if (problem) return problem;
  const tile = BOARD[index];
  const own = room.own[index];
  if (!tile?.group || own?.owner !== player.id || own.houses < 1) return 'Здесь нечего сносить';
  const levels = groupOf(tile.group).map((item) => room.own[item].houses);
  const max = Math.max(...levels);
  if (own.houses !== max) return 'Сначала сними дом с самой застроенной улицы';
  if (own.houses === 5) {
    if (room.housesLeft < 4) return 'В банке нет домов, чтобы разобрать отель';
    room.hotelsLeft += 1;
    room.housesLeft -= 4;
  } else room.housesLeft += 1;
  const cost = Math.floor(GROUP[tile.group].house / 2);
  player.cash += cost;
  own.houses -= 1;
  log(room, `${pname(player)} продаёт постройку на ${tile.name} за ${cost}.`);
  return '';
}

function mortgage(room, player, index) {
  const problem = canManage(room, player);
  if (problem) return problem;
  const tile = BOARD[index];
  const own = room.own[index];
  if (!tile?.price || own?.owner !== player.id) return 'Это нельзя заложить';
  if (own.mortgaged) return 'Уже в залоге';
  if (tile.group && !groupClear(room, tile.group)) return 'Сначала продай дома на этой группе';
  own.mortgaged = true;
  const sum = Math.floor(tile.price / 2);
  player.cash += sum;
  log(room, `${pname(player)} закладывает ${tile.name} и получает ${sum}.`);
  return '';
}

function redeem(room, player, index) {
  const problem = canManage(room, player);
  if (problem) return problem;
  const tile = BOARD[index];
  const own = room.own[index];
  if (own?.owner !== player.id || !own.mortgaged) return 'Это не в залоге';
  const sum = Math.floor(tile.price / 2 * 1.1);
  if (player.cash < sum) return 'Не хватает денег на выкуп';
  player.cash -= sum;
  own.mortgaged = false;
  log(room, `${pname(player)} выкупает ${tile.name} за ${sum}.`);
  return '';
}

function parseTiles(raw, ownerId, room) {
  const list = String(raw || '').split(/[^\d]+/).filter(Boolean).map(Number);
  const unique = [...new Set(list)];
  for (const index of unique) {
    if (!BOARD[index]?.price || room.own[index].owner !== ownerId) return null;
    const { group } = BOARD[index];
    if (group && !groupClear(room, group)) return null;
  }
  return unique;
}

function offer(room, player, payload) {
  const problem = canManage(room, player);
  if (problem || room.pending) return problem || 'Сначала закончи текущее действие';
  if (room.step !== 'roll' && room.step !== 'manage' && room.step !== 'jail') return 'Сейчас нельзя торговать';
  const other = findPlayer(room, payload.to);
  if (!other || other.id === player.id || other.bankrupt) return 'Выбери игрока';
  const giveCash = Math.max(0, Math.floor(Number(payload.giveCash) || 0));
  const takeCash = Math.max(0, Math.floor(Number(payload.takeCash) || 0));
  const giveTiles = parseTiles(payload.giveTiles, player.id, room);
  const takeTiles = parseTiles(payload.takeTiles, other.id, room);
  const giveCard = payload.giveCard === '1' || payload.giveCard === 1;
  const takeCard = payload.takeCard === '1' || payload.takeCard === 1;
  if (!giveTiles || !takeTiles) return 'Так имущество отдать нельзя';
  if (giveCash > player.cash || takeCash > other.cash) return 'В предложении больше денег, чем есть';
  if (giveCard && player.cards < 1) return 'Нет карты выхода';
  if (takeCard && other.cards < 1) return 'У него нет карты выхода';
  if (!giveCash && !takeCash && !giveTiles.length && !takeTiles.length && !giveCard && !takeCard) {
    return 'Пустое предложение';
  }
  room.pending = {
    kind: 'trade',
    from: player.id,
    to: other.id,
    giveCash,
    takeCash,
    giveTiles,
    takeTiles,
    giveCard,
    takeCard,
    until: Date.now() + 45000,
  };
  room.step = 'trade';
  log(room, `${pname(player)} предлагает сделку ${pname(other)}.`);
  return '';
}

function answerTrade(room, player, yes) {
  const pending = room.pending;
  if (pending?.kind !== 'trade') return 'Сделки нет';
  if (player.id !== pending.to && player.id !== pending.from) return 'Это не твоя сделка';
  if (!yes || player.id === pending.from) {
    room.pending = null;
    room.step = current(room)?.inJail ? 'jail' : (room.doubles ? 'roll' : 'manage');
    if (current(room) && room.diceId === 0) room.step = current(room).inJail ? 'jail' : 'roll';
    log(room, 'Сделка отменена.');
    restoreStep(room);
    return '';
  }
  const from = findPlayer(room, pending.from);
  const to = findPlayer(room, pending.to);
  if (!from || !to || from.cash < pending.giveCash || to.cash < pending.takeCash) {
    room.pending = null;
    restoreStep(room);
    return 'Денег уже не хватает';
  }
  from.cash -= pending.giveCash;
  to.cash += pending.giveCash;
  to.cash -= pending.takeCash;
  from.cash += pending.takeCash;
  pending.giveTiles.forEach((index) => { room.own[index].owner = to.id; });
  pending.takeTiles.forEach((index) => { room.own[index].owner = from.id; });
  if (pending.giveCard) { from.cards -= 1; to.cards += 1; }
  if (pending.takeCard) { to.cards -= 1; from.cards += 1; }
  room.pending = null;
  log(room, `${pname(from)} и ${pname(to)} меняются.`);
  restoreStep(room);
  return '';
}

function restoreStep(room) {
  const player = current(room);
  if (!player) return;
  if (room.pending) return;
  if (player.inJail && !room.dice) room.step = 'jail';
  else if (!room.diceId || room.doubles) room.step = player.inJail ? 'jail' : 'roll';
  else room.step = player.inJail ? 'jail' : 'manage';
  if (room.step === 'roll' && room.dice && !room.doubles && !player.inJail) room.step = 'manage';
}

function settle(room, player) {
  const pending = room.pending;
  if (pending?.kind !== 'debt' || pending.from !== player.id) return 'Долга нет';
  if (player.cash < pending.amount) return 'Всё ещё не хватает. Заложи улицы или сдайся.';
  player.cash -= pending.amount;
  const creditor = pending.to ? findPlayer(room, pending.to) : null;
  if (creditor) creditor.cash += pending.amount;
  log(room, `${pname(player)} закрывает долг ${pending.amount}.`);
  room.pending = null;
  afterLand(room, player);
  return '';
}

function bankrupt(room, player, force) {
  const pending = room.pending;
  if (player.bankrupt) return '';
  if (!force && room.phase === 'play' && current(room)?.id !== player.id && pending?.from !== player.id) {
    return 'Сдаться можно в свой ход';
  }
  const creditor = pending?.kind === 'debt' && pending.to ? findPlayer(room, pending.to) : null;
  if (creditor && player.cash > 0) {
    creditor.cash += player.cash;
    player.cash = 0;
  } else player.cash = 0;
  room.own.forEach((own, index) => {
    if (own.owner !== player.id) return;
    if (own.houses === 5) room.hotelsLeft += 1;
    else room.housesLeft = Math.min(32, room.housesLeft + own.houses);
    own.houses = 0;
    if (creditor) {
      own.owner = creditor.id;
    } else {
      own.owner = '';
      own.mortgaged = false;
    }
  });
  if (creditor) creditor.cards += player.cards;
  player.cards = 0;
  player.bankrupt = true;
  player.inJail = false;
  room.pending = null;
  log(room, `${pname(player)} банкрот.`);
  if (current(room)?.id === player.id) nextTurn(room);
  else checkWinner(room);
  return '';
}

function endTurn(room, player) {
  if (room.phase !== 'play') return 'Игра не идёт';
  if (current(room)?.id !== player.id) return 'Сейчас не твой ход';
  if (room.pending) return 'Сначала закончи текущее действие';
  if (room.step === 'roll' || room.step === 'jail') return 'Сначала брось кубики';
  nextTurn(room);
  return '';
}

function leaveJail(room, player, how) {
  if (room.phase !== 'play' || current(room)?.id !== player.id) return 'Сейчас не твой ход';
  if (!player.inJail || room.step !== 'jail') return 'Ты не в тюрьме';
  if (room.pending) return 'Сначала закончи текущее действие';
  if (how === 'pay') {
    if (player.cash < 50) return 'Нужно 50 за выход';
    player.cash -= 50;
    player.inJail = false;
    player.jailTries = 0;
    room.step = 'roll';
    log(room, `${pname(player)} платит 50 и выходит.`);
    return '';
  }
  if (how === 'card') {
    if (player.cards < 1) return 'Нет карты «Выйти из тюрьмы»';
    player.cards -= 1;
    player.inJail = false;
    player.jailTries = 0;
    room.step = 'roll';
    log(room, `${pname(player)} использует карту и выходит.`);
    return '';
  }
  return doRoll(room, player);
}

function act(room, player, payload = {}) {
  if (!player) return 'Ты не в этой партии';
  const op = payload.act;
  if (op === 'piece') return choosePiece(room, player, payload.piece);
  if (op === 'roll') return player.inJail && room.step === 'jail' ? leaveJail(room, player, 'roll') : doRoll(room, player);
  if (op === 'buy') return buy(room, player);
  if (op === 'decline') return decline(room, player);
  if (op === 'bid') return bid(room, player, payload.amount);
  if (op === 'build') return build(room, player, Number(payload.tile));
  if (op === 'sell') return sell(room, player, Number(payload.tile));
  if (op === 'mortgage') return mortgage(room, player, Number(payload.tile));
  if (op === 'redeem') return redeem(room, player, Number(payload.tile));
  if (op === 'trade') return offer(room, player, payload);
  if (op === 'tradeYes') return answerTrade(room, player, true);
  if (op === 'tradeNo') return answerTrade(room, player, false);
  if (op === 'pay') return settle(room, player);
  if (op === 'bankrupt') return bankrupt(room, player, payload.force);
  if (op === 'end') return endTurn(room, player);
  if (op === 'jailPay') return leaveJail(room, player, 'pay');
  if (op === 'jailCard') return leaveJail(room, player, 'card');
  return 'Неизвестное действие';
}

function tick(room, now) {
  if (room.game !== 'mono' || room.phase !== 'play' || !room.pending?.until) return false;
  if (now < room.pending.until) return false;
  if (room.pending.kind === 'auction') finishAuction(room);
  else if (room.pending.kind === 'trade') {
    room.pending = null;
    restoreStep(room);
    log(room, 'Время сделки вышло.');
  } else if (room.pending.kind === 'buy') decline(room, current(room));
  else if (room.pending.kind === 'debt') {
    const player = findPlayer(room, room.pending.from);
    if (player) bankrupt(room, player);
  }
  return true;
}

function choosePiece(room, player, piece) {
  if (room.phase === 'done') return 'Партия уже закончилась';
  if (!TOKENS.includes(piece)) return 'Такой фишки нет';
  if (room.players.some((other) => other.id !== player.id && other.piece === piece)) return 'Эту фишку уже взяли';
  player.piece = piece;
  return '';
}

function start(room) {
  const ready = room.players.filter((player) => player.connected && !player.bankrupt);
  if (ready.length < 2) return 'Нужны хотя бы два игрока';
  room.players = ready;
  room.players.forEach((player, index) => {
    player.cash = START_CASH;
    player.pos = 0;
    player.inJail = false;
    player.jailTries = 0;
    player.bankrupt = false;
    player.cards = 0;
    player.color = COLORS[index % COLORS.length];
    player.host = index === 0;
  });
  room.own = BOARD.map(() => ({ owner: '', houses: 0, mortgaged: false }));
  room.housesLeft = 32;
  room.hotelsLeft = 12;
  room.phase = 'play';
  room.doubles = 0;
  room.dice = null;
  room.diceId = 0;
  room.pending = null;
  room.card = null;
  room.winner = '';
  room.log = [];
  refill(room, 'chance');
  refill(room, 'chest');
  const used = new Set();
  room.players.forEach((player, index) => {
    if (!TOKENS.includes(player.piece) || used.has(player.piece)) {
      player.piece = TOKENS.find((token) => !used.has(token)) || TOKENS[index % TOKENS.length];
    }
    used.add(player.piece);
  });
  room.turn = room.settings.firstTurn === 'random' ? crypto.randomInt(room.players.length) : 0;
  room.step = 'roll';
  room.players[room.turn].turnAt = Date.now();
  log(room, `Партия началась. Первым ходит ${pname(room.players[room.turn])}.`);
  return '';
}

function view(room, token) {
  const you = room.players.find((player) => player.token === token);
  const pending = room.pending ? {
    kind: room.pending.kind,
    tile: room.pending.tile ?? null,
    bid: room.pending.bid || 0,
    bidder: room.pending.bidder || '',
    until: room.pending.until || 0,
    amount: room.pending.amount || 0,
    from: room.pending.from || '',
    to: room.pending.to || '',
    reason: room.pending.reason || '',
    giveCash: room.pending.giveCash || 0,
    takeCash: room.pending.takeCash || 0,
    giveTiles: room.pending.giveTiles || [],
    takeTiles: room.pending.takeTiles || [],
    giveCard: Boolean(room.pending.giveCard),
    takeCard: Boolean(room.pending.takeCard),
  } : null;
  return {
    code: room.code,
    game: 'mono',
    phase: room.phase,
    you: you?.id || '',
    host: Boolean(you?.host),
    turn: current(room)?.id || '',
    step: room.step,
    dice: room.dice,
    diceId: room.diceId,
    move: room.move,
    doubles: room.doubles,
    pending,
    card: room.card,
    winner: room.winner,
    housesLeft: room.housesLeft,
    hotelsLeft: room.hotelsLeft,
    settings: room.settings,
    tokens: TOKENS,
    log: room.log.slice(-20),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name || '',
      avatar: player.avatar || '',
      cash: player.cash,
      pos: player.pos,
      inJail: player.inJail,
      jailTries: player.jailTries,
      bankrupt: player.bankrupt,
      connected: player.connected,
      host: player.host,
      token: player.piece,
      color: player.color,
      cards: player.cards,
      you: player.token === token,
    })),
    tiles: room.own.map((own, index) => {
      const tile = BOARD[index];
      return {
        i: index,
        name: tile.name,
        type: tile.type,
        group: tile.group || '',
        color: tile.group ? GROUP[tile.group].color : '',
        price: tile.price || 0,
        tax: tile.tax || 0,
        owner: own.owner,
        houses: own.houses,
        mortgaged: own.mortgaged,
        rent: rentOf(room, index, (room.dice?.[0] || 0) + (room.dice?.[1] || 0)),
      };
    }),
    chat: room.chat.map((msg) => ({
      ...msg,
      mine: Boolean(msg.token) && msg.token === token,
    })),
  };
}

function chanceCards() {
  return [
    { text: 'Пройдите на Старт и получите 200.', run: (room, player) => jump(room, player, 0, true) },
    { text: 'Отправляйтесь на Арбат.', run: (room, player) => jump(room, player, 39, true) },
    { text: 'Отправляйтесь на Маяковскую.', run: (room, player) => jump(room, player, 24, true) },
    { text: 'Отправляйтесь на Полянку.', run: (room, player) => jump(room, player, 11, true) },
    { text: 'Идите на ближайшую железную дорогу. Если она занята, аренда двойная.', run: (room, player) => { room.rentBoost = 2; nearest(room, player, [5, 15, 25, 35], true); } },
    { text: 'Идите на ближайшую железную дорогу. Если она занята, аренда двойная.', run: (room, player) => { room.rentBoost = 2; nearest(room, player, [5, 15, 25, 35], true); } },
    { text: 'Идите на ближайшее предприятие. Если оно занято, платите 10-кратную ставку.', run: (room, player) => { room.utilBoost = 10; nearest(room, player, [12, 28], true); } },
    { text: 'Банк платит вам 50.', run: (room, player) => gain(room, player, 50, `${pname(player)} получает 50 от банка.`) },
    { text: 'Выйти из тюрьмы бесплатно. Карту можно оставить.', run: (room, player) => { player.cards += 1; log(room, `${pname(player)} получает карту выхода.`); } },
    { text: 'Вернитесь на 3 клетки назад.', run: (room, player) => {
      const from = player.pos;
      player.pos = (from + 37) % 40;
      pushMove(room, player, from, backPath(from, 3));
      land(room, player);
    } },
    { text: 'Отправляйтесь в тюрьму. Старт не проходите.', run: (room, player) => sendJail(room, player, 'карта') },
    { text: 'Ремонт: 25 за дом и 100 за отель.', run: (room, player) => { const cost = repair(room, player, 25, 100); if (cost) charge(room, player, cost, '', 'ремонт'); } },
    { text: 'Штраф 15.', run: (room, player) => charge(room, player, 15, '', 'штраф') },
    { text: 'Идите на Рижскую железную дорогу.', run: (room, player) => jump(room, player, 5, true) },
    { text: 'Вас выбрали председателем. Заплатите каждому игроку по 50.', run: (room, player) => payEach(room, player, 50) },
    { text: 'Ссуда принесла 150.', run: (room, player) => gain(room, player, 150, `${pname(player)} получает 150.`) },
  ];
}

function chestCards() {
  return [
    { text: 'Пройдите на Старт и получите 200.', run: (room, player) => jump(room, player, 0, true) },
    { text: 'Ошибка банка в вашу пользу. Получите 200.', run: (room, player) => gain(room, player, 200, `${pname(player)} получает 200.`) },
    { text: 'Врач. Заплатите 50.', run: (room, player) => charge(room, player, 50, '', 'врач') },
    { text: 'Продажа акций. Получите 50.', run: (room, player) => gain(room, player, 50, `${pname(player)} получает 50.`) },
    { text: 'Выйти из тюрьмы бесплатно.', run: (room, player) => { player.cards += 1; log(room, `${pname(player)} получает карту выхода.`); } },
    { text: 'Отправляйтесь в тюрьму.', run: (room, player) => sendJail(room, player, 'казна') },
    { text: 'Возврат налога. Получите 20.', run: (room, player) => gain(room, player, 20, `${pname(player)} получает 20.`) },
    { text: 'День рождения. Каждый игрок платит вам 10.', run: (room, player) => collectEach(room, player, 10) },
    { text: 'Страховка. Получите 100.', run: (room, player) => gain(room, player, 100, `${pname(player)} получает 100.`) },
    { text: 'Больница. Заплатите 100.', run: (room, player) => charge(room, player, 100, '', 'больница') },
    { text: 'Школьный налог 150.', run: (room, player) => charge(room, player, 150, '', 'школа') },
    { text: 'Консультация. Получите 25.', run: (room, player) => gain(room, player, 25, `${pname(player)} получает 25.`) },
    { text: 'Ремонт улиц: 40 за дом и 115 за отель.', run: (room, player) => { const cost = repair(room, player, 40, 115); if (cost) charge(room, player, cost, '', 'ремонт улиц'); } },
    { text: 'Вы заняли второе место. Получите 10.', run: (room, player) => gain(room, player, 10, `${pname(player)} получает 10.`) },
    { text: 'Наследство. Получите 100.', run: (room, player) => gain(room, player, 100, `${pname(player)} получает 100.`) },
    { text: 'Отпуск. Получите 100.', run: (room, player) => gain(room, player, 100, `${pname(player)} получает 100.`) },
  ];
}

function repair(room, player, house, hotel) {
  return room.own.reduce((sum, own, index) => {
    if (own.owner !== player.id) return sum;
    if (own.houses === 5) return sum + hotel;
    return sum + own.houses * house;
  }, 0);
}

function payEach(room, player, amount) {
  const others = alive(room).filter((item) => item.id !== player.id);
  const total = amount * others.length;
  if (!charge(room, player, total, '', `по ${amount} каждому`)) return;
  others.forEach((item) => { item.cash += amount; });
}

function collectEach(room, player, amount) {
  alive(room).forEach((item) => {
    if (item.id === player.id) return;
    if (item.cash >= amount) {
      item.cash -= amount;
      player.cash += amount;
    }
  });
  log(room, `${pname(player)} собирает по ${amount} с каждого.`);
}

function addPlayer(room, token, socketId) {
  if (room.players.length >= MAX_PLAYERS) return 'В партии уже шесть игроков';
  const index = room.players.length;
  room.players.push({
    id: `p${index}${crypto.randomBytes(2).toString('hex')}`,
    token,
    socketId,
    name: '',
    avatar: '',
    connected: true,
    disconnectedAt: 0,
    host: index === 0,
    cash: START_CASH,
    pos: 0,
    inJail: false,
    jailTries: 0,
    bankrupt: false,
    cards: 0,
    color: COLORS[index % COLORS.length],
    piece: TOKENS[index % TOKENS.length],
  });
  return '';
}

module.exports = {
  BOARD,
  GROUP,
  MAX_PLAYERS,
  emptyMono,
  addPlayer,
  start,
  act,
  tick,
  view,
  pname,
};
