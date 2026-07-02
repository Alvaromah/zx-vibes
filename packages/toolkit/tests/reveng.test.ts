// Reverse-engineering ADD-ON (Slice 11b) — cli.md CLI-PROD-REVENG-001 / CLI-PROD-GFX-003,
// ADR-0027 D5. Proves the OPTIONAL third-party-inspection tools over a generated `.z80`:
// `snapshot info` preserves the LEGACY `{ format, version, hardwareMode, … }` shape;
// `snapshot mem`/`ram` dump memory; `scan` finds a byte pattern + an immediate; `xref`
// finds a reference to an address; reveng `gfx find` locates graphics-like data and
// `gfx blit-linear` renders a PNG (decoded + asserted); `.sna` fails loud (W4-GAP-03); and
// the add-on is OPTIONAL — `ZXS_REVENG=off` yields a pure-core CLI (no `snapshot` command).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeZ80 } from '@zx-vibes/machine';
import { runSnapshotInfo, runSnapshotMem, runSnapshotRam } from '../src/reveng/snapshot.js';
import { runScanBytes, runScanImm } from '../src/reveng/scan.js';
import { runXref } from '../src/reveng/xref.js';
import { runGfxFind, runGfxBlitLinear } from '../src/reveng/gfx-reveng.js';
import { loadRevengImage } from '../src/reveng/snapshot-source.js';
import { decodePng } from '../src/observe/screenshot.js';
import { paletteRgb, type RgbaImage } from '../src/observe/screen.js';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;

/** The sprite bytes planted at 0x9000 (an "X"): all non-blank / non-solid → graphics-like. */
const SPRITE = [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81];

