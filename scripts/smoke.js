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
  const onlineSeen = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: online')), 4000);
    host.on('online', (list) => {
      if (list.length >= 2 && list.some((person) => person.you)) {
        clearTimeout(timer);
        resolve(list);
      }
    });
  });
  await Promise.all([
    new Promise((resolve) => host.on('connect', resolve)),
    new Promise((resolve) => guest.on('connect', resolve)),
    onlineSeen,
  ]);

  host.emit('create', { game: 'wordle' });
  const created = await host.when((s) => s.phase === 'lobby' && s.you === 'host', 'lobby');

  guest.emit('join', { code: created.code.toLowerCase() });
  const joined = await guest.when((s) => s.you === 'guest' && s.guest?.connected, 'join');
  assert(joined.code === created.code, 'same room');
  await host.when((s) => s.guest?.connected, 'host sees guest');

  guest.disconnect();
  await host.when((s) => s.guest && !s.guest.connected, 'guest offline');
  const stranger = connect('stranger-token');
  await new Promise((resolve) => stranger.on('connect', resolve));
  const denied = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 1500);
    stranger.on('errorMsg', (payload) => {
      clearTimeout(timer);
      resolve(typeof payload === 'string' ? payload : payload.text);
    });
    stranger.emit('join', { code: created.code });
  });
  assert(/два игрока/.test(denied), `seat kept: ${denied}`);
  stranger.close();
  const restored = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: restore')), 4000);
    guest.once('state', (next) => {
      clearTimeout(timer);
      resolve(next);
    });
  });
  guest.connect();
  const back = await restored;
  assert(back.you === 'guest' && back.guest.connected, 'guest restored');
  await host.when((s) => s.guest?.connected, 'host sees return');
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
  assert(playing.yourWord === 'море', 'host sees the word they set');
  const guestWord = await guest.when((s) => s.phase === 'play' && s.yourWord === 'stone', 'guest word');
  assert(guestWord.yourWord === 'stone' && guestWord.answers == null, 'guest sees only their own word');
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
  const again = await host.when((s) => s.phase === 'lobby' && s.boards.host.length === 0, 'rematch');
  assert(!again.winner && again.settings?.lengthMode === 'own', 'lobby keeps settings');
  await guest.when((s) => s.phase === 'lobby', 'guest lobby');

  const guestClosed = new Promise((resolve) => guest.once('closed', resolve));
  guest.emit('leave');
  const message = await guestClosed;
  assert(/вышел/i.test(message.message), 'guest left lobby');
  await host.when((s) => !s.guest, 'host sees empty seat');

  const cinemaHost = connect('cinema-host');
  const cinemaGuest = connect('cinema-guest');
  await Promise.all([
    new Promise((resolve) => cinemaHost.on('connect', resolve)),
    new Promise((resolve) => cinemaGuest.on('connect', resolve)),
  ]);
  cinemaHost.emit('create', { game: 'cinema' });
  const theatre = await cinemaHost.when((s) => s.game === 'cinema' && s.youHost, 'cinema');
  cinemaGuest.emit('join', { code: theatre.code });
  const watching = await cinemaGuest.when((s) => s.game === 'cinema' && !s.youHost && s.members.length === 2, 'cinema guest');
  assert(watching.phase === 'watch', 'no lobby');
  cinemaHost.emit('cinema:video', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const queued = await cinemaGuest.when((s) => s.video?.id === 'dQw4w9WgXcQ' && s.video.playing, 'video');
  assert(queued.video.at === 0, 'starts together');
  cinemaHost.emit('cinema:pause', { time: 0 });
  await cinemaGuest.when((s) => s.video && !s.video.playing, 'pause');
  cinemaHost.emit('cinema:seek', { time: 12.2 });
  const sought = await cinemaGuest.when((s) => s.video && s.video.at >= 12, 'seek');
  assert(sought.chat.some((msg) => /перемотал/.test(msg.text)), 'seek notice');
  cinemaGuest.emit('cinema:seek', { time: 30 });
  const deniedSeek = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 800);
    cinemaGuest.once('errorMsg', (payload) => {
      clearTimeout(timer);
      resolve(typeof payload === 'string' ? payload : payload.text);
    });
  });
  assert(/только хост/.test(deniedSeek), `guest seek blocked: ${deniedSeek}`);
  const guestId = theatreWaitId(watching);
  cinemaHost.emit('cinema:host', { id: guestId });
  const passed = await cinemaGuest.when((s) => s.youHost, 'host passed');
  assert(passed.members.some((member) => member.you && member.host), 'guest is host');
  cinemaGuest.emit('cinema:screen', { start: true });
  const sharing = await cinemaHost.when((s) => s.screen && !s.video.id, 'screen');
  assert(sharing.chat.some((msg) => /демонстрацию/.test(msg.text)), 'screen notice');
  cinemaGuest.emit('chat', { text: '<b>привет</b>' });
  const said = await cinemaHost.when((s) => s.chat.some((msg) => msg.text.includes('привет')), 'cinema chat');
  assert(said.chat.some((msg) => msg.text === '<b>привет</b>' && msg.at), 'chat keeps text and time');
  await new Promise((resolve) => setTimeout(resolve, 600));
  cinemaGuest.emit('chat', { text: 'ответ', reply: { name: 'Богдан', text: 'цитата' } });
  const replied = await cinemaHost.when((s) => s.chat.some((msg) => msg.reply && msg.reply.text === 'цитата' && msg.text === 'ответ'), 'reply');
  assert(replied.chat.some((msg) => msg.reply && msg.reply.name === 'Богдан'), 'reply name');
  cinemaGuest.emit('cinema:screen', { start: false });
  await cinemaHost.when((s) => !s.screen, 'screen stopped');
  cinemaGuest.emit('cinema:video', { url: 'https://www.twitch.tv/riotgames' });
  await cinemaHost.when((s) => s.video?.kind === 'twitch' && s.video.live && s.video.id === 'riotgames', 'twitch');
  cinemaGuest.emit('cinema:pause', { time: 4 });
  await new Promise((resolve) => setTimeout(resolve, 600));
  cinemaGuest.emit('chat', { text: 'после паузы' });
  const live = await cinemaHost.when((s) => s.chat.some((msg) => msg.text === 'после паузы'), 'after live pause');
  assert(live.video.playing && live.video.live, 'live pause ignored');
  cinemaGuest.emit('cinema:video', { url: 'https://www.twitch.tv/videos/1234567890' });
  await cinemaHost.when((s) => s.video?.kind === 'twitch' && !s.video.live && s.video.id === '1234567890', 'twitch vod');
  cinemaGuest.emit('cinema:video', { url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrSt/view' });
  await cinemaHost.when((s) => s.video?.service === 'drive' && s.video.kind === 'file' && s.video.id === '1AbCdEfGhIjKlMnOpQrSt', 'drive');
  cinemaGuest.emit('cinema:video', { url: 'https://www.dropbox.com/s/abc123def/clip.mp4?dl=0' });
  const drop = await cinemaHost.when((s) => s.video?.service === 'dropbox' && s.video.kind === 'file', 'dropbox');
  assert(drop.video.upstream == null, 'cloud url stays on the server');
  for (let i = 0; i < 9; i += 1) cinemaGuest.emit('chat', { text: `спам ${i}` });
  const limited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(''), 1000);
    const onError = (payload) => {
      const text = typeof payload === 'string' ? payload : payload.text;
      if (/много|Подожди/.test(text || '')) {
        clearTimeout(timer);
        cinemaGuest.off('errorMsg', onError);
        resolve(text);
      }
    };
    cinemaGuest.on('errorMsg', onError);
  });
  assert(/много|Подожди/.test(limited), `spam limited: ${limited}`);
  cinemaHost.close();
  cinemaGuest.close();

  console.log('smoke ok', created.code);

function theatreWaitId(snapshot) {
  return snapshot.members.find((member) => member.you).id;
}
  host.close();
  guest.close();
  stop(0);
}

main().catch((error) => {
  console.error(error);
  if (child) child.kill();
  process.exit(1);
});
