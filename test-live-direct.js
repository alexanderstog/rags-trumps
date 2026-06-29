const { io } = require('socket.io-client');
const URL = 'https://api-sn6vk3wmjq-uc.a.run.app';
const socket = io(URL, { transports: ['polling'] });
socket.on('connect', () => { console.log('CONNECTED', socket.id); process.exit(0); });
socket.on('connect_error', (e) => { console.log('ERROR:', e.message); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 8000);
