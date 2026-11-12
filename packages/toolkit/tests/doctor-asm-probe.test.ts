// `doctor`'s `asm` check can fail (cli.md CLI-PROD-DOCTOR-001, errors.md ERR-PROD-ENV-001).
// It used to be `typeof assembleFile === 'function'` on a static import, which is true
// whenever doctor runs at all. It now assembles a known program and checks the bytes, so a
// broken embedded assembler (one that throws, or emits the wrong code) fails it → exit 3.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ mode: 'none' as 'none' | 'wrong-bytes' | 'throws' }));

vi.mock('@zx-vibes/asm', async (importOriginal) => {
  const real = await importOriginal<typeof import('@zx-vibes/asm')>();
  return {
    ...real,
    assemble: (...args: Parameters<typeof real.assemble>) => {
      if (fault.mode === 'throws') throw new Error('broken build');
      const result = real.assemble(...args);
      return fault.mode === 'wrong-bytes' ? { ...result, bytes: new Uint8Array([0, 0, 0]) } : result;
    },
  };
});

import { defaultAsmImportable, runDoctor } from '../src/doctor/doctor.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-doctor-asm-'));
  fault.mode = 'none';
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const asmCheck = (): { ok: boolean; detail: string } | undefined =>
  (runDoctor({ cwd: dir }).checks as Array<{ name: string; ok: boolean; detail: string }>).find(
    (c) => c.name === 'asm',
  );

describe('the default asm probe assembles a known program', () => {
  it('passes with the real embedded assembler', () => {
    expect(defaultAsmImportable()).toBe(true);
    expect(asmCheck()?.ok).toBe(true);
  });

  it('fails when the assembler emits the wrong bytes', () => {
    fault.mode = 'wrong-bytes';
    expect(defaultAsmImportable()).toBe(false);
    const check = asmCheck();
    expect(check?.ok).toBe(false);
    expect(check?.detail).toMatch(/3E 01 C9/);
  });

  it('fails when the assembler throws', () => {
    fault.mode = 'throws';
    expect(defaultAsmImportable()).toBe(false);
    const env = runDoctor({ cwd: dir });
    expect(env.ok).toBe(false);
    expect((env as { error?: { exitCode: number } }).error?.exitCode).toBe(3);
  });
});
