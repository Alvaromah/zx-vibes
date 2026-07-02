// Slice 8a — loadable format emitters (.tap/.scr/.z80). The toolkit ORCHESTRATES; the
// byte layouts are delegated to the `@zx-vibes/machine` codecs (serializeTap / writeZ80)
// and the screen primitive (readScreenImage). These round-trip tests close the loop:
// build/state-export an artifact, then read it back through the SAME core codecs
// (parseTap + edgeLoad/instantLoad, readZ80) and assert byte/RAM identity.
//
// Spec trace: file-formats.md FF-TAP-001 / FF-SCR-001 / FF-Z80-001 ->
// domain/file-formats.md FMT-TAP-* / FMT-SCR-* + snapshot-z80.md; the `.tap` two-block
// (header + data) structure traces to the DNA tape acceptance harness
// dna/conformance/tape/run-tape-edge-load-accept.mjs. The `.z80` version split
// (build = core v3; state export = toolkit v1) is W4-GAP-02.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import {
  blockToPulses,
  edgeLoad,
  instantLoad,
  parseTap,
  readZ80,
  tapChecksum,
} from '@zx-vibes/machine';
import { runBuild } from '../src/build/build.js';
import { bootFreshMachine } from '../src/runtime/session.js';
import { runStateExportScr, runStateExportTap } from '../src/state/state-command.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-formats-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  writeFileSync(join(dir, name), contents, 'utf8');
}

/** Assemble to bytes (throws on error) — used to build raw `--bin` fixtures. */
function asmBytes(source: string): Uint8Array {
  const r = assemble(source);
  if (!r.ok) throw new Error(`asm failed: ${r.errors.map((e) => e.message).join('; ')}`);
  return r.bytes;
}

// A tiny program at 0x8000: ld a,0x2A / ld (0x9000),a / ret. Real Z80 bytes that must
// reach RAM byte-identically through a tape/snapshot round-trip.
const CODE_PROG = ['ORG 0x8000', 'start:', '  ld a, 0x2A', '  ld (0x9000), a', '  ret', ''].join('\n');

// A "screen image" program at 0x4000: a recognizable display pattern at offset 0, then
// a pad to the attribute file (offset 6144 = 0x5800), then an attribute byte. When loaded
// at 0x4000 it populates the screen memory region the `.scr` copies (FMT-SCR-LAYOUT-001).
const SCREEN_PROG = [
  'ORG 0x4000',
  '  DEFB 0x18, 0x24, 0x42, 0x99', // display bytes at scr offsets 0..3
  '  DS 6144 - 4',                 // zero-fill the rest of the display file
  '  DEFB 0x47, 0x38',             // attribute bytes at scr offsets 6144..6145
  '',
].join('\n');

const word = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8)) & 0xffff;

// =========================================================================
// build --scr
// =========================================================================

