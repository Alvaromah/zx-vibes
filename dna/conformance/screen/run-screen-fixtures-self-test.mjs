#!/usr/bin/env node
// Self-test for the 48K screen fixture runner (address decode + attribute/colour decode).
//
// Decisive checks:
//   1. The REAL fixtures (screen-address.json + attr-decode.json) pass against an
//      INDEPENDENT reference authored here from dna/domain/memory-map.md (re-derived
//      forms, NOT the shipped @zx-vibes/ula bit-mask source).
//   2. A LINEAR display decoder (0x4000 + y*32 + col) fails (the non-linear "thirds").
//   3. A decoder that SWAPS the pixel-row and character-row bit fields fails.
//   4. A decoder that mislocates the attribute file fails.
//   5. A decoder that IGNORES BRIGHT (attributeBright always 0) fails the colour fixture.
//   6. A decoder that never applies the FLASH ink/paper swap fails.
//   7. A decoder that swaps the INK and PAPER bit fields fails.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-screen-fixtures.mjs");
const realFixtures = thisDir;

// Independent reference: same constants, formulas re-derived (a third/charRow/pixelRow
// decomposition for the address; explicit field extraction for the colour decode)
// rather than the bit-mask / single-expression forms the package ships.
const REFERENCE_MODEL = `
export const DISPLAY_FILE_BASE = 0x4000, DISPLAY_FILE_END = 0x57FF, DISPLAY_FILE_SIZE = 6144;
export const ATTR_FILE_BASE = 0x5800, ATTR_FILE_END = 0x5AFF, ATTR_FILE_SIZE = 768;
export const FLASH_FRAMES = 16;
export function displayByteAddress(x, y) {
  const third = (y >> 6) & 0x03;
  const charRow = (y >> 3) & 0x07;
  const pixelRow = y & 0x07;
  const col = x >> 3;
  return DISPLAY_FILE_BASE + third * 0x800 + pixelRow * 0x100 + charRow * 0x20 + col;
}
export function displayLineAddress(y) { return displayByteAddress(0, y); }
export function attributeAddress(x, y) { return ATTR_FILE_BASE + (y >> 3) * 32 + (x >> 3); }
export function attributeInk(b) { return b % 8; }
export function attributePaper(b) { return Math.floor(b / 8) % 8; }
export function attributeBright(b) { return Math.floor(b / 64) % 2; }
export function attributeFlash(b) { return Math.floor(b / 128) % 2; }
export function inkColorIndex(b) { return attributeInk(b) + attributeBright(b) * 8; }
export function paperColorIndex(b) { return attributePaper(b) + attributeBright(b) * 8; }
export function flashPhase(f) { return Math.floor(f / FLASH_FRAMES) % 2; }
export function pixelColorIndex(b, on, ph) {
  let ink = attributeInk(b);
  let paper = attributePaper(b);
  if (attributeFlash(b) === 1 && ph % 2 === 1) { const t = ink; ink = paper; paper = t; }
  const base = on ? ink : paper;
  return base + attributeBright(b) * 8;
}
`;

// Broken: a linear display file (ignores the thirds interleave) -> a smeared screen.
const LINEAR_MODEL = REFERENCE_MODEL.replace(
  "return DISPLAY_FILE_BASE + third * 0x800 + pixelRow * 0x100 + charRow * 0x20 + col;",
  "return DISPLAY_FILE_BASE + y * 32 + col;",
);

// Broken: pixel-row and character-row bit fields swapped (wrong interleave order).
const SWAPPED_MODEL = REFERENCE_MODEL.replace(
  "return DISPLAY_FILE_BASE + third * 0x800 + pixelRow * 0x100 + charRow * 0x20 + col;",
  "return DISPLAY_FILE_BASE + third * 0x800 + charRow * 0x100 + pixelRow * 0x20 + col;",
);

// Broken: attribute file mislocated (off-by-one base).
const WRONG_ATTR_MODEL = REFERENCE_MODEL.replace(
  "return ATTR_FILE_BASE + (y >> 3) * 32 + (x >> 3);",
  "return ATTR_FILE_BASE + 1 + (y >> 3) * 32 + (x >> 3);",
);

// Broken: BRIGHT ignored -> bright cells render at the non-bright level (index < 8).
const NO_BRIGHT_MODEL = REFERENCE_MODEL.replace(
  "export function attributeBright(b) { return Math.floor(b / 64) % 2; }",
  "export function attributeBright(b) { return 0; }",
);

// Broken: FLASH swap never applied -> flashing cells never invert.
const NO_FLASH_SWAP_MODEL = REFERENCE_MODEL.replace(
  "if (attributeFlash(b) === 1 && ph % 2 === 1) { const t = ink; ink = paper; paper = t; }",
  "",
);

// Broken: INK and PAPER bit fields swapped.
const INK_PAPER_SWAP_MODEL = REFERENCE_MODEL.replace(
  "export function attributeInk(b) { return b % 8; }",
  "export function attributeInk(b) { return Math.floor(b / 8) % 8; }",
).replace(
  "export function attributePaper(b) { return Math.floor(b / 8) % 8; }",
  "export function attributePaper(b) { return b % 8; }",
);

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screen-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const linear = await write("linear.mjs", LINEAR_MODEL);
    const swapped = await write("swapped.mjs", SWAPPED_MODEL);
    const wrongAttr = await write("wrong-attr.mjs", WRONG_ATTR_MODEL);
    const noBright = await write("no-bright.mjs", NO_BRIGHT_MODEL);
    const noFlash = await write("no-flash-swap.mjs", NO_FLASH_SWAP_MODEL);
    const inkPaper = await write("ink-paper-swap.mjs", INK_PAPER_SWAP_MODEL);

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real screen fixtures to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [linear, "linear (non-thirds) display decoder"],
      [swapped, "swapped pixel-row/character-row decoder"],
      [wrongAttr, "mislocated attribute file"],
      [noBright, "BRIGHT-ignoring colour decoder"],
      [noFlash, "FLASH-swap-ignoring colour decoder"],
      [inkPaper, "INK/PAPER-swapped colour decoder"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the screen fixtures`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Screen fixture self-test passed: the real SCREEN-ADDR + SCREEN-ATTR-DECODE fixtures validate against an independent reference; a linear/swapped/mislocated address decoder and a BRIGHT-ignoring, FLASH-swap-ignoring, or INK/PAPER-swapped colour decoder are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
