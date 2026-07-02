// Core graphics decode (Slice 11a) — cli.md CLI-PROD-GFX-001/002/003;
// toolkit-runtime.md RT-PROD-OBSERVE-001. Proves `gfx` decodes the agent's OWN Spectrum
// graphics DATA → PNG (the DNA direction): `gfx linear` renders a known 1bpp region
// pixel-exactly (verified by decoding the output PNG), `--preset` tiles a cell grid,
// `gfx attrs` renders the attribute colour grid, and the reverse-engineering
// `find`/`blit-linear` route through the optional add-on hook — HANDLED when mounted
// (Slice 11b default), fail loud "not installed" when the add-on is absent (ZXS_REVENG=off).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGfxLinear, runGfxAttrs } from '../src/gfx/gfx.js';
import { decodePng } from '../src/observe/screenshot.js';
import { paletteRgb, type RgbaImage } from '../src/observe/screen.js';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-gfx-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  return {
    streams: { out: (t) => o.push(t), err: (t) => e.push(t) },
    out: () => o.join(''),
    err: () => e.join(''),
  };
}

async function cliInDir(cwd: string, argv: string[], streams: OutputStreams): Promise<number> {
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    return await runCli(argv, { streams });
  } finally {
    process.chdir(prev);
  }
}

/** `[r,g,b]` of pixel `(x,y)` in a decoded RGBA image. */
function pixel(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/** Write a raw byte payload as a `.bin` in the temp dir; return its name. */
function writeBin(name: string, bytes: number[]): string {
  writeFileSync(join(dir, name), Buffer.from(bytes));
  return name;
}

describe('gfx linear — frame-linear 1bpp decode (CLI-PROD-GFX-002)', () => {
  it('renders a known region pixel-exactly (MSB-left, 1 byte = 8 px, rows consecutive)', () => {
    // Two consecutive bytes = two consecutive 8-px rows.
    const bin = writeBin('sprite.bin', [0b1000_0001, 0b0100_0010]);
    const env = runGfxLinear({
      cwd: dir,
      bin,
      org: '0x8000',
      addr: '0x8000',
      width: '8',
      height: '2',
      out: 'sprite.png',
    });
    expect(env.ok).toBe(true);
    expect(env.op).toBe('linear');
    expect(env.width).toBe(8);
    expect(env.height).toBe(2);
    expect(env.cells).toBe(1);

    const img = decodePng(join(dir, 'sprite.png'));
    expect(img).not.toBeNull();
    const ink = [...paletteRgb(0)]; // default ink 0 (black)
    const paper = [...paletteRgb(7)]; // default paper 7 (white)
    // Row 0: byte 1000_0001 -> x0 + x7 set.
    expect(pixel(img!, 0, 0)).toEqual(ink);
    expect(pixel(img!, 1, 0)).toEqual(paper);
    expect(pixel(img!, 7, 0)).toEqual(ink);
    // Row 1: byte 0100_0010 -> x1 + x6 set.
    expect(pixel(img!, 0, 1)).toEqual(paper);
    expect(pixel(img!, 1, 1)).toEqual(ink);
    expect(pixel(img!, 6, 1)).toEqual(ink);
    expect(pixel(img!, 7, 1)).toEqual(paper);
  });

  it('honours --ink / --paper palette overrides', () => {
    const bin = writeBin('mono.bin', [0b1000_0000]);
    runGfxLinear({
      cwd: dir,
      bin,
      org: '0x8000',
      addr: '0x8000',
      width: '8',
      height: '1',
      out: 'mono.png',
      ink: '2', // red
      paper: '5', // cyan
    });
    const img = decodePng(join(dir, 'mono.png'))!;
    expect(pixel(img, 0, 0)).toEqual([...paletteRgb(2)]); // set pixel -> ink red
    expect(pixel(img, 1, 0)).toEqual([...paletteRgb(5)]); // clear pixel -> paper cyan
  });

  it('requires --width and --height without a preset', () => {
    expect(() => runGfxLinear({ cwd: dir, addr: '0x8000', out: 'x.png' })).toThrowError(
      /width/i,
    );
  });
});

describe('gfx linear --preset — cell-grid tiling (CLI-PROD-GFX-002, Incidental geometry)', () => {
  it('tiles N cells into a grid and produces a deterministic PNG', () => {
    // 4 cells × 8 bytes (8×8 font cells); cell 0 row 0 = all ink.
    const bytes = new Array<number>(32).fill(0);
    bytes[0] = 0xff; // cell 0, row 0 -> 8 ink pixels
    const bin = writeBin('font.bin', bytes);
    const env = runGfxLinear({
      cwd: dir,
      bin,
      org: '0x8000',
      addr: '0x8000',
      out: 'font.png',
      preset: 'font',
      count: '4',
      cols: '2',
    });
    expect(env.ok).toBe(true);
    expect(env.preset).toBe('font');
    expect(env.cells).toBe(4);
    expect(env.cols).toBe(2);
    expect(env.rows).toBe(2);
    expect(env.width).toBe(16); // 2 cols × 8 px
    expect(env.height).toBe(16); // 2 rows × 8 px

    const img = decodePng(join(dir, 'font.png'))!;
    const ink = [...paletteRgb(0)];
    // Cell 0 (top-left) row 0 is all ink.
    expect(pixel(img, 0, 0)).toEqual(ink);
    expect(pixel(img, 7, 0)).toEqual(ink);
    // Cell 1 (top-right, all-zero bytes) is paper.
    expect(pixel(img, 8, 0)).toEqual([...paletteRgb(7)]);
  });

  it('derives the cell count from --width/--height when --count is omitted', () => {
    const bin = writeBin('derive.bin', new Array<number>(32).fill(0));
    const env = runGfxLinear({
      cwd: dir,
      bin,
      org: '0x8000',
      addr: '0x8000',
      out: 'derive.png',
      preset: 'font',
      width: '8',
      height: '32', // region = ceil(8/8)*32 = 32 bytes; 32/8 = 4 cells
      cols: '4',
    });
    expect(env.cells).toBe(4);
    expect(env.rows).toBe(1);
    expect(env.width).toBe(32); // 4 cols × 8
    expect(env.height).toBe(8);
  });
});

describe('gfx attrs — attribute colour grid (CLI-PROD-GFX-001)', () => {
  it('renders one block per attribute byte (paper fill + ink border) at 256×192', () => {
    // Cell (0,0): attr 0x14 -> ink 4 (green), paper 2 (red), no bright.
    const bin = writeBin('attr.bin', [0x14]);
    const env = runGfxAttrs({
      cwd: dir,
      bin,
      org: '0x5800',
      out: 'attrs.png',
    });
    expect(env.ok).toBe(true);
    expect(env.op).toBe('attrs');
    expect(env.addr).toBe(0x5800);
    expect(env.cols).toBe(32);
    expect(env.rows).toBe(24);
    expect(env.width).toBe(256);
    expect(env.height).toBe(192);

    const img = decodePng(join(dir, 'attrs.png'))!;
    expect(pixel(img, 0, 0)).toEqual([...paletteRgb(4)]); // cell(0,0) border -> ink green
    expect(pixel(img, 4, 4)).toEqual([...paletteRgb(2)]); // cell(0,0) interior -> paper red
    // Cell (1,0) has attr 0 -> ink 0 / paper 0 (all black).
    expect(pixel(img, 12, 4)).toEqual([...paletteRgb(0)]);
  });
});

describe('gfx — sub-command routing (CLI-PROD-GFX-003 reveng add-on)', () => {
  it('gfx find / gfx blit-linear fail loud when the add-on is NOT mounted (ZXS_REVENG=off)', async () => {
    const prev = process.env.ZXS_REVENG;
    process.env.ZXS_REVENG = 'off';
    try {
      for (const sub of ['find', 'blit-linear']) {
        const cap = capture();
        const code = await cliInDir(dir, ['gfx', sub, '--json'], cap.streams);
        expect(code).toBe(ExitCode.USER_ERROR);
        const env = JSON.parse(cap.out().trim());
        expect(env).toMatchObject({ ok: false, stage: 'gfx', error: { exitCode: 1 } });
        expect(env.error.message).toMatch(/add-on|not.*installed/i);
      }
    } finally {
      if (prev === undefined) delete process.env.ZXS_REVENG;
      else process.env.ZXS_REVENG = prev;
    }
  });

  it('gfx find / gfx blit-linear are HANDLED when the add-on is opted in (source-required error, not "not installed")', async () => {
    // The add-on is OFF by default (CLI-PROD-FREE-003); opt in via ZXS_REVENG so the reveng
    // handler runs and asks for a source, proving the hook delegates rather than "not installed".
    const prev = process.env.ZXS_REVENG;
    process.env.ZXS_REVENG = 'on';
    try {
      for (const sub of ['find', 'blit-linear']) {
        const cap = capture();
        const code = await cliInDir(dir, ['gfx', sub, '--json'], cap.streams);
        expect(code).toBe(ExitCode.USER_ERROR);
        const env = JSON.parse(cap.out().trim());
        expect(env.error.message).not.toMatch(/not.*installed/i);
      }
    } finally {
      if (prev === undefined) delete process.env.ZXS_REVENG;
      else process.env.ZXS_REVENG = prev;
    }
  });

  it('gfx screen points at `screen --png` (the one screenshot path)', async () => {
    const cap = capture();
    const code = await cliInDir(dir, ['gfx', 'screen', '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim()).error.message).toMatch(/screen --png/);
  });

  it('gfx linear without --out is a USER_ERROR', async () => {
    const cap = capture();
    const code = await cliInDir(
      dir,
      ['gfx', 'linear', '--addr', '0x4000', '--width', '8', '--height', '8', '--json'],
      cap.streams,
    );
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim()).error.message).toMatch(/--out/);
  });
});

describe('zxs gfx linear --json — CLI end-to-end', () => {
  it('decodes a region from a --bin and writes the PNG (exit 0)', async () => {
    writeBin('cli.bin', [0xff, 0x00, 0xff, 0x00]);
    const cap = capture();
    const code = await cliInDir(
      dir,
      ['gfx', 'linear', '--bin', 'cli.bin', '--org', '0x8000', '--addr', '0x8000', '--width', '8', '--height', '4', '--out', 'cli.png', '--json'],
      cap.streams,
    );
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ ok: true, stage: 'gfx', op: 'linear', width: 8, height: 4 });
    const img = decodePng(join(dir, 'cli.png'))!;
    expect(img.width).toBe(8);
    expect(img.height).toBe(4);
    // Row 0 = 0xFF (all ink), row 1 = 0x00 (all paper).
    expect(pixel(img, 3, 0)).toEqual([...paletteRgb(0)]);
    expect(pixel(img, 3, 1)).toEqual([...paletteRgb(7)]);
    expect(cap.err()).toBe('');
  });
});
