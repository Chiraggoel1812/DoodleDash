# DoodleDash — Skribbl.io Clone

A real-time multiplayer drawing and guessing game inspired by Skribbl.io.

**Tech Stack:** React, TypeScript, Vite, Node.js, Express, Socket.IO and HTML5 Canvas.

**Live Demo:** https://doodledash-frontend-fgbs.onrender.com/

> **Note:** The Render free tier may spin down the backend after inactivity. The first request can take approximately 50 seconds while the server wakes up.

---

## Features

### 1. Rooms & Lobby

- Create multiplayer rooms with customizable settings.
- Maximum players: 2–20.
- Rounds: 2–10.
- Drawing time: 15–240 seconds.
- Word choices: 1–5.
- Hints: 0–5 or disabled.
- Word modes: Normal, Hidden and Combination.
- Word categories and language selection.
- Supported languages: English, Español, Français, Deutsch and Hindi-Roman.
- Join rooms using a room code or invitation link.
- Private rooms by default, with an option to list rooms publicly.
- Public room browser on the landing page.
- Lobby with player list and ready-up functionality.
- Only the host can start the game.
- Host can update settings and kick players.
- Vote-kick functionality with majority voting (minimum 3 players).
- Kicked players cannot rejoin the same room.
- Players can join an ongoing game and receive the current canvas.
- Reconnection restores the same player seat after a refresh or network interruption (30-second retention).

### 2. Game Flow

- Fixed random turn order.
- Every player gets drawing turns according to the configured rounds.
- Drawer selects one word from the available choices.
- Automatic word selection after 15 seconds.
- Real-time canvas synchronization using WebSockets.
- Hints reveal random letters over time.
- Countdown timer for each drawing turn.
- Round ends when time runs out or everyone guesses correctly.
- Game-over screen displays winner, ties and leaderboard.
- Host can start another game using Play Again.

### 3. Drawing Tools

- Pen/brush tool.
- 10 drawing colours.
- Adjustable brush size.
- Eraser.
- Undo last stroke.
- Clear canvas.
- Drawing controls are available to the active drawer.

### 4. Chat & Guessing

- Real-time room chat and word guessing.
- Case-insensitive answer matching.
- Leading/trailing whitespace and repeated spaces are normalized.
- Close guesses receive a private "is close!" hint.
- Close guesses do not reveal information to other players.
- Players who have already guessed can chat privately with the drawer and other correct guessers.
- Lobby and round-break chat support.

### 5. Word System

- Word data is stored in `words.json`.
- Five supported languages.
- Seven categories:
  - Animals
  - Food
  - Objects
  - Vehicles
  - Actions
  - Places
  - Nature
- Combination mode combines two words (for example, `TIGER PIZZA`).
- Guess matching ignores accents, so `avión` can match `AVION`.

### 6. Scoring System

- Correct guesser receives points based on remaining drawing time.
- Formula: `(timeLeft / drawTime) * 100`.
- Minimum points for a correct guess: 10.
- Drawer receives half of the points awarded to each correct guesser.
- Leaderboard updates during gameplay.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React |
| Language | TypeScript |
| Build Tool | V
