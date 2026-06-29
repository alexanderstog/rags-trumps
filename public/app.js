const socket = io();

const screens = {
  home: document.getElementById('screen-home'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  end: document.getElementById('screen-end'),
  deck: document.getElementById('screen-deck')
};

let lastNonDeckScreen = 'home';

function showScreen(name) {
  if (name !== 'deck') lastNonDeckScreen = name;
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

let myState = null; // last 'state' payload from server

// ---------- Session persistence (for reconnects) ----------

function saveSession({ code, seat, token }) {
  localStorage.setItem('ttg_session', JSON.stringify({ code, seat, token }));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('ttg_session') || 'null'); }
  catch { return null; }
}
function clearSession() {
  localStorage.removeItem('ttg_session');
}

// ---------- Header name ----------

const headerName = document.getElementById('headerName');
const nameEntry = document.getElementById('nameEntry');

function renderHeaderName() {
  const name = localStorage.getItem('ttg_name');
  if (name) {
    headerName.textContent = `👋 ${name}`;
    headerName.classList.remove('hidden');
    nameEntry.classList.add('hidden');
  } else {
    headerName.classList.add('hidden');
    nameEntry.classList.remove('hidden');
  }
}
renderHeaderName();

// ---------- Home screen ----------

const nameInput = document.getElementById('nameInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const joinCodeInput = document.getElementById('joinCodeInput');
const homeError = document.getElementById('homeError');

nameInput.value = localStorage.getItem('ttg_name') || '';

const params = new URLSearchParams(location.search);
const prefillJoin = params.get('join');
if (prefillJoin) joinCodeInput.value = prefillJoin.toUpperCase();

function persistName(name) {
  localStorage.setItem('ttg_name', name);
  nameInput.value = name;
  renderHeaderName();
}

// ---------- Edit name modal ----------

const editNameModal = document.getElementById('editNameModal');
const editNameInput = document.getElementById('editNameInput');

headerName.addEventListener('click', () => {
  editNameInput.value = localStorage.getItem('ttg_name') || '';
  editNameModal.classList.remove('hidden');
  editNameInput.focus();
});
document.getElementById('cancelNameBtn').addEventListener('click', () => editNameModal.classList.add('hidden'));
document.getElementById('saveNameBtn').addEventListener('click', () => {
  const name = editNameInput.value.trim();
  if (name) persistName(name);
  editNameModal.classList.add('hidden');
});
editNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('saveNameBtn').click();
});

// ---------- Play modal ----------

const playModal = document.getElementById('playModal');

document.getElementById('playTopTrumpsBtn').addEventListener('click', () => {
  homeError.textContent = '';
  playModal.classList.remove('hidden');
});
document.getElementById('closePlayModal').addEventListener('click', () => playModal.classList.add('hidden'));
playModal.addEventListener('click', (e) => {
  if (e.target === playModal) playModal.classList.add('hidden');
});

createBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Host';
  persistName(name);
  homeError.textContent = '';
  socket.emit('create-game', { name }, (res) => {
    if (!res.ok) { homeError.textContent = res.error || 'Could not create game.'; return; }
    playModal.classList.add('hidden');
  });
});

joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim() || 'Guest';
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!code) { homeError.textContent = 'Enter a game code.'; return; }
  persistName(name);
  homeError.textContent = '';
  socket.emit('join-game', { code, name }, (res) => {
    if (!res.ok) { homeError.textContent = res.error || 'Could not join game.'; return; }
    playModal.classList.add('hidden');
  });
});

// ---------- Lobby screen ----------

const lobbyCode = document.getElementById('lobbyCode');
const lobbyStatusMsg = document.getElementById('lobbyStatusMsg');
const startBtn = document.getElementById('startBtn');
const slotHost = document.getElementById('slotHost');
const slotGuest = document.getElementById('slotGuest');
const fixedCta = document.getElementById('fixedCta');

startBtn.addEventListener('click', () => {
  socket.emit('start-game', null, (res) => {
    if (!res.ok) alert(res.error || 'Could not start game.');
  });
});

