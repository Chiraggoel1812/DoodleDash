# DoodleDash — Skribbl.io Clone

A real-time multiplayer drawing & guessing game. React + TypeScript + Vite (frontend), Node.js + Express + Socket.IO (backend), HTML5 Canvas for drawing.

**Live demo:** https://doodledash-frontend-fgbs.onrender.com/
(Render free tier sleeps after inactivity — the first load can take ~50 seconds while the backend wakes up.)

## Features

**Rooms & lobby**
- Create a room with settings: max players (2–20), rounds (2–10), draw time (15–240 s), word choices (1–5), hints (0–5 / disabled), word mode (**Normal / Hidden / Combination**), word category and **word language** (English, Español, Français, Deutsch, Hindi-Roman).
- Join by room code or invite link (`/?room=CODE`). Private by default; the host can list a room publicly (public-room browser on the landing page).
- Lobby with player list, ready-up, host-only start, host can edit settings in the lobby, host can kick, and players can **vote-kick** (majority of the other players, min. 3 players; kicked names can't rejoin).
- Players can join a game already in progress (they get the current canvas), and a refresh / network drop **reconnects** to the same seat (kept for 30 s).

**Game flow**
- Fixed random turn order — everyone draws `rounds` times. Drawer picks 1 of N words (auto-picks after 15 s).
- Real-time canvas sync over WebSockets; hints reveal random letters over time; countdown timer.
- Round ends when time runs out or everyone guessed. Game over shows winner(s), ties and the full leaderboard; host can "Play again".
- Scoring: guesser gets `timeLeft / drawTime * 100` (min 10); the drawer gets half of every correct guesser's points.

**Drawing tools:** pen, 10 colours, brush size, eraser, undo last stroke, clear canvas (drawer only).

**Chat & guessing:** guesses are matched case-insensitively with trimmed/collapsed whitespace; "close" guesses (1 typo or a partial word) get a private "is close!" hint without leaking to others; players who already guessed chat privately with the drawer/other guessers; lobby & round-break chat.

**Words:** `words.json` — 5 languages × 7 categories (animals, food, objects, vehicles, actions, places, nature). Combination mode glues two words together (e.g. `TIGER PIZZA`). Guess matching ignores accents, so `avión` matches `AVION`.

## Run locally

Requires Node.js 20+.

```bash
npm install
npm --prefix client install
npm run dev
```

Open `http://localhost:5173` in two browser windows (or one normal + one incognito), create a room in one and join with the code in the other. The backend runs on `http://localhost:3001`.

## Deploy on Render

`render.yaml` defines two services:

1. **doodledash-skribbl-api** (Web Service, Node): build `npm install`, start `npm start`, health check `/health`.
   Set `CLIENT_ORIGIN` = the frontend URL (e.g. `https://doodledash-frontend-fgbs.onrender.com`, no trailing slash).
2. **doodledash-frontend** (Static Site): build `cd client && npm install --include=dev && npm run build`, publish `client/dist`, add a rewrite `/* → /index.html`.
   Set `VITE_SERVER_URL` = the backend URL, then **redeploy** (Vite bakes env vars in at build time).

Alternative (single service): build `npm run build`, start `npm start` — the Express server serves `client/dist` itself, so no `VITE_SERVER_URL`/CORS setup is needed.

> The backend must be a persistent Node service with WebSocket support — not a serverless function (Vercel/Netlify functions can't hold Socket.IO connections). The frontend can live on any static host.

## Architecture

```
Browser (React)  ──Socket.IO──►  Node/Express server  (authoritative game state, in memory)
  canvas + UI  ◄──────────────   rooms Map → players, turn order, word, timers, strokes
```

- **Drawing:** the drawer captures pointer events, normalises coordinates to 0–1 (so canvases of different sizes line up), paints locally and emits `draw_data {type: start|move|end, x, y, color, size}`. The server validates & stores the stroke list and relays it to the other players, who paint segment-by-segment. Every client keeps the stroke list, so the canvas is re-rendered crisply after a resize. **Undo** removes the last stroke on the server and broadcasts `canvas_redraw` with the full list; **clear** broadcasts `canvas_reset`.
- **Game state:** `room.phase` = `lobby → choosing → playing → roundEnd → (next turn…) → gameOver`. `nextRound()` picks the next drawer from `turnOrder`, `chooseWord()` starts the timer, `endRound()` / `endGame()` close things out. The secret word is never part of `room_state`; the drawer receives options (`word_options`) and the chosen word (`your_word`) privately.
- **Word matching:** `norm()` = trim + lowercase + collapse spaces; exact match scores. `isClose()` = edit distance ≤ 1, or a ≥3-letter partial of the word → private "close" hint.
- **Events (as suggested in the assignment):** client → server: `create_room`, `join_room`, `start_game`, `word_chosen`, `draw_start`, `draw_move`, `draw_end`, `canvas_clear`, `draw_undo`, `guess`, `chat`; server → clients: `player_joined`, `player_left`, `game_state`, `round_start`, `round_end` (with `nextDrawer`), `game_over`, `draw_data`, `guess_result`, `chat_message`. Extra events: `room_state`, `update_room_settings`, `toggle_ready`, `play_again`, `kick_player`, `votekick`, `leave_room`, `your_word`, `word_hint`, `timer`, `close_guess`, `canvas_reset`, `canvas_redraw`, `public_rooms`, `kicked`, `hello`.
- **Reconnect:** each browser tab keeps a private session token (`sessionStorage`) sent in the socket handshake. The server maps token → player, so a returning socket resumes the same player (and the drawer gets the secret word and canvas back). Other players only ever see a separate public player id.

## Known limitations
- State is in memory: a backend restart clears active rooms.
- Reconnect works per browser tab (session token in `sessionStorage`); closing the tab for more than 30 s frees the seat.
- A player who joins mid-game is added to the end of the turn order, so they may get fewer drawing turns.
