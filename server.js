const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*' } });
const PORT = process.env.PORT || 3001;
const rooms = new Map();
const WORDS = ['APPLE','CASTLE','GUITAR','ROCKET','TIGER','PIZZA','RAINBOW','BICYCLE','AIRPLANE','SUNFLOWER','UMBRELLA','VOLCANO','LAPTOP','TURTLE','ICE CREAM','CAMERA','DOLPHIN','MOUNTAIN','PENCIL','BUTTERFLY'];

function makeId() { return Math.random().toString(36).slice(2, 7).toUpperCase(); }
function publicRoom(room) {
  return { id: room.id, hostId: room.hostId, settings: room.settings, phase: room.phase, round: room.round, totalRounds: room.totalRounds || (room.settings.rounds * Math.max(room.players.length, 1)),
    drawerId: room.drawerId, wordLength: room.word ? room.word.length : 0, hint: room.hint || '',
    players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, ready: p.ready })),
    timeLeft: room.timeLeft, messages: room.messages.slice(-40) };
}
function emitState(room) { io.to(room.id).emit('room_state', publicRoom(room)); }
function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function endRound(room) {
  if (room.phase !== 'playing') return;
  stopTimer(room); room.phase = 'roundEnd';
  io.to(room.id).emit('round_end', { word: room.word, scores: room.players.map(p => ({ id:p.id, name:p.name, score:p.score })) });
  emitState(room);
  setTimeout(() => { if (rooms.get(room.id) === room && room.phase === 'roundEnd') nextRound(room); }, 3500);
}
function hintFor(word, revealCount = 0) {
  let revealed = 0;
  return [...word].map(ch => { if (ch === ' ') return '  '; if (revealed < revealCount) { revealed++; return ch; } revealed++; return '_ '; }).join('').trim();
}
function startTimer(room) {
  stopTimer(room); room.timeLeft = room.settings.drawTime;
  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    const elapsed = room.settings.drawTime - room.timeLeft;
    const configuredHints = room.settings.hintCount ?? 2; const hintStep = configuredHints > 0 ? room.settings.drawTime / (configuredHints + 1) : Infinity; const revealCount = configuredHints > 0 ? Math.min(configuredHints, Math.floor(elapsed / hintStep)) : 0;
    room.hint = hintFor(room.word, revealCount);
    io.to(room.id).emit('timer', room.timeLeft);
    io.to(room.id).emit('word_hint', { hint: room.hint, length: room.word.length });
    if (room.timeLeft <= 0) endRound(room);
  }, 1000);
}
function nextRound(room) {
  stopTimer(room);
  const eligible = room.players;
  if (eligible.length < 2) { room.phase = 'lobby'; room.drawerId = null; room.word = null; emitState(room); return; }
  if (room.round >= (room.totalRounds || room.settings.rounds * eligible.length)) {
    room.phase = 'gameOver'; room.drawerId = null;
    const leaderboard = [...room.players].sort((a,b) => b.score - a.score).map((p,i) => ({ rank:i+1, name:p.name, score:p.score }));
    io.to(room.id).emit('game_over', { leaderboard, winner: leaderboard[0] || null }); emitState(room); return;
  }
  room.round += 1; room.phase = 'choosing'; room.drawerId = eligible[(room.round - 1) % eligible.length].id;
  room.word = null; room.hint = ''; room.guessed = new Set(); room.strokes = [];
  io.to(room.id).emit('round_start', { round: room.round, totalRounds: room.totalRounds || room.settings.rounds * eligible.length, drawerId: room.drawerId, wordOptions: shuffle(WORDS).slice(0,room.settings.wordCount), drawTime: room.settings.drawTime });
  io.to(room.id).emit('canvas_reset'); emitState(room);
}
function shuffle(arr) { return [...arr].sort(() => Math.random() - .5); }
app.get('/health', (_,res) => res.json({ ok:true, service:'Skribbl Clone API' }));

