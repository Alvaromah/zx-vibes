import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliPath = join(root, 'dist', 'cli', 'index.js');

function zxs(cwd: string, ...args: string[]) {
  const res = spawnSync('node', [cliPath, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

describe('zxs new (scaffold)', () => {
  it('documents the template option in command help', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zxs-new-help-'));
    const help = zxs(cwd, 'new', '--help');
    expect(help.status, help.stdout + help.stderr).toBe(0);
    expect(help.stdout).toContain('--template <name>');
    expect(help.stdout).toContain('starter template: game or platformer');
    expect(help.stdout).toContain('--no-install');
  });

  it('creates a working game that passes its own smoke test', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zxs-new-'));
    const created = zxs(cwd, 'new', 'mygame', '--no-install');
    expect(created.status, created.stdout + created.stderr).toBe(0);
    expect(created.stdout).toContain('npm install');
    expect(created.stdout).toContain('npm run build');
    expect(created.stdout).toContain('npm test');

    const project = join(cwd, 'mygame');
    expect(existsSync(join(project, '.gitignore'))).toBe(true); // renamed from 'gitignore'
    expect(existsSync(join(project, 'docs', 'reference', 'screen-layout.md'))).toBe(true);
    expect(existsSync(join(project, 'docs', 'agents', 'codex-mcp.toml'))).toBe(true);
    expect(existsSync(join(project, '.mcp.json'))).toBe(true);
    const agentsMd = readFileSync(join(project, 'AGENTS.md'), 'utf8');
    const claudeMd = readFileSync(join(project, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toBe(agentsMd);
    expect(agentsMd).toContain('mygame');
    expect(agentsMd).toContain('zxs run');
    expect(agentsMd).toContain('If `zxs` is not found');
    expect(agentsMd).toContain('docs/reference/screen-layout.md');
    expect(agentsMd).not.toContain('docs/screen-layout.md');
    const packageJson = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(packageJson.scripts.build).toBe('zxs build');
    expect(packageJson.scripts.test).toBe('zxs test tests');
    expect(packageJson.devDependencies['zx-vibes']).toBe('^0.1.0');

    // The skeleton must build, run HALT-synced, and move under scheduled keys.
    const test = zxs(project, 'test', 'tests', '--json');
    expect(test.status, test.stdout + test.stderr).toBe(0);
  });

  it('creates a platformer starter with movement and jump checks', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zxs-new-platformer-'));
    const created = zxs(cwd, 'new', 'myplatformer', '--template', 'platformer', '--no-install');
    expect(created.status, created.stdout + created.stderr).toBe(0);

    const project = join(cwd, 'myplatformer');
    const test = zxs(project, 'test', 'tests', '--json');
    expect(test.status, test.stdout + test.stderr).toBe(0);
    const json = JSON.parse(test.stdout) as { passed: number; total: number };
    expect(json.passed).toBe(json.total);
  });

  it('rejects unknown templates with the available template names', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zxs-new-template-'));
    const created = zxs(cwd, 'new', 'badtemplate', '--template', 'does-not-exist');
    expect(created.status).toBe(1);
    expect(created.stderr).toContain("Unknown template 'does-not-exist'. Available: game, platformer");
  });

  it('rejects existing directories and bad names', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'zxs-new-'));
    expect(zxs(cwd, 'new', 'ok-name', '--no-install').status).toBe(0);
    expect(zxs(cwd, 'new', 'ok-name', '--no-install').status).toBe(1); // already exists
    expect(zxs(cwd, 'new', '../evil', '--no-install').status).toBe(1);
  });
});

describe('zxs test (runner)', () => {
  it('the recipe suite passes', () => {
    const res = zxs(root, 'test', 'recipes', '--json');
    expect(res.status, res.stdout).toBe(0);
    const json = JSON.parse(res.stdout) as { total: number; passed: number };
    expect(json.total).toBeGreaterThanOrEqual(6);
    expect(json.passed).toBe(json.total);
  });
});
