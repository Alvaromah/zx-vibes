#!/usr/bin/env node
// Self-test for the `.tzx` fixture runner (FORMAT-TZX-001, file-formats.md FMT-TZX-*).
// Fidelity-tier: the `.tzx` byte layout has genuine ambiguity (the 3-byte vs 2-byte
// length fields, per-block fixed-header sizes, little-endianness, the major/minor order),
// so beyond an independent reference we run the full adversarial battery.
//
// Decisive checks:
//   1. The REAL fixtures (tzx-format.json: a well-formed 9-block file, a file of the
//      v1.20 control + informational blocks, and 3 malformed-rejection files) pass against an INDEPENDENT reference authored here
//      from dna/domain/file-formats.md "`.tzx` — tape image" — NOT the shipped
//      @zx-vibes/machine module.
//   2. A BIG-ENDIAN word model (reads/writes every 2-byte field high-byte-first) fails.
//   3. A LENGTH-AS-WORD model (reads/writes the 0x11/0x14 data length as 2 bytes, dropping
//      the third byte) fails — caught by serialize-length + the mis-framed parse.
//   4. A VERSION-SWAP model (writes/reads the header version as minor,major) fails —
//      caught by version-major / serialize-major.
//   5. A NO-SIGNATURE-CHECK parser (never validates the "ZXTape!" signature) fails —
//      caught by the FORMAT-TZX-REJECT-BAD-SIGNATURE fixture (parseThrows must be true).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-tzx-fixtures.mjs");
const realFixtures = path.join(thisDir, "tzx-format.json");

