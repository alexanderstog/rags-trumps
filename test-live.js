const { io } = require('socket.io-client');
const URL = 'https://boards-6e600.web.app';
const opts = { transports: ['polling'] };

const host = io(URL, opts);
const guest = io(URL, opts);
let code, hostState, guestState;

host.on('connect_error', (e) => console.log('HOST CONNECT ERROR:', e.message));
guest.on('connect_error', (e) => console.log('GUEST CONNECT ERROR:', e.message));
host.on('state', s => hostState = s);
guest.on('state', s => guestState = s);

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await wait(1500);
  console.log('host connected:', host.connected, 'guest connected:', guest.connected);
  host.emit('create-game', { name: 'Host' }, r => { console.log('create ack:', r); code = r?.code; });
  await wait(1500);
  guest.emit('join-game', { code, name: 'Guest' }, r => console.log('join ack:', r));
  await wait(1500);
  host.emit('start-game', null, r => console.log('start ack:', r));
  await wait(1500);
  console.log('host top card:', hostState?.you?.topCard?.name, hostState?.you?.topCard?.team);
  console.log('guest hand size:', guestState?.you?.cardCount);

  for (let i = 0; i < 40 && hostState?.status === 'playing'; i++) {
    const ts = hostState.currentTurn === 'host' ? hostState : guestState;
    const sock = hostState.currentTurn === 'host' ? host : guest;
    sock.emit('play-category', { categoryId: ts.categories[0].id }, (r) => { if (!r.ok) console.log('play err', r.error); });
    await wait(400);
  }
  console.log('FINAL', hostState?.status, hostState?.winnerSeat, hostState?.you?.cardCount, guestState?.you?.cardCount);
  process.exit(0);
}
main();
