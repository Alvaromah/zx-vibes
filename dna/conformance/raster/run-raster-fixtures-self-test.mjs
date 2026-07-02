#!/usr/bin/env node
// Self-test for the gallery raster (visible geometry + border pixel) fixture runner.
//
// Decisive checks:
//   1. Both REAL fixtures pass against an INDEPENDENT reference authored here from
//      dna/product/raster-border.md (NOT the shipped raster-border-model.mjs).
//   2. (C1) A renderer that collapses the frame's border to one colour fails the
//      SAVE "pp" fixture (the red/cyan tape bands the core gate missed).
//   3. A wrong visible geometry (different border margin) fails the geometry fixture.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-raster-fixtures.mjs");
const realFixtures = thisDir;

// Independent reference (same constants, re-derived formulae).
const REFERENCE_MODEL = `
export const DISPLAY_START_T = 14335, T_PER_LINE = 224, DISPLAY_LINES = 192, DISPLAY_COLS = 256, PIXELS_PER_TSTATE = 2;
export const BORDER_LEFT = 32, BORDER_TOP = 24;
export const CANVAS_WIDTH = 320, CANVAS_HEIGHT = 240;
export function isBorderPixel(x, y) {
  const inX = x >= BORDER_LEFT && x < BORDER_LEFT + DISPLAY_COLS;
  const inY = y >= BORDER_TOP && y < BORDER_TOP + DISPLAY_LINES;
  return !(inX && inY);
}
export function pixelTState(x, y) {
  return DISPLAY_START_T + (y - BORDER_TOP) * T_PER_LINE + Math.floor((x - BORDER_LEFT) / PIXELS_PER_TSTATE);
}
const PAL = [[0,0,0],[0,0,205],[205,0,0],[205,0,205],[0,205,0],[0,205,205],[205,205,0],[205,205,205]];
export function palette(i) { return PAL[i & 7]; }
export function borderColorAt(t, events, initial = 0) {
  let c = initial; for (const e of events ?? []) { if (e.tFrame <= t) c = e.value; else break; } return c;
}
export function borderPixelRgb(x, y, events, initial = 0) { return palette(borderColorAt(pixelTState(x, y), events, initial)); }
`;

// Broken: collapse the whole frame's border to one colour (the bug the core gate
// missed) -> SAVE "pp" shows no tape bands.
const COLLAPSE_MODEL = REFERENCE_MODEL.replace(
  "export function borderPixelRgb(x, y, events, initial = 0) { return palette(borderColorAt(pixelTState(x, y), events, initial)); }",
  "export function borderPixelRgb() { return [205, 0, 0]; }",
);

// Broken: wrong visible geometry (no top border margin) -> geometry fixture fails.
const WRONG_GEOMETRY = REFERENCE_MODEL
  .replace("BORDER_TOP = 24", "BORDER_TOP = 0")
  .replace("CANVAS_HEIGHT = 240", "CANVAS_HEIGHT = 192");

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const SMALL_GEOMETRY = {
  id: "RASTER-SELF-TEST-GEOM", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "raster-geometry", canvas: { width: 320, height: 240, borderTop: 24 }, borderPixels: [{ x: 0, y: 0, border: true }, { x: 160, y: 120, border: false }], tStates: [{ x: 32, y: 24, t: 14335 }] },
  expected: { ok: true }, normalization: { profile: "custom" },
};
const SMALL_SAVE_PP = {
  id: "RASTER-SELF-TEST-SAVE", area: "gallery", tier: "contract", provenance: "decision:ADR-0016",
  input: { kind: "raster-save-pp", toggle: { from: 2, to: 5, periodT: 218, frameT: 69888 }, initialBorder: 2, sampleStride: 8, expectExactly: true },
  expected: { colors: [[205, 0, 0], [0, 205, 205]] }, normalization: { profile: "custom" },
};

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "raster-self-test-"));
  try {
    const ref = path.join(dir, "reference.mjs");
    const collapse = path.join(dir, "collapse.mjs");
    const wrongGeom = path.join(dir, "wrong-geom.mjs");
    const fGeom = path.join(dir, "geom.json");
    const fSave = path.join(dir, "save.json");
    await writeFile(ref, REFERENCE_MODEL, "utf8");
    await writeFile(collapse, COLLAPSE_MODEL, "utf8");
    await writeFile(wrongGeom, WRONG_GEOMETRY, "utf8");
    await writeFile(fGeom, JSON.stringify(SMALL_GEOMETRY), "utf8");
    await writeFile(fSave, JSON.stringify(SMALL_SAVE_PP), "utf8");

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected real raster fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const collapseRun = run(["--module", collapse, "--fixtures", fSave, "--quiet"]);
    assert(collapseRun.status !== 0, "expected the collapse-to-one-colour renderer to fail the SAVE pp fixture");
    assert(`${collapseRun.stdout}${collapseRun.stderr}`.includes("205,0,0") || `${collapseRun.stdout}${collapseRun.stderr}`.toLowerCase().includes("band"), "expected the collapse failure to name the missing tape band");

    const wrongRun = run(["--module", wrongGeom, "--fixtures", fGeom, "--quiet"]);
    assert(wrongRun.status !== 0, "expected the wrong visible geometry to fail the geometry fixture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Raster fixture self-test passed: real geometry + SAVE-pp fixtures validate against an independent reference; a collapse-to-one-colour border (no tape bands) and a wrong visible geometry are rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
