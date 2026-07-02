#!/usr/bin/env node
// Self-test for the instant/trap-load runner (TAPE-INSTANT-LOAD-001, tape-loading.md
// "Instant / trap loading" TAPE-INSTANT-*). The slice's content is the EQUIVALENCE to the
// already-fidelity-verified real ROM (TAPE-INSTANT-EQUIV-001: instant == edge), so the
// verification is a differential against the real ROM, plus a broad reference battery and an
// adversarial battery (each broken instant model must DIVERGE from the real ROM).
//
// Decisive checks:
//   0. The REAL instant-load fixtures (instant-load.json) PASS through the runner (which
//      itself asserts instant == edge through the real ROM).
//   1. ANCHOR — instant == edge against the REAL ROM on five judge blocks: a well-formed data
//      block, a header block, a small data block, a flag-mismatch (RAM untouched), and a
//      corrupt-checksum block (data reaches RAM but carry resets). instant matches the ROM's
//      observable result on every one — including the two FAILURE cases (the strongest form of
//      the equivalence).
//   2. BREADTH — the shipped instantLoad agrees with an independent spec-derived reference over
//      all 256 flags x several sizes + a flag-mismatch variant per flag + a zero-data block.
//   3. ADVERSARIAL — four broken instant models (ignore a flag mismatch, skip the checksum,
//      store the flag/checksum, load the wrong byte count) each DIVERGE from the real ROM on at
//      least one judge block and are rejected.
//   4. UNIT — instant load elapses zero machine time (tStates === 0).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-tape-instant-load-fixtures.mjs");
const realFixtures = path.join(thisDir, "instant-load.json");
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const moduleUrl = pathToFileURL(path.join(repoRoot, "packages", "machine", "src", "index.mjs")).href;
const romPath = path.join(thisDir, "..", "rom", "spectrum-48k.rom");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function bytesToHex(bytes) { let o = ""; for (const b of bytes) o += (b & 0xff).toString(16).padStart(2, "0"); return o; }

// An INDEPENDENT instant-load reference re-derived from the spec (reduce/slice idiom, distinct
// from the shipped imperative loop). Operates directly on a memory Uint8Array; returns the
// observable result plus the stored bytes so RAM can be compared without a machine.
function referenceInstant(memory, body, { ix, de, flag }) {
  const b = Array.from(body, (x) => x & 0xff);
  const want = de & 0xffff;
  const dest = ix & 0xffff;
  if (b.length < 2) return { ok: false, bytesLoaded: 0, stored: [] };
  if (b[0] !== (flag & 0xff)) return { ok: false, bytesLoaded: 0, stored: [] }; // nothing written
  const available = b.length - 2;
  const n = Math.min(want, Math.max(0, available));
  const stored = b.slice(1, 1 + n);
  stored.forEach((v, i) => { memory[(dest + i) & 0xffff] = v; });
  const checksumByte = b[1 + want] ?? 0;
  const parity = [b[0], ...stored, checksumByte].reduce((acc, v) => acc ^ v, 0) & 0xff;
  return { ok: parity === 0, bytesLoaded: n, stored };
}

