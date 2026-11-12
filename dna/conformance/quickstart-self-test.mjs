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

// Runners an emulator row lists that the regeneration recipe deliberately leaves to the
// full source-repo gate: the zexdoc/zexall belt needs an external payload, the
// edge-load acceptance runner needs the assembler's dist, and the exec-fixtures runner
// is driven through run-fuse-suite.mjs.
const RECIPE_EXEMPT = new Set([
  "conformance/cpu/run-zex.mjs",
  "conformance/tape/run-tape-edge-load-accept.mjs",
  "conformance/cpu/run-cpu-exec-fixtures.mjs",
]);

/** The emulator area's contract+fidelity row count and the non-self-test runners its rows list. */
function emulatorCoverage(yamlText) {
  let rowCount = 0;
  const runners = new Set();
  for (const row of yamlText.split(/\n  - id: /).slice(1)) {
    const area = row.match(/\n    area: (\S+)/)?.[1];
    const tier = row.match(/\n    tier: (\S+)/)?.[1];
    if (area !== "emulator" || (tier !== "contract" && tier !== "fidelity")) continue;
    rowCount += 1;
    for (const entry of (row.match(/\n    fixtures: \[(.*)\]/)?.[1] ?? "").split(",")) {
      const file = entry.trim();
      if (/\/run-[^/]*\.mjs$/.test(file) && !file.includes("self-test") && !RECIPE_EXEMPT.has(file)) runners.add(file);
    }
  }
  return { rowCount, runners: [...runners].sort() };
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
  //    The expected coverage line and the runners the recipe must drive are derived from
  //    coverage.yaml, so adding an emulator row or runner makes this fail until the
  //    recipe is updated (it used to pin a literal "23/23" while the area grew to 45 rows
  //    and the recipe ran only 5 of its runners).
  const quickstart = await read("dna/QUICKSTART.md");
  const { rowCount, runners } = emulatorCoverage(await read("dna/conformance/coverage.yaml"));
  const docTokens = [
    "packages/cpu/src/z80-step.mjs",
    "packages/ula/src/index.mjs",
    "packages/machine/src/index.mjs",
    "step({ registers, memory })",
    `${rowCount}/${rowCount} contract+fidelity rows covered [emulator]`,
    "conformance:emulator",
    "--by-area",
  ];
  const recipe = quickstart.match(/"conformance:emulator":\s*"([^"]*)"/)?.[1] ?? "";
  for (const runner of runners) {
    if (!recipe.includes(`dna/${runner}`)) {
      errors.push(`QUICKSTART.md: the conformance:emulator recipe does not run dna/${runner} (an emulator coverage row needs it)`);
    }
  }
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
