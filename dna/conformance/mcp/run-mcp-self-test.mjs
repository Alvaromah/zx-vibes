#!/usr/bin/env node
// MCP server self-test (mcp-tools.md MCP-PROD-*) — the conformance counterpart of the
// toolkit vitest `mcp.test.ts`, run against the REAL built `zxs-mcp` over a live stdio
// transport (so it proves the wire protocol, not just the in-process catalog).
//
// It is dependency-free on purpose: it speaks newline-delimited JSON-RPC 2.0 to the
// spawned server directly (no SDK client import, which is not resolvable from the repo
// root), and it proves CLI<->MCP `.zxstate` interop through the REAL `zxs` CLI bin —
// the same two binaries an agent would use. Mirrors the placement/wiring of the other
// `*-self-test.mjs` runners (e.g. dna/conformance/cli/run-cli-fixtures-self-test.mjs).
//
// Asserts (MCP-PROD-AC-CATALOG-001 / -INTEROP-001 / -SANDBOX-001):
//   - the catalog is EXACTLY the seven tools with the spec input schemas,
//   - `zx_build` returns the build envelope shape (+ symbolsLoaded),
//   - `zx_screen` is multipart (image/png + JSON text grid),
//   - a `.zxstate` saved by the MCP `zx_state` loads via the CLI `zxs state load`,
//   - a `.zxstate` saved by the CLI loads via the MCP `zx_state load`,
//   - the `emulatorId` interop guard + the path sandbox reject bad inputs in-band.

import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const TOOLKIT = join(REPO_ROOT, 'packages', 'toolkit');
const MCP_BIN = join(TOOLKIT, 'bin', 'zxs-mcp.js');
const CLI_BIN = join(TOOLKIT, 'bin', 'zxs.js');
const PROTOCOL_VERSION = '2025-06-18';

const EXPECTED_TOOLS = ['zx_build', 'zx_run', 'zx_screen', 'zx_inspect', 'zx_debug', 'zx_keys', 'zx_state'];
const EXPECTED_SCHEMA = {
  zx_build: ['entry', 'outDir', 'assembler'],
  zx_run: ['bin', 'org', 'pc', 'sna', 'z80', 'tap', 'fresh', 'frames', 'untilPc', 'keys', 'detectHangs'],
  zx_screen: ['scale'],
  zx_inspect: ['memAddr', 'memLen'],
  zx_debug: ['action', 'spec', 'id', 'type', 'range', 'count', 'frames'],
  zx_keys: ['keys', 'typeText', 'extraFrames'],
  zx_state: ['action', 'file'],
};

// A program that pokes 0xAB at 0x9000 then settles into the HALT loop — a clean
// "the session state advanced and was carried through the .zxstate" sentinel.
const POKE_PROG = [
  'ORG 0x8000',
  'start:',
  '  ld a, 0xAB',
  '  ld (0x9000), a',
  '  ei',
  'loop:',
  '  halt',
  '  jr loop',
  '',
].join('\n');

let failures = 0;
function check(cond, message) {
  if (cond) {
    console.log(`  ok  ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${message}`);
  }
}

// --- a minimal newline-delimited JSON-RPC stdio MCP client ------------------

