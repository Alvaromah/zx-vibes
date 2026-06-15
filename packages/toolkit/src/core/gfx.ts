import { rgbaToPNG } from './screen.js';

export interface GfxCandidate {
  start: number;
  end: number;
  len: number;
  kind: 'screen' | 'font' | 'sprite-or-tile' | 'data';
  entropy: number;
  nonZeroRatio: number;
  score: number;
}

const NORMAL = [
  [0, 0, 0],
  [0, 0, 205],
  [205, 0, 0],
  [205, 0, 205],
  [0, 205, 0],
  [0, 205, 205],
  [205, 205, 0],
  [205, 205, 205],
] as const;
const BRIGHT = [
  [0, 0, 0],
  [0, 0, 255],
  [255, 0, 0],
  [255, 0, 255],
  [0, 255, 0],
  [0, 255, 255],
  [255, 255, 0],
  [255, 255, 255],
] as const;

export function spectrumScreenPng(screen: Uint8Array, attrs: Uint8Array, scale: number): Buffer {
  const rgba = new Uint8Array(256 * 192 * 4);
  for (let y = 0; y < 192; y++) {
    for (let xb = 0; xb < 32; xb++) {
      const byte = screen[screenOffset(y, xb)] ?? 0;
      const attr = attrs[(y >> 3) * 32 + xb] ?? 0x38;
      const ink = attr & 0x07;
      const paper = (attr >> 3) & 0x07;
      const bright = (attr & 0x40) !== 0;
      for (let bit = 0; bit < 8; bit++) {
        const set = ((byte >> (7 - bit)) & 1) !== 0;
        setPixel(rgba, 256, xb * 8 + bit, y, colour(set ? ink : paper, bright));
      }
    }
  }
  return rgbaToPNG(rgba, 256, 192, { scale });
}

export function attrMapPng(attrs: Uint8Array, scale: number): Buffer {
  const rgba = new Uint8Array(256 * 192 * 4);
  for (let cy = 0; cy < 24; cy++) {
    for (let cx = 0; cx < 32; cx++) {
      const attr = attrs[cy * 32 + cx] ?? 0x38;
      const ink = attr & 0x07;
      const paper = (attr >> 3) & 0x07;
      const bright = (attr & 0x40) !== 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          setPixel(rgba, 256, cx * 8 + x, cy * 8 + y, colour(y < 2 ? ink : paper, bright));
        }
      }
    }
  }
  return rgbaToPNG(rgba, 256, 192, { scale });
}

export function linearBitmapPng(
  data: Uint8Array,
  opts: {
    widthBytes: number;
    height: number;
    stride?: number;
    count?: number;
    columns?: number;
    scale: number;
    ink?: number;
    paper?: number;
    invert?: boolean;
  }
): Buffer {
  const count = Math.max(1, opts.count ?? 1);
  const columns = Math.max(1, Math.min(count, opts.columns ?? count));
  const rows = Math.ceil(count / columns);
  const spriteW = opts.widthBytes * 8;
  const spriteH = opts.height;
  const gap = count > 1 ? 1 : 0;
  const width = columns * spriteW + (columns - 1) * gap;
  const height = rows * spriteH + (rows - 1) * gap;
  const rgba = new Uint8Array(width * height * 4);
  fill(rgba, colour(opts.paper ?? 0, false));
  const ink = colour(opts.ink ?? 7, false);
  const paper = colour(opts.paper ?? 0, false);
  const stride = opts.stride ?? opts.widthBytes;
  const bytesPerSprite = stride * opts.height;
  for (let index = 0; index < count; index++) {
    const sx = (index % columns) * (spriteW + gap);
    const sy = Math.floor(index / columns) * (spriteH + gap);
    const base = index * bytesPerSprite;
    for (let y = 0; y < opts.height; y++) {
      for (let xb = 0; xb < opts.widthBytes; xb++) {
        const byte = data[base + y * stride + xb] ?? 0;
        for (let bit = 0; bit < 8; bit++) {
          const set = (((byte >> (7 - bit)) & 1) !== 0) !== Boolean(opts.invert);
          setPixel(rgba, width, sx + xb * 8 + bit, sy + y, set ? ink : paper);
        }
      }
    }
  }
  return rgbaToPNG(rgba, width, height, { scale: opts.scale });
}

