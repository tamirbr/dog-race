import { trackById } from "./data/tracks.js";

const CONFIG = {
  race: {
    timestep: 1 / 60,
    segmentLength: 20,
    lanes: 3,
    laneSpread: 0.74,
    laneHitRadius: 0.36,
    packSpacing: 0.2,
    rumbleLength: 4,
    runoffSegments: 56,
    startHold: 3,
    resultsDelay: 2.25,
  },
  physics: {
    baseMaxSpeed: 168,
    speedPerStat: 7.2,
    baseAccel: 42,
    accelPerStat: 4.4,
    baseHandling: 2.35,
    handlingPerStat: 0.18,
    coastDecel: 18,
    stunDecel: 90,
    mudDuration: 0.65,
    mudSpeedMul: 0.88,
    iceDuration: 0.8,
    iceHandlingMul: 0.76,
    boostSpeedMul: 1.42,
    boostDrain: 0.18,
    boostFillPickup: 0.72,
    boostPickupBurst: 0.62,
    boostIdleRegen: 0.1,
    staminaDrainAtSpeed: 0.038,
    staminaRegen: 0.11,
    staminaLowThreshold: 0.22,
    staminaLowSpeedMul: 0.82,
    jumpDuration: 0.55,
    jumpCooldown: 0.18,
    collisionStun: 0.14,
    collisionSpeedKeep: 0.84,
  },
  ai: {
    rubberBehindGap: 520,
    rubberAheadGap: 460,
    catchUpMul: 1.01,
    easeMul: 0.82,
    rubberClamp: [0.76, 1.02],
    wanderChance: 0.015,
    boostChance: 0.0015,
    mistakeChance: 0.42,
    lookAhead: 140,
    reactionMin: 0.12,
    reactionMax: 0.5,
  },
  difficulty: {
    easy: { speed: 0.5, skill: 0.18 },
    normal: { speed: 0.6, skill: 0.28 },
    hard: { speed: 0.68, skill: 0.36 },
    expert: { speed: 0.74, skill: 0.44 },
  },
};

