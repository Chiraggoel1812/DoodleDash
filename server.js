/**
 * DoodleDash server — Express + Socket.IO.
 * The server is authoritative: it owns room state, turn order, the secret word,
 * timers, hints and scoring. Clients only send intents (draw, guess, choose_word...).
 *
 * Identity: every browser tab keeps a private session token (sent in the socket handshake).
 * The token maps to a player in a room, so a refresh / network drop can resume the same player.
 * Players are shown to others only by a separate public id — the token never leaves the server.
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const WORDS = require('./words.json');          // { language: { category: [WORD, ...] } }

const PORT = process.env.PORT || 3001;
const ORIGINS = (process.env.CLIENT_ORIGIN || '*').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const corsOrigin = ORIGINS.includes('*') ? '*' : ORIGINS;

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

const CHOOSE_SECONDS = 15;      // drawer must pick a word within this time (auto-pick otherwise)
const ROUND_END_MS = 4000;      // pause between turns
const GRACE_MS = 30000;         // how long a disconnected player's seat is kept for reconnecting
const rooms = new Map();        // roomId -> room
const sessions = new Map();     // private token -> { roomId, playerId }
const live = new Map();         // private token -> number of open sockets

/* ------------------------------ helpers ------------------------------ */
const randId = (n, taken) => {
  let id;
  do { id = Math.random().toString(36).slice(2, 2 + n).toUpperCase(); } while (id.length < n || (taken && taken(id)));
  return id;
};
const clamp = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : def; };
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const languages = Object.keys(WORDS);
const categories = Object.keys(WORDS.en);
const pm = id => 'p:' + id;     // socket.io room that holds all sockets of one player (for private messages)

function normalizeSettings(input = {}, base = {}) {
  return {
    maxPlayers: clamp(input.maxPlayers, 2, 20, base.maxPlayers ?? 8),
    rounds: clamp(input.rounds, 2, 10, base.rounds ?? 3),
    drawTime: clamp(input.drawTime, 15, 240, base.drawTime ?? 60),
    wordCount: clamp(input.wordCount, 1, 5, base.wordCount ?? 3),
    hintCount: clamp(input.hintCount, 0, 5, base.hintCount ?? 2),
    isPublic: typeof input.isPublic === 'boolean' ? input.isPublic : !!base.isPublic,
    category: categories.includes(input.category) || input.category === 'all' ? input.category : (base.category || 'all'),
    wordMode: ['normal', 'hidden', 'combination'].includes(input.wordMode) ? input.wordMode : (base.wordMode || 'normal'),
    language: languages.includes(input.language) ? input.language : (base.language || 'en')
  };
}

function wordPool(room) {
  const bank = WORDS[room.settings.language] || WORDS.en;
  const list = room.settings.category === 'all' ? Object.values(bank).flat() : bank[room.settings.category];
  return [...new Set(list)];
}
/** Normal/hidden: N distinct words. Combination: each option is TWO words glued together. */
function wordOptionsFor(room) {
  const pool = shuffle(wordPool(room)); const n = room.settings.wordCount;
  if (room.settings.wordMode !== 'combination') return pool.slice(0, n);
  const opts = [];
  for (let i = 0; i < n; i++) opts.push(`${pool[(2 * i) % pool.length]} ${pool[(2 * i + 1) % pool.length]}`);
  return [...new Set(opts)];
}

/** Guess matching: trim, lowercase, collapse spaces, ignore accents (é = e) — so "avión" matches AVION. */
const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** "Partial" match: one typo away, or a long-enough piece of the word (e.g. "ice" for "ice cream"). */
function isClose(guess, word) {
  if (guess === word) return false;
  if (word.length >= 3 && editDistance(guess, word) <= 1) return true;
  if (guess.length >= 3 && (word.includes(guess) || guess.includes(word))) return true;
  return false;
}

const letterCount = w => w.replace(/ /g, '').length;
function hintFor(room, revealCount) {
  if (room.settings.wordMode === 'hidden') return '';
  const shown = new Set(room.hintOrder.slice(0, revealCount));
  return [...room.word].map((ch, i) => (ch === ' ' ? ' ' : shown.has(i) ? ch : '_')).join(' ');
}

