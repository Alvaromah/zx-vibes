// Screenshot encoder/writer — the ONE PNG path (cli.md CLI-PROD-RULE-SCREENSHOT-001:
// there is a single screenshot encoder behind `screen --png`/`--base64`,
// `run --screenshot`, and `verify`'s screenshot stage). toolkit-runtime.md
// RT-PROD-OUT-002 (artifacts written to caller-specified paths).
//
// This module is the shared file-writing seam: it turns the framebuffer produced by
// `renderRgbaImage` (observe/screen.ts, screen-render.md SCREEN-FRAMEBUFFER-001) into
// PNG bytes and writes them to disk. Slice 5 (`verify`) is the first consumer; Slice 7
// (`screen --png`/`--base64`) and Slice 8 reuse `encodePng`/`writePng`/`captureScreenshot`
// verbatim — the encoder lives here, not duplicated per command (the one-encoder rule).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';
import type { Machine } from '@zx-vibes/machine';
import { readScreenImage, renderRgbaImage, type RgbaImage } from './screen.js';

/**
 * Encode an RGBA framebuffer to PNG bytes (the one encoder, CLI-PROD-RULE-SCREENSHOT-001).
 * Deterministic for a fixed framebuffer, so a screenshot artifact is byte-stable across
 * invocations (the basis for normalized fixtures; RT-PROD-RULE-DET-001).
 */
export function encodePng(image: RgbaImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
}

/**
 * Decode a PNG file into an RGBA framebuffer, or `null` if it cannot be read/decoded
 * (the one PNG codec's read half, CLI-PROD-RULE-SCREENSHOT-001). The shared baseline
 * loader behind the `screenDiff` assertion (ASSERT-PROD-SCREENDIFF-001) and
 * `screen --diff` (CLI-PROD-SCREEN-003) — one decoder, not two, so the visual-regression
 * metric/storage stay identical between the CLI command and the test assertion.
 */
export function decodePng(absPath: string): RgbaImage | null {
  try {
    const png = PNG.sync.read(readFileSync(absPath));
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  } catch {
    return null;
  }
}

/**
 * Nearest-neighbour integer upscale of an RGBA framebuffer by `factor` (1..N) — the
 * render-policy zoom behind `screen --scale` / `zx_screen { scale }` (MCP-PROD-TOOL-SCREEN-001,
 * scale 1–4). `factor <= 1` returns the image unchanged. Purely a presentation transform;
 * the diff/OCR paths always use the native 256×192 framebuffer so the metric is scale-invariant.
 */
export function scaleRgba(image: RgbaImage, factor: number): RgbaImage {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return image;
  const width = image.width * f;
  const height = image.height * f;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y / f);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x / f);
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = image.data[src]!;
      data[dst + 1] = image.data[src + 1]!;
      data[dst + 2] = image.data[src + 2]!;
      data[dst + 3] = image.data[src + 3]!;
    }
  }
  return { width, height, data };
}

/**
 * Write an RGBA framebuffer to `absPath` as PNG, creating parent directories as needed
 * (e.g. `.zxs/` for the default verify screenshot). `absPath` must be absolute.
 */
export function writePng(absPath: string, image: RgbaImage): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, encodePng(image));
}

/**
 * Capture a machine's current screen to a PNG file at `absPath` (RT-PROD-VERIFY-001
 * screenshot stage). Reads the 6912-byte screen image and renders it through the single
 * shared renderer at FLASH phase 0 (deterministic, FLASH-stable). Returns `absPath`.
 */
export function captureScreenshot(machine: Machine, absPath: string): string {
  writePng(absPath, renderRgbaImage(readScreenImage(machine), 0));
  return absPath;
}
