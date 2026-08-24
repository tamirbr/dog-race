# DOG RACE

Colorful cartoon dog racing for Android. Tagline: **READY. SET. BARK!**

The first playable loop is in: pick a dog, race AI on a pseudo-3D track, collect coins, boost, then spend rewards on unlocks and upgrades.

Optional **online multiplayer** is available when a backend server is reachable; otherwise the game behaves exactly like single-player (multiplayer UI is hidden).

## Play in a browser (fastest)

```bash
npm run assets
npm run sfx
npm start
```

Open [http://localhost:4173](http://localhost:4173). Landscape works best.

Controls: drag or arrow keys to steer, hold **BOOST** or Space, Esc to pause.

## Multiplayer (optional)

### Run the server

```bash
cd server
npm install
npm start
```

Health check: [http://localhost:3001/health](http://localhost:3001/health)

Or from the repo root:

```bash
npm run server:install
npm run server
```

Run **both** game and server together:

```bash
npm run dev
```

### Point the client at the backend

By default the client probes `http://localhost:3001` when playing locally.

Override with:

- URL query: `http://localhost:4173/?mp=http://localhost:3001`
- `localStorage` key `dograce.mp.url`
- `DogRace.Config.multiplayer.backendUrl` in `config.js`

On startup (and every 30s) the client calls `/health`. If the server is unreachable, **all multiplayer buttons stay hidden** and solo play is unchanged.

### Test multiplayer vs offline

| Scenario | How |
|----------|-----|
| **Offline / solo** | Open the game without starting the server — no Multiplayer button |
| **Online** | Start server + game, open two tabs, use **MULTIPLAYER → CREATE LOBBY** or **LOOKING FOR GAME** |
| **Friends** | In tab A, note nickname; tab B adds friend by nickname, host invites or friend joins |
| **Lobby** | Host picks track, toggles bots, everyone hits **READY**, host **START RACE** |
| **Quit lobby** | **QUIT GAME** returns to multiplayer hub cleanly |

See `server/README.md` for socket API and deploy notes.

## Android

Open this folder in Android Studio and run the `app` configuration, or:

```bash
.\gradlew.bat :app:assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. A current debug build is also at `dist/DogRace-debug.apk`.

Package: `com.dograce.game`  
Min SDK 26 · Target SDK 35 · Landscape

Music pauses when the app is backgrounded (Page Visibility API + Android `onPause`).

## Project layout

- `app/src/main/assets/` — game (HTML/CSS/JS, art, audio)
- `app/src/main/java/com/dograce/game/` — Android WebView shell
- `server/` — Node.js multiplayer backend (Express + Socket.IO)
- `app/src/main/assets/js/config.js` — all tuning values
- `app/src/main/assets/js/data.js` — dogs, tracks, missions
- `app/src/main/assets/js/race.js` — race sim, local player, AI, remote sync
- `app/src/main/assets/js/multiplayer.js` — client lobby/friends/queue
- `app/src/main/assets/js/save.js` — persistent progress

## Smoke test

```bash
npm run smoke
```
