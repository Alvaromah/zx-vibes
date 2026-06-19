import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = join(process.cwd(), 'dist', 'index.js');
const expectedZxVibesRange = `^${JSON.parse(readFileSync(join(process.cwd(), '..', 'zx-vibes', 'package.json'), 'utf8')).version}`;

const help = run(process.cwd(), '--help');
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /--template <name>/);
assert.match(help.stdout, /--install/);
assert.match(help.stdout, /--no-install/);

const cwd = mkdtempSync(join(tmpdir(), 'create-zx-vibes-'));
const created = run(cwd, 'mygame', '--no-install');
assert.equal(created.status, 0, created.stderr || created.stdout);
assert.match(created.stdout, /npm install/);
assert.match(created.stdout, /npm run verify/);

const project = join(cwd, 'mygame');
assert.equal(existsSync(join(project, '.gitignore')), true);
assert.equal(existsSync(join(project, '.mcp.json')), true);
assert.equal(existsSync(join(project, 'docs', 'agents', 'codex-mcp.toml')), true);
assert.equal(existsSync(join(project, 'docs', 'agents', 'skills', 'INDEX.md')), true);
assert.equal(existsSync(join(project, 'docs', 'reference', 'screen-layout.md')), true);

const metadata = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
assert.equal(metadata.devDependencies['zx-vibes'], expectedZxVibesRange);

function run(cwd, ...args) {
  const res = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}
