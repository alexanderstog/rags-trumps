const db = require('./db');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function genCode(existing) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (existing.has(code));
  return code;
}

function genToken() {
  return Array.from({ length: 16 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadDeck() {
  const players = await db.getPlayers();
  return players.map(p => ({
    playerId: p.id,
    name: p.name,
    photoUrl: p.photoUrl,
    team: p.team,
    stats: p.stats
  }));
}

class GameManager {
  constructor() {
    this.games = new Map(); // code -> game
    this.socketToGame = new Map(); // socketId -> code
  }

  async createGame(hostSocketId, hostName, options) {
    const code = genCode(this.games);
    const categories = await db.getCategories();
    const game = {
      code,
      createdAt: Date.now(),
      status: 'lobby', // lobby | playing | finished
      options: {
        deckMode: 'shared' // split-deck is the only supported mode
      },
      seats: {
        host: { socketId: hostSocketId, name: hostName || 'Host', connected: true, token: genToken() },
        guest: null
      },
      categories,
      hands: { host: [], guest: [] },
      pot: [],
      currentTurn: null,
      lastRound: null,
      winnerSeat: null
    };
    this.games.set(code, game);
    this.socketToGame.set(hostSocketId, code);
    return game;
  }

  joinGame(code, guestSocketId, guestName) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found. Check the code and try again.' };
    if (game.seats.guest) return { error: 'This game already has two players.' };
    if (game.seats.host.socketId === guestSocketId) return { error: "You can't join your own game." };
    game.seats.guest = { socketId: guestSocketId, name: guestName || 'Guest', connected: true, token: genToken() };
    this.socketToGame.set(guestSocketId, code);
    return { game };
  }

  rejoin(code, seat, token, newSocketId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found.' };
    const seatData = game.seats[seat];
    if (!seatData || seatData.token !== token) return { error: 'Could not reconnect to that game.' };
    seatData.socketId = newSocketId;
    seatData.connected = true;
    this.socketToGame.set(newSocketId, code);
    return { game, seat };
  }

  async startGame(code) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found.' };
    if (!game.seats.guest) return { error: 'Waiting for a second player to join.' };
    if (game.status !== 'lobby') return { error: 'Game already started.' };

    const fullDeck = await loadDeck();
    const shuffled = shuffle(fullDeck);
    const mid = Math.ceil(shuffled.length / 2);
    game.hands.host = shuffled.slice(0, mid);
    game.hands.guest = shuffled.slice(mid);

    game.status = 'playing';
    game.currentTurn = Math.random() < 0.5 ? 'host' : 'guest';
    game.pot = [];
    game.lastRound = null;
    game.winnerSeat = null;
    return { game };
  }

  getOpponentSeat(seat) {
    return seat === 'host' ? 'guest' : 'host';
  }

  quitGame(code, seat) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found.' };
    if (game.status === 'aborted' || game.status === 'finished') return { game };
    game.status = 'aborted';
    game.quitBy = seat;
    return { game };
  }

  async deckPreview() {
    const categories = await db.getCategories();
    return {
      categories: categories.map(c => ({ id: c.id, name: c.name, lowerIsBetter: !!c.lowerIsBetter })),
      players: await loadDeck()
    };
  }

  playRound(code, seat, categoryId) {
    const game = this.games.get(code);
    if (!game) return { error: 'Game not found.' };
    if (game.status !== 'playing') return { error: 'Game is not in progress.' };
    if (game.currentTurn !== seat) return { error: "It's not your turn." };

    const opponentSeat = this.getOpponentSeat(seat);
    const hand = game.hands[seat];
    const oppHand = game.hands[opponentSeat];
    if (!hand.length || !oppHand.length) return { error: 'No cards left to play.' };

    const myCard = hand[0];
    const oppCard = oppHand[0];
    const category = game.categories.find(c => c.id === categoryId);
    if (!category) return { error: 'Invalid category.' };

    const myVal = myCard.stats[categoryId];
    const oppVal = oppCard.stats[categoryId];

    let result; // 'host' | 'guest' | 'tie'
    const myWins = category.lowerIsBetter ? myVal < oppVal : myVal > oppVal;

    if (myVal === oppVal) result = 'tie';
    else result = myWins ? seat : opponentSeat;

    hand.shift();
    oppHand.shift();
    const cardsInPlay = [...game.pot, myCard, oppCard];

    if (result === 'tie') {
      game.pot = cardsInPlay;
      game.lastRound = {
        category: category.name,
        cards: { [seat]: myCard, [opponentSeat]: oppCard },
        result: 'tie',
        potSize: game.pot.length
      };
      // current player retains the turn to pick again next round
    } else {
      game.hands[result].push(...cardsInPlay);
      game.pot = [];
      game.lastRound = {
        category: category.name,
        cards: { [seat]: myCard, [opponentSeat]: oppCard },
        result,
        potSize: 0
      };
      game.currentTurn = result; // winner picks next category
    }

    if (game.hands.host.length === 0 || game.hands.guest.length === 0) {
      game.status = 'finished';
      game.winnerSeat = game.hands.host.length > game.hands.guest.length ? 'host' : 'guest';
    }

    return { game };
  }

  getGameByCode(code) {
    return this.games.get(code);
  }

  getGameBySocket(socketId) {
    const code = this.socketToGame.get(socketId);
    return code ? this.games.get(code) : null;
  }

  getSeatBySocket(socketId) {
    const game = this.getGameBySocket(socketId);
    if (!game) return null;
    if (game.seats.host?.socketId === socketId) return 'host';
    if (game.seats.guest?.socketId === socketId) return 'guest';
    return null;
  }

  setConnected(socketId, connected) {
    const game = this.getGameBySocket(socketId);
    const seat = this.getSeatBySocket(socketId);
    if (game && seat) game.seats[seat].connected = connected;
    return game;
  }

  removeSocket(socketId) {
    this.socketToGame.delete(socketId);
  }

  // Strip data the opponent shouldn't see (their own top card stats are hidden until played)
  publicState(game, forSeat) {
    const oppSeat = this.getOpponentSeat(forSeat);
    return {
      code: game.code,
      status: game.status,
      options: game.options,
      categories: game.categories.map(c => ({ id: c.id, name: c.name, lowerIsBetter: !!c.lowerIsBetter })),
      you: {
        seat: forSeat,
        name: game.seats[forSeat]?.name,
        token: game.seats[forSeat]?.token,
        cardCount: game.hands[forSeat].length,
        topCard: game.hands[forSeat][0] || null
      },
      opponent: {
        seat: oppSeat,
        name: game.seats[oppSeat]?.name,
        connected: !!game.seats[oppSeat]?.connected,
        cardCount: game.hands[oppSeat].length
      },
      currentTurn: game.currentTurn,
      potSize: game.pot.length,
      lastRound: game.lastRound,
      winnerSeat: game.winnerSeat,
      quitBy: game.quitBy || null,
      bothJoined: !!(game.seats.host && game.seats.guest)
    };
  }
}

module.exports = new GameManager();