async function main() {
  const M = await import(moduleUrl);
  const { createMachine, blockToPulses, tapChecksum, edgeLoad, instantLoad } = M;
  const rom = new Uint8Array(await readFile(romPath));

  const ramMachine = () => createMachine({ memory: new Uint8Array(0x10000) });
  const romMachine = (fill, ix, n) => {
    const memory = new Uint8Array(0x10000);
    memory.set(rom, 0x0000);
    const m = createMachine({ memory });
    if (fill !== undefined) for (let i = 0; i < n; i += 1) m.memory[(ix + i) & 0xffff] = fill;
    return m;
  };
  const body = (flag, data) => Uint8Array.from([flag, ...data, tapChecksum(flag, data)]);
  const ramHex = (m, ix, n) => bytesToHex(m.memory.slice(ix, ix + n));

  // 0. The real fixtures pass (the runner asserts instant == edge through the real ROM).
  const real = run(["--fixtures", realFixtures, "--quiet"]);
  assert(real.status === 0, `expected the real instant-load fixtures to pass\n${real.stdout}\n${real.stderr}`);

  // ---- Judge blocks: run the real ROM ONCE each; reuse the results for the anchor + adversarial. ----
  const ix = 0x8000;
  const dataA = Uint8Array.from(Array.from({ length: 24 }, (_, i) => (i * 7 + 3) & 0xff));
  const dataB = Uint8Array.from([0x00, 0x03, 0x41, 0x42, 0x43, 0x44, 0x00, 0x80]);
  const dataC = Uint8Array.from([0xde, 0xad, 0xbe]);
  const goodA = tapChecksum(0xff, dataA);
  const corruptBodyA = Uint8Array.from([0xff, ...dataA, goodA ^ 0xff]); // flipped checksum

  const judges = [
    { name: "data-24", body: body(0xff, dataA), ix, de: dataA.length, flag: 0xff, budget: 14_000_000 },
    { name: "header-8", body: body(0x00, dataB), ix, de: dataB.length, flag: 0x00, budget: 25_000_000 },
    { name: "data-3", body: body(0xff, dataC), ix, de: dataC.length, flag: 0xff, budget: 14_000_000 },
    { name: "flag-mismatch", body: body(0xff, dataA), ix, de: dataA.length, flag: 0x00, budget: 14_000_000 },
    { name: "corrupt-checksum", body: corruptBodyA, ix, de: dataA.length, flag: 0xff, budget: 14_000_000 },
  ];
  for (const j of judges) {
    const m = romMachine(0xee, j.ix, j.de);
    const r = edgeLoad(m, blockToPulses(j.body), { ix: j.ix, de: j.de, flag: j.flag, tStateBudget: j.budget });
    j.edge = { ok: r.ok, bytesLoaded: r.bytesLoaded, ram: ramHex(m, j.ix, j.de), tStates: r.tStates };
  }

  // 1. ANCHOR — the shipped instantLoad reproduces the real ROM's observable result on every
  //    judge block (well-formed AND the two failure cases). Sentinel-fill so "untouched" counts.
  for (const j of judges) {
    const m = romMachine(0xee, j.ix, j.de);
    const r = instantLoad(m, j.body, { ix: j.ix, de: j.de, flag: j.flag });
    const ram = ramHex(m, j.ix, j.de);
    assert(r.ok === j.edge.ok, `anchor ${j.name}: instant.ok ${r.ok} != edge.ok ${j.edge.ok}`);
    assert(r.bytesLoaded === j.edge.bytesLoaded, `anchor ${j.name}: instant.bytesLoaded ${r.bytesLoaded} != edge ${j.edge.bytesLoaded}`);
    assert(ram === j.edge.ram, `anchor ${j.name}: instant RAM ${ram} != edge RAM ${j.edge.ram}`);
    assert(r.tStates === 0, `anchor ${j.name}: instant tStates ${r.tStates} != 0`);
  }

  // 2. BREADTH — shipped instantLoad == independent reference over all 256 flags x sizes, plus a
  //    flag-mismatch variant per flag and a zero-data block. Cheap (no ROM).
  let breadthCases = 0;
  for (let flag = 0; flag < 256; flag += 1) {
    for (const len of [0, 1, 2, 3, 16, 33]) {
      const data = Uint8Array.from(Array.from({ length: len }, (_, i) => ((flag * 31 + i * 7 + 1) & 0xff)));
      const blk = body(flag, data);

      // well-formed (flag matches)
      {
        const m = ramMachine();
        const r = instantLoad(m, blk, { ix, de: len, flag });
        const refMem = new Uint8Array(0x10000);
        const ref = referenceInstant(refMem, blk, { ix, de: len, flag });
        breadthCases += 1;
        assert(r.ok === ref.ok && r.bytesLoaded === ref.bytesLoaded && ramHex(m, ix, len) === bytesToHex(refMem.slice(ix, ix + len)),
          `breadth flag=0x${flag.toString(16)} len=${len}: shipped{ok=${r.ok},n=${r.bytesLoaded}} != reference{ok=${ref.ok},n=${ref.bytesLoaded}}`);
      }
      // flag-mismatch variant (expected flag differs -> nothing written, fail)
      {
        const expected = (flag ^ 0x80) & 0xff;
        const m = ramMachine();
        for (let i = 0; i < len; i += 1) m.memory[ix + i] = 0x5a; // sentinel
        const r = instantLoad(m, blk, { ix, de: len, flag: expected });
        breadthCases += 1;
        assert(r.ok === false && r.bytesLoaded === 0 && ramHex(m, ix, len) === "5a".repeat(len),
          `breadth mismatch flag=0x${flag.toString(16)} len=${len}: expected fail+untouched, got ok=${r.ok} n=${r.bytesLoaded}`);
      }
    }
  }

  // 3. ADVERSARIAL — each broken instant model must DIVERGE from the real ROM on >=1 judge block.
  const brokenModels = {
    "ignore-flag-mismatch": (m, b, { ix, de }) => {
      const a = Array.from(b, (x) => x & 0xff);
      const n = Math.min(de & 0xffff, Math.max(0, a.length - 2));
      let parity = a[0] ?? 0;
      for (let i = 0; i < n; i += 1) { m.memory[(ix + i) & 0xffff] = a[1 + i]; parity ^= a[1 + i]; }
      parity ^= a[1 + (de & 0xffff)] ?? 0;
      return { ok: (parity & 0xff) === 0, bytesLoaded: n, tStates: 0 }; // NO flag check
    },
    "skip-checksum": (m, b, { ix, de, flag }) => {
      const a = Array.from(b, (x) => x & 0xff);
      if ((a[0] ?? -1) !== (flag & 0xff)) return { ok: false, bytesLoaded: 0, tStates: 0 };
      const n = Math.min(de & 0xffff, Math.max(0, a.length - 2));
      for (let i = 0; i < n; i += 1) m.memory[(ix + i) & 0xffff] = a[1 + i];
      return { ok: true, bytesLoaded: n, tStates: 0 }; // NO checksum check
    },
    "store-flag-and-checksum": (m, b, { ix, de, flag }) => {
      const a = Array.from(b, (x) => x & 0xff);
      if ((a[0] ?? -1) !== (flag & 0xff)) return { ok: false, bytesLoaded: 0, tStates: 0 };
      const n = Math.min(de & 0xffff, Math.max(0, a.length - 2));
      for (let i = 0; i < n; i += 1) m.memory[(ix + i) & 0xffff] = a[i]; // WRONG: starts at the flag
      let parity = a[0] ?? 0;
      for (let i = 0; i < n; i += 1) parity ^= a[1 + i];
      parity ^= a[1 + (de & 0xffff)] ?? 0;
      return { ok: (parity & 0xff) === 0, bytesLoaded: n, tStates: 0 };
    },
    "wrong-byte-count": (m, b, { ix, de, flag }) => {
      const a = Array.from(b, (x) => x & 0xff);
      if ((a[0] ?? -1) !== (flag & 0xff)) return { ok: false, bytesLoaded: 0, tStates: 0 };
      const want = Math.max(0, (de & 0xffff) - 1); // WRONG count
      const n = Math.min(want, Math.max(0, a.length - 2));
      let parity = a[0] ?? 0;
      for (let i = 0; i < n; i += 1) { m.memory[(ix + i) & 0xffff] = a[1 + i]; parity ^= a[1 + i]; }
      parity ^= a[1 + want] ?? 0;
      return { ok: (parity & 0xff) === 0, bytesLoaded: n, tStates: 0 };
    },
  };

  for (const [label, model] of Object.entries(brokenModels)) {
    let diverged = false;
    for (const j of judges) {
      const m = romMachine(0xee, j.ix, j.de);
      const r = model(m, j.body, { ix: j.ix, de: j.de, flag: j.flag });
      const ram = ramHex(m, j.ix, j.de);
      if (r.ok !== j.edge.ok || r.bytesLoaded !== j.edge.bytesLoaded || ram !== j.edge.ram) { diverged = true; break; }
    }
    assert(diverged, `adversarial '${label}' must diverge from the real ROM on at least one judge block (it did not — the differential is not discriminating)`);
  }

  // 4. UNIT — instant load elapses zero machine time.
  {
    const m = ramMachine();
    const r = instantLoad(m, body(0xff, dataA), { ix, de: dataA.length, flag: 0xff });
    assert(r.tStates === 0, `instant load must elapse zero machine time, got ${r.tStates}`);
  }

  console.log(
    `Tape instant-load self-test passed: instant == edge through the real ROM on 5 judge blocks (incl. flag-mismatch + corrupt-checksum failure cases); ${breadthCases} reference-battery cases agree across all 256 flags; an ignore-flag-mismatch / skip-checksum / store-flag-and-checksum / wrong-byte-count model each diverge from the real ROM and are rejected; instant load elapses zero machine time.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