// Independent reference: re-derived from the spec, not importing @zx-vibes/machine.
// The /*ANCHOR*/ markers below are the seams the broken variants edit.
const REFERENCE_MODEL = `
const SIG = [0x5a,0x58,0x54,0x61,0x70,0x65,0x21]; // "ZXTape!"
const EOT = 0x1a;
function toBytes(d) { return d instanceof Uint8Array ? d : Uint8Array.from(d || []); }
function rd16(b, o) { return (b[o] | (b[o+1] << 8)) & 0xffff; /*RD16*/ }
function wr16(out, v) { out.push(v & 0xff, (v >> 8) & 0xff); /*WR16*/ }
// data-length read/write for the turbo (0x11) and pure-data (0x14) blocks.
function rdLen(b, o) { return { value: (b[o] | (b[o+1] << 8) | (b[o+2] << 16)) >>> 0, size: 3 }; /*RDLEN*/ }
function wrLen(out, v) { out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); /*WRLEN*/ }
function rd32(b, o) { return (b[o] | (b[o+1] << 8) | (b[o+2] << 16)) + b[o+3] * 0x1000000; }
function wr32(out, v) { out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
function s16(v) { return v >= 0x8000 ? v - 0x10000 : v; }
function str(b, o, n) { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o+i] & 0xff); return s; }
function strBytes(s) { const t = String(s ?? ""); const a = []; for (let i = 0; i < t.length; i++) a.push(t.charCodeAt(i) & 0xff); return a; }

export function parseTzx(bytes) {
  const f = toBytes(bytes);
  if (f.length < 10) throw new Error("too short");
  let sigOk = true;
  for (let i = 0; i < 7; i++) if ((f[i] & 0xff) !== SIG[i]) sigOk = false;
  if ((f[7] & 0xff) !== EOT) sigOk = false;
  if (!sigOk) throw new Error("bad signature"); /*SIGCHECK*/
  const version = { major: f[8] & 0xff, minor: f[9] & 0xff }; /*VERREAD*/
  const blocks = [];
  const pushControl = (b) => blocks.push(b); /*CONTROLPUSH*/
  let o = 10;
  const need = (n) => { if (o + n > f.length) throw new Error("truncated"); };
  while (o < f.length) {
    const id = f[o++] & 0xff;
    if (id === 0x10) {
      need(4); const pause = rd16(f, o); o += 2; const N = rd16(f, o); o += 2;
      need(N); const data = f.slice(o, o + N); o += N;
      blocks.push({ id, pause, data });
    } else if (id === 0x11) {
      need(15); const pilot = rd16(f,o);o+=2; const sync1=rd16(f,o);o+=2; const sync2=rd16(f,o);o+=2;
      const zero=rd16(f,o);o+=2; const one=rd16(f,o);o+=2; const pilotPulses=rd16(f,o);o+=2;
      const usedBits=f[o++]&0xff; const pause=rd16(f,o);o+=2;
      const L=rdLen(f,o); o+=L.size; need(L.value); const data=f.slice(o,o+L.value); o+=L.value;
      blocks.push({ id, pilot, sync1, sync2, zero, one, pilotPulses, usedBits, pause, data });
    } else if (id === 0x12) {
      need(4); const pulseLength=rd16(f,o);o+=2; const pulseCount=rd16(f,o);o+=2;
      blocks.push({ id, pulseLength, pulseCount });
    } else if (id === 0x13) {
      need(1); const count=f[o++]&0xff; const pulses=[];
      for (let i=0;i<count;i++){ need(2); pulses.push(rd16(f,o)); o+=2; }
      blocks.push({ id, pulses });
    } else if (id === 0x14) {
      need(7); const zero=rd16(f,o);o+=2; const one=rd16(f,o);o+=2; const usedBits=f[o++]&0xff; const pause=rd16(f,o);o+=2;
      const L=rdLen(f,o); o+=L.size; need(L.value); const data=f.slice(o,o+L.value); o+=L.value;
      blocks.push({ id, zero, one, usedBits, pause, data });
    } else if (id === 0x20) {
      need(2); const pause=rd16(f,o);o+=2; blocks.push({ id, pause });
    } else if (id === 0x21) {
      need(1); const L=f[o++]&0xff; need(L); const name=str(f,o,L); o+=L; blocks.push({ id, name });
    } else if (id === 0x22) {
      blocks.push({ id });
    } else if (id === 0x30) {
      need(1); const L=f[o++]&0xff; need(L); const text=str(f,o,L); o+=L; blocks.push({ id, text });
    } else if (id === 0x23) {
      need(2); pushControl({ id, offset: s16(rd16(f,o)) }); o+=2;
    } else if (id === 0x24) {
      need(2); pushControl({ id, count: rd16(f,o) }); o+=2;
    } else if (id === 0x25 || id === 0x27) {
      pushControl({ id });
    } else if (id === 0x26) {
      need(2); const n=rd16(f,o); o+=2; const offsets=[];
      for (let i=0;i<n;i++){ need(2); offsets.push(s16(rd16(f,o))); o+=2; }
      pushControl({ id, offsets });
    } else if (id === 0x28) {
      need(2); const len=rd16(f,o); o+=2; need(len); const end=o+len; const n=f[o++]&0xff; const entries=[];
      for (let i=0;i<n;i++){ const offset=s16(rd16(f,o)); o+=2; const L=f[o++]&0xff; entries.push({ offset, description: str(f,o,L) }); o+=L; }
      if (o !== end) throw new Error("select length mismatch");
      pushControl({ id, entries });
    } else if (id === 0x2a) {
      need(4); const len=rd32(f,o); o+=4; need(len); o+=len; pushControl({ id });
    } else if (id === 0x2b) {
      need(4); const len=rd32(f,o); o+=4; need(len); if (len < 1) throw new Error("no level"); const level=f[o]&0xff; o+=len;
      pushControl({ id, level });
    } else if (id === 0x31) {
      need(2); const time=f[o++]&0xff; const L=f[o++]&0xff; need(L); blocks.push({ id, time, text: str(f,o,L) }); o+=L;
    } else if (id === 0x32) {
      need(2); const len=rd16(f,o); o+=2; need(len); const end=o+len; const n=f[o++]&0xff; const entries=[];
      for (let i=0;i<n;i++){ const type=f[o++]&0xff; const L=f[o++]&0xff; entries.push({ type, text: str(f,o,L) }); o+=L; }
      if (o !== end) throw new Error("archive length mismatch");
      blocks.push({ id, entries });
    } else if (id === 0x33) {
      need(1); const n=f[o++]&0xff; need(3*n); const entries=[];
      for (let i=0;i<n;i++){ entries.push({ type: f[o]&0xff, hardwareId: f[o+1]&0xff, info: f[o+2]&0xff }); o+=3; }
      blocks.push({ id, entries });
    } else if (id === 0x35) {
      need(20); const ident=str(f,o,16); o+=16; const len=rd32(f,o); o+=4; need(len);
      blocks.push({ id, ident, info: f.slice(o,o+len) }); o+=len;
    } else if (id === 0x5a) {
      need(9); blocks.push({ id, glue: f.slice(o,o+9) }); o+=9;
    } else {
      throw new Error("unsupported block id 0x" + id.toString(16));
    }
  }
  return { version, blocks };
}

export function serializeTzx(tzx) {
  const version = (tzx && tzx.version) || { major: 1, minor: 20 };
  const blocks = (tzx && tzx.blocks) || [];
  const out = [];
  for (const b of SIG) out.push(b);
  out.push(EOT);
  out.push(version.major & 0xff, version.minor & 0xff); /*VERWRITE*/
  for (const blk of blocks) {
    out.push(blk.id & 0xff);
    if (blk.id === 0x10) {
      const data = toBytes(blk.data); wr16(out, blk.pause||0); wr16(out, data.length); for (const x of data) out.push(x&0xff);
    } else if (blk.id === 0x11) {
      const data = toBytes(blk.data);
      wr16(out, blk.pilot||0); wr16(out, blk.sync1||0); wr16(out, blk.sync2||0);
      wr16(out, blk.zero||0); wr16(out, blk.one||0); wr16(out, blk.pilotPulses||0);
      out.push((blk.usedBits||0)&0xff); wr16(out, blk.pause||0); wrLen(out, data.length);
      for (const x of data) out.push(x&0xff);
    } else if (blk.id === 0x12) {
      wr16(out, blk.pulseLength||0); wr16(out, blk.pulseCount||0);
    } else if (blk.id === 0x13) {
      const pulses = blk.pulses || []; out.push(pulses.length & 0xff); for (const p of pulses) wr16(out, p);
    } else if (blk.id === 0x14) {
      const data = toBytes(blk.data);
      wr16(out, blk.zero||0); wr16(out, blk.one||0); out.push((blk.usedBits||0)&0xff); wr16(out, blk.pause||0);
      wrLen(out, data.length); for (const x of data) out.push(x&0xff);
    } else if (blk.id === 0x20) {
      wr16(out, blk.pause||0);
    } else if (blk.id === 0x21) {
      const name = strBytes(blk.name); out.push(name.length & 0xff); for (const x of name) out.push(x);
    } else if (blk.id === 0x22) {
      // no body
    } else if (blk.id === 0x30) {
      const text = strBytes(blk.text); out.push(text.length & 0xff); for (const x of text) out.push(x);
    } else if (blk.id === 0x23) {
      wr16(out, blk.offset||0);
    } else if (blk.id === 0x24) {
      wr16(out, blk.count||0);
    } else if (blk.id === 0x25 || blk.id === 0x27) {
      // no body
    } else if (blk.id === 0x26) {
      const offs = blk.offsets || []; wr16(out, offs.length); for (const v of offs) wr16(out, v);
    } else if (blk.id === 0x28) {
      const body = []; const entries = blk.entries || []; body.push(entries.length & 0xff);
      for (const e of entries) { const t = strBytes(e.description); wr16(body, e.offset||0); body.push(t.length & 0xff); for (const x of t) body.push(x); }
      wr16(out, body.length); for (const x of body) out.push(x);
    } else if (blk.id === 0x2a) {
      wr32(out, 0);
    } else if (blk.id === 0x2b) {
      wr32(out, 1); out.push((blk.level||0) & 0xff);
    } else if (blk.id === 0x31) {
      const t = strBytes(blk.text); out.push((blk.time||0) & 0xff, t.length & 0xff); for (const x of t) out.push(x);
    } else if (blk.id === 0x32) {
      const body = []; const entries = blk.entries || []; body.push(entries.length & 0xff);
      for (const e of entries) { const t = strBytes(e.text); body.push((e.type||0) & 0xff, t.length & 0xff); for (const x of t) body.push(x); }
      wr16(out, body.length); for (const x of body) out.push(x);
    } else if (blk.id === 0x33) {
      const entries = blk.entries || []; out.push(entries.length & 0xff);
      for (const e of entries) out.push((e.type||0) & 0xff, (e.hardwareId||0) & 0xff, (e.info||0) & 0xff);
    } else if (blk.id === 0x35) {
      const id16 = strBytes(String(blk.ident || "").padEnd(16, " ").slice(0, 16)); for (const x of id16) out.push(x);
      const info = toBytes(blk.info); wr32(out, info.length); for (const x of info) out.push(x & 0xff);
    } else if (blk.id === 0x5a) {
      const g = toBytes(blk.glue); for (let i = 0; i < 9; i++) out.push((g[i] || 0) & 0xff);
    } else {
      throw new Error("unsupported block id 0x" + (blk.id||0).toString(16));
    }
  }
  return Uint8Array.from(out);
}
`;