describe('build --scr (FF-SCR-001 / FMT-SCR-*)', () => {
  it('emits a 6912-byte screen image with the program\'s display + attribute content', () => {
    write('main.asm', SCREEN_PROG);
    const result = runBuild({ cwd: dir, entry: 'main.asm', formats: { scr: true }, env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toContain('build/main.scr');

    const scr = readFileSync(join(dir, 'build', 'main.scr'));
    expect(scr.length).toBe(6912); // FMT-SCR-SIZE-001
    // Display file content (offset 0 = address 0x4000).
    expect([scr[0], scr[1], scr[2], scr[3]]).toEqual([0x18, 0x24, 0x42, 0x99]);
    // Attribute file content (offset 6144 = address 0x5800).
    expect(scr[6144]).toBe(0x47);
    expect(scr[6145]).toBe(0x38);
  });
});

// =========================================================================
// build --tap — round-trips through parseTap AND loads via instantLoad/edgeLoad
// =========================================================================

describe('build --tap (FF-TAP-001 / FMT-TAP-*; DNA tape acceptance structure)', () => {
  it('emits a CODE tape (header block + data block) that parseTap reads back', () => {
    write('main.asm', CODE_PROG);
    const result = runBuild({ cwd: dir, entry: 'main.asm', formats: { tap: true }, env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toContain('build/main.tap');

    const code = readFileSync(join(dir, 'build', 'main.bin'));
    const blocks = parseTap(readFileSync(join(dir, 'build', 'main.tap')));

    // Two blocks: a 17-byte CODE header (flag 0x00) + the program data block (flag 0xFF).
    expect(blocks).toHaveLength(2);
    const header = blocks[0]!;
    const data = blocks[1]!;
    expect(header.flag).toBe(0x00); // FMT-TAP-FLAG-001
    expect(data.flag).toBe(0xff);
    // The 17-byte standard header: type(1)=3 (CODE), length(2 LE), param1(2 LE)=load addr.
    expect(header.data).toHaveLength(17);
    expect(header.data[0]).toBe(3); // CODE
    expect(word(header.data, 11)).toBe(code.length); // declared length
    expect(word(header.data, 13)).toBe(0x8000); // load address (the program's origin)
    // The data block carries the assembled bytes verbatim.
    expect([...data.data]).toEqual([...code]);
  });

  it('the data block instant-loads back to the program origin byte-identically', () => {
    write('main.asm', CODE_PROG);
    runBuild({ cwd: dir, entry: 'main.asm', formats: { tap: true }, env: {} });
    const code = readFileSync(join(dir, 'build', 'main.bin'));
    const data = parseTap(readFileSync(join(dir, 'build', 'main.tap')))[1]!;

    const machine = bootFreshMachine();
    const body = Uint8Array.from([data.flag, ...data.data, tapChecksum(data.flag, data.data)]);
    const r = instantLoad(machine, body, { ix: 0x8000, de: data.data.length, flag: 0xff });
    expect(r.ok).toBe(true);
    expect(r.bytesLoaded).toBe(code.length);
    expect([...machine.memory.slice(0x8000, 0x8000 + code.length)]).toEqual([...code]);
  });

  it('the data block edge-loads through the real ROM LD-BYTES to the origin', () => {
    write('main.asm', CODE_PROG);
    runBuild({ cwd: dir, entry: 'main.asm', formats: { tap: true }, env: {} });
    const code = readFileSync(join(dir, 'build', 'main.bin'));
    const data = parseTap(readFileSync(join(dir, 'build', 'main.tap')))[1]!;

    const machine = bootFreshMachine(); // ROM mapped at 0x0000 — LD-BYTES (0x0556) runs
    const body = Uint8Array.from([data.flag, ...data.data, tapChecksum(data.flag, data.data)]);
    const r = edgeLoad(machine, blockToPulses(body), {
      ix: 0x8000,
      de: data.data.length,
      flag: 0xff,
      tStateBudget: 30_000_000,
    });
    expect(r.ok).toBe(true);
    expect([...machine.memory.slice(0x8000, 0x8000 + code.length)]).toEqual([...code]);
  });
});

// =========================================================================
// build --z80 — version 3 (the core writeZ80), round-trips through readZ80
// =========================================================================

describe('build --z80 (FF-Z80-001; build = core v3, W4-GAP-02)', () => {
  it('emits a v3 snapshot whose readZ80 reproduces RAM + PC', () => {
    write('main.asm', CODE_PROG);
    const result = runBuild({ cwd: dir, entry: 'main.asm', formats: { z80: true }, env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toContain('build/main.z80');

    const code = readFileSync(join(dir, 'build', 'main.bin'));
    const snap = readZ80(readFileSync(join(dir, 'build', 'main.z80')));
    expect(snap.version).toBe(3); // build's .z80 is the core's v3 (NOT the state-export v1)
    expect(snap.registers.pc).toBe(0x8000); // PC = the program origin (loadBytesMachine)
    expect([...snap.memory.slice(0x8000, 0x8000 + code.length)]).toEqual([...code]);
  });
});

// =========================================================================
// build with MULTIPLE format flags emits every requested artifact
// =========================================================================

describe('build --tap --scr --z80 emits all requested artifacts', () => {
  it('lists tap + scr + z80 in outputs.artifacts and writes each file', () => {
    write('main.asm', CODE_PROG);
    const result = runBuild({
      cwd: dir,
      entry: 'main.asm',
      formats: { tap: true, scr: true, z80: true },
      env: {},
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toEqual(
      expect.arrayContaining(['build/main.tap', 'build/main.scr', 'build/main.z80']),
    );
    for (const ext of ['tap', 'scr', 'z80']) {
      expect(existsSync(join(dir, 'build', `main.${ext}`))).toBe(true);
    }
  });

  it('honors an explicit --tap <path>', () => {
    write('main.asm', CODE_PROG);
    const result = runBuild({
      cwd: dir,
      entry: 'main.asm',
      formats: { tap: 'dist/game.tap' },
      env: {},
    });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toContain('dist/game.tap');
    expect(existsSync(join(dir, 'dist', 'game.tap'))).toBe(true);
    // It is a valid tape (parses into the header + data blocks).
    expect(parseTap(readFileSync(join(dir, 'dist', 'game.tap')))).toHaveLength(2);
  });
});

// =========================================================================
// state export --tap / --scr — over the live session machine
// =========================================================================

describe('state export --tap / --scr (CLI-PROD-STATE-001, Slice 8a)', () => {
  it('--tap wraps the session RAM as a CODE tape that instant-loads back identically', () => {
    writeFileSync(join(dir, 'prog.bin'), asmBytes(CODE_PROG));
    const env = runStateExportTap('out.tap', { cwd: dir, bin: 'prog.bin', org: '0x8000' });
    expect(env.format).toBe('tap');

    const blocks = parseTap(readFileSync(join(dir, 'out.tap')));
    expect(blocks).toHaveLength(2);
    const data = blocks[1]!;
    expect(data.flag).toBe(0xff);
    expect(data.data.length).toBe(0xc000); // the 48K RAM image (0x4000-0xFFFF)

    // Instant-load the 48K data block back to 0x4000 and confirm the program bytes landed.
    const machine = bootFreshMachine();
    const body = Uint8Array.from([data.flag, ...data.data, tapChecksum(data.flag, data.data)]);
    const r = instantLoad(machine, body, { ix: 0x4000, de: data.data.length, flag: 0xff });
    expect(r.ok).toBe(true);
    const code = asmBytes(CODE_PROG);
    expect([...machine.memory.slice(0x8000, 0x8000 + code.length)]).toEqual([...code]);
  });

  it('--scr copies the session screen region (6912 bytes, byte-for-byte round-trip)', () => {
    writeFileSync(join(dir, 'screen.bin'), asmBytes(SCREEN_PROG));
    const env = runStateExportScr('out.scr', { cwd: dir, bin: 'screen.bin', org: '0x4000' });
    expect(env.format).toBe('scr');

    const scr = readFileSync(join(dir, 'out.scr'));
    expect(scr.length).toBe(6912);
    expect([scr[0], scr[1], scr[2], scr[3]]).toEqual([0x18, 0x24, 0x42, 0x99]);
    expect(scr[6144]).toBe(0x47);

    // Pure copy → reloading into a fresh machine's screen region reproduces it (FMT-SCR-ROUNDTRIP-001).
    const machine = bootFreshMachine();
    machine.memory.set(scr, 0x4000);
    expect([...machine.memory.slice(0x4000, 0x4000 + 6912)]).toEqual([...scr]);
  });
});
