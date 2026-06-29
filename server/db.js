const { db } = require('./firebase');

const COMPETITIONS = ['stableford', 'par3', 'fantasy_golf'];

// Stable slug ids (not Firestore auto-ids) so re-seeding is idempotent.
const CATEGORY_DEFS = [
  { id: 'okey-trips', name: 'Okey Trips', sortOrder: 1 },
  { id: 'club-throwing-ability', name: 'Club Throwing Ability', sortOrder: 2 },
  { id: 'pisshead-rating', name: 'Pisshead Rating', sortOrder: 3 },
  { id: 'fantasy-golf-popularity', name: 'Fantasy Golf Popularity', sortOrder: 4 },
  { id: 'handicap', name: 'Handicap', sortOrder: 5, lowerIsBetter: true },
  { id: 'most-lovable', name: 'Most Lovable', sortOrder: 6 }
];

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function emptyCompetitionScores() {
  const scores = {};
  COMPETITIONS.forEach((c) => { scores[c] = 0; });
  return scores;
}

function randomStats() {
  const stats = {};
  CATEGORY_DEFS.forEach((cat) => {
    stats[cat.id] = cat.id === 'handicap' ? rand(0, 28) : rand(1, 100);
  });
  return stats;
}

async function ensureCategoriesSeeded() {
  const snap = await db.collection('categories').get();
  const existingIds = new Set(snap.docs.map((d) => d.id));
  const expectedIds = new Set(CATEGORY_DEFS.map((c) => c.id));
  const matches = existingIds.size === expectedIds.size && [...expectedIds].every((id) => existingIds.has(id));
  if (matches) return;

  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  CATEGORY_DEFS.forEach((cat) => {
    batch.set(db.collection('categories').doc(cat.id), {
      name: cat.name,
      sortOrder: cat.sortOrder,
      lowerIsBetter: !!cat.lowerIsBetter
    });
  });
  await batch.commit();

  // Categories changed shape - re-randomize every player's stats to match.
  const playersSnap = await db.collection('players').get();
  if (!playersSnap.empty) {
    const statsBatch = db.batch();
    playersSnap.docs.forEach((d) => {
      statsBatch.update(d.ref, { stats: randomStats() });
    });
    await statsBatch.commit();
  }
}

async function ensurePlayersSeeded() {
  const snap = await db.collection('players').limit(1).get();
  if (!snap.empty) return;

  const firstNames = ['Dave', 'Gaz', 'Pete', 'Steve', 'Col', 'Big Mike', 'Tony', 'Ronnie',
    'Wayne', 'Lee', 'Barry', 'Kev', 'Ian', 'Trevor', 'Nobby', 'Skip'];

  const batch = db.batch();
  firstNames.forEach((name) => {
    const ref = db.collection('players').doc();
    batch.set(ref, {
      name,
      photoUrl: null,
      excludeCompetitions: false,
      team: null,
      stats: randomStats(),
      competitionScores: emptyCompetitionScores()
    });
  });
  await batch.commit();
}

async function ensureRyderCupSeeded() {
  const ref = db.collection('meta').doc('ryderCup');
  const doc = await ref.get();
  if (!doc.exists) {
    await ref.set({ europe: 0, usa: 0 });
  }
}

let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureCategoriesSeeded();
      await ensurePlayersSeeded();
      await ensureRyderCupSeeded();
    })();
  }
  return readyPromise;
}

// ---------- Categories ----------

async function getCategories() {
  await ready();
  const snap = await db.collection('categories').orderBy('sortOrder').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Players ----------

function playerFromDoc(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name,
    photoUrl: data.photoUrl || null,
    excludeCompetitions: !!data.excludeCompetitions,
    team: data.team || null,
    stats: data.stats || {},
    competitionScores: data.competitionScores || emptyCompetitionScores()
  };
}

async function getPlayers() {
  await ready();
  const snap = await db.collection('players').orderBy('name').get();
  return snap.docs.map(playerFromDoc);
}

async function getPlayer(id) {
  await ready();
  const doc = await db.collection('players').doc(id).get();
  return doc.exists ? playerFromDoc(doc) : null;
}

function normalizeTeam(team) {
  return team === 'usa' || team === 'europe' ? team : null;
}

async function createPlayer({ name, photoUrl, team, stats }) {
  await ready();
  const ref = db.collection('players').doc();
  await ref.set({
    name,
    photoUrl: photoUrl || null,
    excludeCompetitions: false,
    team: normalizeTeam(team),
    stats: stats || randomStats(),
    competitionScores: emptyCompetitionScores()
  });
  return ref.id;
}

async function updatePlayer(id, { name, photoUrl, excludeCompetitions, team, stats }) {
  await ready();
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;
  if (excludeCompetitions !== undefined) updates.excludeCompetitions = !!excludeCompetitions;
  if (team !== undefined) updates.team = normalizeTeam(team);
  if (stats && typeof stats === 'object') {
    const existing = await db.collection('players').doc(id).get();
    updates.stats = { ...(existing.data()?.stats || {}), ...stats };
  }
  await db.collection('players').doc(id).update(updates);
}

async function deletePlayer(id) {
  await ready();
  await db.collection('players').doc(id).delete();
}

// ---------- Competitions ----------

async function updateCompetitionScores(competition, playerScores) {
  await ready();
  if (!COMPETITIONS.includes(competition)) return;
  const batch = db.batch();
  for (const [playerId, score] of Object.entries(playerScores || {})) {
    batch.update(db.collection('players').doc(playerId), {
      [`competitionScores.${competition}`]: Number(score) || 0
    });
  }
  await batch.commit();
}

async function getRyderCup() {
  await ready();
  const doc = await db.collection('meta').doc('ryderCup').get();
  const data = doc.data() || {};
  return { europe: data.europe || 0, usa: data.usa || 0 };
}

async function updateRyderCup({ europe, usa }) {
  await ready();
  const updates = {};
  if (europe !== undefined) updates.europe = Number(europe) || 0;
  if (usa !== undefined) updates.usa = Number(usa) || 0;
  await db.collection('meta').doc('ryderCup').set(updates, { merge: true });
}

module.exports = {
  COMPETITIONS,
  getCategories,
  getPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  deletePlayer,
  updateCompetitionScores,
  getRyderCup,
  updateRyderCup
};
