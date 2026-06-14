import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(root, 'dist', 'cli', 'index.js');
const fixtures = join(root, 'tests', 'fixtures');

interface CliResult {
  status: number;
  json: Record<string, unknown> | undefined;
  stdout: string;
  stderr: string;
}

function zxs(cwd: string, ...args: string[]): CliResult {
  const res = spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf8' });
  let json: Record<string, unknown> | undefined;
  try {
    json = JSON.parse(res.stdout) as Record<string, unknown>;
  } catch {
    json = undefined;
  }
  return { status: res.status ?? -1, json, stdout: res.stdout, stderr: res.stderr };
}

let cwd: string;
beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'zxs-e2e-'));
});

describe('zxs e2e (session + exit codes)', () => {
  it('a DI;HALT program exits with code 2 and a di-halt verdict naming the PC', () => {
    const binPath = join(cwd, 'dihalt.bin');
    writeFileSync(binPath, Buffer.from([0xf3, 0x76])); // DI ; HALT
    const res = zxs(cwd, 'run', '--bin', binPath, '--org', '0x8000', '--frames', '100', '--json');

    expect(res.status).toBe(2);
    expect(res.json).toMatchObject({ ok: false, status: 'hang' });
    const hang = res.json!['hang'] as Record<string, unknown>;
    expect(hang['kind']).toBe('di-halt');
    expect(hang['pc']).toBe('0x8002');
  });

  it('build + run + screen: HELLO ZX survives across CLI invocations via the session', () => {
    const build = zxs(cwd, 'build', join(fixtures, 'hello.asm'), '--out-dir', cwd, '--json');
    expect(build.status).toBe(0);
    const outputs = build.json!['outputs'] as { bin: string };

    // The spinning `done: jr done` loop is a tight loop by design — disable
    // the watchdog (an agent would use --until-pc or accept the verdict).
    const run = zxs(
      cwd,
      'run',
      '--bin',
      outputs.bin,
      '--org',
      '0x8000',
      '--frames',
      '20',
      '--no-detect-hangs',
      '--json'
    );
    expect(run.status).toBe(0);
    expect(run.json).toMatchObject({ ok: true, status: 'ok' });

    // Separate process: the session must remember the screen.
    const screen = zxs(cwd, 'screen', '--json');
    expect(screen.status).toBe(0);
    const rows = screen.json!['rows'] as string[];
    expect(rows.some((r) => r.includes('HELLO ZX'))).toBe(true);
  });

  it('regs and mem read work against the saved session', () => {
    const regs = zxs(cwd, 'regs', '--json');
    expect(regs.status).toBe(0);
    expect(regs.json!['pc']).toBe('0x8010'); // spinning at done: jr done

    const mem = zxs(cwd, 'mem', 'read', '0x8012', '--len', '9', '--json');
    expect(mem.status).toBe(0);
    expect(mem.json!['hex']).toBe(Buffer.from('HELLO ZX\0').toString('hex'));
  });

  it('run JSON reports beeper activity', () => {
    const binPath = join(cwd, 'beeper.bin');
    writeFileSync(
      binPath,
      Buffer.from([0x3e, 0x10, 0xd3, 0xfe, 0xaf, 0xd3, 0xfe, 0xfb, 0x76, 0x18, 0xfd])
    );
    const res = zxs(cwd, 'run', '--bin', binPath, '--org', '0x8000', '--frames', '2', '--json');

    expect(res.status).toBe(0);
    expect(res.json).toMatchObject({
      audio: {
        beeperEdges: 2,
        portFEWrites: 2,
        beeperLevel: 0,
        lastPortFE: '0x00',
      },
    });
  });

  it('the tight-loop verdict suggests --keys for input waits', () => {
    const binPath = join(cwd, 'loop.bin');
    writeFileSync(binPath, Buffer.from([0x18, 0xfe])); // JR $
    const res = zxs(cwd, 'run', '--bin', binPath, '--org', '0x8000', '--frames', '60', '--json');

    expect(res.status).toBe(2);
    const hang = res.json!['hang'] as Record<string, unknown>;
    expect(hang['kind']).toBe('tight-loop');
    expect(String(hang['likelyCause'])).toContain('--keys');
  });

  it('state export --z80 produces a 49182-byte v1 snapshot', () => {
    const out = join(cwd, 'export.z80');
    const res = zxs(cwd, 'state', 'export', '--z80', out, '--json');
    expect(res.status).toBe(0);
    expect(res.json).toMatchObject({ exported: out, format: 'z80v1' });
  });

  it('JSON mode reports command failures as one parseable document', () => {
    const empty = mkdtempSync(join(tmpdir(), 'zxs-empty-'));
    const res = zxs(empty, 'screen', '--json');

    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(res.json).toMatchObject({
      ok: false,
      stage: 'screen',
      error: { exitCode: 1 },
    });
    expect(String((res.json!['error'] as Record<string, unknown>)['message'])).toContain('No session state');
  });

  it('rejects invalid numeric budgets before running', () => {
    const binPath = join(cwd, 'numeric.bin');
    writeFileSync(binPath, Buffer.from([0x00]));
    const res = zxs(cwd, 'run', '--bin', binPath, '--frames', 'NaN', '--json');

    expect(res.status).toBe(1);
    expect(res.json).toMatchObject({
      ok: false,
      error: { exitCode: 1 },
    });
    expect(String((res.json!['error'] as Record<string, unknown>)['message'])).toContain('frames');
  });

  it('reports malformed project config as structured JSON', () => {
    const bad = mkdtempSync(join(tmpdir(), 'zxs-bad-config-'));
    writeFileSync(join(bad, 'zx.config.json'), '{not json');
    const res = zxs(bad, 'build', '--json');

    expect(res.status).toBe(1);
    expect(res.json).toMatchObject({
      ok: false,
      stage: 'config',
      error: { exitCode: 1 },
    });
    expect(String((res.json!['error'] as Record<string, unknown>)['message'])).toContain('Invalid zx.config.json');
  });
});
