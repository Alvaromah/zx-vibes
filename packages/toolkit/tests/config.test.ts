import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError, ExitCode } from '../src/output/envelope.js';
import {
  CONFIG_FILE,
  DEFAULT_ASSEMBLER,
  DEFAULT_ORG,
  DEFAULT_OUT_DIR,
  loadProjectConfig,
  normalizeAssembler,
  requireEntry,
  resolveConfig,
} from '../src/config/config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(contents: string): void {
  writeFileSync(join(dir, CONFIG_FILE), contents, 'utf8');
}

describe('loadProjectConfig (CFG-PROD-FILE-002/003)', () => {
  it('treats an absent config as empty (not an error)', () => {
    expect(loadProjectConfig(dir)).toEqual({});
  });

  it('parses a present, valid config', () => {
    writeConfig(JSON.stringify({ entry: 'src/main.asm', org: '0x6000' }));
    expect(loadProjectConfig(dir)).toEqual({ entry: 'src/main.asm', org: '0x6000' });
  });

  it('fails as a USER_ERROR naming the file on invalid JSON', () => {
    writeConfig('{ not json');
    try {
      loadProjectConfig(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
      expect((error as CliError).message).toContain(CONFIG_FILE);
    }
  });

  it('fails when the JSON is not an object', () => {
    writeConfig('[1,2,3]');
    expect(() => loadProjectConfig(dir)).toThrowError(/zx\.config\.json/);
  });
});

describe('normalizeAssembler (CFG-PROD-RESOLVE-002 / CFG-PROD-ERR-001)', () => {
  it('defaults empty/absent to builtin', () => {
    expect(normalizeAssembler(undefined)).toBe('builtin');
    expect(normalizeAssembler('')).toBe('builtin');
  });

  it('aliases legacy spectral to builtin (case-insensitive)', () => {
    expect(normalizeAssembler('spectral')).toBe('builtin');
    expect(normalizeAssembler('SPECTRAL')).toBe('builtin');
    expect(normalizeAssembler('Builtin')).toBe('builtin');
  });

  it('allows sjasmplus', () => {
    expect(normalizeAssembler('sjasmplus')).toBe('sjasmplus');
  });

  it('rejects an unknown backend as a USER_ERROR', () => {
    try {
      normalizeAssembler('nasm');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
    }
  });
});

describe('resolveConfig precedence (CFG-PROD-RESOLVE-001/003)', () => {
  it('applies built-in defaults with no config and no flags', () => {
    const resolved = resolveConfig({ cwd: dir, env: {} });
    expect(resolved.org).toBe(DEFAULT_ORG);
    expect(resolved.assembler).toBe(DEFAULT_ASSEMBLER);
    expect(resolved.outDir).toBe(DEFAULT_OUT_DIR);
    expect(resolved.entry).toBeUndefined();
  });

  it('config overrides defaults', () => {
    const config = { entry: 'a.asm', org: '0x7000', outDir: 'out', assembler: 'sjasmplus' };
    const resolved = resolveConfig({ config, env: {} });
    expect(resolved.entry).toBe('a.asm');
    expect(resolved.org).toBe('0x7000');
    expect(resolved.outDir).toBe('out');
    expect(resolved.assembler).toBe('sjasmplus');
  });

  it('env (ZXS_ASSEMBLER) overrides config for the assembler', () => {
    const resolved = resolveConfig({
      config: { assembler: 'sjasmplus' },
      env: { ZXS_ASSEMBLER: 'builtin' },
    });
    expect(resolved.assembler).toBe('builtin');
  });

  it('CLI flag overrides env and config (full precedence chain)', () => {
    const resolved = resolveConfig({
      config: { assembler: 'builtin', org: '0x1000', outDir: 'c' },
      env: { ZXS_ASSEMBLER: 'builtin' },
      flags: { assembler: 'sjasmplus', org: '0x9000', outDir: 'cli-out', entry: 'cli.asm' },
    });
    expect(resolved.assembler).toBe('sjasmplus');
    expect(resolved.org).toBe('0x9000');
    expect(resolved.outDir).toBe('cli-out');
    expect(resolved.entry).toBe('cli.asm');
  });

  it('treats legacy spectral in config as builtin', () => {
    expect(resolveConfig({ config: { assembler: 'spectral' }, env: {} }).assembler).toBe('builtin');
  });

  it('surfaces an unknown assembler from the config as a USER_ERROR', () => {
    expect(() => resolveConfig({ config: { assembler: 'nope' }, env: {} })).toThrowError(CliError);
  });
});

describe('requireEntry (CFG-PROD-ERR-002)', () => {
  it('returns the entry when present', () => {
    const resolved = resolveConfig({ config: { entry: 'main.asm' }, env: {} });
    expect(requireEntry(resolved)).toBe('main.asm');
  });

  it('throws a USER_ERROR when no entry resolves', () => {
    const resolved = resolveConfig({ cwd: dir, env: {} });
    try {
      requireEntry(resolved);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
      expect((error as CliError).stage).toBe('build');
    }
  });
});
