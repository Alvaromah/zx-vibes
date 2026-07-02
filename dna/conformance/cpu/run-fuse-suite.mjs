#!/usr/bin/env node
// Conformance gate for the regenerated CPU: runs the shipped @zx-vibes/cpu step()
// against every FUSE per-opcode group fixture (dna/conformance/cpu/fuse/*.json)
// via the shared run-cpu-exec-fixtures runner. Exit 0 iff all groups pass.
//
// This is what flips the CPU-FUSE-* coverage rows to `covered`: the gate runs a
// committed implementation, not a scratchpad artifact.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCpuExecFixtures } from "./run-cpu-exec-fixtures.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
// Runs every cpu-step fixture under conformance/cpu/ (the per-opcode FUSE groups
// plus the INC r slice with its spec-derived boundary cases) against the package.
const cpuFixtureDir = thisDir;
const stepModule = path.join(repoRoot, "packages", "cpu", "src", "z80-step.mjs");

export async function runFuseSuite({ quiet = false } = {}) {
  const result = await runCpuExecFixtures([
    "--module", stepModule,
    "--fixtures", cpuFixtureDir,
    ...(quiet ? ["--quiet"] : []),
  ]);
  if (result.exitCode === 0 && !quiet) {
    console.log("CPU FUSE suite: @zx-vibes/cpu passes the whole pinned FUSE ISA oracle (single-step + run-to-budget)");
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFuseSuite({ quiet: process.argv.includes("--quiet") })
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
