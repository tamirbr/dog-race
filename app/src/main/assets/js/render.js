window.DogRace = window.DogRace || {};

(function () {
  const PARTY = ["#FFD23F", "#FF7A29", "#FF8FAB", "#C084FC", "#4EA2FF", "#7CDE46", "#FFF6D9"];
  const images = {};
  const imageList = [
    "buddy_portrait", "zara_portrait", "rocky_portrait", "luna_portrait", "max_portrait",
    "buddy_back", "zara_back", "rocky_back", "luna_back", "max_back",
    "buddy_run", "zara_run", "rocky_run", "luna_run", "max_run",
    "coin", "boost_pickup", "shield_pickup", "crate", "rock", "cone", "tree",
    "cactus", "puddle", "ice", "log", "finish_banner", "boost_btn",
    "menu_bg", "splash", "app_icon",
  ];

  DogRace.Assets = {
    images,
    ready: false,
    async load() {
      await Promise.all(
        imageList.map(
          (name) =>
            new Promise((resolve) => {
              const img = new Image();
              img.onload = img.onerror = () => resolve();
              img.src = "img/" + name + ".png";
              images[name] = img;
            })
        )
      );
      this.ready = true;
    },
    get(name) {
      return images[name];
    },
  };

  function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    if (p.camera.z <= 0.1) {
      p.screen.scale = 0;
      p.screen.x = 0;
      p.screen.y = 0;
      p.screen.w = 0;
      return;
    }
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = width / 2 + p.screen.scale * p.camera.x * width / 2;
    p.screen.y = height / 2 - p.screen.scale * p.camera.y * height / 2;
    p.screen.w = p.screen.scale * roadWidth * width / 2;
  }

  function polygon(ctx, x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothToward(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-rate * dt));
  }

  function rumbleWidth(w, lanes) {
    return w / Math.max(6, 2 * lanes);
  }

  function laneWidth(w, lanes) {
    return w / Math.max(28, 8 * lanes);
  }

  function spriteName(kind) {
    if (kind === "boost") return "boost_pickup";
    if (kind === "shield") return "shield_pickup";
    return kind;
  }

  function drawSky(ctx, w, h, palette, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h * 0.62);
    g.addColorStop(0, palette.skyTop);
    g.addColorStop(1, palette.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = palette.sun;
    ctx.beginPath();
    ctx.arc(w * 0.78, h * 0.16, h * 0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 210 + t * 12) % (w + 160)) - 80;
      const cy = 36 + (i % 3) * 28;
      cloud(ctx, cx, cy, 34 + (i % 3) * 8);
    }
  }

  function cloud(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.arc(x + r * 0.55, y + 4, r * 0.45, 0, Math.PI * 2);
    ctx.arc(x - r * 0.5, y + 6, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function finishZoneOf(index, finishIndex) {
    if (index === finishIndex || index === finishIndex + 1) return "line";
    return "";
  }

  function drawSegment(ctx, width, lanes, x1, y1, w1, x2, y2, w2, palette, colorIndex, isStart, zone, index) {
    const r1 = rumbleWidth(w1, lanes);
    const r2 = rumbleWidth(w2, lanes);
    const l1 = laneWidth(w1, lanes);
    const l2 = laneWidth(w2, lanes);
    const grass = colorIndex ? palette.grassDark : palette.grassLight;
    polygon(ctx, 0, y1, x1 - w1 - r1, y1, x2 - w2 - r2, y2, 0, y2, grass);
    polygon(ctx, x1 + w1 + r1, y1, width, y1, width, y2, x2 + w2 + r2, y2, grass);

    const rumble = colorIndex ? palette.rumbleDark : palette.rumbleLight;
    polygon(ctx, x1 - w1 - r1, y1, x1 - w1, y1, x2 - w2, y2, x2 - w2 - r2, y2, rumble);
    polygon(ctx, x1 + w1 + r1, y1, x1 + w1, y1, x2 + w2, y2, x2 + w2 + r2, y2, rumble);
    polygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, colorIndex ? palette.roadDark : palette.roadLight);

    if (isStart) {
      polygon(ctx, x1 - w1, y1, x1 + w1, y1, x2 + w2, y2, x2 - w2, y2, "#F8FAFC");
    }
    if (zone === "line") {
      const cols = 16;
      for (let c = 0; c < cols; c++) {
        const a0 = c / cols;
        const a1 = (c + 1) / cols;
        polygon(
          ctx,
          width * a0,
          y1,
          width * a1,
          y1,
          width * a1,
          y2,
          width * a0,
          y2,
          PARTY[(c + index) % PARTY.length]
        );
      }
      polygon(ctx, 0, y1, width, y1, width, y1 + (y2 - y1) * 0.22, 0, y1 + (y2 - y1) * 0.22, "#FFE56A");
      polygon(ctx, 0, y2 - (y2 - y1) * 0.22, width, y2 - (y2 - y1) * 0.22, width, y2, 0, y2, "#FFF6D9");
    }

    if (!colorIndex && zone !== "line") {
      const lanew1 = (w1 * 2) / lanes;
      const lanew2 = (w2 * 2) / lanes;
      let lanex1 = x1 - w1 + lanew1;
      let lanex2 = x2 - w2 + lanew2;
      for (let lane = 1; lane < lanes; lanex1 += lanew1, lanex2 += lanew2, lane++) {
        polygon(ctx, lanex1 - l1 / 2, y1, lanex1 + l1 / 2, y1, lanex2 + l2 / 2, y2, lanex2 - l2 / 2, y2, palette.lane);
      }
    }
  }

  function drawWorldSprite(ctx, img, destX, destY, destW, destH, clipY, bounce, lean) {
    if (!img || !img.width) return;
    let h = destH;
    let srcH = img.height;
    if (clipY && destY + destH > clipY) {
      const cut = destY + destH - clipY;
      h = destH - cut;
      srcH = img.height * (h / destH);
    }
    if (h <= 1) return;
    ctx.save();
    ctx.translate(destX, destY + h);
    ctx.rotate(lean || 0);
    ctx.scale(1, 1 + (bounce || 0));
    ctx.drawImage(img, 0, 0, img.width, srcH, -destW / 2, -h, destW, h);
    ctx.restore();
  }

  function projectSprite(width, height, cameraDepth, roadWidth, scaleMul, x, y, z, cameraX, cameraY, cameraZ) {
    const cz = z - cameraZ;
    if (cz <= 1) return null;
    const scale = cameraDepth / cz;
    return {
      x: width / 2 + scale * (x * roadWidth - cameraX) * width / 2,
      y: height / 2 - scale * (y - cameraY) * height / 2,
      w: scale * roadWidth * width / 2 * scaleMul,
      scale,
    };
  }

  function spriteSit(kind) {
    if (kind === "tree") return 1.16;
    if (kind === "cactus") return 1.14;
    if (kind === "cone") return 1.2;
    if (kind === "crate" || kind === "rock") return 1.2;
    if (kind === "log") return 1.16;
    if (kind === "puddle" || kind === "ice") return 0.42;
    return 1.18;
  }

  function spriteScale(kind) {
    if (kind === "tree") return { mul: 0.36, max: 0.28 };
    if (kind === "cactus") return { mul: 0.24, max: 0.2 };
    if (kind === "puddle" || kind === "ice") return { mul: 0.18, max: 0.1 };
    if (kind === "coin" || kind === "boost" || kind === "shield") return { mul: 0.14, max: 0.13 };
    return { mul: 0.15, max: 0.16 };
  }

  function placeOnSegment(segment, offsetX, width, height, sizeMul, maxFrac, sit, worldZ) {
    if (!segment || !segment.p1.screen || !segment.p1.screen.w) return null;
    const z1 = segment.p1.world.z || 0;
    const z2 = segment.p2.world.z || z1 + 20;
    const t = worldZ == null || z2 === z1 ? 0.55 : Math.max(0, Math.min(1, (worldZ - z1) / (z2 - z1)));
    const roadYRaw = segment.p1.screen.y + (segment.p2.screen.y - segment.p1.screen.y) * t;
    const roadX = segment.p1.screen.x + (segment.p2.screen.x - segment.p1.screen.x) * t;
    const roadW = segment.p1.screen.w + (segment.p2.screen.w - segment.p1.screen.w) * t;
    if (!roadW) return null;
    const destW = Math.min(height * (maxFrac || 0.22), Math.abs(roadW) * sizeMul);
    if (destW < 2) return null;
    const sitVal = sit == null ? 1.08 : sit;
    const roadY = sitVal === 0 ? roadYRaw : Math.min(roadYRaw, height * 0.9);
    let y = roadY - destW * sitVal;
    if (sitVal !== 0) {
      const maxY = height - destW - 10;
      if (y > maxY) y = maxY;
    }
    return {
      x: roadX + roadW * offsetX,
      y,
      w: destW,
    };
  }

  function updateSmoke(race, dt) {
    const puffs = race.smoke || (race.smoke = []);
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      puff.life -= puff.decay * dt;
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.r += puff.grow * dt;
      puff.vy += 18 * dt;
      if (puff.life <= 0) puffs.splice(i, 1);
    }
    if (puffs.length > 80) puffs.splice(0, puffs.length - 80);
  }

  function emitSmoke(race, destX, destY, destW, destH) {
    const puffs = race.smoke || (race.smoke = []);
    const count = 3;
    for (let i = 0; i < count; i++) {
      puffs.push({
        x: destX + (Math.random() - 0.5) * destW * 0.32,
        y: destY + destH * 0.78 + Math.random() * destW * 0.1,
        r: destW * (0.12 + Math.random() * 0.1),
        vx: (Math.random() - 0.5) * 40,
        vy: 48 + Math.random() * 42,
        grow: destW * (0.4 + Math.random() * 0.3),
        decay: 1.2 + Math.random() * 0.65,
        life: 1,
      });
    }
  }

  function drawSmoke(ctx, race) {
    const puffs = race.smoke;
    if (!puffs || !puffs.length) return;
    puffs.forEach((puff) => {
      const a = Math.max(0, puff.life);
      ctx.save();
      ctx.globalAlpha = 0.22 + a * 0.4;
      ctx.fillStyle = a > 0.55 ? "#F3F4F6" : "#9CA3AF";
      ctx.beginPath();
      ctx.ellipse(puff.x, puff.y, puff.r * 1.15, puff.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function ensureParty(race, width, height) {
    if (race.party) return race.party;
    const confetti = [];
    for (let i = 0; i < 90; i++) {
      confetti.push({
        x: Math.random() * width,
        y: -20 - Math.random() * height * 0.4,
        vx: (Math.random() - 0.5) * 160,
        vy: 90 + Math.random() * 160,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 10,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 10,
        color: PARTY[i % PARTY.length],
      });
    }
    const balloons = [];
    for (let i = 0; i < 12; i++) {
      balloons.push({
        x: width * (0.08 + (i % 6) * 0.17) + (Math.random() - 0.5) * 20,
        y: height * (0.55 + Math.random() * 0.35),
        vy: -(38 + Math.random() * 46),
        r: 10 + Math.random() * 12,
        color: PARTY[i % PARTY.length],
        wobble: Math.random() * Math.PI * 2,
      });
    }
    race.party = { confetti, balloons, flash: 1, t: 0 };
    return race.party;
  }

  function updateParty(party, dt, width, height) {
    party.t += dt;
    party.flash = Math.max(0, party.flash - dt * 1.4);
    party.confetti.forEach((bit) => {
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.vy += 70 * dt;
      bit.rot += bit.spin * dt;
      if (bit.y > height + 20) {
        bit.y = -16;
        bit.x = Math.random() * width;
        bit.vy = 80 + Math.random() * 120;
      }
    });
    party.balloons.forEach((b) => {
      b.y += b.vy * dt;
      b.x += Math.sin(party.t * 3 + b.wobble) * 18 * dt;
      if (b.y < -30) {
        b.y = height + 20;
        b.x = Math.random() * width;
      }
    });
  }

  function drawParty(ctx, party, width, height) {
    if (party.flash > 0) {
      ctx.save();
      ctx.globalAlpha = party.flash * 0.42;
      ctx.fillStyle = "#FFF7D6";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    party.balloons.forEach((b) => {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.r);
      ctx.lineTo(b.x, b.y + b.r * 3.2);
      ctx.stroke();
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r * 0.78, b.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    party.confetti.forEach((bit) => {
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.rot);
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
      ctx.restore();
    });
  }

  DogRace.fitCanvas = function (canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: w, height: h, dpr };
  };

  DogRace.renderRace = function (canvas, race, fx) {
    const { ctx, width, height } = DogRace.fitCanvas(canvas);
    const C = DogRace.Config.race;
    const palette = race.track.palette;
    const player = race.player;
    const cameraDepth = 1 / Math.tan(((C.fieldOfView / 2) * Math.PI) / 180);
    const playerSegIndex = Math.max(0, Math.min(race.course.segments.length - 1, Math.floor(player.z / C.segmentLength)));
    const playerSeg = race.course.segments[playerSegIndex];
    const segT = playerSeg ? (player.z / C.segmentLength) - playerSegIndex : 0;
    const playerY = playerSeg
      ? lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, Math.max(0, Math.min(1, segT)))
      : 0;
    const wall = window.performance && performance.now ? performance.now() / 1000 : race.time || 0;
    let dt = 1 / 60;
    if (race._wallTime != null) {
      dt = Math.min(0.05, Math.max(0.001, wall - race._wallTime));
    }
    race._wallTime = wall;
    const targetCamZ = Math.max(0, player.z - C.cameraDistance);
    const targetCamX = player.x * C.roadWidth;
    const targetCamY = C.cameraHeight + playerY;
    if (race.camX == null) race.camX = targetCamX;
    if (race.camY == null) race.camY = targetCamY;
    if (race.camZ == null) race.camZ = targetCamZ;
    race.camX = smoothToward(race.camX, targetCamX, C.cameraFollowX || 10, dt);
    race.camY = smoothToward(race.camY, targetCamY, C.cameraFollowY || 7, dt);
    race.camZ = smoothToward(race.camZ, targetCamZ, C.cameraFollowZ || 12, dt);
    const cameraX = race.camX;
    const cameraY = race.camY;
    const cameraZ = race.camZ;
    const baseIndex = Math.max(0, Math.floor(cameraZ / C.segmentLength));
    const curveScale = C.curveScale == null ? 0.2 : C.curveScale;
    const steps = Math.max(1, C.renderSteps || 4);

    ctx.imageSmoothingEnabled = true;
    drawSky(ctx, width, height, palette, race.time || 0);
    ctx.fillStyle = palette.grassLight;
    ctx.fillRect(0, height * 0.48, width, height * 0.52);

    let maxy = height;
    let x = 0;
    let dx = 0;
    const visible = [];
    const finishIndex = Math.floor(race.course.finishZ / C.segmentLength);

    for (let n = 0; n < C.drawDistance; n++) {
      const index = baseIndex + n;
      if (index >= race.course.segments.length) break;
      const segment = race.course.segments[index];
      project(segment.p1, cameraX - x, cameraY, cameraZ, cameraDepth, width, height, C.roadWidth);
      project(segment.p2, cameraX - x - dx, cameraY, cameraZ, cameraDepth, width, height, C.roadWidth);
      x += dx;
      dx += segment.curve * curveScale;
      segment.clip = maxy;
      segment.fog = n / C.drawDistance;

      if (segment.p1.camera.z <= cameraDepth || segment.p2.screen.y >= segment.p1.screen.y || segment.p2.screen.y >= maxy) {
        continue;
      }

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const x1 = lerp(segment.p1.screen.x, segment.p2.screen.x, t0);
        const y1 = lerp(segment.p1.screen.y, segment.p2.screen.y, t0);
        const w1 = lerp(segment.p1.screen.w, segment.p2.screen.w, t0);
        const x2 = lerp(segment.p1.screen.x, segment.p2.screen.x, t1);
        const y2 = lerp(segment.p1.screen.y, segment.p2.screen.y, t1);
        const w2 = lerp(segment.p1.screen.w, segment.p2.screen.w, t1);
        if (y2 >= y1 || y2 >= maxy) continue;
        drawSegment(
          ctx,
          width,
          C.lanes,
          x1,
          y1,
          w1,
          x2,
          y2,
          w2,
          palette,
          segment.colorIndex,
          index < 12,
          finishZoneOf(index, finishIndex),
          index
        );
        maxy = y2;
      }
      visible.push(segment);
    }

    for (let i = visible.length - 1; i >= 0; i--) {
      const segment = visible[i];
      segment.sprites.forEach((item) => {
        if (item.taken && !item.pop) return;
        if (item.z < cameraZ + 50) return;
        const img = DogRace.Assets.get(spriteName(item.kind));
        const size = spriteScale(item.kind);
        const placed = placeOnSegment(segment, item.x, width, height, size.mul, size.max, spriteSit(item.kind), item.z);
        if (!placed) return;
        const pickup = item.kind === "coin" || item.kind === "boost" || item.kind === "shield";
        const bob = pickup ? Math.sin((race.time || 0) * 6 + item.wobble) * 4 : 0;
        const pop = item.pop ? 1 - item.pop / 0.38 : 0;
        ctx.save();
        ctx.globalAlpha = Math.max(0.2, Math.min(1, placed.w / 22));
        if (pop) {
          ctx.globalAlpha *= Math.max(0, 1 - pop);
          ctx.translate(placed.x, placed.y + placed.w * 0.5);
          ctx.rotate(pop * 1.4);
          ctx.scale(1 + pop * 0.8, 1 - pop * 0.55);
          ctx.translate(-placed.x, -(placed.y + placed.w * 0.5));
        }
        drawWorldSprite(ctx, img, placed.x, placed.y + bob, placed.w, placed.w, height, 0, 0);
        ctx.restore();
      });
    }

    function drawRacer(p, destX, destY, destW, clipY) {
      const spriteKey = (p.def.spriteId || p.def.id) + "_back";
      const img = DogRace.Assets.get(spriteKey);
      const bounce = Math.sin(p.bounce * 2) * 0.06 + (p.boosting ? 0.04 : 0) + (p.jumpHeight || 0) * 0.08;
      const lean = p.hitAnim > 0 ? Math.sin(p.hitAnim * 38) * 0.35 : p.lean * 0.22;
      const destH = destW * (p.hitAnim > 0 ? 1.05 : 1.18);
      if (p.boosting) emitSmoke(race, destX, destY, destW, destH);
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#111827";
      ctx.beginPath();
      ctx.ellipse(destX, destY + destH * 0.92, destW * 0.3, destW * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (p.shield) {
        ctx.save();
        ctx.strokeStyle = "rgba(96,165,250,0.85)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(destX, destY + destH * 0.5, destW * 0.42, destH * 0.48, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      if (p.hitAnim > 0) ctx.globalAlpha = 0.72;
      if (img && img.width) {
        drawWorldSprite(ctx, img, destX, destY, destW, destH, clipY, bounce, lean);
      } else {
        ctx.fillStyle = p.def.accent || "#F4A261";
        ctx.beginPath();
        ctx.ellipse(destX, destY + destH * 0.55, destW * 0.38, destH * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    updateSmoke(race, dt);

    const near = visible[0];
    const feetY = near && near.p1.screen.y
      ? Math.min(near.p1.screen.y, height * 0.88)
      : height * 0.84;
    const playerFeet = Math.max(feetY, height * 0.92);
    const roadHalf = width * 0.34;
    function focusX(offsetX) {
      return width / 2 + (offsetX * C.roadWidth - cameraX) / C.roadWidth * roadHalf;
    }
    function hitJolt(p) {
      return p.hitAnim > 0 ? Math.sin(p.hitAnim * 42) * 10 : 0;
    }

    const dogs = race.participants.slice().sort((a, b) => b.z - a.z);
    dogs.forEach((p) => {
      if (p === player) return;
      if (p.z <= cameraZ + 50) return;
      if (p.z < player.z + 90) {
        const destW = Math.min(width * 0.17, height * 0.26);
        const destY = playerFeet - destW * 1.12 - (p.jumpHeight || 0) * destW * 0.55 + (p.hitAnim > 0 ? 8 : 0);
        drawRacer(p, focusX(p.x) + hitJolt(p), destY, destW, height);
        return;
      }
      const seg = race.course.segments[Math.max(0, Math.min(race.course.segments.length - 1, Math.floor(p.z / C.segmentLength)))];
      const placed = placeOnSegment(seg, p.x, width, height, 0.28, 0.2, 1.08, p.z);
      if (!placed) return;
      drawRacer(p, placed.x + hitJolt(p), placed.y - (p.jumpHeight || 0) * placed.w * 0.7 + (p.hitAnim > 0 ? 8 : 0), placed.w, height);
    });

    const destW = Math.min(width * 0.2, height * 0.3);
    let destY = playerFeet - destW * 1.1 - (player.jumpHeight || 0) * destW * 0.55 + (player.hitAnim > 0 ? 8 : 0);
    destY = Math.min(destY, height - destW * 1.08 - 16);
    drawRacer(player, focusX(player.x) + hitJolt(player), destY, destW, height);
    drawSmoke(ctx, race);
    if (player.finished) {
      const party = ensureParty(race, width, height);
      updateParty(party, dt, width, height);
      drawParty(ctx, party, width, height);
    }

    (race.bursts || []).forEach((burst) => {
      const seg = race.course.segments[Math.max(0, Math.min(race.course.segments.length - 1, Math.floor(burst.z / C.segmentLength)))];
      const placed = placeOnSegment(seg, burst.x, width, height, 0.3, 0.1, 0.35, burst.z);
      if (!placed) return;
      const life = burst.t / 0.4;
      ctx.save();
      ctx.globalAlpha = life;
      for (let i = 0; i < 7; i++) {
        const ang = (i / 7) * Math.PI * 2;
        const dist = (1 - life) * 28;
        ctx.fillStyle = i % 2 ? "#C4A574" : "#F8FAFC";
        ctx.beginPath();
        ctx.arc(placed.x + Math.cos(ang) * dist, placed.y + 10 + Math.sin(ang) * dist, 4 + life * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });

    if (player.boosting) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#FFF7ED";
      for (let i = 0; i < 18; i++) {
        const sx = (i * 97 + (fx.shake * 40 + race.time * 900)) % width;
        ctx.fillRect(sx, 0, 3, height);
      }
      ctx.restore();
    }

    if (fx.shake > 0) {
      /* camera shake applied by caller via canvas transform if needed */
    }

    ctx.fillStyle = "rgba(15,23,42," + Math.min(0.28, (1 - DogRace.progressOf(race, player)) * 0.05) + ")";
    ctx.fillRect(0, 0, width, height * 0.08);
  };

  DogRace.placeOrdinal = function (n) {
    if (DogRace.I18n && DogRace.I18n.place) return DogRace.I18n.place(n);
    const v = n % 100;
    if (v >= 11 && v <= 13) return n + "th";
    switch (n % 10) {
      case 1:
        return n + "st";
      case 2:
        return n + "nd";
      case 3:
        return n + "rd";
      default:
        return n + "th";
    }
  };
})();
