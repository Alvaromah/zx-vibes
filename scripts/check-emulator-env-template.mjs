#!/usr/bin/env node
// check-emulator-env-template.mjs — anti-drift gate for the emulator regeneration
// template (scripts/templates/emulator-env/) + its generator (new-emulator-env.mjs).
//
// The template ships a frozen AGENTS.md + package.json gates that point INTO the live
// genome (dna/conformance runners, coverage areas, host-shell reference models). If
// the DNA moves — a runner renamed, a coverage area dropped, a module path changed —
// the template silently rots and a generated environment breaks. This gate fails RED
// the moment the template references anything the genome no longer provides, so the
// maintainer is forced to refresh the template (registered: .harness ADR-0017).
//
// Repo culture: every claim has a self-test. This is the QUICKSTART anti-drift guard's
// sibling, scoped to the packaged template instead of the in-repo recipe.
import { readFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const templateDir = path.join(scriptDir, "templates", "emulator-env");

// Self-tests that pass on a FRESH environment with no packages/ yet — the only ones
// the template's `conformance:self-test` smoke gate may reference (so it stays green
// immediately after generation). Kept in lockstep with the genome on purpose: if the
// DNA adds/removes a package-free self-test, update this set AND the template smoke gate.
const PACKAGE_FREE_SELFTESTS = new Set([
  "dna/conformance/cpu/run-cpu-exec-fixtures-self-test.mjs",
  "dna/conformance/timing/run-timing-fixtures-self-test.mjs",
  "dna/conformance/audio/run-audio-fixtures-self-test.mjs",
  "dna/conformance/keyboard/run-keyboard-fixtures-self-test.mjs",
  "dna/conformance/raster/run-raster-fixtures-self-test.mjs",
]);

// Runner -> the package module path it must still default to (import-surface contract).
// Only runners with a DEFAULT module path belong here; run-cpu-exec-fixtures.mjs
// requires an explicit --module, so run-fuse-suite.mjs is the CPU witness.
const IMPORT_SURFACE = [
  { runner: "dna/conformance/cpu/run-fuse-suite.mjs", tokens: ["packages", "cpu", "z80-step.mjs"] },
  { runner: "dna/conformance/timing/run-timing-fixtures.mjs", tokens: ["packages", "ula", "index.mjs"] },
  { runner: "dna/conformance/machine/run-machine-fixtures.mjs", tokens: ["packages", "machine", "index.mjs"] },
  { runner: "dna/conformance/formats/run-format-fixtures.mjs", tokens: ["packages", "machine", "index.mjs"] },
];

// Paths the template's AGENTS.md cites precisely to say they are NOT in the genome
// (e.g. the never-authored product API). The check verifies they STAY absent: if one
// is later authored, the doc's "this does not exist" claim is stale and must change.
const KNOWN_ABSENT = new Set([
  "dna/product/emulator.md",
]);

// Host-shell reference models the template's AGENTS.md tells the agent to implement against.
const REFERENCE_MODELS = [
  "dna/conformance/host-io/port-fe-event-model.mjs",
  "dna/conformance/audio/beeper-pcm-model.mjs",
  "dna/conformance/keyboard/keyboard-model.mjs",
  "dna/conformance/raster/raster-border-model.mjs",
];

const EXPECTED_TEMPLATE_FILES = [
  "AGENTS.md", "README.md", "package.json", "gitignore",
  "rom/README.md", "tapes/README.md",
];

function existsUnderRepo(rel) {
  try { statSync(path.join(repoRoot, rel)); return true; }
  catch (err) { if (err?.code === "ENOENT") return false; throw err; }
}
function existsAbs(abs) {
  try { statSync(abs); return true; }
  catch (err) { if (err?.code === "ENOENT") return false; throw err; }
}
function readTemplate(rel) { return readFileSync(path.join(templateDir, rel), "utf8"); }

// Pull literal dna/* paths out of prose/scripts; drop globbed/brace prose paths.
function dnaPathsIn(text) {
  const matches = text.match(/dna\/(?:conformance|domain|product|appendix)\/[A-Za-z0-9._/-]+/g) ?? [];
  return [...new Set(matches)]
    .map((p) => p.replace(/[.,)]+$/, ""))
    .filter((p) => !/[*{}]/.test(p));
}

