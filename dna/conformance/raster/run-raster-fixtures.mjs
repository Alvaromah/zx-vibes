#!/usr/bin/env node
// Runs gallery raster (visible geometry + border-pixel) conformance fixtures (S4,
// R-W8-04) against the raster model (dna/product/raster-border.md). Two kinds:
//   - "raster-geometry": canvas dimensions, border-pixel classification, and the
//     canvas-pixel -> frame T-state mapping at sample points.
//   - "raster-save-pp": a SAVE-tape border event stream (border toggling red/cyan)
//     rendered to the canvas; the distinct colours of the sampled border pixels must
//     contain both red (205,0,0) and cyan (0,205,205) — the C1 acceptance the core
//     gate missed (a renderer collapsing the frame to one colour fails).
//
// Model module (default --module): dna/conformance/raster/raster-border-model.mjs.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultModule = path.join(thisDir, "raster-border-model.mjs");

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
    "Usage: node dna/conformance/raster/run-raster-fixtures.mjs [--module <path>] [--fixtures <path>] [--quiet]",
    "",
    "Runs raster-geometry / raster-save-pp fixtures against the raster border model.",
  ].join("\n");
}

function runGeometryCase(model, fixture, failures) {
  const c = fixture.input.canvas ?? {};
  const checks = [
    ["width", model.CANVAS_WIDTH], ["height", model.CANVAS_HEIGHT],
    ["borderLeft", model.BORDER_LEFT], ["borderTop", model.BORDER_TOP],
    ["activeWidth", model.DISPLAY_COLS], ["activeHeight", model.DISPLAY_LINES],
  ];
  for (const [key, actual] of checks) {
    if (c[key] !== undefined && actual !== c[key]) failures.push(`${fixture.id}: canvas.${key} = ${actual}, expected ${c[key]}`);
  }
  for (const p of fixture.input.borderPixels ?? []) {
    const actual = Boolean(model.isBorderPixel(p.x, p.y));
    if (actual !== Boolean(p.border)) failures.push(`${fixture.id}: isBorderPixel(${p.x},${p.y}) = ${actual}, expected ${Boolean(p.border)}`);
  }
  for (const p of fixture.input.tStates ?? []) {
    const actual = model.pixelTState(p.x, p.y);
    if (actual !== p.t) failures.push(`${fixture.id}: pixelTState(${p.x},${p.y}) = ${actual}, expected ${p.t}`);
  }
}

function buildToggleEvents(toggle) {
  const events = [];
  let value = toggle.from;
  for (let t = 0; t < toggle.frameT; t += toggle.periodT) {
    events.push({ tFrame: t, value });
    value = value === toggle.from ? toggle.to : toggle.from;
  }
  return events;
}

function rgbKey(rgb) { return `${rgb[0]},${rgb[1]},${rgb[2]}`; }

function runSavePpCase(model, fixture, failures) {
  const input = fixture.input;
  const events = input.events ?? buildToggleEvents(input.toggle);
  const stride = input.sampleStride ?? 8;
  const initial = input.initialBorder ?? 0;
  const colors = new Set();
  for (let y = 0; y < model.CANVAS_HEIGHT; y += stride) {
    for (let x = 0; x < model.CANVAS_WIDTH; x += stride) {
      if (!model.isBorderPixel(x, y)) continue;
      colors.add(rgbKey(model.borderPixelRgb(x, y, events, initial)));
    }
  }
  const expected = new Set((fixture.expected?.colors ?? []).map(rgbKey));
  for (const want of expected) {
    if (!colors.has(want)) failures.push(`${fixture.id}: sampled border pixels do not contain colour [${want}] (SAVE "pp" tape band missing — collapsed border?)`);
  }
  if (input.expectExactly) {
    for (const got of colors) {
      if (!expected.has(got)) failures.push(`${fixture.id}: sampled border pixels contain unexpected colour [${got}]`);
    }
  }
}

const DISPATCH = {
  "raster-geometry": runGeometryCase,
  "raster-save-pp": runSavePpCase,
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

export async function runRasterFixtures(argv = process.argv.slice(2)) {
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
    caseCount += 1;
    try {
      runner(model, fixture, failures);
    } catch (error) {
      failures.push(`${fixture.id}: threw: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`Raster fixtures: ${failures.length} failure(s)`);
    for (const failure of failures) console.error(`- ${failure}`);
    return { exitCode: 1 };
  }

  if (!options.quiet) console.log(`Raster fixtures: ${caseCount} fixture(s) passed (raster border model via run-raster-fixtures)`);
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRasterFixtures()
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
