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
    input: { laneDelta: 0, boostRequest: false, jump: false },
    swipe: { x: 0, y: 0, active: false },
    keys: {},
    canvas: null,
    multiplayerRace: false,
    mpPlayerId: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function go(name) {
    if (name === "multiplayer" && DogRace.Multiplayer && DogRace.Multiplayer.getLobby()) {
      name = "lobby";
    }
    App.screen = name;
    DogRace.UI.show(name);
    if (name === "menu") DogRace.UI.renderMenu();
    if (name === "dogs") DogRace.UI.renderDogs();
    if (name === "upgrades") DogRace.UI.renderUpgrades();
    if (name === "shop") DogRace.UI.renderShop();
    if (name === "missions") DogRace.UI.renderMissions();
    if (name === "settings") DogRace.UI.renderSettings();
    if (name === "tracks") DogRace.UI.renderTracks();
    if (name === "multiplayer") {
      if (DogRace.Multiplayer) DogRace.Multiplayer.ensureConnected().then(() => DogRace.UI.renderMultiplayerHub());
      else DogRace.UI.renderMultiplayerHub();
    }
    if (name === "lobby") {
      const lobby = DogRace.Multiplayer && DogRace.Multiplayer.getLobby();
      if (lobby) DogRace.UI.renderLobby(lobby);
    }
    if (name === "race") DogRace.Audio.setTheme("race");
    else if (name !== "splash") DogRace.Audio.setTheme("lobby");
  }
  App.go = go;

  function startRace(trackId) {
    App.multiplayerRace = false;
    App.mpPlayerId = null;
    const track = DogRace.trackById(trackId) || DogRace.Tracks[0];
    App.lastTrackId = track.id;
    App.race = DogRace.createRace({
      track,
      playerDogId: DogRace.Save.data.selectedDogId,
      fieldSize: 5,
    });
    App.paused = false;
    App.input.laneDelta = 0;
    App.input.boostRequest = false;
    App.input.jump = false;
    $("pause-overlay").classList.add("hidden");
    DogRace.UI.setCountdown("3");
    go("race");
    DogRace.Audio.play("countdown");
  }

  function startMultiplayerRace(payload) {
    if (!payload || !DogRace.Multiplayer) return;
    const mp = DogRace.Multiplayer;
    const localDogId = DogRace.Save.data.selectedDogId;
    mp.setDog(localDogId);
    App.mpPlayerId = mp.getPlayerId();
    App.multiplayerRace = true;
    App.lastTrackId = payload.trackId;
    App.race = mp.buildRaceFromPayload(payload, App.mpPlayerId, localDogId);
    App.paused = false;
    App.input.laneDelta = 0;
    App.input.boostRequest = false;
    App.input.jump = false;
    $("pause-overlay").classList.add("hidden");
    const delay = Math.max(0, (payload.startAt || 0) - Date.now());
    DogRace.UI.setCountdown("3");
    go("race");
    if (delay > 50) {
      App.race.phase = "countdown";
      App.race.countdown = delay / 1000 + DogRace.Config.race.startHold;
      App.race.lastCount = Math.ceil(App.race.countdown) + 1;
    }
    DogRace.Audio.play("countdown");
    mp.startSyncLoop(App.race, App.mpPlayerId);
  }

  function applyPeerSync(data) {
    if (!App.race) return;
    DogRace.applyRemoteSync(App.race, data);
  }
  App.startMultiplayerRace = startMultiplayerRace;
  App.applyPeerSync = applyPeerSync;

  function finishRace() {
    if (!App.race || !App.race.results) return;
    if (App.multiplayerRace && DogRace.Multiplayer) {
      DogRace.Multiplayer.stopSyncLoop();
      DogRace.Multiplayer.reportFinish(App.race.results.place, App.race.results.time);
    }
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
      boostRequest: App.input.boostRequest,
      jump: App.input.jump || App.keys.ArrowUp || App.keys.w || App.keys.W,
    };
    App.input.laneDelta = 0;
    App.input.boostRequest = false;
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
      if (e.target.closest && e.target.closest("#btn-boost, #btn-jump, #btn-pause, #race-controls, .overlay, .pause-big")) return;
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

    const tapBoost = (e) => {
      e.preventDefault();
      if (App.screen !== "race" || !App.race || App.paused) return;
      const p = App.race.player;
      if (!p.boostLatched && !p.boosting && p.boostMeter > 0) App.input.boostRequest = true;
    };
    boost.addEventListener("pointerdown", tapBoost);

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
      if (App.multiplayerRace && DogRace.Multiplayer) DogRace.Multiplayer.stopSyncLoop();
      App.race = null;
      App.multiplayerRace = false;
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

  async function handleMpAction(action, btn) {
    const mp = DogRace.Multiplayer;
    if (!mp) return;
    if (!(await mp.ensureConnected())) {
      DogRace.UI.toast(DogRace.I18n.t("mp.offline"), "📡");
      return;
    }
    if (action === "rename") {
      const res = await mp.rename($("mp-nickname-input").value);
      if (res.ok) {
        DogRace.UI.setMpNickname(res.nickname);
        DogRace.Audio.play("pickup");
      } else DogRace.UI.toast(DogRace.I18n.t("mp.nameTaken"), "⚠️");
    }
    if (action === "add-friend") {
      const res = await mp.addFriend($("mp-friend-input").value);
      if (res.ok) {
        $("mp-friend-input").value = "";
        DogRace.UI.toast(DogRace.I18n.t("mp.friendAdded"), "🐾");
      } else DogRace.UI.toast(DogRace.I18n.t("mp.friendNotFound"), "❓");
    }
    if (action === "create-lobby") {
      const res = await mp.createLobby("green_park");
      if (res.ok) go("lobby");
      else DogRace.UI.toast(DogRace.I18n.t("mp.error"), "⚠️");
    }
    if (action === "join-queue") {
      const res = await mp.joinQueue();
      if (res.ok) DogRace.UI.toast(DogRace.I18n.t("mp.queueJoined"), "🔍");
      else DogRace.UI.toast(DogRace.I18n.t("mp.error"), "⚠️");
    }
    if (action === "leave-queue") {
      await mp.leaveQueue();
      DogRace.UI.renderMpQueue({ waiting: false });
    }
    if (action === "accept-invite") {
      const res = await mp.acceptInvite();
      DogRace.UI.hideMpInvite();
      if (res.ok) go("lobby");
    }
    if (action === "dismiss-invite") DogRace.UI.hideMpInvite();
    if (action === "join-friend") {
      const res = await mp.joinFriendLobby(btn.dataset.friend);
      if (res.ok) go("lobby");
      else DogRace.UI.toast(DogRace.I18n.t("mp.noLobby"), "🚪");
    }
    if (action === "invite-friend") {
      const res = await mp.inviteFriend(btn.dataset.friend);
      if (res.ok) DogRace.UI.toast(DogRace.I18n.t("mp.inviteSent"), "📨");
    }
    if (action === "quit-lobby") {
      await mp.quitLobbyAndMenu();
      go("multiplayer");
    }
    if (action === "lobby-track") {
      await mp.setTrack(btn.dataset.track);
    }
    if (action === "lobby-add-bot") await mp.addBot();
    if (action === "lobby-remove-bot") await mp.removeBot();
    if (action === "lobby-kick") await mp.kickPlayer(btn.dataset.player);
    if (action === "lobby-ready") {
      const lobby = mp.getLobby();
      const me = lobby && lobby.slots.find((s) => s.id === mp.getPlayerId());
      await mp.setReady(!(me && me.ready));
    }
    if (action === "lobby-start") {
      const res = await mp.startRace();
      if (!res.ok) DogRace.UI.toast(DogRace.I18n.t("mp.notReady"), "⏳");
    }
  }

  function bindUi() {
    const unlockAudio = () => DogRace.Audio.unlock();
    document.body.addEventListener("pointerdown", unlockAudio, { passive: true });
    document.body.addEventListener("touchstart", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);
    document.body.addEventListener("click", (e) => {
      DogRace.Audio.unlock();
      const btn = e.target.closest("[data-go], [data-action], [data-select-dog], [data-buy-dog], [data-rename-dog], [data-upgrade], [data-track], [data-claim-mission], [data-set-lang], [data-mp-action]");
      if (!btn) return;
      DogRace.Audio.play("click");
      if (btn.dataset.mpAction) {
        handleMpAction(btn.dataset.mpAction, btn);
        return;
      }
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
      if (!e.repeat && (e.key === " " || e.key === "Shift")) App.input.boostRequest = true;
      if (e.key === "Escape" && App.screen === "race") $("btn-pause").click();
      if (e.key === "Enter" && App.screen === "menu") go("tracks");
    });
    window.addEventListener("keyup", (e) => {
      App.keys[e.key] = false;
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
        if (App.screen === "lobby" && DogRace.Multiplayer) {
          DogRace.Multiplayer.quitLobbyAndMenu().then(() => go("multiplayer"));
          return true;
        }
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
    if (DogRace.Multiplayer) {
      DogRace.Multiplayer.onRaceStart(startMultiplayerRace);
      DogRace.Multiplayer.onAvailabilityChange((on) => DogRace.UI.setMultiplayerVisible(on));
      await DogRace.Multiplayer.init();
    }
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