function renderLobby(state) {
  lobbyCode.textContent = state.code;
  const isHost = state.you.seat === 'host';
  startBtn.classList.toggle('hidden', !isHost);
  nextRoundBtn.classList.add('hidden');
  startBtn.disabled = !state.bothJoined;
  fixedCta.classList.toggle('hidden', !isHost);
  startBtn.textContent = state.bothJoined ? '▶️ Start Game' : 'Waiting for opponent...';

  if (isHost) {
    lobbyStatusMsg.textContent = state.bothJoined
      ? `${state.opponent.name} has joined — tap Start Game when you're ready!`
      : 'Share this code with your opponent so they can join.';
  } else {
    lobbyStatusMsg.textContent = `You're in! Waiting for ${state.opponent.name || 'the host'} to start the game...`;
  }

  slotHost.textContent = state.you.seat === 'host' ? `${state.you.name} (you)` : (state.opponent.name || 'Waiting...');
  slotGuest.textContent = state.you.seat === 'guest' ? `${state.you.name} (you)` : (state.bothJoined ? (state.opponent.name || 'Opponent') : 'Waiting for opponent...');
  slotHost.classList.add('filled');
  slotGuest.classList.toggle('filled', state.bothJoined);
}

// ---------- Game screen ----------

const myCount = document.getElementById('myCount');
const oppCount = document.getElementById('oppCount');
const oppName = document.getElementById('oppName');
const potIndicator = document.getElementById('potIndicator');
const potSizeEl = document.getElementById('potSize');
const turnIndicator = document.getElementById('turnIndicator');
const myCardEl = document.getElementById('myCard');
const myCardName = document.getElementById('myCardName');
const myCardStats = document.getElementById('myCardStats');
const myCardImg = document.getElementById('myCardImg');
const myCardFallback = document.getElementById('myCardFallback');
const oppCardEl = document.getElementById('oppCard');
const oppCardName = document.getElementById('oppCardName');
const oppCardStats = document.getElementById('oppCardStats');
const oppCardImg = document.getElementById('oppCardImg');
const oppCardFallback = document.getElementById('oppCardFallback');
const resultBanner = document.getElementById('resultBanner');
const nextRoundBtn = document.getElementById('nextRoundBtn');
const confettiLayer = document.getElementById('confettiLayer');

function statLabel(category) {
  return category.lowerIsBetter ? `${category.name} (lower wins)` : category.name;
}

function teamFlag(team) {
  if (team === 'usa') return '🇺🇸 ';
  if (team === 'europe') return '🇪🇺 ';
  return '';
}

function setCardPhoto(imgEl, fallbackEl, photoUrl) {
  if (photoUrl) {
    imgEl.src = photoUrl;
    imgEl.classList.remove('hidden');
    fallbackEl.classList.add('hidden');
  } else {
    imgEl.removeAttribute('src');
    imgEl.classList.add('hidden');
    fallbackEl.classList.remove('hidden');
  }
}

function renderGame(state) {
  myCount.textContent = state.you.cardCount;
  oppCount.textContent = state.opponent.cardCount;
  oppName.textContent = state.opponent.name || 'Opponent';

  const isMyTurn = state.currentTurn === state.you.seat;
  const showingResult = !!state.lastRound;

  potIndicator.classList.toggle('hidden', state.potSize === 0);
  potSizeEl.textContent = state.potSize;

  if (state.status === 'finished' || state.status === 'aborted') {
    renderEnd(state);
    return;
  }

  myCardEl.classList.remove('card-win', 'card-lose', 'card-tie');
  oppCardEl.classList.remove('card-win', 'card-lose', 'card-tie');
  startBtn.classList.add('hidden');

  if (showingResult) {
    turnIndicator.textContent = '';
    renderResult(state);
    fixedCta.classList.remove('hidden');
    nextRoundBtn.classList.remove('hidden');
  } else {
    turnIndicator.textContent = isMyTurn ? '🎯 Your turn — pick a category' : `⏳ Waiting for ${state.opponent.name || 'opponent'} to pick...`;
    oppCardEl.classList.add('hidden');
    resultBanner.classList.add('hidden');
    nextRoundBtn.classList.add('hidden');
    fixedCta.classList.add('hidden');
    renderMyCard(state, isMyTurn);
  }
}

