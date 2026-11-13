import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const writeMode = process.argv.includes('--write');

// Every published package under packages/ is a version surface: its row in the
// root README table and the "Current package version" line of its own README.
// The list is read from disk, so a package cannot be left out of the check (a
// hand-kept list once covered three of the six, and a release would have left
// the cpu, ula and machine versions behind in both places).
const packageManifests = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}/package.json`)
  .filter((file) => existsSync(join(root, file)))
  .map((file) => [readJson(file), file])
  .filter(([manifest]) => manifest.private !== true)
  .map(([manifest, file]) => [manifest.name, file])
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

const packages = new Map(packageManifests.map(([name, file]) => [name, readJson(file)]));
if (!packages.has('zx-vibes')) {
  throw new Error('packages/zx-vibes/package.json (the umbrella package) is missing');
}
const zxVibesVersion = packages.get('zx-vibes').version;
const expectedStarterRange = `^${zxVibesVersion}`;
const problems = [];
const touched = new Set();

for (const file of [
  'starters/game/package.json',
  'starters/platformer/package.json',
]) {
  const json = readJson(file);
  const actual = json.devDependencies?.['zx-vibes'];
  if (actual !== expectedStarterRange) {
    if (writeMode) {
      json.devDependencies ??= {};
      json.devDependencies['zx-vibes'] = expectedStarterRange;
      writeJson(file, json);
    } else {
      problems.push(`${file} uses zx-vibes ${actual ?? '<missing>'}; expected ${expectedStarterRange}`);
    }
  }
}

updateText('README.md', (text) => {
  let next = text;
  for (const [name, manifest] of packages.entries()) {
    next = replaceRootReadmePackageVersion(next, name, manifest.version);
  }
  next = replaceStarterRangeMention(next);
  return next;
});

for (const [name, file] of packageManifests) {
  const readme = file.replace(/package\.json$/, 'README.md');
  updateText(readme, (text) => replacePackageReadmeVersion(text, readme, name, packages.get(name).version));
}


if (problems.length) {
  throw new Error(`Version surfaces are inconsistent:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
}

if (writeMode) {
  const files = [...touched].sort();
  console.log(
    files.length
      ? `Updated version surfaces for zx-vibes ${zxVibesVersion}:\n${files.map((file) => `- ${file}`).join('\n')}`
      : `Version surfaces are already consistent for zx-vibes ${zxVibesVersion}.`
  );
} else {
  console.log(`Version surfaces are consistent for zx-vibes ${zxVibesVersion}.`);
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function readText(file) {
  return readFileSync(join(root, file), 'utf8');
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, text) {
  writeFileSync(join(root, file), text);
  touched.add(file);
}

function updateText(file, updater) {
  const before = readText(file);
  const after = updater(before);
  if (after !== before) {
    if (writeMode) {
      writeText(file, after);
    } else {
      problems.push(`${file} has stale version text`);
    }
  }
}

function replaceRootReadmePackageVersion(markdown, packageName, expectedVersion) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('(\\| `' + escaped + '` \\| `)([^`]+)(` \\|)');
  if (!pattern.test(markdown)) {
    problems.push(`README.md package table is missing ${packageName}`);
    return markdown;
  }
  return markdown.replace(pattern, `$1${expectedVersion}$3`);
}

function replacePackageReadmeVersion(markdown, file, packageName, expectedVersion) {
  const pattern = /Current package version in this repository: `([^`]+)`\./;
  if (!pattern.test(markdown)) {
    problems.push(`${file} is missing current package version text for ${packageName}`);
    return markdown;
  }
  return markdown.replace(pattern, `Current package version in this repository: \`${expectedVersion}\`.`);
}

function replaceStarterRangeMention(markdown) {
  const pattern = /(`zx-vibes` dev dependency floor\s+of\s+`)\^[0-9]+\.[0-9]+\.[0-9]+(`)/;
  if (!pattern.test(markdown)) {
    problems.push('starter dependency floor text is missing a replaceable zx-vibes range');
    return markdown;
  }
  return markdown.replace(pattern, `$1${expectedStarterRange}$2`);
}
