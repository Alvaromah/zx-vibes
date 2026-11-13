// Where an installation lives, and what a PATH resolves — shared by `doctor` (the
// `zxs-path` and `mcp-command` checks) and `setup` (choosing the MCP registration).

import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';

/** The package that implements `zxs` and `zxs-mcp`. */
export const TOOLKIT_PACKAGE = '@zx-vibes/toolkit';
/** The user-facing umbrella package whose bins `npm install -g zx-vibes` installs. */
export const UMBRELLA_PACKAGE = 'zx-vibes';

/** The canonical (symlink-free, case-normalized) path, or the resolved path if it is missing. */
export function safeRealpath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

/** Walk upward from `start` (a file or directory) to the owning `@zx-vibes/toolkit` package, if any. */
export function findToolkitRoot(start: string): string | undefined {
  let current = start;
  try {
    if (statSync(current).isFile()) current = dirname(current);
  } catch {
    return undefined;
  }
  for (;;) {
    const packageJson = join(current, 'package.json');
    if (existsSync(packageJson)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as {
          name?: unknown;
        };
        if (parsed.name === TOOLKIT_PACKAGE) return safeRealpath(current);
      } catch {
        // Keep walking: an unrelated malformed package must not hide the real owner.
      }
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Every command file named `name` that `pathValue` resolves, in PATH order. On Windows
 * the extensionless name, each `PATHEXT` extension and `.ps1` are tried, so npm's three
 * shims for one bin are all found.
 */
export function findCommandOnPath(
  name: string,
  pathValue = process.env.PATH ?? '',
  pathExtValue = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  platform: NodeJS.Platform = process.platform,
): string[] {
  const windows = platform === 'win32';
  const extensions = windows
    ? [
        '',
        ...pathExtValue
          .split(';')
          .map((extension) => extension.trim().toLowerCase())
          .filter(Boolean),
        '.ps1',
      ]
    : [''];
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const rawEntry of pathValue.split(delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, '$1');
    if (entry.length === 0) continue;
    for (const extension of extensions) {
      const candidate = join(entry, `${name}${extension}`);
      const key = windows ? candidate.toLowerCase() : candidate;
      if (seen.has(key) || !existsSync(candidate)) continue;
      try {
        if (!statSync(candidate).isFile()) continue;
        if (!windows) accessSync(candidate, fsConstants.X_OK);
      } catch {
        continue;
      }
      seen.add(key);
      candidates.push(resolve(candidate));
    }
  }
  return candidates;
}

/**
 * `pathValue` without the entries npx and npm scripts prepend — every
 * `node_modules/.bin` and npm's `node-gyp-bin` — i.e. the PATH an MCP client that was
 * not started through npx sees. Run as `npx zxs doctor`, the full PATH would find a
 * project-local `zxs-mcp` that the client cannot.
 */
export function withoutNpxPath(pathValue: string): string {
  return pathValue
    .split(delimiter)
    .filter((entry) => !/(^|[\\/])node_modules[\\/]\.bin([\\/]|$)|node-gyp-bin/i.test(entry.trim()))
    .join(delimiter);
}
