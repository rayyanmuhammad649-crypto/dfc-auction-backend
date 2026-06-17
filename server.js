const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Path definitions
const STATE_FILE = path.join(__dirname, 'data', 'auction_state.json');
const PLAYERS_FILE = path.join(__dirname, 'data', 'players.json');

// Default Teams Config
const DEFAULT_TEAMS = [
  { id: 'team1', name: 'Dogar Warriors', budget: 100000, password: 'warriors100', roster: [] },
  { id: 'team2', name: 'Multan Sultans', budget: 100000, password: 'sultans100', roster: [] },
  { id: 'team3', name: 'DFC United', budget: 100000, password: 'united100', roster: [] },
  { id: 'team4', name: 'Royal Strikers', budget: 100000, password: 'strikers100', roster: [] },
  { id: 'team5', name: 'Super Kings', budget: 100000, password: 'kings100', roster: [] }
];

let state = {
  players: [],
  teams: JSON.parse(JSON.stringify(DEFAULT_TEAMS)), // deep clone
  currentPlayerId: null,
  currentBid: 0,
  currentBidder: null,
  auctionState: 'idle', // idle, bidding, sold, unsold
  isClearanceRound: false,
  bidHistory: []
};

// Initialize State
function initializeState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(data);
      console.log('Loaded existing auction state.');
    } catch (e) {
      console.error('Error parsing state file, starting fresh:', e);
      loadDefaultPlayers();
    }
  } else {
    loadDefaultPlayers();
  }
}

function loadDefaultPlayers() {
  if (fs.existsSync(PLAYERS_FILE)) {
    try {
      const data = fs.readFileSync(PLAYERS_FILE, 'utf8');
      state.players = JSON.parse(data);
      state.teams = JSON.parse(JSON.stringify(DEFAULT_TEAMS));
      state.currentPlayerId = null;
      state.currentBid = 0;
      state.currentBidder = null;
      state.auctionState = 'idle';
      state.isClearanceRound = false;
      state.bidHistory = [];
      saveState();
      console.log('Initialized players from template.');
    } catch (e) {
      console.error('Error reading players template:', e);
    }
  } else {
    console.error('No players.json template found!');
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}

// Serve public assets
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Auth check API
app.post('/api/login', (req, res) => {
  const { role, password } = req.body;
  if (role === 'coordinator') {
    if (password === 'admin123') {
      return res.json({ success: true, name: 'Coordinator' });
    }
  } else {
    const team = state.teams.find(t => t.id === role && t.password === password);
    if (team) {
      return res.json({ success: true, name: team.name });
    }
  }
  return res.status(401).json({ success: false, message: 'Invalid password!' });
});

// Reset API
app.post('/api/reset', (req, res) => {
  const { password } = req.body;
  if (password === 'admin123') {
    loadDefaultPlayers();
    io.emit('stateUpdate', state);
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: 'Unauthorized' });
});

// Websocket Events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current state to newly connected client
  socket.emit('stateUpdate', state);

  // Coordinator: Put player on block
  socket.on('setPlayerOnBlock', (playerId) => {
    const player = state.players.find(p => p.id === playerId);
    if (player && player.status === 'Unsold') {
      state.currentPlayerId = playerId;
      let base = player.basePrice;
      if (state.isClearanceRound) {
        base = Math.round(base * 0.5);
      }
      state.currentBid = base;
      state.currentBidder = null;
      state.auctionState = 'bidding';
      state.bidHistory = [{ bidderName: 'Base Price', amount: base }];
      saveState();
      io.emit('stateUpdate', state);
    }
  });

  // Team/Coordinator: Place a bid
  socket.on('placeBid', ({ teamId, amount }) => {
    if (state.auctionState !== 'bidding') return;
    
    const team = state.teams.find(t => t.id === teamId);
    if (!team) return;

    // Validate bid amount
    let basePrice = 0;
    const player = state.players.find(p => p.id === state.currentPlayerId);
    if (player) {
      basePrice = state.isClearanceRound ? Math.round(player.basePrice * 0.5) : player.basePrice;
    }

    if (amount <= state.currentBid && (state.currentBidder || amount < basePrice)) {
      return socket.emit('errorMsg', 'Bid must be higher than current bid!');
    }

    if (amount > team.budget) {
      return socket.emit('errorMsg', 'Insufficient DFC coins!');
    }

    state.currentBid = amount;
    state.currentBidder = teamId;
    state.bidHistory.push({ bidderName: team.name, amount: amount });
    saveState();
    io.emit('stateUpdate', state);
    io.emit('playAudio', 'bid');
  });

  // Coordinator: Sell player
  socket.on('sellPlayer', () => {
    if (state.auctionState !== 'bidding' || !state.currentBidder) return;

    const player = state.players.find(p => p.id === state.currentPlayerId);
    const team = state.teams.find(t => t.id === state.currentBidder);

    if (player && team) {
      player.status = 'Sold';
      player.soldTo = team.id;
      player.soldPrice = state.currentBid;

      team.budget -= state.currentBid;
      team.roster.push({
        id: player.id,
        name: player.name,
        category: player.category,
        image: player.image,
        price: state.currentBid
      });

      state.auctionState = 'sold';
      saveState();
      io.emit('stateUpdate', state);
      io.emit('playAudio', 'gavel');
    }
  });

  // Coordinator: Mark player unsold
  socket.on('markUnsold', () => {
    if (state.auctionState !== 'bidding') return;

    const player = state.players.find(p => p.id === state.currentPlayerId);
    if (player) {
      player.status = 'Unsold';
      state.auctionState = 'unsold';
      saveState();
      io.emit('stateUpdate', state);
      io.emit('playAudio', 'unsold');
    }
  });

  // Coordinator: Clear block (back to idle)
  socket.on('clearBlock', () => {
    state.currentPlayerId = null;
    state.currentBid = 0;
    state.currentBidder = null;
    state.auctionState = 'idle';
    state.bidHistory = [];
    saveState();
    io.emit('stateUpdate', state);
  });

  // Coordinator: Toggle Clearance Round
  socket.on('toggleClearance', (isClearance) => {
    state.isClearanceRound = isClearance;
    saveState();
    io.emit('stateUpdate', state);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Run Server
initializeState();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`DFC Auction Server running at http://localhost:${PORT}`);
});
