window.DogRace = window.DogRace || {};

(function () {
  const files = {
    click: "audio/click.wav",
    coin: "audio/coin.wav",
    boost: "audio/boost.wav",
    crash: "audio/crash.wav",
    pickup: "audio/pickup.wav",
    bark: "audio/bark.mp3",
    countdown: "audio/countdown.wav",
    go: "audio/go.wav",
    finish: "audio/finish.wav",
    win: "audio/win.wav",
    lose: "audio/lose.wav",
    jump: "audio/jump.wav",
    yelp: "audio/yelp.wav",
    cheer: "audio/cheer.wav",
    whine: "audio/whine.wav",
    lobby: "audio/lobby.mp3",
    race: "audio/music.wav",
  };

  const cache = {};
  const musicTracks = { lobby: null, race: null };
  let currentTheme = "lobby";
  let unlocked = false;

  function preload(name) {
    const audio = new Audio();
    audio.src = files[name];
    audio.preload = "auto";
    cache[name] = audio;
    return new Promise((resolve) => {
      const done = () => resolve();
      audio.addEventListener("canplaythrough", done, { once: true });
      audio.addEventListener("error", done, { once: true });
      setTimeout(done, 1200);
    });
  }

  function musicEnabled() {
    return !!(DogRace.Save.data && DogRace.Save.data.settings.music);
  }

  DogRace.Audio = {
    async init() {
      await Promise.all(Object.keys(files).map(preload));
      ["lobby", "race"].forEach((theme) => {
        const node = cache[theme];
        if (!node) return;
        node.loop = true;
        node.volume = theme === "race" ? 0.42 : 0.4;
        musicTracks[theme] = node;
      });
      if (unlocked) this.setTheme(currentTheme, true);
    },

    unlock() {
      if (unlocked) return;
      unlocked = true;
      Object.keys(cache).forEach((name) => {
        if (name === "lobby" || name === "race") return;
        const audio = cache[name];
        try {
          audio.muted = true;
          const play = audio.play();
          if (play && play.then) {
            play.then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
            }).catch(() => {
              audio.muted = false;
            });
          }
        } catch (err) {
          audio.muted = false;
        }
      });
      this.setTheme(currentTheme, true);
    },

    play(name, { volume = 0.72, rate = 1 } = {}) {
      if (!DogRace.Save.data.settings.sfx) return;
      const src = cache[name];
      if (!src) return;
      const node = src.cloneNode();
      node.volume = volume;
      try {
        node.playbackRate = rate;
      } catch (err) {
        /* some WebViews ignore rate */
      }
      node.play().catch(() => {});
    },

    setTheme(theme, force) {
      currentTheme = theme === "race" ? "race" : "lobby";
      if (!unlocked) return;
      if (!musicEnabled()) {
        this.stopMusic();
        return;
      }
      Object.keys(musicTracks).forEach((name) => {
        const track = musicTracks[name];
        if (!track) return;
        if (name === currentTheme) {
          track.volume = name === "race" ? 0.42 : 0.4;
          if (force || track.paused) {
            track.play().catch(() => {});
          }
        } else {
          track.pause();
          track.currentTime = 0;
        }
      });
    },

    ensureMusic() {
      this.setTheme(currentTheme);
    },

    stopMusic() {
      Object.keys(musicTracks).forEach((name) => {
        const track = musicTracks[name];
        if (track) track.pause();
      });
    },

    setMusicEnabled(on) {
      DogRace.Save.data.settings.music = on;
      DogRace.Save.persist();
      if (on) this.setTheme(currentTheme, true);
      else this.stopMusic();
    },

    vibrate(ms) {
      if (!DogRace.Save.data.settings.vibration) return;
      if (window.AndroidBridge && AndroidBridge.vibrate) {
        AndroidBridge.vibrate(ms);
        return;
      }
      if (navigator.vibrate) navigator.vibrate(ms);
    },
  };
})();
