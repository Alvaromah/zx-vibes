import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBuild } from '../src/build/build.js';
import { runCli } from '../src/cli.js';
import { CliError, ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-build-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, contents: string): void {
  writeFileSync(join(dir, name), contents, 'utf8');
}

const GOOD_ASM = ['ORG 0x8000', 'start:', '  ld a, 1', '  ret', ''].join('\n');
// Two identical labels at the same scope -> a deterministic "Duplicate label"
// error (a non-directive name, so it is not mistaken for DUP/REPT).
const BAD_ASM = ['ORG 0x8000', 'lbl:', 'lbl:', '  ret', ''].join('\n');

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    streams: { out: (t) => outChunks.push(t), err: (t) => errChunks.push(t) },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

describe('runBuild — success (CLI-PROD-OUT-BUILD-001 / RT-PROD-BUILD-001)', () => {
  it('assembles a tiny .asm to .bin + .sld and reports the build envelope', () => {
    write('main.asm', GOOD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', env: {} });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe('build');
    expect(result.entry).toBe('main.asm');
    expect(result.errorCount).toBe(0);
    expect(result.errors).toEqual([]);
    expect(typeof result.durationMs).toBe('number');

    // outputs.{bin,sld} are portable relative paths and exist on disk.
    expect(result.outputs.bin).toBe('build/main.bin');
    expect(result.outputs.sld).toBe('build/main.sld');
    expect(Array.isArray(result.outputs.artifacts)).toBe(true);
    expect(existsSync(join(dir, 'build', 'main.bin'))).toBe(true);
    expect(existsSync(join(dir, 'build', 'main.sld'))).toBe(true);
    expect(readFileSync(join(dir, 'build', 'main.bin')).length).toBeGreaterThan(0);
  });

  it('honors --out-dir', () => {
    write('main.asm', GOOD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', outDir: 'dist', env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.bin).toBe('dist/main.bin');
    expect(existsSync(join(dir, 'dist', 'main.bin'))).toBe(true);
  });
});

describe('runBuild — assembly failure maps to the DNA diagnostic shape (ERR-PROD-ASM-*)', () => {
  it('returns ok:false with exit-1 error + per-diagnostic {file,line,severity,message}', () => {
    write('main.asm', BAD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', env: {} });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe('build');
    if (result.ok) throw new Error('expected failure');
    expect(result.error.exitCode).toBe(ExitCode.USER_ERROR);
    expect(result.errorCount).toBeGreaterThanOrEqual(1);
    expect(result.outputs).toEqual({ bin: null, sld: null, artifacts: [] });

    const diag = result.errors[0]!;
    // ERR-PROD-ASM-SHAPE-001: { file, line, severity, message, sourceLine?, hint? }.
    expect(diag.severity).toBe('error');
    expect(typeof diag.message).toBe('string');
    expect(typeof diag.line).toBe('number');
    // file is a portable (relative, forward-slash) path naming the entry.
    expect(diag.file).toBe('main.asm');
    expect(diag.file).not.toContain('\\');

    // No artifacts are written on a failed build.
    expect(existsSync(join(dir, 'build', 'main.bin'))).toBe(false);
  });
});

describe('runBuild — assembler resolution (CFG-PROD-ERR-001 / CFG-PROD-RESOLVE-002)', () => {
  it('treats legacy "spectral" as the builtin assembler (assembles successfully)', () => {
    write('main.asm', GOOD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', assembler: 'spectral', env: {} });
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, 'build', 'main.bin'))).toBe(true);
  });

  it('rejects an unknown assembler backend as a USER_ERROR (exit 1)', () => {
    write('main.asm', GOOD_ASM);
    try {
      runBuild({ cwd: dir, entry: 'main.asm', assembler: 'nasm', env: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
    }
  });

  it('selecting the external "sjasmplus" backend is an ENV_ERROR (exit 3)', () => {
    write('main.asm', GOOD_ASM);
    try {
      runBuild({ cwd: dir, entry: 'main.asm', assembler: 'sjasmplus', env: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.ENV_ERROR);
    }
  });
});

describe('runBuild — required entry (CFG-PROD-ERR-002)', () => {
  it('throws a USER_ERROR (stage build) when no entry resolves', () => {
    try {
      runBuild({ cwd: dir, env: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
      expect((error as CliError).stage).toBe('build');
    }
  });
});

describe('runBuild — loadable-format seam now emits (CLI-PROD-BUILD-003, Slice 8a)', () => {
  it('a requested --tap is emitted beside the binary and listed in outputs.artifacts', () => {
    write('main.asm', GOOD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', formats: { tap: true }, env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toContain('build/main.tap');
    expect(existsSync(join(dir, 'build', 'main.tap'))).toBe(true);
  });

  it('a build without format flags succeeds (default bin+sld only)', () => {
    write('main.asm', GOOD_ASM);
    const result = runBuild({ cwd: dir, entry: 'main.asm', env: {} });
    expect(result.ok).toBe(true);
    expect(result.outputs.artifacts).toEqual([]);
  });
});

describe('zxs build — CLI wiring end-to-end (CLI-PROD-CONV-JSON-001)', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
  });

  it('build <file> --json prints a single success envelope and exits 0', async () => {
    write('main.asm', GOOD_ASM);
    const cap = capture();
    const code = await runCli(['build', 'main.asm', '--json'], { streams: cap.streams });
    expect(code).toBe(0);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    const envelope = JSON.parse(lines[0]!);
    expect(envelope).toMatchObject({ ok: true, stage: 'build', entry: 'main.asm' });
    expect(envelope.outputs.bin).toBe('build/main.bin');
    expect(cap.err()).toBe('');
  });

  it('build <bad-file> --json exits 1 with an ok:false build envelope', async () => {
    write('main.asm', BAD_ASM);
    const cap = capture();
    const code = await runCli(['build', 'main.asm', '--json'], { streams: cap.streams });
    expect(code).toBe(1);
    const envelope = JSON.parse(cap.out().trim());
    expect(envelope).toMatchObject({ ok: false, stage: 'build', error: { exitCode: 1 } });
    expect(envelope.errorCount).toBeGreaterThanOrEqual(1);
    expect(envelope.errors[0]).toMatchObject({ severity: 'error' });
  });
});
