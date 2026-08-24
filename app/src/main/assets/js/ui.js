window.DogRace = window.DogRace || {};

(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function t(key, vars) {
    return DogRace.I18n ? DogRace.I18n.t(key, vars) : key;
  }

  function statBar(label, value) {
    const pct = Math.max(4, Math.min(100, (value / 16) * 100));
    return `<div class="bar"><span>${label}</span><i><em style="width:${pct}%"></em></i></div>`;
  }

  function coinsLabel(n) {
    const locale = DogRace.I18n && DogRace.I18n.locale ? DogRace.I18n.locale() : undefined;
    return "🪙 " + Math.floor(n).toLocaleString(locale);
  }

  function dash() {
    return t("rec.none");
  }

  function trackRecordLine(trackId) {
    const rec = DogRace.Save.trackRecord(trackId);
    if (rec.score == null && rec.time == null && rec.coins == null) {
      return `<p class="track-records muted">${escapeHtml(t("ui.trackNoRecord"))}</p>`;
    }
    return `<p class="track-records">${escapeHtml(
      t("ui.trackRecords", {
        score: rec.score == null ? dash() : rec.score,
        time: rec.time == null ? dash() : DogRace.formatRaceTime(rec.time),
        coins: rec.coins == null ? dash() : rec.coins,
      })
    )}</p>`;
  }

  function resultRecordBoxes(result) {
    const breaks = result.recordBreaks || {};
    const best = result.best || DogRace.Save.trackRecord(result.trackId);
    const score = result.score != null ? result.score : DogRace.raceScore(result);
    return [
      recordBox(t("rec.score"), String(score), best.score, breaks.score),
      recordBox(
        t("rec.time"),
        DogRace.formatRaceTime(result.time),
        best.time == null ? dash() : DogRace.formatRaceTime(best.time),
        breaks.time
      ),
      recordBox(t("rec.coins"), String(result.pickedCoins), best.coins, breaks.coins),
    ].join("");
  }

  function recordBox(label, value, bestValue, isNew) {
    const bestText = bestValue == null ? dash() : String(bestValue);
    return `<div class="record-box ${isNew ? "new" : ""}">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
      ${isNew ? `<span class="record-new">${escapeHtml(t("rec.new"))}</span>` : ""}
      <span class="best">${escapeHtml(t("rec.best") + " " + bestText)}</span>
    </div>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch]));
  }

  function dogBreed(dog) {
    return t("dog." + dog.id + ".breed");
  }

  function dogPersonality(dog) {
    return t("dog." + dog.id + ".personality");
  }

  function dogAbility(dog) {
    return t("dog." + dog.id + ".ability");
  }

  function trackName(track) {
    return t("track." + track.id + ".name");
  }

  DogRace.UI = {
    show(name) {
      document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("active", el.id === "screen-" + name));
    },

    refreshCoins() {
      const label = coinsLabel(DogRace.Save.data.coins);
      ["menu-coins", "dogs-coins", "up-coins", "shop-coins", "mission-coins", "track-coins"].forEach((id) => {
        const el = $(id);
        if (el) el.textContent = label;
      });
    },

    renderMenu() {
      const dog = DogRace.Save.selectedDog();
      const state = DogRace.Save.dogState(dog.id);
      const name = DogRace.Save.dogName(dog.id);
      $("menu-dog").src = dog.portrait;
      $("menu-dog").alt = name;
      $("menu-dog-name").textContent = name;
      $("menu-dog-info").textContent = t("menu.levelInfo", { level: state.level, breed: dogBreed(dog) });
      this.refreshCoins();
    },

    renderDogs() {
      this.refreshCoins();
      $("dogs-list").innerHTML = DogRace.Dogs.map((dog) => {
        const state = DogRace.Save.dogState(dog.id);
        const stats = DogRace.Save.effectiveStats(dog.id);
        const rarity = DogRace.Rarity[dog.rarity];
        const selected = DogRace.Save.data.selectedDogId === dog.id;
        const name = DogRace.Save.dogName(dog.id);
        let action;
        if (state.owned) {
          const select = selected
            ? `<button class="btn mini" disabled>${t("ui.selected")}</button>`
            : `<button class="btn mint mini" data-select-dog="${dog.id}">${t("ui.select")}</button>`;
          action = `<div class="dog-actions">${select}<button class="btn sky mini" data-rename-dog="${dog.id}">${t("ui.rename")}</button></div>`;
        } else {
          action = `<button class="btn gold mini" data-buy-dog="${dog.id}">${dog.unlockCost} 🪙</button>`;
        }
        return `<article class="dog-card ${state.owned ? "" : "locked"}">
          <img src="${dog.portrait}" alt="${escapeHtml(name)}" />
          <div>
            <h3>${escapeHtml(name)}</h3>
            <div class="rarity" style="color:${rarity.color}">${t("rarity." + dog.rarity)} · ${escapeHtml(dogBreed(dog))}</div>
            <p>${state.owned ? t("ui.level", { n: state.level }) : t("ui.locked")} · ${escapeHtml(dogPersonality(dog))}</p>
            <div class="bars">
              ${statBar(t("stat.speed"), stats.speed)}
              ${statBar(t("stat.accel"), stats.acceleration)}
              ${statBar(t("stat.handle"), stats.handling)}
              ${statBar(t("stat.stamina"), stats.stamina)}
              ${statBar(t("stat.boost"), stats.boost)}
            </div>
          </div>
          ${action}
        </article>`;
      }).join("");
    },

    renderUpgrades() {
      this.refreshCoins();
      const dog = DogRace.Save.selectedDog();
      const state = DogRace.Save.dogState(dog.id);
      const stats = DogRace.Save.effectiveStats(dog.id);
      $("up-portrait").src = dog.portrait;
      $("up-name").textContent = DogRace.Save.dogName(dog.id);
      $("up-level").textContent = t("ui.level", { n: state.level }) + " · " + dogAbility(dog);
      const need = DogRace.Save.xpToNext(state.level);
      $("up-xp").style.width = Math.min(100, (state.xp / need) * 100) + "%";
      const names = [
        ["speed", t("stat.speedUp")],
        ["acceleration", t("stat.accelUp")],
        ["handling", t("stat.handleUp")],
        ["stamina", t("stat.staminaUp")],
        ["boost", t("stat.boostUp")],
      ];
      $("upgrade-list").innerHTML = names
        .map(([key, label]) => {
          const level = state.upgrades[key];
          const maxed = level >= DogRace.Config.progression.maxUpgradeLevel;
          const cost = DogRace.Save.upgradeCost(level);
          return `<article class="upgrade-row">
            <div>
              <strong>${label}</strong>
              <div class="bars">${statBar(t("stat.lv", { n: level + 1 }), stats[key])}</div>
            </div>
            <button class="btn gold mini" data-upgrade="${key}" ${maxed ? "disabled" : ""}>${maxed ? t("ui.max") : cost + " 🪙"}</button>
          </article>`;
        })
        .join("");
    },

    renderShop() {
      this.refreshCoins();
      const daily = DogRace.Save.data.daily;
      const reward = DogRace.Config.economy.dailyCoins[Math.max(0, daily.streak - 1) % 7];
      $("daily-card").innerHTML = `
        <h3>${t("ui.dailyTitle", { n: daily.streak })}</h3>
        <p>${t("ui.dailyBody", { n: reward })}</p>
        <button class="btn gold" data-action="daily" ${daily.claimed ? "disabled" : ""}>${daily.claimed ? t("ui.claimed") : t("ui.claimAmount", { n: reward })}</button>
      `;
      $("shop-list").innerHTML = DogRace.Dogs.filter((d) => !DogRace.Save.isOwned(d.id))
        .map((dog) => {
          const name = t("dog." + dog.id + ".name");
          return `<article class="shop-card">
            <img src="${dog.portrait}" alt="${escapeHtml(name)}" />
            <div>
              <h3>${escapeHtml(name)}</h3>
              <div class="rarity" style="color:${DogRace.Rarity[dog.rarity].color}">${t("rarity." + dog.rarity)} · ${escapeHtml(dogBreed(dog))}</div>
              <p>${escapeHtml(dogPersonality(dog))}</p>
            </div>
            <button class="btn gold mini" data-buy-dog="${dog.id}">${dog.unlockCost} 🪙</button>
          </article>`;
        })
        .join("") || `<div class="card">${t("ui.shopEmpty")}</div>`;
    },

    renderMissions() {
      this.refreshCoins();
      $("mission-list").innerHTML = DogRace.Missions.map((m) => {
        const progress = DogRace.Save.missionProgress(m);
        const claimed = !!DogRace.Save.data.missionsClaimed[m.id];
        const ready = progress >= m.target && !claimed;
        return `<article class="mission-card">
          <div style="grid-column:1/-1">
            <strong>${t("mission." + m.id + ".name")}</strong>
            <p>${t("mission." + m.id + ".desc")} · ${progress}/${m.target}</p>
            <div class="bars">${statBar(t("ui.goal"), (progress / m.target) * 16)}</div>
            <button class="btn mint mini" data-claim-mission="${m.id}" ${ready ? "" : "disabled"}>${claimed ? t("ui.claimed") : "+" + m.rewardCoins + " 🪙"}</button>
          </div>
        </article>`;
      }).join("");
      $("achieve-list").innerHTML = DogRace.Achievements.map((a) => {
        const have = DogRace.Save.data.stats[a.stat] || 0;
        const done = !!DogRace.Save.data.achievementsUnlocked[a.id] || have >= a.target;
        return `<article class="mission-card ${done ? "" : "locked"}">
          <div style="grid-column:1/-1">
            <strong>${done ? "★ " : ""}${t("ach." + a.id + ".name")}</strong>
            <p>${t("ach." + a.id + ".desc")}</p>
            <div class="bars">${statBar(t("ui.progress"), (Math.min(have, a.target) / a.target) * 16)}</div>
          </div>
        </article>`;
      }).join("");
    },

    renderTracks() {
      this.refreshCoins();
      $("track-list").innerHTML = DogRace.Tracks.map((track) => {
        const unlocked = DogRace.Save.trackUnlocked(track);
        return `<article class="track-card ${unlocked ? "" : "locked"}">
          <div style="grid-column:1/-1">
            <h3>${escapeHtml(trackName(track))}</h3>
            <p>${t("ui.trackMeta", { stars: track.stars, meters: track.lengthMeters, level: track.recommendedLevel })}</p>
            <p>${t("ui.aiRewards", { diff: t("diff." + track.aiDifficulty), mult: track.rewardMultiplier })}</p>
            ${trackRecordLine(track.id)}
            <button class="btn gold" data-track="${track.id}" ${unlocked ? "" : "disabled"}>
              ${unlocked ? t("ui.race") : t("ui.winUnlock", { n: track.unlockWins })}
            </button>
          </div>
        </article>`;
      }).join("");
    },

    renderSettings() {
      $("set-music").checked = DogRace.Save.data.settings.music;
      $("set-sfx").checked = DogRace.Save.data.settings.sfx;
      $("set-vib").checked = DogRace.Save.data.settings.vibration;
      const nameEl = $("set-language-name");
      if (nameEl && DogRace.I18n) {
        const info = DogRace.I18n.info(DogRace.I18n.current());
        nameEl.textContent = DogRace.I18n.isAuto() ? t("lang.system") + " · " + info.name : info.name;
      }
    },

    renderLangPicker() {
      const list = $("lang-list");
      if (!list || !DogRace.I18n) return;
      const saved = DogRace.I18n.saved();
      const system = DogRace.I18n.detectSystem();
      const systemInfo = DogRace.I18n.info(system);
      const rows = [
        { id: "", label: t("lang.system") + " · " + systemInfo.name, on: !saved },
      ].concat(
        DogRace.I18n.langs.map((lang) => ({
          id: lang.id,
          label: lang.name,
          on: saved === lang.id,
        }))
      );
      list.innerHTML = rows
        .map(
          (row) =>
            `<button type="button" class="btn ${row.on ? "gold on" : "ghost"}" data-set-lang="${row.id}">${escapeHtml(row.label)}</button>`
        )
        .join("");
    },

    updateHud(race) {
      $("hud-place").textContent = DogRace.placeOrdinal(race.player.finishPlace) + " / " + race.participants.length;
      $("hud-bar").style.width = Math.round(DogRace.progressOf(race, race.player) * 100) + "%";
      $("hud-coins").textContent = coinsLabel(race.player.coins);
      $("boost-meter").style.setProperty("--boost", Math.round(race.player.boostMeter * 100) + "%");
    },

    setCountdown(text) {
      $("countdown").textContent = text || "";
    },

    renderResults(result, leveled) {
      const win = result.place === 1;
      const podium = result.place <= 3;
      $("results-emoji").textContent = win ? "🏆" : podium ? "🥈" : "💨";
      $("results-title").textContent = win ? t("results.win") : podium ? t("results.great") : t("results.keep");
      $("results-place").textContent = t("results.placeLine", { place: DogRace.placeOrdinal(result.place) });
      $("results-coins").textContent = result.totalCoins;
      $("results-xp").textContent = result.xp;
      $("results-picked-line").textContent = t("results.picked", { n: result.pickedCoins });
      $("results-level").classList.toggle("hidden", !leveled);
      const host = $("results-records");
      if (host) host.innerHTML = resultRecordBoxes(result);
    },
  };
})();
