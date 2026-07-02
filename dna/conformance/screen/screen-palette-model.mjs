#!/usr/bin/env node
// Reference screen-palette model, authored from dna/product/screen-render.md
// (SCREEN-PALETTE-001, decision:ADR-0022). It reads the normative palette table
// dna/product/palette.yaml and maps a palette INDEX 0..15 to its RGB triple. It is
// the conformance model for W10.2's gallery side: the default --module of
// run-palette-fixtures.mjs.
//
// palette.yaml is the single source (shared with the border, raster-border.md). The
// table path can be overridden with ZX_PALETTE_FILE so the self-test can feed a
// deliberately-broken palette and confirm the fixture catches it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const defaultPaletteFile = path.resolve(thisDir, "..", "..", "product", "palette.yaml");

export const PALETTE_FILE = process.env.ZX_PALETTE_FILE
  ? path.resolve(process.env.ZX_PALETTE_FILE)
  : defaultPaletteFile;

// Minimal, dependency-free read of the `colors:` entries. Each colour is one line
// carrying `index: <n>` and `rgb: [<r>, <g>, <b>]` (see palette.yaml). This mirrors
// the hand-rolled YAML reads in coverage-check.mjs / provenance-lint.mjs (the suite
// stays free of a YAML runtime dependency).
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

export const PALETTE_SIZE = PALETTE.size;

// RGB triple [r, g, b] of palette index 0..15.
export function paletteRgb(index) {
  const rgb = PALETTE.get(index & 0x0f);
  if (!rgb) throw new Error(`palette.yaml has no entry for index ${index}`);
  return rgb;
}
