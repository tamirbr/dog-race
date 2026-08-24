window.DogRace = window.DogRace || {};

(function () {
  const App = {
    screen: "splash",
    race: null,
    lastTrackId: "green_park",
    last: 0,
    accum: 0,
    paused: false,
    fx: { shake: 0 },
    renameDogId: "",
    input: { laneDelta: 0, boost: false, jump: false },
    swipe: { x: 0, y: 0, active: false },
    keys: {},
    canvas: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function go(name) {
    App.screen = name;
    DogRace.UI.show(name);
    if (name === "menu") DogRace.UI.renderMenu();
    if (name === "dogs") DogRace.UI.renderDogs();
    if (name === "upgrades") DogRace.UI.renderUpgrades();
    if (name === "shop") DogRace.UI.renderShop();
    if (name === "missions") DogRace.UI.renderMissions();
    if (name === "settings") DogRace.UI.renderSettings();
    if (name === "tracks") DogRace.UI.renderTracks();
    if (name === "race") DogRace.Audio.setTheme("race");
    else if (name !== "splash") DogRace.Audio.setTheme("lobby");
  }

  function startRace(trackId) {
    const track = DogRace.trackById(trackId) || DogRace.Tracks[0];
    App.lastTrackId = track.id;
    App.race = DogRace.createRace({
      track,
      playerDogId: DogRace.Save.data.selectedDogId,
      fieldSize: 5,
    });
    App.paused = false;
    App.input.laneDelta = 0;
    App.input.boost = false;
    App.input.jump = false;
    $("pause-overlay").classList.add("hidden");
    DogRace.UI.setCountdown("3");
    go("race");
    DogRace.Audio.play("countdown");
  }

  function finishRace() {
    if (!App.race || !App.race.results) return;
    const outcome = DogRace.Save.applyRaceOutcome(App.race.results);
    const leveled = outcome.leveled || 0;
    DogRace.UI.renderResults(App.race.results, leveled);
    if (outcome.newAchievements && outcome.newAchievements.length) {
      DogRace.UI.showStickers(outcome.newAchievements);
    }
    if (App.race.results.place === 1) {
      DogRace.Audio.play("win");
    } else if (App.race.results.place <= 3) {
      DogRace.Audio.play("finish");
      DogRace.Audio.play("bark", { volume: 0.7 });
    } else {
      DogRace.Audio.play("lose");
      DogRace.Audio.play("whine");
    }
    DogRace.Audio.vibrate(App.race.results.place === 1 ? 40 : 18);
    go("results");
  }

  function handleEvents(events) {
    events.forEach((ev) => {
      if (ev.type === "count") {
        DogRace.UI.setCountdown(String(ev.value));
        DogRace.Audio.play("countdown");
      }
      if (ev.type === "go") {
        DogRace.UI.setCountdown(DogRace.I18n ? DogRace.I18n.t("race.go") : "GO!");
        DogRace.Audio.play("go");
        DogRace.Audio.play("bark", { volume: 0.55, rate: 1.15 });
        DogRace.Audio.vibrate(20);
        setTimeout(() => {
          if (App.screen === "race") DogRace.UI.setCountdown("");
        }, 450);
      }
      if (ev.type === "coin" && ev.who === App.race.player) {
        DogRace.Audio.play("coin", { rate: 0.95 + Math.random() * 0.15 });
        DogRace.UI.showCoinFloat(DogRace.Config.economy.coinPickupValue);
      }
      if (ev.type === "pickup" && ev.who === App.race.player) DogRace.Audio.play("pickup");
      if (ev.type === "boost" && ev.who === App.race.player) {
        DogRace.Audio.play("boost");
        DogRace.Audio.play("bark", { volume: 0.45, rate: 1.08 });
      }
      if (ev.type === "jump") {
        const mine = ev.who === App.race.player;
        const near = mine || (ev.who && App.race.player && Math.abs(ev.who.z - App.race.player.z) < 420);
        if (near) {
          DogRace.Audio.play("bark", {
            volume: mine ? 0.88 : 0.4,
            rate: mine ? 1 : 0.92 + Math.random() * 0.12,
          });
        }
      }
      if (ev.type === "crash" && ev.who === App.race.player && ev.item) {
        DogRace.Audio.play("crash");
        DogRace.Audio.play("yelp");
        DogRace.Audio.vibrate(35);
        App.fx.shake = 0.28;
      }
      if (ev.type === "finish" && ev.who === App.race.player) {
        DogRace.Audio.play("finish");
        DogRace.Audio.play("cheer", { volume: 0.85 });
        DogRace.Audio.play("bark", { volume: 0.7, rate: 1.12 });
        DogRace.Audio.vibrate(28);
        DogRace.UI.setCountdown(DogRace.I18n ? DogRace.I18n.t("race.finish") : "FINISH!");
      }
      if (ev.type === "results") finishRace();
    });
  }

  function readInput() {
    const input = {
      laneDelta: App.input.laneDelta,
      boost: App.input.boost || App.keys[" "] || App.keys.Shift,
      jump: App.input.jump || App.keys.ArrowUp || App.keys.w || App.keys.W,
    };
    App.input.laneDelta = 0;
    App.input.jump = false;
    return input;
  }

  function changeLane(dir) {
    if (App.screen !== "race" || !App.race || App.paused) return;
    App.input.laneDelta += dir;
  }

  function tick(now) {
    const dt = Math.min(DogRace.Config.race.maxFrame, (now - App.last) / 1000 || 0);
    App.last = now;
    App.accum += dt;
    App.fx.shake = Math.max(0, App.fx.shake - dt);

    if (App.screen === "race" && App.race && !App.paused) {
      const step = DogRace.Config.race.timestep;
      while (App.accum >= step) {
        DogRace.stepRace(App.race, readInput(), step);
        handleEvents(App.race.events);
        App.accum -= step;
        if (App.screen !== "race") break;
      }
      if (App.screen === "race" && App.race) {
        const canvas = App.canvas;
        if (App.fx.shake > 0) {
          canvas.style.transform = "translate(" + ((Math.random() - 0.5) * 5) + "px," + ((Math.random() - 0.5) * 4) + "px)";
        } else canvas.style.transform = "";
        DogRace.renderRace(canvas, App.race, App.fx);
        DogRace.UI.updateHud(App.race);
      }
    } else {
      App.accum = 0;
    }
    requestAnimationFrame(tick);
  }

  function bindPointer() {
    const canvas = App.canvas;
    const boost = $("btn-boost");

    const raceScreen = $("screen-race");
    const beginSwipe = (e) => {
      if (e.target.closest && e.target.closest("#btn-boost, #btn-jump, #btn-pause, #steer-pad, .overlay, .pause-big")) return;
      App.swipe.active = true;
      App.swipe.x = e.clientX;
      App.swipe.y = e.clientY;
    };
    const endSwipe = (e) => {
      if (!App.swipe.active) return;
      App.swipe.active = false;
      const dx = e.clientX - App.swipe.x;
      const dy = e.clientY - App.swipe.y;
      if (Math.abs(dy) > 46 && Math.abs(dy) > Math.abs(dx) && dy < 0) {
        App.input.jump = true;
        return;
      }
      if (Math.abs(dx) > 36) {
        changeLane(dx > 0 ? 1 : -1);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const t = (e.clientX - rect.left) / Math.max(1, rect.width);
      if (t < 0.38) changeLane(-1);
      else if (t > 0.62) changeLane(1);
    };
    raceScreen.addEventListener("pointerdown", beginSwipe);
    raceScreen.addEventListener("pointerup", endSwipe);
    raceScreen.addEventListener("pointercancel", () => {
      App.swipe.active = false;
    });

    const startBoost = (e) => {
      e.preventDefault();
      App.input.boost = true;
      boost.classList.add("hot");
    };
    const endBoost = () => {
      App.input.boost = false;
      boost.classList.remove("hot");
    };
    boost.addEventListener("pointerdown", startBoost);
    boost.addEventListener("pointerup", endBoost);
    boost.addEventListener("pointerleave", endBoost);
    boost.addEventListener("pointercancel", endBoost);

    const jumpBtn = $("btn-jump");
    const startJump = (e) => {
      e.preventDefault();
      App.input.jump = true;
      jumpBtn.classList.add("hot");
    };
    const endJump = () => jumpBtn.classList.remove("hot");
    jumpBtn.addEventListener("pointerdown", startJump);
    jumpBtn.addEventListener("pointerup", endJump);
    jumpBtn.addEventListener("pointerleave", endJump);
    jumpBtn.addEventListener("pointercancel", endJump);

    function bindSteerButton(btn, dir) {
      const press = (e) => {
        e.preventDefault();
        changeLane(dir);
        btn.classList.add("hot");
        DogRace.Audio.play("click", { volume: 0.35 });
      };
      const release = () => btn.classList.remove("hot");
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("pointercancel", release);
    }
    bindSteerButton($("btn-steer-left"), -1);
    bindSteerButton($("btn-steer-right"), 1);
  }

  function onAction(action) {
    if (action === "finish-tutorial") {
      DogRace.Save.data.tutorialDone = true;
      DogRace.Save.persist();
      go("menu");
    }
    if (action === "skip-tutorial") {
      DogRace.Save.data.tutorialDone = true;
      DogRace.Save.persist();
      go("menu");
    }
    if (action === "resume") {
      App.paused = false;
      $("pause-overlay").classList.add("hidden");
    }
    if (action === "quit-race") {
      App.race = null;
      go("menu");
    }
    if (action === "again") startRace(App.lastTrackId);
    if (action === "daily") {
      const claim = DogRace.Save.claimDaily();
      if (claim) DogRace.Audio.play("pickup");
      DogRace.UI.renderShop();
    }
    if (action === "language-open") {
      DogRace.UI.renderLangPicker();
      $("lang-picker").classList.remove("hidden");
    }
    if (action === "language-close") $("lang-picker").classList.add("hidden");
    if (action === "rename-cancel") closeRename();
    if (action === "rename-save") saveRename();
  }

  function openRename(dogId) {
    if (!DogRace.Save.isOwned(dogId)) return;
    App.renameDogId = dogId;
    const name = DogRace.Save.dogName(dogId);
    $("rename-hint").textContent = DogRace.I18n.t("rename.hint", { name: name });
    $("rename-input").value = name;
    $("rename-dog").classList.remove("hidden");
    setTimeout(() => {
      const input = $("rename-input");
      input.focus();
      input.select();
    }, 50);
  }

  function closeRename() {
    App.renameDogId = "";
    $("rename-dog").classList.add("hidden");
  }

  function saveRename() {
    if (!App.renameDogId) return;
    const res = DogRace.Save.renameDog(App.renameDogId, $("rename-input").value);
    if (res.ok) DogRace.Audio.play("pickup");
    closeRename();
    DogRace.UI.renderDogs();
    DogRace.UI.renderMenu();
    if (App.screen === "upgrades") DogRace.UI.renderUpgrades();
  }

  function bindUi() {
    const unlockAudio = () => DogRace.Audio.unlock();
    document.body.addEventListener("pointerdown", unlockAudio, { passive: true });
    document.body.addEventListener("touchstart", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);
    document.body.addEventListener("click", (e) => {
      DogRace.Audio.unlock();
      const btn = e.target.closest("[data-go], [data-action], [data-select-dog], [data-buy-dog], [data-rename-dog], [data-upgrade], [data-track], [data-claim-mission], [data-set-lang]");
      if (!btn) return;
      DogRace.Audio.play("click");
      if (btn.dataset.go) go(btn.dataset.go);
      if (btn.dataset.action) onAction(btn.dataset.action);
      if (btn.hasAttribute("data-set-lang")) {
        DogRace.I18n.set(btn.getAttribute("data-set-lang"));
        $("lang-picker").classList.add("hidden");
      }
      if (btn.dataset.selectDog) {
        DogRace.Save.selectDog(btn.dataset.selectDog);
        DogRace.UI.renderDogs();
        DogRace.UI.renderMenu();
      }
      if (btn.dataset.renameDog) openRename(btn.dataset.renameDog);
      if (btn.dataset.buyDog) {
        const res = DogRace.Save.buyDog(btn.dataset.buyDog);
        if (res.ok) {
          DogRace.Save.selectDog(btn.dataset.buyDog);
          DogRace.Audio.play("pickup");
        } else DogRace.Audio.play("lose", { volume: 0.35 });
        if (App.screen === "dogs") DogRace.UI.renderDogs();
        if (App.screen === "shop") DogRace.UI.renderShop();
      }
      if (btn.dataset.upgrade) {
        const res = DogRace.Save.upgradeStat(DogRace.Save.data.selectedDogId, btn.dataset.upgrade);
        if (res.ok) DogRace.Audio.play("pickup");
        else DogRace.Audio.play("lose", { volume: 0.35 });
        DogRace.UI.renderUpgrades();
      }
      if (btn.dataset.track) startRace(btn.dataset.track);
      if (btn.dataset.claimMission) {
        if (DogRace.Save.claimMission(btn.dataset.claimMission)) {
          DogRace.Audio.play("win", { volume: 0.45 });
          DogRace.UI.toast(DogRace.I18n.t("ui.missionClaimed"), "🎁");
        }
        DogRace.UI.renderMissions();
        if (App.screen === "menu") DogRace.UI.renderMenu();
      }
    });

    $("btn-pause").addEventListener("click", () => {
      if (!App.race || App.screen !== "race") return;
      App.paused = true;
      $("pause-overlay").classList.remove("hidden");
      DogRace.Audio.play("click");
    });

    $("hero-dog").addEventListener("click", () => {
      DogRace.Audio.play("bark");
      DogRace.Audio.vibrate(12);
    });

    $("set-music").addEventListener("change", (e) => {
      DogRace.Audio.setMusicEnabled(e.target.checked);
    });
    $("set-sfx").addEventListener("change", (e) => {
      DogRace.Save.data.settings.sfx = e.target.checked;
      DogRace.Save.persist();
    });
    $("set-vib").addEventListener("change", (e) => {
      DogRace.Save.data.settings.vibration = e.target.checked;
      DogRace.Save.persist();
    });
    const kidToggle = $("set-kid");
    if (kidToggle) {
      kidToggle.addEventListener("change", (e) => {
        DogRace.Save.data.settings.kidMode = e.target.checked;
        DogRace.Save.persist();
        if (App.screen === "tracks") DogRace.UI.renderTracks();
      });
    }

    window.addEventListener("keydown", (e) => {
      if (!$("lang-picker").classList.contains("hidden")) {
        if (e.key === "Escape") $("lang-picker").classList.add("hidden");
        return;
      }
      if (!$("rename-dog").classList.contains("hidden")) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveRename();
        }
        if (e.key === "Escape") closeRename();
        return;
      }
      App.keys[e.key] = true;
      if (e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp") e.preventDefault();
      if (!e.repeat && (e.key === "ArrowLeft" || e.key === "a" || e.key === "A")) changeLane(-1);
      if (!e.repeat && (e.key === "ArrowRight" || e.key === "d" || e.key === "D")) changeLane(1);
      if (!e.repeat && (e.key === "ArrowUp" || e.key === "w" || e.key === "W")) App.input.jump = true;
      if (e.key === "Escape" && App.screen === "race") $("btn-pause").click();
      if (e.key === "Enter" && App.screen === "menu") go("tracks");
    });
    window.addEventListener("keyup", (e) => {
      App.keys[e.key] = false;
      if (e.key === " " || e.key === "Shift") App.input.boost = false;
    });

    window.onAndroidBack = function () {
      if (!$("lang-picker").classList.contains("hidden")) {
        $("lang-picker").classList.add("hidden");
        return true;
      }
      if (!$("rename-dog").classList.contains("hidden")) {
        closeRename();
        return true;
      }
      if (App.screen === "race") {
        if (App.paused) onAction("quit-race");
        else $("btn-pause").click();
        return true;
      }
      if (App.screen !== "menu" && App.screen !== "splash") {
        go("menu");
        return true;
      }
      return false;
    };
  }

  function refreshLang() {
    DogRace.I18n.applyDom(document);
    if (App.screen === "menu") DogRace.UI.renderMenu();
    if (App.screen === "dogs") DogRace.UI.renderDogs();
    if (App.screen === "upgrades") DogRace.UI.renderUpgrades();
    if (App.screen === "shop") DogRace.UI.renderShop();
    if (App.screen === "missions") DogRace.UI.renderMissions();
    if (App.screen === "settings") DogRace.UI.renderSettings();
    if (App.screen === "tracks") DogRace.UI.renderTracks();
    if (App.screen === "results" && App.race && App.race.results) {
      DogRace.UI.renderResults(App.race.results, false);
    }
  }

  App.boot = async function () {
    DogRace.Save.load();
    DogRace.I18n.onApply = refreshLang;
    DogRace.I18n.apply();
    App.canvas = $("race-canvas");
    bindUi();
    bindPointer();
    await DogRace.Assets.load();
    await DogRace.Audio.init();
    requestAnimationFrame(tick);
    const params = new URLSearchParams(window.location.search);
    if (params.get("race")) {
      startRace(params.get("race"));
      return;
    }
    if (params.get("screen")) {
      go(params.get("screen"));
      return;
    }
    setTimeout(() => {
      if (!DogRace.Save.data.tutorialDone) go("tutorial");
      else go("menu");
    }, 1600);
  };

  window.DogRaceApp = App;
  window.addEventListener("load", () => App.boot());
})();
