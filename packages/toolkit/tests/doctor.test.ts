// `doctor` environment self-check (Slice 11a) — cli.md CLI-PROD-DOCTOR-001 +
// CLI-PROD-OUT-DOCTOR-001; errors.md ERR-PROD-ENV-001. Proves the contract: all
// checks pass in a healthy env → exit 0; ANY check fails → exit 3 (ENV_ERROR), with
// the failing check surfaced in `checks[]` (never silently swallowed).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor, MIN_NODE_MAJOR } from '../src/doctor/doctor.js';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';
import { ROM_SIZE } from '../src/runtime/rom.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-doctor-'));
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

describe('runDoctor — healthy environment (CLI-PROD-DOCTOR-001 → exit 0)', () => {
  it('all checks pass and the envelope is { ok:true, stage:"doctor", checks:[…] }', () => {
    const env = runDoctor({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('doctor');
    expect(Array.isArray(env.checks)).toBe(true);
    expect(env.checks.every((c) => c.ok)).toBe(true);
    // The default (builtin) config checks node + asm + rom (no sjasmplus by default).
    const names = env.checks.map((c) => c.name).sort();
    expect(names).toEqual(['asm', 'node', 'rom']);
    for (const c of env.checks) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.detail).toBe('string');
    }
  });
});

describe('runDoctor — forced failures (ERR-PROD-ENV-001 → exit 3)', () => {
  it('a missing ROM fails the rom check → ENV_ERROR (exit 3)', () => {
    const missing = join(dir, 'does-not-exist.rom');
    const env = runDoctor({ cwd: dir, romPath: missing });
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    const rom = env.checks.find((c) => c.name === 'rom');
    expect(rom?.ok).toBe(false);
  });

  it('a mis-sized ROM fails the rom check → exit 3', () => {
    const badRom = join(dir, 'bad.rom');
    writeFileSync(badRom, Buffer.alloc(ROM_SIZE - 1)); // one byte short
    const env = runDoctor({ cwd: dir, romPath: badRom });
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    expect(env.checks.find((c) => c.name === 'rom')?.ok).toBe(false);
  });

  it('Node below the floor fails the node check → exit 3', () => {
    const env = runDoctor({ cwd: dir, nodeVersion: `${MIN_NODE_MAJOR - 2}.5.0` });
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    expect(env.checks.find((c) => c.name === 'node')?.ok).toBe(false);
  });

  it('an un-importable @zx-vibes/asm fails the asm check → exit 3', () => {
    const env = runDoctor({ cwd: dir, checkAsm: () => false });
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    expect(env.checks.find((c) => c.name === 'asm')?.ok).toBe(false);
  });
});

describe('runDoctor — sjasmplus only when configured (CLI-PROD-DOCTOR-001 / ADR-0027 D3)', () => {
  it('does NOT check sjasmplus under the default builtin backend', () => {
    const env = runDoctor({ cwd: dir });
    expect(env.checks.some((c) => c.name === 'sjasmplus')).toBe(false);
  });

  it('checks sjasmplus when it is the configured backend, failing when absent', () => {
    const env = runDoctor({
      cwd: dir,
      config: { assembler: 'sjasmplus' },
      checkSjasmplus: () => false,
    });
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.exitCode).toBe(ExitCode.ENV_ERROR);
    expect(env.checks.find((c) => c.name === 'sjasmplus')?.ok).toBe(false);
    // It does NOT probe the embedded asm when the external backend is configured.
    expect(env.checks.some((c) => c.name === 'asm')).toBe(false);
  });

  it('passes when the configured sjasmplus is available', () => {
    const env = runDoctor({
      cwd: dir,
      config: { assembler: 'sjasmplus' },
      checkSjasmplus: () => true,
    });
    expect(env.ok).toBe(true);
    expect(env.checks.find((c) => c.name === 'sjasmplus')?.ok).toBe(true);
  });
});

describe('zxs doctor --json — CLI end-to-end', () => {
  it('exits 0 in this healthy env and prints a single JSON object', async () => {
    const cap = capture();
    const code = await runCli(['doctor', '--json'], { streams: cap.streams });
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1); // a single JSON object, no human text
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ ok: true, stage: 'doctor' });
    expect(Array.isArray(env.checks)).toBe(true);
    expect(cap.err()).toBe('');
  });
});
