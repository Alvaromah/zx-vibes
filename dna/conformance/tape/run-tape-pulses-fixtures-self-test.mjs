#!/usr/bin/env node
// Self-test for the tape→EAR pulse runner (TAPE-EAR-PULSES-001, tape-loading.md
// TAPE-PULSE-*). Fidelity-tier: the encoding has genuine content (the pilot count by
// flag, the 0/1 bit lengths, MSB-first bit order, the exact pulse sequence), so beyond
// an independent reference we run the full adversarial battery.
//
// Decisive checks:
//   1. The REAL fixtures (tape-pulses.json: a header block, a data block, a byte/empty
//      case) pass against an INDEPENDENT reference authored here from tape-loading.md —
//      NOT the shipped @zx-vibes/machine module.
//   2. A FLAG-INDEPENDENT-PILOT model (always the header pilot count) fails — caught by
//      the data block's pilot-run / pulse-count.
//   3. A BIT-SWAP model (0 bit = 1710, 1 bit = 855) fails — caught by the bit pulse values.
//   4. An LSB-FIRST model (bits emitted low-to-high) fails — caught by the 0x55 / 0xA3 ordering.
//   5. A MISSING-SYNC model (drops the 735 T sync pulse) fails — caught by sync2 / pulse-count.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-tape-pulses-fixtures.mjs");
const realFixtures = path.join(thisDir, "tape-pulses.json");

// Independent reference: re-derived from the spec, not importing @zx-vibes/machine.
// The /*ANCHOR*/ markers below are the seams the broken variants edit.
const REFERENCE_MODEL = `
const PILOT = 2168, S1 = 667, S2 = 735, B0 = 855, B1 = 1710, PH = 8063, PD = 3223;
function toBytes(d) { return d instanceof Uint8Array ? d : Uint8Array.from(d || []); }
function bitLen(set) { return set ? B1 : B0; } /*BITLEN*/
export function bytePulses(byte) {
  const out = [];
  for (let bit = 7; bit >= 0; bit -= 1) { /*BITLOOP*/
    const len = bitLen((byte >> bit) & 1);
    out.push(len, len);
  }
  return out;
}
export function blockToPulses(bytes) {
  const b = toBytes(bytes);
  if (b.length === 0) throw new Error("empty body");
  const flag = b[0] & 0xff;
  const pilot = flag < 0x80 ? PH : PD; /*PILOTSEL*/
  const out = [];
  for (let i = 0; i < pilot; i++) out.push(PILOT);
  out.push(S1); out.push(S2); /*SYNC*/
  for (let i = 0; i < b.length; i++) {
    for (const p of bytePulses(b[i])) out.push(p);
  }
  return out;
}
`;

// Broken: pilot count ignores the flag (always the header length).
const FLAG_INDEPENDENT_PILOT_MODEL = REFERENCE_MODEL
  .replace("const pilot = flag < 0x80 ? PH : PD; /*PILOTSEL*/", "const pilot = PH; /*PILOTSEL*/");

// Broken: the 0 and 1 bit pulse lengths are swapped.
const BIT_SWAP_MODEL = REFERENCE_MODEL
  .replace("function bitLen(set) { return set ? B1 : B0; } /*BITLEN*/", "function bitLen(set) { return set ? B0 : B1; } /*BITLEN*/");

// Broken: bits are emitted least-significant first.
const LSB_FIRST_MODEL = REFERENCE_MODEL
  .replace("for (let bit = 7; bit >= 0; bit -= 1) { /*BITLOOP*/", "for (let bit = 0; bit <= 7; bit += 1) { /*BITLOOP*/");

// Broken: the second sync pulse (735 T) is dropped.
const MISSING_SYNC_MODEL = REFERENCE_MODEL
  .replace("out.push(S1); out.push(S2); /*SYNC*/", "out.push(S1); /*SYNC*/");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tape-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const flagPilot = await write("flag-independent-pilot.mjs", FLAG_INDEPENDENT_PILOT_MODEL);
    const bitSwap = await write("bit-swap.mjs", BIT_SWAP_MODEL);
    const lsbFirst = await write("lsb-first.mjs", LSB_FIRST_MODEL);
    const missingSync = await write("missing-sync.mjs", MISSING_SYNC_MODEL);

    // Guard: each broken variant must actually differ from the reference (a renamed
    // anchor would silently no-op the replace and weaken the test).
    for (const [src, label] of [
      [FLAG_INDEPENDENT_PILOT_MODEL, "flag-independent-pilot"],
      [BIT_SWAP_MODEL, "bit-swap"],
      [LSB_FIRST_MODEL, "lsb-first"],
      [MISSING_SYNC_MODEL, "missing-sync"],
    ]) {
      assert(src !== REFERENCE_MODEL, `${label} variant did not change the reference (stale anchor)`);
    }

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real tape-pulses fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [flagPilot, "flag-independent-pilot model"],
      [bitSwap, "bit-swap model"],
      [lsbFirst, "lsb-first model"],
      [missingSync, "missing-sync model"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the tape-pulses fixtures`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Tape-pulses fixture self-test passed: the real TAPE-EAR-PULSES fixtures validate against an independent reference; a flag-independent pilot count, a 0/1 bit-length swap, an LSB-first bit order, and a dropped sync pulse are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
