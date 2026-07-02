#!/usr/bin/env node
// Runs 48K screen conformance fixtures against a screen model module (the regenerated
// @zx-vibes/ula). Two fixture kinds, both scalar-valued:
//   - "screen-address-query" — the memory map + display-file address decode
//     (SCREEN-ADDR-001, W10.1).
//   - "screen-decode-query"  — the attribute byte -> palette-index + FLASH decode
//     (SCREEN-ATTR-DECODE-001, W10.2).
// This is what flips those rows to `covered`: it executes a committed implementation,
// not a scratchpad artifact.
//
// Model module contract (the regeneration target, dna/domain/memory-map.md):
//   export const DISPLAY_FILE_BASE, DISPLAY_FILE_END, DISPLAY_FILE_SIZE   (integers)
//   export const ATTR_FILE_BASE,    ATTR_FILE_END,    ATTR_FILE_SIZE      (integers)
//   export const FLASH_FRAMES                                             (integer)
//   export function displayByteAddress(x, y) -> int   (x:0..255, y:0..191)
//   export function displayLineAddress(y)    -> int
//   export function attributeAddress(x, y)   -> int
//   export function attributeInk/Paper/Bright/Flash(byte) -> int
//   export function inkColorIndex(byte) -> int    (0..15)
//   export function paperColorIndex(byte) -> int  (0..15)
//   export function flashPhase(frame) -> int      (0..1)
//   export function pixelColorIndex(byte, pixelOn, phase) -> int  (0..15)
//
// Fixture shape (mirrors the timing fixtures): input.cases name a `query` and
// optional `args`; expected.cases give each case's value, matched by name:
//   input:    { kind: "screen-address-query" | "screen-decode-query",
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number> } ] }
// address queries: displayFileBase | displayFileEnd | displayFileSize | attrFileBase |
// attrFileEnd | attrFileSize | flashFrames (no args) | displayByteAddress |
// attributeAddress (x, y) | displayLineAddress (y).
// decode queries: attributeInk | attributePaper | attributeBright | attributeFlash |
// inkColorIndex | paperColorIndex (byte) | flashPhase (frame) | pixelColorIndex
// (byte, pixelOn, phase).
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
    "Usage: node dna/conformance/screen/run-screen-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs screen-address-query fixtures against a screen-address model (default: @zx-vibes/ula).",
  ].join("\n");
}

function buildDispatch(model) {
  return {
    displayFileBase: () => model.DISPLAY_FILE_BASE,
    displayFileEnd: () => model.DISPLAY_FILE_END,
    displayFileSize: () => model.DISPLAY_FILE_SIZE,
    attrFileBase: () => model.ATTR_FILE_BASE,
    attrFileEnd: () => model.ATTR_FILE_END,
    attrFileSize: () => model.ATTR_FILE_SIZE,
    flashFrames: () => model.FLASH_FRAMES,
    displayByteAddress: (x, y) => model.displayByteAddress(x, y),
    displayLineAddress: (y) => model.displayLineAddress(y),
    attributeAddress: (x, y) => model.attributeAddress(x, y),
    // decode queries (SCREEN-ATTR-DECODE-001, W10.2)
    attributeInk: (byte) => model.attributeInk(byte),
    attributePaper: (byte) => model.attributePaper(byte),
    attributeBright: (byte) => model.attributeBright(byte),
    attributeFlash: (byte) => model.attributeFlash(byte),
    inkColorIndex: (byte) => model.inkColorIndex(byte),
    paperColorIndex: (byte) => model.paperColorIndex(byte),
    flashPhase: (frame) => model.flashPhase(frame),
    pixelColorIndex: (byte, pixelOn, phase) => model.pixelColorIndex(byte, pixelOn, phase),
  };
}

const SCREEN_QUERY_KINDS = new Set(["screen-address-query", "screen-decode-query"]);

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

export async function runScreenFixtures(argv = process.argv.slice(2)) {
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
    if (!SCREEN_QUERY_KINDS.has(fixture?.input?.kind)) continue;
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
        failures.push(`${testCase.name}: ${testCase.query}(${(testCase.args ?? []).join(", ")}) = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected.value)}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`Screen fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Screen fixtures: ${caseCount} case(s) passed (@zx-vibes/ula via run-screen-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runScreenFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
