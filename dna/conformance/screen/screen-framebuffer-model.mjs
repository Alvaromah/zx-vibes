#!/usr/bin/env node
// Reference gallery framebuffer model (SCREEN-FRAMEBUFFER-001, decision:ADR-0022),
// authored from dna/product/screen-render.md "Framebuffer assembly (256 x 192)". It
// composes the SHIPPED emulator decode (@zx-vibes/ula: displayByteAddress,
// attributeAddress, pixelColorIndex, flashPhase) with the gallery palette
// (dna/product/palette.yaml) to assemble a captured 6912-byte screen image into the
// visible 256x192 canvas. It adds the one render step the per-decode rows do not: the
// bitmap-bit extraction (bit 7-(x&7), MSB leftmost). It is the default --module of
// run-framebuffer-fixtures.mjs, so this is what flips SCREEN-FRAMEBUFFER-001 to
// `covered`: a real composition of the regenerated decode + the normative palette, not
// a scratchpad artifact.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPLAY_FILE_BASE,
  displayByteAddress,
  attributeAddress,
  pixelColorIndex,
  flashPhase,
} from "../../../packages/ula/src/index.mjs";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPaletteFile = path.resolve(thisDir, "..", "..", "product", "palette.yaml");

// palette.yaml is the single source (shared with the border, raster-border.md). The
// table path can be overridden with ZX_PALETTE_FILE so a self-test can feed a
// deliberately-broken palette (mirrors screen-palette-model.mjs).
export const PALETTE_FILE = process.env.ZX_PALETTE_FILE
  ? path.resolve(process.env.ZX_PALETTE_FILE)
  : defaultPaletteFile;

function loadPalette(file) {
  const text = readFileSync(file, "utf8");
  const table = new Map();
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.replace(/#.*$/, "");
    const match = stripped.match(
      /index:\s*(\d+)\b[\s\S]*?rgb:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/,
    );
    if (!match) continue;
    table.set(Number(match[1]), [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return table;
}

const PALETTE = loadPalette(PALETTE_FILE);

// --- Frame geometry (screen-render.md model contract) ---
export const FRAME_WIDTH = 256;
export const FRAME_HEIGHT = 192;
export const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT; // 49152
export const SCREEN_IMAGE_SIZE = 6912; // 6144 display + 768 attribute (0x4000..0x5AFF)

// RGB triple [r, g, b] of a palette index 0..15 (SCREEN-PALETTE-001).
export function paletteRgb(index) {
  const rgb = PALETTE.get(index & 0x0f);
  if (!rgb) throw new Error(`palette.yaml has no entry for index ${index}`);
  return rgb;
}

// Palette index 0..15 of pixel (x, y) at frame `frame` (SCREEN-FRAMEBUFFER-001).
// screen[offset], offset 0 = address 0x4000: display file 0..6143, attribute 6144..6911.
export function framePixelIndex(screen, x, y, frame) {
  const displayByte = screen[displayByteAddress(x, y) - DISPLAY_FILE_BASE];
  const pixelOn = (displayByte >> (7 - (x & 7))) & 1; // bit 7 is the leftmost pixel
  const attributeByte = screen[attributeAddress(x, y) - DISPLAY_FILE_BASE];
  return pixelColorIndex(attributeByte, pixelOn, flashPhase(frame));
}

// RGB triple of pixel (x, y): the index through the gallery palette.
export function framePixelRgb(screen, x, y, frame) {
  return paletteRgb(framePixelIndex(screen, x, y, frame));
}

// The whole canvas as a length-49152 palette-index array, row-major (y then x).
export function renderIndexFrame(screen, frame) {
  const frameBuffer = new Array(FRAME_SIZE);
  let cursor = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      frameBuffer[cursor] = framePixelIndex(screen, x, y, frame);
      cursor += 1;
    }
  }
  return frameBuffer;
}

// The whole canvas as a flat length-147456 r,g,b array, same row-major order.
export function renderRgbFrame(screen, frame) {
  const frameBuffer = new Array(FRAME_SIZE * 3);
  let cursor = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const [r, g, b] = framePixelRgb(screen, x, y, frame);
      frameBuffer[cursor] = r;
      frameBuffer[cursor + 1] = g;
      frameBuffer[cursor + 2] = b;
      cursor += 3;
    }
  }
  return frameBuffer;
}
