// `setup` knowledge-pack + MCP install (Slice 11a) — cli.md CLI-PROD-SETUP-001;
// knowledge-pack.md KP-PROD-PKG-001 / KP-PROD-CONTENT-PLAYBOOK-001. Proves: installs
// the thin MCP snippet (registers `zxs-mcp` under name `zx-vibes`) + the native skill
// (the minimal available playbook) into a temp project; idempotent + non-destructive
// (installed-vs-skipped); merges `.mcp.json`; flags the full pack under `deferred[]`.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSetup } from '../src/setup/setup.js';
import { runCli } from '../src/cli.js';
import { CliError, ExitCode, type OutputStreams } from '../src/output/envelope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-setup-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const o: string[] = [];
  const e: string[] = [];
  return {
    streams: { out: (t) => o.push(t), err: (t) => e.push(t) },
    out: () => o.join(''),
    err: () => e.join(''),
  };
}

async function cliInDir(cwd: string, argv: string[], streams: OutputStreams): Promise<number> {
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    return await runCli(argv, { streams });
  } finally {
    process.chdir(prev);
  }
}

describe('runSetup --agent claude (CLI-PROD-SETUP-001 / KP-PROD-PKG-001)', () => {
  it('installs the MCP snippet + the native skill, flags the full pack as deferred', () => {
    const env = runSetup({ agent: 'claude', cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.stage).toBe('setup');
    expect(env.agent).toBe('claude');
    expect(env.mcpServer).toBe('zx-vibes');
    expect(env.installed).toContain('.mcp.json');
    expect(env.installed).toContain('.claude/skills/zx-vibes/SKILL.md');
    expect(env.skipped).toEqual([]);
    // The full pack (reference/skills/recipes/examples) is flagged, not silently absent.
    expect(env.deferred.length).toBeGreaterThan(0);
    expect(env.deferred.join('\n')).toMatch(/reference\//);

    // The MCP registration is the thin `zxs-mcp` stdio server under name `zx-vibes`.
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers['zx-vibes']).toEqual({ command: 'zxs-mcp' });

    // The native skill carries the playbook (the minimal available knowledge).
    const skill = readFileSync(join(dir, '.claude', 'skills', 'zx-vibes', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---/); // YAML front-matter
    expect(skill).toMatch(/name: zx-vibes/);
    expect(skill).toMatch(/never report success without running and looking/i);
  });

  it('is idempotent: a second run skips everything it already wrote', () => {
    const first = runSetup({ agent: 'claude', cwd: dir });
    expect(first.installed.length).toBeGreaterThan(0);
    const second = runSetup({ agent: 'claude', cwd: dir });
    expect(second.installed).toEqual([]);
    expect([...second.skipped].sort()).toEqual([...first.installed].sort());
  });

  it('merges into an existing .mcp.json, preserving other servers', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-mcp' } } }, null, 2),
      'utf8',
    );
    const env = runSetup({ agent: 'claude', cwd: dir });
    // The pre-existing .mcp.json was MERGED (installed), not skipped.
    expect(env.installed).toContain('.mcp.json');
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.other).toEqual({ command: 'other-mcp' }); // preserved
    expect(mcp.mcpServers['zx-vibes']).toEqual({ command: 'zxs-mcp' }); // added
  });

  it('a second merge run is idempotent (zx-vibes already registered → skipped)', () => {
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'other-mcp' } } }, null, 2),
      'utf8',
    );
    runSetup({ agent: 'claude', cwd: dir });
    const again = runSetup({ agent: 'claude', cwd: dir });
    expect(again.installed).not.toContain('.mcp.json');
    expect(again.skipped).toContain('.mcp.json');
  });

  it('--force overwrites the managed skill file', () => {
    runSetup({ agent: 'claude', cwd: dir });
    const skillPath = join(dir, '.claude', 'skills', 'zx-vibes', 'SKILL.md');
    writeFileSync(skillPath, 'STALE', 'utf8');
    const env = runSetup({ agent: 'claude', cwd: dir, force: true });
    expect(env.installed).toContain('.claude/skills/zx-vibes/SKILL.md');
    expect(readFileSync(skillPath, 'utf8')).toMatch(/name: zx-vibes/);
  });
});

describe('runSetup --agent codex (CLI-PROD-SETUP-001)', () => {
  it('installs the Codex config (MCP server) + the playbook into the project', () => {
    const env = runSetup({ agent: 'codex', cwd: dir });
    expect(env.ok).toBe(true);
    expect(env.agent).toBe('codex');
    expect(env.global).toBe(false);
    expect(env.installed).toContain('.codex/config.toml');
    expect(env.installed).toContain('AGENTS.md');

    const toml = readFileSync(join(dir, '.codex', 'config.toml'), 'utf8');
    expect(toml).toMatch(/\[mcp_servers\.zx-vibes\]/);
    expect(toml).toMatch(/command = "zxs-mcp"/);
  });

  it('--write-global writes the Codex GLOBAL config under the (injected) home dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'zxs-home-'));
    try {
      const env = runSetup({ agent: 'codex', cwd: dir, writeGlobal: true, home });
      expect(env.global).toBe(true);
      const globalConfig = join(home, '.codex', 'config.toml');
      expect(existsSync(globalConfig)).toBe(true);
      expect(readFileSync(globalConfig, 'utf8')).toMatch(/\[mcp_servers\.zx-vibes\]/);
      // The project config was NOT written when targeting the global config.
      expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('runSetup — invalid agent (USER_ERROR)', () => {
  it('throws a USER_ERROR for a missing / unknown agent', () => {
    for (const bad of ['', 'cursor', 'vim']) {
      expect(() => runSetup({ agent: bad, cwd: dir })).toThrowError(CliError);
    }
  });
});

describe('zxs setup --agent claude --json — CLI end-to-end', () => {
  it('exits 0 and prints a single JSON envelope', async () => {
    const cap = capture();
    const code = await cliInDir(dir, ['setup', '--agent', 'claude', '--json'], cap.streams);
    expect(code).toBe(ExitCode.OK);
    const lines = cap.out().trim().split('\n');
    expect(lines).toHaveLength(1);
    const env = JSON.parse(lines[0]!);
    expect(env).toMatchObject({ ok: true, stage: 'setup', agent: 'claude', mcpServer: 'zx-vibes' });
    expect(existsSync(join(dir, '.mcp.json'))).toBe(true);
    expect(cap.err()).toBe('');
  });

  it('setup without --agent exits 1 (USER_ERROR)', async () => {
    const cap = capture();
    const code = await cliInDir(dir, ['setup', '--json'], cap.streams);
    expect(code).toBe(ExitCode.USER_ERROR);
    expect(JSON.parse(cap.out().trim())).toMatchObject({ ok: false, stage: 'setup' });
  });
});
