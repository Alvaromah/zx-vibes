// `zxs setup` — install the knowledge pack as native agent skills + register the
// thin MCP server (cli.md CLI-PROD-SETUP-001; knowledge-pack.md KP-PROD-PKG-001).
//
// `zxs setup --agent <codex|claude>` installs, into the current project (or, for
// Codex with `--write-global`, the user's global Codex config):
//   - the thin MCP snippet that registers the `zxs-mcp` stdio server under the MCP
//     name `zx-vibes` (mcp-tools.md MCP-PROD-SERVER-001/002), and
//   - the native skills registration carrying the minimal available knowledge — the
//     agent playbook (KP-PROD-CONTENT-PLAYBOOK-001), the same material `new`/`init`
//     emit (shared `PLAYBOOK` from the scaffold service).
//
// SCOPE FLAG (NOT silent, per the task's no-silent-debt rule, C5): the FULL knowledge
// pack — `reference/` docs generated from `dna/domain/` (KP-PROD-SOURCE-REF-001),
// the authored `skills/` (KP-PROD-CONTENT-SKILLS-001), the CI-gated `recipes/`
// (KP-PROD-CONTENT-RECIPES-001), and the `examples/` (KP-PROD-CONTENT-EXAMPLES-001) —
// is NOT yet generated in this repo, so `setup` installs the playbook now and reports
// the rest under `deferred[]`. Generating that pack (KP-PROD-AC-TRACE-001 traceability
// + KP-PROD-GROW-001 growth order) is the explicit follow-up.
//
// Idempotent + non-destructive (like `init`): a present managed file is preserved and
// reported under `skipped[]` unless `--force`; the `.mcp.json` registration is merged
// (other MCP servers are left intact). No failure is swallowed (ERR-PROD-NOSILENT-001).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { Command } from 'commander';
import { successEnvelope, userError, type SuccessEnvelope } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { PLAYBOOK } from '../scaffold/scaffold.js';

/** The supported agents (CLI-PROD-SETUP-001 `--agent <codex|claude>`). */
export type SetupAgent = 'claude' | 'codex';

/** The MCP server name the snippet registers (mcp-tools.md MCP-PROD-SERVER-001). */
export const MCP_SERVER_NAME = 'zx-vibes';
/** The bin that starts the stdio MCP server (cli.md CLI-PROD-PKG-003). */
export const MCP_SERVER_COMMAND = 'zxs-mcp';
/** The native skill installed by `setup` (Claude Code `/skills`, KP-PROD-PKG-001). */
export const SKILL_NAME = 'zx-vibes';

/**
 * The full knowledge-pack content NOT yet generatable from this repo — reported under
 * `deferred[]` so the gap is loud, never a silent absence (knowledge-pack.md C5).
 */
export const DEFERRED_PACK_CONTENT: ReadonlyArray<string> = [
  'reference/ — hardware/domain docs generated from dna/domain/ (KP-PROD-SOURCE-REF-001)',
  'skills/ — the authored hub-and-spoke skills (KP-PROD-CONTENT-SKILLS-001)',
  'recipes/ — the CI-gated recipe corpus (KP-PROD-CONTENT-RECIPES-001)',
  'examples/ — the worked tutorial + pong-by-agent proof (KP-PROD-CONTENT-EXAMPLES-001)',
];

/** The Claude Code project MCP registration body (`.mcp.json`). */
function mcpServerEntry(): { command: string } {
  return { command: MCP_SERVER_COMMAND };
}

/** The native Claude Code skill file (YAML front-matter + the playbook body). */
function skillMarkdown(): string {
  return [
    '---',
    `name: ${SKILL_NAME}`,
    'description: >-',
    '  Build, run, see, and prove ZX Spectrum 48K games with the zxs toolkit.',
    '  Never report success without running and looking.',
    '---',
    '',
    PLAYBOOK,
  ].join('\n');
}