// Broken: every 2-byte WORD field is big-endian on both read and write.
const BIG_ENDIAN_MODEL = REFERENCE_MODEL
  .replace("return (b[o] | (b[o+1] << 8)) & 0xffff; /*RD16*/", "return ((b[o] << 8) | b[o+1]) & 0xffff; /*RD16*/")
  .replace("out.push(v & 0xff, (v >> 8) & 0xff); /*WR16*/", "out.push((v >> 8) & 0xff, v & 0xff); /*WR16*/");

// Broken: the 0x11/0x14 data length is read/written as a 2-byte WORD (drops the 3rd byte).
const LENGTH_AS_WORD_MODEL = REFERENCE_MODEL
  .replace("return { value: (b[o] | (b[o+1] << 8) | (b[o+2] << 16)) >>> 0, size: 3 }; /*RDLEN*/", "return { value: (b[o] | (b[o+1] << 8)) & 0xffff, size: 2 }; /*RDLEN*/")
  .replace("out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff); /*WRLEN*/", "out.push(v & 0xff, (v >> 8) & 0xff); /*WRLEN*/");

// Broken: the header version is stored/read as minor,major (swapped order).
const VERSION_SWAP_MODEL = REFERENCE_MODEL
  .replace("const version = { major: f[8] & 0xff, minor: f[9] & 0xff }; /*VERREAD*/", "const version = { major: f[9] & 0xff, minor: f[8] & 0xff }; /*VERREAD*/")
  .replace("out.push(version.major & 0xff, version.minor & 0xff); /*VERWRITE*/", "out.push(version.minor & 0xff, version.major & 0xff); /*VERWRITE*/");

