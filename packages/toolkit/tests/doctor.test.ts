// `doctor` environment self-check (Slice 11a) — cli.md CLI-PROD-DOCTOR-001 +
// CLI-PROD-OUT-DOCTOR-001; errors.md ERR-PROD-ENV-001. Proves the contract: all
// checks pass in a healthy env → exit 0; ANY check fails → exit 3 (ENV_ERROR), with
// the failing check surfaced in `checks[]` (never silently swallowed).

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkZxsPath,
  runDoctor,
  MIN_NODE_MAJOR,
} from '../src/doctor/doctor.js';
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
    // The default config checks node + asm + ROM + zxs PATH (no sjasmplus).
    const names = env.checks.map((c) => c.name).sort();
    expect(names).toEqual(['asm', 'node', 'rom', 'zxs-path']);
    for (const c of env.checks) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.detail).toBe('string');
    }
  });
});

function fakeNpmZxsInstall(name: string, complete = true): string[] {
  const prefix = join(dir, name);
  const root = join(prefix, 'node_modules', '@zx-vibes', 'toolkit');
  mkdirSync(join(root, 'bin'), { recursive: true });
  if (complete) mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@zx-vibes/toolkit', version: '0.0.0-test' }),
  );
  writeFileSync(join(root, 'bin', 'zxs.js'), '#!/usr/bin/env node\n');
  if (complete) writeFileSync(join(root, 'dist', 'cli.js'), 'export {};\n');

  const target = 'node_modules/@zx-vibes/toolkit/bin/zxs.js';
  const commands = [
    join(prefix, 'zxs'),
    join(prefix, 'zxs.cmd'),
    join(prefix, 'zxs.ps1'),
  ];
  writeFileSync(commands[0]!, `"$basedir/${target}"\n`);
  writeFileSync(commands[1]!, `"%dp0%\\${target.replaceAll('/', '\\')}"\n`);
  writeFileSync(commands[2]!, `"$basedir/${target}"\n`);
  return commands;
}

/**
 * The layout `npm install -g zx-vibes` actually produces: the shims target the
 * UMBRELLA package's bin, and npm nests (or hoists) the toolkit beneath it. This
 * is the documented install path, so the completeness check must reach the
 * toolkit root through it rather than falling back to the shim directory.
 */
function fakeGlobalUmbrellaInstall(
  name: string,
  { complete = true, hoisted = false } = {},
): string[] {
  const prefix = join(dir, name);
  const umbrella = join(prefix, 'node_modules', 'zx-vibes');
  const root = hoisted
    ? join(prefix, 'node_modules', '@zx-vibes', 'toolkit')
    : join(umbrella, 'node_modules', '@zx-vibes', 'toolkit');
  mkdirSync(join(umbrella, 'bin'), { recursive: true });
  writeFileSync(
    join(umbrella, 'package.json'),
    JSON.stringify({ name: 'zx-vibes', version: '0.0.0-test' }),
  );
  writeFileSync(join(umbrella, 'bin', 'zxs.js'), '#!/usr/bin/env node\n');

  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@zx-vibes/toolkit', version: '0.0.0-test' }),
  );
  writeFileSync(join(root, 'bin', 'zxs.js'), '#!/usr/bin/env node\n');
  if (complete) {
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'cli.js'), 'export {};\n');
  }

  const target = 'node_modules/zx-vibes/bin/zxs.js';
  const commands = [join(prefix, 'zxs'), join(prefix, 'zxs.cmd'), join(prefix, 'zxs.ps1')];
  writeFileSync(commands[0]!, `exec "$basedir/${target}" "$@"\n`);
  writeFileSync(commands[1]!, `"%dp0%\\${target.replaceAll('/', '\\')}" %*\n`);
  writeFileSync(commands[2]!, `& "$basedir/${target}" $args\n`);
  return commands;
}

function fakeNpxZxsInstall(name: string): string[] {
  const install = join(dir, name, 'node_modules');
  const root = join(install, '@zx-vibes', 'toolkit');
  const binDir = join(install, '.bin');
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@zx-vibes/toolkit', version: '0.0.0-test' }),
  );
  writeFileSync(join(root, 'bin', 'zxs.js'), '#!/usr/bin/env node\n');
  writeFileSync(join(root, 'dist', 'cli.js'), 'export {};\n');
  const commands = [join(binDir, 'zxs'), join(binDir, 'zxs.cmd')];
  for (const command of commands) {
    writeFileSync(command, '"$basedir/../@zx-vibes/toolkit/bin/zxs.js"\n');
  }
  return commands;
}

describe('doctor zxs PATH resolution', () => {
  it('groups npm extensionless/.cmd/.ps1 wrappers from one install', () => {
    const check = checkZxsPath(fakeNpmZxsInstall('global-a'));
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/3 command shims/);
  });

  it('resolves project/npx node_modules/.bin wrappers to their package root', () => {
    const check = checkZxsPath(fakeNpxZxsInstall('npx-layout'));
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/2 command shims/);
    expect(check.detail).toMatch(/@zx-vibes[\\/]toolkit/);
  });

  it('fails on two distinct package roots and reports first-wins resolution', () => {
    const check = checkZxsPath([
      ...fakeNpmZxsInstall('global-a'),
      ...fakeNpmZxsInstall('npx-cache'),
    ]);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/2 distinct zxs installations/);
    expect(check.detail).toMatch(/first wins/);
  });

  it('fails when a resolved install is missing dist/cli.js', () => {
    const check = checkZxsPath(fakeNpmZxsInstall('broken', false));
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/missing dist\/cli\.js/);
  });

  // `npm install -g zx-vibes` writes shims that point at the umbrella package's
  // own bin, not the toolkit's. Resolving only the toolkit form left the
  // documented install path falling back to the shim directory, which silently
  // disabled the missing-dist check for it.
  it('resolves global umbrella-package shims to the nested toolkit root', () => {
    const check = checkZxsPath(fakeGlobalUmbrellaInstall('global-umbrella'));
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/3 command shims/);
    expect(check.detail).toMatch(/@zx-vibes[\\/]toolkit/);
  });

  it('resolves global umbrella-package shims when npm hoists the toolkit', () => {
    const check = checkZxsPath(fakeGlobalUmbrellaInstall('hoisted-umbrella', { hoisted: true }));
    expect(check.ok).toBe(true);
    expect(check.detail).toMatch(/@zx-vibes[\\/]toolkit/);
  });

  it('detects an incomplete umbrella install missing dist/cli.js', () => {
    const check = checkZxsPath(fakeGlobalUmbrellaInstall('broken-umbrella', { complete: false }));
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/missing dist\/cli\.js/);
  });

  it('still separates an umbrella install from a distinct toolkit install', () => {
    const check = checkZxsPath([
      ...fakeGlobalUmbrellaInstall('umbrella-a'),
      ...fakeNpmZxsInstall('toolkit-b'),
    ]);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/2 distinct zxs installations/);
  });

  it('the bin shim explains how to recover when dist/cli.js is absent', () => {
    const fakeBin = join(dir, 'zxs.mjs');
    const realBin = fileURLToPath(new URL('../bin/zxs.js', import.meta.url));
    writeFileSync(fakeBin, readFileSync(realBin, 'utf8'));
    const child = spawnSync(process.execPath, [fakeBin, 'doctor'], {
      encoding: 'utf8',
    });
    expect(child.status).toBe(1);
    expect(child.stderr).toMatch(/runtime is incomplete/);
    expect(child.stderr).toMatch(/Rebuild this checkout or reinstall/);
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