export function runCheck({ quiet = false } = {}) {
  const errors = [];

  // 0. Generator + template present.
  if (!existsAbs(path.join(scriptDir, "new-emulator-env.mjs"))) {
    errors.push("missing generator scripts/new-emulator-env.mjs");
  }
  if (!existsAbs(templateDir)) {
    errors.push(`missing template dir scripts/templates/emulator-env/`);
    return finish(errors, quiet); // nothing more to check
  }
  for (const f of EXPECTED_TEMPLATE_FILES) {
    if (!existsAbs(path.join(templateDir, f))) errors.push(`template missing file: ${f}`);
  }

  // 1. Template package.json parses and keeps a name + the smoke gate.
  let pkg;
  try { pkg = JSON.parse(readTemplate("package.json")); }
  catch (e) { errors.push(`template package.json does not parse: ${e.message}`); }

  if (pkg) {
    if (!pkg.name) errors.push("template package.json has no name");
    const scripts = pkg.scripts ?? {};

    // 2. Every dna/* runner path referenced by ANY gate script exists in the live genome.
    const allScriptText = Object.values(scripts).join("\n");
    for (const p of dnaPathsIn(allScriptText)) {
      if (!existsUnderRepo(p)) errors.push(`package.json gate references missing genome path: ${p}`);
    }

    // 3. The smoke gate must reference ONLY package-free self-tests (stays green on a
    //    fresh env). Anything package-dependent here means a red gate on generation.
    const smoke = scripts["conformance:self-test"];
    if (!smoke) {
      errors.push("template package.json missing 'conformance:self-test' smoke gate");
    } else {
      for (const p of dnaPathsIn(smoke)) {
        if (!PACKAGE_FREE_SELFTESTS.has(p)) {
          errors.push(`smoke gate 'conformance:self-test' references a non-package-free runner: ${p}`);
        }
      }
    }

    // 4. Coverage areas the gates use (--area X) still exist in the ledger.
    const ledger = existsUnderRepo("dna/conformance/coverage.yaml")
      ? readFileSync(path.join(repoRoot, "dna/conformance/coverage.yaml"), "utf8") : "";
    const knownAreas = new Set((ledger.match(/area:\s*([a-z-]+)/g) ?? []).map((m) => m.split(/\s+/)[1]));
    for (const m of allScriptText.matchAll(/--area\s+([a-z-]+)/g)) {
      if (!knownAreas.has(m[1])) errors.push(`package.json gate uses coverage area '${m[1]}' not present in coverage.yaml`);
    }
  }

  // 5. Import-surface: each runner still defaults to the package module the template documents.
  for (const { runner, tokens } of IMPORT_SURFACE) {
    if (!existsUnderRepo(runner)) { errors.push(`import-surface runner missing: ${runner}`); continue; }
    const src = readFileSync(path.join(repoRoot, runner), "utf8");
    for (const t of tokens) {
      if (!src.includes(t)) errors.push(`${runner}: no longer references '${t}' (import-surface drift vs template)`);
    }
  }

  // 6. Host-shell reference models the AGENTS.md points the agent at still exist.
  for (const m of REFERENCE_MODELS) {
    if (!existsUnderRepo(m)) errors.push(`AGENTS.md cites missing reference model: ${m}`);
  }

  // 7. Every literal dna/* path the template's AGENTS.md + README cite exists —
  //    except the KNOWN_ABSENT paths cited as deliberately-missing, which must STAY missing.
  for (const doc of ["AGENTS.md", "README.md"]) {
    for (const p of dnaPathsIn(readTemplate(doc))) {
      if (KNOWN_ABSENT.has(p)) continue;
      if (!existsUnderRepo(p)) errors.push(`template ${doc} cites missing genome path: ${p}`);
    }
  }
  for (const p of KNOWN_ABSENT) {
    if (existsUnderRepo(p)) {
      errors.push(`AGENTS.md claims '${p}' does not exist, but it now does — update the 'Out of scope' note`);
    }
  }

  return finish(errors, quiet);
}

function finish(errors, quiet) {
  if (errors.length > 0) {
    console.error(`emulator-env template check: ${errors.length} drift error(s)`);
    for (const e of errors) console.error(`- ${e}`);
    return { ok: false, errors };
  }
  if (!quiet) {
    console.log("emulator-env template check passed: the packaged template + generator match the live DNA (runners, coverage areas, import surface, reference models).");
  }
  return { ok: true, errors: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runCheck({ quiet: process.argv.includes("--quiet") });
  if (!result.ok) process.exitCode = 1;
}
