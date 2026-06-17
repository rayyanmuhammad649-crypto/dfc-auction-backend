// Determine if we should connect to an external backend or local
let BACKEND_URL = '';
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
  const urlParams = new URLSearchParams(window.location.search);
  BACKEND_URL = urlParams.get('backend') || localStorage.getItem('dfc_backend_url') || 'https://dfc-auction-backend.onrender.com';
  if (urlParams.get('backend')) {
    localStorage.setItem('dfc_backend_url', urlParams.get('backend'));
  }
}
const socket = io(BACKEND_URL);

// Client State
let currentRole = 'spectator';
let currentTeamId = null;
let currentName = 'Spectator';
let localState = null;

// Confetti Particle System
let confettiActive = false;
let confettiParticles = [];
const canvas = document.getElementById('confetti-canvas');
const ctx = canvas.getContext('2d');

// Setup canvas size
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Web Audio API Synthesizer
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playSynthesizedSound(type) {
  try {
    initAudio();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'bid') {
      // High chime sound
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15); // E6
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    } else if (type === 'gavel') {
      // Double strike gavel sound
      osc.type = 'triangle';
      
      // First strike
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.08);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
      
      // Second strike
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(120, now + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      gain2.gain.setValueAtTime(0.3, now + 0.12);
      gain2.gain.linearRampToValueAtTime(0.001, now + 0.2);

      osc.start(now);
      osc.stop(now + 0.08);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.2);
    } else if (type === 'unsold') {
      // Low buzzer sound
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.4);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else if (type === 'celebration') {
      // Celebration ascending major arpeggio
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const timeOffset = now + idx * 0.08;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, timeOffset);
        g.gain.setValueAtTime(0.15, timeOffset);
        g.gain.linearRampToValueAtTime(0.001, timeOffset + 0.3);
        o.start(timeOffset);
        o.stop(timeOffset + 0.3);
      });
    }
  } catch (e) {
    console.error('Audio synthesis failed:', e);
  }
}

// Play audio socket trigger
socket.on('playAudio', (type) => {
  playSynthesizedSound(type);
  if (type === 'gavel') {
    startConfetti();
  }
});

// Auto-login from sessionStorage on load
window.addEventListener('load', () => {
  const savedRole = sessionStorage.getItem('dfc_role');
  const savedName = sessionStorage.getItem('dfc_name');
  if (savedRole && savedName) {
    currentRole = savedRole;
    currentName = savedName;
    if (currentRole.startsWith('team')) {
      currentTeamId = currentRole;
    }
    showActiveDashboard();
  }
});

function togglePasswordInput() {
  const role = document.getElementById('role-select').value;
  const pwdGroup = document.getElementById('password-group');
  if (role === 'spectator') {
    pwdGroup.style.display = 'none';
  } else {
    pwdGroup.style.display = 'block';
  }
}

async function handleLogin() {
  const roleSelect = document.getElementById('role-select');
  const pwdInput = document.getElementById('password-input');
  const errorDiv = document.getElementById('login-error');
  
  const role = roleSelect.value;
  const password = pwdInput.value;

  errorDiv.style.display = 'none';

  if (role === 'spectator') {
    currentRole = 'spectator';
    currentName = 'Spectator';
    currentTeamId = null;
    sessionStorage.setItem('dfc_role', currentRole);
    sessionStorage.setItem('dfc_name', currentName);
    showActiveDashboard();
    if (localState) renderState(localState);
    return;
  }

  try {
    const res = await fetch(BACKEND_URL + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, password })
    });
    
    const data = await res.json();
    if (data.success) {
      currentRole = role;
      currentName = data.name;
      if (role.startsWith('team')) {
        currentTeamId = role;
      } else {
        currentTeamId = null;
      }
      sessionStorage.setItem('dfc_role', currentRole);
      sessionStorage.setItem('dfc_name', currentName);
      
      pwdInput.value = '';
      showActiveDashboard();
      if (localState) renderState(localState);
    } else {
      errorDiv.textContent = data.message || 'Login failed!';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Server connection error!';
    errorDiv.style.display = 'block';
  }
}

function logout() {
  sessionStorage.removeItem('dfc_role');
  sessionStorage.removeItem('dfc_name');
  currentRole = 'spectator';
  currentTeamId = null;
  currentName = 'Spectator';
  
  document.getElementById('header-meta').style.display = 'none';
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('spectator-screen').style.display = 'none';
  document.getElementById('team-screen').style.display = 'none';
  document.getElementById('coordinator-screen').style.display = 'none';
}

function showActiveDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('header-meta').style.display = 'flex';
  document.getElementById('role-display').textContent = currentName;

  if (currentRole === 'spectator') {
    document.getElementById('spectator-screen').style.display = 'grid';
    document.getElementById('team-screen').style.display = 'none';
    document.getElementById('coordinator-screen').style.display = 'none';
  } else if (currentRole.startsWith('team')) {
    document.getElementById('spectator-screen').style.display = 'none';
    document.getElementById('team-screen').style.display = 'grid';
    document.getElementById('coordinator-screen').style.display = 'none';
  } else if (currentRole === 'coordinator') {
    document.getElementById('spectator-screen').style.display = 'none';
    document.getElementById('team-screen').style.display = 'none';
    document.getElementById('coordinator-screen').style.display = 'block';
  }
}

// Receive state update from WebSocket
socket.on('stateUpdate', (state) => {
  localState = state;
  renderState(state);
});

// Error notifications
socket.on('errorMsg', (msg) => {
  alert(msg);
});

// Render the application based on state
function renderState(state) {
  if (currentRole === 'spectator') {
    renderSpectatorView(state);
  } else if (currentRole.startsWith('team')) {
    renderTeamView(state);
  } else if (currentRole === 'coordinator') {
    renderCoordinatorView(state);
  }
}

// ---------------- SPECTATOR VIEW RENDER ----------------
function renderSpectatorView(state) {
  const activeBiddingArea = document.getElementById('active-bidding-area');
  const noActiveBidding = document.getElementById('no-active-bidding');
  const clearanceBadge = document.getElementById('clearance-badge');

  // Clearance mode status
  clearanceBadge.style.display = state.isClearanceRound ? 'inline' : 'none';

  if (state.currentPlayerId) {
    activeBiddingArea.style.display = 'grid';
    noActiveBidding.style.display = 'none';

    const player = state.players.find(p => p.id === state.currentPlayerId);
    if (player) {
      // Set image and category highlights
      const imageEl = document.getElementById('bidding-player-image');
      imageEl.src = `images/${player.image}`;
      
      const cardContainer = document.getElementById('bidding-card-container');
      cardContainer.className = `player-bidding-card border-${player.category}`;

      // Set titles
      document.getElementById('player-details-title').textContent = player.name;
      const categoryEl = document.getElementById('player-details-category');
      categoryEl.textContent = player.category;
      categoryEl.className = `brand-font text-${player.category}`;
      document.getElementById('player-details-base').textContent = `${player.basePrice.toLocaleString()} DFC Coins`;

      // Set Bids
      const bidAmountEl = document.getElementById('current-bid-display');
      bidAmountEl.textContent = `${state.currentBid.toLocaleString()} DFC`;
      bidAmountEl.className = `bid-amount text-${player.category}`;

      const bidderEl = document.getElementById('current-bidder-display');
      const winningTeam = state.teams.find(t => t.id === state.currentBidder);
      bidderEl.textContent = winningTeam ? winningTeam.name : 'No Bids Yet';

      // Set Stamp Overlay
      const soldStamp = document.getElementById('sold-stamp');
      const unsoldStamp = document.getElementById('unsold-stamp');
      
      if (state.auctionState === 'sold') {
        soldStamp.className = "stamp stamp-sold visible";
        unsoldStamp.className = "stamp stamp-unsold";
        cardContainer.classList.add('sold');
      } else if (state.auctionState === 'unsold') {
        soldStamp.className = "stamp stamp-sold";
        unsoldStamp.className = "stamp stamp-unsold visible";
        cardContainer.classList.remove('sold');
      } else {
        soldStamp.className = "stamp stamp-sold";
        unsoldStamp.className = "stamp stamp-unsold";
        cardContainer.classList.remove('sold');
      }

      // Render Bid History Log
      const historyList = document.getElementById('bid-history-list');
      historyList.innerHTML = '';
      [...state.bidHistory].reverse().forEach(log => {
        const item = document.createElement('div');
        item.className = 'bid-history-item';
        item.innerHTML = `
          <span>${log.bidderName}</span>
          <span style="font-weight:700;">${log.amount.toLocaleString()} DFC</span>
        `;
        historyList.appendChild(item);
      });
    }
  } else {
    activeBiddingArea.style.display = 'none';
    noActiveBidding.style.display = 'block';
  }

  // Render Team budgets sidebar
  const teamListContainer = document.getElementById('team-list-container');
  teamListContainer.innerHTML = '';
  state.teams.forEach(team => {
    const box = document.createElement('div');
    box.style = 'background:rgba(255,255,255,0.02); padding: 1rem; border-radius: 8px; border: 1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;';
    
    // Check if team is out of budget or leading
    let budgetStyle = 'color: var(--color-gold); font-weight:800;';
    if (team.budget < 2000) {
      budgetStyle = 'color: #ff3b30; font-weight:800;';
    }

    box.innerHTML = `
      <div>
        <h4 style="font-weight:700;">${team.name}</h4>
        <span style="font-size:0.8rem; color:var(--text-muted);">${team.roster.length} Players bought</span>
      </div>
      <span style="${budgetStyle}">${team.budget.toLocaleString()} DFC</span>
    `;
    teamListContainer.appendChild(box);
  });

  // Render Team detailed rosters
  const rostersContainer = document.getElementById('rosters-grid-container');
  rostersContainer.innerHTML = '';
  state.teams.forEach(team => {
    const card = document.createElement('div');
    card.className = 'team-card';
    
    let rosterHtml = '';
    if (team.roster.length === 0) {
      rosterHtml = '<div style="color:var(--text-muted); font-size:0.85rem; padding: 0.5rem 0;">No players bought yet.</div>';
    } else {
      team.roster.forEach(p => {
        rosterHtml += `
          <div class="team-player-item">
            <span>${p.name} <small class="text-${p.category}" style="font-weight:600;">(${p.category})</small></span>
            <span style="font-weight:700;">${p.price.toLocaleString()} DFC</span>
          </div>
        `;
      });
    }

    card.innerHTML = `
      <div class="team-card-header">
        <h3>${team.name}</h3>
        <span class="team-budget">${team.budget.toLocaleString()} DFC</span>
      </div>
      <div class="team-players-list">
        ${rosterHtml}
      </div>
    `;
    rostersContainer.appendChild(card);
  });
}

