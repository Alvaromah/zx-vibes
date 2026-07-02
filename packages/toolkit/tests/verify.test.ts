// Verify pipeline integration — cli.md CLI-PROD-VERIFY-*, CLI-PROD-OUT-VERIFY-*,
// CLI-PROD-RULE-VERIFY-001, CLI-PROD-AC-VERIFY-001; toolkit-runtime.md RT-PROD-VERIFY-*,
// RT-PROD-EDGE-002. Exercises the full build -> run -> screenshot -> tests pipeline over
// real assembled projects, proving: the conjunction `ok`, the exit mapping (0/1/2), the
// build-failure short-circuit, the absent/empty `tests/` vacuous pass, the screenshot
// artifact, and — the load-bearing contract — that the embedded `run` report is BYTE-FOR-
// BYTE the same shape `zxs run --json` emits (CLI-PROD-RULE-VERIFY-001, not a re-impl).

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runVerify } from '../src/verify/verify.js';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtemp();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function mkdtemp(): string {
  const p = join(tmpdir(), `zxs-verify-${Math.random().toString(36).slice(2)}`);
  mkdirSync(p, { recursive: true });
  return p;
}

function write(rel: string, contents: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
}

/** Run `runCli` with cwd temporarily set to the project dir (verify reads config from cwd). */
async function cliInDir(argv: string[], streams: OutputStreams): Promise<number> {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return await runCli(argv, { streams });
  } finally {
    process.chdir(prev);
  }
}

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  return {
    streams: { out: (t) => o.push(t), err: (t) => e.push(t) },
    out: () => o.join(''),
    err: () => e.join(''),
  };
}

// --- programs --------------------------------------------------------------

// A clean HALT-synced game loop: border 2, write 0x2A to 0x9000, idle. status:"ok".
const OK_MAIN = [
  'ORG 0x8000',
  '  ld sp, 0xFF00',
  '  ld a, 2',
  '  out (0xFE), a',
  '  ld a, 0x2A',
  '  ld (0x9000), a',
  '  im 1',
  '  ei',
  'main:',
  '  halt',
  '  jr main',
  '',
].join('\n');

// DI:HALT — a DEFINITE di-halt hang (assembles fine; the run watchdog catches it).
const HANG_MAIN = ['ORG 0x8000', '  di', '  halt', ''].join('\n');

// A duplicate label — an assembly error (build stage fails).
const BAD_MAIN = ['ORG 0x8000', 'dup:', 'dup:', '  ret', ''].join('\n');

function project(main: string): void {
  write('zx.config.json', JSON.stringify({ entry: 'main.asm' }));
  write('main.asm', main);
}

/** Add a `tests/` suite whose single spec asserts the border equals `expected`. */
function testsAssertingBorder(expected: number): void {
  write('tests/probe.asm', OK_MAIN);
  write(
    'tests/probe.test.json',
    JSON.stringify({
      build: 'probe.asm',
      frames: 30,
      assert: [{ type: 'borderColor', equals: expected }],
    }),
  );
}

// ===========================================================================

describe('runVerify — passing project with a green test suite (RT-PROD-VERIFY-002)', () => {
  it('ok:true, embeds build+run+tests, writes the screenshot (CLI-PROD-OUT-VERIFY-001)', () => {
    project(OK_MAIN);
    testsAssertingBorder(2); // border IS 2 → the suite passes

    const env = runVerify({ cwd: dir });

    expect(env.ok).toBe(true);
    expect(env.stage).toBe('verify');
    expect(env.build.ok).toBe(true);
    // The embedded run report carries the full CLI-PROD-OUT-RUN-001 shape.
    expect(env.run).toBeDefined();
    expect(env.run?.ok).toBe(true);
    expect(env.run?.stage).toBe('run');
    expect(env.run?.status).toBe('ok');
    // The embedded test report passed.
    expect(env.tests).toBeDefined();
    expect(env.tests?.ok).toBe(true);
    expect(env.tests?.total).toBe(1);
    expect(env.tests?.failed).toBe(0);
    // The screenshot artifact was written to the default path.
    expect(env.screenshot).toBe('.zxs/verify-screen.png');
    expect(existsSync(join(dir, '.zxs/verify-screen.png'))).toBe(true);
  });
});

