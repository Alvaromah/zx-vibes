#!/usr/bin/env node
// Conformance gate for the regenerated CPU: runs the shipped @zx-vibes/cpu step()
// against every FUSE per-opcode group fixture (dna/conformance/cpu/fuse/*.json)
// via the shared run-cpu-exec-fixtures runner. Exit 0 iff all groups pass.
//
// This is what flips the CPU-FUSE-* coverage rows to `covered`: the gate runs a
// committed implementation, not a scratchpad artifact.
//
// `--module <path>` / `--fixtures <dir>` point the same gate at another step()
// implementation or fixture tree (a regeneration under test); any other argument
// is an error rather than being ignored.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCpuExecFixtures } from "./run-cpu-exec-fixtures.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
// Runs every cpu-step fixture under conformance/cpu/ (the per-opcode FUSE groups
// plus the INC r slice with its spec-derived boundary cases) against the package.
const cpuFixtureDir = thisDir;
const stepModule = path.join(repoRoot, "packages", "cpu", "src", "z80-step.mjs");
const USAGE = "Usage: run-fuse-suite.mjs [--module <path>] [--fixtures <dir>] [--quiet]";

export function parseFuseSuiteArgs(argv) {
  const options = { quiet: false, modulePath: stepModule, fixtures: cpuFixtureDir };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--module" || arg === "--fixtures") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a path. ${USAGE}`);
      options[arg === "--module" ? "modulePath" : "fixtures"] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}. ${USAGE}`);
    }
  }
  return options;
}

export async function runFuseSuite({ quiet = false, modulePath = stepModule, fixtures = cpuFixtureDir } = {}) {
  const result = await runCpuExecFixtures([
    "--module", modulePath,
    "--fixtures", fixtures,
    ...(quiet ? ["--quiet"] : []),
  ]);
  if (result.exitCode === 0 && !quiet) {
    const subject = modulePath === stepModule ? "@zx-vibes/cpu" : modulePath;
    console.log(`CPU FUSE suite: ${subject} passes the whole pinned FUSE ISA oracle (single-step + run-to-budget)`);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve()
    .then(() => runFuseSuite(parseFuseSuiteArgs(process.argv.slice(2))))
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
