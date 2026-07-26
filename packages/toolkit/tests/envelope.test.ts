import { describe, expect, it } from 'vitest';
import {
  CliError,
  ExitCode,
  categoryExitCode,
  defaultStreams,
  envError,
  errorEnvelope,
  hangError,
  printEnvelope,
  successEnvelope,
  toErrorEnvelope,
  userError,
  type OutputStreams,
} from '../src/output/envelope.js';

function captureStreams(): { streams: OutputStreams; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    streams: { out: (t) => out.push(t), err: (t) => err.push(t) },
    out,
    err,
  };
}

describe('exit-code model (ERR-PROD-EXIT-001 / CLI-PROD-EXIT-00x)', () => {
  it('enumerates 0=OK / 1=USER_ERROR / 2=HANG / 3=ENV_ERROR', () => {
    expect(ExitCode.OK).toBe(0);
    expect(ExitCode.USER_ERROR).toBe(1);
    expect(ExitCode.HANG).toBe(2);
    expect(ExitCode.ENV_ERROR).toBe(3);
  });

  it('maps error categories to exit codes', () => {
    expect(categoryExitCode('user')).toBe(ExitCode.USER_ERROR);
    expect(categoryExitCode('hang')).toBe(ExitCode.HANG);
    expect(categoryExitCode('env')).toBe(ExitCode.ENV_ERROR);
  });

  it('builds typed CliErrors via the helpers', () => {
    expect(userError('bad').exitCode).toBe(ExitCode.USER_ERROR);
    expect(envError('toolchain').exitCode).toBe(ExitCode.ENV_ERROR);
    expect(hangError('stuck').exitCode).toBe(ExitCode.HANG);
    expect(userError('x', 'build')).toBeInstanceOf(CliError);
    expect(userError('x', 'build').stage).toBe('build');
  });
});

describe('envelope shapes (CLI-PROD-CONV-JSON-002 / ERR-PROD-CLIERR-001)', () => {
  it('success envelope carries ok:true + stage + extra fields', () => {
    const env = successEnvelope('version', { version: '1.2.3' });
    expect(env).toEqual({ ok: true, stage: 'version', version: '1.2.3' });
  });

  it('error envelope is { ok:false, stage, error:{ message, exitCode } }', () => {
    const env = errorEnvelope('build', 'boom', ExitCode.USER_ERROR);
    expect(env).toEqual({
      ok: false,
      stage: 'build',
      error: { message: 'boom', exitCode: 1 },
    });
  });

  it('maps a thrown CliError to an envelope, preserving its stage + code', () => {
    const env = toErrorEnvelope(envError('no node', 'doctor'), 'cli');
    expect(env).toEqual({
      ok: false,
      stage: 'doctor',
      error: { message: 'no node', exitCode: 3 },
    });
  });

  it('treats an unknown thrown value as a USER_ERROR (no silent swallow)', () => {
    expect(toErrorEnvelope(new Error('plain'), 'run')).toEqual({
      ok: false,
      stage: 'run',
      error: { message: 'plain', exitCode: 1 },
    });
    expect(toErrorEnvelope('weird', 'run').error.exitCode).toBe(1);
  });

  it('falls back to the active stage when the error carries none', () => {
    expect(toErrorEnvelope(userError('x'), 'build').stage).toBe('build');
  });
});

