#!/usr/bin/env node
// Self-test for run-machine-fixtures.mjs: proves the machine runner actually
// validates @zx-vibes/machine (passes the committed fixtures) AND detects
// mismatches (a deliberately-wrong expected value fails with a named diff). This
// is the guard that keeps the MACHINE-* coverage rows honest: a runner that
// always passed would be worthless.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-machine-fixtures.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

async function withTempFixtures(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-machine-"));
  try {
    await callback(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

// 1) The committed fixtures pass against the real package.
{
  const result = run(["--quiet"]);
  assert(result.status === 0, `committed machine fixtures should pass: ${result.stdout}\n${result.stderr}`);
}

// 2) A wrong interrupt expectation is caught (IM 1 must vector to 0x0038, not 0x0066).
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-interrupt.json"),
    JSON.stringify({
      id: "WRONG-INT",
      tier: "fidelity",
      provenance: "z80-spec",
      input: {
        kind: "machine-interrupt",
        cases: [{ name: "im1", registers: { sp: "0xff00", pc: "0x1234", iff1: 1, iff2: 1, im: 1 } }],
      },
      expected: { cases: [{ name: "im1", registers: { pc: "0x0066" }, accepted: true }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "wrong interrupt vector should fail");
  assert(output.includes("register pc"), `failure should name the pc mismatch, got: ${output}`);
});

// 3) A wrong contention expectation is caught (the runner must compute the ULA delay,
//    not echo the fixture): a contended fetch at frame T 14335 adds 6, not 0.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-contention.json"),
    JSON.stringify({
      id: "WRONG-CONT",
      tier: "fidelity",
      provenance: "hardware",
      input: {
        kind: "machine-run",
        cases: [{ name: "con", registers: { pc: "0x4000" }, memory: { "0x4000": "00" }, clock: 14335, steps: 1 }],
      },
      expected: { cases: [{ name: "con", contention: 0, tStates: 4 }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "wrong contention should fail");
  assert(output.includes("contention") || output.includes("tStates"), `failure should name the contention/tStates mismatch, got: ${output}`);
});

// 4) The M-cycle-exact model must charge internal no-MREQ cycles (not echo a
//    per-access value): ADD HL,BC with I in a contended page (IR=0x4001) spends 7
//    internal cycles there, which the per-access model would count as 0. A fixture
//    that (wrongly) expects 0 must fail under exact:true.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-mcycle.json"),
    JSON.stringify({
      id: "WRONG-MCYCLE",
      tier: "fidelity",
      provenance: "hardware",
      input: {
        kind: "machine-run",
        cases: [{
          name: "addhl", registers: { pc: "0x8000", i: "0x40", r: "0x00", h: "0x12", l: "0x34", b: "0x00", c: "0x01" },
          memory: { "0x8000": "09" }, clock: 14335, exact: true, steps: 1,
        }],
      },
      expected: { cases: [{ name: "addhl", contention: 0, tStates: 11 }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "exact model must charge internal IR cycles (contention != 0)");
  assert(output.includes("contention") || output.includes("tStates"), `failure should name the contention/tStates mismatch, got: ${output}`);
});

// 5) NMI is non-maskable: a model that masks on IFF1 (expects accepted=false when
//    IFF1=0) must be rejected — acceptNmi accepts regardless of IFF1.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-nmi-mask.json"),
    JSON.stringify({
      id: "WRONG-NMI-MASK",
      tier: "fidelity",
      provenance: "hardware",
      input: {
        kind: "machine-nmi",
        cases: [{ name: "n", registers: { sp: "0xff00", pc: "0x1234", iff1: 0, iff2: 0, r: "0x00" } }],
      },
      expected: { cases: [{ name: "n", registers: { pc: "0x1234" }, accepted: false }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "NMI must accept even with IFF1=0 (non-maskable)");
  assert(output.includes("accepted") || output.includes("register pc"), `failure should name accepted/pc, got: ${output}`);
});

// 6) NMI must PRESERVE IFF2 (unlike the maskable INT which clears it): a fixture
//    that expects IFF2=0 after an NMI entered with IFF1=IFF2=1 must fail.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-nmi-iff2.json"),
    JSON.stringify({
      id: "WRONG-NMI-IFF2",
      tier: "fidelity",
      provenance: "hardware",
      input: {
        kind: "machine-nmi",
        cases: [{ name: "n", registers: { sp: "0xff00", pc: "0x1234", iff1: 1, iff2: 1, r: "0x10" } }],
      },
      expected: { cases: [{ name: "n", registers: { iff2: 0 }, accepted: true }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "NMI must preserve IFF2 (not clear it like the maskable INT)");
  assert(output.includes("iff2"), `failure should name the iff2 mismatch, got: ${output}`);
});

// 7) NMI must push PC (high-byte first) and vector to 0x0066: a fixture that
//    expects the maskable vector 0x0038 and an un-pushed stack must fail.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-nmi-vector.json"),
    JSON.stringify({
      id: "WRONG-NMI-VECTOR",
      tier: "fidelity",
      provenance: "hardware",
      input: {
        kind: "machine-nmi",
        cases: [{ name: "n", registers: { sp: "0xff00", pc: "0x1234", iff1: 1, iff2: 1, r: "0x10" } }],
      },
      expected: { cases: [{ name: "n", registers: { pc: "0x0038" }, memory: { "0xfefe": "0000" }, accepted: true }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "NMI must vector to 0x0066 and push PC (not 0x0038 / un-pushed)");
  assert(output.includes("register pc") || output.includes("memory"), `failure should name the pc/memory mismatch, got: ${output}`);
});

// 8) reset() must establish the documented state, not echo the dirtied input: a
//    fixture that dirties PC/SP then (wrongly) expects PC=0x0001 and SP=0x0000 after
//    reset must fail (real reset gives PC=0x0000, SP=0xFFFF). Keeps MACHINE-RESET-001
//    honest at the trivial tier.
await withTempFixtures(async (dir) => {
  await writeFile(
    path.join(dir, "wrong-reset.json"),
    JSON.stringify({
      id: "WRONG-RESET",
      tier: "fidelity",
      provenance: "decision:ADR-0021",
      input: {
        kind: "machine-reset",
        cases: [{ name: "x", registers: { pc: "0x4242", sp: "0x1234" }, memory: { "0x4000": "ff" } }],
      },
      expected: { cases: [{ name: "x", registers: { pc: "0x0001", sp: "0x0000" } }] },
      normalization: { profile: "custom" },
    }),
    "utf8",
  );
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "reset must give PC=0x0000 / SP=0xFFFF (not echo the dirtied input)");
  assert(output.includes("register pc") || output.includes("register sp"), `failure should name the pc/sp mismatch, got: ${output}`);
});

console.log("Machine runner self-test passed: committed fixtures green; wrong maskable-interrupt vector, wrong per-access contention, wrong M-cycle-exact (internal-cycle) contention, a non-maskable NMI that (wrongly) masks on IFF1 / clears IFF2 / fails to push PC + vector to 0x0066, and a reset that echoes the dirtied PC/SP are all rejected.");
