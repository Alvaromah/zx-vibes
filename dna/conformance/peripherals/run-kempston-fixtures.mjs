#!/usr/bin/env node
// Runs Kempston joystick conformance fixtures (`kind: "kempston-query"`) against a
// Kempston model module (the regenerated @zx-vibes/ula). This is what flips
// JOY-KEMPSTON-001 to `covered`: it executes a committed implementation.
//
// Model module contract (the regeneration target, dna/domain/peripherals.md
// "Kempston joystick", JOY-KEMPSTON-*):
//   export function kempstonByte(state) -> number       (active-high 000FUDLR byte)
//   export function kempstonDecodes(port) -> boolean    (true iff low byte == 0x1F)
//   export const KEMPSTON_PORT = 0x1f                    (the canonical port)
//
// Fixture shape (mirrors the other query fixtures): input.cases name a `query` and
// optional `args`; expected.cases give each case's value, matched by name:
//   input:    { kind: "kempston-query", cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number|boolean> } ] }
// query is one of: kempstonByte (one state-object arg) | kempstonDecodes (one numeric
// port arg) | kempstonPort (no args -> the KEMPSTON_PORT constant).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(thisDir, "..", "..", "..");
const defaultModule = path.join(repoRoot, "packages", "ula", "src", "index.mjs");
const defaultFixturePath = thisDir;

function parseArgs(argv) {
  const options = { fixtures: defaultFixturePath, modulePath: defaultModule, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      const value = argv[index + 1];
      if (!value) throw new Error("--fixtures requires a path");
      options.fixtures = path.resolve(value);
      index += 1;
    } else if (arg === "--module") {
      const value = argv[index + 1];
      if (!value) throw new Error("--module requires a path");
      options.modulePath = path.resolve(value);
      index += 1;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    "Usage: node dna/conformance/peripherals/run-kempston-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs kempston-query fixtures against a Kempston model (default: @zx-vibes/ula).",
  ].join("\n");
}

function buildDispatch(model) {
  return {
    kempstonByte: (state) => model.kempstonByte(state),
    kempstonDecodes: (port) => model.kempstonDecodes(port),
    kempstonPort: () => model.KEMPSTON_PORT,
  };
}

async function collectFixtureFiles(target) {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const entries = await readdir(target, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((l, r) => l.name.localeCompare(r.name))) {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectFixtureFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".json")) collected.push(entryPath);
  }
  return collected;
}

async function loadFixtures(target) {
  const files = await collectFixtureFiles(target);
  const fixtures = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) fixtures.push({ file, fixture });
  }
  return fixtures;
}

export async function runKempstonFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const model = await import(pathToFileURL(options.modulePath).href);
  const dispatch = buildDispatch(model);

  const fixtures = await loadFixtures(options.fixtures);
  const failures = [];
  let caseCount = 0;

  for (const { fixture } of fixtures) {
    if (fixture?.input?.kind !== "kempston-query") continue;
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name);
      if (!expected) {
        failures.push(`${fixture.id}: missing expected case '${testCase.name}'`);
        continue;
      }
      const fn = dispatch[testCase.query];
      if (!fn) {
        failures.push(`${fixture.id}/${testCase.name}: unknown query '${testCase.query}'`);
        continue;
      }
      let actual;
      try {
        actual = fn(...(testCase.args ?? []));
      } catch (error) {
        failures.push(`${testCase.name}: ${testCase.query}() threw: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (actual !== expected.value) {
        failures.push(`${testCase.name}: ${testCase.query}(${JSON.stringify(testCase.args ?? [])}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected.value)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Kempston fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Kempston fixtures: ${caseCount} case(s) passed (@zx-vibes/ula via run-kempston-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKempstonFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
