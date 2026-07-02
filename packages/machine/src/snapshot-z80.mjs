// .z80 snapshot format (read/write) for the regenerated 48K machine, authored
// from the project DNA (dna/domain/snapshot-z80.md) and decided by the format
// conformance fixtures (dna/conformance/formats/z80-v3-roundtrip.json).
//
// The .z80 file format is the de-facto community ZX Spectrum snapshot format
// (Gerton Lunter). This module implements the 48K variant: it WRITES version 3
// (PC=0 marker, 54-byte extra header, hardware mode 0 = 48K, three RLE-compressed
// 16K memory pages 8/4/5) and READS versions 1, 2 and 3. The state is the machine
// register file + the 64 KB memory image + the border colour; round-tripping it
// preserves RAM and registers (FMT-Z80-V3-001).

const PAGE_TO_BASE = { 8: 0x4000, 4: 0x8000, 5: 0xc000 }; // 48K page numbers -> address
const BASE_TO_PAGE = [[0x4000, 8], [0x8000, 4], [0xc000, 5]];

// --- RLE (the .z80 "ED ED count value" run encoding) -------------------------
// A run of >= 5 equal bytes (or >= 2 equal 0xED bytes, since a literal "ED ED"
// would be misread as the marker) is encoded as ED ED count value, count <= 255.
export function compressZ80(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i];
    let run = 1;
    while (i + run < bytes.length && bytes[i + run] === v && run < 255) run += 1;
    const worthRun = v === 0xed ? run >= 2 : run >= 5;
    if (worthRun) {
      out.push(0xed, 0xed, run, v);
      i += run;
    } else if (v === 0xed) {
      // A lone ED (run of 1) must not start a literal "ED xx" that could be ED ED:
      // emit the ED and the following byte verbatim as a pair so it is never a marker.
      out.push(0xed);
      i += 1;
      if (i < bytes.length) { out.push(bytes[i]); i += 1; }
    } else {
      out.push(v);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

export function decompressZ80(bytes, expectedLength) {
  const out = [];
  let i = 0;
  while (i < bytes.length && (expectedLength === undefined || out.length < expectedLength)) {
    if (bytes[i] === 0xed && bytes[i + 1] === 0xed) {
      const count = bytes[i + 2];
      const value = bytes[i + 3];
      for (let k = 0; k < count; k += 1) out.push(value);
      i += 4;
    } else {
      out.push(bytes[i]);
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

const REG = (r, name) => (r[name] ?? 0) & 0xff;
const word = (lo, hi) => (lo & 0xff) | ((hi & 0xff) << 8);

export function writeZ80({ registers = {}, memory, border = 0 } = {}) {
  const r = registers;
  const mem = memory instanceof Uint8Array ? memory : Uint8Array.from(memory ?? []);
  const h = new Uint8Array(30 + 2 + 54);
  // v1 header (PC at 6-7 = 0 => version 2/3)
  h[0] = REG(r, "a"); h[1] = REG(r, "f");
  h[2] = REG(r, "c"); h[3] = REG(r, "b");
  h[4] = REG(r, "l"); h[5] = REG(r, "h");
  h[6] = 0; h[7] = 0; // PC = 0 -> v2/v3
  h[8] = REG(r, "sp") ; h[9] = (r.sp ?? 0) >> 8 & 0xff;
  h[10] = REG(r, "i");
  h[11] = REG(r, "r") & 0x7f;
  h[12] = (((r.r ?? 0) >> 7) & 1) | ((border & 0x07) << 1);
  h[13] = REG(r, "e"); h[14] = REG(r, "d");
  h[15] = REG(r, "c_"); h[16] = REG(r, "b_");
  h[17] = REG(r, "e_"); h[18] = REG(r, "d_");
  h[19] = REG(r, "l_"); h[20] = REG(r, "h_");
  h[21] = REG(r, "a_"); h[22] = REG(r, "f_");
  h[23] = REG(r, "iyl"); h[24] = REG(r, "iyh");
  h[25] = REG(r, "ixl"); h[26] = REG(r, "ixh");
  h[27] = (r.iff1 ?? 0) ? 1 : 0;
  h[28] = (r.iff2 ?? 0) ? 1 : 0;
  h[29] = (r.im ?? 0) & 0x03;
  // v3 extra header: length 54, PC, hardware mode 0 (48K).
  h[30] = 54; h[31] = 0;
  h[32] = REG(r, "pc"); h[33] = ((r.pc ?? 0) >> 8) & 0xff;
  h[34] = 0; // hardware mode 0 = 48K
  // bytes 35..83 left 0 (no extra hardware state)

  const blocks = [];
  for (const [base, page] of BASE_TO_PAGE) {
    const raw = mem.subarray(base, base + 0x4000);
    const comp = compressZ80(raw);
    const len = comp.length;
    const block = new Uint8Array(3 + len);
    block[0] = len & 0xff; block[1] = (len >> 8) & 0xff; block[2] = page;
    block.set(comp, 3);
    blocks.push(block);
  }
  const total = h.length + blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  out.set(h, 0);
  let off = h.length;
  for (const b of blocks) { out.set(b, off); off += b.length; }
  return out;
}

export function readZ80(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const registers = {
    a: b[0], f: b[1], c: b[2], b: b[3], l: b[4], h: b[5],
    sp: word(b[8], b[9]), i: b[10],
    r: (b[11] & 0x7f) | ((b[12] & 1) << 7),
    e: b[13], d: b[14],
    c_: b[15], b_: b[16], e_: b[17], d_: b[18], l_: b[19], h_: b[20],
    a_: b[21], f_: b[22],
    iyl: b[23], iyh: b[24], ixl: b[25], ixh: b[26],
    iff1: b[27] ? 1 : 0, iff2: b[28] ? 1 : 0, im: b[29] & 0x03,
  };
  const border = (b[12] >> 1) & 0x07;
  const memory = new Uint8Array(0x10000);

  const v1pc = word(b[6], b[7]);
  if (v1pc !== 0) {
    // Version 1: single 48K image from 0x4000, optionally RLE-compressed (byte12 bit5).
    registers.pc = v1pc;
    const compressed = ((b[12] === 255 ? 1 : b[12]) & 0x20) !== 0;
    const body = b.subarray(30);
    const ram = compressed ? decompressZ80(stripV1End(body), 0xc000) : body.subarray(0, 0xc000);
    memory.set(ram.subarray(0, 0xc000), 0x4000);
    return { registers, memory, border, version: 1 };
  }

  // Version 2/3: extra header then page blocks.
  const extraLen = word(b[30], b[31]);
  registers.pc = word(b[32], b[33]);
  const version = extraLen === 23 ? 2 : 3;
  let off = 30 + 2 + extraLen;
  while (off + 3 <= b.length) {
    const len = word(b[off], b[off + 1]);
    const page = b[off + 2];
    off += 3;
    const base = PAGE_TO_BASE[page];
    const uncompressed = len === 0xffff;
    const blockLen = uncompressed ? 0x4000 : len;
    const slice = b.subarray(off, off + blockLen);
    off += blockLen;
    if (base === undefined) continue; // ignore non-48K pages
    const ram = uncompressed ? slice : decompressZ80(slice, 0x4000);
    memory.set(ram.subarray(0, 0x4000), base);
  }
  return { registers, memory, border, version };
}

// A compressed v1 body ends with the marker 00 ED ED 00; strip it before decoding.
function stripV1End(body) {
  const n = body.length;
  if (n >= 4 && body[n - 4] === 0x00 && body[n - 3] === 0xed && body[n - 2] === 0xed && body[n - 1] === 0x00) {
    return body.subarray(0, n - 4);
  }
  return body;
}
