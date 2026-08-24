# DOG RACE

Colorful cartoon dog racing for Android. Tagline: **READY. SET. BARK!**

The first playable loop is in: pick a dog, race AI on a pseudo-3D track, collect coins, boost, then spend rewards on unlocks and upgrades.

## Play in a browser (fastest)

```bash
npm run assets
npm run sfx
npm start
```

Open [http://localhost:4173](http://localhost:4173). Landscape works best.

Controls: drag or arrow keys to steer, hold **BOOST** or Space, Esc to pause.

## Android

Open this folder in Android Studio and run the `app` configuration, or:

```bash
.\gradlew.bat :app:assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`. A current debug build is also at `dist/DogRace-debug.apk`.

Package: `com.dograce.game`  
Min SDK 26 · Target SDK 35 · Landscape

## Project layout

- `app/src/main/assets/` — game (HTML/CSS/JS, art, audio)
- `app/src/main/java/com/dograce/game/` — Android WebView shell
- `app/src/main/assets/js/config.js` — all tuning values
- `app/src/main/assets/js/data.js` — dogs, tracks, missions
- `app/src/main/assets/js/race.js` — race sim, local player, AI
- `app/src/main/assets/js/save.js` — persistent progress