/** Build a `.z80` with `CALL 0x9000 ; RET` at 0x8000 and the sprite at 0x9000. */
function writeSnapshot(name = 'game.z80'): string {
  const memory = new Uint8Array(0x10000);
  memory.set([0xcd, 0x00, 0x90, 0xc9], 0x8000); // CALL 0x9000 ; RET
  memory.set(SPRITE, 0x9000);
  const bytes = writeZ80({ registers: { pc: 0x8000, sp: 0xff00, i: 0x3f, im: 1, iff1: 1 }, memory, border: 3 });
  writeFileSync(join(dir, name), Buffer.from(bytes));
  return name;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-reveng-'));
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

function pixel(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

describe('snapshot info — legacy { format, version, hardwareMode, … } (CLI-PROD-REVENG-001)', () => {
  it('reports the preserved legacy shape from a .z80', () => {
    const file = writeSnapshot();
    const env = runSnapshotInfo({ cwd: dir, file });
    expect(env).toMatchObject({
      ok: true,
      stage: 'snapshot',
      op: 'info',
      format: 'z80',
      version: 3, // writeZ80 emits version 3
      hardwareMode: '48K',
      border: 3,
    });
    expect(env.registers.pc).toBe(0x8000);
    expect(env.registers.sp).toBe(0xff00);
    expect(env.registers.im).toBe(1);
    expect(env.registers.iff1).toBe(1);
  });
});

describe('snapshot mem / ram — memory dumps (CLI-PROD-REVENG-001)', () => {
  it('mem reads a bounded region at an address', () => {
    const file = writeSnapshot();
    const env = runSnapshotMem({ cwd: dir, file, addr: '0x9000', len: '8' });
    expect(env.op).toBe('mem');
    expect(env.addr).toBe(0x9000);
    expect(env.len).toBe(8);
    expect(env.bytes).toEqual(SPRITE);
    expect(env.hex).toBe('81 42 24 18 18 24 42 81');
  });

  it('ram dumps a range inline (with a change-detection hash)', () => {
    const file = writeSnapshot();
    const env = runSnapshotRam({ cwd: dir, file, range: '0x8000-0x8003' });
    expect(env.op).toBe('ram');
    expect(env.range).toEqual({ from: 0x8000, to: 0x8003 });
    expect(env.bytes).toEqual([0xcd, 0x00, 0x90, 0xc9]);
    expect(typeof env.hash).toBe('string');
  });

  it('ram writes a large region to --out instead of inline', () => {
    const file = writeSnapshot();
    const env = runSnapshotRam({ cwd: dir, file, out: 'ram.bin' }); // whole 48K RAM
    expect(env.out).toBe('ram.bin');
    expect(env.len).toBe(0xffff - 0x4000 + 1);
    expect(env.bytes).toBeUndefined();
    expect(typeof env.hash).toBe('string');
  });
});

describe('scan — opcode / immediate-range search (CLI-PROD-REVENG-001)', () => {
  it('finds a known byte/opcode pattern (with a wildcard)', () => {
    const file = writeSnapshot();
    const env = runScanBytes({ cwd: dir, z80: file, bytesPattern: 'CD ?? 90' });
    expect(env.mode).toBe('bytes');
    expect(env.count).toBe(1);
    expect(env.matches[0]).toMatchObject({ addr: 0x8000 });
  });

  it('finds an instruction whose immediate operand is in a range', () => {
    const file = writeSnapshot();
    const env = runScanImm({ cwd: dir, z80: file, imm: '0x9000-0x9000', range: '0x8000-0x8010' });
    expect(env.mode).toBe('imm');
    expect(env.count).toBe(1);
    expect(env.matches[0]).toMatchObject({ addr: 0x8000, value: 0x9000, text: 'CALL 0x9000' });
  });
});

describe('xref — static reference finder (CLI-PROD-REVENG-001)', () => {
  it('finds a reference to a known address and classifies it', () => {
    const file = writeSnapshot();
    const env = runXref({ cwd: dir, z80: file, target: '0x9000', range: '0x8000-0x8010' });
    expect(env.target).toBe(0x9000);
    expect(env.count).toBe(1);
    expect(env.refs[0]).toMatchObject({ addr: 0x8000, kind: 'call', text: 'CALL 0x9000' });
  });
});

describe('reveng gfx — find + blit-linear (CLI-PROD-GFX-003, one screenshot encoder)', () => {
  it('gfx find locates graphics-like data (the sprite scores highest)', () => {
    const file = writeSnapshot();
    const env = runGfxFind({ cwd: dir, z80: file, range: '0x8ff0-0x9010', window: '8', stride: '1', top: '3' });
    expect(env.op).toBe('find');
    expect(env.candidates.length).toBeGreaterThan(0);
    expect(env.candidates[0]).toMatchObject({ addr: 0x9000, score: 1, length: 8 });
  });

  it('gfx blit-linear renders a found region to a PNG (decode + assert pixels)', () => {
    const file = writeSnapshot();
    const env = runGfxBlitLinear({ cwd: dir, z80: file, addr: '0x9000', width: '8', height: '8', out: 'sprite.png' });
    expect(env.op).toBe('blit-linear');
    expect(env.width).toBe(8);
    expect(env.height).toBe(8);

    const img = decodePng(join(dir, 'sprite.png'));
    expect(img).not.toBeNull();
    const ink = [...paletteRgb(0)];
    const paper = [...paletteRgb(7)];
    // Row 0 = 0x81 = 1000_0001 → x0 + x7 ink, x1..x6 paper.
    expect(pixel(img!, 0, 0)).toEqual(ink);
    expect(pixel(img!, 7, 0)).toEqual(ink);
    expect(pixel(img!, 3, 0)).toEqual(paper);
    // Row 3 = 0x18 = 0001_1000 → x3 + x4 ink.
    expect(pixel(img!, 3, 3)).toEqual(ink);
    expect(pixel(img!, 4, 3)).toEqual(ink);
    expect(pixel(img!, 0, 3)).toEqual(paper);
  });
});

describe('.sna — fail loud (W4-GAP-03, no core codec)', () => {
  it('snapshot info on a .sna is a USER_ERROR naming the gap', () => {
    writeFileSync(join(dir, 'game.sna'), Buffer.alloc(49179));
    expect(() => runSnapshotInfo({ cwd: dir, file: 'game.sna' })).toThrowError(/\.sna codec|W4-GAP-03/i);
  });

  it('scan --sna fails loud too', () => {
    writeFileSync(join(dir, 'game.sna'), Buffer.alloc(49179));
    expect(() => runScanBytes({ cwd: dir, sna: 'game.sna', bytesPattern: '00' })).toThrowError(
      /\.sna codec|W4-GAP-03/i,
    );
  });
});

describe('reveng source — --bin raw dump', () => {
  it('loads a raw --bin at --org into a 64K image', () => {
    writeFileSync(join(dir, 'dump.bin'), Buffer.from(SPRITE));
    const image = loadRevengImage({ cwd: dir, bin: 'dump.bin', org: '0x9000', stage: 'scan' });
    expect(image.source.kind).toBe('bin');
    expect(Array.from(image.memory.slice(0x9000, 0x9008))).toEqual(SPRITE);
  });
});

describe('zxs CLI end-to-end — the add-on is OFF by default, opt-in via ZXS_REVENG (CLI-PROD-FREE-003)', () => {
  // The add-on's ABSENCE is the documented default (CLI-PROD-FREE-003); it is opt-in via
  // ZXS_REVENG (the "install" seam). These mounted-path tests set the env to exercise it.
  let savedReveng: string | undefined;
  beforeEach(() => {
    savedReveng = process.env.ZXS_REVENG;
    process.env.ZXS_REVENG = 'on';
  });
  afterEach(() => {
    if (savedReveng === undefined) delete process.env.ZXS_REVENG;
    else process.env.ZXS_REVENG = savedReveng;
  });

  it('snapshot info --json exits 0 with the legacy shape (add-on opt-in)', async () => {
    const file = writeSnapshot();
    const cap = capture();
    const code = await cliInDir(dir, ['snapshot', 'info', file, '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      ok: true,
      stage: 'snapshot',
      op: 'info',
      format: 'z80',
      hardwareMode: '48K',
    });
    expect(cap.err()).toBe('');
  });

  it('scan --json finds the pattern (exit 0, add-on opt-in)', async () => {
    const file = writeSnapshot();
    const cap = capture();
    const code = await cliInDir(dir, ['scan', '--z80', file, '--bytes', 'CD 00 90', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    expect(JSON.parse(cap.out().trim())).toMatchObject({ ok: true, stage: 'scan', count: 1 });
  });

  it('gfx find --json locates the sprite (exit 0, add-on opt-in)', async () => {
    const file = writeSnapshot();
    const cap = capture();
    const code = await cliInDir(
      dir,
      ['gfx', 'find', '--z80', file, '--range', '0x8ff0-0x9010', '--window', '8', '--stride', '1', '--json'],
      cap.streams,
    );
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env).toMatchObject({ ok: true, stage: 'gfx', op: 'find' });
    expect(env.candidates[0].addr).toBe(0x9000);
  });

  it('the DEFAULT surface is add-on-absent: with ZXS_REVENG unset, `snapshot` is not a command', async () => {
    const file = writeSnapshot();
    delete process.env.ZXS_REVENG;
    const cap = capture();
    const code = await cliInDir(dir, ['snapshot', 'info', file, '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim()).error.message).toMatch(/unknown command/i);
  });

  it('with ZXS_REVENG=off, `snapshot` is not a command (pure core — add-on absent)', async () => {
    const file = writeSnapshot();
    process.env.ZXS_REVENG = 'off';
    const cap = capture();
    const code = await cliInDir(dir, ['snapshot', 'info', file, '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim()).error.message).toMatch(/unknown command/i);
  });
});
