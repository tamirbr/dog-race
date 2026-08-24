window.DogRace = window.DogRace || {};

(function () {
  const Kind = {
    LOCAL: "local",
    AI: "ai",
    REMOTE: "remote",
  };
  DogRace.ParticipantKind = Kind;

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed;
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

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function laneCount() {
    return DogRace.Config.race.lanes;
  }

  function laneX(lane) {
    const lanes = laneCount();
    return (lane - (lanes - 1) / 2) * DogRace.Config.race.laneSpread;
  }

  function clampLane(lane) {
    return clamp(lane | 0, 0, laneCount() - 1);
  }

  function nearestLane(x) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < laneCount(); i++) {
      const d = Math.abs(laneX(i) - x);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  DogRace.laneX = laneX;
  DogRace.clampLane = clampLane;

  function appliedStats(dogId) {
    return DogRace.Save.effectiveStats(dogId);
  }

  function derivedMotion(stats, dogDef) {
    const P = DogRace.Config.physics;
    const boostMul = 1 + stats.boost * 0.018;
    return {
      maxSpeed: P.baseMaxSpeed + stats.speed * P.speedPerStat,
      accel: P.baseAccel + stats.acceleration * P.accelPerStat,
      handling: P.baseHandling + stats.handling * P.handlingPerStat,
      stamina: stats.stamina,
      boostPower: P.boostSpeedMul * boostMul,
      startBoost: dogDef.ability.id === "heavy_charge" ? 0.78 : 0.5,
      collisionKeep: dogDef.ability.id === "power_run" ? 0.62 : P.collisionSpeedKeep,
      boostDrain: dogDef.ability.id === "snow_dash" ? P.boostDrain * 0.82 : P.boostDrain,
      handlingBoostBonus: dogDef.ability.id === "quick_step" ? 1.35 : 1,
      staminaRegenBonus: dogDef.ability.id === "happy_pace" ? 1.25 : 1,
    };
  }

  function createParticipant({ id, kind, dogId, name, lane, z, color }) {
    const def = DogRace.dogById(dogId);
    const stats = appliedStats(dogId);
    const motion = derivedMotion(stats, def);
    const startLane = clampLane(lane == null ? 1 : lane);
    const x = laneX(startLane);
    return {
      id,
      kind,
      dogId,
      name: name || def.name,
      def,
      stats,
      motion,
      lane: startLane,
      packOffset: 0,
      x,
      z: z || 0,
      speed: 0,
      targetX: x,
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
      lean: 0,
      bounce: 0,
      jumping: false,
      wantJump: false,
      jumpT: 0,
      jumpHeight: 0,
      jumpCooldown: 0,
      hitAnim: 0,
      color: color || def.accent,
      laneTimer: 0,
      reaction: 0,
      lastBoostTap: false,
    };
  }

  function addRoad(course, enter, hold, leave, curve, yEnd) {
    const C = DogRace.Config.race;
    const startY = course.lastY;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      addSegment(course, easeInOut(0, curve, n / enter), easeInOut(startY, yEnd, n / total));
    }
    for (let n = 0; n < hold; n++) {
      addSegment(course, curve, easeInOut(startY, yEnd, (enter + n) / total));
    }
    for (let n = 0; n < leave; n++) {
      addSegment(course, easeInOut(curve, 0, n / leave), easeInOut(startY, yEnd, (enter + hold + n) / total));
    }
  }

  function addSegment(course, curve, y) {
    const C = DogRace.Config.race;
    const n = course.segments.length;
    course.segments.push({
      index: n,
      p1: { world: { x: 0, y: course.lastY, z: n * C.segmentLength }, camera: {}, screen: {} },
      p2: { world: { x: 0, y: y, z: (n + 1) * C.segmentLength }, camera: {}, screen: {} },
      curve,
      sprites: [],
      colorIndex: Math.floor(n / C.rumbleLength) % 2,
    });
    course.lastY = y;
  }

  function placeOnRoad(course, rng, track, kind, zMin, zMax, sideBias, forcedLane) {
    const C = DogRace.Config.race;
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
    const item = {
      id: course.items.length + course.scenery.length,
      kind,
      lane: sideBias ? -1 : lane,
      x,
      z,
      taken: false,
      hitBy: {},
      wobble: rng() * Math.PI * 2,
    };
    if (sideBias) course.scenery.push(item);
    else course.items.push(item);
    segment.sprites.push(item);
  }

  DogRace.buildCourse = function (track, seed) {
    const C = DogRace.Config.race;
    const course = {
      track,
      segments: [],
      items: [],
      scenery: [],
      lastY: 0,
      finishZ: track.segments * C.segmentLength,
    };
    const rng = mulberry32(seed != null ? seed : hashString(track.id + ":v1"));
    track.layout.forEach((piece) => {
      addRoad(course, piece.enter, piece.hold, piece.leave, piece.curve, piece.hill);
    });
    while (course.segments.length < track.segments + C.runoffSegments) {
      addSegment(course, 0, course.lastY * 0.92);
    }
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
    for (let i = 16; i < course.segments.length - 8; i += track.sceneryGap) {
      const kind = track.scenery[i % track.scenery.length];
      placeOnRoad(course, rng, track, kind, i * C.segmentLength, i * C.segmentLength + 1, rng() > 0.5 ? "left" : "right");
      if (rng() > 0.55) {
        placeOnRoad(course, rng, track, kind, i * C.segmentLength + 6, i * C.segmentLength + 8, rng() > 0.5 ? "left" : "right");
      }
    }
    return course;
  };

  function currentSegment(course, z) {
    const C = DogRace.Config.race;
    const index = clamp(Math.floor(z / C.segmentLength), 0, course.segments.length - 1);
    return course.segments[index];
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

  function updateRemote(p, world, dt) {
    const target = p.remoteTarget;
    if (!target) return;
    const rate = (DogRace.Config.multiplayer && DogRace.Config.multiplayer.positionLerp) || 12;
    const t = 1 - Math.exp(-rate * dt);
    p.z += (target.z - p.z) * t;
    p.lane += (target.lane - p.lane) * t;
    p.x += (target.x - p.x) * t;
    p.speed += (target.speed - p.speed) * t;
    p.boosting = target.boosting;
    p.jumpHeight = target.jumpHeight || 0;
    if (target.finished) {
      p.finished = true;
      p.finishPlace = target.finishPlace || p.finishPlace;
    }
    p.targetX = laneX(clampLane(Math.round(p.lane)));
  }

  DogRace.applyRemoteSync = function (race, data) {
    if (!race || !data || !data.id) return;
    const p = race.participants.find((r) => r.id === data.id);
    if (!p || p.kind !== Kind.REMOTE) return;
    p.remoteTarget = {
      z: data.z,
      lane: data.lane,
      x: data.x,
      speed: data.speed || 0,
      finished: !!data.finished,
      finishPlace: data.finishPlace || 0,
      boosting: !!data.boosting,
      jumpHeight: data.jumpHeight || 0,
    };
  };

  DogRace.applyServerRaceState = function (race, state, localPlayerId) {
    if (!race || !state) return;
    const prevPhase = race.phase;
    const prevCount = race.lastCount;
    race.phase = state.phase;
    race.time = state.time;
    race.countdown = state.countdown;
    race.serverAuthority = true;
    race.events.length = 0;

    if (state.phase === "countdown") {
      const n = Math.ceil(state.countdown);
      if (n !== prevCount && n > 0 && n <= 3) {
        race.events.push({ type: "count", value: n });
        race.lastCount = n;
      }
    }
    if (prevPhase === "countdown" && state.phase === "running") {
      race.events.push({ type: "go" });
      race.lastCount = 0;
    }

    (state.participants || []).forEach((sp) => {
      let p = race.participants.find((r) => r.id === sp.id);
      if (!p) return;
      const wasZ = p.z;
      p.z = sp.z;
      p.lane = sp.lane;
      p.x = sp.x;
      p.speed = sp.speed;
      p.boosting = sp.boosting;
      p.jumpHeight = sp.jumpHeight || 0;
      p.finished = sp.finished;
      p.finishPlace = sp.finishPlace;
      p.coins = sp.coins || 0;
      p.bounce += 0.12;
      if (!p.finished && sp.finished && p.id === localPlayerId) {
        race.events.push({ type: "finish", who: p });
      }
      if (sp.finished && !p._finishAnnounced) {
        p._finishAnnounced = true;
      }
      if (Math.abs(sp.z - wasZ) > 0.5) p.lean = clamp((sp.z - wasZ) * 0.02, -1, 1);
    });

    packSameLane(race);
    rankParticipants(race);
    race.player = race.participants.find((p) => p.id === localPlayerId) || race.player;
  };

  DogRace.buildMultiplayerResults = function (race, placement, allPlacements) {
    const eco = DogRace.Config.economy;
    const km = DogRace.Config.kidMode || {};
    const kidMul = DogRace.Save && DogRace.Save.data && DogRace.Save.data.settings.kidMode ? (km.coinBonusMul || 1) : 1;
    const place = placement.place;
    const placeCoins = Math.round((eco.placeCoins[place - 1] || 25) * race.track.rewardMultiplier * kidMul);
    const pickedCoins = placement.coins || 0;
    const xp = Math.round(((eco.placeXp[place - 1] || 20) + eco.finishXp) * race.track.rewardMultiplier);
    const stars = place === 1 ? 3 : place <= 3 ? 2 : 1;
    const ranked = (allPlacements || []).slice().sort((a, b) => a.place - b.place).map((row) => {
      const p = race.participants.find((r) => r.id === row.id);
      return {
        id: row.id,
        name: row.nickname || (p && p.name) || row.id,
        place: row.place,
        dogId: row.dogId,
        isBot: row.isBot,
      };
    });
    return {
      place,
      stars,
      field: race.participants.length,
      dogId: race.player.dogId,
      trackId: race.track.id,
      placeCoins,
      pickedCoins,
      totalCoins: placeCoins + pickedCoins,
      xp,
      time: placement.time || race.time,
      hits: race.player.hits,
      boostsUsed: race.player.boostsUsed,
      ranked,
      multiplayer: true,
    };
  };

  function updateLocal(p, input) {
    if (input.laneDelta) p.lane = clampLane(p.lane + input.laneDelta);
    if (input.lane != null) p.lane = clampLane(input.lane);
    if ((input.boostRequest || input.boost) && !p.boostLatched && p.boostMeter > 0) {
      p.boostLatched = true;
    }
    p.wantBoost = p.boostLatched && p.boostMeter > 0;
    p.wantJump = !!input.jump;
  }

  function updateAi(p, world, dt) {
    const cfg = DogRace.Config.ai;
    const diff = world.difficulty;
    p.laneTimer -= dt;
    p.reaction -= dt;

    const ahead = lookAheadItems(world.course, p, cfg.lookAhead);
    const hazards = ahead.filter((item) => item.lane === p.lane && ["crate", "rock", "cone", "log", "puddle", "ice"].indexOf(item.kind) >= 0);
    p.wantJump = false;
    if (hazards.length && p.reaction <= 0) {
      p.reaction = cfg.reactionMin + (1 - diff.skill) * (cfg.reactionMax - cfg.reactionMin);
      const mistake = world.rng() < cfg.mistakeChance * (1.15 - diff.skill);
      if (!mistake) {
        if (world.rng() < 0.45) {
          p.wantJump = true;
        } else {
          const left = p.lane - 1;
          const right = p.lane + 1;
          const leftClear = left >= 0 && !ahead.some((item) => item.lane === left && item.kind !== "coin" && item.kind !== "boost" && item.kind !== "shield");
          const rightClear = right < laneCount() && !ahead.some((item) => item.lane === right && item.kind !== "coin" && item.kind !== "boost" && item.kind !== "shield");
          if (leftClear && (!rightClear || world.rng() < 0.5)) p.lane = left;
          else if (rightClear) p.lane = right;
          else p.wantJump = true;
        }
      }
    } else if (p.laneTimer <= 0) {
      p.laneTimer = 1.1 + world.rng() * 1.8;
      if (world.rng() < cfg.wanderChance + (1 - diff.skill) * 0.03) {
        p.lane = clampLane(p.lane + (world.rng() < 0.5 ? -1 : 1));
      }
    }

    const pickups = ahead.filter((item) => item.kind === "coin" || item.kind === "boost" || item.kind === "shield");
    if (pickups.length && world.rng() < 0.2 + diff.skill * 0.25) {
      p.lane = clampLane(pickups[0].lane);
    }

    const gap = world.player.z - p.z;
    const pressure = gap > 80 || world.player.speed > p.speed + 20;
    p.wantBoost = p.boostMeter > 0.28 && ((pressure && world.rng() < cfg.boostChance * 8 * dt * (0.6 + diff.skill)) || p.boostMeter > 0.9);
  }

  function applyLaneKeep(p, dt) {
    const iceMul = p.ice > 0 ? DogRace.Config.physics.iceHandlingMul : 1;
    const boostMul = p.boosting ? p.motion.handlingBoostBonus : 1;
    const handling = p.motion.handling * iceMul * boostMul;
    const target = laneX(p.lane) + (p.packOffset || 0);
    const delta = target - p.x;
    const step = Math.min(1, handling * dt * 2.4);
    p.x += delta * step;
    p.lean = clamp(p.lean * 0.8 + delta * 1.4, -1, 1);
  }

  function applyDrive(p, dt, world) {
    const P = DogRace.Config.physics;
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
    if (p.kind === Kind.AI) {
      const diff = world.difficulty;
      maxSpeed *= diff.speed;
      const gap = world.player.z - p.z;
      const cfg = DogRace.Config.ai;
      let rubber = 1;
      if (!world.player.finished && gap > cfg.rubberBehindGap) rubber = cfg.catchUpMul;
      if (!world.player.finished && gap < -cfg.rubberAheadGap) rubber = cfg.easeMul;
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
      if (!wasBoost) {
        p.boostsUsed += 1;
        world.events.push({ type: "boost", who: p });
      }
    } else {
      if (p.boostLatched && p.boostMeter <= 0) p.boostLatched = false;
      if (!p.boostLatched) {
        p.boostMeter = Math.min(1, p.boostMeter + P.boostIdleRegen * (0.7 + p.stats.stamina * 0.04) * dt);
      }
    }

    const offRoad = false;
    if (offRoad) maxSpeed *= 0.72;

    if (p.speed < maxSpeed) p.speed = Math.min(maxSpeed, p.speed + p.motion.accel * dt);
    else p.speed = Math.max(maxSpeed, p.speed - P.coastDecel * dt);
    if (offRoad) p.speed = Math.max(40, p.speed - P.offRoadDecel * dt);

    const effort = clamp(p.speed / Math.max(1, p.motion.maxSpeed), 0, 1.3);
    if (effort > 0.8 || p.boosting) {
      p.stamina = Math.max(0.05, p.stamina - P.staminaDrainAtSpeed * effort * dt);
    } else {
      p.stamina = Math.min(1, p.stamina + P.staminaRegen * p.motion.staminaRegenBonus * dt);
    }

    p.z += p.speed * dt;
    p.bounce += dt * (8 + p.speed * 0.05);
    if (p.hitAnim > 0) p.hitAnim = Math.max(0, p.hitAnim - dt);
    if (p.jumpCooldown > 0) p.jumpCooldown = Math.max(0, p.jumpCooldown - dt);
    if (p.wantJump && !p.jumping && p.jumpCooldown <= 0 && p.stun <= 0) {
      p.jumping = true;
      p.jumpT = 0;
      world.events.push({ type: "jump", who: p });
    }
    p.wantJump = false;
    if (p.jumping) {
      p.jumpT += dt;
      const u = p.jumpT / P.jumpDuration;
      if (u >= 1) {
        p.jumping = false;
        p.jumpHeight = 0;
        p.jumpCooldown = P.jumpCooldown;
      } else {
        p.jumpHeight = Math.sin(u * Math.PI);
      }
    }
  }

  function collideItems(p, world) {
    const P = DogRace.Config.physics;
    for (let i = 0; i < world.course.items.length; i++) {
      const item = world.course.items[i];
      if (item.taken) continue;
      const dz = item.z - p.z;
      if (dz < -8 || dz > 16) continue;
      const sameLane = item.lane == null || item.lane < 0
        ? Math.abs(item.x - laneX(p.lane)) < (DogRace.Config.race.laneHitRadius || 0.28)
        : item.lane === p.lane;
      if (!sameLane) continue;

      if (item.kind === "coin") {
        item.taken = true;
        p.coins += DogRace.Config.economy.coinPickupValue;
        world.events.push({ type: "coin", who: p, item });
      } else if (item.kind === "boost") {
        if (p.boosting || p.boostLatched) continue;
        item.taken = true;
        p.boostMeter = Math.min(1, p.boostMeter + P.boostFillPickup);
        p.speed += 40;
        world.events.push({ type: "pickup", who: p, item });
      } else if (item.kind === "shield") {
        item.taken = true;
        p.shield = true;
        world.events.push({ type: "pickup", who: p, item });
      } else if (p.jumping && p.jumpHeight > 0.25) {
        continue;
      } else if (item.kind === "puddle") {
        smashObstacle(item, p, world, "hazard");
        p.mud = P.mudDuration;
        p.speed *= 0.7;
      } else if (item.kind === "ice") {
        smashObstacle(item, p, world, "hazard");
        p.ice = P.iceDuration;
        p.speed *= 0.78;
      } else if (p.shield) {
        smashObstacle(item, p, world, "block");
        p.shield = false;
      } else {
        smashObstacle(item, p, world, "crash");
        p.speed *= p.motion.collisionKeep;
        p.stun = P.collisionStun;
        p.hitAnim = 0.5;
        p.hits += 1;
      }
    }
  }

  function smashObstacle(item, p, world, type) {
    item.taken = true;
    item.pop = 0.38;
    world.bursts.push({ x: item.x, z: item.z, t: 0.4, kind: item.kind });
    world.events.push({ type, who: p, item });
  }

  function tickEffects(world, dt) {
    world.course.items.forEach((item) => {
      if (item.pop) item.pop = Math.max(0, item.pop - dt);
    });
    world.bursts = (world.bursts || []).filter((burst) => {
      burst.t -= dt;
      return burst.t > 0;
    });
  }

  function packSameLane(world) {
    const buckets = {};
    world.participants.forEach((p) => {
      const key = p.lane + ":" + Math.round(p.z / 28);
      (buckets[key] = buckets[key] || []).push(p);
    });
    Object.keys(buckets).forEach((key) => {
      const group = buckets[key].sort((a, b) => (a.id < b.id ? -1 : 1));
      const n = group.length;
      group.forEach((p, i) => {
        p.packOffset = n <= 1 ? 0 : (i - (n - 1) / 2) * DogRace.Config.race.packSpacing;
      });
    });
  }

  function rankParticipants(world) {
    const order = world.participants.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.z - a.z;
    });
    order.forEach((p, i) => {
      if (!p.finished) p.finishPlace = i + 1;
    });
    return order;
  }

  function raceDifficulty(trackDiff) {
    const base = DogRace.Config.difficulty[trackDiff] || DogRace.Config.difficulty.normal;
    if (!DogRace.Save || !DogRace.Save.data || !DogRace.Save.data.settings.kidMode) return base;
    const km = DogRace.Config.kidMode || {};
    return {
      speed: base.speed * (km.aiSpeedMul || 0.88),
      skill: base.skill * (km.aiSkillMul || 0.82),
      label: base.label,
    };
  }

  DogRace.createRace = function ({ track, playerDogId, fieldSize, participants, seed, multiplayer, startAt, serverAuthority }) {
    const course = DogRace.buildCourse(track, seed);
    const difficulty = raceDifficulty(track.aiDifficulty);
    let field;
    let player;

    if (participants && participants.length) {
      field = participants.map((spec) =>
        createParticipant({
          id: spec.id,
          kind: spec.kind,
          dogId: spec.dogId,
          name: spec.name,
          lane: spec.lane,
          z: spec.z,
        })
      );
      player = field.find((p) => p.kind === Kind.LOCAL) || field[0];
    } else {
      player = createParticipant({
        id: "player",
        kind: Kind.LOCAL,
        dogId: playerDogId,
        name: DogRace.Save.dogName(playerDogId),
        lane: 1,
        z: 200,
      });
      const opponents = [];
      const pool = DogRace.Dogs.filter((d) => d.id !== playerDogId);
      const extras = DogRace.Dogs.slice();
      while (pool.length < fieldSize - 1) pool.push(extras[pool.length % extras.length]);
      const aiStarts = [
        { lane: 0, z: 420 },
        { lane: 2, z: 380 },
        { lane: 1, z: 500 },
        { lane: 0, z: 460 },
        { lane: 2, z: 340 },
      ];
      for (let i = 0; i < fieldSize - 1; i++) {
        const dog = pool[i % pool.length];
        const slot = aiStarts[i % aiStarts.length];
        opponents.push(
          createParticipant({
            id: "ai-" + i,
            kind: Kind.AI,
            dogId: dog.id,
            name: dog.name,
            lane: slot.lane,
            z: slot.z,
          })
        );
      }
      field = [player].concat(opponents);
    }

    field.slice().sort((a, b) => b.z - a.z).forEach((p, i) => {
      p.finishPlace = i + 1;
    });

    const raceSeed = seed != null ? seed : hashString(track.id + playerDogId + Date.now());

    return {
      track,
      course,
      difficulty,
      rng: mulberry32(raceSeed),
      participants: field,
      player,
      events: [],
      time: 0,
      phase: "countdown",
      countdown: DogRace.Config.race.startHold,
      lastCount: 4,
      finished: false,
      results: null,
      bursts: [],
      multiplayer: !!multiplayer,
      startAt: startAt || 0,
      serverAuthority: !!serverAuthority,
    };
  };

  DogRace.stepRace = function (race, input, dt) {
    race.events.length = 0;
    if (race.phase === "countdown") {
      race.countdown -= dt;
      const n = Math.ceil(race.countdown);
      if (n !== race.lastCount && n > 0 && n <= 3) {
        race.events.push({ type: "count", value: n });
        race.lastCount = n;
      }
      packSameLane(race);
      race.participants.forEach((p) => {
        p.bounce += dt * 6;
        applyLaneKeep(p, dt);
      });
      rankParticipants(race);
      if (race.countdown <= 0) {
        race.phase = "running";
        race.events.push({ type: "go" });
      }
      return race;
    }
    if (race.phase !== "running") return race;

    race.time += dt;
    const world = race;
    race.participants.forEach((p) => {
      if (p.kind === Kind.LOCAL) updateLocal(p, input);
      else if (p.kind === Kind.AI) updateAi(p, world, dt);
      else if (p.kind === Kind.REMOTE) updateRemote(p, world, dt);
      applyLaneKeep(p, dt);
      applyDrive(p, dt, world);
      collideItems(p, world);
      if (!p.finished && p.z >= race.course.finishZ) {
        p.finished = true;
        p.z = race.course.finishZ;
        p.finishTime = race.time;
        race.events.push({ type: "finish", who: p });
      }
    });
    tickEffects(world, dt);
    packSameLane(world);
    rankParticipants(race);

    const finishedCount = race.participants.filter((p) => p.finished).length;
    if (race.player.finished && (finishedCount === race.participants.length || race.time - race.player.finishTime > DogRace.Config.race.resultsDelay)) {
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
      race.results = DogRace.buildResults(race);
      race.events.push({ type: "results" });
    }
    return race;
  };

  DogRace.buildResults = function (race) {
    const place = race.player.finishPlace;
    const eco = DogRace.Config.economy;
    const km = DogRace.Config.kidMode || {};
    const kidMul = DogRace.Save && DogRace.Save.data && DogRace.Save.data.settings.kidMode ? (km.coinBonusMul || 1) : 1;
    const placeCoins = Math.round((eco.placeCoins[place - 1] || 25) * race.track.rewardMultiplier * kidMul);
    const pickedCoins = race.player.coins;
    const xp = Math.round(((eco.placeXp[place - 1] || 20) + eco.finishXp) * race.track.rewardMultiplier);
    const stars = place === 1 ? 3 : place <= 3 ? 2 : 1;
    return {
      place,
      stars,
      field: race.participants.length,
      dogId: race.player.dogId,
      trackId: race.track.id,
      placeCoins,
      pickedCoins,
      totalCoins: placeCoins + pickedCoins,
      xp,
      time: race.player.finishTime,
      hits: race.player.hits,
      boostsUsed: race.player.boostsUsed,
      ranked: race.participants.slice().sort((a, b) => a.finishPlace - b.finishPlace),
    };
  };

  DogRace.progressOf = function (race, p) {
    return clamp(p.z / race.course.finishZ, 0, 1);
  };
})();