function renderMyCard(state, clickable) {
  const card = state.you.topCard;
  if (!card) return;
  myCardName.textContent = teamFlag(card.team) + card.name;
  setCardPhoto(myCardImg, myCardFallback, card.photoUrl);
  myCardStats.innerHTML = '';
  state.categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = `stat-row ${clickable ? 'clickable' : 'disabled'}`;
    row.innerHTML = `<span>${statLabel(cat)}</span><span class="stat-value">${card.stats[cat.id]}</span>`;
    if (clickable) {
      row.addEventListener('click', () => {
        socket.emit('play-category', { categoryId: cat.id }, (res) => {
          if (!res.ok) alert(res.error || 'Could not play that category.');
        });
      });
    }
    myCardStats.appendChild(row);
  });
}

function spawnConfetti() {
  confettiLayer.classList.remove('hidden');
  confettiLayer.innerHTML = '';
  const colors = ['#ffd43b', '#51cf66', '#339af0', '#ff6b6b', '#cc5de8'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    piece.style.animationDuration = `${1.2 + Math.random() * 0.8}s`;
    confettiLayer.appendChild(piece);
  }
  setTimeout(() => confettiLayer.classList.add('hidden'), 2200);
}

function renderResult(state) {
  const round = state.lastRound;
  const mySeat = state.you.seat;
  const myCard = round.cards[mySeat];
  const oppCard = round.cards[state.opponent.seat];

  myCardName.textContent = teamFlag(myCard.team) + myCard.name;
  oppCardName.textContent = teamFlag(oppCard.team) + oppCard.name;
  setCardPhoto(myCardImg, myCardFallback, myCard.photoUrl);
  setCardPhoto(oppCardImg, oppCardFallback, oppCard.photoUrl);
  oppCardEl.classList.remove('hidden');

  const myWon = round.result === mySeat;
  const tie = round.result === 'tie';

  myCardStats.innerHTML = '';
  oppCardStats.innerHTML = '';

  state.categories.forEach(cat => {
    const isPlayed = cat.name === round.category;
    const myRow = document.createElement('div');
    const oppRow = document.createElement('div');
    myRow.className = 'stat-row disabled';
    oppRow.className = 'stat-row disabled';
    myRow.innerHTML = `<span>${statLabel(cat)}</span><span class="stat-value">${myCard.stats[cat.id]}</span>`;
    oppRow.innerHTML = `<span>${statLabel(cat)}</span><span class="stat-value">${oppCard.stats[cat.id]}</span>`;
    if (isPlayed) {
      if (tie) { myRow.classList.add('tie'); oppRow.classList.add('tie'); }
      else if (myWon) { myRow.classList.add('winner'); oppRow.classList.add('loser'); }
      else { myRow.classList.add('loser'); oppRow.classList.add('winner'); }
    }
    myCardStats.appendChild(myRow);
    oppCardStats.appendChild(oppRow);
  });

  resultBanner.classList.remove('hidden');
  resultBanner.classList.remove('win', 'lose', 'tie');

  if (tie) {
    resultBanner.textContent = `🤝 Tie on ${round.category}! Cards go in the pot — play again.`;
    resultBanner.classList.add('tie');
    myCardEl.classList.add('card-tie');
    oppCardEl.classList.add('card-tie');
  } else if (myWon) {
    resultBanner.textContent = `🏆 You won with ${round.category}! You take ${round.potSize || 2} card(s).`;
    resultBanner.classList.add('win');
    myCardEl.classList.add('card-win');
    oppCardEl.classList.add('card-lose');
    spawnConfetti();
  } else {
    resultBanner.textContent = `💀 ${state.opponent.name} won with ${round.category}.`;
    resultBanner.classList.add('lose');
    myCardEl.classList.add('card-lose');
    oppCardEl.classList.add('card-win');
  }

  nextRoundBtn.classList.remove('hidden');
}

