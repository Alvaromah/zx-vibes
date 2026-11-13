// The MCP registration a project-local install needs, and the doctor check that catches
// a registration a client cannot start — cli.md CLI-PROD-SETUP-002 / CLI-PROD-DOCTOR-003.
// A local install has its bins only in node_modules/.bin, which an MCP client's PATH
// lacks, so the bare `zxs-mcp` an older setup wrote could not start, while
// `npx zxs doctor` passed because npx puts node_modules/.bin on PATH.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/doctor/doctor.js';
import {
  checkMcpRegistration,
  localNodeModules,
  mcpLaunchFor,
  readMcpRegistrations,
} from '../src/setup/mcp-launch.js';
import { runSetup } from '../src/setup/setup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-mcp-launch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const WORKSPACE_TOOLKIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLKIT_SCRIPT = 'node_modules/@zx-vibes/toolkit/bin/zxs-mcp.js';
const UMBRELLA_SCRIPT = 'node_modules/zx-vibes/bin/zxs-mcp.js';

function write(rel: string, content = '', mode?: number): string {
  const abs = join(dir, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, mode === undefined ? undefined : { mode });
  return abs;
}

/** A fake toolkit package (package.json + bin) at `rel`; returns its root. */
function fakeToolkit(rel: string): string {
  write(`${rel}/package.json`, JSON.stringify({ name: '@zx-vibes/toolkit' }));
  write(`${rel}/bin/zxs-mcp.js`, '');
  return join(dir, ...rel.split('/'));
}

/** A command file on a fake PATH entry (all three npm shim names, executable). */
function fakeBin(binDir: string, name: string): void {
  for (const file of [name, `${name}.cmd`]) write(`${binDir}/${file}`, '', 0o755);
}

describe('localNodeModules / mcpLaunchFor — which install runs setup (CLI-PROD-SETUP-002)', () => {
  it('npm: the toolkit in the project node_modules → node + the toolkit bin by package path', () => {
    const toolkit = fakeToolkit('app/node_modules/@zx-vibes/toolkit');
    const app = join(dir, 'app');
    expect(localNodeModules(app, toolkit)).toBe('node_modules');
    expect(mcpLaunchFor(app, toolkit)).toEqual({ command: 'node', args: [TOOLKIT_SCRIPT] });
  });

  it('pnpm with only the umbrella installed: the umbrella bin (stable across upgrades)', () => {
    const toolkit = fakeToolkit('app/node_modules/.pnpm/@zx-vibes+toolkit@0.8.0/node_modules/@zx-vibes/toolkit');
    write('app/node_modules/zx-vibes/bin/zxs-mcp.js');
    const app = join(dir, 'app');
    expect(localNodeModules(app, toolkit)).toBe('node_modules');
    expect(mcpLaunchFor(app, toolkit)).toEqual({ command: 'node', args: [UMBRELLA_SCRIPT] });
  });

  it('pnpm store only: falls back to the running toolkit path', () => {
    const toolkit = fakeToolkit('app/node_modules/.pnpm/t@1/node_modules/@zx-vibes/toolkit');
    expect(mcpLaunchFor(join(dir, 'app'), toolkit)).toEqual({
      command: 'node',
      args: ['node_modules/.pnpm/t@1/node_modules/@zx-vibes/toolkit/bin/zxs-mcp.js'],
    });
  });

  it('a workspace sub-project uses the parent node_modules', () => {
    const toolkit = fakeToolkit('ws/node_modules/@zx-vibes/toolkit');
    mkdirSync(join(dir, 'ws', 'games', 'pong'), { recursive: true });
    const pong = join(dir, 'ws', 'games', 'pong');
    expect(localNodeModules(pong, toolkit)).toBe('../../node_modules');
    expect(mcpLaunchFor(pong, toolkit)).toEqual({ command: 'node', args: [`../../${TOOLKIT_SCRIPT}`] });
  });

  it('a linked toolkit (npm link, file: directory) counts as installed in the project', () => {
    const toolkit = fakeToolkit('checkout/packages/toolkit');
    mkdirSync(join(dir, 'app', 'node_modules', '@zx-vibes'), { recursive: true });
    symlinkSync(toolkit, join(dir, 'app', 'node_modules', '@zx-vibes', 'toolkit'), 'junction');
    expect(mcpLaunchFor(join(dir, 'app'), toolkit)).toEqual({ command: 'node', args: [TOOLKIT_SCRIPT] });
  });

  it('a global install or a checkout run by path keeps the bare zxs-mcp', () => {
    const toolkit = fakeToolkit('global/lib/node_modules/zx-vibes/node_modules/@zx-vibes/toolkit');
    mkdirSync(join(dir, 'app'), { recursive: true });
    expect(localNodeModules(join(dir, 'app'), toolkit)).toBeUndefined();
    expect(mcpLaunchFor(join(dir, 'app'), toolkit)).toEqual({ command: 'zxs-mcp' });
    expect(mcpLaunchFor(join(dir, 'app'), WORKSPACE_TOOLKIT)).toEqual({ command: 'zxs-mcp' });
    expect(mcpLaunchFor(join(dir, 'app'), undefined)).toEqual({ command: 'zxs-mcp' });
  });

  it('absolute: a config that serves every project gets the script by absolute path', () => {
    const toolkit = fakeToolkit('app/node_modules/@zx-vibes/toolkit');
    const launch = mcpLaunchFor(join(dir, 'app'), toolkit, undefined, { absolute: true });
    expect(launch.command).toBe('node');
    expect(resolve(launch.args![0]!)).toBe(resolve(dir, 'app', ...TOOLKIT_SCRIPT.split('/')));
    expect(launch.args![0]).not.toContain('\\');
  });
});