io.on('connection', socket => {
  const emitPublicRooms = () => io.emit('public_rooms', [...rooms.values()].filter(r => r.settings.isPublic && r.phase === 'lobby' && r.players.length < r.settings.maxPlayers).map(r => ({ id:r.id, count:r.players.length, maxPlayers:r.settings.maxPlayers, host:r.players[0]?.name || 'Host' })));
  socket.on('list_public_rooms', () => socket.emit('public_rooms', [...rooms.values()].filter(r => r.settings.isPublic && r.phase === 'lobby' && r.players.length < r.settings.maxPlayers).map(r => ({ id:r.id, count:r.players.length, maxPlayers:r.settings.maxPlayers, host:r.players[0]?.name || 'Host' }))));
  socket.on('create_room', ({ hostName, settings = {} } = {}, cb = () => {}) => {
    const name = String(hostName || '').trim().slice(0,20);
    if (!name) return cb({ error:'Enter your name first.' });
    const id = makeId();
    const room = { id, hostId:socket.id, settings:{ maxPlayers: clamp(settings.maxPlayers,2,20,8), rounds:clamp(settings.rounds,2,10,3), drawTime:clamp(settings.drawTime,15,240,60), wordCount:clamp(settings.wordCount,1,5,3), isPublic:!!settings.isPublic }, players:[], phase:'lobby', round:0, drawerId:null, word:null, hint:'', guessed:new Set(), strokes:[], messages:[], timeLeft:0, timer:null };
    rooms.set(id, room); const player = { id:socket.id, name, score:0, ready:true }; room.players.push(player); socket.join(id); socket.data.roomId=id;
    cb({ roomId:id }); emitState(room); emitPublicRooms();
  });
  socket.on('join_room', ({ roomId, playerName } = {}, cb = () => {}) => {
    const id = String(roomId || '').trim().toUpperCase(); const name = String(playerName || '').trim().slice(0,20); const room = rooms.get(id);
    if (!name) return cb({ error:'Enter your name first.' });
    if (!room) return cb({ error:'Room not found. Check the code.' });
    if (room.phase !== 'lobby') return cb({ error:'This game has already started.' });
    if (room.players.length >= room.settings.maxPlayers) return cb({ error:'Room is full.' });
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return cb({ error:'That name is already in use.' });
    room.players.push({ id:socket.id, name, score:0, ready:false }); socket.join(id); socket.data.roomId=id; cb({ roomId:id });
    room.messages.push({ system:true, text:`${name} joined the room` }); emitState(room); io.to(id).emit('chat_update', room.messages.slice(-40)); emitPublicRooms();
  });
  // Room settings are authoritative on the server. Only the host may update them, and only before the game starts.
  socket.on('update_room_settings', (settings = {}, cb = () => {}) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return cb({ error: 'Room not found.' });
    if (room.hostId !== socket.id) return cb({ error: 'Only the host can change room settings.' });
    if (room.phase !== 'lobby') return cb({ error: 'Settings are locked after the game starts.' });
    room.settings = {
      ...room.settings,
      maxPlayers: clamp(settings.maxPlayers, 2, 20, room.settings.maxPlayers),
      rounds: clamp(settings.rounds, 2, 10, room.settings.rounds),
      drawTime: clamp(settings.drawTime, 15, 240, room.settings.drawTime),
      wordCount: clamp(settings.wordCount, 1, 5, room.settings.wordCount),
      hintCount: clamp(settings.hintCount, 0, 5, room.settings.hintCount ?? 2),
      isPublic: typeof settings.isPublic === 'boolean' ? settings.isPublic : room.settings.isPublic
    };
    cb({ ok: true }); emitState(room); emitPublicRooms();
  });
  socket.on('toggle_ready', () => { const room=rooms.get(socket.data.roomId); const player=room?.players.find(p=>p.id===socket.id); if(!room||!player||room.phase!=='lobby') return; player.ready=!player.ready; emitState(room); });
  socket.on('start_game', () => { const room=rooms.get(socket.data.roomId); if (!room || room.hostId !== socket.id || room.phase !== 'lobby' || room.players.length < 2 || room.players.some(p=>!p.ready)) return; room.round=0; room.totalRounds=room.settings.rounds*room.players.length; room.players.forEach(p=>p.score=0); nextRound(room); emitPublicRooms(); });
  socket.on('play_again', (cb = () => {}) => {
  const room = rooms.get(socket.data.roomId);

  if (!room) return cb({ error: 'Room not found.' });
  if (room.hostId !== socket.id) return cb({ error: 'Only the host can restart.' });
  if (room.phase !== 'gameOver') return cb({ error: 'Game is not over yet.' });
  if (room.players.length < 2) return cb({ error: 'At least 2 players are required.' });

  room.players.forEach(p => {
    p.score = 0;
    p.ready = true;
  });

  room.round = 0;
  room.totalRounds = room.settings.rounds * room.players.length;
  room.word = null;
  room.hint = '';
  room.guessed = new Set();
  room.strokes = [];
  room.messages = [];
  room.drawerId = null;

  cb({ ok: true });
  io.to(room.id).emit('canvas_reset');
  nextRound(room);
});
  socket.on('choose_word', ({ word } = {}) => { const room=rooms.get(socket.data.roomId); if (!room || room.phase !== 'choosing' || room.drawerId !== socket.id || !WORDS.includes(String(word).toUpperCase())) return; room.word=String(word).toUpperCase(); room.phase='playing'; room.hint=hintFor(room.word, 0); socket.emit('your_word', room.word); io.to(room.id).emit('word_hint', { hint:room.hint, length:room.word.length }); emitState(room); startTimer(room); });
  socket.on('draw_data', stroke => { const room=rooms.get(socket.data.roomId); if (!room || room.phase !== 'playing' || room.drawerId !== socket.id || !stroke || !['start','move','end'].includes(stroke.type)) return; const safe={ type:stroke.type, x:Number(stroke.x), y:Number(stroke.y), color:String(stroke.color||'#111827').slice(0,20), size:Math.max(1,Math.min(30,Number(stroke.size)||4)) }; if (![safe.x,safe.y].every(Number.isFinite) || safe.x<0 || safe.x>1 || safe.y<0 || safe.y>1) return; if (safe.type === 'start') room.strokes.push({ ...safe, strokeStart:true }); else room.strokes.push(safe); if(room.strokes.length>5000) room.strokes.shift(); socket.to(room.id).emit('draw_data',safe); });
  socket.on('draw_undo', () => { const room=rooms.get(socket.data.roomId); if (!room || room.phase!=='playing' || room.drawerId!==socket.id) return; let start=room.strokes.length-1; while(start>=0 && !room.strokes[start].strokeStart) start--; if(start>=0) room.strokes.splice(start); io.to(room.id).emit('canvas_redraw', room.strokes.map(({strokeStart,...st})=>st)); });
  socket.on('canvas_clear', () => { const room=rooms.get(socket.data.roomId); if (!room || room.phase!=='playing' || room.drawerId!==socket.id) return; room.strokes=[]; io.to(room.id).emit('canvas_reset'); });
  socket.on('guess', ({ text } = {}) => { const room=rooms.get(socket.data.roomId); const player=room?.players.find(p=>p.id===socket.id); if(!room || !player || room.phase!=='playing' || room.drawerId===socket.id || room.guessed.has(socket.id)) return; const guess=String(text||'').trim().toLowerCase(); if(!guess) return; if(guess===room.word.toLowerCase()) { room.guessed.add(socket.id); const points=Math.max(10, Math.round((room.timeLeft / room.settings.drawTime)*100)); player.score+=points; const msg={ system:true, text:`${player.name} guessed the word! (+${points})` }; room.messages.push(msg); io.to(room.id).emit('chat_message',msg); io.to(room.id).emit('guess_correct',{playerId:socket.id,playerName:player.name,points}); emitState(room); if(room.guessed.size >= room.players.length-1) endRound(room); } else { const msg={ playerId:socket.id, playerName:player.name, text:String(text).slice(0,120) }; room.messages.push(msg); io.to(room.id).emit('chat_message',msg); } });
  socket.on('chat', ({ text } = {}) => { const room=rooms.get(socket.data.roomId); const player=room?.players.find(p=>p.id===socket.id); const value=String(text||'').trim().slice(0,120); if(!room||!player||!value||room.phase==='playing') return; const msg={playerId:socket.id,playerName:player.name,text:value}; room.messages.push(msg); io.to(room.id).emit('chat_message',msg); });
  socket.on('disconnect', () => { const id=socket.data.roomId; const room=rooms.get(id); if(!room) return; room.players=room.players.filter(p=>p.id!==socket.id); if(room.players.length===0){stopTimer(room);rooms.delete(id);emitPublicRooms();return;} if(room.hostId===socket.id) room.hostId=room.players[0].id; if(room.drawerId===socket.id && room.phase==='playing') endRound(room); else if(room.drawerId===socket.id && room.phase==='choosing') nextRound(room); emitState(room); emitPublicRooms(); });
});
function clamp(v,min,max,def){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):def;}
server.listen(PORT, () => console.log(`Skribbl Clone server listening on ${PORT}`));