nextRoundBtn.addEventListener('click', () => {
  // lastRound is cleared client-side; myState already reflects the post-round
  // server state (new top cards / turn), so we just re-render without it.
  myState.lastRound = null;
  myCardEl.classList.remove('card-win', 'card-lose', 'card-tie');
  oppCardEl.classList.remove('card-win', 'card-lose', 'card-tie');
  renderGame(myState);
});

// ---------- End screen ----------

function renderEnd(state) {
  showScreen('end');
  fixedCta.classList.add('hidden');

  if (state.status === 'aborted') {
    const youQuit = state.quitBy === state.you.seat;
    document.getElementById('endTitle').textContent = youQuit ? 'Game quit' : '🚪 Opponent left';
    document.getElementById('endSubtitle').textContent = youQuit
      ? 'You left the game.'
      : `${state.opponent.name} quit the game.`;
    return;
  }

  const won = state.winnerSeat === state.you.seat;
  document.getElementById('endTitle').textContent = won ? '🏆 You win the trip bragging rights!' : '😅 Better luck next round';
  document.getElementById('endSubtitle').textContent = won
    ? 'You collected the whole deck.'
    : `${state.opponent.name} collected the whole deck.`;
  if (won) spawnConfetti();
}

document.getElementById('playAgainBtn').addEventListener('click', () => {
  clearSession();
  location.href = '/';
});

// ---------- Socket state handling ----------

socket.on('connect', () => {
  const session = loadSession();
  if (session?.code && session?.seat && session?.token) {
    socket.emit('rejoin-game', session, (res) => {
      if (!res.ok) clearSession();
    });
  }
});

socket.on('state', (state) => {
  myState = state;

  if (state.you.token) {
    saveSession({ code: state.code, seat: state.you.seat, token: state.you.token });
  }
  if (state.you.name) {
    persistName(state.you.name);
  }

  if (state.status === 'lobby') {
    showScreen('lobby');
    renderLobby(state);
  } else if (state.status === 'playing') {
    showScreen('game');
    renderGame(state);
  } else if (state.status === 'finished' || state.status === 'aborted') {
    renderEnd(state);
  }
});

// ---------- Full Deck page ----------

const deckFullGrid = document.getElementById('deckFullGrid');

async function openDeckPage() {
  fixedCta.classList.add('hidden');
  playModal.classList.add('hidden');
  showScreen('deck');
  deckFullGrid.innerHTML = '<p class="hint">Loading deck...</p>';
  try {
    const res = await fetch('/api/deck');
    const data = await res.json();
    deckFullGrid.innerHTML = '';
    data.players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'tt-card';
      const photoHtml = p.photoUrl
        ? `<img class="tt-photo-img" src="${p.photoUrl}" alt="${p.name}" />`
        : '<span class="tt-photo-fallback">🏌️</span>';
      const statsHtml = data.categories.map(cat => `
        <div class="stat-row disabled"><span>${cat.name}${cat.lowerIsBetter ? ' (lower wins)' : ''}</span><span class="stat-value">${p.stats[cat.id]}</span></div>
      `).join('');
      card.innerHTML = `
        <span class="tt-logo">Okey<sup>26</sup></span>
        <div class="tt-photo-frame">${photoHtml}</div>
        <div class="tt-name-banner"><span>${teamFlag(p.team)}${p.name}</span></div>
        <div class="tt-stats">${statsHtml}</div>
      `;
      deckFullGrid.appendChild(card);
    });
  } catch {
    deckFullGrid.innerHTML = '<p class="error">Could not load the deck.</p>';
  }
}

document.getElementById('viewDeckHomeBtn').addEventListener('click', openDeckPage);
document.getElementById('viewDeckLobbyBtn').addEventListener('click', openDeckPage);
document.getElementById('deckBackBtn').addEventListener('click', () => {
  showScreen(lastNonDeckScreen);
  if (lastNonDeckScreen === 'lobby' && myState) renderLobby(myState);
  if (lastNonDeckScreen === 'game' && myState) renderGame(myState);
});