describe('runSetup — the registration follows the install (CLI-PROD-SETUP-002)', () => {
  it('claude: .mcp.json starts a local install with node, and says so', () => {
    const toolkit = fakeToolkit('node_modules/@zx-vibes/toolkit');
    const env = runSetup({ agent: 'claude', cwd: dir, toolkitRoot: toolkit });
    expect(env.mcpCommand).toBe(`node ${TOOLKIT_SCRIPT}`);
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers['zx-vibes']).toEqual({ command: 'node', args: [TOOLKIT_SCRIPT] });
  });

  it('codex: the TOML table carries command and args', () => {
    const toolkit = fakeToolkit('node_modules/@zx-vibes/toolkit');
    runSetup({ agent: 'codex', cwd: dir, toolkitRoot: toolkit, home: join(dir, 'home') });
    const toml = readFileSync(join(dir, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('[mcp_servers.zx-vibes]');
    expect(toml).toContain('command = "node"');
    expect(toml).toContain(`args = ["${TOOLKIT_SCRIPT}"]`);
    expect(readMcpRegistrations(dir)).toEqual([
      { file: '.codex/config.toml', agent: 'codex', launch: { command: 'node', args: [TOOLKIT_SCRIPT] } },
    ]);
  });

  it('a kept stale entry is reported with the --force fix; --force replaces it', () => {
    const toolkit = fakeToolkit('node_modules/@zx-vibes/toolkit');
    write('.mcp.json', JSON.stringify({ mcpServers: { other: { command: 'x' }, 'zx-vibes': { command: 'zxs-mcp' } } }));
    const kept = runSetup({ agent: 'claude', cwd: dir, toolkitRoot: toolkit });
    expect(kept.skipped).toContain('.mcp.json');
    expect(kept.next[0]).toMatch(/^zxs setup --agent claude --force /);
    expect(kept.next[0]).toContain('`zxs-mcp`');
    expect(kept.next[0]).toContain(`\`node ${TOOLKIT_SCRIPT}\``);

    const forced = runSetup({ agent: 'claude', cwd: dir, toolkitRoot: toolkit, force: true });
    expect(forced.installed).toContain('.mcp.json');
    expect(forced.next[0]).toBe('zxs verify --json');
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers).toEqual({
      other: { command: 'x' },
      'zx-vibes': { command: 'node', args: [TOOLKIT_SCRIPT] },
    });
  });
});

