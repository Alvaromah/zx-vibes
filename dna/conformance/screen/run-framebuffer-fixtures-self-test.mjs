#!/usr/bin/env node
// Self-test for the gallery screen-framebuffer fixture runner (SCREEN-FRAMEBUFFER-001).
//
// Decisive checks:
//   1. The REAL fixture (screen-framebuffer.json) passes against an INDEPENDENT
//      reference authored here from dna/product/screen-render.md "Framebuffer assembly"
//      (re-derived: a third/charRow/pixelRow decomposition for the address, explicit
//      attribute-field extraction, a re-parsed palette.yaml) — NOT the shipped model
//      and NOT @zx-vibes/ula.
//   2. A LINEAR display decoder (0x4000 + y*32 + col) fails — the thirds interleave
//      (a smeared screen): caught by the interleave-sensitive sample at y=1.
//   3. An LSB-FIRST bit extractor (bit x&7 instead of 7-(x&7)) fails — each byte's 8
//      pixels mirrored: caught by the leftmost/rightmost-bit samples.
//   4. A SINGLE-ATTRIBUTE renderer (every pixel coloured from the first attribute cell)
//      fails — a one-colour screen: caught by the red / green cells.
//   5. A FLASH-IGNORING renderer (phase fixed at 0) fails — flashing cells never invert:
//      caught by the frame-0 vs frame-16 samples of the 0xC7 cell.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.join(thisDir, "run-framebuffer-fixtures.mjs");
const realFixtures = thisDir;
const realPalette = path.resolve(thisDir, "..", "..", "product", "palette.yaml");

// Independent reference: same spec, re-derived forms (decomposed address arithmetic,
// explicit attribute fields, a re-parsed palette) rather than the bit-mask /
// @zx-vibes/ula-importing forms the shipped model uses.
const REFERENCE_MODEL = `
import { readFileSync } from "node:fs";
const PALETTE_FILE = ${JSON.stringify(realPalette)};
function loadPalette(file) {
  const text = readFileSync(file, "utf8");
  const table = new Map();
  for (const line of text.split(/\\r?\\n/)) {
    const stripped = line.replace(/#.*$/, "");
    const m = stripped.match(/index:\\s*(\\d+)\\b[\\s\\S]*?rgb:\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]/);
    if (!m) continue;
    table.set(Number(m[1]), [Number(m[2]), Number(m[3]), Number(m[4])]);
  }
  return table;
}
const PALETTE = loadPalette(PALETTE_FILE);
export const FRAME_WIDTH = 256, FRAME_HEIGHT = 192, FRAME_SIZE = 49152, SCREEN_IMAGE_SIZE = 6912;
function displayOffset(x, y) {
  const third = Math.floor(y / 64);
  const charRow = Math.floor(y / 8) % 8;
  const pixelRow = y % 8;
  const col = Math.floor(x / 8);
  return third * 0x800 + pixelRow * 0x100 + charRow * 0x20 + col;
}
function attrOffset(x, y) { return 6144 + Math.floor(y / 8) * 32 + Math.floor(x / 8); }
function pixelBit(b, x) { return (b >> (7 - (x % 8))) & 1; }
function decodeIndex(attr, on, phase) {
  let ink = attr % 8;
  let paper = Math.floor(attr / 8) % 8;
  const bright = Math.floor(attr / 64) % 2;
  const flash = Math.floor(attr / 128) % 2;
  if (flash === 1 && phase % 2 === 1) { const t = ink; ink = paper; paper = t; }
  const base = on ? ink : paper;
  return base + bright * 8;
}
function flashPhase(frame) { return Math.floor(frame / 16) % 2; }
export function framePixelIndex(screen, x, y, frame) {
  const on = pixelBit(screen[displayOffset(x, y)], x);
  return decodeIndex(screen[attrOffset(x, y)], on, flashPhase(frame));
}
export function framePixelRgb(screen, x, y, frame) {
  const rgb = PALETTE.get(framePixelIndex(screen, x, y, frame) & 0x0f);
  if (!rgb) throw new Error("no palette entry");
  return rgb;
}
export function renderIndexFrame(screen, frame) {
  const out = new Array(FRAME_SIZE); let i = 0;
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) out[i++] = framePixelIndex(screen, x, y, frame);
  return out;
}
export function renderRgbFrame(screen, frame) {
  const out = new Array(FRAME_SIZE * 3); let i = 0;
  for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) { const [r, g, b] = framePixelRgb(screen, x, y, frame); out[i++] = r; out[i++] = g; out[i++] = b; }
  return out;
}
`;

