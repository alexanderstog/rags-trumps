const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const eio = require('engine.io');
const multer = require('multer');

const db = require('./db');
const { COMPETITIONS } = require('./db');
const { bucket } = require('./firebase');
const gameManager = require('./gameManager');

const COMPETITION_LABELS = {
  stableford: 'Stableford',
  par3: 'Par 3',
  fantasy_golf: 'Fantasy Golf'
};

const app = express();

// Detached Socket.IO server (not attached to an http.Server here) so this
// module works both as a normal long-running Node process (server/index.js
// attaches it to a real http.Server and listens) and as a Cloud Function
// (no http.Server available - requests are handled one at a time via
// engine.handleRequest below). `new Server(opts)` alone never creates
// `io.engine` (that only happens via attach()), so the engine.io server is
// built manually here and bound to socket.io. Polling-only avoids relying
// on a raw 'upgrade' event, which serverless platforms don't expose.
const io = new Server({ transports: ['polling'] });
const engine = new eio.Server({ transports: ['polling'] });
io.bind(engine);

// attach() normally serves the client bundle itself at this exact path;
// our manual /socket.io catch-all below only understands engine.io
// protocol requests, so the client script needs its own route first.
const socketIoClientPath = path.join(path.dirname(require.resolve('socket.io/package.json')), 'client-dist', 'socket.io.js');
app.get('/socket.io/socket.io.js', (req, res) => {
  res.sendFile(socketIoClientPath);
});

app.use('/socket.io', (req, res) => {
  // Cloud Functions' framework fully drains and buffers the request body
  // (into req.rawBody) before our handler ever runs, so the underlying
  // stream has already ended by the time engine.io tries to read POST
  // bodies via req.on('data'/'end'). Those events fired once already, with
  // no listeners attached, and are gone. Replay them from the buffered
  // copy so engine.io's polling transport sees the body it expects.
  if (req.method === 'POST' && req.rawBody) {
    process.nextTick(() => {
      req.emit('data', req.rawBody);
      req.emit('end');
    });
  }
  engine.handleRequest(req, res);
});

// Same Cloud Functions body-buffering issue as the /socket.io route above:
// multer/busboy reads multipart bodies as a stream, but the framework has
// already drained it into req.rawBody by the time our handler runs. Replay
// it before multer ever tries to read, so it sees the bytes it expects.
function replayRawBody(req, res, next) {
  if (req.rawBody) {
    process.nextTick(() => {
      req.emit('data', req.rawBody);
      req.emit('end');
    });
  }
  next();
}

const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE;
if (!ADMIN_PASSCODE) {
  console.warn('ADMIN_PASSCODE is not set - the admin page will reject all passcodes until it is configured.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}. Please upload an image.`));
  }
});

function handlePhotoUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large (25MB max).'
        : err.message || 'Upload failed.';
      return res.status(400).json({ error: message });
    }
    next();
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function requireAdmin(req, res, next) {
  if (req.get('x-admin-passcode') !== ADMIN_PASSCODE) {
    return res.status(401).json({ error: 'Incorrect passcode' });
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

// ---- Admin API: manage players/cards (passcode-protected, direct-URL page only) ----

app.post('/api/admin/login', (req, res) => {
  if ((req.body || {}).passcode !== ADMIN_PASSCODE) {
    return res.status(401).json({ ok: false });
  }
  res.json({ ok: true });
});

app.get('/api/categories', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await db.getCategories());
}));

app.get('/api/players', requireAdmin, asyncRoute(async (req, res) => {
  const players = await db.getPlayers();
  res.json(players.map(p => ({
    id: p.id,
    name: p.name,
    photo_url: p.photoUrl,
    exclude_competitions: p.excludeCompetitions ? 1 : 0,
    team: p.team,
    stats: p.stats
  })));
}));

app.post('/api/players', requireAdmin, asyncRoute(async (req, res) => {
  const { name, photo_url, stats, team } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
  const id = await db.createPlayer({ name, photoUrl: photo_url, team, stats });
  res.json({ id });
}));

app.put('/api/players/:id', requireAdmin, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const { name, photo_url, stats, exclude_competitions, team } = req.body || {};
  const existing = await db.getPlayer(id);
  if (!existing) return res.status(404).json({ error: 'Player not found' });
  await db.updatePlayer(id, {
    name,
    photoUrl: photo_url,
    excludeCompetitions: exclude_competitions,
    team,
    stats
  });
  res.json({ ok: true });
}));

