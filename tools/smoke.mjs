import fs from "fs";
import path from "path";
import vm from "vm";

const root = path.resolve("app/src/main/assets/js");
const store = {};
const context = {
  window: {},
  console,
  localStorage: {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => {
      store[k] = String(v);
    },
  },
};
context.window = context;
context.DogRace = {};
vm.createContext(context);

for (const file of ["config.js", "data.js", "i18n.js", "i18n-extra.js", "save.js", "race.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
}

const DR = context.DogRace;
DR.Save.load();
if (!DR.Save.isOwned("buddy")) throw new Error("Buddy should be owned");
if (DR.Save.isOwned("zara")) throw new Error("Zara should start locked");
if (DR.Save.dogName("buddy") !== "Buddy") throw new Error("Default dog name should be Buddy");
const renamed = DR.Save.renameDog("buddy", "  Pip  ");
if (!renamed.ok || renamed.name !== "Pip") throw new Error("Could not rename owned dog");
if (DR.Save.renameDog("zara", "Snow").ok) throw new Error("Locked dogs should not be renamed");
DR.Save.renameDog("buddy", "");

if (DR.I18n.detectSystem() !== "en") throw new Error("System language should fall back to English");
if (DR.I18n.t("nav.race") !== "RACE") throw new Error("Default language should be English");
if (DR.I18n.t("missing.key.xyz") !== "missing.key.xyz") throw new Error("Unknown keys should return the key");
DR.Save.data.settings.language = "he";
if (DR.I18n.t("nav.race") !== "מירוץ") throw new Error("Hebrew translations missing");
if (DR.Save.dogName("buddy") !== "באדי") throw new Error("Hebrew default dog name missing");
DR.Save.data.settings.language = "xx";
if (DR.I18n.current() !== "en") throw new Error("Unknown saved language should fall back to English");
if (DR.I18n.t("nav.race") !== "RACE") throw new Error("Invalid language should use English strings");
["es", "fr", "de", "pt", "ar", "ru", "zh", "hi"].forEach((code) => {
  DR.Save.data.settings.language = code;
  const label = DR.I18n.t("nav.race");
  if (!label || label === "nav.race" || label === "RACE") throw new Error("Missing " + code + " nav.race");
});
DR.Save.data.settings.language = null;
if (DR.Save.dogName("buddy") !== "Buddy") throw new Error("English default dog name should return after reset");

const before = DR.Save.effectiveStats("buddy").speed;
DR.Save.addCoins(10000);
const up = DR.Save.upgradeStat("buddy", "speed");
if (!up.ok) throw new Error("Upgrade failed");
const after = DR.Save.effectiveStats("buddy").speed;
if (after <= before) throw new Error("Upgrade did not increase speed");

const race = DR.createRace({
  track: DR.trackById("green_park"),
  playerDogId: "buddy",
  fieldSize: 5,
});
if (race.participants.length !== 5) throw new Error("Expected 5 racers");
if (race.participants.filter((p) => p.kind === "ai").length !== 4) throw new Error("Expected 4 AI");
const starts = race.participants.map((p) => p.lane + ":" + Math.round(p.z / 10));
if (new Set(starts).size !== starts.length) throw new Error("Dogs stacked at the start: " + starts.join(","));
const hazards = race.course.items.filter((item) => ["crate", "rock", "cone", "log", "puddle", "ice"].indexOf(item.kind) >= 0);
if (hazards.length < 8) throw new Error("Not enough obstacles: " + hazards.length);

const aiStartZ = race.participants.filter((p) => p.kind === "ai").map((p) => p.z);
for (let i = 0; i < 240; i++) DR.stepRace(race, { laneDelta: 0, boost: false }, 1 / 60);
const aiLaterZ = race.participants.filter((p) => p.kind === "ai").map((p) => p.z);
if (aiLaterZ.every((z, i) => z <= aiStartZ[i] + 2)) throw new Error("AI dogs did not run");
race.player.lane = 0;
for (let i = 0; i < 45; i++) DR.stepRace(race, { laneDelta: 0, boost: false }, 1 / 60);
if (race.player.lane !== 0) throw new Error("Player did not stay in chosen lane");

let guard = 240 + 45;
while (race.phase !== "results" && guard < 20000) {
  DR.stepRace(race, { laneDelta: guard % 180 === 0 ? 1 : 0, boost: guard % 90 < 20, jump: guard % 110 === 0 }, 1 / 60);
  guard += 1;
}
if (race.phase !== "results") throw new Error("Race never finished");
if (!race.results || !race.results.place) throw new Error("Missing results");
if (race.player.z > race.course.finishZ + 1) throw new Error("Player should stop at the finish line");
if (race.results.totalCoins < race.results.placeCoins) throw new Error("Coin math failed");

if (DR.formatRaceTime(14.2) !== "14.2s") throw new Error("Short race time format failed");
if (DR.formatRaceTime(65.2) !== "1:05.2") throw new Error("Long race time format failed");
if (DR.I18n.t("rec.score") !== "Score") throw new Error("Record strings missing");

const leveled = DR.Save.applyRaceOutcome(race.results);
if (DR.Save.data.coins <= 0) throw new Error("Coins were not awarded");
if (DR.Save.data.stats.racesFinished !== 1) throw new Error("Race stat missing");

const rec1 = Object.assign({}, DR.Save.trackRecord("green_park"));
if (!race.results.recordBreaks || !race.results.recordBreaks.score || !race.results.recordBreaks.time || !race.results.recordBreaks.coins) {
  throw new Error("First finish should set score, time, and coin records");
}
if (rec1.time !== race.results.time) throw new Error("Best time was not stored");
if (rec1.coins !== race.results.pickedCoins) throw new Error("Best coins were not stored");
if (rec1.score !== race.results.score) throw new Error("Best score was not stored");

const worse = Object.assign({}, race.results, {
  time: race.results.time + 20,
  pickedCoins: Math.max(0, race.results.pickedCoins - 3),
  placeCoins: 25,
  totalCoins: 25,
});
DR.Save.applyRaceOutcome(worse);
const rec2 = Object.assign({}, DR.Save.trackRecord("green_park"));
if (rec2.time !== rec1.time) throw new Error("Worse time should not replace the record");
if (rec2.coins !== rec1.coins) throw new Error("Fewer coins should not replace the record");
if (worse.recordBreaks.time || worse.recordBreaks.coins) throw new Error("Worse run should not break time or coins");

const better = Object.assign({}, race.results, {
  time: Math.max(1, race.results.time - 4),
  pickedCoins: race.results.pickedCoins + 8,
  totalCoins: race.results.placeCoins + race.results.pickedCoins + 8,
});
DR.Save.applyRaceOutcome(better);
const rec3 = DR.Save.trackRecord("green_park");
if (rec3.time !== better.time) throw new Error("Faster time should become the record");
if (rec3.coins !== better.pickedCoins) throw new Error("More coins should become the record");
if (rec3.score <= rec1.score) throw new Error("Better run should raise the score record");
if (!better.recordBreaks.time || !better.recordBreaks.coins || !better.recordBreaks.score) {
  throw new Error("Better run should break time, coins, and score");
}

const saveKey = DR.Config.saveKey;
const raw = JSON.parse(store[saveKey]);
delete raw.records;
store[saveKey] = JSON.stringify(raw);
DR.Save.load();
const migrated = DR.Save.trackRecord("desert_dash");
if (!migrated || migrated.time !== null || migrated.score !== null || migrated.coins !== null) {
  throw new Error("Old saves should gain empty per-track records");
}

console.log("SMOKE OK", {
  place: race.results.place,
  coins: race.results.totalCoins,
  xp: race.results.xp,
  frames: guard,
  speedBefore: before,
  speedAfter: after,
  leveled,
  saveCoins: DR.Save.data.coins,
});
