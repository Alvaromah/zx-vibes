import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { name, version } from '../dist/index.js';

const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (name !== metadata.name) {
  throw new Error(`expected exported package name ${metadata.name}, got ${name}`);
}

if (version !== metadata.version) {
  throw new Error(`expected exported package version ${metadata.version}, got ${version}`);
}

const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/zx-vibes.js', import.meta.url)), '--version'], {
  encoding: 'utf8',
});

if (cli.status !== 0) {
  throw new Error(`zx-vibes --version failed: ${cli.stderr || cli.stdout}`);
}