function startServer(cwd) {
  const child = spawn(process.execPath, [MCP_BIN], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: res, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else res(msg.result);
      }
    }
  });
  const request = (method, params) => {
    const id = nextId++;
    return new Promise((res, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}\n--- server stderr ---\n${stderr}`));
      }, 30000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          res(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };
  const close = () =>
    new Promise((res) => {
      const t = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
        res();
      }, 3000);
      child.on('exit', () => {
        clearTimeout(t);
        res();
      });
      try {
        child.stdin.end();
      } catch {
        /* already closed */
      }
    });
  return { request, notify, close, stderrText: () => stderr };
}

async function connect(cwd) {
  const server = startServer(cwd);
  await server.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mcp-self-test', version: '0' },
  });
  server.notify('notifications/initialized', {});
  return server;
}

function textOf(result) {
  const part = (result.content || []).find((c) => c.type === 'text');
  return part ? part.text : '';
}

// --- the CLI bin (interop counterpart) --------------------------------------

function runCli(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [CLI_BIN, ...args, '--json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, json: JSON.parse(out.trim()) };
  } catch (error) {
    const stdout = (error.stdout || '').toString().trim();
    let json = {};
    try {
      json = JSON.parse(stdout);
    } catch {
      /* non-JSON failure */
    }
    return { code: error.status ?? 1, json };
  }
}

// --- the run ----------------------------------------------------------------

async function main() {
  if (!existsSync(join(TOOLKIT, 'dist', 'mcp.js')) || !existsSync(join(TOOLKIT, 'dist', 'cli.js'))) {
    console.log('  building @zx-vibes/toolkit (dist missing) ...');
    execFileSync('pnpm', ['--filter', '@zx-vibes/toolkit', 'run', 'build'], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    });
  }

  const dir = mkdtempSync(join(tmpdir(), 'zxs-mcp-selftest-'));
  try {
    writeFileSync(join(dir, 'main.asm'), POKE_PROG);
    writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }, null, 2));

    // -- Session 1: catalog, delegation, multipart screen, MCP-side save -----
    console.log('catalog + delegation (stdio):');
    const s1 = await connect(dir);

    const list = await s1.request('tools/list', {});
    const names = (list.tools || []).map((t) => t.name).sort();
    check(names.length === 7, `tools/list returns exactly 7 tools (got ${names.length})`);
    check(
      JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
      `tool names are exactly ${EXPECTED_TOOLS.join(', ')}`,
    );
    for (const tool of list.tools || []) {
      const expected = EXPECTED_SCHEMA[tool.name];
      if (!expected) continue;
      const props = Object.keys((tool.inputSchema && tool.inputSchema.properties) || {}).sort();
      check(
        JSON.stringify(props) === JSON.stringify([...expected].sort()),
        `${tool.name} input schema params = [${expected.join(', ')}]`,
      );
    }

    const build = await s1.request('tools/call', { name: 'zx_build', arguments: { entry: 'main.asm' } });
    const buildEnv = JSON.parse(textOf(build));
    check(buildEnv.ok === true, 'zx_build assembled the entry (ok:true)');
    check(/main\.bin$/.test(buildEnv.outputs?.bin || ''), 'zx_build reports outputs.bin');
    check((buildEnv.symbolsLoaded || 0) > 0, 'zx_build loaded SLD symbols (symbolsLoaded > 0)');

    await s1.request('tools/call', { name: 'zx_run', arguments: { bin: 'build/main.bin', frames: 10 } });

    const screen = await s1.request('tools/call', { name: 'zx_screen', arguments: { scale: 2 } });
    const parts = screen.content || [];
    const image = parts.find((c) => c.type === 'image');
    const text = parts.find((c) => c.type === 'text');
    check(parts.length === 2 && !!image && !!text, 'zx_screen returns a multipart [image, text] result');
    check(!!image && image.mimeType === 'image/png' && (image.data || '').length > 0, 'zx_screen image part is image/png base64');
    const grid = text ? JSON.parse(text.text) : {};
    check(Array.isArray(grid.rows) && grid.rows.length === 24 && Array.isArray(grid.attrs), 'zx_screen JSON grid has rows + attrs');

    await s1.request('tools/call', { name: 'zx_debug', arguments: { action: 'break-add', spec: '0x8003' } });
    const save = await s1.request('tools/call', { name: 'zx_state', arguments: { action: 'save', file: 'snap.zxstate' } });
    check(JSON.parse(textOf(save)).op === 'save', 'zx_state save wrote snap.zxstate');

    await s1.close();

    // -- MCP -> CLI: the CLI bin loads the MCP-written .zxstate --------------
    console.log('interop MCP -> CLI:');
    check(existsSync(join(dir, 'snap.zxstate')), 'snap.zxstate exists on disk');
    const cliLoad = runCli(['state', 'load', 'snap.zxstate'], dir);
    check(cliLoad.code === 0 && cliLoad.json.ok === true, 'CLI `zxs state load snap.zxstate` succeeds (exit 0, ok:true)');
    check(cliLoad.json.op === 'load' && cliLoad.json.breakpoints >= 1, 'CLI load reports op:load and carries the breakpoint');

    // -- CLI -> MCP: a fresh MCP session loads the CLI-written .zxstate ------
    console.log('interop CLI -> MCP:');
    const cliSave = runCli(['state', 'save', 'cli.zxstate'], dir);
    check(cliSave.code === 0 && cliSave.json.ok === true, 'CLI `zxs state save cli.zxstate` succeeds');

    // A foreign-emulator file to prove the interop guard.
    writeFileSync(
      join(dir, 'foreign.zxstate'),
      JSON.stringify({ format: 'zxstate', emulatorId: 'other-emu', machine: { z80: '', halted: false, memptr: 0 }, debug: {} }),
    );

    const s2 = await connect(dir);
    const mcpLoad = await s2.request('tools/call', { name: 'zx_state', arguments: { action: 'load', file: 'cli.zxstate' } });
    check(!mcpLoad.isError && JSON.parse(textOf(mcpLoad)).op === 'load', 'MCP `zx_state load cli.zxstate` succeeds');

    const guard = await s2.request('tools/call', { name: 'zx_state', arguments: { action: 'load', file: 'foreign.zxstate' } });
    check(guard.isError === true && /different emulator|emulatorId/i.test(textOf(guard)), 'MCP rejects a foreign-emulator .zxstate (emulatorId guard)');

    const escape = await s2.request('tools/call', { name: 'zx_state', arguments: { action: 'save', file: '../escape.zxstate' } });
    check(escape.isError === true && /error:/.test(textOf(escape)), 'MCP rejects a "../" path (sandbox)');

    await s2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\nMCP self-test FAILED: ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nMCP self-test passed (catalog=7, delegation, multipart screen, CLI<->MCP .zxstate interop, guards).');
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exit(1);
});
