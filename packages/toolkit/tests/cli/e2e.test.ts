import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('build --sandbox blocks an INCLUDE that escapes the project, but not by default', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'zxs-sandbox-'));
    const project = join(projectRoot, 'project');
    mkdirSync(project);
    writeFileSync(join(projectRoot, 'secret.asm'), 'SECRET EQU 0x42\n'); // outside the project
    writeFileSync(join(project, 'main.asm'), '    ORG 0x8000\n    INCLUDE "../secret.asm"\n');

    // Run with cwd = project so the sandbox root is the project directory.
    const blocked = zxs(project, 'build', 'main.asm', '--out-dir', project, '--sandbox', '--json');
    expect(blocked.status).toBe(1);
    expect(blocked.json).toMatchObject({ ok: false });
    const errors = blocked.json!['errors'] as Array<{ message: string }>;
    expect(errors.some((e) => /outside the sandbox roots/.test(e.message))).toBe(true);

    // Without --sandbox the same source assembles fine (backward compatible).
    const allowed = zxs(project, 'build', 'main.asm', '--out-dir', project, '--json');
    expect(allowed.status).toBe(0);
    expect(allowed.json).toMatchObject({ ok: true });
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

  it('run --no-save/--read-only does not create session state and can emit WAV audio', () => {
    const ro = mkdtempSync(join(tmpdir(), 'zxs-readonly-'));
    const binPath = join(ro, 'beeper.bin');
    const wavPath = join(ro, 'sound.wav');
    writeFileSync(
      binPath,
      Buffer.from([0x3e, 0x10, 0xd3, 0xfe, 0xaf, 0xd3, 0xfe, 0x18, 0xfe])
    );
    const res = zxs(
      ro,
      'run',
      '--bin',
      binPath,
      '--org',
      '0x8000',
      '--frames',
      '2',
      '--no-detect-hangs',
      '--read-only',
      '--wav',
      wavPath,
      '--json'
    );

    expect(res.status).toBe(0);
    expect(existsSync(join(ro, '.zxs', 'state.zxstate'))).toBe(false);
    expect(existsSync(wavPath)).toBe(true);
    expect(readFileSync(wavPath).subarray(0, 4).toString()).toBe('RIFF');
    const audio = res.json!['audio'] as Record<string, unknown>;
    expect(audio['beeperEdges']).toBe(2);
    expect(Array.isArray(audio['edgeTimeline'])).toBe(true);
    expect(audio['wav']).toBe(wavPath);
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

    const info = zxs(cwd, 'snapshot', 'info', out, '--json');
    expect(info.status).toBe(0);
    expect(info.json).toMatchObject({ ok: true, format: 'z80', version: '1', supported: true });

    const ram = join(cwd, 'ram.bin');
    const ramRes = zxs(cwd, 'snapshot', 'ram', out, '--out', ram, '--json');
    expect(ramRes.status).toBe(0);
    expect(readFileSync(ram).length).toBe(49152);

    const mem = zxs(cwd, 'snapshot', 'mem', out, '0x8000', '--len', '4', '--json');
    expect(mem.status).toBe(0);
    expect(mem.json).toMatchObject({ addr: '0x8000', len: 4 });

    const dump = join(cwd, 'screen.bin');
    const dumpRes = zxs(cwd, 'mem', 'dump', '--z80', out, '--range', '0x4000-0x5aff', '--out', dump, '--json');
    expect(dumpRes.status).toBe(0);
    expect(readFileSync(dump).length).toBe(0x1b00);

    const png = join(cwd, 'screen.png');
    const gfx = zxs(cwd, 'gfx', 'screen', '--z80', out, '--out', png, '--json');
    expect(gfx.status).toBe(0);
    expect(readFileSync(png).subarray(1, 4).toString()).toBe('PNG');
  });

  it('test --list-assertions exposes the assertion vocabulary', () => {
    const res = zxs(cwd, 'test', '--list-assertions', '--json');
    expect(res.status).toBe(0);
    const assertions = res.json!['assertions'] as { type: string }[];
    expect(assertions.map((a) => a.type)).toContain('attrNonBlank');
    expect(assertions.map((a) => a.type)).toContain('beeperEdges');
  });

  it('scan and xref work directly from a read-only binary source', () => {
    const binPath = join(cwd, 'static.bin');
    writeFileSync(binPath, Buffer.from([0xcd, 0x10, 0x00, 0xed, 0xb0, 0x18, 0xfe]));

    const scan = zxs(cwd, 'scan', '--bin', binPath, '--org', '0x8000', '--opcode', 'ED B0', '--json');
    expect(scan.status).toBe(0);
    const scanHits = scan.json!['hits'] as { addr: string }[];
    expect(scanHits.some((h) => h.addr === '0x8003')).toBe(true);

    const xref = zxs(cwd, 'xref', '0x0010', '--bin', binPath, '--org', '0x8000', '--json');
    expect(xref.status).toBe(0);
    const xrefHits = xref.json!['hits'] as { text: string }[];
    expect(xrefHits.some((h) => h.text === 'CALL 0x0010')).toBe(true);
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
