#!/usr/bin/env node
// Self-test for the ULA timing fixture runner.
//
// The decisive check runs the REAL timing fixtures (frame-length.json,
// contention.json) through an INDEPENDENT reference timing model authored here
// straight from dna/domain/ula-timing.md (NOT the @zx-vibes/ula package under
// test, NOT the legacy emulator). If every fixture case passes against this
// reference, the hand-authored expected values are proven consistent with the
// documented rule. The regeneration must then satisfy the same fixtures.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-timing-fixtures.mjs");
const realFixtures = thisDir; // frame-length.json + contention.json live here

// Independent reference, authored from the documented rule (frame 312x224=69888;
// INT 32 T at frame start; contended 0x4000-0x7FFF; pattern 6,5,4,3,2,1,0,0 over
// 192 lines of 224 T from frame T 14335, first 128 T/line contended).
const REFERENCE_MODEL = `
const FRAME = 312 * 224;
export const FRAME_T_STATES = FRAME;
export const INTERRUPT_T_STATES = 32;
const wrap = (t) => ((t % FRAME) + FRAME) % FRAME;
export function interruptActive(t) { return wrap(t) < 32; }
export function isContendedAddress(a) { const x = a & 0xffff; return x >= 0x4000 && x <= 0x7fff; }
const PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];
export function contentionDelay(t) {
  const offset = wrap(t) - 14335;
  if (offset < 0) return 0;
  const line = Math.floor(offset / 224);
  if (line >= 192) return 0;
  const col = offset % 224;
  if (col >= 128) return 0;
  return PATTERN[col % 8];
}
`;

// Same but with a deliberately wrong contention pattern, to prove a mismatch is
// reported (and the report names the query).
const BROKEN_MODEL = REFERENCE_MODEL.replace("const PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];", "const PATTERN = [0, 0, 0, 0, 0, 0, 0, 0];");

const SMALL_FIXTURE = {
  id: "TIM-SELF-TEST",
  tier: "fidelity",
  provenance: "hardware",
  input: {
    kind: "timing-query",
    cases: [
      { name: "frame", query: "frameTStates" },
      { name: "contend-peak", query: "contentionDelay", args: [14335] },
    ],
  },
  expected: {
    cases: [
      { name: "frame", value: 69888 },
      { name: "contend-peak", value: 6 },
    ],
  },
  normalization: { profile: "custom" },
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "timing-self-test-"));
  try {
    const referenceModule = path.join(dir, "reference-timing.mjs");
    const brokenModule = path.join(dir, "broken-timing.mjs");
    const smallFixture = path.join(dir, "small.json");
    await writeFile(referenceModule, REFERENCE_MODEL, "utf8");
    await writeFile(brokenModule, BROKEN_MODEL, "utf8");
    await writeFile(smallFixture, JSON.stringify(SMALL_FIXTURE), "utf8");

    // 1. The real fixtures pass against the independent reference model. This
    //    proves the authored expected values are correct.
    const real = run(["--module", referenceModule, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real timing fixtures to pass against reference model\n${real.stdout}\n${real.stderr}`);

    // 2. A wrong contention pattern is caught and the report names the query.
    const broken = run(["--module", brokenModule, "--fixtures", smallFixture, "--quiet"]);
    assert(broken.status !== 0, "expected broken contention pattern to fail");
    assert(`${broken.stdout}${broken.stderr}`.includes("contentionDelay"), "expected mismatch report to name contentionDelay");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Timing fixture self-test passed: real frame/contention fixtures validate against an independent reference timing model; a wrong model is rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