describe('doctor mcp-command — the registration starts outside npx (CLI-PROD-DOCTOR-003)', () => {
  const nodeDir = dirname(process.execPath);

  it('passes when the project registers nothing (a CLI-only project)', () => {
    const check = checkMcpRegistration(dir, '');
    expect(check).toMatchObject({ name: 'mcp-command', ok: true });
    expect(runDoctor({ cwd: dir, pathValue: '' }).checks.map((c) => c.name)).toContain('mcp-command');
  });

  it('fails a bare zxs-mcp that only node_modules/.bin provides, and names the fix', () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { 'zx-vibes': { command: 'zxs-mcp' } } }));
    fakeBin('node_modules/.bin', 'zxs-mcp');
    const npxPath = [join(dir, 'node_modules', '.bin'), nodeDir].join(delimiter);
    const check = checkMcpRegistration(dir, npxPath);
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('.mcp.json starts zx-vibes with `zxs-mcp`');
    expect(check.detail).toContain('not on PATH outside npx');
    expect(check.detail).toContain('zxs setup --agent claude --force');

    // runDoctor turns it into the failing envelope (exit 3, CLI-PROD-OUT-DOCTOR-001).
    const env = runDoctor({ cwd: dir, pathValue: npxPath });
    expect(env.ok).toBe(false);
    expect(env.checks.find((c) => c.name === 'mcp-command')?.ok).toBe(false);
  });

  it('passes a bare zxs-mcp that a global install puts on PATH', () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { 'zx-vibes': { command: 'zxs-mcp' } } }));
    fakeBin('global/bin', 'zxs-mcp');
    expect(checkMcpRegistration(dir, join(dir, 'global', 'bin')).ok).toBe(true);
  });

  it('checks a node launch: node on PATH and the script present', () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { 'zx-vibes': { command: 'node', args: [TOOLKIT_SCRIPT] } } }));
    const missing = checkMcpRegistration(dir, nodeDir);
    expect(missing.ok).toBe(false);
    expect(missing.detail).toContain(`${TOOLKIT_SCRIPT} does not exist`);

    write(TOOLKIT_SCRIPT);
    const ok = checkMcpRegistration(dir, nodeDir);
    expect(ok.ok).toBe(true);
    expect(ok.detail).toContain(`\`node ${TOOLKIT_SCRIPT}\``);
  });

  it('reads the codex TOML and fails an entry it cannot read', () => {
    write('.codex/config.toml', '[mcp_servers.zx-vibes]\ncommand = "zxs-mcp"\n');
    const codex = checkMcpRegistration(dir, '');
    expect(codex.ok).toBe(false);
    expect(codex.detail).toContain('zxs setup --agent codex --force');

    write('.codex/config.toml', '[mcp_servers.zx-vibes]\nenv = { A = "1" }\n');
    expect(checkMcpRegistration(dir, nodeDir).detail).toContain('no readable command');
  });
});

describe('the registered launch starts the real server (client-independent)', () => {
  it('node <script> from the project, with PATH free of node_modules/.bin, lists the seven tools', async () => {
    // A project whose node_modules links this workspace's toolkit (built dist required).
    mkdirSync(join(dir, 'node_modules', '@zx-vibes'), { recursive: true });
    symlinkSync(WORKSPACE_TOOLKIT, join(dir, 'node_modules', '@zx-vibes', 'toolkit'), 'junction');
    runSetup({ agent: 'claude', cwd: dir, toolkitRoot: WORKSPACE_TOOLKIT });
    const entry = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')).mcpServers['zx-vibes'];
    expect(entry).toEqual({ command: 'node', args: [TOOLKIT_SCRIPT] });

    const tools = await listTools(entry.command, entry.args, dir);
    expect(tools).toEqual(['zx_build', 'zx_run', 'zx_screen', 'zx_inspect', 'zx_debug', 'zx_keys', 'zx_state']);
  }, 30_000);
});

/** Spawn an MCP stdio server like a client (no shell), initialize, and list its tools. */
function listTools(command: string, args: string[], cwd: string): Promise<string[]> {
  const path = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => !/node_modules[\\/]\.bin/i.test(entry))
    .join(delimiter);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, PATH: path }, shell: false });
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('MCP server did not answer'));
    }, 20_000);
    let tools: string[] | undefined;
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    // Resolve once the server has exited, so the project directory is free to delete.
    child.on('exit', () => {
      clearTimeout(timer);
      if (tools !== undefined) resolvePromise(tools);
      else reject(new Error('MCP server exited before listing its tools'));
    });
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('utf8');
      for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const message = JSON.parse(line) as { id?: number; result?: { tools?: Array<{ name: string }> } };
        if (message.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
        } else if (message.id === 2) {
          tools = (message.result?.tools ?? []).map((tool) => tool.name);
          child.kill();
        }
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      })}\n`,
    );
  });
}