function publicRoomList() {
  return [...rooms.values()]
    .filter(r => r.settings.isPublic && r.phase === 'lobby' && r.players.length < r.settings.maxPlayers)
    .map(r => ({ id: r.id, count: r.players.length, maxPlayers: r.settings.maxPlayers, host: r.players.find(p => p.id === r.hostId)?.name || 'Host' }));
}
const emitPublicRooms = () => io.emit('public_rooms', publicRoomList());

const publicPlayer = p => ({ id: p.id, name: p.name, score: p.score, ready: p.ready, connected: p.connected });
function publicRoom(room) {
  return {
    id: room.id, hostId: room.hostId, settings: room.settings, phase: room.phase,
    round: room.round, totalRounds: room.totalRounds, drawerId: room.drawerId,
    wordLength: room.word ? letterCount(room.word) : 0, hint: room.hint || '',
    players: room.players.map(publicPlayer), timeLeft: room.timeLeft, messages: room.messages.slice(-40)
    // NOTE: room.word and player tokens are intentionally never part of the public state.
  };
}
function emitState(room) {
  io.to(room.id).emit('room_state', publicRoom(room));
  const gs = { phase: room.phase, round: room.round, drawerId: room.drawerId, word: null, hints: room.hint };   // spec: game_state
  io.to(room.id).emit('game_state', gs);
  if (room.word && room.drawerId) io.to(pm(room.drawerId)).emit('game_state', { ...gs, word: room.word });
}
function addMessage(room, msg) { room.messages.push(msg); if (room.messages.length > 100) room.messages.shift(); io.to(room.id).emit('chat_message', msg); }
const sys = (room, text) => addMessage(room, { system: true, text });

function clearTimers(room) {
  clearInterval(room.tickTimer); clearTimeout(room.chooseTimer); clearTimeout(room.nextTimer);
  room.tickTimer = room.chooseTimer = room.nextTimer = null;
}

const ctx = socket => {
  const s = sessions.get(socket.data.token);
  const room = s && rooms.get(s.roomId);
  const player = room?.players.find(p => p.id === s.playerId);
  return player ? { room, player } : {};
};

function newPlayer(room, socket, name, ready) {
  const player = { id: randId(8, id => room.players.some(p => p.id === id)), token: socket.data.token, name, score: 0, ready, connected: true, grace: null };
  room.players.push(player);
  sessions.set(socket.data.token, { roomId: room.id, playerId: player.id });
  socket.join(room.id); socket.join(pm(player.id));
  socket.emit('hello', { playerId: player.id });
  return player;
}

/* --------------------------- game flow --------------------------- */
function resetToLobby(room, notice) {
  clearTimers(room);
  room.phase = 'lobby'; room.round = 0; room.drawerId = null; room.word = null; room.hint = '';
  room.strokes = []; room.guessed = new Set(); room.timeLeft = 0; room.votes.clear();
  room.players.forEach(p => { p.score = 0; p.ready = p.id === room.hostId; });
  io.to(room.id).emit('canvas_reset');
  if (notice) sys(room, notice);
  emitState(room); emitPublicRooms();
}

function peekDrawer(room) {                      // who draws next (without advancing)
  for (let i = 0; i < room.turnOrder.length; i++) {
    const id = room.turnOrder[(room.turnCursor + i) % room.turnOrder.length];
    if (room.players.some(p => p.id === id)) return id;
  }
  return null;
}
function pickDrawer(room) {
  const id = peekDrawer(room);
  if (id) room.turnCursor = (room.turnOrder.indexOf(id) + 1) % room.turnOrder.length;
  return id || room.players[0]?.id || null;
}

function nextRound(room) {
  clearTimers(room);
  if (room.players.length < 2) return resetToLobby(room, 'Not enough players — back to the lobby.');
  if (room.round >= room.totalRounds) return endGame(room);

  room.round += 1; room.phase = 'choosing'; room.drawerId = pickDrawer(room);
  room.word = null; room.hint = ''; room.guessed = new Set(); room.gains = new Map(); room.strokes = [];
  room.wordOptions = wordOptionsFor(room);
  const base = { round: room.round, totalRounds: room.totalRounds, drawerId: room.drawerId, drawTime: room.settings.drawTime };
  // Spec: round_start carries wordOptions — but only the drawer may see them.
  io.to(room.id).except(pm(room.drawerId)).emit('round_start', { ...base, wordOptions: [] });
  io.to(pm(room.drawerId)).emit('round_start', { ...base, wordOptions: room.wordOptions });
  io.to(room.id).emit('canvas_reset');
  emitState(room);
  room.chooseTimer = setTimeout(() => { if (room.phase === 'choosing') chooseWord(room, room.wordOptions[0]); }, CHOOSE_SECONDS * 1000);
}

