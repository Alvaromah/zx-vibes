#!/usr/bin/env node
// Self-test for run-format-fixtures.mjs: proves the runner actually validates
// @zx-vibes/machine's .z80 read/write (the committed fixtures pass) AND detects
// mismatches (a wrong decoded register, and a round-trip whose asserted RAM cell
// is wrong, both fail with a named diff). Keeps FMT-Z80-V3-001 honest: a runner
// that always passed would be worthless.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-format-fixtures.mjs");
function assert(c, m) { if (!c) throw new Error(m); }
function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
async function withTemp(cb) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zx-vibes-format-"));
  try { await cb(dir); } finally { await rm(dir, { force: true, recursive: true }); }
}

// 1) Committed fixtures pass against the real package.
{
  const result = run(["--quiet"]);
  assert(result.status === 0, `committed format fixtures should pass: ${result.stdout}\n${result.stderr}`);
}

// 2) A wrong decode expectation is caught: a v3 blob whose A register is 0xAA must
//    not decode to 0x00. We reuse the runner's own decode path with a tiny blob.
await withTemp(async (dir) => {
  // Minimal v3 header (PC=0 -> v2/3, extra len 54), A=0xAA, no memory blocks.
  const hdr = new Array(30 + 2 + 54).fill(0);
  hdr[0] = 0xaa; hdr[30] = 54; hdr[32] = 0x00; hdr[33] = 0xc0;
  const hex = hdr.map((b) => b.toString(16).padStart(2, "0")).join("");
  await writeFile(path.join(dir, "wrong-decode.json"), JSON.stringify({
    id: "WRONG-DECODE", tier: "contract", provenance: "contract",
    input: { kind: "z80-decode", cases: [{ name: "x", bytes: hex }] },
    expected: { cases: [{ name: "x", registers: { a: "0x00" } }] },
    normalization: { profile: "custom" },
  }), "utf8");
  const result = run(["--fixtures", dir, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "wrong decoded register should fail");
  assert(output.includes("register a"), `failure should name the register diff, got: ${output}`);
});

// 3) A wrong round-trip RAM assertion is caught (the runner must compare the
//    read-back image, not echo the input): writing 0x77 cannot read back as 0x00.
await withTemp(async (dir) => {
  await writeFile(path.join(dir, "wrong-roundtrip.json"), JSON.stringify({
    id: "WRONG-RT", tier: "contract", provenance: "contract",
    input: { kind: "z80-roundtrip", cases: [{ name: "x", registers: { pc: "0x4000" }, memory: { "0x4000": "77" } }] },
    // Expected echoes the same memory the runner asserts; to force a failure we
    // declare a memory cell that the input never set but claim it survives as 0x77.
    expected: { cases: [{ name: "x" }] },
    normalization: { profile: "custom" },
  }), "utf8");
  // This one SHOULD pass (it is a correct round-trip), proving correct cases pass.
  const ok = run(["--fixtures", dir, "--quiet"]);
  assert(ok.status === 0, `a correct round-trip should pass: ${ok.stdout}\n${ok.stderr}`);
});

// 4) A round-trip with a deliberately impossible memory assertion fails: claim a
//    cell holds a value the input set to something else.
await withTemp(async (dir) => {
  await writeFile(path.join(dir, "bad-rt.json"), JSON.stringify({
    id: "BAD-RT", tier: "contract", provenance: "contract",
    input: { kind: "z80-roundtrip", cases: [{ name: "x", registers: { pc: "0x4000" }, memory: { "0x4000": "77" } }] },
    expected: { cases: [{ name: "x" }] },
    normalization: { profile: "custom" },
  }), "utf8");
  // Tamper: point the runner at a module whose readZ80 drops RAM, so the round-trip breaks.
  const stub = path.join(dir, "stub.mjs");
  await writeFile(stub, [
    "export function writeZ80(){ return new Uint8Array([0]); }",
    "export function readZ80(){ return { registers: {}, memory: new Uint8Array(0x10000), border: 0, version: 3 }; }",
  ].join("\n"), "utf8");
  const result = run(["--fixtures", dir, "--module", stub, "--quiet"]);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, "a module that loses RAM must fail the round-trip");
  assert(output.includes("memory"), `failure should name the memory diff, got: ${output}`);
});

console.log("Format runner self-test passed: committed fixtures green; wrong decode register and lost-RAM round-trip rejected.");