// ---------- Quit game ----------

const quitModal = document.getElementById('quitModal');

function openQuitModal() {
  quitModal.classList.remove('hidden');
}
document.getElementById('quitLobbyLink').addEventListener('click', openQuitModal);
document.getElementById('quitGameLink').addEventListener('click', openQuitModal);
document.getElementById('cancelQuitBtn').addEventListener('click', () => quitModal.classList.add('hidden'));
document.getElementById('confirmQuitBtn').addEventListener('click', () => {
  socket.emit('quit-game', null, () => {
    clearSession();
    quitModal.classList.add('hidden');
    location.href = '/';
  });
});

// ---------- Logo navigation ----------

document.getElementById('logoHome').addEventListener('click', () => {
  const midGame = myState && (myState.status === 'lobby' || myState.status === 'playing');
  if (midGame) {
    openQuitModal();
  } else {
    clearSession();
    playModal.classList.add('hidden');
    if (screens.home.classList.contains('hidden')) {
      location.href = '/';
    } else {
      showScreen('home');
    }
  }
});

// ---------- Leaderboard carousel ----------

const leaderboardCarousel = document.getElementById('leaderboardCarousel');

function rankSuffix(n) {
  if (n % 10 === 1 && n !== 11) return 'st';
  if (n % 10 === 2 && n !== 12) return 'nd';
  if (n % 10 === 3 && n !== 13) return 'rd';
  return 'th';
}

async function loadLeaderboards() {
  leaderboardCarousel.innerHTML = '<div class="leaderboard-card hint">Loading leaderboards...</div>';
  try {
    const res = await fetch('/api/leaderboards');
    const data = await res.json();
    leaderboardCarousel.innerHTML = '';

    Object.entries(data.leaderboards).forEach(([key, comp]) => {
      const card = document.createElement('div');
      card.className = 'leaderboard-card';
      const rows = comp.entries.map((e, i) => {
        const avatar = i < 3
          ? (e.photoUrl ? `<img class="lb-avatar" src="${e.photoUrl}" alt="${e.name}" />` : '<span class="lb-avatar lb-avatar-fallback">🏌️</span>')
          : '<span class="lb-avatar lb-avatar-empty"></span>';
        return `<div class="lb-row">${avatar}<span class="lb-rank">${i + 1}${rankSuffix(i + 1)}</span><span class="lb-name">${teamFlag(e.team)}${e.name}</span><span class="lb-score">${e.score}</span></div>`;
      }).join('');
      card.innerHTML = `<h4>${comp.label}</h4><div class="lb-rows">${rows || '<p class="hint">No scores yet.</p>'}</div>`;
      leaderboardCarousel.appendChild(card);
    });

    const ryderCard = document.createElement('div');
    ryderCard.className = 'leaderboard-card ryder-card';
    const europe = data.ryderCup.europe;
    const usa = data.ryderCup.usa;
    const total = europe + usa || 1;
    ryderCard.innerHTML = `
      <h4>🏆 Ryder Cup</h4>
      <div class="ryder-score-row">
        <div class="ryder-team"><span class="ryder-flag">🇪🇺</span><span class="ryder-points">${europe}</span><span>Europe</span></div>
        <div class="ryder-team"><span class="ryder-flag">🇺🇸</span><span class="ryder-points">${usa}</span><span>USA</span></div>
      </div>
      <div class="ryder-bar"><div class="ryder-bar-fill" style="width:${(europe / total) * 100}%"></div></div>
    `;
    leaderboardCarousel.appendChild(ryderCard);
  } catch {
    leaderboardCarousel.innerHTML = '<div class="leaderboard-card hint">Could not load leaderboards.</div>';
  }
}

loadLeaderboards();

// ---------- Initial screen ----------

if (!loadSession()) {
  showScreen('home');
}
