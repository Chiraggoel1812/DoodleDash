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

### Deployment