app.delete('/api/players/:id', requireAdmin, asyncRoute(async (req, res) => {
  await db.deletePlayer(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/players/:id/photo', requireAdmin, replayRawBody, handlePhotoUpload, asyncRoute(async (req, res) => {
  const id = req.params.id;
  const existing = await db.getPlayer(id);
  if (!existing) return res.status(404).json({ error: 'Player not found' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const ext = (req.file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
  const storagePath = `player-photos/${id}-${Date.now()}${ext}`;
  const file = bucket.file(storagePath);
  await file.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
  // Signed URLs need an IAM permission (iam.serviceAccounts.signBlob) the
  // default Cloud Functions service account doesn't have, so photos are
  // streamed through our own /api/photos route instead of a Storage URL.
  const photoUrl = `/api/photos/${encodeURIComponent(storagePath)}`;

  await db.updatePlayer(id, { photoUrl });
  res.json({ ok: true, photo_url: photoUrl });
}));

// ---- Public photo proxy (streams player photos out of Cloud Storage) ----

app.get('/api/photos/:storagePath', asyncRoute(async (req, res) => {
  const storagePath = decodeURIComponent(req.params.storagePath);
  console.log('[photo proxy] rawParam=%s decoded=%s bucket=%s', req.params.storagePath, storagePath, bucket.name);
  if (!storagePath.startsWith('player-photos/')) return res.status(400).end();
  const file = bucket.file(storagePath);
  try {
    const [exists] = await file.exists();
    console.log('[photo proxy] exists=%s', exists);
    if (!exists) return res.status(404).end();
  } catch (err) {
    console.error('[photo proxy] exists() threw:', err.code, err.message);
    throw err;
  }
  const [metadata] = await file.getMetadata();
  res.set('Content-Type', metadata.contentType || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  file.createReadStream().pipe(res);
}));

// ---- Admin: competition score management ----

app.get('/api/admin/competitions', requireAdmin, asyncRoute(async (req, res) => {
  const players = (await db.getPlayers()).filter(p => !p.excludeCompetitions);
  const ryderCup = await db.getRyderCup();

  res.json({
    competitions: COMPETITIONS,
    players: players.map(p => ({ id: p.id, name: p.name, team: p.team, scores: p.competitionScores })),
    ryderCup
  });
}));

app.put('/api/admin/competitions', requireAdmin, asyncRoute(async (req, res) => {
  const { scores, ryderCup } = req.body || {};
  if (scores && typeof scores === 'object') {
    for (const [competition, playerScores] of Object.entries(scores)) {
      await db.updateCompetitionScores(competition, playerScores);
    }
  }
  if (ryderCup && typeof ryderCup === 'object') {
    await db.updateRyderCup(ryderCup);
  }
  res.json({ ok: true });
}));

// ---- Public leaderboards (shown on the homepage) ----

app.get('/api/leaderboards', asyncRoute(async (req, res) => {
  const players = (await db.getPlayers()).filter(p => !p.excludeCompetitions);
  const leaderboards = {};
  COMPETITIONS.forEach((comp) => {
    const entries = players
      .map(p => ({ name: p.name, photoUrl: p.photoUrl, team: p.team, score: p.competitionScores[comp] || 0 }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    leaderboards[comp] = { label: COMPETITION_LABELS[comp] || comp, entries };
  });

  const ryderCup = await db.getRyderCup();
  res.json({ leaderboards, ryderCup });
}));

// ---- Public deck preview (so a player can browse all 16 cards before a game) ----

app.get('/api/deck', asyncRoute(async (req, res) => {
  res.json(await gameManager.deckPreview());
}));

// ---- Socket.IO realtime game layer ----

function broadcastState(game) {
  if (game.seats.host) {
    io.to(game.seats.host.socketId).emit('state', gameManager.publicState(game, 'host'));
  }
  if (game.seats.guest) {
    io.to(game.seats.guest.socketId).emit('state', gameManager.publicState(game, 'guest'));
  }
}

io.on('connection', (socket) => {
  socket.on('create-game', async ({ name, options } = {}, cb) => {
    try {
      const game = await gameManager.createGame(socket.id, name, options);
      cb?.({ ok: true, code: game.code });
      broadcastState(game);
    } catch (err) {
      cb?.({ ok: false, error: 'Could not create game.' });
    }
  });

  socket.on('join-game', ({ code, name } = {}, cb) => {
    const result = gameManager.joinGame((code || '').toUpperCase().trim(), socket.id, name);
    if (result.error) {
      cb?.({ ok: false, error: result.error });
      return;
    }
    cb?.({ ok: true, code: result.game.code });
    broadcastState(result.game);
  });

  socket.on('start-game', async (_, cb) => {
    const game = gameManager.getGameBySocket(socket.id);
    if (!game || game.seats.host.socketId !== socket.id) {
      cb?.({ ok: false, error: 'Only the host can start the game.' });
      return;
    }
    try {
      const result = await gameManager.startGame(game.code);
      if (result.error) {
        cb?.({ ok: false, error: result.error });
        return;
      }
      cb?.({ ok: true });
      broadcastState(result.game);
    } catch (err) {
      cb?.({ ok: false, error: 'Could not start game.' });
    }
  });

  socket.on('play-category', ({ categoryId } = {}, cb) => {
    const game = gameManager.getGameBySocket(socket.id);
    const seat = gameManager.getSeatBySocket(socket.id);
    if (!game || !seat) {
      cb?.({ ok: false, error: 'No active game.' });
      return;
    }
    const result = gameManager.playRound(game.code, seat, categoryId);
    if (result.error) {
      cb?.({ ok: false, error: result.error });
      return;
    }
    cb?.({ ok: true });
    broadcastState(result.game);
  });

  socket.on('rejoin-game', ({ code, seat, token } = {}, cb) => {
    const result = gameManager.rejoin((code || '').toUpperCase().trim(), seat, token, socket.id);
    if (result.error) {
      cb?.({ ok: false, error: result.error });
      return;
    }
    cb?.({ ok: true });
    broadcastState(result.game);
  });

  socket.on('quit-game', (_, cb) => {
    const game = gameManager.getGameBySocket(socket.id);
    const seat = gameManager.getSeatBySocket(socket.id);
    if (!game || !seat) {
      cb?.({ ok: false, error: 'No active game.' });
      return;
    }
    const result = gameManager.quitGame(game.code, seat);
    if (result.error) {
      cb?.({ ok: false, error: result.error });
      return;
    }
    cb?.({ ok: true });
    broadcastState(result.game);
  });

  socket.on('disconnect', () => {
    const game = gameManager.setConnected(socket.id, false);
    if (game) broadcastState(game);
    gameManager.removeSocket(socket.id);
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

module.exports = { app, io };
