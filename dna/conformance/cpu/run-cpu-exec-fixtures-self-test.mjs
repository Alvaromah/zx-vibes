#!/usr/bin/env node
// Self-test for the CPU-execution fixture runner.
//
// The decisive check runs the REAL cpu/inc-r.json through an independent
// reference INC r step (authored here from the documented rule in
// dna/domain/z80-cpu-execution.md, NOT from the legacy emulator and NOT the
// regeneration under test). If every fixture case passes against this reference,
// the fixture's hand-authored expected values -- including the FUSE-transcribed
// cases -- are proven internally consistent with the documented rule. The
// regeneration must later satisfy the same fixture independently.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-cpu-exec-fixtures.mjs");
const realFixture = path.join(thisDir, "inc-r.json");

// A faithful, INC-r-only reference step computed straight from the documented
// rule: res = (r+1)&0xFF; S/Z/5/H/3/PV from result+operand; N=0; C preserved.
const REFERENCE_STEP = `
const INC_TARGET = { 0x04: "b", 0x0c: "c", 0x14: "d", 0x1c: "e", 0x24: "h", 0x2c: "l", 0x3c: "a" };
export function step({ registers, memory }) {
  const opcode = memory[registers.pc & 0xffff];
  const target = INC_TARGET[opcode];
  if (!target) throw new Error("reference step only implements INC r");
  const before = registers[target];
  const res = (before + 1) & 0xff;
  registers[target] = res;
  let f = registers.f & 0x01; // preserve C, clear the rest (including N)
  if (res & 0x80) f |= 0x80;            // S
  if (res === 0) f |= 0x40;             // Z
  if (res & 0x20) f |= 0x20;            // 5
  if ((before & 0x0f) === 0x0f) f |= 0x10; // H
  if (res & 0x08) f |= 0x08;            // 3
  if (before === 0x7f) f |= 0x04;       // P/V
  registers.f = f;
  registers.pc = (registers.pc + 1) & 0xffff;
  registers.r = (registers.r & 0x80) | ((registers.r + 1) & 0x7f);
  return { registers, tStates: 4 };
}
`;

// Same as the reference but with a deliberately wrong half-carry rule, to prove
// the runner reports a flag mismatch rather than passing silently.
const BROKEN_STEP = REFERENCE_STEP.replace("if ((before & 0x0f) === 0x0f) f |= 0x10;", "/* H rule omitted */");

const MODULE_WITHOUT_STEP = "export const notStep = 1;\n";

const SMALL_FIXTURE = {
  id: "CPU-EXEC-SELF-TEST",
  tier: "fidelity",
  provenance: "z80-spec",
  input: {
    kind: "cpu-step",
    cases: [{ name: "inc-b", registers: { b: "FF" }, memory: { "0000": "04" } }],
  },
  expected: {
    cases: [{ name: "inc-b", registers: { b: "00", f: "50", pc: "0001" }, tStates: 4 }],
  },
  normalization: { profile: "custom" },
};

function run(args) {
  return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cpu-exec-self-test-"));
  try {
    const referenceModule = path.join(dir, "reference-step.mjs");
    const brokenModule = path.join(dir, "broken-step.mjs");
    const noStepModule = path.join(dir, "no-step.mjs");
    const smallFixture = path.join(dir, "small.json");
    await writeFile(referenceModule, REFERENCE_STEP, "utf8");
    await writeFile(brokenModule, BROKEN_STEP, "utf8");
    await writeFile(noStepModule, MODULE_WITHOUT_STEP, "utf8");
    await writeFile(smallFixture, JSON.stringify(SMALL_FIXTURE), "utf8");

    // 1. The real fixture passes against the independent reference step. This
    //    proves the authored expected values (FUSE + boundary) are correct.
    const real = run(["--module", referenceModule, "--fixtures", realFixture, "--quiet"]);
    assert(real.status === 0, `expected real inc-r.json to pass against reference step\n${real.stdout}\n${real.stderr}`);

    // 2. A wrong implementation is caught and the report names the bad flag.
    const broken = run(["--module", brokenModule, "--fixtures", smallFixture, "--quiet"]);
    assert(broken.status !== 0, "expected broken H rule to fail");
    assert(`${broken.stdout}${broken.stderr}`.includes("register f"), "expected mismatch report to name register f");

    // 3. A module without step() and a missing --module are rejected (exit 2).
    const noStep = run(["--module", noStepModule, "--fixtures", smallFixture, "--quiet"]);
    assert(noStep.status === 2, "expected module without step() to exit 2");
    const noModule = run(["--fixtures", smallFixture, "--quiet"]);
    assert(noModule.status === 2, "expected missing --module to exit 2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "CPU exec fixture self-test passed: real inc-r.json validates against an independent reference INC r step; wrong/invalid implementations are rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
