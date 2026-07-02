#!/usr/bin/env node
// Runs the gallery screen-palette conformance fixture (`kind: "screen-palette-query"`,
// SCREEN-PALETTE-001, decision:ADR-0022) against a palette model. This flips
// SCREEN-PALETTE-001 to `covered`: it executes a committed model that reads the
// normative dna/product/palette.yaml, not a scratchpad artifact.
//
// Model module (default --module): dna/conformance/screen/screen-palette-model.mjs.
//   export function paletteRgb(index) -> [r, g, b]
//   export const PALETTE_SIZE         -> int
//
// Fixture shape: input.cases name a `query` and optional `args`; expected.cases give
// each case's value (a number, or an [r,g,b] array), matched by name:
//   input:    { kind: "screen-palette-query", cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number|array> } ] }
// query is one of: paletteRgb (index) | paletteSize (no args).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultModule = path.join(thisDir, "screen-palette-model.mjs");

function parseArgs(argv) {
  const options = { fixtures: thisDir, modulePath: defaultModule, quiet: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixtures") {
      if (!argv[index + 1]) throw new Error("--fixtures requires a path");
      options.fixtures = path.resolve(argv[index + 1]); index += 1;
    } else if (arg === "--module") {
      if (!argv[index + 1]) throw new Error("--module requires a path");
      options.modulePath = path.resolve(argv[index + 1]); index += 1;
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
    "Usage: node dna/conformance/screen/run-palette-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs screen-palette-query fixtures against a palette model (default: screen-palette-model.mjs).",
  ].join("\n");
}

function buildDispatch(model) {
  return {
    paletteRgb: (index) => model.paletteRgb(index),
    paletteSize: () => model.PALETTE_SIZE,
  };
}

function valuesEqual(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && actual.every((value, i) => value === expected[i]);
  }
  return actual === expected;
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
    for (const fixture of Array.isArray(parsed) ? parsed : [parsed]) fixtures.push(fixture);
  }
  return fixtures;
}

export async function runPaletteFixtures(argv = process.argv.slice(2)) {
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

  for (const fixture of fixtures) {
    if (fixture?.input?.kind !== "screen-palette-query") continue;
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
      if (!valuesEqual(actual, expected.value)) {
        failures.push(`${testCase.name}: ${testCase.query}(${(testCase.args ?? []).join(", ")}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected.value)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Palette fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Palette fixtures: ${caseCount} case(s) passed (screen-palette-model via run-palette-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPaletteFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
