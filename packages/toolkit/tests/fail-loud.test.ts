// Inputs the toolkit must reject loudly instead of half-loading (errors.md
// ERR-PROD-EMU-001 / ERR-PROD-NOSILENT-001), and the build guard that keeps an
// optional `--tap [path]` value from overwriting the entry source.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeTap, writeZ80 } from '@zx-vibes/machine';
import { runBuild } from '../src/build/build.js';
import { tapImageBytes, tapeCodeHeader } from '../src/build/formats.js';
import { CliError, ExitCode } from '../src/output/envelope.js';
import { loadMachineFromSource } from '../src/runtime/machine-source.js';
import { bootFreshMachine } from '../src/runtime/session.js';
import { z80SnapshotProblem } from '../src/runtime/z80-check.js';
import { emptyDebugStore } from '../src/state/debug-store.js';
import { deserializeZxState, serializeZxState } from '../src/state/zxstate.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-fail-loud-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function expectUserError(fn: () => unknown, message: RegExp): void {
  try {
    fn();
    expect.unreachable('should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
    expect((error as CliError).message).toMatch(message);
  }
}

function validZ80(): Uint8Array {
  const machine = bootFreshMachine();
  machine.registers.pc = 0x8000;
  return writeZ80({ registers: machine.registers, memory: machine.memory, border: 2 });
}

describe('z80SnapshotProblem (ERR-PROD-EMU-001)', () => {
  it('accepts the core writer output', () => {
    expect(z80SnapshotProblem(validZ80())).toBeUndefined();
  });

  it('rejects an empty file, a truncated page and a truncated v1 image', () => {
    expect(z80SnapshotProblem(new Uint8Array(0))).toMatch(/smaller than the 30-byte/);
    const v3 = validZ80();
    expect(z80SnapshotProblem(v3.subarray(0, v3.length - 100))).toMatch(/truncated/);
    const v1 = new Uint8Array(30 + 100);
    v1[6] = 0x00;
    v1[7] = 0x80; // PC 0x8000 → version 1; byte 12 = 0 → uncompressed
    expect(z80SnapshotProblem(v1)).toMatch(/version 1 RAM image is truncated/);
  });

  it('rejects a snapshot of a non-48K machine (hardware mode byte 34)', () => {
    const v3 = validZ80();
    v3[34] = 4; // version 3: 128K
    expect(z80SnapshotProblem(v3)).toMatch(/hardware mode 4 is not a 48K Spectrum/);
    v3[34] = 3; // version 3: 48K + M.G.T. — still a 48K machine
    expect(z80SnapshotProblem(v3)).toBeUndefined();
  });

  it('makes `--z80 <empty file>` a user error instead of a running zeroed machine', () => {
    writeFileSync(join(dir, 'empty.z80'), new Uint8Array(0));
    expectUserError(
      () => loadMachineFromSource({ cwd: dir, z80: 'empty.z80', stage: 'run' }),
      /Cannot load \.z80 snapshot "empty\.z80"/,
    );
  });
});

describe('.zxstate validation (ERR-PROD-EMU-001)', () => {
  function sessionText(): string {
    const machine = bootFreshMachine();
    machine.registers.pc = 0x8000;
    return serializeZxState({ machine, border: 3, debug: emptyDebugStore() });
  }

  it('still round-trips a valid session', () => {
    const state = deserializeZxState(sessionText());
    expect(state.machine.registers.pc).toBe(0x8000);
    expect(state.border).toBe(3);
  });

  it('rejects an unsupported version', () => {
    const envelope = JSON.parse(sessionText());
    envelope.version = 99;
    expectUserError(() => deserializeZxState(JSON.stringify(envelope)), /Unsupported .*version 99/);
  });

  it('rejects a corrupt machine snapshot', () => {
    const envelope = JSON.parse(sessionText());
    envelope.machine.z80 = 'AAAA';
    expectUserError(() => deserializeZxState(JSON.stringify(envelope)), /Corrupt .*snapshot is invalid/);
  });
});

describe('.tap sources reject blocks the ROM would not load (ERR-PROD-NOSILENT-001)', () => {
  const program = Uint8Array.of(0x3e, 0x02, 0xd3, 0xfe, 0x18, 0xfe); // ld a,2 / out (fe),a / jr $

  it('boots a well-formed CODE tape', () => {
    writeFileSync(join(dir, 'ok.tap'), tapImageBytes({ bytes: program, loadAddress: 0x8000, name: 'ok' }));
    const loaded = loadMachineFromSource({ cwd: dir, tap: 'ok.tap', stage: 'run' });
    expect(loaded.org).toBe(0x8000);
    expect(Array.from(loaded.machine.memory.subarray(0x8000, 0x8006))).toEqual(Array.from(program));
  });

  it('rejects a data block with the wrong flag', () => {
    const tape = serializeTap([
      { flag: 0x00, data: tapeCodeHeader('flag', program.length, 0x8000) },
      { flag: 0x00, data: program },
    ]);
    writeFileSync(join(dir, 'flag.tap'), tape);
    expectUserError(
      () => loadMachineFromSource({ cwd: dir, tap: 'flag.tap', stage: 'run' }),
      /did not load \(flag-mismatch/,
    );
  });

  it('rejects a data block shorter than its header declares', () => {
    const tape = serializeTap([
      { flag: 0x00, data: tapeCodeHeader('short', 1000, 0x8000) },
      { flag: 0xff, data: program },
    ]);
    writeFileSync(join(dir, 'short.tap'), tape);
    expectUserError(
      () => loadMachineFromSource({ cwd: dir, tap: 'short.tap', stage: 'run' }),
      /did not load .*header declares 1000 bytes/,
    );
  });
});

describe('build: a format target never overwrites the source', () => {
  it('refuses `--tap <the entry>` and leaves the source intact', () => {
    const source = '    ORG 0x8000\nstart:\n    ret\n';
    writeFileSync(join(dir, 'main.asm'), source);
    writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }));
    // `zxs build --tap main.asm` parses as tap="main.asm" with no positional entry.
    expectUserError(
      () => runBuild({ cwd: dir, formats: { tap: 'main.asm' }, env: {} }),
      /--tap "main\.asm" names a source file/,
    );
    expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toBe(source);
  });

  it('still writes an explicit, non-source target', () => {
    writeFileSync(join(dir, 'main.asm'), '    ORG 0x8000\n    ret\n');
    const report = runBuild({ cwd: dir, entry: 'main.asm', formats: { tap: 'out/game.tap' }, env: {} });
    expect(report.ok).toBe(true);
    expect(report.outputs.artifacts).toContain('out/game.tap');
  });
});
