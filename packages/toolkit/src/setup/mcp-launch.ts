// How an MCP client starts this toolkit's MCP server (cli.md CLI-PROD-SETUP-002), and
// whether a project's registration still resolves (cli.md CLI-PROD-DOCTOR-003).
//
// A global install (`npm install -g zx-vibes`) puts the `zxs-mcp` bin on PATH, so the
// bare name works. A project-local install puts it only in `node_modules/.bin`, which
// an MCP client's PATH lacks (npx adds it to `npx zxs …` and nothing else), so the bare
// name cannot start. For a local install `setup` registers
// `node <project-relative path to zxs-mcp.js>` instead:
// - no shell: `npx` is a `.cmd` on Windows, which a client spawning without a shell
//   cannot start (ENOENT), while `node` is an executable everywhere;
// - nothing but the server on stdout (no npm notices on the protocol channel);
// - no machine-specific path in a file that is usually committed.
// The server already takes its launch directory as the project root (`runMcp` uses
// `process.cwd()`), so the relative path adds no assumption of its own.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UMBRELLA_PACKAGE,
  TOOLKIT_PACKAGE,
  findCommandOnPath,
  findToolkitRoot,
  safeRealpath,
  withoutNpxPath,
} from '../util/install-paths.js';

/** The MCP server name `setup` registers (mcp-tools.md MCP-PROD-SERVER-001). */
export const MCP_SERVER_NAME = 'zx-vibes';
/** The bin that starts the stdio MCP server (cli.md CLI-PROD-PKG-003). */
export const MCP_SERVER_BIN = 'zxs-mcp';

/** How a client starts the server: a command and its arguments. */
export interface McpLaunch {
  command: string;
  args?: string[];
}

/** The launch for a global install: the bare bin on PATH. */
export const GLOBAL_MCP_LAUNCH: McpLaunch = { command: MCP_SERVER_BIN };

/** The package root of the toolkit that is running (found from this module's file). */
export function runningToolkitRoot(): string | undefined {
  return findToolkitRoot(fileURLToPath(import.meta.url));
}

/** A path as POSIX segments (`a/b/c`), so a registration reads the same on every OS. */
function posix(path: string): string {
  return path.split(/[\\/]+/).join('/');
}

/** Whether `path` is `dir` or lies inside it (both canonical). */
function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === '' || (!isAbsolute(rel) && rel.split(/[\\/]+/)[0] !== '..');
}

/** Two canonical paths name the same place (case-insensitively on Windows). */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The `node_modules` directory that holds the running toolkit for this project, as a
 * project-relative POSIX path: `node_modules`, or `../node_modules` and so on for a
 * workspace parent — the directories `npx` searches, nearest first. A toolkit counts
 * as installed there when it lives inside it (npm's flat layout, pnpm's `.pnpm`
 * store) or is linked from it (`npm link`, a `file:` directory install). Undefined for
 * a global install or a checkout run by path.
 */
export function localNodeModules(projectDir: string, toolkitRoot: string): string | undefined {
  const toolkit = safeRealpath(toolkitRoot);
  let level = resolve(projectDir);
  let prefix = '';
  for (;;) {
    const nodeModules = join(level, 'node_modules');
    if (existsSync(nodeModules)) {
      const linked = join(nodeModules, ...TOOLKIT_PACKAGE.split('/'));
      if (
        isInside(toolkit, safeRealpath(nodeModules)) ||
        (existsSync(linked) && samePath(safeRealpath(linked), toolkit))
      ) {
        return `${prefix}node_modules`;
      }
    }
    const parent = dirname(level);
    if (parent === level) return undefined;
    level = parent;
    prefix += '../';
  }
}

/**
 * The registration `setup` writes for the toolkit that runs it (CLI-PROD-SETUP-002).
 * A project-local install gets `node <script>`, trying in order the toolkit's own bin
 * and the umbrella's (both reachable by package name, so an upgrade keeps them valid),
 * then the running toolkit's real path (a pnpm store path, version-specific). Anything
 * else keeps the bare `zxs-mcp`. With `absolute` (a config that serves every project,
 * such as Codex's global one) the script is given by absolute path instead.
 */
export function mcpLaunchFor(
  projectDir: string,
  toolkitRoot: string | undefined = runningToolkitRoot(),
  exists: (path: string) => boolean = existsSync,
  options: { absolute?: boolean } = {},
): McpLaunch {
  if (toolkitRoot === undefined) return GLOBAL_MCP_LAUNCH;
  const nodeModules = localNodeModules(projectDir, toolkitRoot);
  if (nodeModules === undefined) return GLOBAL_MCP_LAUNCH;
  const candidates = [
    `${nodeModules}/${TOOLKIT_PACKAGE}/bin/${MCP_SERVER_BIN}.js`,
    `${nodeModules}/${UMBRELLA_PACKAGE}/bin/${MCP_SERVER_BIN}.js`,
    posix(relative(safeRealpath(projectDir), join(safeRealpath(toolkitRoot), 'bin', `${MCP_SERVER_BIN}.js`))),
  ];
  for (const script of candidates) {
    const abs = resolve(projectDir, script);
    if (exists(abs)) return { command: 'node', args: [options.absolute ? posix(abs) : script] };
  }
  return GLOBAL_MCP_LAUNCH;
}

/** A launch as one shell-style line, for messages (`node node_modules/…/zxs-mcp.js`). */
export function formatLaunch(launch: McpLaunch): string {
  return [launch.command, ...(launch.args ?? [])].join(' ');
}