// ---------------- TEAM VIEW RENDER ----------------
function renderTeamView(state) {
  const team = state.teams.find(t => t.id === currentTeamId);
  if (!team) return;

  // Render header values
  document.getElementById('team-portal-name').textContent = team.name;
  document.getElementById('team-budget-display').textContent = `Budget: ${team.budget.toLocaleString()} DFC`;

  const bArea = document.getElementById('team-bidding-area');
  const noBArea = document.getElementById('team-no-active');

  if (state.currentPlayerId) {
    bArea.style.display = 'grid';
    noBArea.style.display = 'none';

    const player = state.players.find(p => p.id === state.currentPlayerId);
    if (player) {
      document.getElementById('team-player-image').src = `images/${player.image}`;
      
      const bidAmountEl = document.getElementById('team-current-bid');
      bidAmountEl.textContent = `${state.currentBid.toLocaleString()} DFC`;
      bidAmountEl.className = `bid-amount text-${player.category}`;

      const bidderEl = document.getElementById('team-current-bidder');
      const winningTeam = state.teams.find(t => t.id === state.currentBidder);
      bidderEl.textContent = winningTeam ? winningTeam.name : 'No Bids Yet';

      // Disable bidding inputs if state is sold/unsold
      const bidInputs = document.getElementById('team-bidding-controls');
      if (state.auctionState !== 'bidding') {
        bidInputs.style.opacity = '0.4';
        bidInputs.querySelectorAll('button, input').forEach(el => el.disabled = true);
      } else {
        bidInputs.style.opacity = '1';
        bidInputs.querySelectorAll('button, input').forEach(el => el.disabled = false);
      }
    }
  } else {
    bArea.style.display = 'none';
    noBArea.style.display = 'block';
  }

  // Render own roster list
  const teamRosterList = document.getElementById('team-roster-list');
  teamRosterList.innerHTML = '';
  if (team.roster.length === 0) {
    teamRosterList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding: 2rem 0;">No players bought yet.</div>';
  } else {
    team.roster.forEach(p => {
      const item = document.createElement('div');
      item.className = 'team-player-item';
      item.style.padding = '0.8rem 1rem';
      item.style.marginBottom = '0.5rem';
      item.style.background = 'rgba(255,255,255,0.02)';
      item.style.borderRadius = '8px';
      item.innerHTML = `
        <div style="display:flex; align-items:center; gap: 0.8rem;">
          <img src="images/${p.image}" style="width:30px; height:35px; object-fit:cover; border-radius:4px;">
          <div>
            <span style="font-weight:600; display:block;">${p.name}</span>
            <small class="text-${p.category}" style="text-transform:uppercase; font-size:0.75rem; font-weight:700;">${p.category}</small>
          </div>
        </div>
        <span style="font-weight:700; color:var(--color-gold);">${p.price.toLocaleString()} DFC</span>
      `;
      teamRosterList.appendChild(item);
    });
  }
}