function chooseWord(room, word) {
  clearTimeout(room.chooseTimer);
  room.word = word; room.phase = 'playing'; room.style = { color: '#111827', size: 4 };
  const letterIdx = [...word].map((c, i) => (c === ' ' ? -1 : i)).filter(i => i >= 0);
  room.hintOrder = shuffle(letterIdx); room.hintsShown = 0; room.hint = hintFor(room, 0);
  io.to(pm(room.drawerId)).emit('your_word', word);
  io.to(room.id).emit('word_hint', { hint: room.hint, length: letterCount(word) });
  emitState(room); startTimer(room);
}

function startTimer(room) {
  clearInterval(room.tickTimer);
  room.timeLeft = room.settings.drawTime;
  const maxHints = Math.min(room.settings.hintCount, Math.max(0, room.hintOrder.length - 1));
  room.tickTimer = setInterval(() => {
    room.timeLeft -= 1;
    const elapsed = room.settings.drawTime - room.timeLeft;
    const due = maxHints > 0 ? Math.min(maxHints, Math.floor(elapsed / (room.settings.drawTime / (maxHints + 1)))) : 0;
    if (due > room.hintsShown) {
      room.hintsShown = due; room.hint = hintFor(room, due);
      io.to(room.id).emit('word_hint', { hint: room.hint, length: letterCount(room.word) });
    }
    io.to(room.id).emit('timer', room.timeLeft);
    if (room.timeLeft <= 0) endRound(room);
  }, 1000);
}

function endRound(room) {
  if (room.phase !== 'playing') return;
  clearTimers(room); room.phase = 'roundEnd';
  const scores = room.players.map(p => ({ id: p.id, name: p.name, score: p.score, gained: room.gains.get(p.id) || 0 }));
  const nextId = room.round >= room.totalRounds ? null : peekDrawer(room);
  io.to(room.id).emit('round_end', { word: room.word, scores, nextDrawer: room.players.find(p => p.id === nextId)?.name || null });
  emitState(room);
  room.nextTimer = setTimeout(() => { if (rooms.get(room.id) === room && room.phase === 'roundEnd') nextRound(room); }, ROUND_END_MS);
}

function endGame(room) {
  clearTimers(room); room.phase = 'gameOver'; room.drawerId = null;
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const leaderboard = [];
  sorted.forEach((p, i) => leaderboard.push({ rank: i > 0 && p.score === sorted[i - 1].score ? leaderboard[i - 1].rank : i + 1, name: p.name, score: p.score }));   // ties share a rank
  const top = leaderboard.filter(e => e.rank === 1);
  io.to(room.id).emit('game_over', { leaderboard, winners: top.map(e => e.name), winner: top[0] || null, tie: top.length > 1 });
  emitState(room); emitPublicRooms();
}

function award(room, player, points) {
  player.score += points; room.gains.set(player.id, (room.gains.get(player.id) || 0) + points);
}

function removePlayer(room, playerId) {
  const player = room.players.find(p => p.id === playerId);
  if (!player) return;
  clearTimeout(player.grace);
  sessions.delete(player.token);
  room.players = room.players.filter(p => p.id !== playerId);
  room.guessed.delete(playerId); room.votes.delete(playerId);
  room.votes.forEach(set => set.delete(playerId));
  if (room.players.length === 0) { clearTimers(room); rooms.delete(room.id); emitPublicRooms(); return; }
  if (room.hostId === playerId) { room.hostId = room.players[0].id; room.players[0].ready = true; sys(room, `${room.players[0].name} is the new host`); }
  sys(room, `${player.name} left the room`);
  io.to(room.id).emit('player_left', { playerId, players: room.players.map(publicPlayer) });

  if (room.phase !== 'lobby' && room.phase !== 'gameOver') {
    if (room.players.length < 2) return resetToLobby(room, 'Not enough players — back to the lobby.');
    if (room.drawerId === playerId) {
      if (room.phase === 'playing') { sys(room, 'The drawer left — round over.'); endRound(room); }
      else if (room.phase === 'choosing') nextRound(room);
    } else if (room.phase === 'playing' && room.guessed.size >= room.players.length - 1) endRound(room);
  }
  emitState(room); emitPublicRooms();
}