/** Where a project registers the server, and for which agent's `setup`. */
export interface McpRegistration {
  /** Project-relative file (`.mcp.json`, `.codex/config.toml`). */
  file: string;
  agent: 'claude' | 'codex';
  /** The launch read from the file, or undefined when the entry could not be read. */
  launch: McpLaunch | undefined;
}

/** The `[mcp_servers.zx-vibes]` header, bare or quoted. */
export const CODEX_TABLE_HEADER = new RegExp(
  `^\\s*\\[\\s*mcp_servers\\.(?:${MCP_SERVER_NAME}|"${MCP_SERVER_NAME}")\\s*\\]\\s*(?:#.*)?$`,
);

/** The `zx-vibes` launch in a `.mcp.json` text, null when absent, undefined when unreadable. */
function claudeLaunch(text: string): McpLaunch | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const servers = (parsed as { mcpServers?: unknown } | null)?.mcpServers;
  if (servers === null || typeof servers !== 'object') return null;
  const entry = (servers as Record<string, unknown>)[MCP_SERVER_NAME];
  if (entry === undefined) return null;
  const { command, args } = (entry ?? {}) as { command?: unknown; args?: unknown };
  if (typeof command !== 'string') return undefined;
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) return undefined;
  return args === undefined ? { command } : { command, args: args as string[] };
}

/**
 * The `zx-vibes` launch in a Codex `config.toml`: the `command`/`args` lines of its
 * `[mcp_servers.zx-vibes]` table (the form `setup` writes). Null when the table is
 * absent; undefined when it is there but not in that form.
 */
function codexLaunch(text: string): McpLaunch | null | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => CODEX_TABLE_HEADER.test(line));
  if (start < 0) return null;
  let command: string | undefined;
  let args: string[] | undefined;
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]!); i += 1) {
    const line = lines[i]!;
    const commandMatch = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line);
    if (commandMatch) command = JSON.parse(`"${commandMatch[1]}"`) as string;
    const argsMatch = /^\s*args\s*=\s*\[(.*)\]\s*(?:#.*)?$/.exec(line);
    if (argsMatch) {
      args = [...argsMatch[1]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    }
  }
  if (command === undefined) return undefined;
  return args === undefined ? { command } : { command, args };
}

/** The project's `zx-vibes` registrations (`.mcp.json`, `.codex/config.toml`), in that order. */
export function readMcpRegistrations(projectDir: string): McpRegistration[] {
  const sources = [
    { file: '.mcp.json', agent: 'claude' as const, read: claudeLaunch },
    { file: '.codex/config.toml', agent: 'codex' as const, read: codexLaunch },
  ];
  const found: McpRegistration[] = [];
  for (const source of sources) {
    const abs = join(projectDir, ...source.file.split('/'));
    if (!existsSync(abs)) continue;
    let text: string;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      found.push({ file: source.file, agent: source.agent, launch: undefined });
      continue;
    }
    const launch = source.read(text);
    if (launch === null) continue;
    found.push({ file: source.file, agent: source.agent, launch });
  }
  return found;
}

/** Why a launch would not start from `projectDir` with `pathValue`, or undefined when it would. */
function launchProblem(launch: McpLaunch, projectDir: string, pathValue: string, pathExtValue: string, platform: NodeJS.Platform): string | undefined {
  const { command } = launch;
  const resolves = isAbsolute(command)
    ? existsSync(command)
    : findCommandOnPath(command, pathValue, pathExtValue, platform).length > 0;
  if (!resolves) return `\`${command}\` is not on PATH outside npx`;
  const script = launch.args?.[0];
  if (command === 'node' && script !== undefined && /\.[cm]?js$/i.test(script)) {
    if (!existsSync(resolve(projectDir, script))) return `${script} does not exist`;
  }
  return undefined;
}

/** One `doctor` check result (structurally `DoctorCheck`). */
export interface McpCommandCheck {
  name: 'mcp-command';
  ok: boolean;
  detail: string;
}

/**
 * The `mcp-command` doctor check (CLI-PROD-DOCTOR-003): every `zx-vibes` registration
 * in the project must start with the PATH an MCP client sees — the given PATH without
 * npx's `node_modules/.bin` entries — and a `node` script argument must exist. No
 * registration passes (a CLI-only project is healthy).
 */
export function checkMcpRegistration(
  projectDir: string,
  pathValue = process.env.PATH ?? '',
  pathExtValue = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  platform: NodeJS.Platform = process.platform,
): McpCommandCheck {
  const registrations = readMcpRegistrations(projectDir);
  if (registrations.length === 0) {
    return {
      name: 'mcp-command',
      ok: true,
      detail: `No ${MCP_SERVER_NAME} MCP registration in this project (.mcp.json, .codex/config.toml)`,
    };
  }
  const clientPath = withoutNpxPath(pathValue);
  const problems: string[] = [];
  const good: string[] = [];
  for (const registration of registrations) {
    const fix = `run \`zxs setup --agent ${registration.agent} --force\``;
    if (registration.launch === undefined) {
      problems.push(`${registration.file}: the ${MCP_SERVER_NAME} entry has no readable command; ${fix}`);
      continue;
    }
    const problem = launchProblem(registration.launch, projectDir, clientPath, pathExtValue, platform);
    const shown = `\`${formatLaunch(registration.launch)}\``;
    if (problem === undefined) good.push(`${registration.file} starts ${MCP_SERVER_NAME} with ${shown}`);
    else problems.push(`${registration.file} starts ${MCP_SERVER_NAME} with ${shown}, but ${problem}; ${fix}`);
  }
  return problems.length > 0
    ? { name: 'mcp-command', ok: false, detail: problems.join('. ') }
    : { name: 'mcp-command', ok: true, detail: good.join('; ') };
}