export function blitLinearToScreen(
  screen: Uint8Array,
  data: Uint8Array,
  opts: { x: number; y: number; widthBytes: number; height: number; stride?: number; xor?: boolean }
): Uint8Array {
  const out = new Uint8Array(screen);
  const stride = opts.stride ?? opts.widthBytes;
  for (let y = 0; y < opts.height; y++) {
    const dstY = opts.y + y;
    if (dstY < 0 || dstY >= 192) continue;
    for (let xb = 0; xb < opts.widthBytes; xb++) {
      const dstXByte = (opts.x >> 3) + xb;
      if (dstXByte < 0 || dstXByte >= 32) continue;
      const dst = screenOffset(dstY, dstXByte);
      const src = data[y * stride + xb] ?? 0;
      out[dst] = opts.xor ? (out[dst]! ^ src) : src;
    }
  }
  return out;
}

export function findGraphicsCandidates(ram: Uint8Array): GfxCandidate[] {
  const candidates: GfxCandidate[] = [];
  const window = 256;
  for (let offset = 0; offset <= ram.length - window; offset += 128) {
    const slice = ram.subarray(offset, offset + window);
    const nonZero = countNonZero(slice) / window;
    if (nonZero < 0.08) continue;
    const e = entropy(slice);
    const start = 0x4000 + offset;
    const screenScore = start >= 0x4000 && start < 0x5b00 ? 0.35 : 0;
    const fontScore = rowCorrelation(slice, 8) * 0.3;
    const score = nonZero * 0.35 + Math.min(e / 8, 1) * 0.3 + screenScore + fontScore;
    candidates.push({
      start,
      end: start + window - 1,
      len: window,
      kind: start >= 0x4000 && start < 0x5b00 ? 'screen' : fontScore > 0.15 ? 'font' : 'sprite-or-tile',
      entropy: round(e),
      nonZeroRatio: round(nonZero),
      score: round(score),
    });
  }
  return candidates.sort((a, b) => b.score - a.score || a.start - b.start).slice(0, 32);
}

function screenOffset(y: number, xb: number): number {
  return ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | xb;
}

function colour(index: number, bright: boolean): readonly [number, number, number] {
  return (bright ? BRIGHT : NORMAL)[index & 0x07]!;
}

function setPixel(rgba: Uint8Array, width: number, x: number, y: number, rgb: readonly [number, number, number]): void {
  const off = (y * width + x) * 4;
  rgba[off] = rgb[0];
  rgba[off + 1] = rgb[1];
  rgba[off + 2] = rgb[2];
  rgba[off + 3] = 255;
}

function fill(rgba: Uint8Array, rgb: readonly [number, number, number]): void {
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = rgb[0];
    rgba[i + 1] = rgb[1];
    rgba[i + 2] = rgb[2];
    rgba[i + 3] = 255;
  }
}

function entropy(data: Uint8Array): number {
  const counts = new Uint16Array(256);
  for (const b of data) counts[b] = (counts[b] ?? 0) + 1;
  let e = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / data.length;
    e -= p * Math.log2(p);
  }
  return e;
}

function countNonZero(data: Uint8Array): number {
  let n = 0;
  for (const b of data) if (b !== 0) n++;
  return n;
}

function rowCorrelation(data: Uint8Array, rowBytes: number): number {
  let matchingRows = 0;
  let rows = 0;
  for (let i = 0; i + rowBytes * 2 <= data.length; i += rowBytes) {
    rows++;
    let same = 0;
    for (let j = 0; j < rowBytes; j++) {
      if ((data[i + j]! ^ data[i + rowBytes + j]!) === 0) same++;
    }
    if (same >= rowBytes / 2) matchingRows++;
  }
  return rows === 0 ? 0 : matchingRows / rows;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
