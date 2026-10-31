# DoodleDash — Real-Time Multiplayer Drawing & Guessing Game

DoodleDash is a real-time multiplayer drawing and guessing game inspired by Skribbl.io. Players join rooms, take turns drawing words, guess drawings, earn points and compete on a live leaderboard.

**Live Demo:** https://doodledash-frontend-fgbs.onrender.com/

**GitHub Repository:** https://github.com/Chiraggoel1812/DoodleDash

> **Note:** The application is hosted on Render's free tier. The backend may sleep after inactivity, so the first load can take approximately 50 seconds while the server wakes up.

---

## 1. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React |
| Programming Language | TypeScript |
| Build Tool | Vite |
| Backend | Node.js |
| Backend Framework | Express |
| Real-Time Communication | Socket.IO |
| Drawing | HTML5 Canvas |
| Styling | CSS |
| Deployment | Render |
| Version Control | Git & GitHub |

---

## 2. Features

### Rooms & Lobby

- Create multiplayer rooms with customizable settings.
- Maximum players: 2–20.
- Rounds: 2–10.
- Drawing time: 15–240 seconds.
- Word choices: 1–5.
- Hints: 0–5 or disabled.
- Word modes: Normal, Hidden and Combination.
- Word category and language selection.
- Five supported languages: English, Español, Français, Deutsch and Hindi-Roman.
- Join rooms using a room code or invitation link.
- Private rooms by default, with an option to list rooms publicly.
- Public room browser.
- Lobby with player list and ready-up functionality.
- Only the host can start the game.
- Host can update settings and kick players.
- Vote-kick functionality with majority voting.
- Players can join an ongoing game and receive the current canvas.
- Reconnection restores the same player seat within 30 seconds.

### Game Flow

- Random turn order.
- Each player gets drawing turns according to the configured rounds.
- Drawer selects one word from the available choices.
- Automatic word selection after 15 seconds.
- Real-time drawing synchronization using WebSockets.
- Hints reveal random letters over time.
- Countdown timer for each drawing turn.
- Round ends when time runs out or everyone guesses correctly.
- Game-over screen displays the winner, ties and full leaderboard.
- Host can start another game using Play Again.

### Drawing Tools

- Pen/brush tool.
- 10 drawing colours.
- Adjustable brush size.
- Eraser.
- Undo last stroke.
- Clear canvas.
- Drawing controls are available to the active drawer.

### Chat & Guessing

- Real-time room chat and word guessing.
- Case-insensitive answer matching.
- Leading and trailing whitespace is removed.
- Repeated spaces are normalized.
- Close guesses receive a private "is close!" hint.
- Close guesses do not reveal information to other players.
- Players who have already guessed can chat privately with the drawer and other correct guessers.
- Lobby and round-break chat support.

### Word System

- Word data is stored in `words.json`.
- Five supported languages.
- Seven word categories:
  - Animals
  - Food
  - Objects
  - Vehicles
  - Actions
  - Places
  - Nature
- Combination mode combines two words (example: `TIGER PIZZA`).
- Guess matching ignores accents, so `avión` can match `AVION`.

### Scoring System

- Correct guessers receive points based on the remaining drawing time.
- Scoring formula:

  `Points = (timeLeft / drawTime) * 100`

- Minimum points for a correct guess: 10.
- Drawer receives half of the points awarded to each correct guesser.
- Leaderboard updates during gameplay.

---

## 3. Run Locally

**Requirements:** Node.js 20+ and npm.

### Step 1: Clone the Repository

```bash
git clone https://github.com/Chiraggoel1812/DoodleDash.git
cd DoodleDash
```

### Step 2: Install Dependencies

Install backend dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix client install
```

### Step 3: Start the Backend

Open the first terminal in the project root directory:

```bash
npm start
```

Backend runs at:

`http://localhost:3001`

### Step 4: Start the Frontend

Open a second terminal in the project root directory:

```bash
npm run dev --prefix client
```

Frontend runs at:

`http://localhost:5173`

### Step 5: Test the Application

1. Open `http://localhost:5173`.
2. Create a room in one browser window.
3. Open another browser window or an incognito window.
4. Join using the room code or invitation link.
5. Ready up and start the game.
6. Test drawing, guessing, scoring and round transitions.

---

## 4. Deployment on Render

The application uses two separate Render services.

### Backend — Web Service

- Runtime: Node.js
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

Environment variable:

```env
CLIENT_ORIGIN=https://doodledash-frontend-fgbs.onrender.com
```

Use the frontend URL without a trailing slash.

### Frontend — Static Site

- Build Command: `cd client && npm install --include=dev && npm run build`
- Publish Directory: `client/dist`

Environment variable:

