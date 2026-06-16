import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pairs = ['game', 'platformer'].map((name) => ({
  name,
  src: join(root, 'starters', name),
  dest: join(root, 'packages', 'toolkit', 'templates', name),
}));

const drift = [];
for (const pair of pairs) compareDirs(pair.src, pair.dest, pair.name, drift);

if (drift.length) {
  throw new Error(`Toolkit templates are stale relative to root starters:\n${drift.map((line) => `- ${line}`).join('\n')}`);
}

function compareDirs(src, dest, rel, drift) {
  if (!existsSync(src)) {
    drift.push(`${rel} source is missing`);
    return;
  }
  if (!existsSync(dest)) {
    drift.push(`${rel} template is missing`);
    return;
  }

  const srcStat = statSync(src);
  const destStat = statSync(dest);
  if (srcStat.isDirectory() !== destStat.isDirectory()) {
    drift.push(`${rel} has a different file type`);
    return;
  }
  if (!srcStat.isDirectory()) {
    if (!readFileSync(src).equals(readFileSync(dest))) drift.push(`${rel} differs`);
    return;
  }

  const srcEntries = readdirSync(src).sort();
  const destEntries = readdirSync(dest).sort();
  for (const name of srcEntries) {
    compareDirs(join(src, name), join(dest, name), `${rel}/${name}`, drift);
  }
  for (const name of destEntries) {
    if (!srcEntries.includes(name)) drift.push(`${rel}/${name} is extra`);
  }
}
