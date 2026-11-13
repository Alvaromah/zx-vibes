// `setup` and `doctor` against agent config files they did not write: a file they cannot
// read is never overwritten (it may hold the user's other MCP servers), a byte order mark
// is not a parse error, and a Codex TOML they cannot fully decode is a check result, not
// a crash.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliError } from '../src/output/envelope.js';
import { checkMcpRegistration, readMcpRegistrations } from '../src/setup/mcp-launch.js';
import { runSetup } from '../src/setup/setup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-setup-safety-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const mcpJson = (): string => join(dir, '.mcp.json');
const codexToml = (): string => join(dir, '.codex', 'config.toml');
function writeCodex(text: string): void {
  mkdirSync(join(dir, '.codex'), { recursive: true });
  writeFileSync(codexToml(), text);
}

describe('.mcp.json that setup did not write', () => {
  it('a UTF-8 byte order mark is not a parse error: the other servers are kept', () => {
    writeFileSync(mcpJson(), '\uFEFF{"mcpServers":{"other":{"command":"x"}}}');
    const env = runSetup({ agent: 'claude', cwd: dir });
    expect(env.installed).toContain('.mcp.json');
    const servers = (JSON.parse(readFileSync(mcpJson(), 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['other', 'zx-vibes']);
    expect(servers.other).toEqual({ command: 'x' });
  });

  for (const force of [false, true]) {
    it(`a file that is not JSON is never overwritten (force=${force})`, () => {
      // A trailing comma: common in hand-edited files, and it holds another server.
      const broken = '{ "mcpServers": { "other": { "command": "x" }, } }';
      writeFileSync(mcpJson(), broken);
      let thrown: unknown;
      try {
        runSetup({ agent: 'claude', cwd: dir, force });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CliError);
      expect((thrown as CliError).message).toMatch(/\.mcp\.json is not a JSON object/);
      expect(readFileSync(mcpJson(), 'utf8')).toBe(broken);
      // Raised before anything else was installed.
      expect(existsSync(join(dir, '.claude'))).toBe(false);
    });
  }

  it('a JSON file whose top level is not an object is refused the same way', () => {
    writeFileSync(mcpJson(), '[]');
    expect(() => runSetup({ agent: 'claude', cwd: dir, force: true })).toThrow(/not a JSON object/);
    expect(readFileSync(mcpJson(), 'utf8')).toBe('[]');
  });

  it('doctor names the unreadable file and does not prescribe --force', () => {
    writeFileSync(mcpJson(), '{ not json');
    const check = checkMcpRegistration(dir, '');
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/\.mcp\.json is not valid JSON/);
    expect(check.detail).not.toMatch(/--force/);
  });
});

describe('Codex config.toml that setup did not write', () => {
  it('a basic string with invalid escapes is an unreadable command, not a thrown error', () => {
    // A Windows path in a basic string: `\z` is not an escape (TOML wants '…' or \\).
    writeCodex('[mcp_servers.zx-vibes]\ncommand = "C:\\tools\\zxs-mcp.cmd"\n');
    const registrations = readMcpRegistrations(dir);
    expect(registrations).toEqual([{ file: '.codex/config.toml', agent: 'codex', launch: undefined }]);
    expect(checkMcpRegistration(dir, '').ok).toBe(false);
    // `setup` reads the same file for its `next` hints: it must not throw either.
    expect(runSetup({ agent: 'codex', cwd: dir, home: join(dir, 'home') }).ok).toBe(true);
  });

  it('a literal (single-quoted) command and args are read', () => {
    writeCodex("[mcp_servers.zx-vibes]\ncommand = 'node'\nargs = ['C:\\tools\\zxs-mcp.js']\n");
    expect(readMcpRegistrations(dir)[0]!.launch).toEqual({ command: 'node', args: ['C:\\tools\\zxs-mcp.js'] });
  });

  it('a comment that mentions the server does not count as a registration', () => {
    writeCodex('# mcp_servers.zx-vibes.command = "old"\nmodel = "x"\n');
    const env = runSetup({ agent: 'codex', cwd: dir, home: join(dir, 'home') });
    expect(env.installed).toContain('.codex/config.toml');
    const text = readFileSync(codexToml(), 'utf8');
    expect(text).toContain('# mcp_servers.zx-vibes.command = "old"');
    expect(text).toContain('model = "x"');
    expect(text).toMatch(/^\[mcp_servers\.zx-vibes\]$/m);
  });

  it('a real dotted-key definition still counts, so the table is not duplicated', () => {
    writeCodex('mcp_servers.zx-vibes.command = "zxs-mcp" # mine\n');
    const env = runSetup({ agent: 'codex', cwd: dir, home: join(dir, 'home') });
    expect(env.skipped).toContain('.codex/config.toml');
    expect(readFileSync(codexToml(), 'utf8')).not.toMatch(/^\[mcp_servers\.zx-vibes\]$/m);
  });
});
