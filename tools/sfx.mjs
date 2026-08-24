import fs from "fs";
import path from "path";

const DEST = path.resolve("app/src/main/assets/audio");
const SR = 44100;
fs.mkdirSync(DEST, { recursive: true });

function writeWav(name, samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SR, 24);
  buffer.writeUInt32LE(SR * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(path.join(DEST, name), buffer);
}

function env(t, attack, length, release) {
  if (t < attack) return t / Math.max(0.0001, attack);
  if (t > length - release) return Math.max(0, (length - t) / Math.max(0.0001, release));
  return 1;
}

function osc(freq, length, { type = "sine", vol = 0.3, slide = 0, attack = 0.012, release = 0.08, vib = 0 } = {}) {
  const n = Math.floor(length * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq + slide * t + Math.sin(t * 28) * vib;
    phase += (2 * Math.PI * f) / SR;
    let v = Math.sin(phase);
    if (type === "tri") v = 2 * Math.asin(Math.sin(phase)) / Math.PI;
    else if (type === "square") v = Math.sin(phase) > 0 ? 0.55 : -0.55;
    else if (type === "saw") v = 2 * ((phase / (Math.PI * 2)) % 1) - 1;
    else if (type === "noise") v = Math.random() * 2 - 1;
    out[i] = v * vol * env(t, attack, length, release);
  }
  return out;
}

function mix(...parts) {
  const len = Math.max(...parts.map((p) => p.length));
  const out = new Float32Array(len);
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) out[i] += p[i];
  }
  let peak = 0.001;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = Math.min(1, 0.9 / peak);
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

function concat(gap, ...parts) {
  const pad = Math.floor(gap * SR);
  let total = pad * Math.max(0, parts.length - 1);
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length + pad;
  }
  return out;
}

function place(base, part, at) {
  const off = Math.floor(at * SR);
  const out = new Float32Array(Math.max(base.length, off + part.length));
  out.set(base, 0);
  for (let i = 0; i < part.length; i++) out[off + i] += part[i];
  return out;
}

function bark(start = 320, end = 140, length = 0.16, vol = 0.38) {
  return mix(
    osc(start, length, { type: "sine", vol, slide: end - start, attack: 0.008, release: 0.07, vib: 8 }),
    osc(start * 0.5, length * 1.05, { type: "tri", vol: vol * 0.55, slide: (end - start) * 0.4, attack: 0.01, release: 0.08 }),
    osc(900, 0.04, { type: "noise", vol: vol * 0.18, attack: 0.002, release: 0.03 })
  );
}

function woofPair() {
  return mix(place(bark(340, 150, 0.13, 0.4), bark(280, 130, 0.14, 0.34), 0.12));
}

