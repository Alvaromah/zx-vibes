#!/usr/bin/env node
// Runs keyboard input-contract conformance fixtures (S5, R-W8-05) against the
// keyboard model (dna/conformance/keyboard/keyboard-model.mjs, the regeneration
// target for dna/product/keyboard-input.md). Three fixture kinds:
//   - "keyboard-matrix"   : pressed Spectrum keys + a port HIGH byte -> the IN (0xFE)
//     read byte (active-low, half-row select, ANDed across selected rows).
//   - "keyboard-browsermap": a browser event.key -> the Spectrum key(s) and their
//     matrix positions (the host input policy + combos).
//   - "keyboard-latch"    : a down/up/scan event sequence -> the pressed set at each
//     50 Hz scan (the quick-tap-stays-visible-one-scan latch).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultModule = path.join(thisDir, "keyboard-model.mjs");

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
    "Usage: node dna/conformance/keyboard/run-keyboard-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs keyboard-matrix / keyboard-browsermap / keyboard-latch fixtures against the keyboard model.",
  ].join("\n");
}

function parseByte(value, label) {
  if (typeof value === "number") return value & 0xff;
  if (typeof value === "string" && /^(0x)?[0-9a-fA-F]+$/.test(value)) return Number.parseInt(value.replace(/^0x/i, ""), 16) & 0xff;
  throw new Error(`${label}: not a numeric/hex byte: ${JSON.stringify(value)}`);
}

function runMatrixCase(model, testCase, expected, failures) {
  const actual = model.matrixByte(testCase.pressed ?? [], parseByte(testCase.portHigh, `${testCase.name}.portHigh`), { ear: testCase.ear ?? 1 });
  const want = parseByte(expected.byte, `${testCase.name}.expected.byte`);
  if (actual !== want) {
    failures.push(`${testCase.name}: IN(0xFE) = 0x${actual.toString(16).toUpperCase().padStart(2, "0")}, expected 0x${want.toString(16).toUpperCase().padStart(2, "0")}`);
  }
}

function runBrowserMapCase(model, testCase, expected, failures) {
  const keys = model.browserKeyToSpectrum(testCase.key);
  const wantKeys = expected.keys ?? [];
  if (JSON.stringify(keys) !== JSON.stringify(wantKeys)) {
    failures.push(`${testCase.name}: browserKeyToSpectrum(${JSON.stringify(testCase.key)}) = ${JSON.stringify(keys)}, expected ${JSON.stringify(wantKeys)}`);
    return;
  }
  const positions = keys.map((k) => model.KEY_MATRIX[k]);
  const wantPositions = expected.positions ?? [];
  if (JSON.stringify(positions) !== JSON.stringify(wantPositions)) {
    failures.push(`${testCase.name}: matrix positions = ${JSON.stringify(positions)}, expected ${JSON.stringify(wantPositions)}`);
  }
}

function runLatchCase(model, testCase, expected, failures) {
  const kb = model.createKeyboard();
  const expectedScans = expected.scans ?? [];
  let scanIndex = 0;
  for (const event of testCase.events ?? []) {
    if (event.op === "down") kb.keyDown(event.key);
    else if (event.op === "up") kb.keyUp(event.key);
    else if (event.op === "scan") {
      const pressed = [...kb.scan()].sort();
      const want = [...(expectedScans[scanIndex] ?? [])].sort();
      if (JSON.stringify(pressed) !== JSON.stringify(want)) {
        failures.push(`${testCase.name}: scan ${scanIndex} = [${pressed.join(",")}], expected [${want.join(",")}]`);
      }
      scanIndex += 1;
    }
  }
}

const DISPATCH = {
  "keyboard-matrix": runMatrixCase,
  "keyboard-browsermap": runBrowserMapCase,
  "keyboard-latch": runLatchCase,
};

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

export async function runKeyboardFixtures(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return { exitCode: 0 };
  }

  const model = await import(pathToFileURL(options.modulePath).href);
  const fixtures = await loadFixtures(options.fixtures);
  const failures = [];
  let caseCount = 0;

  for (const fixture of fixtures) {
    const runner = DISPATCH[fixture?.input?.kind];
    if (!runner) continue;
    const expectedByName = new Map((fixture.expected?.cases ?? []).map((item) => [item.name, item]));
    for (const testCase of fixture.input.cases ?? []) {
      caseCount += 1;
      const expected = expectedByName.get(testCase.name) ?? {};
      try {
        runner(model, testCase, expected, failures);
      } catch (error) {
        failures.push(`${testCase.name}: threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Keyboard fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Keyboard fixtures: ${caseCount} case(s) passed (keyboard model via run-keyboard-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKeyboardFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
