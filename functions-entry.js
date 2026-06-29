const { onRequest } = require('firebase-functions/v2/https');
const { app } = require('./server/app');

// maxInstances: 1 is required, not just an optimization - game state and
// Socket.IO sessions live in this process's memory, so any scale-out to a
// second instance would silently lose in-progress games and break polling
// transport (whose session id only exists on the instance that created it).
exports.api = onRequest({ region: 'us-central1', memory: '256MiB', maxInstances: 1, concurrency: 80 }, app);
