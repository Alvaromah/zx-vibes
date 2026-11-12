// Shared "make sure a workspace package is built" step for the conformance runners
// that execute a built package (the assembler and toolkit runners, the MCP and reveng
// self-tests).
//
// Two properties the per-runner copies lacked:
//   - It does not depend on corepack. It uses the pnpm that launched this process
//     (`npm_execpath`), then `pnpm` on PATH, and only then `corepack pnpm`: Node 25+
//     no longer ships corepack, and pnpm may be installed without it.
//   - It rebuilds only when the build output is older than the package sources, so
//     one `conformance:check` run no longer rebuilds the same package several times.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Files/directories that decide whether a package's build output is stale. */
const SOURCE_ENTRIES = ["src", "player", "bin", "package.json", "tsconfig.json", "tsup.config.ts", "tsup.player.config.ts"];

function newestMtime(entry) {
  if (!existsSync(entry)) return 0;
  const stat = statSync(entry);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const name of readdirSync(entry)) {
    if (name === "node_modules" || name === "dist") continue;
    newest = Math.max(newest, newestMtime(path.join(entry, name)));
  }
  return newest;
}

/** Whether `artifact` is missing or older than any source of the package in `packageDir`. */
export function isBuildStale(packageDir, artifact) {
  const output = path.join(packageDir, artifact);
  if (!existsSync(output)) return true;
  const built = statSync(output).mtimeMs;
  const sources = Math.max(...SOURCE_ENTRIES.map((entry) => newestMtime(path.join(packageDir, entry))));
  return sources > built;
}

const NOT_FOUND = /not recognized as an internal or external command|command not found|: not found|ENOENT/i;

function attempt(command, args, cwd) {
  const useShell = process.platform === "win32" && command !== process.execPath;
  const result = spawnSync(useShell ? [command, ...args].join(" ") : command, useShell ? [] : args, {
    cwd,
    encoding: "utf8",
    shell: useShell,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const missing = Boolean(result.error) || result.status === 127 || result.status === 9009 ||
    (result.status !== 0 && NOT_FOUND.test(output) && output.length < 400);
  return { ok: result.status === 0 && !result.error, missing, output, error: result.error };
}

/** Run `pnpm <args>` in `cwd` with the first pnpm that is available. */
export function runPnpm(args, cwd) {
  const candidates = [];
  const launcher = process.env.npm_execpath;
  if (launcher && /pnpm/i.test(path.basename(launcher))) {
    candidates.push(/\.[cm]?js$/i.test(launcher) ? [process.execPath, [launcher, ...args]] : [launcher, args]);
  }
  candidates.push(["pnpm", args], ["corepack", ["pnpm", ...args]]);
  const tried = [];
  for (const [command, commandArgs] of candidates) {
    const result = attempt(command, commandArgs, cwd);
    if (!result.missing) return result;
    tried.push(command);
  }
  return {
    ok: false,
    missing: true,
    output: `no pnpm found (tried ${tried.join(", ")}); install pnpm 10 or build the package first`,
  };
}

/**
 * Build `packageName` (the workspace package in `<root>/<packageDir>`) when `artifact`
 * (relative to the package) is missing or stale, unless `skipBuild`. Throws with the
 * build output on failure, or when the artifact is still missing afterwards.
 * Returns the absolute artifact path.
 */
export function ensurePackageBuilt({ root, packageDir, packageName, artifact, skipBuild = false, label = packageName }) {
  const dir = path.join(root, packageDir);
  const output = path.join(dir, artifact);
  if (!skipBuild && isBuildStale(dir, artifact)) {
    const build = runPnpm(["--filter", packageName, "run", "build"], root);
    if (!build.ok) {
      throw new Error([`failed to build ${packageName} before ${label}`, build.error?.message, build.output].filter(Boolean).join("\n"));
    }
  }
  if (!existsSync(output)) {
    throw new Error(`built ${packageName} artifact does not exist: ${output}`);
  }
  return output;
}