function teamIncrementBid(increment) {
  if (!localState || !currentTeamId) return;
  
  // Calculate new bid amount
  let basePrice = 0;
  const player = localState.players.find(p => p.id === localState.currentPlayerId);
  if (player) {
    basePrice = localState.isClearanceRound ? Math.round(player.basePrice * 0.5) : player.basePrice;
  }

  let amount = localState.currentBid + increment;
  if (!localState.currentBidder) {
    // If no bids placed, bid starts at base price + increment or base price
    amount = basePrice;
  }

  socket.emit('placeBid', { teamId: currentTeamId, amount });
}

function submitCustomBid() {
  const input = document.getElementById('custom-bid-input');
  const amount = parseInt(input.value);
  if (isNaN(amount) || amount <= 0) {
    alert('Please enter a valid bid amount!');
    return;
  }

  socket.emit('placeBid', { teamId: currentTeamId, amount });
  input.value = '';
}

// ---------------- COORDINATOR VIEW RENDER ----------------
function renderCoordinatorView(state) {
  // Populate team option list in bidding console
  const adminSelect = document.getElementById('admin-bidder-select');
  if (adminSelect && adminSelect.children.length === 0) {
    adminSelect.innerHTML = '<option value="">Select Team</option>';
    state.teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      adminSelect.appendChild(opt);
    });
  }

  // Renders players checklist
  renderCoordinatorPlayers();

  // Active Controller state
  const activeControl = document.getElementById('coordinator-active-player');
  const noActiveControl = document.getElementById('coordinator-no-active');
  
  if (state.currentPlayerId) {
    activeControl.style.display = 'block';
    noActiveControl.style.display = 'none';

    const player = state.players.find(p => p.id === state.currentPlayerId);
    if (player) {
      document.getElementById('coordinator-player-img').src = `images/${player.image}`;
      document.getElementById('coordinator-player-name').textContent = player.name;
      const categoryEl = document.getElementById('coordinator-player-category');
      categoryEl.textContent = player.category;
      categoryEl.className = `text-${player.category}`;

      const bidEl = document.getElementById('coordinator-current-bid');
      bidEl.textContent = `${state.currentBid.toLocaleString()} DFC`;
      bidEl.className = `bid-amount text-${player.category}`;

      const bidderEl = document.getElementById('coordinator-current-bidder');
      const winningTeam = state.teams.find(t => t.id === state.currentBidder);
      bidderEl.textContent = winningTeam ? winningTeam.name : 'No Bids Yet';

      // Disable SOLD button if no bids placed
      document.getElementById('sold-btn').disabled = !state.currentBidder;
    }
  } else {
    activeControl.style.display = 'none';
    noActiveControl.style.display = 'block';

    // Set checkbox state
    document.getElementById('clearance-checkbox').checked = state.isClearanceRound;
  }
}

