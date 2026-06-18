import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const emulator = join(root, 'packages', 'emulator');
const source = join(root, 'packages', 'emulator', 'dist', 'zxgeneration.esm.js');
const targets = [
  join(root, 'gallery', 'zxgeneration.esm.js'),
  join(root, 'packages', 'toolkit', 'gallery', 'zxgeneration.esm.js'),
];

const rollupBin = join(emulator, 'node_modules', 'rollup', 'dist', 'bin', 'rollup');
if (!existsSync(rollupBin)) {
  throw new Error(
    `rollup not found at ${rollupBin}. Run "pnpm install" so @zx-vibes/emulator's dependencies are present.`
  );
}
const emulatorPackage = JSON.parse(readFileSync(join(emulator, 'package.json'), 'utf8'));

execFileSync(process.execPath, [rollupBin, '-c'], {
  cwd: emulator,
  env: {
    ...process.env,
    npm_package_version: emulatorPackage.version,
  },
  stdio: 'inherit',
});

if (!existsSync(source)) {
  throw new Error('Missing emulator browser bundle after pnpm --filter @zx-vibes/emulator run build.');
}

const sourceBytes = readFileSync(source);
const drift = [];

for (const target of targets) {
  if (!existsSync(target)) {
    drift.push(`${target} is missing`);
  } else if (!readFileSync(target).equals(sourceBytes)) {
    drift.push(`${target} differs from packages/emulator/dist/zxgeneration.esm.js`);
  }
}

if (drift.length) {
  throw new Error(`Gallery emulator bundles are stale:\n${drift.map((line) => `- ${line}`).join('\n')}`);
}
