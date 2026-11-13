// version.ts — the version string `zxs --version` and the MCP server report
// (CLI-PROD-VERSION-001): the package manifest's version, plus semver build metadata
// naming the commit when the repository's `pnpm run pack` built this copy.
//
// `scripts/build-stamp.mjs` (the toolkit's prepack step, after the build) writes
// `dist/build-stamp.json` only when `ZXS_BUILD_STAMP` is set, which only the root
// `scripts/pack.mjs` does. `pnpm publish` runs the same prepack without it, and the
// build's clean removes any older stamp, so a published package prints the bare version.
import { readFileSync } from 'node:fs';

/** Where the pack-time stamp lives, relative to the package root. */
export const BUILD_STAMP_FILE = 'dist/build-stamp.json';

export interface BuildStamp {
  /** Abbreviated commit hash of the checkout the build came from. */
  commit: string;
  /** Tracked files had uncommitted changes when it was built. */
  dirty: boolean;
}

/** Parse a stamp file; anything malformed counts as no stamp. */
export function parseBuildStamp(text: string): BuildStamp | undefined {
  try {
    const value = JSON.parse(text) as Partial<BuildStamp> | null;
    if (value === null || typeof value !== 'object') return undefined;
    if (typeof value.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(value.commit)) return undefined;
    return { commit: value.commit, dirty: value.dirty === true };
  } catch {
    return undefined;
  }
}

/**
 * The toolkit version with its build stamp, e.g. `0.8.0`, `0.8.0+325992e` or
 * `0.8.0+325992e.dirty`. `root` is the package root; the default (one level above this
 * module) is right both for `src/` and for the bundles in `dist/`.
 */
export function toolkitVersion(root: URL = new URL('../', import.meta.url)): string {
  let version: string;
  try {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version?: string };
    version = pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
  let stamp: BuildStamp | undefined;
  try {
    stamp = parseBuildStamp(readFileSync(new URL(BUILD_STAMP_FILE, root), 'utf8'));
  } catch {
    stamp = undefined;
  }
  return stamp === undefined ? version : `${version}+${stamp.commit}${stamp.dirty ? '.dirty' : ''}`;
}
