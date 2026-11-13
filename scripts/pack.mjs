#!/usr/bin/env node
// pack.mjs — `pnpm run pack`: pack every package under packages/ into .packs/, one at a
// time, with ZXS_BUILD_STAMP=1 so the toolkit's prepack stamps its build with the commit
// (packages/toolkit/scripts/build-stamp.mjs, CLI-PROD-VERSION-001). `zxs --version` from
// these tarballs then prints e.g. `0.8.0+325992e`, which the npm release of the same
// version never does: `pnpm publish` runs the same prepack without the variable.
import { spawnSync } from 'node:child_process';

const args = [
  '-r',
  '--filter',
  './packages/*',
  '--workspace-concurrency=1',
  'pack',
  '--pack-destination',
  '.packs',
];
const env = { ...process.env, ZXS_BUILD_STAMP: '1' };

// Re-use the pnpm that runs this script (`npm_execpath`): a JS entry runs under this
// Node, a standalone binary runs as is; otherwise fall back to `pnpm` on PATH.
const execPath = process.env.npm_execpath ?? '';
const isPnpm = /pnpm/i.test(execPath);
const viaNode = isPnpm && /\.[cm]?js$/i.test(execPath);
const command = viaNode ? process.execPath : isPnpm ? execPath : 'pnpm';
const commandArgs = viaNode ? [execPath, ...args] : args;

const result = spawnSync(command, commandArgs, {
  stdio: 'inherit',
  env,
  // `pnpm` on PATH is a .cmd shim on Windows, which needs a shell.
  shell: command === 'pnpm' && process.platform === 'win32',
});
if (result.error !== undefined) {
  console.error(`pack: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