const DOGS = {
  buddy: { id: "buddy", name: "Buddy", baseSpeed: 8, baseAcceleration: 8, baseHandling: 8, baseStamina: 8, baseBoost: 7, ability: "happy_pace" },
  zara: { id: "zara", name: "Zara", baseSpeed: 12, baseAcceleration: 8, baseHandling: 7, baseStamina: 5, baseBoost: 9, ability: "snow_dash" },
  rocky: { id: "rocky", name: "Rocky", baseSpeed: 7, baseAcceleration: 12, baseHandling: 7, baseStamina: 9, baseBoost: 7, ability: "power_run" },
  luna: { id: "luna", name: "Luna", baseSpeed: 8, baseAcceleration: 8, baseHandling: 12, baseStamina: 7, baseBoost: 8, ability: "quick_step" },
  max: { id: "max", name: "Max", baseSpeed: 8, baseAcceleration: 5, baseHandling: 6, baseStamina: 12, baseBoost: 12, ability: "heavy_charge" },
  pip: { id: "pip", name: "Pip", baseSpeed: 9, baseAcceleration: 9, baseHandling: 10, baseStamina: 7, baseBoost: 7, ability: "quick_step" },
  coco: { id: "coco", name: "Coco", baseSpeed: 8, baseAcceleration: 9, baseHandling: 11, baseStamina: 8, baseBoost: 8, ability: "happy_pace" },
  bolt: { id: "bolt", name: "Bolt", baseSpeed: 13, baseAcceleration: 7, baseHandling: 6, baseStamina: 6, baseBoost: 10, ability: "snow_dash" },
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function easeInOut(a, b, percent) {
  return a + (b - a) * ((-Math.cos(percent * Math.PI) / 2) + 0.5);
}

function laneCount() {
  return CONFIG.race.lanes;
}

function laneX(lane) {
  return (lane - (laneCount() - 1) / 2) * CONFIG.race.laneSpread;
}

function clampLane(lane) {
  return clamp(lane | 0, 0, laneCount() - 1);
}

function dogDef(id) {
  return DOGS[id] || DOGS.buddy;
}

function baseStats(dogId) {
  const d = dogDef(dogId);
  return {
    speed: d.baseSpeed,
    acceleration: d.baseAcceleration,
    handling: d.baseHandling,
    stamina: d.baseStamina,
    boost: d.baseBoost,
  };
}

function derivedMotion(stats, def) {
  const P = CONFIG.physics;
  const boostMul = 1 + stats.boost * 0.018;
  return {
    maxSpeed: P.baseMaxSpeed + stats.speed * P.speedPerStat,
    accel: P.baseAccel + stats.acceleration * P.accelPerStat,
    handling: P.baseHandling + stats.handling * P.handlingPerStat,
    boostPower: P.boostSpeedMul * boostMul,
    startBoost: def.ability === "heavy_charge" ? 0.78 : 0.5,
    collisionKeep: def.ability === "power_run" ? 0.62 : P.collisionSpeedKeep,
    boostDrain: def.ability === "snow_dash" ? P.boostDrain * 0.82 : P.boostDrain,
    handlingBoostBonus: def.ability === "quick_step" ? 1.35 : 1,
    staminaRegenBonus: def.ability === "happy_pace" ? 1.25 : 1,
  };
}

function createParticipant({ id, dogId, name, lane, z, isHuman, isBot }) {
  const def = dogDef(dogId);
  const stats = baseStats(dogId);
  const motion = derivedMotion(stats, def);
  const startLane = clampLane(lane == null ? 1 : lane);
  const x = laneX(startLane);
  return {
    id,
    dogId,
    name: name || def.name,
    isHuman: !!isHuman,
    isBot: !!isBot,
    stats,
    motion,
    lane: startLane,
    packOffset: 0,
    x,
    z: z || 0,
    speed: 0,
    finished: false,
    finishPlace: 0,
    finishTime: 0,
    boosting: false,
    boostLatched: false,
    wantBoost: false,
    boostMeter: motion.startBoost,
    stamina: 1,
    shield: false,
    stun: 0,
    mud: 0,
    ice: 0,
    coins: 0,
    hits: 0,
    boostsUsed: 0,
    bounce: 0,
    jumping: false,
    wantJump: false,
    jumpT: 0,
    jumpHeight: 0,
    jumpCooldown: 0,
    laneTimer: 0,
    reaction: 0,
    lean: 0,
  };
}

function addSegment(course, curve, y) {
  const C = CONFIG.race;
  const n = course.segments.length;
  course.segments.push({
    index: n,
    curve,
    colorIndex: Math.floor(n / C.rumbleLength) % 2,
    sprites: [],
  });
  course.lastY = y;
}

function addRoad(course, enter, hold, leave, curve, yEnd) {
  const startY = course.lastY;
  const total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(course, easeInOut(0, curve, n / enter), easeInOut(startY, yEnd, n / total));
  for (let n = 0; n < hold; n++) addSegment(course, curve, easeInOut(startY, yEnd, (enter + n) / total));
  for (let n = 0; n < leave; n++) addSegment(course, easeInOut(curve, 0, n / leave), easeInOut(startY, yEnd, (enter + hold + n) / total));
}

function placeOnRoad(course, rng, track, kind, zMin, zMax, sideBias, forcedLane) {
  const C = CONFIG.race;
  const z = zMin + rng() * Math.max(1, zMax - zMin);
  const segment = course.segments[Math.max(0, Math.min(course.segments.length - 1, Math.floor(z / C.segmentLength)))];
  if (!segment) return;
  let lane = forcedLane;
  let x;
  if (sideBias === "left") x = -1.45 - rng() * 0.4;
  else if (sideBias === "right") x = 1.45 + rng() * 0.4;
  else {
    if (lane == null) lane = Math.floor(rng() * laneCount());
    lane = clampLane(lane);
    x = laneX(lane);
  }
  const item = { kind, lane: sideBias ? -1 : lane, x, z, taken: false, wobble: rng() * Math.PI * 2 };
  if (sideBias) course.scenery.push(item);
  else course.items.push(item);
  segment.sprites.push(item);
}

function buildCourse(track, seed) {
  const C = CONFIG.race;
  const course = {
    track,
    segments: [],
    items: [],
    scenery: [],
    lastY: 0,
    finishZ: track.segments * C.segmentLength,
  };
  const rng = mulberry32(seed >>> 0);
  track.layout.forEach((piece) => addRoad(course, piece.enter, piece.hold, piece.leave, piece.curve, piece.hill));
  while (course.segments.length < track.segments + C.runoffSegments) addSegment(course, 0, course.lastY * 0.92);
  const playable = course.finishZ;
  let obstacleLane = 0;
  const gap = track.obstacleGap || 240;
  const pickupChance = track.pickupDensity != null ? Math.min(0.94, 0.62 + track.pickupDensity) : 0.82;
  for (let z = 640; z < playable - 280; z += gap) {
    const kind = track.obstacles[Math.floor(rng() * track.obstacles.length)];
    placeOnRoad(course, rng, track, kind, z, z + 3, null, obstacleLane);
    obstacleLane = (obstacleLane + 1) % laneCount();
    if (rng() < pickupChance) {
      const roll = rng();
      const pickup = roll > 0.9 ? "shield" : roll > 0.72 ? "boost" : "coin";
      placeOnRoad(course, rng, track, pickup, z + 70, z + 78, null, (obstacleLane + 1) % laneCount());
    }
  }
  return course;
}

function lookAheadItems(course, participant, distance) {
  const found = [];
  for (let i = 0; i < course.items.length; i++) {
    const item = course.items[i];
    if (item.taken) continue;
    const dz = item.z - participant.z;
    if (dz > 8 && dz < distance) found.push(item);
  }
  return found;
}

function raceLeader(race) {
  let best = race.participants[0];
  for (const p of race.participants) {
    if (p.z > best.z) best = p;
  }
  return best;
}

function updateHuman(p, input) {
  if (input.laneDelta) p.lane = clampLane(p.lane + input.laneDelta);
  if ((input.boostRequest || input.boost) && !p.boostLatched && p.boostMeter > 0) p.boostLatched = true;
  p.wantBoost = p.boostLatched && p.boostMeter > 0;
  p.wantJump = !!input.jump;
}

function updateAi(p, race, dt) {
  const cfg = CONFIG.ai;
  const diff = race.difficulty;
  const leader = raceLeader(race);
  p.laneTimer -= dt;
  p.reaction -= dt;
  const ahead = lookAheadItems(race.course, p, cfg.lookAhead);
  const hazards = ahead.filter((item) => item.lane === p.lane && ["crate", "rock", "cone", "log", "puddle", "ice"].includes(item.kind));
  p.wantJump = false;
  if (hazards.length && p.reaction <= 0) {
    p.reaction = cfg.reactionMin + (1 - diff.skill) * (cfg.reactionMax - cfg.reactionMin);
    const mistake = race.rng() < cfg.mistakeChance * (1.15 - diff.skill);
    if (!mistake) {
      if (race.rng() < 0.45) p.wantJump = true;
      else {
        const left = p.lane - 1;
        const right = p.lane + 1;
        const leftClear = left >= 0 && !ahead.some((item) => item.lane === left && !["coin", "boost", "shield"].includes(item.kind));
        const rightClear = right < laneCount() && !ahead.some((item) => item.lane === right && !["coin", "boost", "shield"].includes(item.kind));
        if (leftClear && (!rightClear || race.rng() < 0.5)) p.lane = left;
        else if (rightClear) p.lane = right;
        else p.wantJump = true;
      }
    }
  } else if (p.laneTimer <= 0) {
    p.laneTimer = 1.1 + race.rng() * 1.8;
    if (race.rng() < cfg.wanderChance + (1 - diff.skill) * 0.03) {
      p.lane = clampLane(p.lane + (race.rng() < 0.5 ? -1 : 1));
    }
  }
  const pickups = ahead.filter((item) => ["coin", "boost", "shield"].includes(item.kind));
  if (pickups.length && race.rng() < 0.2 + diff.skill * 0.25) p.lane = clampLane(pickups[0].lane);
  const gap = leader.z - p.z;
  const pressure = gap > 80 || leader.speed > p.speed + 20;
  p.wantBoost = p.boostMeter > 0.28 && ((pressure && race.rng() < cfg.boostChance * 8 * dt * (0.6 + diff.skill)) || p.boostMeter > 0.9);
}

function applyLaneKeep(p, dt) {
  const P = CONFIG.physics;
  const iceMul = p.ice > 0 ? P.iceHandlingMul : 1;
  const boostMul = p.boosting ? p.motion.handlingBoostBonus : 1;
  const handling = p.motion.handling * iceMul * boostMul;
  const target = laneX(p.lane) + (p.packOffset || 0);
  const delta = target - p.x;
  p.x += delta * Math.min(1, handling * dt * 2.4);
  p.lean = clamp(p.lean * 0.8 + delta * 1.4, -1, 1);
}

function applyDrive(p, dt, race) {
  const P = CONFIG.physics;
  if (p.finished) {
    p.speed = Math.max(0, p.speed - P.coastDecel * dt);
    return;
  }
  if (p.stun > 0) {
    p.stun -= dt;
    p.speed = Math.max(30, p.speed - P.stunDecel * dt);
    p.boosting = false;
    p.boostLatched = false;
    return;
  }
  let maxSpeed = p.motion.maxSpeed;
  if (!p.isHuman) {
    const diff = race.difficulty;
    maxSpeed *= diff.speed;
    const leader = raceLeader(race);
    const gap = leader.z - p.z;
    const cfg = CONFIG.ai;
    let rubber = 1;
    if (!leader.finished && gap > cfg.rubberBehindGap) rubber = cfg.catchUpMul;
    if (!leader.finished && gap < -cfg.rubberAheadGap) rubber = cfg.easeMul;
    rubber = clamp(rubber, cfg.rubberClamp[0], cfg.rubberClamp[1]);
    maxSpeed *= rubber;
  }
  if (p.stamina < P.staminaLowThreshold) maxSpeed *= P.staminaLowSpeedMul;
  if (p.mud > 0) {
    p.mud -= dt;
    maxSpeed *= P.mudSpeedMul;
  }
  if (p.ice > 0) p.ice -= dt;
  const wasBoost = p.boosting;
  p.boosting = !!(p.wantBoost && p.boostMeter > 0);
  if (p.boosting) {
    maxSpeed *= p.motion.boostPower;
    p.boostMeter = Math.max(0, p.boostMeter - p.motion.boostDrain * dt);
    if (!wasBoost) p.boostsUsed += 1;
  } else {
    if (p.boostLatched && p.boostMeter <= 0) p.boostLatched = false;
    if (!p.boostLatched) p.boostMeter = Math.min(1, p.boostMeter + P.boostIdleRegen * (0.7 + p.stats.stamina * 0.04) * dt);
  }
  if (p.speed < maxSpeed) p.speed = Math.min(maxSpeed, p.speed + p.motion.accel * dt);
  else p.speed = Math.max(maxSpeed, p.speed - P.coastDecel * dt);
  const effort = clamp(p.speed / Math.max(1, p.motion.maxSpeed), 0, 1.3);
  if (effort > 0.8 || p.boosting) p.stamina = Math.max(0.05, p.stamina - P.staminaDrainAtSpeed * effort * dt);
  else p.stamina = Math.min(1, p.stamina + P.staminaRegen * p.motion.staminaRegenBonus * dt);
  p.z += p.speed * dt;
  p.bounce += dt * (8 + p.speed * 0.05);
  if (p.jumpCooldown > 0) p.jumpCooldown = Math.max(0, p.jumpCooldown - dt);
  if (p.wantJump && !p.jumping && p.jumpCooldown <= 0 && p.stun <= 0) {
    p.jumping = true;
    p.jumpT = 0;
  }
  p.wantJump = false;
  if (p.jumping) {
    p.jumpT += dt;
    const u = p.jumpT / P.jumpDuration;
    if (u >= 1) {
      p.jumping = false;
      p.jumpHeight = 0;
      p.jumpCooldown = P.jumpCooldown;
    } else p.jumpHeight = Math.sin(u * Math.PI);
  }
}

function collideItems(p, race) {
  const P = CONFIG.physics;
  for (const item of race.course.items) {
    if (item.taken) continue;
    const dz = item.z - p.z;
    if (dz < -8 || dz > 16) continue;
    const sameLane = item.lane == null || item.lane < 0
      ? Math.abs(item.x - laneX(p.lane)) < CONFIG.race.laneHitRadius
      : item.lane === p.lane;
    if (!sameLane) continue;
    if (p.jumping && p.jumpHeight > 0.35) continue;
    if (item.kind === "coin") {
      item.taken = true;
      p.coins += 1;
      continue;
    }
    if (item.kind === "boost") {
      item.taken = true;
      p.boostMeter = Math.min(1, p.boostMeter + P.boostPickupBurst);
      continue;
    }
    if (item.kind === "shield") {
      item.taken = true;
      p.shield = true;
      continue;
    }
    if (p.shield) {
      p.shield = false;
      item.taken = true;
      continue;
    }
    if (item.kind === "puddle") {
      item.taken = true;
      p.mud = P.mudDuration;
      p.speed *= 0.7;
      continue;
    }
    if (item.kind === "ice") {
      item.taken = true;
      p.ice = P.iceDuration;
      p.speed *= 0.78;
      continue;
    }
    item.taken = true;
    p.hits += 1;
    p.speed *= p.motion.collisionKeep;
    p.stun = P.collisionStun;
  }
}

function packSameLane(race) {
  const groups = {};
  race.participants.forEach((p) => {
    const key = p.lane + ":" + Math.floor(p.z / 40);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  Object.values(groups).forEach((group) => {
    const n = group.length;
    group.forEach((p, i) => {
      p.packOffset = n <= 1 ? 0 : (i - (n - 1) / 2) * CONFIG.race.packSpacing;
    });
  });
}

function rankParticipants(race) {
  const order = race.participants.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.z - a.z;
  });
  order.forEach((p, i) => {
    if (!p.finished) p.finishPlace = i + 1;
  });
}

export function createRace({ trackId, seed, slots }) {
  const track = trackById(trackId);
  const course = buildCourse(track, seed);
  const difficulty = CONFIG.difficulty[track.aiDifficulty] || CONFIG.difficulty.normal;
  const lanes = [1, 0, 2, 0, 2];
  const participants = slots.map((slot, i) =>
    createParticipant({
      id: slot.id,
      dogId: slot.dogId,
      name: slot.nickname,
      lane: lanes[i % lanes.length],
      z: 200 + (i % 3) * 80,
      isHuman: !slot.isBot,
      isBot: !!slot.isBot,
    })
  );
  return {
    trackId,
    course,
    difficulty,
    rng: mulberry32(seed >>> 0),
    participants,
    time: 0,
    phase: "countdown",
    countdown: CONFIG.race.startHold,
    lastCount: 4,
    finished: false,
    finishOrder: [],
    results: null,
    seed,
  };
}

export function stepRace(race, inputsById, dt) {
  if (race.phase === "countdown") {
    race.countdown -= dt;
    packSameLane(race);
    race.participants.forEach((p) => {
      p.bounce += dt * 6;
      applyLaneKeep(p, dt);
    });
    rankParticipants(race);
    if (race.countdown <= 0) race.phase = "running";
    return race;
  }
  if (race.phase !== "running") return race;
  race.time += dt;
  race.participants.forEach((p) => {
    const input = inputsById[p.id] || { laneDelta: 0, boost: false, jump: false };
    if (p.isHuman) updateHuman(p, input);
    else updateAi(p, race, dt);
    applyLaneKeep(p, dt);
    applyDrive(p, dt, race);
    collideItems(p, race);
    if (!p.finished && p.z >= race.course.finishZ) {
      p.finished = true;
      p.z = race.course.finishZ;
      p.finishTime = race.time;
      race.finishOrder.push(p.id);
      p.finishPlace = race.finishOrder.length;
    }
  });
  packSameLane(race);
  rankParticipants(race);
  const allFinished = race.participants.every((p) => p.finished);
  const anyHumanFinished = race.participants.some((p) => p.isHuman && p.finished);
  const lastHumanFinish = race.participants.filter((p) => p.isHuman && p.finished).map((p) => p.finishTime).sort((a, b) => b - a)[0] || 0;
  if (anyHumanFinished && (allFinished || race.time - lastHumanFinish > CONFIG.race.resultsDelay)) {
    race.phase = "results";
    race.finished = true;
    const ranked = race.participants.slice().sort((a, b) => {
      const at = a.finished ? a.finishTime : 9999;
      const bt = b.finished ? b.finishTime : 9999;
      if (at !== bt) return at - bt;
      return b.z - a.z;
    });
    ranked.forEach((p, i) => {
      p.finishPlace = i + 1;
    });
    race.results = ranked.map((p) => ({
      id: p.id,
      nickname: p.name,
      dogId: p.dogId,
      place: p.finishPlace,
      time: p.finished ? p.finishTime : null,
      coins: p.coins,
      isBot: p.isBot,
    }));
  }
  return race;
}

export function serializeRaceState(race) {
  return {
    tick: race.tick || 0,
    time: race.time,
    phase: race.phase,
    countdown: race.countdown,
    finishZ: race.course.finishZ,
    participants: race.participants.map((p) => ({
      id: p.id,
      dogId: p.dogId,
      nickname: p.name,
      z: p.z,
      lane: p.lane,
      x: p.x,
      speed: p.speed,
      boosting: p.boosting,
      jumpHeight: p.jumpHeight,
      finished: p.finished,
      finishPlace: p.finishPlace,
      coins: p.coins,
      isBot: p.isBot,
    })),
    results: race.results,
  };
}

export const RACE_DT = CONFIG.race.timestep;
