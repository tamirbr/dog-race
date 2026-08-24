window.DogRace = window.DogRace || {};

(function () {
  const Config = () => DogRace.Config;

  function emptyRecord() {
    return { score: null, time: null, coins: null };
  }

  function emptyRecords() {
    const records = {};
    DogRace.Tracks.forEach((track) => {
      records[track.id] = emptyRecord();
    });
    return records;
  }

  function emptyDogProgress(dog) {
    return {
      owned: dog.unlockCost === 0,
      nickname: "",
      level: 1,
      xp: 0,
      upgrades: { speed: 0, acceleration: 0, handling: 0, stamina: 0, boost: 0 },
    };
  }

  function defaultSave() {
    const dogs = {};
    DogRace.Dogs.forEach((dog) => {
      dogs[dog.id] = emptyDogProgress(dog);
    });
    return {
      version: 1,
      coins: 0,
      lifetimeCoins: 0,
      selectedDogId: "buddy",
      dogs,
      completedTracks: {},
      settings: { music: true, sfx: true, vibration: true, language: null, kidMode: true },
      tutorialDone: false,
      seenSplash: false,
      stats: {
        racesFinished: 0,
        wins: 0,
        coinsPicked: 0,
        boostsUsed: 0,
        cleanRaces: 0,
        dogsOwned: 1,
        track_green_park: 0,
        track_desert_dash: 0,
        track_city_circuit: 0,
        track_snowy_peaks: 0,
        track_rainbow_bay: 0,
        track_starlight_carnival: 0,
      },
      missionsClaimed: {},
      achievementsUnlocked: {},
      daily: { lastDay: "", streak: 0, claimed: false },
      records: emptyRecords(),
    };
  }

  function migrate(raw) {
    const base = defaultSave();
    if (!raw || typeof raw !== "object") return base;
    const defaultSettings = Object.assign({}, base.settings);
    const defaultStats = Object.assign({}, base.stats);
    const merged = Object.assign(base, raw);
    merged.settings = Object.assign({}, defaultSettings, raw.settings || {});
    if (merged.settings.kidMode == null) merged.settings.kidMode = true;
    merged.stats = Object.assign({}, defaultStats, raw.stats || {});
    const knownLang =
      DogRace.I18n && DogRace.I18n.langs.some((lang) => lang.id === merged.settings.language);
    if (!knownLang) merged.settings.language = null;
    merged.dogs = merged.dogs || {};
    DogRace.Dogs.forEach((dog) => {
      merged.dogs[dog.id] = Object.assign(emptyDogProgress(dog), merged.dogs[dog.id] || {});
      merged.dogs[dog.id].upgrades = Object.assign(
        { speed: 0, acceleration: 0, handling: 0, stamina: 0, boost: 0 },
        (merged.dogs[dog.id] && merged.dogs[dog.id].upgrades) || {}
      );
    });
    merged.stats.dogsOwned = DogRace.Dogs.filter((d) => merged.dogs[d.id].owned).length;
    merged.records = merged.records || {};
    DogRace.Tracks.forEach((track) => {
      merged.records[track.id] = Object.assign(emptyRecord(), merged.records[track.id] || {});
    });
    return merged;
  }

  DogRace.raceScore = function (result) {
    const timeBonus = Math.max(0, Math.round((100 - (result.time || 0)) * 8));
    return Math.max(0, (result.pickedCoins || 0) * 10 + (result.placeCoins || 0) + timeBonus);
  };

  DogRace.formatRaceTime = function (sec) {
    if (sec == null || !isFinite(sec)) return "—";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    if (m <= 0) return s.toFixed(1) + "s";
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  };

  DogRace.Save = {
    data: null,

    load() {
      try {
        const raw = localStorage.getItem(Config().saveKey);
        this.data = migrate(raw ? JSON.parse(raw) : null);
      } catch (err) {
        this.data = defaultSave();
      }
      this.refreshDaily();
      this.persist();
      return this.data;
    },

    persist() {
      localStorage.setItem(Config().saveKey, JSON.stringify(this.data));
    },

    reset() {
      this.data = defaultSave();
      this.persist();
    },

    selectedDog() {
      return DogRace.dogById(this.data.selectedDogId) || DogRace.Dogs[0];
    },

    dogState(id) {
      return this.data.dogs[id];
    },

    isOwned(id) {
      return !!(this.data.dogs[id] && this.data.dogs[id].owned);
    },

    dogName(id) {
      const def = DogRace.dogById(id);
      const state = this.dogState(id);
      const nick = state && state.nickname ? String(state.nickname).trim() : "";
      if (nick) return nick;
      if (DogRace.I18n) {
        const localized = DogRace.I18n.t("dog." + id + ".name");
        if (localized && localized !== "dog." + id + ".name") return localized;
      }
      return (def && def.name) || "Buddy";
    },

    renameDog(id, rawName) {
      if (!this.isOwned(id)) return { ok: false, reason: "locked" };
      const cleaned = String(rawName || "")
        .replace(/[<>]/g, "")
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 16);
      this.data.dogs[id].nickname = cleaned;
      this.persist();
      return { ok: true, name: this.dogName(id) };
    },

    effectiveStats(dogId) {
      const def = DogRace.dogById(dogId);
      const state = this.dogState(dogId);
      const cfg = Config();
      const levelBonus = (state.level - 1) * cfg.progression.statPerDogLevel;
      const up = state.upgrades;
      return {
        speed: def.baseSpeed + up.speed * cfg.upgrades.perLevel.speed + levelBonus,
        acceleration: def.baseAcceleration + up.acceleration * cfg.upgrades.perLevel.acceleration + levelBonus,
        handling: def.baseHandling + up.handling * cfg.upgrades.perLevel.handling + levelBonus,
        stamina: def.baseStamina + up.stamina * cfg.upgrades.perLevel.stamina + levelBonus,
        boost: def.baseBoost + up.boost * cfg.upgrades.perLevel.boost + levelBonus,
      };
    },

    xpToNext(level) {
      const cfg = Config().progression;
      return Math.round(cfg.xpPerLevelBase * Math.pow(level, cfg.xpPerLevelPower));
    },

    addCoins(amount) {
      const value = Math.max(0, Math.round(amount));
      this.data.coins += value;
      this.data.lifetimeCoins += value;
      this.persist();
    },

    spendCoins(amount) {
      if (this.data.coins < amount) return false;
      this.data.coins -= amount;
      this.persist();
      return true;
    },

    addXp(dogId, amount) {
      const state = this.dogState(dogId);
      const cfg = Config().progression;
      state.xp += Math.round(amount);
      let leveled = 0;
      while (state.level < cfg.maxDogLevel && state.xp >= this.xpToNext(state.level)) {
        state.xp -= this.xpToNext(state.level);
        state.level += 1;
        leveled += 1;
      }
      this.persist();
      return leveled;
    },

    upgradeCost(statLevel) {
      const costs = Config().upgrades.costs;
      let cost = costs[Math.min(statLevel, costs.length - 1)];
      if (this.data.settings.kidMode) {
        cost = Math.round(cost * (Config().kidMode.upgradeCostMul || 1));
      }
      return cost;
    },

    upgradeStat(dogId, stat) {
      const state = this.dogState(dogId);
      const level = state.upgrades[stat] || 0;
      if (level >= Config().progression.maxUpgradeLevel) return { ok: false, reason: "max" };
      const cost = this.upgradeCost(level);
      if (!this.spendCoins(cost)) return { ok: false, reason: "coins" };
      state.upgrades[stat] = level + 1;
      this.persist();
      return { ok: true, cost };
    },

    buyDog(dogId) {
      const def = DogRace.dogById(dogId);
      const state = this.dogState(dogId);
      if (state.owned) return { ok: false, reason: "owned" };
      if (!this.spendCoins(def.unlockCost)) return { ok: false, reason: "coins" };
      state.owned = true;
      this.data.stats.dogsOwned = DogRace.Dogs.filter((d) => this.data.dogs[d.id].owned).length;
      this.persist();
      return { ok: true };
    },

    selectDog(dogId) {
      if (!this.isOwned(dogId)) return false;
      this.data.selectedDogId = dogId;
      this.persist();
      return true;
    },

    trackUnlocked(track) {
      if (!track.unlockWins) return true;
      return this.data.stats.wins >= track.unlockWins;
    },

    bumpStat(key, amount) {
      this.data.stats[key] = (this.data.stats[key] || 0) + (amount || 1);
      this.persist();
    },

    trackRecord(trackId) {
      if (!this.data.records) this.data.records = emptyRecords();
      if (!this.data.records[trackId]) this.data.records[trackId] = emptyRecord();
      return this.data.records[trackId];
    },

    updateRecords(result) {
      const rec = this.trackRecord(result.trackId);
      const score = DogRace.raceScore(result);
      const broken = {
        score: rec.score == null || score > rec.score,
        time: rec.time == null || result.time < rec.time,
        coins: rec.coins == null || result.pickedCoins > rec.coins,
      };
      if (broken.score) rec.score = score;
      if (broken.time) rec.time = result.time;
      if (broken.coins) rec.coins = result.pickedCoins;
      result.score = score;
      result.recordBreaks = broken;
      result.best = { score: rec.score, time: rec.time, coins: rec.coins };
      return broken;
    },

    applyRaceOutcome(result) {
      this.updateRecords(result);
      this.addCoins(result.totalCoins);
      const leveled = this.addXp(result.dogId, result.xp);
      this.bumpStat("racesFinished", 1);
      if (result.place === 1) this.bumpStat("wins", 1);
      this.bumpStat("coinsPicked", result.pickedCoins);
      this.bumpStat("boostsUsed", result.boostsUsed);
      if (result.hits === 0) this.bumpStat("cleanRaces", 1);
      this.bumpStat("track_" + result.trackId, 1);
      this.data.completedTracks[result.trackId] = (this.data.completedTracks[result.trackId] || 0) + 1;
      const newAchievements = this.checkAchievements();
      this.persist();
      return { leveled, newAchievements };
    },

    missionProgress(mission) {
      return Math.min(this.data.stats[mission.stat] || 0, mission.target);
    },

    claimMission(id) {
      const mission = DogRace.Missions.find((m) => m.id === id);
      if (!mission || this.data.missionsClaimed[id]) return false;
      if (this.missionProgress(mission) < mission.target) return false;
      this.data.missionsClaimed[id] = true;
      this.addCoins(mission.rewardCoins);
      this.addXp(this.data.selectedDogId, mission.rewardXp);
      return true;
    },

    checkAchievements() {
      const newly = [];
      DogRace.Achievements.forEach((ach) => {
        if (this.data.achievementsUnlocked[ach.id]) return;
        if ((this.data.stats[ach.stat] || 0) >= ach.target) {
          this.data.achievementsUnlocked[ach.id] = true;
          newly.push(ach);
        }
      });
      return newly;
    },

    nextMission() {
      for (let i = 0; i < DogRace.Missions.length; i++) {
        const mission = DogRace.Missions[i];
        if (this.data.missionsClaimed[mission.id]) continue;
        const progress = this.missionProgress(mission);
        return {
          mission,
          progress,
          ready: progress >= mission.target,
        };
      }
      return null;
    },

    refreshDaily() {
      const today = new Date().toISOString().slice(0, 10);
      if (this.data.daily.lastDay === today) return;
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const streak = this.data.daily.lastDay === yesterday ? (this.data.daily.streak % 7) + 1 : 1;
      this.data.daily = { lastDay: today, streak, claimed: false };
    },

    claimDaily() {
      this.refreshDaily();
      if (this.data.daily.claimed) return null;
      const dayIndex = Math.max(0, this.data.daily.streak - 1) % 7;
      const coins = Config().economy.dailyCoins[dayIndex];
      this.data.daily.claimed = true;
      this.addCoins(coins);
      return { day: dayIndex + 1, coins };
    },
  };
})();
