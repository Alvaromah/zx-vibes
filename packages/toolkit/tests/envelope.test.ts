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