function kick(room, playerId, byVote) {
  const target = room.players.find(p => p.id === playerId); if (!target) return;
  room.banned.add(target.name.toLowerCase());
  io.to(pm(playerId)).emit('kicked', { byVote: !!byVote });
  io.in(pm(playerId)).socketsLeave(room.id);
  removePlayer(room, playerId);
}

/* --------------------------- http --------------------------- */
app.get('/health', (_, res) => res.json({ ok: true, service: 'DoodleDash API', rooms: rooms.size }));
const dist = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(dist)) {            // single-service deployment: serve the built React app too
  app.use(express.static(dist));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

/* --------------------------- sockets --------------------------- */
io.on('connection', socket => {
  const raw = socket.handshake.auth?.sessionId;
  socket.data.token = typeof raw === 'string' && /^[A-Za-z0-9_-]{12,64}$/.test(raw) ? raw : 'anon-' + socket.id;
  const token = socket.data.token;
  live.set(token, (live.get(token) || 0) + 1);

  /* ---- resume: the same browser tab came back (refresh / network blip) ---- */
  (() => {
    const { room, player } = ctx(socket); if (!room) return;
    clearTimeout(player.grace); player.connected = true;
    socket.join(room.id); socket.join(pm(player.id));
    socket.emit('hello', { playerId: player.id });
    emitState(room);
    if (room.strokes.length) socket.emit('canvas_redraw', room.strokes);
    if (room.phase === 'choosing' && room.drawerId === player.id) socket.emit('round_start', { round: room.round, totalRounds: room.totalRounds, drawerId: room.drawerId, drawTime: room.settings.drawTime, wordOptions: room.wordOptions });
    if (room.phase === 'playing') {
      socket.emit('word_hint', { hint: room.hint, length: letterCount(room.word) });
      if (room.drawerId === player.id) socket.emit('your_word', room.word);
    }
  })();

  socket.on('list_public_rooms', () => socket.emit('public_rooms', publicRoomList()));

  socket.on('create_room', ({ hostName, settings } = {}, cb = () => {}) => {
    if (ctx(socket).room) return cb({ error: 'You are already in a room.' });
    const name = String(hostName || '').trim().slice(0, 20);
    if (!name) return cb({ error: 'Enter your name first.' });
    const id = randId(5, x => rooms.has(x));
    const room = {
      id, hostId: null, settings: normalizeSettings(settings), players: [], banned: new Set(), votes: new Map(), phase: 'lobby',
      round: 0, totalRounds: 0, turnOrder: [], turnCursor: 0, drawerId: null, word: null, wordOptions: [], hint: '', hintOrder: [], hintsShown: 0,
      guessed: new Set(), gains: new Map(), strokes: [], style: { color: '#111827', size: 4 }, messages: [], timeLeft: 0, tickTimer: null, chooseTimer: null, nextTimer: null
    };
    rooms.set(id, room);
    const p = newPlayer(room, socket, name, true); room.hostId = p.id;
    cb({ roomId: id, playerId: p.id }); emitState(room); emitPublicRooms();
  });

  socket.on('join_room', ({ roomId, playerName } = {}, cb = () => {}) => {
    if (ctx(socket).room) return cb({ error: 'You are already in a room.' });
    const id = String(roomId || '').trim().toUpperCase();
    const name = String(playerName || '').trim().slice(0, 20);
    const room = rooms.get(id);
    if (!name) return cb({ error: 'Enter your name first.' });
    if (!room) return cb({ error: 'Room not found. Check the code.' });
    if (room.phase === 'gameOver') return cb({ error: 'This game just finished — ask the host for a new game.' });
    if (room.banned.has(name.toLowerCase())) return cb({ error: 'You were removed from this room.' });
    if (room.players.length >= room.settings.maxPlayers) return cb({ error: 'Room is full.' });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return cb({ error: 'That name is already in use.' });
    const late = room.phase !== 'lobby';                       // joining a game in progress is allowed
    const p = newPlayer(room, socket, name, late);
    if (late) room.turnOrder.push(p.id);
    cb({ roomId: id, playerId: p.id }); emitState(room);
    io.to(room.id).emit('player_joined', { player: publicPlayer(p), players: room.players.map(publicPlayer) });
    sys(room, `${name} joined the room`); emitPublicRooms();
    if (late) {
      if (room.strokes.length) socket.emit('canvas_redraw', room.strokes);
      if (room.phase === 'playing') socket.emit('word_hint', { hint: room.hint, length: letterCount(room.word) });
    }
  });

  socket.on('leave_room', () => {
    const { room, player } = ctx(socket); if (!room) return;
    io.in(pm(player.id)).socketsLeave(room.id);
    removePlayer(room, player.id);
  });

  // Host-only; only before the game starts.
  socket.on('update_room_settings', (settings = {}, cb = () => {}) => {
    const { room, player } = ctx(socket);
    if (!room) return cb({ error: 'Room not found.' });
    if (room.hostId !== player.id) return cb({ error: 'Only the host can change room settings.' });
    if (room.phase !== 'lobby') return cb({ error: 'Settings are locked after the game starts.' });
    const next = normalizeSettings(settings, room.settings);
    next.maxPlayers = Math.max(next.maxPlayers, room.players.length);
    room.settings = next; cb({ ok: true }); emitState(room); emitPublicRooms();
  });

  socket.on('toggle_ready', () => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'lobby' || room.hostId === player.id) return;
    player.ready = !player.ready; emitState(room);
  });

  socket.on('start_game', () => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'lobby') return;
    if (room.players.length < 2 || room.players.some(p => !p.ready || !p.connected)) return;
    room.players.forEach(p => { p.score = 0; });
    room.round = 0; room.turnOrder = shuffle(room.players.map(p => p.id)); room.turnCursor = 0;
    room.totalRounds = room.settings.rounds * room.players.length;   // every player draws `rounds` times
    sys(room, 'The game has started!');
    nextRound(room); emitPublicRooms();
  });

  socket.on('play_again', () => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || room.phase !== 'gameOver') return;
    resetToLobby(room, 'Back in the lobby — ready up for another game!');
  });

  /* ---- moderation: host kick, and vote-kick by the other players ---- */
  socket.on('kick_player', ({ playerId } = {}) => {
    const { room, player } = ctx(socket);
    if (!room || room.hostId !== player.id || playerId === player.id) return;
    kick(room, playerId, false);
  });

  socket.on('votekick', ({ playerId } = {}) => {
    const { room, player } = ctx(socket);
    const target = room?.players.find(p => p.id === playerId);
    if (!room || !target || target.id === player.id || target.id === room.hostId) return;
    if (room.players.length < 3) return;                                   // need at least 3 players for a vote
    const set = room.votes.get(target.id) || new Set();
    set.add(player.id); room.votes.set(target.id, set);
    const needed = Math.floor((room.players.length - 1) / 2) + 1;          // majority of everyone except the target
    sys(room, `${player.name} voted to kick ${target.name} (${set.size}/${needed})`);
    if (set.size >= needed) { sys(room, `${target.name} was vote-kicked.`); kick(room, target.id, true); }
  });

  /* ---- word choice (spec names: word_chosen; also accepted as choose_word) ---- */
  const onChoose = ({ word } = {}) => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'choosing' || room.drawerId !== player.id) return;
    const picked = String(word || '').toUpperCase();
    if (!room.wordOptions.includes(picked)) return;
    chooseWord(room, picked);
  };
  socket.on('word_chosen', onChoose); socket.on('choose_word', onChoose);

  /* ---- drawing: the drawer streams points, the server validates, stores and relays ----
     Accepted as draw_start / draw_move / draw_end (spec) or as draw_data {type}. */
  const onDraw = (type, d) => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'playing' || room.drawerId !== player.id || !d) return;
    if (!['start', 'move', 'end'].includes(type)) return;
    if (type === 'start') room.style = {
      color: /^#[0-9a-f]{3,8}$/i.test(d.color) ? d.color : '#111827',
      size: Math.max(1, Math.min(60, Number(d.size) || 4))
    };
    const safe = { type, x: Number(d.x), y: Number(d.y), color: room.style.color, size: room.style.size };
    if (type === 'end' && d.x === undefined) { const last = room.strokes[room.strokes.length - 1]; safe.x = last ? last.x : 0; safe.y = last ? last.y : 0; }
    if (![safe.x, safe.y].every(Number.isFinite) || safe.x < 0 || safe.x > 1 || safe.y < 0 || safe.y > 1) return;
    if (room.strokes.length >= 30000) return;
    room.strokes.push(safe);
    socket.to(room.id).emit('draw_data', safe);
  };
  socket.on('draw_start', d => onDraw('start', d));
  socket.on('draw_move', d => onDraw('move', d));
  socket.on('draw_end', d => onDraw('end', d || {}));
  socket.on('draw_data', d => onDraw(d?.type, d));

  socket.on('draw_undo', () => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'playing' || room.drawerId !== player.id) return;
    let i = room.strokes.length - 1;
    while (i >= 0 && room.strokes[i].type !== 'start') i--;       // find the start of the last stroke
    if (i >= 0) room.strokes.splice(i);
    io.to(room.id).emit('canvas_redraw', room.strokes);
  });

  socket.on('canvas_clear', () => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'playing' || room.drawerId !== player.id) return;
    room.strokes = []; io.to(room.id).emit('canvas_reset');
  });

  /* ---- guessing & chat ---- */
  socket.on('guess', ({ text } = {}) => {
    const { room, player } = ctx(socket);
    if (!room || room.phase !== 'playing' || room.drawerId === player.id) return;
    const raw = String(text || '').trim().slice(0, 60); if (!raw) return;
    const guess = norm(raw); const word = norm(room.word);

    if (room.guessed.has(player.id)) {         // already guessed: talk only with other guessers + drawer
      const msg = { playerId: player.id, playerName: player.name, text: raw, private: true };
      [...room.guessed, room.drawerId].forEach(id => io.to(pm(id)).emit('chat_message', msg));
      return;
    }
    if (guess === word) {
      room.guessed.add(player.id);
      const points = Math.max(10, Math.round((room.timeLeft / room.settings.drawTime) * 100));
      award(room, player, points);
      const drawer = room.players.find(p => p.id === room.drawerId);
      if (drawer) award(room, drawer, Math.round(points / 2));          // drawer is rewarded for a good drawing
      sys(room, `${player.name} guessed the word! (+${points})`);
      io.to(room.id).emit('guess_correct', { playerId: player.id, playerName: player.name, points });
      io.to(room.id).emit('guess_result', { correct: true, playerId: player.id, playerName: player.name, points });
      emitState(room);
      if (room.guessed.size >= room.players.length - 1) endRound(room);
    } else if (isClose(guess, word)) {
      socket.emit('close_guess', { text: raw });                         // private hint, not shown to others
    } else {
      addMessage(room, { playerId: player.id, playerName: player.name, text: raw });
      io.to(room.id).emit('guess_result', { correct: false, playerId: player.id, playerName: player.name, points: 0 });
    }
  });

  socket.on('chat', ({ text } = {}) => {
    const { room, player } = ctx(socket);
    const value = String(text || '').trim().slice(0, 120);
    if (!room || !value || room.phase === 'playing') return;
    addMessage(room, { playerId: player.id, playerName: player.name, text: value });
  });

  socket.on('disconnect', () => {
    live.set(token, (live.get(token) || 1) - 1);
    if (live.get(token) > 0) return;                  // another tab/socket with the same session is still open
    live.delete(token);
    const { room, player } = ctx(socket); if (!room) return;
    player.connected = false; emitState(room);
    // keep the seat for a while so a refresh / network drop can resume
    player.grace = setTimeout(() => { if (rooms.get(room.id) === room && !player.connected) removePlayer(room, player.id); }, GRACE_MS);
  });
});

server.listen(PORT, () => console.log(`DoodleDash server listening on ${PORT}`));
