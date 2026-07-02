#!/usr/bin/env node
// Anti-drift guard for dna/QUICKSTART.md: asserts that every path, runner, import
// surface, and script the emulator recipe names actually exists and matches the
// real runners. If a runner's default module path or a domain file moves, or the
// doc drifts from reality, this fails — so the consumer-facing recipe cannot rot
// silently (repo culture: every claim has a self-test).
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const dnaDir = path.resolve(thisDir, "..");
const repoRoot = path.resolve(dnaDir, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(rel) {
  try {
    await stat(path.join(repoRoot, rel));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function read(rel) {
  return readFile(path.join(repoRoot, rel), "utf8");
}

export async function runQuickstartSelfTest({ quiet = false } = {}) {
  const errors = [];

  // 1. The quickstart itself + the emulator authority specs it cites.
  const requiredFiles = [
    "dna/QUICKSTART.md",
    "dna/domain/z80-cpu-execution.md",
    "dna/domain/ula-timing.md",
    "dna/domain/machine-execution.md",
    "dna/domain/snapshot-z80.md",
    "dna/domain/z80-opcodes.md",
    "dna/domain/z80-opcodes.yaml",
    // the runners the recipe drives
    "dna/conformance/cpu/run-fuse-suite.mjs",
    "dna/conformance/cpu/run-cpu-exec-fixtures.mjs",
    "dna/conformance/cpu/run-cpu-exec-fixtures-self-test.mjs",
    "dna/conformance/timing/run-timing-fixtures.mjs",
    "dna/conformance/machine/run-machine-fixtures.mjs",
    "dna/conformance/formats/run-format-fixtures.mjs",
    "dna/conformance/coverage-check.mjs",
    // the import-surface modules the runners default to (present in this repo)
    "packages/cpu/src/z80-step.mjs",
    "packages/ula/src/index.mjs",
    "packages/machine/src/index.mjs",
  ];
  for (const rel of requiredFiles) {
    if (!(await exists(rel))) errors.push(`missing path named by QUICKSTART: ${rel}`);
  }

  // 2. Each runner still defaults to the module path the recipe documents.
  const importSurface = [
    { runner: "dna/conformance/cpu/run-fuse-suite.mjs", tokens: ["packages", "cpu", "z80-step.mjs"] },
    { runner: "dna/conformance/timing/run-timing-fixtures.mjs", tokens: ["packages", "ula", "index.mjs"] },
    { runner: "dna/conformance/machine/run-machine-fixtures.mjs", tokens: ["packages", "machine", "index.mjs"] },
    { runner: "dna/conformance/formats/run-format-fixtures.mjs", tokens: ["packages", "machine", "index.mjs"] },
  ];
  for (const { runner, tokens } of importSurface) {
    if (!(await exists(runner))) continue; // already reported above
    const src = await read(runner);
    for (const token of tokens) {
      if (!src.includes(`"${token}"`) && !src.includes(token)) {
        errors.push(`${runner}: no longer references '${token}' (QUICKSTART import surface drift)`);
      }
    }
  }

  // 3. The CPU runner still documents the step({registers, memory}) export contract.
  if (await exists("dna/conformance/cpu/run-cpu-exec-fixtures.mjs")) {
    const cpuRunner = await read("dna/conformance/cpu/run-cpu-exec-fixtures.mjs");
    if (!/step\(\{\s*registers/.test(cpuRunner)) {
      errors.push("run-cpu-exec-fixtures.mjs: no longer documents the step({registers, ...}) export");
    }
  }

  // 4. The root package.json exposes the scripts the recipe / matrix reference.
  const pkg = JSON.parse(await read("package.json"));
  for (const script of ["conformance:check:emulator", "coverage:check", "coverage:check:by-area"]) {
    if (!pkg.scripts || !pkg.scripts[script]) {
      errors.push(`package.json: missing script '${script}' referenced by QUICKSTART`);
    }
  }

  // 5. The doc still names the critical tokens (catches the doc drifting from reality).
  const quickstart = await read("dna/QUICKSTART.md");
  const docTokens = [
    "packages/cpu/src/z80-step.mjs",
    "packages/ula/src/index.mjs",
    "packages/machine/src/index.mjs",
    "step({ registers, memory })",
    "23/23 contract+fidelity rows covered [emulator]",
    "conformance:emulator",
    "--by-area",
  ];
  for (const token of docTokens) {
    if (!quickstart.includes(token)) {
      errors.push(`QUICKSTART.md: no longer mentions '${token}' (doc/reality drift)`);
    }
  }

  if (errors.length > 0) {
    console.error(`Quickstart self-test: ${errors.length} drift error(s)`);
    for (const error of errors) console.error(`- ${error}`);
    return { ok: false, errors };
  }

  if (!quiet) {
    console.log(
      "Quickstart self-test passed: the emulator recipe's paths, runner import surface, and scripts all exist and match.",
    );
  }
  return { ok: true, errors: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runQuickstartSelfTest({ quiet: process.argv.includes("--quiet") })
    .then((result) => { if (!result.ok) process.exitCode = 1; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