```env
VITE_SERVER_URL=https://doodledash-mf27.onrender.com
```

Add the following rewrite rule:

```text
Source: /*
Destination: /index.html
Action: Rewrite
```

**Important:** Vite environment variables are included at build time. Redeploy the frontend after changing `VITE_SERVER_URL`.

### Deployment Requirement

The backend must run as a persistent Node.js service with WebSocket support. Serverless functions are not suitable for maintaining Socket.IO connections.

The frontend can be hosted on any compatible static hosting provider.

---

## 5. System Architecture

```text
             ┌──────────────────────────┐
             │      Browser Client      │
             │                          │
             │    React + TypeScript    │
             │                          │
             │       HTML5 Canvas       │
             └────────────┬─────────────┘
                          │
                      Socket.IO
                          │
                          ▼
             ┌──────────────────────────┐
             │      Node.js Server      │
             │                          │
             │        Express           │
             │                          │
             │       Socket.IO           │
             └────────────┬─────────────┘
                          │
                          ▼
             ┌──────────────────────────┐
             │     Game State Manager   │
             │                          │
             │        Rooms Map          │
             │                          │
             │    Players and Turns     │
             │       Secret Words       │
             │      Timers and Scores   │
             │      Drawing Strokes     │
             └──────────────────────────┘
```

### Drawing Synchronization

- The drawer captures pointer events from the HTML5 Canvas.
- Drawing coordinates are normalized between 0 and 1.
- The client emits drawing events through Socket.IO.
- The server validates and stores drawing strokes.
- Other players receive drawing updates in real time.
- Each client maintains a stroke list.
- Canvas is redrawn when its size changes.
- Undo removes the last stroke and broadcasts the updated stroke list.
- Clear canvas resets the drawing for all players.

### Game State Management

The server maintains the authoritative game state in memory.

Game phases:

```text
lobby
  ↓
choosing
  ↓
playing
  ↓
roundEnd
  ↓
next turn
  ↓
gameOver
```

Main game functions:

- `nextRound()` — selects the next drawer.
- `chooseWord()` — starts the drawing timer.
- `endRound()` — ends the current round.
- `endGame()` — finishes the game and calculates the final leaderboard.

The secret word is not included in the public room state. The drawer receives word options and the selected word through private events.

### Word Matching

- `norm()` trims whitespace, converts text to lowercase and collapses repeated spaces.
- Exact matches are accepted.
- `isClose()` checks for a one-character edit distance or a partial word of at least three characters.
- Close guesses generate private hints.

### Reconnection

- Each browser tab stores a private session token in `sessionStorage`.
- The token is sent through the Socket.IO handshake.
- The server maps the token to the corresponding player.
- A returning player can resume the same player seat within the retention period.
- The drawer receives their secret word and the current canvas is restored.
- Other players see a separate public player ID.

---

## 6. Socket.IO Events

### Client to Server

```text
create_room
join_room
start_game
word_chosen
draw_start
draw_move
draw_end
canvas_clear
draw_undo
guess
chat
```

### Server to Client

```text
player_joined
player_left
game_state
round_start
round_end
game_over
draw_data
guess_result
chat_message
```

### Additional Events

```text
room_state
update_room_settings
toggle_ready
play_again
kick_player
votekick
leave_room
your_word
word_hint
timer
close_guess
canvas_reset
canvas_redraw
public_rooms
kicked
hello
```

---

## 7. Project Structure

```text
DoodleDash/
│
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── style.css
│   │   └── vite-env.d.ts
│   │
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── server.js
├── words.json
├── package.json
├── package-lock.json
├── render.yaml
├── .env.example
├── .gitignore
└── README.md
```

---

## 8. Known Limitations

- Game state is stored in server memory. A backend restart clears active rooms and games.
- Reconnection is supported per browser tab through `sessionStorage`.
- Disconnected player seats are retained for 30 seconds.
- Closing a tab for longer than 30 seconds frees the player's seat.
- A player joining an ongoing game is added to the end of the turn order and may receive fewer drawing turns.

---

## 9. Future Improvements

- Persistent game and player statistics.
- Database-backed room and game history.
- Improved moderation and reporting.
- Additional word categories and languages.
- Spectator mode and drawing replay.
- Scalable real-time game infrastructure.

---

## 10. Project Links

**Live Application:**  
https://doodledash-frontend-fgbs.onrender.com/

**GitHub Repository:**  
https://github.com/Chiraggoel1812/DoodleDash

**Backend Service:**  
https://doodledash-mf27.onrender.com

---

## Developer

**Developed by:** Chirag Goel

**Project Name:** DoodleDash

**Project Type:** Full Stack Multiplayer Web Application

**Purpose:** Full Stack Development Assignment