// Broken: the control blocks (loop, jump, call, select, stop-if-48K, signal level) are
// consumed but silently dropped from the block list — a player then plays a loop once and
// never stops a 48K machine (FMT-TZX-CONTROL-001 forbids skipping them).
const CONTROL_DROPPED_MODEL = REFERENCE_MODEL
  .replace("const pushControl = (b) => blocks.push(b); /*CONTROLPUSH*/", "const pushControl = (b) => {}; /*CONTROLPUSH*/");

// Broken: the parser never validates the "ZXTape!" signature (accepts any header).
const NO_SIGNATURE_CHECK_MODEL = REFERENCE_MODEL
  .replace('if (!sigOk) throw new Error("bad signature"); /*SIGCHECK*/', "/* signature check removed */");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tzx-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const bigEndian = await write("big-endian.mjs", BIG_ENDIAN_MODEL);
    const lenWord = await write("length-as-word.mjs", LENGTH_AS_WORD_MODEL);
    const verSwap = await write("version-swap.mjs", VERSION_SWAP_MODEL);
    const noSig = await write("no-signature-check.mjs", NO_SIGNATURE_CHECK_MODEL);
    const controlDropped = await write("control-dropped.mjs", CONTROL_DROPPED_MODEL);

    // Guard: each broken variant must actually differ from the reference (a renamed
    // anchor would silently no-op the replace and weaken the test).
    for (const [src, label] of [
      [BIG_ENDIAN_MODEL, "big-endian"],
      [LENGTH_AS_WORD_MODEL, "length-as-word"],
      [VERSION_SWAP_MODEL, "version-swap"],
      [NO_SIGNATURE_CHECK_MODEL, "no-signature-check"],
      [CONTROL_DROPPED_MODEL, "control-dropped"],
    ]) {
      assert(src !== REFERENCE_MODEL, `${label} variant did not change the reference (stale anchor)`);
    }

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real .tzx fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [bigEndian, "big-endian word model"],
      [lenWord, "length-as-word model"],
      [verSwap, "version-swap model"],
      [noSig, "no-signature-check parser"],
      [controlDropped, "control-blocks-dropped parser"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the .tzx fixtures`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "TZX fixture self-test passed: the real FORMAT-TZX fixtures validate against an independent reference; a big-endian word reader, a model that reads the turbo/pure-data length as a WORD, a version-swap, a parser that skips the signature check, and one that drops the control blocks are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
