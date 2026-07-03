// Scaffold command group (Slice 9) — cli.md CLI-PROD-NEW-001 + CLI-PROD-OUT-NEW-001,
// CLI-PROD-INIT-001 + CLI-PROD-EDGE-004, CLI-PROD-CLEAN-001. Proves the load-bearing
// contract: `new` scaffolds a project whose `build`+`verify` PASS (assemble + run clean
// + green smoke suite); `init` lays the contract into an existing dir non-destructively
// (idempotent, never clobbers a present file unless `--force`); `clean` removes
// `build/`/`.zxs/`, reports them, and is a success no-op when absent.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNew, runInit, runClean } from '../src/scaffold/scaffold.js';
import { runBuild } from '../src/build/build.js';
import { runVerify } from '../src/verify/verify.js';
import { runTestSuite } from '../src/test/runner.js';
import { runCli } from '../src/cli.js';
import { CliError, ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-scaffold-'));
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

/** Run `runCli` with cwd temporarily set to `cwd` (commands read config/paths from cwd). */
async function cliInDir(cwd: string, argv: string[], streams: OutputStreams): Promise<number> {
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    return await runCli(argv, { streams });
  } finally {
    process.chdir(prev);
  }
}

// ===========================================================================
// new
// ===========================================================================

describe('runNew — scaffolds a verify-passing, playable project (CLI-PROD-NEW-001)', () => {
  it('writes a real game project (src + shared lib) and reports the new envelope', () => {
    const env = runNew({ name: 'demo', cwd: dir });

    expect(env.ok).toBe(true);
    expect(env.stage).toBe('new');
    expect(env.name).toBe('demo');
    expect(env.dir).toBe('demo');
    expect(env.template).toBe('game');
    expect(env.files).toContain('zx.config.json');
    expect(env.files).toContain('src/main.asm');
    expect(env.files).toContain('lib/screen.asm');
    expect(env.files).toContain('lib/keys.asm');
    expect(env.files).toContain('tests/smoke.test.json');
    expect(env.files).toContain('AGENTS.md');
    expect(env.files).toContain('CLAUDE.md');

    const proj = join(dir, 'demo');
    expect(existsSync(join(proj, 'src', 'main.asm'))).toBe(true);
    expect(existsSync(join(proj, 'lib', 'screen.asm'))).toBe(true);
    // The entry is the real QAOP-ship game with `__NAME__` substituted for the project name.
    const main = readFileSync(join(proj, 'src', 'main.asm'), 'utf8');
    expect(main).toContain('read_qaop');
    expect(main).toContain('demo');
    expect(main).not.toContain('__NAME__');
    // The smoke suite builds and asserts the ACTUAL entry, not a self-contained stub.
    const smoke = JSON.parse(readFileSync(join(proj, 'tests', 'smoke.test.json'), 'utf8'));
    expect(smoke.build).toBe('../src/main.asm');
    // The generated config is valid per config-schema (entry + builtin assembler).
    const config = JSON.parse(readFileSync(join(proj, 'zx.config.json'), 'utf8'));
    expect(config).toMatchObject({ entry: 'src/main.asm', assembler: 'builtin', template: 'game' });
  });

  it('the generated GAME project BUILDS and VERIFIES green (assemble + run + smoke tests)', () => {
    runNew({ name: 'demo', cwd: dir });
    const proj = join(dir, 'demo');

    const build = runBuild({ cwd: proj, env: {} });
    expect(build.ok).toBe(true);

    const v = runVerify({ cwd: proj });
    expect(v.ok).toBe(true);
    expect(v.build.ok).toBe(true);
    expect(v.run?.status).toBe('ok');
    expect(v.tests?.ok).toBe(true);
    expect(v.tests?.total).toBe(1);
    expect(v.tests?.failed).toBe(0);
  });

  it('--template platformer emits distinct content that ALSO verifies green', () => {
    const env = runNew({ name: 'plat', cwd: dir, template: 'platformer' });
    expect(env.template).toBe('platformer');
    const proj = join(dir, 'plat');

    const config = JSON.parse(readFileSync(join(proj, 'zx.config.json'), 'utf8'));
    expect(config.template).toBe('platformer');
    // Genuinely different program from the default game (jump mechanic, not a QAOP ship).
    const main = readFileSync(join(proj, 'src', 'main.asm'), 'utf8');
    expect(main).toContain('jump_or_gravity');
    expect(main).not.toContain('sprite_xor_64x64');

    const v = runVerify({ cwd: proj });
    expect(v.ok).toBe(true);
    expect(v.run?.status).toBe('ok');
    expect(v.tests?.failed).toBe(0);
  });
});

describe('runNew — failure cases (CLI-PROD-OUT-NEW-001 → exit 1)', () => {
  it('fails (USER_ERROR) when the target directory already exists', () => {
    mkdirSync(join(dir, 'demo'));
    try {
      runNew({ name: 'demo', cwd: dir });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
      expect((error as CliError).stage).toBe('new');
    }
  });

  it('rejects an invalid project name (USER_ERROR)', () => {
    for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'has space', 'bad?name']) {
      expect(() => runNew({ name: bad, cwd: dir })).toThrowError(CliError);
    }
  });

  it('accepts a name with hyphen / underscore / dot', () => {
    expect(runNew({ name: 'my-game_v1.2', cwd: dir }).ok).toBe(true);
    expect(existsSync(join(dir, 'my-game_v1.2', 'zx.config.json'))).toBe(true);
  });

  it('rejects an unknown --template (USER_ERROR) and creates nothing', () => {
    try {
      runNew({ name: 'demo', cwd: dir, template: 'roguelike' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
      expect((error as CliError).stage).toBe('new');
    }
    expect(existsSync(join(dir, 'demo'))).toBe(false);
  });
});

