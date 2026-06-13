import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { EXIT, emit } from '../output.js';

export interface SetupCommandOptions {
  agent: 'codex' | 'claude';
  writeGlobal: boolean;
  json: boolean;
}

export function setupCommand(opts: SetupCommandOptions): number {
  const snippet = opts.agent === 'codex' ? codexToml() : claudeJson();

  if (opts.agent === 'codex' && opts.writeGlobal) {
    const configPath = join(homedir(), '.codex', 'config.toml');
    mkdirSync(dirname(configPath), { recursive: true });
    if (existsSync(configPath)) {
      const backup = `${configPath}.bak-zx-vibes-${timestamp()}`;
      copyFileSync(configPath, backup);
      const current = readFileSync(configPath, 'utf8');
      if (!current.includes('[mcp_servers.zx_vibes]')) {
        writeFileSync(configPath, `${current.trimEnd()}\n\n${snippet}\n`);
      }
      return ok(opts, snippet, configPath, backup);
    }
    writeFileSync(configPath, `${snippet}\n`);
    return ok(opts, snippet, configPath);
  }

  if (opts.agent === 'claude') {
    writeFileSync('.mcp.json', `${snippet}\n`);
    return ok(opts, snippet, '.mcp.json');
  }

  return ok(opts, snippet);
}

function ok(opts: SetupCommandOptions, snippet: string, written?: string, backup?: string): number {
  emit(
    { ok: true, stage: 'setup', agent: opts.agent, snippet, ...(written ? { written } : {}), ...(backup ? { backup } : {}) },
    opts.json,
    () =>
      written
        ? `Configured ${opts.agent} MCP at ${written}` + (backup ? `\nBackup: ${backup}` : '')
        : snippet
  );
  return EXIT.OK;
}

function codexToml(): string {
  return [
    '[mcp_servers.zx_vibes]',
    'command = "pnpm"',
    'args = ["exec", "zxs-mcp"]',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 300',
  ].join('\n');
}

function claudeJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        zx_vibes: {
          command: 'pnpm',
          args: ['exec', 'zxs-mcp'],
        },
      },
    },
    null,
    2
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
