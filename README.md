# DoodleDash — Skribbl.io Clone

A multiplayer drawing-and-guessing game built for the Web3Taek intern assignment using React, TypeScript, Vite, Node.js, Express and Socket.IO.

## Implemented assignment requirements

- Create rooms with configurable maximum players (2–20), rounds (2–10), draw time (15–240 seconds), and word choices (1–5).
- Join rooms by code or invite URL; private rooms are the default and hosts can publish rooms in the public-room browser.
- Lobby/player list, ready toggle for joining players, and host-only start control; all players must be ready and at least two players are required.
- Rotating drawer turns, word selection, countdown, round transitions and final leaderboard/winner.
- Real-time drawing synchronization using normalized canvas coordinates over Socket.IO.
- Drawing tools: pen, color palette, brush size, eraser, undo last stroke and clear canvas. Canvas uses device-pixel-ratio-aware rendering and normalized coordinates to reduce blurry strokes and keep drawings aligned when resized.
- Guess submission, case-insensitive exact matching, correct-guess notifications and server-side score calculation.
- Host-configurable hints (disabled or 1–5 progressive reveals during the round).
- Chat in the lobby/round-break phases; guesses are sent during active gameplay.
- Responsive layout and `/health` backend endpoint.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

From the project root:

```bash
npm install
npm --prefix client install
npm run dev
```

Open `http://localhost:5173` in two separate browser windows (or one normal and one incognito window). Use different nicknames, create a room in one window, then join the room code in the other. The API/WebSocket server defaults to `http://localhost:3001`.

If the frontend is deployed separately, set `VITE_SERVER_URL` to the public backend URL before building the frontend. Set backend `CLIENT_ORIGIN` to the frontend's exact origin. The backend must run as a persistent Node service with WebSocket support; do not deploy the Socket.IO server as a serverless function.

## Deployment checklist

1. Push this repository to GitHub.
2. Deploy the root backend as a persistent Node service (Render or Railway): build command `npm install`, start command `npm start`.
3. Set `CLIENT_ORIGIN` to the deployed frontend URL.
4. Deploy `client` as a static site: build command `npm install && npm run build`, publish directory `dist`.
5. Set `VITE_SERVER_URL` to the backend URL and rebuild/redeploy the frontend.
6. Open the live site in two separate browsers/devices and test create room → join → ready-up → start → draw → guess → score → game over. Also test invite links, public room listing, drawing after canvas resize, brush colors/sizes, eraser, undo, clear, each hint setting, and the minimum/maximum allowed room settings.
7. Replace this section with the verified live URL before submitting. Do not claim a live URL until it has been deployed and tested.

## Architecture overview

- `client/src/App.tsx`: lobby, room settings, canvas, drawing tools, chat and leaderboard UI.
- `server.js`: authoritative room state, player membership, turn order, word secrecy, timer, hints and scoring.
- Socket.IO events carry room state, drawing strokes, guesses, chat, timer updates and canvas undo/reset operations.
- Canvas coordinates are normalized to 0–1 so drawings scale across screen sizes.

## Verification status

- `node --check server.js` passes in the build workspace.
- The frontend dependency installation timed out in this workspace, so a full Vite production build and browser end-to-end test could not be completed here. Run the validation checklist below on the target machine before submitting.
- No live deployment URL has been created or verified yet.

## Known operational limitations to understand before submission

- Rooms and scores are held in server memory; restarting/redeploying the backend clears active rooms.
- The current word list is a built-in sample list rather than a database-backed category system.
- Public room discovery is in-memory and intended for this assignment's scale, not a large production service.
- The app still requires local and deployed end-to-end testing in your environment; this repository does not include a pre-verified live deployment URL.

## Interview walkthrough topics

Be ready to explain the `create_room`, `join_room`, `start_game`, `round_start`, `choose_word`, `draw_data`, `draw_undo`, `guess`, `round_end` and `game_over` events; server-authoritative scoring; word secrecy; normalized canvas coordinates; and why a persistent WebSocket backend is needed.