// ===========================================================================
// init
// ===========================================================================

describe('runInit — non-destructive onboarding (CLI-PROD-INIT-001 / CLI-PROD-EDGE-004)', () => {
  it('adds the toolkit contract files to an existing dir without failing', () => {
    const env = runInit({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('init');
    expect(env.force).toBe(false);
    expect(env.created).toContain('zx.config.json');
    expect(env.created).toContain('tests/smoke.test.json');
    expect(env.created).toContain('AGENTS.md');
    expect(env.created).toContain('CLAUDE.md');
    expect(env.skipped).toEqual([]);
    // It does NOT create a project entry (init onboards a repo with its own sources).
    expect(existsSync(join(dir, 'src', 'main.asm'))).toBe(false);
  });

  it('does not clobber an existing zx.config.json (reports it skipped)', () => {
    const custom = JSON.stringify({ entry: 'mine.asm', name: 'keepme' });
    writeFileSync(join(dir, 'zx.config.json'), custom, 'utf8');

    const env = runInit({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.skipped).toContain('zx.config.json');
    expect(env.created).not.toContain('zx.config.json');
    // The user's file is untouched on disk.
    expect(readFileSync(join(dir, 'zx.config.json'), 'utf8')).toBe(custom);
  });

  it('--force overwrites managed files', () => {
    writeFileSync(join(dir, 'zx.config.json'), '{"entry":"mine.asm"}', 'utf8');
    const env = runInit({ cwd: dir, force: true });
    expect(env.force).toBe(true);
    expect(env.created).toContain('zx.config.json');
    expect(env.skipped).toEqual([]);
    expect(readFileSync(join(dir, 'zx.config.json'), 'utf8')).toContain('@zx-vibes/toolkit');
  });

  it('is idempotent: a second run skips everything it already wrote', () => {
    const first = runInit({ cwd: dir });
    expect(first.created.length).toBeGreaterThan(0);
    const second = runInit({ cwd: dir });
    expect(second.created).toEqual([]);
    expect(second.skipped.length).toBe(first.created.length);
  });

  it('the smoke suite it lays down passes on its own (toolchain proof)', () => {
    runInit({ cwd: dir });
    const suite = runTestSuite('tests', dir);
    expect(suite.ok).toBe(true);
    expect(suite.total).toBe(1);
    expect(suite.failed).toBe(0);
  });
});

// ===========================================================================
// clean
// ===========================================================================

describe('runClean — removes artifacts, reports them (CLI-PROD-CLEAN-001)', () => {
  it('removes build/ and .zxs/ and lists them in removed[]', () => {
    mkdirSync(join(dir, 'build'), { recursive: true });
    writeFileSync(join(dir, 'build', 'main.bin'), 'x');
    mkdirSync(join(dir, '.zxs'), { recursive: true });
    writeFileSync(join(dir, '.zxs', 'debug.json'), '{}');

    const env = runClean({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('clean');
    expect([...env.removed].sort()).toEqual(['.zxs', 'build']);
    expect(existsSync(join(dir, 'build'))).toBe(false);
    expect(existsSync(join(dir, '.zxs'))).toBe(false);
  });

  it('is a success no-op when nothing exists (absence is not an error)', () => {
    const env = runClean({ cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.removed).toEqual([]);
  });

  it('removes a custom outDir configured in zx.config.json', () => {
    writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ outDir: 'dist' }), 'utf8');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'a.bin'), 'a');

    const env = runClean({ cwd: dir });
    expect(env.removed).toContain('dist');
    expect(existsSync(join(dir, 'dist'))).toBe(false);
  });
});

// ===========================================================================
// CLI end-to-end
// ===========================================================================

describe('zxs new / verify / clean — CLI end-to-end', () => {
  it('new demo --json exits 0; verify in demo exits 0; clean --json exits 0', async () => {
    const cap1 = capture();
    const code1 = await cliInDir(dir, ['new', 'demo', '--json'], cap1.streams);
    expect(code1).toBe(ExitCode.OK);
    const lines = cap1.out().trim().split('\n');
    expect(lines).toHaveLength(1); // a single JSON object, no human text
    const env1 = JSON.parse(lines[0]!);
    expect(env1).toMatchObject({ ok: true, stage: 'new', name: 'demo' });
    expect(cap1.err()).toBe('');

    const proj = join(dir, 'demo');
    const cap2 = capture();
    const code2 = await cliInDir(proj, ['verify', '--json'], cap2.streams);
    expect(code2).toBe(ExitCode.OK);
    expect(JSON.parse(cap2.out().trim())).toMatchObject({ ok: true, stage: 'verify' });

    // verify wrote build/ + .zxs/verify-screen.png; clean removes both.
    const cap3 = capture();
    const code3 = await cliInDir(proj, ['clean', '--json'], cap3.streams);
    expect(code3).toBe(ExitCode.OK);
    const env3 = JSON.parse(cap3.out().trim());
    expect(env3).toMatchObject({ ok: true, stage: 'clean' });
    expect(env3.removed).toContain('.zxs');
    expect(env3.removed).toContain('build');
  });

  it('new <existing> --json exits 1 (USER_ERROR)', async () => {
    mkdirSync(join(dir, 'demo'));
    const cap = capture();
    const code = await cliInDir(dir, ['new', 'demo', '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim())).toMatchObject({ ok: false, stage: 'new' });
  });

  it('init --json onboards the current dir and exits 0', async () => {
    const cap = capture();
    const code = await cliInDir(dir, ['init', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const env = JSON.parse(cap.out().trim());
    expect(env).toMatchObject({ ok: true, stage: 'init' });
    expect(existsSync(join(dir, 'zx.config.json'))).toBe(true);
  });
});
