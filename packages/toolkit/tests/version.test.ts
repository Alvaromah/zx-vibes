// CLI-PROD-VERSION-001: `zxs --version` prints the manifest version, plus build metadata
// naming the commit when the repository's `pnpm run pack` built the toolkit.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { parseBuildStamp, toolkitVersion } from '../src/version.js';

const toolkitDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stampScript = path.join(toolkitDir, 'scripts', 'build-stamp.mjs');
const manifestVersion = (
  JSON.parse(readFileSync(path.join(toolkitDir, 'package.json'), 'utf8')) as { version: string }
).version;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zxs-version-'));
  temps.push(dir);
  return dir;
}

/** A fake package root holding a manifest and, optionally, a stamp file. */
function packageRoot(version: string, stamp?: string): URL {
  const dir = tempDir();
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  if (stamp !== undefined) {
    mkdirSync(path.join(dir, 'dist'));
    writeFileSync(path.join(dir, 'dist', 'build-stamp.json'), stamp);
  }
  return pathToFileURL(dir + path.sep);
}

/** HEAD of the checkout these tests run in, or undefined outside a git checkout. */
function gitHead(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: toolkitDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function runStampScript(out: string, stampEnv: string | undefined): void {
  const env = { ...process.env };
  delete env.ZXS_BUILD_STAMP;
  if (stampEnv !== undefined) env.ZXS_BUILD_STAMP = stampEnv;
  const result = spawnSync(process.execPath, [stampScript, '--out', out], { env, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

describe('toolkitVersion (CLI-PROD-VERSION-001)', () => {
  it('is the manifest version when there is no stamp', () => {
    expect(toolkitVersion(packageRoot('1.2.3'))).toBe('1.2.3');
  });

  it('appends the stamped commit as semver build metadata', () => {
    expect(toolkitVersion(packageRoot('1.2.3', '{"commit":"325992e","dirty":false}'))).toBe('1.2.3+325992e');
    expect(toolkitVersion(packageRoot('1.2.3', '{"commit":"325992e","dirty":true}'))).toBe(
      '1.2.3+325992e.dirty',
    );
  });

  it('ignores a malformed stamp', () => {
    for (const bad of ['not json', 'null', '{"commit":"HEAD"}', '{"commit":"32599"}', '{"dirty":true}']) {
      expect(parseBuildStamp(bad)).toBeUndefined();
      expect(toolkitVersion(packageRoot('1.2.3', bad))).toBe('1.2.3');
    }
  });

  it('`zxs --version` and `zxs version` print it', async () => {
    const out: string[] = [];
    const streams = { out: (t: string) => out.push(t), err: () => undefined };
    expect(await runCli(['--version'], { streams })).toBe(0);
    const printed = out.join('').trim();
    expect(printed).toBe(toolkitVersion());
    expect(printed.startsWith(manifestVersion)).toBe(true);
    expect(printed).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9a-f]{7,40}(?:\.dirty)?)?$/);

    out.length = 0;
    expect(await runCli(['version', '--json'], { streams })).toBe(0);
    expect(JSON.parse(out.join('').trim()).version).toBe(printed);
  });
});

describe('scripts/build-stamp.mjs, the toolkit prepack step (CLI-PROD-VERSION-001)', () => {
  const head = gitHead();

  it.skipIf(head === undefined)('with ZXS_BUILD_STAMP=1, writes the checkout commit', () => {
    const out = path.join(tempDir(), 'dist', 'build-stamp.json');
    runStampScript(out, '1');
    const stamp = parseBuildStamp(readFileSync(out, 'utf8'));
    expect(stamp?.commit).toBe(head);
    expect(typeof stamp?.dirty).toBe('boolean');
  });

  it('without ZXS_BUILD_STAMP (a publish), removes any stamp and writes none', () => {
    const out = path.join(tempDir(), 'build-stamp.json');
    writeFileSync(out, '{"commit":"325992e","dirty":false}\n');
    runStampScript(out, undefined);
    expect(existsSync(out)).toBe(false);
    runStampScript(out, '');
    expect(existsSync(out)).toBe(false);
  });

  it('runs after the build in the toolkit prepack, and only the root pack script sets the flag', () => {
    const toolkitManifest = JSON.parse(readFileSync(path.join(toolkitDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(toolkitManifest.scripts.prepack).toBe('pnpm run build && node scripts/build-stamp.mjs');
    const repoRoot = path.resolve(toolkitDir, '..', '..');
    const rootManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(rootManifest.scripts.pack).toBe('node scripts/pack.mjs');
    expect(readFileSync(path.join(repoRoot, 'scripts', 'pack.mjs'), 'utf8')).toContain("ZXS_BUILD_STAMP: '1'");
    // The release workflow publishes with `changeset publish`, which never sets the flag.
    const release = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(release).not.toContain('ZXS_BUILD_STAMP');
  });
});
