#!/usr/bin/env node
// build-stamp.mjs — the toolkit's prepack step, after the build (CLI-PROD-VERSION-001).
//
// With ZXS_BUILD_STAMP set (only the repository's `pnpm run pack`, scripts/pack.mjs, sets
// it), write dist/build-stamp.json = { commit, dirty } from git, so `zxs --version` prints
// `<version>+<commit>[.dirty]` and a local tarball can't pass for the npm release of the
// same version. Without it (`pnpm publish`, or a plain `pnpm pack`), make sure no stamp is
// left: the build's clean has already removed it, and this removes it again.
//
//   node scripts/build-stamp.mjs [--out <file>]     (default: dist/build-stamp.json)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outIndex = process.argv.indexOf('--out');
const out =
  outIndex > 0 && process.argv[outIndex + 1] !== undefined
    ? path.resolve(process.argv[outIndex + 1])
    : path.join(packageDir, 'dist', 'build-stamp.json');

const flag = (process.env.ZXS_BUILD_STAMP ?? '').trim().toLowerCase();
const enabled = flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';

function git(args) {
  return execFileSync('git', args, {
    cwd: packageDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** { commit, dirty } of the checkout holding this package, or undefined without one. */
function readGitStamp() {
  try {
    const commit = git(['rev-parse', '--short=7', 'HEAD']);
    if (!/^[0-9a-f]{7,40}$/.test(commit)) return undefined;
    const dirty = git(['status', '--porcelain', '--untracked-files=no']) !== '';
    return { commit, dirty };
  } catch {
    return undefined;
  }
}

rmSync(out, { force: true });
if (enabled) {
  const stamp = readGitStamp();
  if (stamp === undefined) {
    console.warn('build stamp: no git checkout found; `zxs --version` will print the bare version');
  } else {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(stamp)}\n`);
    console.log(`build stamp: ${stamp.commit}${stamp.dirty ? ' (uncommitted changes)' : ''}`);
  }
}
