// Screenshots with the border — cli.md CLI-PROD-RUN-008 / raster-border.md. `run
// --screenshot <png> --border` (and `verify --border`) writes the 320×240 bordered frame
// the preview player shows: each of the 240 rows takes the border colour in force where
// its raster line begins during the run's last frame (border-frame.ts, the player's own
// renderer). Without --border a screenshot stays the 256×192 screen (baselines, diffs).
// The acceptance is RASTER-SAVE-PP-001 reproduced headlessly with the real ROM: SA-BYTES
// paints red/cyan bands during the pilot tone and blue/yellow while the data goes out.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { decodePng } from '../src/observe/screenshot.js';
import { BORDER_X, BORDER_Y, OUT_HEIGHT, OUT_WIDTH } from '../src/preview/border-frame.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-border-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const code = await runCli(argv, { streams: { out: (t) => out.push(t), err: (t) => err.push(t) } });
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    process.chdir(prev);
  }
}

function project(source: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm' }));
  writeFileSync(join(dir, 'src', 'main.asm'), source);
}

/** The ROM's SAVE (SA-BYTES at 0x04C2) of the screen memory as a data block. */
const SAVE_SCREEN = [
  '    ORG 0x8000',
  '    ld sp, 0xFF00',
  '    ld ix, 0x4000',
  '    ld de, 6912',
  '    ld a, 0xFF',
  '    call 0x04C2',
  '    ei',
  'loop:',
  '    halt',
  '    jr loop',
  '',
].join('\n');

const RGB: Record<string, string> = {
  '0,0,205': 'blue',
  '205,0,0': 'red',
  '0,205,205': 'cyan',
  '205,205,0': 'yellow',
  '205,205,205': 'white',
  '0,0,0': 'black',
};

/** The set of colour names in the border pixels of a bordered PNG (row starts, left edge). */
function borderColours(file: string): Set<string> {
  const image = decodePng(file);
  if (image === null) throw new Error(`cannot decode ${file}`);
  expect(image.width).toBe(OUT_WIDTH);
  expect(image.height).toBe(OUT_HEIGHT);
  const names = new Set<string>();
  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    const i = y * OUT_WIDTH * 4; // x = 0: always border
    const key = `${image.data[i]},${image.data[i + 1]},${image.data[i + 2]}`;
    names.add(RGB[key] ?? key);
  }
  return names;
}

describe('run --screenshot --border (CLI-PROD-RUN-008, RASTER-SAVE-PP-001 headless)', () => {
  it('the pilot tone shows red/cyan bands', async () => {
    project(SAVE_SCREEN);
    const { code } = await cli(['run', '--frames', '20', '--no-detect-hangs', '--screenshot', 'pilot.png', '--border']);
    expect(code).toBe(0);
    expect([...borderColours(join(dir, 'pilot.png'))].sort()).toEqual(['cyan', 'red']);
  });

  it('the data part shows blue/yellow bands', async () => {
    project(SAVE_SCREEN);
    const { code } = await cli(['run', '--frames', '150', '--no-detect-hangs', '--screenshot', 'data.png', '--border']);
    expect(code).toBe(0);
    expect([...borderColours(join(dir, 'data.png'))].sort()).toEqual(['blue', 'yellow']);
  });

  it('the display sits inside the border, and the default screenshot stays 256×192', async () => {
    // Border 2 (red), one INK pixel at (0,0) of the display, black on white in its cell
    // (RAM, so every attribute, is zero at power-on: black on black).
    project([
      '    ORG 0x8000',
      '    ld a, 2',
      '    out (0xFE), a',
      '    ld a, 0x38',
      '    ld (0x5800), a',
      '    ld a, 0x80',
      '    ld (0x4000), a',
      '    ei',
      'loop:',
      '    halt',
      '    jr loop',
      '',
    ].join('\n'));
    expect((await cli(['run', '--frames', '5', '--screenshot', 'b.png', '--border'])).code).toBe(0);
    expect((await cli(['run', '--frames', '5', '--screenshot', 'plain.png'])).code).toBe(0);

    const bordered = decodePng(join(dir, 'b.png'))!;
    const pixel = (x: number, y: number): number[] => {
      const i = (y * bordered.width + x) * 4;
      return [bordered.data[i]!, bordered.data[i + 1]!, bordered.data[i + 2]!];
    };
    expect(pixel(0, 0)).toEqual([205, 0, 0]); // border, red
    expect(pixel(BORDER_X, BORDER_Y)).toEqual([0, 0, 0]); // display (0,0): ink black on white paper
    expect(pixel(BORDER_X + 1, BORDER_Y)).toEqual([205, 205, 205]); // paper

    const plain = decodePng(join(dir, 'plain.png'))!;
    expect([plain.width, plain.height]).toEqual([256, 192]);
  });

  it('--border without --screenshot is a usage error', async () => {
    project(SAVE_SCREEN);
    const { code, err } = await cli(['run', '--frames', '1', '--border']);
    expect(code).toBe(1);
    expect(err).toContain('--border');
  });
});

describe('verify --border', () => {
  it('writes the bordered screenshot', async () => {
    project(['    ORG 0x8000', '    ld a, 5', '    out (0xFE), a', '    ei', 'loop:', '    halt', '    jr loop', ''].join('\n'));
    const { code } = await cli(['verify', '--border', '--screenshot', 'v.png']);
    expect(code).toBe(0);
    expect([...borderColours(join(dir, 'v.png'))]).toEqual(['cyan']);
  });
});
