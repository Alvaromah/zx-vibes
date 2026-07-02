#!/usr/bin/env node
// Runs the gallery screen-framebuffer conformance fixture (`kind:
// "screen-framebuffer-query"`, SCREEN-FRAMEBUFFER-001, decision:ADR-0022) against a
// framebuffer model. This flips SCREEN-FRAMEBUFFER-001 to `covered`: it executes a
// committed model that composes the @zx-vibes/ula decode with the normative
// dna/product/palette.yaml, not a scratchpad artifact.
//
// Unlike the address/palette runners, the framebuffer takes a whole captured screen.
// The fixture describes the 6912-byte image sparsely (`input.screen.writes`, offsets
// relative to 0x4000); THIS runner builds the image and passes it to the model, so the
// model cannot smuggle its own screen.
//
// Model module (default --module): dna/conformance/screen/screen-framebuffer-model.mjs.
//   export const FRAME_WIDTH, FRAME_HEIGHT, FRAME_SIZE, SCREEN_IMAGE_SIZE  (integers)
//   export function framePixelIndex(screen, x, y, frame) -> int 0..15
//   export function framePixelRgb(screen, x, y, frame)   -> [r, g, b]
//   export function renderIndexFrame(screen, frame) -> array (length FRAME_SIZE)
//   export function renderRgbFrame(screen, frame)   -> array (length FRAME_SIZE*3)
//
// Fixture shape:
//   input:    { kind: "screen-framebuffer-query",
//               screen: { fill?: 0, writes: [ [offset, value], ... ] },   // offset 0..6911
//               cases: [ { name, query, args? } ] }
//   expected: { cases: [ { name, value: <number | [r,g,b]> } ] }
// queries: frameWidth | frameHeight | frameSize | screenImageSize | frameIndexLength |
// frameRgbLength (no args) | framePixelIndex (x, y, frame) | framePixelRgb (x, y, frame).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultModule = path.join(thisDir, "screen-framebuffer-model.mjs");

const SCREEN_IMAGE_SIZE = 6912;

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
    "Usage: node dna/conformance/screen/run-framebuffer-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs screen-framebuffer-query fixtures against a framebuffer model (default: screen-framebuffer-model.mjs).",
  ].join("\n");
}

function buildScreen(spec) {
  const fill = spec?.fill ?? 0;
  const screen = new Uint8Array(SCREEN_IMAGE_SIZE).fill(fill & 0xff);
  for (const write of spec?.writes ?? []) {
    const [offset, value] = write;
    if (!Number.isInteger(offset) || offset < 0 || offset >= SCREEN_IMAGE_SIZE) {
      throw new Error(`screen write offset out of range: ${offset}`);
    }
    screen[offset] = value & 0xff;
  }
  return screen;
}

function buildDispatch(model, screen) {
  return {
    frameWidth: () => model.FRAME_WIDTH,
    frameHeight: () => model.FRAME_HEIGHT,
    frameSize: () => model.FRAME_SIZE,
    screenImageSize: () => model.SCREEN_IMAGE_SIZE,
    frameIndexLength: () => model.renderIndexFrame(screen, 0).length,
    frameRgbLength: () => model.renderRgbFrame(screen, 0).length,
    framePixelIndex: (x, y, frame) => model.framePixelIndex(screen, x, y, frame),
    framePixelRgb: (x, y, frame) => model.framePixelRgb(screen, x, y, frame),
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

export async function runFramebufferFixtures(argv = process.argv.slice(2)) {
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
    if (fixture?.input?.kind !== "screen-framebuffer-query") continue;
    const screen = buildScreen(fixture.input.screen);
    const dispatch = buildDispatch(model, screen);
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
    console.error(`Framebuffer fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Framebuffer fixtures: ${caseCount} case(s) passed (screen-framebuffer-model via run-framebuffer-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFramebufferFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