writeWav("click.wav", osc(740, 0.07, { type: "sine", vol: 0.28, attack: 0.004, release: 0.05 }));
writeWav("coin.wav", mix(
  osc(1046, 0.11, { type: "sine", vol: 0.26, attack: 0.004, release: 0.08 }),
  osc(1568, 0.16, { type: "sine", vol: 0.2, attack: 0.006, release: 0.1 }),
  osc(2093, 0.1, { type: "tri", vol: 0.08, attack: 0.002, release: 0.08 })
));
writeWav("boost.wav", mix(
  osc(140, 0.42, { type: "saw", vol: 0.12, slide: 520, attack: 0.01, release: 0.18 }),
  osc(90, 0.36, { type: "noise", vol: 0.14, attack: 0.005, release: 0.2 }),
  osc(420, 0.28, { type: "sine", vol: 0.1, slide: 260, attack: 0.02, release: 0.12 })
));
writeWav("jump.wav", mix(
  osc(220, 0.22, { type: "sine", vol: 0.22, slide: 340, attack: 0.008, release: 0.12 }),
  osc(80, 0.18, { type: "noise", vol: 0.12, attack: 0.004, release: 0.14 }),
  osc(520, 0.14, { type: "tri", vol: 0.1, slide: 180, attack: 0.01, release: 0.08 })
));
writeWav("crash.wav", mix(
  osc(70, 0.32, { type: "noise", vol: 0.36, attack: 0.002, release: 0.22 }),
  osc(160, 0.18, { type: "tri", vol: 0.2, slide: -90, attack: 0.003, release: 0.12 }),
  osc(90, 0.22, { type: "sine", vol: 0.18, slide: -40, attack: 0.004, release: 0.16 })
));
writeWav("pickup.wav", mix(
  osc(659, 0.1, { type: "sine", vol: 0.22, attack: 0.005, release: 0.07 }),
  osc(880, 0.14, { type: "sine", vol: 0.18, attack: 0.008, release: 0.09 })
));
writeWav("bark.wav", woofPair());
writeWav("yelp.wav", mix(
  osc(620, 0.18, { type: "sine", vol: 0.34, slide: -380, attack: 0.006, release: 0.08, vib: 18 }),
  osc(310, 0.16, { type: "tri", vol: 0.18, slide: -160, attack: 0.008, release: 0.08 })
));
writeWav("cheer.wav", concat(0.07, bark(360, 170, 0.11, 0.32), bark(400, 180, 0.1, 0.3), bark(460, 200, 0.13, 0.34)));
writeWav("whine.wav", mix(
  osc(480, 0.34, { type: "sine", vol: 0.26, slide: -220, attack: 0.02, release: 0.16, vib: 12 }),
  osc(240, 0.38, { type: "tri", vol: 0.14, slide: -80, attack: 0.03, release: 0.18 })
));
writeWav("countdown.wav", mix(
  osc(392, 0.2, { type: "sine", vol: 0.24, attack: 0.01, release: 0.12 }),
  osc(784, 0.18, { type: "sine", vol: 0.16, attack: 0.012, release: 0.1 })
));
writeWav("go.wav", mix(
  osc(523, 0.26, { type: "sine", vol: 0.22, attack: 0.01, release: 0.14 }),
  osc(784, 0.26, { type: "sine", vol: 0.18, attack: 0.012, release: 0.14 }),
  osc(1046, 0.22, { type: "tri", vol: 0.12, attack: 0.01, release: 0.12 }),
  bark(380, 160, 0.14, 0.22)
));
writeWav("finish.wav", mix(
  osc(659, 0.2, { type: "sine", vol: 0.2, attack: 0.01, release: 0.12 }),
  osc(880, 0.24, { type: "sine", vol: 0.18, attack: 0.012, release: 0.14 }),
  osc(1175, 0.28, { type: "tri", vol: 0.12, attack: 0.014, release: 0.16 })
));
writeWav(
  "win.wav",
  concat(
    0.045,
    osc(523, 0.12, { type: "sine", vol: 0.22, attack: 0.008, release: 0.06 }),
    osc(659, 0.12, { type: "sine", vol: 0.22, attack: 0.008, release: 0.06 }),
    osc(784, 0.12, { type: "sine", vol: 0.22, attack: 0.008, release: 0.06 }),
    mix(
      osc(1046, 0.32, { type: "sine", vol: 0.24, attack: 0.01, release: 0.18 }),
      osc(1318, 0.28, { type: "tri", vol: 0.1, attack: 0.012, release: 0.16 })
    )
  )
);
writeWav(
  "lose.wav",
  concat(
    0.06,
    osc(392, 0.18, { type: "sine", vol: 0.2, slide: -30, attack: 0.015, release: 0.1 }),
    osc(311, 0.26, { type: "sine", vol: 0.18, slide: -50, attack: 0.02, release: 0.14 })
  )
);

function addInto(buf, part, at) {
  const off = Math.floor(at * SR);
  for (let i = 0; i < part.length && off + i < buf.length; i++) buf[off + i] += part[i];
}

