#!/usr/bin/env node
// Self-test for the ROM tape edge-load runner (TAPE-EDGE-LOAD-001, tape-loading.md
// "Edge loading" TAPE-EDGE-*). Fidelity-tier: edge loading has genuine content (reading
// the EAR edge stream, the LD-BYTES register contract, the final-bit closing edge, the
// MONOTONIC tape clock), so beyond confirming the real fixture passes we run the full
// adversarial battery — each broken model must FAIL to reproduce the source bytes.
//
// Decisive checks:
//   0. The REAL edge-load fixtures (edge-load.json) PASS through the runner against the
//      shipped @zx-vibes/machine + the vendored ROM.
//   1. A NO-EDGE deck (b6 constant -> the loader never sees a pilot edge -> never locks)
//      fails to load.
//   2. A 0/1 BIT-LENGTH SWAP (855<->1710) -> the ROM mis-reads every bit (the 0xFF flag
//      reads as 0x00 -> flag mismatch) -> fails.
//   3. A DROPPED-SYNC stream (no 667/735 sync pair -> the loader locks the pilot but never
//      reaches the data) fails.
//   4. A FRAME-MODULO tape clock (cursor = elapsed mod FRAME_T_STATES instead of monotonic)
//      -> edges are lost/duplicated across the ~100 frame wraps of a block load -> fails.
//      This proves the monotonic cursor (TAPE-EDGE-CLOCK-001) is load-bearing.
//   5. UNIT: the issue-3 idle level (TAPE-EDGE-IDLE-001 / host-io HOST-IO-PORTFE-EARIN-IDLE-001)
//      tracks the last b4 written to port 0xFE when no tape drives the line.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-tape-edge-load-fixtures.mjs");
const realFixtures = path.join(thisDir, "edge-load.json");
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const moduleUrl = pathToFileURL(path.join(repoRoot, "packages", "machine", "src", "index.mjs")).href;
const romPath = path.join(thisDir, "..", "rom", "spectrum-48k.rom");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const M = await import(moduleUrl);
  const { createMachine, blockToPulses, tapChecksum, edgeLoad, edgeLoadWithDeck, createTapeDeck, FRAME_T_STATES, BIT0_PULSE_T, BIT1_PULSE_T } = M;
  const rom = new Uint8Array(await readFile(romPath));

  const buildMachine = () => {
    const memory = new Uint8Array(0x10000);
    memory.set(rom, 0x0000);
    return createMachine({ memory });
  };
  const body = (flag, data) => Uint8Array.from([flag, ...data, tapChecksum(flag, data)]);
  const ramEq = (m, ix, data) => { const l = m.memory.slice(ix, ix + data.length); return data.every((b, i) => l[i] === b); };
  const loaded = (r, m, ix, data) => r.ok && ramEq(m, ix, data);

  const ix = 0x8000;
  const flag = 0xff;
  const data = Uint8Array.from(Array.from({ length: 24 }, (_, i) => (i * 7 + 3) & 0xff));

  // 0. The real fixtures pass.
  const real = run(["--fixtures", realFixtures, "--quiet"]);
  assert(real.status === 0, `expected the real edge-load fixtures to pass\n${real.stdout}\n${real.stderr}`);

  // Anchor: the correct load through the shipped model succeeds (so a broken variant
  // failing is meaningful, not a dead harness).
  {
    const m = buildMachine();
    const r = edgeLoad(m, blockToPulses(body(flag, data)), { ix, de: data.length, flag });
    assert(loaded(r, m, ix, data), "anchor: the correct edge-load must succeed with RAM identical to the source");
  }

  // 1. No-edge deck: b6 never changes -> the loader never locks the pilot.
  {
    const m = buildMachine();
    const constDeck = { read: (p) => ((p & 1) ? 0xff : 0xbf), write: () => {} };
    const r = edgeLoadWithDeck(m, constDeck, { ix, de: data.length, flag, tStateBudget: 5_000_000 });
    assert(!loaded(r, m, ix, data), "no-edge deck must fail to load");
  }

  // 2. Bit-length swap (855<->1710) -> the ROM mis-reads every bit.
  {
    function swappedPulses(b) {
      const f = b[0] & 0xff;
      const pilot = f < 0x80 ? 8063 : 3223;
      const out = [];
      for (let i = 0; i < pilot; i += 1) out.push(2168);
      out.push(667, 735);
      for (const byte of b) for (let bit = 7; bit >= 0; bit -= 1) {
        const len = ((byte >> bit) & 1) ? BIT0_PULSE_T : BIT1_PULSE_T; // SWAPPED
        out.push(len, len);
      }
      return out;
    }
    const m = buildMachine();
    const r = edgeLoad(m, swappedPulses(body(flag, data)), { ix, de: data.length, flag, tStateBudget: 8_000_000 });
    assert(!loaded(r, m, ix, data), "0/1 bit-length swap must fail to load");
  }

  // 3. Dropped sync -> the loader locks the pilot but never reaches the data.
  {
    function noSync(b) {
      const f = b[0] & 0xff;
      const pilot = f < 0x80 ? 8063 : 3223;
      const out = [];
      for (let i = 0; i < pilot; i += 1) out.push(2168);
      // NO 667/735 sync pair
      for (const byte of b) for (let bit = 7; bit >= 0; bit -= 1) {
        const len = ((byte >> bit) & 1) ? BIT1_PULSE_T : BIT0_PULSE_T;
        out.push(len, len);
      }
      return out;
    }
    const m = buildMachine();
    const r = edgeLoad(m, noSync(body(flag, data)), { ix, de: data.length, flag, tStateBudget: 8_000_000 });
    assert(!loaded(r, m, ix, data), "dropped-sync stream must fail to load");
  }

  // 4. Frame-modulo tape clock -> edges lost across the frame wrap.
  {
    const m = buildMachine();
    const startT = m.tStatesTotal;
    const pulses = [...blockToPulses(body(flag, data)), 3500];
    const deck = createTapeDeck(pulses, { clock: () => (m.tStatesTotal - startT) % FRAME_T_STATES, startLevel: 0 });
    const r = edgeLoadWithDeck(m, deck, { ix, de: data.length, flag, tStateBudget: 12_000_000 });
    assert(!loaded(r, m, ix, data), "frame-modulo tape clock must fail to load (monotonic cursor is load-bearing)");
  }

  // 5. Issue-3 idle level tracks the last b4 written (no tape driving the line).
  {
    const idleDeck = createTapeDeck([], { clock: () => 0 });
    idleDeck.write(0xfe, 0x10); // b4 = 1
    assert((idleDeck.read(0xfe) & 0x40) === 0x40, "issue-3 idle: after writing b4=1, b6 must read 1");
    idleDeck.write(0xfe, 0x00); // b4 = 0
    assert((idleDeck.read(0xfe) & 0x40) === 0x00, "issue-3 idle: after writing b4=0, b6 must read 0");
  }

  console.log(
    "Tape edge-load self-test passed: the real TAPE-EDGE-LOAD fixtures load byte-identically through the ROM; a no-edge deck, a 0/1 bit-length swap, a dropped sync, and a frame-modulo tape clock are all rejected; the issue-3 idle level tracks the last b4 written.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
