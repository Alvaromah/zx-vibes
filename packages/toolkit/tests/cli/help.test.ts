import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(root, 'dist', 'cli', 'index.js');

interface PackageMetadata {
  version: string;
}

function zxs(...args: string[]) {
  const res = spawnSync('node', [cliPath, ...args], { cwd: root, encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe('zxs help and version output', () => {
  it('reports the toolkit package version', () => {
    const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageMetadata;
    const version = zxs('--version');

    expect(version.status, version.stdout + version.stderr).toBe(0);
    expect(version.stdout.trim()).toBe(metadata.version);
  });

  it('documents preview options used by generated projects', () => {
    const help = zxs('preview', '--help');

    expect(help.status, help.stdout + help.stderr).toBe(0);
    expect(help.stdout).toContain('--port <n>');
    expect(help.stdout).toContain('--watch');
    expect(help.stdout).toContain('--strict-port');
  });

  it.each([
    ['build'],
    ['run'],
    ['screen'],
    ['key'],
    ['type'],
    ['mem'],
    ['mem', 'read'],
    ['mem', 'write'],
    ['regs'],
    ['regs', 'set'],
    ['state'],
    ['state', 'save'],
    ['state', 'load'],
    ['state', 'reset'],
    ['state', 'export'],
    ['break'],
    ['break', 'add'],
    ['break', 'list'],
    ['break', 'rm'],
    ['watch'],
    ['watch', 'add'],
    ['watch', 'list'],
    ['watch', 'rm'],
    ['step'],
    ['disasm'],
    ['trace'],
    ['new'],
    ['test'],
    ['doctor'],
    ['setup'],
    ['verify'],
    ['preview'],
    ['bench'],
  ])('prints help for zxs %s', (...command) => {
    const help = zxs(...command, '--help');

    expect(help.status, help.stdout + help.stderr).toBe(0);
    expect(help.stdout).toContain('Usage:');
    expect(help.stdout).toContain('Options:');
  });
});