function renderCoordinatorPlayers() {
  if (!localState) return;

  const catFilter = document.getElementById('category-filter').value;
  const statusFilter = document.getElementById('status-filter').value;
  const container = document.getElementById('coordinator-player-list');
  container.innerHTML = '';

  const filtered = localState.players.filter(p => {
    const matchCat = catFilter === 'all' || p.category === catFilter;
    const matchStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchCat && matchStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding: 2rem 0;">No players match filters.</div>';
    return;
  }

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-picker-item';
    if (p.id === localState.currentPlayerId) {
      item.classList.add('active-block');
    }

    let statusText = 'Unsold';
    let statusStyle = 'color: var(--text-muted); font-size:0.8rem; font-weight:600;';
    if (p.status === 'Sold') {
      const team = localState.teams.find(t => t.id === p.soldTo);
      statusText = `Sold to ${team ? team.name : p.soldTo} (${p.soldPrice.toLocaleString()} DFC)`;
      statusStyle = 'color: #34c759; font-size:0.8rem; font-weight:600;';
    }

    let baseVal = p.basePrice;
    if (p.status === 'Unsold' && localState.isClearanceRound) {
      baseVal = Math.round(baseVal * 0.5);
    }

    item.onclick = () => {
      if (p.status === 'Unsold') {
        socket.emit('setPlayerOnBlock', p.id);
      }
    };

    item.innerHTML = `
      <div style="display:flex; align-items:center; gap: 0.8rem;">
        <img src="images/${p.image}" style="width:36px; height:42px; object-fit:cover; border-radius:4px;">
        <div class="player-info-meta">
          <span style="font-weight:700;">${p.name}</span>
          <span class="player-category-pill pill-${p.category}">${p.category}</span>
        </div>
      </div>
      <div style="text-align:right;">
        <span style="display:block; font-weight:800; color:var(--color-gold);">${baseVal.toLocaleString()} DFC</span>
        <span style="${statusStyle}">${statusText}</span>
      </div>
    `;

    container.appendChild(item);
  });
}

function adminPlaceBid() {
  const teamId = document.getElementById('admin-bidder-select').value;
  const amount = parseInt(document.getElementById('admin-bid-amount').value);
  
  if (!teamId || isNaN(amount) || amount <= 0) {
    alert('Please select a team and enter a valid bid amount!');
    return;
  }

  socket.emit('placeBid', { teamId, amount });
  document.getElementById('admin-bid-amount').value = '';
}

function sellPlayer() {
  if (confirm('Are you sure you want to sell this player to the highest bidder?')) {
    socket.emit('sellPlayer');
  }
}

function markUnsold() {
  if (confirm('Are you sure you want to mark this player UNSOLD?')) {
    socket.emit('markUnsold');
  }
}

function clearBlock() {
  socket.emit('clearBlock');
}

function toggleClearanceRound() {
  const isChecked = document.getElementById('clearance-checkbox').checked;
  socket.emit('toggleClearance', isChecked);
}

function resetAuction() {
  if (confirm('WARNING: This will reset all team budgets, rosters, and players back to defaults. Are you sure you want to do this?')) {
    const password = prompt('Enter Admin Reset Password:');
    if (password) {
      fetch(BACKEND_URL + '/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert('Auction has been reset successfully!');
        } else {
          alert('Reset failed: ' + data.message);
        }
      });
    }
  }
}

// ---------------- CONFETTI CELEBRATIONS ----------------
function startConfetti() {
  confettiActive = true;
  confettiParticles = [];
  playSynthesizedSound('celebration');
  
  // Generate particles
  for (let i = 0; i < 150; i++) {
    confettiParticles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      r: Math.random() * 6 + 4,
      d: Math.random() * canvas.height,
      color: `hsl(${Math.random() * 360}, 100%, 50%)`,
      tilt: Math.random() * 10 - 5,
      tiltAngleIncremental: Math.random() * 0.07 + 0.02,
      tiltAngle: 0
    });
  }

  setTimeout(() => {
    confettiActive = false;
  }, 4000); // stop after 4 seconds
}

function drawConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (!confettiActive && confettiParticles.length === 0) return;

  confettiParticles.forEach((p, idx) => {
    p.tiltAngle += p.tiltAngleIncremental;
    p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
    p.x += Math.sin(p.tiltAngle);
    p.tilt = Math.sin(p.tiltAngle - idx / 3) * 15;

    ctx.beginPath();
    ctx.lineWidth = p.r;
    ctx.strokeStyle = p.color;
    ctx.moveTo(p.x + p.tilt + p.r / 2, p.y);
    ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 2);
    ctx.stroke();
  });

  // Remove falling off particle
  confettiParticles = confettiParticles.filter(p => p.y < canvas.height);

  if (confettiActive || confettiParticles.length > 0) {
    requestAnimationFrame(drawConfetti);
  }
}

// Trigger loop when confetti starts
function startConfettiLoop() {
  requestAnimationFrame(drawConfetti);
}

// Intercept startConfetti to trigger loop
const originalStartConfetti = startConfetti;
startConfetti = function() {
  originalStartConfetti();
  startConfettiLoop();
};
