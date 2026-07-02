// Headless PNG capture — boot the ROM and render the screen *with border* through
// the same render.mjs the browser bundle uses. Handy for docs/preview images and
// for eyeballing the emulator without a browser.
//
//   node screenshot.mjs [out.png] [frames]

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMachine, RESET_REGISTERS } from '@zx-vibes/machine';
import { renderWithBorder, OUT_WIDTH, OUT_HEIGHT } from './render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, '..', '..', 'packages', 'toolkit', 'package.json'));
const { PNG } = require('pngjs');

/** Boot the ROM for `frames` frames, capturing the final border colour. */
export function boot(frames = 200) {
  const rom = new Uint8Array(readFileSync(join(HERE, '48k.rom')));
  const memory = new Uint8Array(0x10000);
  memory.set(rom, 0);
  const state = { border: 7 };
  const io = {
    read: () => 0xff,
    write: (port, value) => {
      if ((port & 1) === 0) state.border = value & 0x07;
    },
  };
  const machine = createMachine({ memory, registers: { ...RESET_REGISTERS }, io });
  for (let i = 0; i < frames; i += 1) machine.runFrame();
  return { screen: machine.memory.slice(0x4000, 0x4000 + 6912), border: state.border, frames };
}

/** Boot and write a scaled PNG (with border) to `path`. */
export function writeScreenshot(path, { frames = 200, scale = 2 } = {}) {
  const { screen, border, frames: f } = boot(frames);
  const rgba = renderWithBorder(screen, border, f);
  const w = OUT_WIDTH * scale;
  const h = OUT_HEIGHT * scale;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const si = (((y / scale) | 0) * OUT_WIDTH + ((x / scale) | 0)) * 4;
      const di = (y * w + x) * 4;
      png.data[di] = rgba[si];
      png.data[di + 1] = rgba[si + 1];
      png.data[di + 2] = rgba[si + 2];
      png.data[di + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2] || join(HERE, 'preview.png');
  const frames = Number(process.argv[3]) || 200;
  writeScreenshot(out, { frames });
  console.log('wrote', out);
}
