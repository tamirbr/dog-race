# DOG RACE — Multiplayer Server

Node.js backend for optional online multiplayer: nicknames, friends, lobbies, invites, and matchmaking.

## Quick start

```bash
cd server
npm install
npm start
```

Default port: **3001**. Health check: `GET http://localhost:3001/health`

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP + WebSocket port |
| `CORS_ORIGIN` | `*` | Allowed browser origins |

## Architecture

- **Express** — REST health/ping endpoints for client availability probes
- **Socket.IO** — real-time lobbies, friends, race sync

### Core flows

1. **Session** — on connect, client receives a nickname (`player1234`) and reconnect token stored in `localStorage`.
2. **Friends** — search by nickname, mutual add, online/lobby status in friend list.
3. **Lobby** — up to 5 racers; host picks track, adds/removes bots, kicks players, starts when all humans ready. Empty slots filled with bots at race start.
4. **Invites** — host invites a friend; friend receives `lobby:invite` and can join.
5. **Matchmaking** — `queue:join` waits for 5 humans; after **30s** with ≥2 humans, starts a race with bots filling empty slots and a random map.
6. **Race sync (MVP)** — server broadcasts synchronized `race:start` (track, seed, participants, `startAt`). Clients run local sim for AI/bots; humans broadcast `race:sync` position updates (~10 Hz) and peers interpolate.

### Socket events (summary)

| Client → Server | Server → Client |
|-----------------|-----------------|
| `nickname:rename` | `session:new`, `session:restored` |
| `dog:set` | `friends:list` |
| `friends:request`, `friends:accept`, `friends:decline`, `friends:cancel` | `friends:list`, `friends:requests`, `friends:request` |
| `lobby:invite` (friend id), `lobby:acceptInvite`, `lobby:declineInvite` | `lobby:update`, `lobby:invite`, `lobby:inviteDeclined` |
| `lobby:create`, `lobby:join`, `lobby:leave`, `lobby:invite` | `queue:status` |
| `lobby:setTrack`, `lobby:addBot`, `lobby:removeBot`, `lobby:kick` | `race:start`, `race:rejoin` |
| `lobby:ready`, `lobby:start` | `race:peer` |
| `queue:join`, `queue:leave` | |
| `race:sync`, `race:done` | |

## Deploy

Any Node 18+ host works (Railway, Render, Fly.io, VPS). Example:

```bash
PORT=3001 CORS_ORIGIN=https://your-game.example npm start
```

Point the game client at your server URL (see root README).

## Testing locally

1. Start server: `npm start` in `server/`
2. Start game: `npm start` in repo root
3. Open two browser tabs to `http://localhost:4173`
4. **Friend requests:** Tab A → Multiplayer → enter B's nickname → **REQUEST**. Tab B sees pending request → **ACCEPT**. Both lists show the friend.
5. **Lobby invites:** Tab A → Create Lobby → Invite friends section → **INVITE** next to B. Tab B gets banner → **ACCEPT** → appears in lobby.
6. Automated 2-client test: `npm run test:social` in `server/`
