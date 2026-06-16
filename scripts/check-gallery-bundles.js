import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'packages', 'emulator', 'dist', 'zxgeneration.esm.js');
const targets = [
  join(root, 'gallery', 'zxgeneration.esm.js'),
  join(root, 'packages', 'toolkit', 'gallery', 'zxgeneration.esm.js'),
];

if (!existsSync(source)) {
  throw new Error('Missing emulator browser bundle. Run pnpm --filter @zx-vibes/emulator build first.');
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
