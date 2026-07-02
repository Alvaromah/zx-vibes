#!/usr/bin/env node
// Self-test for the gallery screen-palette fixture runner (SCREEN-PALETTE-001).
//
// Decisive checks:
//   1. The REAL fixture passes against the real model reading the real palette.yaml.
//   2. A palette using the WRONG non-bright level (215 instead of 205) fails — which
//      would also desync the W8 raster border fixtures.
//   3. A palette that DROPS BRIGHT (bright level == non-bright) fails.
//   4. A model that IGNORES BRIGHT (maps index & 7) fails — the fixture pins all 16.
// Checks 2-3 feed a deliberately-broken palette.yaml via ZX_PALETTE_FILE, proving the
// model genuinely reads the table and the fixture pins the level split.
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-palette-fixtures.mjs");
const realPalette = path.resolve(thisDir, "..", "..", "product", "palette.yaml");
const realFixtures = thisDir;

// A model that hardcodes a BRIGHT-ignoring palette (index & 7, non-bright level).
const NO_BRIGHT_MODULE = `
export const PALETTE_SIZE = 16;
export function paletteRgb(index) {
  const c = index & 7;
  return [(c & 2) ? 205 : 0, (c & 4) ? 205 : 0, (c & 1) ? 205 : 0];
}
`;

function run(args, env) {
  return spawnSync(process.execPath, [runnerPath, ...args], {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
}
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "palette-self-test-"));
  try {
    const realText = await readFile(realPalette, "utf8");

    // Broken palette files (transform the real table).
    const wrongLevel = path.join(dir, "palette-215.yaml");
    await writeFile(wrongLevel, realText.replaceAll("205", "215"), "utf8");

    const noBright = path.join(dir, "palette-no-bright.yaml");
    await writeFile(noBright, realText.replaceAll("255", "205"), "utf8");

    const noBrightModule = path.join(dir, "no-bright-model.mjs");
    await writeFile(noBrightModule, NO_BRIGHT_MODULE, "utf8");

    // 1. Real model + real palette + real fixtures -> pass.
    const real = run(["--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real palette fixture to pass\n${real.stdout}\n${real.stderr}`);

    // 2. Wrong non-bright level -> fail.
    const wrong = run(["--fixtures", realFixtures, "--quiet"], { ZX_PALETTE_FILE: wrongLevel });
    assert(wrong.status !== 0, "expected a palette at the wrong non-bright level (215) to fail");

    // 3. BRIGHT dropped (bright == non-bright) -> fail.
    const dropped = run(["--fixtures", realFixtures, "--quiet"], { ZX_PALETTE_FILE: noBright });
    assert(dropped.status !== 0, "expected a palette that drops BRIGHT to fail");

    // 4. Model that ignores BRIGHT -> fail.
    const ignored = run(["--module", noBrightModule, "--fixtures", realFixtures, "--quiet"]);
    assert(ignored.status !== 0, "expected a BRIGHT-ignoring palette model to fail");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Palette fixture self-test passed: the real SCREEN-PALETTE fixture validates against palette.yaml; a wrong non-bright level (215), a BRIGHT-dropping palette, and a BRIGHT-ignoring model are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
