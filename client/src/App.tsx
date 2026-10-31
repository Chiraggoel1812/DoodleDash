import { useCallback, useEffect, useRef, useState, FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import { Brush, Clock3, Crown, Eraser, Link2, LogIn, Palette, Pencil, Play, Plus, Send, Sparkles, Trophy, Users, X, Undo2, Globe2, LockKeyhole, UserX } from 'lucide-react';

type Player = { id: string; name: string; score: number; ready: boolean; connected: boolean };
type Message = { system?: boolean; private?: boolean; playerId?: string; playerName?: string; text: string };
type Settings = { maxPlayers: number; rounds: number; drawTime: number; wordCount: number; hintCount: number; isPublic: boolean; category: string; wordMode: 'normal' | 'hidden' | 'combination'; language: string };
type Room = { id: string; hostId: string; settings: Settings; phase: string; round: number; totalRounds: number; drawerId: string | null; wordLength: number; hint: string; players: Player[]; timeLeft: number; messages: Message[] };
type Stroke = { type: 'start' | 'move' | 'end'; x: number; y: number; color: string; size: number };
type GameOver = { leaderboard: { rank: number; name: string; score: number }[]; winners: string[]; tie: boolean };
type RoundEnd = { word: string; nextDrawer: string | null; scores: { id: string; name: string; score: number; gained: number }[] };
const LANGUAGES: Record<string, string> = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', hi: 'Hindi (Roman)' };

/** Private per-tab session token: lets the server restore this player after a refresh / network drop. */
function getSessionId(): string {
  try {
    let id = sessionStorage.getItem('dd_session');
    if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(18)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 32); sessionStorage.setItem('dd_session', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
}

// Dev: backend on :3001. Production: VITE_SERVER_URL if set, otherwise the same origin that served the page.
const SOCKET_URL: string = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);
const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const CATEGORIES = ['all', 'animals', 'food', 'objects', 'vehicles', 'actions', 'places', 'nature'];
const DEFAULTS: Settings = { maxPlayers: 8, rounds: 3, drawTime: 60, wordCount: 3, hintCount: 2, isPublic: false, category: 'all', wordMode: 'normal', language: 'en' };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Settings form used both on the landing page (new room) and in the lobby (host editing). */
function SettingsForm({ value, onChange, disabled }: { value: Settings; onChange: (s: Settings) => void; disabled?: boolean }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="settings-grid">
        <label>Players<select disabled={disabled} value={value.maxPlayers} onChange={e => set('maxPlayers', Number(e.target.value))}>{range(2, 20).map(n => <option key={n} value={n}>{n} players</option>)}</select></label>
        <label>Rounds<select disabled={disabled} value={value.rounds} onChange={e => set('rounds', Number(e.target.value))}>{range(2, 10).map(n => <option key={n} value={n}>{n} rounds</option>)}</select></label>
        <label>Draw time (sec)<input disabled={disabled} type="number" min={15} max={240} value={value.drawTime} onChange={e => set('drawTime', Math.max(15, Math.min(240, Number(e.target.value) || 15)))} /></label>
        <label>Word choices<select disabled={disabled} value={value.wordCount} onChange={e => set('wordCount', Number(e.target.value))}>{range(1, 5).map(n => <option key={n} value={n}>{n} {n === 1 ? 'word' : 'words'}</option>)}</select></label>
        <label>Hints<select disabled={disabled} value={value.hintCount} onChange={e => set('hintCount', Number(e.target.value))}><option value={0}>Disabled</option>{range(1, 5).map(n => <option key={n} value={n}>{n} {n === 1 ? 'hint' : 'hints'}</option>)}</select></label>
        <label>Word mode<select disabled={disabled} value={value.wordMode} onChange={e => set('wordMode', e.target.value as Settings['wordMode'])}><option value="normal">Normal</option><option value="hidden">Hidden (no blanks)</option><option value="combination">Combination (2 words)</option></select></label>
        <label>Language<select disabled={disabled} value={value.language} onChange={e => set('language', e.target.value)}>{Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Category<select disabled={disabled} value={value.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c}>{c === 'all' ? 'All words' : c[0].toUpperCase() + c.slice(1)}</option>)}</select></label>
      </div>
      <label className="visibility-toggle"><input disabled={disabled} type="checkbox" checked={value.isPublic} onChange={e => set('isPublic', e.target.checked)} /> <Globe2 size={14} /> List this room publicly</label>
    </>
  );
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);       // every stroke of the current turn; lets us re-render crisply after a resize / undo
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const drawing = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const resumedRef = useRef(true);

  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState('');
  const [name, setName] = useState('');
  const [newSettings, setNewSettings] = useState<Settings>(DEFAULTS);
  const [publicRooms, setPublicRooms] = useState<{ id: string; count: number; maxPlayers: number; host: string }[]>([]);
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState('');
  const [wordOptions, setWordOptions] = useState<string[]>([]);
  const [word, setWord] = useState('');
  const [roundEnd, setRoundEnd] = useState<RoundEnd | null>(null);
  const [gameOver, setGameOver] = useState<GameOver | null>(null);
  const [guess, setGuess] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [brushSize, setBrushSize] = useState(5);
  const [eraser, setEraser] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [copied, setCopied] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isHost = !!room && room.hostId === myId;
  const isDrawer = !!room && room.drawerId === myId;
  const me = room?.players.find(p => p.id === myId);

  /* ------------------------- canvas rendering ------------------------- */
  const paint = useCallback((st: Stroke, last: { x: number; y: number } | null) => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const rect = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    const x = st.x * rect.width, y = st.y * rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = st.color; ctx.lineWidth = st.size;
    if (st.type === 'start') { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); return { x, y }; }
    if (st.type === 'move' && last) { ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x, y); ctx.stroke(); return { x, y }; }
    return null;                                                            // 'end'
  }, []);

  const renderAll = useCallback(() => {
    const canvas = canvasRef.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    let last: { x: number; y: number } | null = null;
    strokesRef.current.forEach(st => { last = paint(st, last); });
  }, [paint]);

  const addStroke = useCallback((st: Stroke) => {
    strokesRef.current.push(st);
    lastPt.current = paint(st, lastPt.current);
  }, [paint]);

  const resetCanvas = useCallback(() => { strokesRef.current = []; lastPt.current = null; renderAll(); }, [renderAll]);

  /* ------------------------- socket wiring ------------------------- */
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ['websocket', 'polling'], auth: { sessionId: getSessionId() } });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true); s.emit('list_public_rooms');
      if (roomIdRef.current) {      // we were in a room: the server should resume us — if it doesn't (restart / expired), go back to the landing page
        resumedRef.current = false;
        setTimeout(() => { if (!resumedRef.current) { setRoom(null); roomIdRef.current = null; setMessages([]); setError('Your previous room is no longer available.'); } }, 3000);
      }
    });
    s.on('disconnect', () => setConnected(false));          // keep the room on screen; the server holds our seat for 30s
    s.on('hello', (d: { playerId: string }) => setMyId(d.playerId));
    s.on('public_rooms', (r: any[]) => setPublicRooms(r || []));
    s.on('room_state', (r: Room) => {
      resumedRef.current = true;
      if (roomIdRef.current !== r.id) { roomIdRef.current = r.id; setMessages(r.messages || []); }   // chat history only on first state
      setRoom(r);
      if (r.phase === 'lobby') { setGameOver(null); setRoundEnd(null); setWord(''); setWordOptions([]); }
    });
    s.on('chat_message', (m: Message) => setMessages(prev => [...prev, m].slice(-100)));
    s.on('close_guess', (d: { text: string }) => setMessages(prev => [...prev, { system: true, text: `“${d.text}” is close!` }]));
    s.on('timer', (n: number) => setRoom(prev => (prev ? { ...prev, timeLeft: n } : prev)));
    s.on('word_hint', (d: any) => setRoom(prev => (prev ? { ...prev, hint: d.hint, wordLength: d.length } : prev)));
    s.on('round_start', (d: { wordOptions?: string[] }) => { setWordOptions(d?.wordOptions || []); setWord(''); setRoundEnd(null); });
    s.on('word_options', (o: string[]) => setWordOptions(o || []));
    s.on('your_word', (w: string) => { setWord(w); setWordOptions([]); });
    s.on('draw_data', addStroke);
    s.on('canvas_reset', resetCanvas);
    s.on('canvas_redraw', (strokes: Stroke[]) => { strokesRef.current = strokes || []; lastPt.current = null; renderAll(); });
    s.on('round_end', (d: RoundEnd) => { setRoundEnd(d); setWordOptions([]); setWord(''); });
    s.on('game_over', (d: GameOver) => { setGameOver(d); setWordOptions([]); setWord(''); });
    s.on('kicked', (d: { byVote?: boolean }) => { setRoom(null); roomIdRef.current = null; setMessages([]); setError(d?.byVote ? 'You were vote-kicked from the room.' : 'You were removed from the room by the host.'); });
    return () => { s.disconnect(); };
  }, [addStroke, resetCanvas, renderAll]);

  // Keep the canvas bitmap sized to its box (HiDPI aware) and redraw from stored strokes.
  useEffect(() => {
    const c = canvasRef.current; if (!room || !c) return;
    const resize = () => {
      const rect = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(rect.width * dpr)); c.height = Math.max(1, Math.round(rect.height * dpr));
      renderAll();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    return () => ro.disconnect();
  }, [room?.id, renderAll]);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { const code = new URLSearchParams(location.search).get('room'); if (code) setRoomCode(code.toUpperCase().slice(0, 5)); }, []);

  /* ------------------------- actions ------------------------- */
  const emit = (ev: string, payload?: any, cb?: (r: any) => void) => socketRef.current?.emit(ev, payload, cb);
  const createRoom = (e: FormEvent) => { e.preventDefault(); setError(''); emit('create_room', { hostName: name, settings: newSettings }, (r: any) => { if (r?.error) setError(r.error); }); };
  const joinRoom = (e: FormEvent) => { e.preventDefault(); setError(''); emit('join_room', { roomId: roomCode, playerName: name }, (r: any) => { if (r?.error) setError(r.error); }); };
  const updateSettings = (s: Settings) => emit('update_room_settings', s, (r: any) => { if (r?.error) setError(r.error); });
  const sendGuess = (e: FormEvent) => { e.preventDefault(); if (!guess.trim()) return; emit(room?.phase === 'playing' ? 'guess' : 'chat', { text: guess }); setGuess(''); };
  const leave = () => { emit('leave_room'); setRoom(null); roomIdRef.current = null; setMessages([]); window.history.replaceState({}, '', location.pathname); setRoomCode(''); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${room?.id}`); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError('Copy failed. Share room code: ' + room?.id); }
  };

  /* ------------------------- drawing input ------------------------- */
  const pointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current; if (!c || !isDrawer || room?.phase !== 'playing') return null;
    const r = c.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const strokeOf = (type: Stroke['type'], p: { x: number; y: number }): Stroke => ({ type, ...p, color: eraser ? '#ffffff' : color, size: eraser ? brushSize * 3 : brushSize });
  // Spec events: draw_start {x,y,color,size} · draw_move {x,y} · draw_end {}
  const send = (st: Stroke) => {
    addStroke(st);
    if (st.type === 'start') emit('draw_start', st);
    else if (st.type === 'move') emit('draw_move', { x: st.x, y: st.y });
    else emit('draw_end', { x: st.x, y: st.y });
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { const p = pointer(e); if (!p) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; send(strokeOf('start', p)); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const p = pointer(e); if (p) send(strokeOf('move', p)); };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; drawing.current = false; const p = pointer(e) || { x: 0, y: 0 }; send(strokeOf('end', p)); };

  /* ============================ landing page ============================ */
  if (!room) return (
    <main className="landing">
      <nav className="topbar"><div className="brand"><span className="brand-mark"><Pencil size={21} /></span><span>Doodle<span className="brand-accent">Dash</span></span></div><div className="connection"><i className={connected ? 'online' : ''} />{connected ? 'Server connected' : 'Connecting to server… (first load can take ~50s)'}</div></nav>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={14} /> THE MULTIPLAYER DRAWING GAME</div>
          <h1>Draw it.<br /><span>Guess it.</span><br />Own the leaderboard.</h1>
          <p>Grab your friends, pick a word, and turn questionable drawings into legendary guesses.</p>
          <div className="hero-points"><span><Users size={16} /> 2–20 players</span><span><Clock3 size={16} /> Real-time rounds</span><span><Trophy size={16} /> Live scores</span></div>
          <div className="doodle-decoration doodle-star">✳</div><div className="doodle-decoration doodle-squiggle">〰</div>
        </div>
        <div className="join-card">
          <div className="card-icon"><Brush size={25} /></div>
          <h2>Ready to doodle?</h2><p>Create a room or jump into one with a code.</p>
          <form onSubmit={createRoom} className="form-stack">
            <label>Your nickname</label>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="e.g. Picasso Jr." required />
            <div className="settings-help">These settings apply to a new room — the host can still change them in the lobby.</div>
            <SettingsForm value={newSettings} onChange={setNewSettings} />
            <button className="primary-btn" type="submit" disabled={!connected}><Plus size={18} /> Create a room</button>
          </form>
          <div className="or-divider"><span />JOIN AN EXISTING ROOM<span /></div>
          <p className="join-help">Enter your nickname above and the room code (or open the invite link).</p>
          <form onSubmit={joinRoom} className="join-row">
            <input value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} maxLength={5} placeholder="ROOM CODE" required />
            <button className="dark-btn" type="submit" disabled={!connected}><LogIn size={17} /> Join</button>
          </form>
          {error && <div className="error-text">{error}</div>}
          {publicRooms.length > 0 && <div className="public-rooms"><div className="public-rooms-title"><Globe2 size={14} /> Public rooms</div>
            {publicRooms.slice(0, 4).map(r => <button type="button" key={r.id} onClick={() => { setRoomCode(r.id); if (!name.trim()) { setError('Enter your nickname first, then join a public room.'); return; } setError(''); emit('join_room', { roomId: r.id, playerName: name }, (res: any) => { if (res?.error) setError(res.error); }); }}><span><b>{r.id}</b><small>Host: {r.host}</small></span><small>{r.count}/{r.maxPlayers} players</small></button>)}
          </div>}
          <div className="card-foot"><span className="avatar-stack"><i>🎨</i><i>🦊</i><i>🐸</i></span><span>Good drawings optional. Good vibes mandatory.</span></div>
        </div>
      </section>
      <section className="how-section"><div className="section-label">HOW TO PLAY</div><div className="how-grid">
        <div><span className="step-number">01</span><h3>Pick a word</h3><p>Choose a secret word when it's your turn.</p></div>
        <div><span className="step-number">02</span><h3>Draw your heart out</h3><p>Sketch clues while everyone else races to guess.</p></div>
        <div><span className="step-number">03</span><h3>Claim the crown</h3><p>Guess fast, score points, and top the leaderboard.</p></div>
      </div></section>
      <footer>Made for friends, chaos, and questionable art. <span>✦</span></footer>
    </main>
  );

  /* ============================ game page ============================ */
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const hidden = room.settings.wordMode === 'hidden';
  const status =
    room.phase === 'lobby' ? 'Waiting for players…' :
    room.phase === 'choosing' ? (isDrawer ? 'Choose your word' : 'Drawer is choosing a word…') :
    room.phase === 'playing' ? (isDrawer ? `Your word: ${word || '…'}` : hidden ? `Hidden word (${room.wordLength} letters)` : (room.hint || '_ '.repeat(room.wordLength).trim())) :
    room.phase === 'roundEnd' ? 'Round complete' : room.phase === 'gameOver' ? 'Game over!' : 'Get ready';
  const canStart = room.players.length >= 2 && room.players.every(p => p.ready);

  return (
    <main className="game-page">
      {!connected && <div className="reconnect-banner">Connection lost — reconnecting… your seat is kept for 30 seconds.</div>}
      <header className="game-header">
        <div className="brand"><span className="brand-mark"><Pencil size={20} /></span><span>Doodle<span className="brand-accent">Dash</span></span></div>
        <div className="room-badge">{room.settings.isPublic ? <Globe2 size={13} /> : <LockKeyhole size={13} />} ROOM <strong>{room.id}</strong><button onClick={copyLink} title="Copy invite link"><Link2 size={15} />{copied ? 'Copied!' : 'Invite'}</button></div>
        <div className="header-right"><span className="live-dot" /> Live game <button className="exit-btn" onClick={leave}>Exit</button></div>
      </header>

      <div className="game-layout">
        <aside className="players-panel panel">
          <div className="panel-heading"><span><Users size={17} /> Players</span><b>{room.players.length}/{room.settings.maxPlayers}</b></div>
          <div className="players-list">{sorted.map((p, i) => (
            <div className={`player-row ${p.id === room.drawerId ? 'active-drawer' : ''}`} key={p.id}>
              <span className="rank">{i === 0 && p.score > 0 ? <Crown size={15} /> : String(i + 1).padStart(2, '0')}</span>
              <span className="player-avatar">{['🦊', '🐸', '🐼', '🐯', '🐙', '🐵'][i % 6]}</span>
              <span className="player-name">{p.name}{p.id === myId ? ' (you)' : ''}{p.id === room.hostId && <small>HOST</small>}{room.phase === 'lobby' && p.id !== room.hostId && <small>{p.ready ? 'READY' : 'NOT READY'}</small>}{p.id === room.drawerId && <small>DRAWING</small>}{!p.connected && <small>OFFLINE</small>}</span>
              <strong>{p.score}</strong>
              {isHost && p.id !== myId && <button className="kick-btn" title={`Remove ${p.name}`} onClick={() => { if (confirm(`Remove ${p.name} from the room?`)) emit('kick_player', { playerId: p.id }); }}><UserX size={14} /></button>}
              {!isHost && p.id !== myId && p.id !== room.hostId && room.players.length >= 3 && <button className="kick-btn" title={`Vote to kick ${p.name}`} onClick={() => { if (confirm(`Vote to kick ${p.name}?`)) emit('votekick', { playerId: p.id }); }}><UserX size={14} /></button>}
            </div>))}
          </div>
          <div className="score-note"><Trophy size={15} /> Faster guesses earn more. Drawers earn too!</div>
        </aside>

        <section className="center-stage">
          <div className="round-bar">
            <div><span className="round-label">TURN</span><strong>{Math.max(room.round, 1)} <small>/ {room.totalRounds || room.settings.rounds * room.players.length}</small></strong></div>
            <div className={`word-display ${isDrawer ? 'your-word' : ''}`}>{status}</div>
            <div className="timer"><Clock3 size={17} /><strong>{room.phase === 'playing' ? room.timeLeft : room.settings.drawTime}s</strong></div>
          </div>

          {room.phase === 'choosing' && isDrawer && <div className="word-picker"><h3>Choose a word to draw</h3><p>Keep it secret — pick within 15 seconds.</p><div>{wordOptions.map(w => <button key={w} onClick={() => emit('choose_word', { word: w })}>{w}</button>)}</div></div>}

          {room.phase === 'lobby' && <div className="lobby-notice">
            <div className="lobby-illustration">🎨</div><h2>Waiting for the crew</h2>
            <p>Share the room code <b>{room.id}</b> or the invite link with your friends.</p>
            <div className="lobby-summary">{room.settings.rounds} rounds · {room.settings.drawTime}s · {room.settings.wordCount} word choices · {room.settings.hintCount === 0 ? 'no hints' : `${room.settings.hintCount} hints`} · {room.settings.wordMode} · {room.settings.category} · {LANGUAGES[room.settings.language] || 'English'}</div>
            {isHost && <button className="dark-btn" onClick={() => setSettingsOpen(o => !o)}>{settingsOpen ? 'Hide settings' : 'Edit room settings'}</button>}
            {isHost && settingsOpen && <div className="lobby-settings"><SettingsForm value={room.settings} onChange={updateSettings} /></div>}
            {!isHost && <button className="dark-btn" onClick={() => emit('toggle_ready')}>{me?.ready ? 'Mark not ready' : 'I am ready'}</button>}
            {isHost ? <button className="primary-btn" disabled={!canStart} onClick={() => emit('start_game')}><Play size={17} /> Start game ({room.players.length} players)</button> : <span>Waiting for the host to start…</span>}
            {room.players.length < 2 && <small>You need at least 2 players to start.</small>}
            {room.players.length >= 2 && !canStart && isHost && <small>Waiting for everyone to be ready.</small>}
            {error && <div className="error-text">{error}</div>}
          </div>}

          {room.phase === 'gameOver' && <div className="lobby-notice">
            <div className="lobby-illustration">🏆</div><h2>Game over!</h2>
            <p>{gameOver ? (gameOver.tie ? `It's a tie: ${gameOver.winners.join(' & ')}!` : `${gameOver.winners[0]} takes the crown.`) : `${sorted[0]?.name} takes the crown.`}</p>
            <ol className="leaderboard">{(gameOver?.leaderboard || sorted.map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }))).map((e, i) => <li key={i}><span>#{e.rank}</span><b>{e.name}</b><em>{e.score}</em></li>)}</ol>
            {isHost ? <button className="primary-btn" onClick={() => emit('play_again')}>Play again</button> : <span>Waiting for the host to start a new game…</span>}
          </div>}

          {room.phase === 'roundEnd' && <div className="round-notice"><span>THE WORD WAS</span><strong>{roundEnd?.word || 'Revealed!'}</strong>
            {roundEnd && <div className="round-gains">{roundEnd.scores.filter(s => s.gained > 0).map(s => <em key={s.id}>{s.name} +{s.gained}</em>)}</div>}
            <p>{roundEnd?.nextDrawer ? `Next to draw: ${roundEnd.nextDrawer}` : 'Next turn starting soon…'}</p></div>}

          <div className={`canvas-wrap ${room.phase !== 'playing' || !isDrawer ? 'spectator' : ''}`}>
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="drawing-canvas" />
            <div className="canvas-label">{room.phase === 'playing' ? (isDrawer ? 'YOUR CANVAS' : 'WATCH & GUESS') : 'DOODLE CANVAS'}</div>
          </div>

          {isDrawer && room.phase === 'playing' && <div className="drawing-tools">
            <div className="tool-label"><Palette size={15} /> COLORS</div>
            <div className="color-palette">{COLORS.map(c => <button key={c} className={`color-dot ${color === c && !eraser ? 'selected' : ''}`} style={{ background: c }} onClick={() => { setColor(c); setEraser(false); }} aria-label={`Color ${c}`} />)}</div>
            <div className="tool-separator" />
            <button className={`tool-button ${eraser ? 'tool-active' : ''}`} onClick={() => setEraser(!eraser)}><Eraser size={16} /> Eraser</button>
            <button className="tool-button" onClick={() => emit('draw_undo')} title="Undo the last stroke"><Undo2 size={16} /> Undo</button>
            <label className="size-control">Size <input type="range" min="2" max="18" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} /></label>
            <button className="tool-button clear-button" onClick={() => emit('canvas_clear')}><X size={15} /> Clear</button>
          </div>}
        </section>

        <aside className="chat-panel panel">
          <div className="panel-heading"><span>Room chat</span><span className="chat-live"><i /> LIVE</span></div>
          <div className="chat-messages">{messages.map((m, i) => (
            <div className={m.system ? 'system-message' : `chat-message ${m.private ? 'private-message' : ''}`} key={i}>
              {m.system ? <span>{m.text}</span> : <><b>{m.playerName || 'Player'}{m.private ? ' (guessed)' : ''}</b><p>{m.text}</p></>}
            </div>))}<div ref={chatEnd} />
          </div>
          <form className="chat-form" onSubmit={sendGuess}>
            <input value={guess} onChange={e => setGuess(e.target.value)} maxLength={60} placeholder={room.phase === 'playing' ? (isDrawer ? 'Chat disabled while drawing' : 'Type your guess…') : 'Send a message…'} disabled={room.phase === 'playing' && isDrawer} />
            <button disabled={!guess.trim() || (room.phase === 'playing' && isDrawer)} aria-label="Send"><Send size={17} /></button>
          </form>
          <div className="chat-tip">{room.phase === 'playing' && !isDrawer ? '💡 Guess the word to earn points' : 'Be kind. Draw badly. Have fun.'}</div>
        </aside>
      </div>
      <footer className="game-footer">DoodleDash <span>•</span> A real-time drawing game <span>•</span> Have fun, play fair</footer>
    </main>
  );
}