function normalize(buf, peakTarget = 0.86) {
  let peak = 0.001;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const g = peakTarget / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

function kick(vol = 0.22) {
  return mix(
    osc(150, 0.11, { type: "sine", vol, slide: -110, attack: 0.002, release: 0.07 }),
    osc(68, 0.08, { type: "sine", vol: vol * 0.55, slide: -36, attack: 0.001, release: 0.05 })
  );
}

function snare(vol = 0.15) {
  return mix(
    osc(210, 0.07, { type: "noise", vol, attack: 0.001, release: 0.05 }),
    osc(240, 0.045, { type: "tri", vol: vol * 0.35, attack: 0.001, release: 0.03 })
  );
}

function hat(vol = 0.055, length = 0.028) {
  return osc(7200, length, { type: "noise", vol, attack: 0.001, release: Math.max(0.012, length * 0.75) });
}

function woodblock(freq = 880, vol = 0.08) {
  return osc(freq, 0.045, { type: "tri", vol, attack: 0.001, release: 0.03 });
}

function boing(freq = 520, vol = 0.1) {
  return osc(freq, 0.2, { type: "sine", vol, slide: -freq * 0.42, attack: 0.004, release: 0.12, vib: 7 });
}

function plink(freq, length, vol = 0.09) {
  return mix(
    osc(freq, length, { type: "sine", vol, attack: 0.006, release: length * 0.55 }),
    osc(freq * 2, length * 0.7, { type: "sine", vol: vol * 0.28, attack: 0.004, release: length * 0.5 })
  );
}

const raceBpm = 158;
const raceBeat = 60 / raceBpm;
const raceBars = 8;
const race = new Float32Array(Math.floor(raceBars * 4 * raceBeat * SR));
const raceBassA = [110, 110, 130, 110, 110, 146, 130, 110];
const raceBassB = [98, 98, 110, 98, 87, 98, 110, 130];
const raceLeadA = [440, 523, 659, 523, 440, 392, 523, 440];
const raceLeadB = [523, 659, 784, 659, 587, 523, 659, 523];
for (let bar = 0; bar < raceBars; bar++) {
  const bassLine = bar % 4 < 2 ? raceBassA : raceBassB;
  const lead = bar >= 4 ? raceLeadB : raceLeadA;
  for (let i = 0; i < 4; i++) {
    const t = (bar * 4 + i) * raceBeat;
    addInto(race, kick(i === 0 || i === 2 ? 0.24 : 0.18), t);
    if (i === 1 || i === 3) addInto(race, snare(0.16), t);
    addInto(race, hat(0.05, 0.022), t);
    addInto(race, hat(0.032, 0.016), t + raceBeat * 0.5);
    if (bar >= 2) {
      addInto(race, hat(0.024, 0.012), t + raceBeat * 0.25);
      addInto(race, hat(0.024, 0.012), t + raceBeat * 0.75);
    }
    const root = bassLine[i * 2];
    const off = bassLine[i * 2 + 1];
    addInto(race, osc(root, raceBeat * 0.42, { type: "saw", vol: 0.07, attack: 0.008, release: 0.08 }), t);
    addInto(race, osc(off, raceBeat * 0.38, { type: "saw", vol: 0.06, attack: 0.008, release: 0.07 }), t + raceBeat * 0.5);
    const leadNote = lead[i * 2];
    const leadOff = lead[i * 2 + 1];
    addInto(race, osc(leadNote, raceBeat * 0.36, { type: "tri", vol: 0.075, attack: 0.006, release: 0.08 }), t);
    addInto(race, osc(leadOff, raceBeat * 0.3, { type: "square", vol: 0.04, attack: 0.005, release: 0.06 }), t + raceBeat * 0.5);
    if (bar >= 4) {
      addInto(race, osc(leadNote * 2, raceBeat * 0.22, { type: "sine", vol: 0.035, attack: 0.004, release: 0.05 }), t + raceBeat * 0.25);
    }
  }
  if (bar === 3 || bar === 7) {
    addInto(race, osc(220, raceBeat * 1.2, { type: "noise", vol: 0.045, slide: 900, attack: 0.01, release: 0.2 }), (bar * 4 + 2) * raceBeat);
  }
}
writeWav("music.wav", normalize(race, 0.88));
console.log("Wrote richer audio to", DEST);