/** The Codex config snippet (TOML) that registers the MCP server. */
function codexConfigToml(): string {
  return [
    '# zx-vibes MCP server — registered by `zxs setup --agent codex`.',
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = "${MCP_SERVER_COMMAND}"`,
    '',
  ].join('\n');
}

export type SetupEnvelope = SuccessEnvelope<{
  agent: SetupAgent;
  /** The registered MCP server name (`zx-vibes`). */
  mcpServer: string;
  /** Whether the Codex global config was targeted (`--write-global`). */
  global: boolean;
  /** Paths newly written or merged (portable, sorted). */
  installed: string[];
  /** Paths left untouched because they already existed (portable, sorted). */
  skipped: string[];
  /** The full-pack content not yet installable — the loud follow-up flag. */
  deferred: string[];
  force: boolean;
  next: string[];
}>;

export interface SetupOptions {
  /** `--agent <codex|claude>` (required). */
  agent: string;
  /** The project to install into (defaults to `process.cwd()`). */
  cwd?: string | undefined;
  /** `--force`: overwrite managed files instead of preserving present ones. */
  force?: boolean | undefined;
  /** `--write-global`: write the Codex GLOBAL config (codex only). */
  writeGlobal?: boolean | undefined;
  /** Home dir for the global Codex config (tests redirect it away from the real HOME). */
  home?: string | undefined;
}

/** Validate + normalize the `--agent` flag (an unknown / missing agent is a USER_ERROR). */
export function normalizeAgent(value: string | undefined): SetupAgent {
  const name = (value ?? '').trim().toLowerCase();
  if (name === 'claude' || name === 'claude-code') return 'claude';
  if (name === 'codex') return 'codex';
  throw userError(
    `setup requires --agent <codex|claude>${value ? ` (got "${value}")` : ''}`,
    'setup',
  );
}

/** One managed target: an absolute destination, its content, and the write strategy. */
interface Target {
  abs: string;
  content: string;
  /** `write` = create-if-absent / skip-if-present; `merge-mcp` = merge the MCP entry. */
  mode: 'write' | 'merge-mcp';
}

/**
 * Install the knowledge pack + MCP registration for an agent (CLI-PROD-SETUP-001).
 * Returns the `setup` envelope reporting installed vs skipped vs deferred. Always
 * succeeds (ok:true); an invalid `--agent` throws a USER_ERROR before any write.
 */
export function runSetup(options: SetupOptions): SetupEnvelope {
  const agent = normalizeAgent(options.agent);
  const cwd = resolve(options.cwd ?? process.cwd());
  const force = options.force ?? false;
  const writeGlobal = (options.writeGlobal ?? false) && agent === 'codex';
  const home = resolve(options.home ?? homedir());

  const targets: Target[] = agent === 'claude' ? claudeTargets(cwd) : codexTargets(cwd, home, writeGlobal);

  const installed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    const outcome = applyTarget(target, force);
    const label = portablePath(target.abs, cwd);
    (outcome === 'skipped' ? skipped : installed).push(label);
  }
  installed.sort();
  skipped.sort();

  return successEnvelope('setup', {
    agent,
    mcpServer: MCP_SERVER_NAME,
    global: writeGlobal,
    installed,
    skipped,
    deferred: [...DEFERRED_PACK_CONTENT],
    force,
    next:
      agent === 'claude'
        ? ['zxs verify --json', 'restart your agent to load the zx-vibes MCP server + skill']
        : ['zxs verify --json', 'restart Codex to load the zx-vibes MCP server'],
  });
}

/** The Claude Code target set: the project `.mcp.json` (merged) + the native skill. */
function claudeTargets(cwd: string): Target[] {
  return [
    { abs: resolve(cwd, '.mcp.json'), content: '', mode: 'merge-mcp' },
    {
      abs: resolve(cwd, '.claude', 'skills', SKILL_NAME, 'SKILL.md'),
      content: skillMarkdown(),
      mode: 'write',
    },
  ];
}

/** The Codex target set: the config TOML (project or global) + the playbook (AGENTS.md). */
function codexTargets(cwd: string, home: string, writeGlobal: boolean): Target[] {
  const configAbs = writeGlobal
    ? resolve(home, '.codex', 'config.toml')
    : resolve(cwd, '.codex', 'config.toml');
  const targets: Target[] = [{ abs: configAbs, content: codexConfigToml(), mode: 'write' }];
  // The playbook (the minimal available skill knowledge) always lands in the project.
  targets.push({ abs: resolve(cwd, 'AGENTS.md'), content: PLAYBOOK, mode: 'write' });
  return targets;
}

/** Apply one target; returns whether it was `installed` (written/merged) or `skipped`. */
function applyTarget(target: Target, force: boolean): 'installed' | 'skipped' {
  if (target.mode === 'merge-mcp') return mergeMcpRegistration(target.abs, force);
  if (!force && existsSync(target.abs)) return 'skipped';
  writeFileTo(target.abs, target.content);
  return 'installed';
}

/**
 * Merge the `zx-vibes` MCP server into an `.mcp.json` (Claude Code project config),
 * preserving any other servers. Idempotent: an already-registered server is `skipped`
 * unless `--force`. An existing-but-unparseable file is left untouched (skipped) unless
 * `--force` (never silently clobbered).
 */
function mergeMcpRegistration(abs: string, force: boolean): 'installed' | 'skipped' {
  const fresh = { mcpServers: { [MCP_SERVER_NAME]: mcpServerEntry() } };
  if (!existsSync(abs)) {
    writeFileTo(abs, `${JSON.stringify(fresh, null, 2)}\n`);
    return 'installed';
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    const raw = JSON.parse(readFileSync(abs, 'utf8')) as unknown;
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      parsed = raw as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    if (!force) return 'skipped';
    writeFileTo(abs, `${JSON.stringify(fresh, null, 2)}\n`);
    return 'installed';
  }
  const serversValue = parsed.mcpServers;
  const servers =
    serversValue !== null && typeof serversValue === 'object' && !Array.isArray(serversValue)
      ? (serversValue as Record<string, unknown>)
      : {};
  if (MCP_SERVER_NAME in servers && !force) return 'skipped';
  servers[MCP_SERVER_NAME] = mcpServerEntry();
  parsed.mcpServers = servers;
  writeFileTo(abs, `${JSON.stringify(parsed, null, 2)}\n`);
  return 'installed';
}

/** Write a file, creating parent directories as needed. */
function writeFileTo(abs: string, content: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** Make a path stable + portable: relative to `cwd` when inside it, `/`-separated. */
function portablePath(path: string, cwd: string): string {
  const abs = resolve(path);
  const rel = relative(cwd, abs);
  const chosen = rel === '' || rel.startsWith('..') || isAbsolute(rel) ? abs : rel;
  return chosen.split('\\').join('/');
}

// --- CLI wiring -------------------------------------------------------------

/** The `setup` command handler: maps the CLI context onto {@link runSetup}. */
export function setupCommand(context: CommandContext): SetupEnvelope {
  const options = context.options as {
    agent?: string;
    force?: boolean;
    writeGlobal?: boolean;
  };
  return runSetup({
    agent: options.agent ?? '',
    cwd: process.cwd(),
    force: options.force,
    writeGlobal: options.writeGlobal,
  });
}

/** Declare the `setup` command's flags (CLI-PROD-SETUP-001). */
export function configureSetupCommand(command: Command): void {
  command
    .description('Install the knowledge pack as native agent skills + register the MCP server')
    .option('--agent <name>', 'target agent: codex | claude')
    .option('--write-global', 'write the Codex GLOBAL config (codex only)')
    .option('--force', 'overwrite managed files instead of preserving present ones')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// `setupCommand` returns a success Envelope (an invalid agent throws a CliError the
// dispatcher renders); this assertion documents the registry contract.
const _setupCheck: (c: CommandContext) => SetupEnvelope = setupCommand;
void _setupCheck;
