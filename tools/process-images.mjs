import fs from "fs";
import path from "path";
import zlib from "zlib";

const SRC = path.resolve(
  process.env.USERPROFILE || "",
  ".cursor/projects/c-Users-tamir-b-git-dog-race/assets"
);
const DEST = path.resolve("app/src/main/assets/img");

const COPY_AS_IS = new Set([
  "title_logo.png",
]);

const MAX_WIDTH = {
  "app_icon.png": 512,
  "menu_bg.png": 1600,
  "splash.png": 1600,
  "buddy_portrait.png": 512,
  "zara_portrait.png": 512,
  "rocky_portrait.png": 512,
  "luna_portrait.png": 512,
  "max_portrait.png": 512,
  "buddy_back.png": 420,
  "zara_back.png": 420,
  "rocky_back.png": 420,
  "luna_back.png": 420,
  "max_back.png": 420,
  "buddy_run.png": 420,
  "zara_run.png": 420,
  "rocky_run.png": 420,
  "luna_run.png": 420,
  "max_run.png": 420,
  "finish_banner.png": 720,
  default: 320,
};

function scaleTo(img, maxW) {
  if (!maxW || img.width <= maxW) return img;
  const scale = maxW / img.width;
  const width = maxW;
  const height = Math.max(1, Math.round(img.height * scale));
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const sy = Math.min(img.height - 1, Math.floor(y / scale));
      img.data.copy(data, (y * width + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return { width, height, data };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function readCrcIgnoredChunk(buf, offset) {
  const length = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  const data = buf.subarray(offset + 8, offset + 8 + length);
  return { type, data, next: offset + 12 + length };
}

function decodePng(buf) {
  if (buf.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("Not a PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  const idat = [];
  while (offset < buf.length) {
    const chunk = readCrcIgnoredChunk(buf, offset);
    offset = chunk.next;
    if (chunk.type === "IHDR") {
      width = chunk.data.readUInt32BE(0);
      height = chunk.data.readUInt32BE(4);
      depth = chunk.data[8];
      colorType = chunk.data[9];
    } else if (chunk.type === "IDAT") {
      idat.push(chunk.data);
    } else if (chunk.type === "IEND") {
      break;
    }
  }
  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("Unsupported PNG format " + colorType + "/" + depth);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const recon = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? recon[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let x = row[i];
      if (filter === 1) x = (x + left) & 255;
      else if (filter === 2) x = (x + up) & 255;
      else if (filter === 3) x = (x + ((left + up) >> 1)) & 255;
      else if (filter === 4) x = (x + paeth(left, up, upLeft)) & 255;
      recon[i] = x;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      rgba[di] = recon[si];
      rgba[di + 1] = recon[si + 1];
      rgba[di + 2] = recon[si + 2];
      rgba[di + 3] = bpp === 4 ? recon[si + 3] : 255;
    }
    prev = recon;
  }
  return { width, height, data: rgba };
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, data) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function isNearWhite(r, g, b, a, threshold) {
  if (a < 8) return true;
  return r >= threshold && g >= threshold && b >= threshold;
}

function removeEdgeBackground(img, threshold = 246) {
  const { width, height, data } = img;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const idx = (x, y) => (y * width + x) * 4;
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (visited[i]) return;
    const p = idx(x, y);
    if (!isNearWhite(data[p], data[p + 1], data[p + 2], data[p + 3], threshold)) return;
    visited[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i / width) | 0;
    data[i * 4 + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

fs.mkdirSync(DEST, { recursive: true });
if (!fs.existsSync(SRC)) {
  console.error("Missing source folder", SRC);
  process.exit(1);
}
const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".png"));
for (const file of files) {
  const input = fs.readFileSync(path.join(SRC, file));
  const destPath = path.join(DEST, file);
  try {
    let png = decodePng(input);
    if (!COPY_AS_IS.has(file)) removeEdgeBackground(png);
    png = scaleTo(png, MAX_WIDTH[file] || MAX_WIDTH.default);
    fs.writeFileSync(destPath, encodePng(png.width, png.height, png.data));
    console.log("processed", file, png.width + "x" + png.height);
  } catch (err) {
    fs.writeFileSync(destPath, input);
    console.log("copied-fallback", file, err.message);
  }
}
