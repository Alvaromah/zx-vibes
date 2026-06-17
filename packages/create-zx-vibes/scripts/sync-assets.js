import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = dirname(here);
const root = join(pkg, '..', '..');
const checkOnly = process.argv.includes('--check');
const pairs = ['starters', 'docs'].map((name) => ({
  name,
  src: join(root, name),
  dest: join(pkg, name),
}));

pairs.forEach(assertSourceExists);

if (checkOnly) {
  const drift = [];
  for (const pair of pairs) compareDirs(pair.src, pair.dest, pair.name, drift);
  if (drift.length) {
    throw new Error(`Synced assets are stale:\n${drift.map((line) => `- ${line}`).join('\n')}`);
  }
  process.exit(0);
}

const pkgRoot = resolve(pkg);
for (const { src, dest } of pairs) {
  assertWithinPkg(dest);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

/** Defense-in-depth before a recursive delete: refuse any dest outside the package. */
function assertWithinPkg(dest) {
  const resolved = resolve(dest);
  if (resolved !== pkgRoot && !resolved.startsWith(pkgRoot + sep)) {
    throw new Error(`Refusing to modify a path outside the package: ${dest}`);
  }
}

function assertSourceExists({ name, src }) {
  if (!existsSync(src)) throw new Error(`Missing source asset directory: ${name}`);
  if (!statSync(src).isDirectory()) throw new Error(`Source asset is not a directory: ${name}`);
}

function compareDirs(src, dest, rel, drift) {
  if (!existsSync(dest)) {
    drift.push(`${rel} is missing`);
    return;
  }
  const srcEntries = readdirSync(src).sort();
  const destEntries = readdirSync(dest).sort();
  for (const name of srcEntries) {
    const srcPath = join(src, name);
    const destPath = join(dest, name);
    const entryRel = `${rel}/${name}`;
    if (!existsSync(destPath)) {
      drift.push(`${entryRel} is missing`);
      continue;
    }
    const srcStat = statSync(srcPath);
    const destStat = statSync(destPath);
    if (srcStat.isDirectory() !== destStat.isDirectory()) {
      drift.push(`${entryRel} has a different file type`);
    } else if (srcStat.isDirectory()) {
      compareDirs(srcPath, destPath, entryRel, drift);
    } else if (!readFileSync(srcPath).equals(readFileSync(destPath))) {
      drift.push(`${entryRel} differs`);
    }
  }
  for (const name of destEntries) {
    if (!srcEntries.includes(name)) drift.push(`${rel}/${name} is extra`);
  }
}