// Broken: a linear display file (ignores the thirds interleave) -> a smeared screen.
const LINEAR_MODEL = REFERENCE_MODEL.replace(
  "return third * 0x800 + pixelRow * 0x100 + charRow * 0x20 + col;",
  "return y * 32 + col;",
);

// Broken: LSB-first bit extraction -> each byte's 8 pixels mirrored.
const LSB_FIRST_MODEL = REFERENCE_MODEL.replace(
  "function pixelBit(b, x) { return (b >> (7 - (x % 8))) & 1; }",
  "function pixelBit(b, x) { return (b >> (x % 8)) & 1; }",
);

// Broken: every pixel coloured from the first attribute cell -> a one-colour screen.
const SINGLE_ATTR_MODEL = REFERENCE_MODEL.replace(
  "function attrOffset(x, y) { return 6144 + Math.floor(y / 8) * 32 + Math.floor(x / 8); }",
  "function attrOffset(x, y) { return 6144; }",
);

// Broken: FLASH phase fixed at 0 -> flashing cells never invert.
const NO_FLASH_MODEL = REFERENCE_MODEL.replace(
  "function flashPhase(frame) { return Math.floor(frame / 16) % 2; }",
  "function flashPhase(frame) { return 0; }",
);

function run(args) { return spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function main() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "framebuffer-self-test-"));
  try {
    const write = async (name, source) => {
      const file = path.join(dir, name);
      await writeFile(file, source, "utf8");
      return file;
    };
    const ref = await write("reference.mjs", REFERENCE_MODEL);
    const linear = await write("linear.mjs", LINEAR_MODEL);
    const lsbFirst = await write("lsb-first.mjs", LSB_FIRST_MODEL);
    const singleAttr = await write("single-attr.mjs", SINGLE_ATTR_MODEL);
    const noFlash = await write("no-flash.mjs", NO_FLASH_MODEL);

    // Guard: the broken variants must actually differ from the reference source
    // (a renamed anchor would silently no-op the replace and weaken the test).
    for (const [src, label] of [
      [LINEAR_MODEL, "linear"],
      [LSB_FIRST_MODEL, "lsb-first"],
      [SINGLE_ATTR_MODEL, "single-attr"],
      [NO_FLASH_MODEL, "no-flash"],
    ]) {
      assert(src !== REFERENCE_MODEL, `${label} variant did not change the reference (stale anchor)`);
    }

    const real = run(["--module", ref, "--fixtures", realFixtures, "--quiet"]);
    assert(real.status === 0, `expected the real framebuffer fixture to pass against the independent reference\n${real.stdout}\n${real.stderr}`);

    const broken = [
      [linear, "linear (non-thirds) display decoder"],
      [lsbFirst, "LSB-first bit extractor"],
      [singleAttr, "single-attribute renderer"],
      [noFlash, "FLASH-ignoring renderer"],
    ];
    for (const [module, label] of broken) {
      const result = run(["--module", module, "--fixtures", realFixtures, "--quiet"]);
      assert(result.status !== 0, `expected the ${label} to fail the framebuffer fixture`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(
    "Framebuffer fixture self-test passed: the real SCREEN-FRAMEBUFFER fixture validates against an independent reference; a linear (non-thirds) decoder, an LSB-first bit extractor, a single-attribute renderer, and a FLASH-ignoring renderer are all rejected.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
