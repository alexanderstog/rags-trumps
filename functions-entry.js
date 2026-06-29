const { onRequest } = require('firebase-functions/v2/https');
const { app } = require('./server/app');

exports.api = onRequest({ region: 'us-central1', memory: '256MiB' }, app);
