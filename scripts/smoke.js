const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');
const { markGuess } = require('../server');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(markGuess('книга', 'касса').join(',') === 'correct,absent,absent,absent,correct', 'marks книга/касса');
assert(markGuess('банан', 'набат').join(',') === 'present,correct,present,correct,absent', 'marks банан/набат');
assert(markGuess('кот', 'кот').join(',') === 'correct,correct,correct', 'exact');

const port = 3099;

function connect(token) {
  const socket = io(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'] });
  let latest = null;
  socket.on('state', (state) => {
    latest = state;
  });
  socket.when = (pred, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), 4000);
    const onState = (state) => {
      if (!pred(state)) return;
      clearTimeout(timer);
      socket.off('state', onState);
      resolve(state);
    };
    socket.on('state', onState);
    if (latest && pred(latest)) onState(latest);
  });
  return socket;
}

let child;
async function main() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
  });
  const stop = (code) => {
    child.kill();
    process.exit(code);
  };
  await new Promise((resolve) => setTimeout(resolve, 500));

  const host = connect('host-token');
  const guest = connect('guest-token');
  await Promise.all([
    new Promise((resolve) => host.on('connect', resolve)),
    new Promise((resolve) => guest.on('connect', resolve)),
  ]);

  host.emit('create', { game: 'wordle' });
  const created = await host.when((s) => s.phase === 'lobby' && s.you === 'host', 'lobby');

  guest.emit('join', { code: created.code.toLowerCase() });
  const joined = await guest.when((s) => s.you === 'guest' && s.guest?.connected, 'join');
  assert(joined.code === created.code, 'same room');
  await host.when((s) => s.guest?.connected, 'host sees guest');
  host.emit('settings', {
    lengthMode: 'exact', length: 4, timerOn: false, minutes: 0, seconds: 0, hidden: true, firstTurn: 'host',
  });
  const exact = await host.when((s) => s.settings?.lengthMode === 'exact' && s.settings.hidden, 'settings');
  assert(exact.settings.length === 4, 'exact length');
  host.emit('settings', {
    lengthMode: 'own', length: 5, timerOn: false, minutes: 1, seconds: 0, hidden: false, firstTurn: 'host',
  });
  await host.when((s) => s.settings?.lengthMode === 'own' && !s.settings.hidden, 'settings reset');
  host.emit('profile', { name: 'Богдан', avatar: '' });
  const named = await host.when((s) => s.host?.name === 'Богдан', 'profile');
  assert(named.host.avatar === '', 'avatar empty');

  host.emit('start');
  await host.when((s) => s.phase === 'setup', 'setup');

  host.emit('setWord', { word: 'Море' });
  guest.emit('setWord', { word: 'stone' });
  const playing = await host.when((s) => s.phase === 'play', 'play');
  assert(playing.lengths.host === 5 && playing.lengths.guest === 4, 'lengths');
  assert(playing.turn === 'host' && !playing.answers, 'hidden and host turn');
  host.emit('draft', { word: 'no' });
  const drafted = await guest.when((s) => s.drafts?.host === 'no', 'draft');
  assert(drafted.turn === 'host', 'draft during host turn');

  host.emit('guess', { word: 'стоун' });
  const bad = await new Promise((resolve) => host.once('errorMsg', resolve));
  assert(/5/.test(bad.text), 'wrong script rejected');

  host.emit('guess', { word: 'noise' });
  const afterWrong = await host.when((s) => s.turn === 'guest' && s.boards.host.length === 1, 'miss');
  assert(afterWrong.boards.host[0].marks.includes('present'), `partial marks ${afterWrong.boards.host[0].marks}`);

  guest.emit('chat', { text: 'привет <b>' });
  const chatted = await host.when((s) => s.chat.some((m) => m.text === 'привет <b>'), 'chat');
  assert(chatted.chat.find((m) => m.text === 'привет <b>').from === 'guest', 'chat author');

  guest.emit('guess', { word: 'море' });
  const won = await guest.when((s) => s.phase === 'done', 'win');
  assert(won.winner === 'guest', 'guest wins');
  assert(won.answers.guest === 'море' && won.answers.host === 'stone', 'reveal');

  host.emit('again');
  const again = await host.when((s) => s.phase === 'setup' && s.boards.host.length === 0, 'rematch');
  assert(!again.winner, 'winner cleared');

  const closed = new Promise((resolve) => host.once('closed', resolve));
  guest.emit('leave');
  const message = await closed;
  assert(/вышел/i.test(message.message), 'guest leave closes match');

  console.log('smoke ok', created.code);
  host.close();
  guest.close();
  stop(0);
}

main().catch((error) => {
  console.error(error);
  if (child) child.kill();
  process.exit(1);
});