describe('runVerify — embeds the REAL run report shape (CLI-PROD-RULE-VERIFY-001)', () => {
  it('verify.run deep-equals `zxs run --json` for the same project (same composer)', async () => {
    project(OK_MAIN);

    const env = runVerify({ cwd: dir });
    expect(env.run).toBeDefined();

    // `zxs run` with no source builds the configured entry and runs 300 frames — the exact
    // path verify composes. Deterministic (RT-PROD-RULE-DET-001) → the two are identical.
    const cap = capture();
    const code = await cliInDir(['run', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const runEnv = JSON.parse(cap.out().trim());

    expect(env.run).toEqual(runEnv);
    // Spot-check the contract fields are all present (CLI-PROD-OUT-RUN-001).
    for (const key of [
      'stage',
      'status',
      'boot',
      'exit',
      'framesRun',
      'tstatesRun',
      'audio',
      'registers',
      'screen',
      'input',
    ]) {
      expect(runEnv).toHaveProperty(key);
    }
    expect(Number.isInteger(runEnv.audio.beeperEdges)).toBe(true);
    expect(runEnv.boot).toMatchObject({ source: 'build', org: 0x8000 });
  });
});

describe('runVerify — no tests/ directory passes on build+run alone (RT-PROD-EDGE-002)', () => {
  it('ok:true with run embedded and tests omitted', () => {
    project(OK_MAIN);
    const env = runVerify({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.run?.ok).toBe(true);
    expect(env.tests).toBeUndefined();
  });
});

describe('runVerify — empty tests/ directory passes vacuously (RT-PROD-EDGE-002)', () => {
  it('a tests dir with no specs → tests.total 0, ok:true', () => {
    project(OK_MAIN);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    const env = runVerify({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.tests).toBeDefined();
    expect(env.tests?.total).toBe(0);
    expect(env.tests?.failed).toBe(0);
  });
});

describe('runVerify — build failure short-circuits (RT-PROD-VERIFY-001 step 3 gate)', () => {
  it('ok:false, exit 1, NO run/tests/screenshot stage', () => {
    project(BAD_MAIN);
    const env = runVerify({ cwd: dir });
    expect(env.ok).toBe(false);
    expect(env.build.ok).toBe(false);
    expect(env.run).toBeUndefined();
    expect(env.tests).toBeUndefined();
    expect(env.screenshot).toBeUndefined();
    expect(env.ok === false && env.error.exitCode).toBe(ExitCode.USER_ERROR);
    // No run happened, so no screenshot was written.
    expect(existsSync(join(dir, '.zxs/verify-screen.png'))).toBe(false);
  });
});

describe('runVerify — a run-detected hang fails verify with exit 1 (CLI-PROD-OUT-VERIFY-002)', () => {
  it('ok:false, exit 1 (USER_ERROR); the hang stays observable in the embedded run report', () => {
    project(HANG_MAIN);
    const env = runVerify({ cwd: dir });
    expect(env.ok).toBe(false);
    expect(env.build.ok).toBe(true);
    // The hang is still fully visible inside the embedded run report (run.status + verdict)...
    expect(env.run?.ok).toBe(false);
    expect(env.run?.status).toBe('hang');
    // ...but verify's OWN exit code is 1, not 2 — exit 2 (HANG) is reserved for `run`
    // (CLI-PROD-EXIT-003); verify exits 0 on pass and 1 on any failure (CLI-PROD-OUT-VERIFY-002).
    expect(env.ok === false && env.error.exitCode).toBe(ExitCode.USER_ERROR);
  });
});

describe('runVerify — a failing test suite fails verify (RT-PROD-VERIFY-002/003)', () => {
  it('build+run ok but a failing spec → ok:false, exit 1 (USER_ERROR)', () => {
    project(OK_MAIN);
    testsAssertingBorder(5); // border is 2, not 5 → the suite fails

    const env = runVerify({ cwd: dir });
    expect(env.ok).toBe(false);
    expect(env.build.ok).toBe(true);
    expect(env.run?.ok).toBe(true);
    expect(env.tests?.ok).toBe(false);
    expect(env.tests?.failed).toBe(1);
    expect(env.ok === false && env.error.exitCode).toBe(ExitCode.USER_ERROR);
  });
});

// --- CLI end-to-end: the exit-code contract the verify-exit.json fixture asserts ---

describe('zxs verify --json — exit-code contract (CLI-PROD-AC-VERIFY-001 / verify-exit.json)', () => {
  it('pass: a green project exits 0 with { ok:true, stage:"verify" }', async () => {
    project(OK_MAIN);
    const cap = capture();
    const code = await cliInDir(['verify', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1); // a single JSON object, no human text (CLI-PROD-CONV-JSON-001)
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ ok: true, stage: 'verify' });
    expect(env.run.stage).toBe('run');
    expect(cap.err()).toBe('');
  });

  it('fail-build: an assembly error exits non-zero with { ok:false, stage:"verify" }', async () => {
    project(BAD_MAIN);
    const cap = capture();
    const code = await cliInDir(['verify', '--json'], cap.streams);
    expect(code).not.toBe(ExitCode.OK);
    expect(code).toBe(ExitCode.USER_ERROR);
    const env = JSON.parse(cap.out().trim());
    expect(env).toMatchObject({ ok: false, stage: 'verify' });
    expect(env.run).toBeUndefined();
  });

  it('run-hang: a DI:HALT project exits 1 (USER_ERROR), NOT 2 — exit 2 is reserved for `run`', async () => {
    project(HANG_MAIN);
    const cap = capture();
    const code = await cliInDir(['verify', '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(code).not.toBe(ExitCode.HANG);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    // The hang is still observable in the embedded run report, just not via verify's exit code.
    expect(env.run.status).toBe('hang');
  });

  it('test-fail: a failing suite exits 1 (USER_ERROR)', async () => {
    project(OK_MAIN);
    testsAssertingBorder(5);
    const cap = capture();
    const code = await cliInDir(['verify', '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    const env = JSON.parse(cap.out().trim());
    expect(env.ok).toBe(false);
    expect(env.tests.failed).toBe(1);
  });

  it('a custom --screenshot path is honored', async () => {
    project(OK_MAIN);
    const cap = capture();
    const code = await cliInDir(['verify', '--screenshot', 'shot.png', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env.screenshot).toBe('shot.png');
    expect(existsSync(join(dir, 'shot.png'))).toBe(true);
  });
});