describe('printEnvelope (CLI-PROD-CONV-JSON-001 — one printer)', () => {
  it('prints a single JSON object and nothing else in --json mode', () => {
    const { streams, out, err } = captureStreams();
    printEnvelope(successEnvelope('version', { version: '9' }), { json: true, streams });
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(0);
    expect(JSON.parse(out[0] as string)).toEqual({ ok: true, stage: 'version', version: '9' });
  });

  it('routes a success line to stdout in human mode', () => {
    const { streams, out, err } = captureStreams();
    printEnvelope(successEnvelope('version', { version: '9' }), { json: false, streams });
    expect(out.join('')).toContain('version');
    expect(err).toHaveLength(0);
  });

  it('summarizes bulk payload fields instead of dumping them (CLI-PROD-FREE-001)', () => {
    const { streams, out } = captureStreams();
    // The reported case: `zxs setup --agent codex` printed 27 absolute paths.
    printEnvelope(
      successEnvelope('setup', {
        agent: 'codex',
        global: false,
        installed: Array.from({ length: 27 }, (_, i) => `.codex/zx-vibes/f${i}.md`),
        skipped: ['AGENTS.md'],
        next: ['zxs verify --json', 'restart Codex'],
      }),
      { json: false, streams },
    );
    const line = out.join('').trim();
    expect(line).toBe('setup: agent=codex global=false installed=27 skipped=1 next=2');
    expect(line).not.toContain('.codex/zx-vibes/f0.md');
    expect(line.length).toBeLessThan(120);
  });

  it('reports the verdict, not just a count, for ok-bearing lists', () => {
    const { streams, out } = captureStreams();
    // `doctor` checks: a bare count would hide the only fact worth reading.
    printEnvelope(
      successEnvelope('doctor', {
        checks: [
          { name: 'node', ok: true }, { name: 'asm', ok: true },
          { name: 'rom', ok: true }, { name: 'zxs-path', ok: true },
        ],
      }),
      { json: false, streams },
    );
    expect(out.join('').trim()).toBe('doctor: checks=4/4 ok');

    const { streams: s2, out: o2 } = captureStreams();
    printEnvelope(
      successEnvelope('test', {
        total: 3,
        results: [{ ok: true }, { ok: false }, { ok: true }],
      }),
      { json: false, streams: s2 },
    );
    expect(o2.join('').trim()).toBe('test: total=3 results=2/3 ok');
  });

  it('keeps scalars inline and drops empty bulk lists', () => {
    const { streams, out } = captureStreams();
    printEnvelope(
      successEnvelope('new', {
        name: 'pong',
        dir: 'pong',
        template: 'game',
        files: ['a', 'b', 'c'],
        errors: [],
        next: ['cd pong'],
      }),
      { json: false, streams },
    );
    expect(out.join('').trim()).toBe(
      'new: name=pong dir=pong template=game files=3 next=1',
    );
  });

  it('keeps a small structured record inline — the build output paths matter', () => {
    const { streams, out } = captureStreams();
    printEnvelope(
      successEnvelope('build', {
        entry: 'src/main.asm',
        outputs: { bin: 'build/main.bin', sld: 'build/main.sld', artifacts: [] },
      }),
      { json: false, streams },
    );
    // `outputs` is NOT summarized: "where did my binary go?" is the point of the line.
    expect(out.join('').trim()).toContain('build/main.bin');
  });

  it('leaves --json byte-identical while human mode summarizes', () => {
    const payload = { installed: ['a', 'b'], next: ['x'] };
    const { streams: js, out: jsonOut } = captureStreams();
    printEnvelope(successEnvelope('setup', payload), { json: true, streams: js });
    // The machine channel still carries every path (CLI-PROD-CONV-JSON-001).
    expect(JSON.parse(jsonOut[0] as string)).toEqual({
      ok: true, stage: 'setup', installed: ['a', 'b'], next: ['x'],
    });
  });

  it('collapses nested envelopes to their verdict (the verify gate line)', () => {
    const { streams, out } = captureStreams();
    printEnvelope(
      successEnvelope('verify', {
        build: { ok: true, stage: 'build', entry: 'src/main.asm', errors: [] },
        run: { ok: true, stage: 'run', status: 'ok', registers: { pc: 1 } },
        tests: { ok: false, stage: 'test', total: 2, passed: 1 },
        screenshot: '.zxs/verify-screen.png',
      }),
      { json: false, streams },
    );
    expect(out.join('').trim()).toBe(
      'verify: build=ok run=ok tests=failed screenshot=.zxs/verify-screen.png',
    );
  });

  it('truncates an oversized non-bulk object rather than swamping the line', () => {
    const { streams, out } = captureStreams();
    printEnvelope(
      successEnvelope('run', { registers: Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`r${i}`, i]),
      ) }),
      { json: false, streams },
    );
    const line = out.join('').trim();
    expect(line).toContain('…');
    expect(line.length).toBeLessThan(160);
  });

  it('routes an error line to stderr in human mode', () => {
    const { streams, out, err } = captureStreams();
    printEnvelope(errorEnvelope('build', 'kaboom', ExitCode.USER_ERROR), { json: false, streams });
    expect(out).toHaveLength(0);
    expect(err.join('')).toContain('kaboom');
  });

  it('exposes default stdout/stderr sinks', () => {
    expect(typeof defaultStreams.out).toBe('function');
    expect(typeof defaultStreams.err).toBe('function');
  });
});
