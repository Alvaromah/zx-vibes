// Slice 10 — the `zxs-mcp` MCP server (mcp-tools.md MCP-PROD-*).
//
// Asserts the contract a regenerated server MUST hold: the catalog is EXACTLY the
// seven tools with the spec input schemas (MCP-PROD-AC-CATALOG-001), each tool
// DELEGATES to the existing toolkit service (thin skin), `zx_screen` is multipart,
// the in-memory session is persistent (breakpoints accumulate; a run advances it),
// and `.zxstate` interops with the CLI state path both ways (MCP-PROD-AC-INTEROP-001)
// with the `emulatorId` guard + the path sandbox (MCP-PROD-AC-SANDBOX-001).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { assemble } from '@zx-vibes/asm';
import { writeZ80 } from '@zx-vibes/machine';
import { buildCatalog, createMcpServer, McpSession, MCP_TOOL_NAMES, type McpTool } from '../src/mcp.js';
import { tapImageBytes } from '../src/build/formats.js';
import { deserializeZxState } from '../src/state/zxstate.js';
import { loadDebugStore, loadSession } from '../src/state/persist.js';
import { runStateSave } from '../src/state/state-command.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-mcp-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A session-bound catalog rooted at the temp dir. */
function catalog(): { session: McpSession; tools: Map<string, McpTool> } {
  const session = new McpSession(dir);
  const tools = new Map(buildCatalog(session).map((t) => [t.name, t]));
  return { session, tools };
}

function call(tools: Map<string, McpTool>, name: string, args: Record<string, unknown> = {}): CallToolResult {
  return tools.get(name)!.handler(args);
}

/** Parse the JSON text part of a (non-error) tool result. */
function jsonOf(result: CallToolResult): Record<string, unknown> {
  const part = result.content.find((c) => c.type === 'text');
  if (!part || part.type !== 'text') throw new Error('no text content part');
  return JSON.parse(part.text);
}

// A program that pokes 0xAB at 0x9000 then settles into the interrupt-paced HALT loop
// (so a bounded run is halt-synced, never a hang) — a clean "state advanced" sentinel.
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

function project(): void {
  writeFileSync(join(dir, 'main.asm'), POKE_PROG);
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }));
}

// =========================================================================
// Catalog — exactly seven tools with the spec schemas (MCP-PROD-AC-CATALOG-001)
// =========================================================================

describe('catalog (MCP-PROD-SERVER-003 / MCP-PROD-AC-CATALOG-001)', () => {
  it('registers EXACTLY the seven tools, no more no fewer', () => {
    const { tools } = catalog();
    expect([...tools.keys()].sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(tools.size).toBe(7);
  });

  it('each tool exposes the exact input-parameter set from the spec', () => {
    const { tools } = catalog();
    const keys = (name: string): string[] => Object.keys(tools.get(name)!.inputSchema).sort();
    expect(keys('zx_build')).toEqual(['assembler', 'entry', 'outDir'].sort());
    expect(keys('zx_run')).toEqual(
      ['bin', 'org', 'pc', 'sna', 'z80', 'tap', 'fresh', 'frames', 'untilPc', 'keys', 'detectHangs'].sort(),
    );
    expect(keys('zx_screen')).toEqual(['scale']);
    expect(keys('zx_inspect')).toEqual(['memAddr', 'memLen'].sort());
    expect(keys('zx_debug')).toEqual(['action', 'spec', 'id', 'type', 'range', 'count', 'frames'].sort());
    expect(keys('zx_keys')).toEqual(['extraFrames', 'keys', 'typeText'].sort());
    expect(keys('zx_state')).toEqual(['action', 'file'].sort());
  });

  it('input schemas enforce the documented bounds (scale 1..4, debug action enum)', () => {
    const { tools } = catalog();
    const scale = tools.get('zx_screen')!.inputSchema.scale!;
    expect(scale.safeParse(2).success).toBe(true);
    expect(scale.safeParse(5).success).toBe(false);
    const action = tools.get('zx_debug')!.inputSchema.action!;
    expect(action.safeParse('break-add').success).toBe(true);
    expect(action.safeParse('verify').success).toBe(false);
  });

  it('createMcpServer wires the same seven tools onto a `zx-vibes` McpServer', () => {
    const { server, catalog: cat } = createMcpServer({ cwd: dir });
    expect(cat.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    expect(server).toBeDefined();
  });
});

// =========================================================================
// Delegation — each tool returns its service's shape (thin skin)
// =========================================================================

describe('zx_build delegates to the build service (MCP-PROD-OUT-BUILD-001)', () => {
  it('assembles the entry, reports outputs.bin, and loads SLD symbols', () => {
    project();
    const { tools } = catalog();
    const env = jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    expect(env.ok).toBe(true);
    expect((env.outputs as { bin?: string }).bin).toMatch(/main\.bin$/);
    expect(env.symbolsLoaded as number).toBeGreaterThan(0);
    expect(Array.isArray(env.errors)).toBe(true);
  });

  it('a build with assembly errors returns ok:false with the errors (in-band)', () => {
    writeFileSync(join(dir, 'bad.asm'), 'ORG 0x8000\n  this is not z80\n');
    const { tools } = catalog();
    const res = call(tools, 'zx_build', { entry: 'bad.asm' });
    expect(res.isError).toBeFalsy(); // a diagnostics build is a normal report, not a tool error
    const env = jsonOf(res);
    expect(env.ok).toBe(false);
    expect((env.errors as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('zx_screen is multipart (MCP-PROD-OUT-SCREEN-001)', () => {
  it('returns an image/png part plus a JSON text grid', () => {
    const { tools } = catalog();
    const res = call(tools, 'zx_screen', { scale: 2 });
    expect(res.content).toHaveLength(2);
    const image = res.content[0]!;
    expect(image.type).toBe('image');
    if (image.type === 'image') {
      expect(image.mimeType).toBe('image/png');
      expect(image.data.length).toBeGreaterThan(0);
    }
    const grid = jsonOf(res);
    expect(Array.isArray(grid.rows)).toBe(true);
    expect((grid.rows as string[]).length).toBe(24);
    expect(typeof grid.nonBlankCells).toBe('number');
    expect(typeof grid.borderColor).toBe('number');
    expect((grid.attrs as string[]).length).toBe(24);
  });
});

describe('zx_inspect returns the full register set (MCP-PROD-OUT-INSPECT-001)', () => {
  it('flattens the shadow registers and omits a memory dump when no addr given', () => {
    const { tools } = catalog();
    const out = jsonOf(call(tools, 'zx_inspect', {}));
    const regs = out.registers as Record<string, unknown>;
    for (const k of ['pc', 'sp', 'af', 'bc', 'de', 'hl', 'afPrime', 'bcPrime', 'dePrime', 'hlPrime', 'ix', 'iy', 'i', 'r', 'im', 'iff1', 'halted']) {
      expect(regs).toHaveProperty(k);
    }
    expect(out.memory).toBeUndefined();
  });

  it('includes a { addr, hex, ascii } dump when memAddr is given', () => {
    const { tools } = catalog();
    const out = jsonOf(call(tools, 'zx_inspect', { memAddr: '0x0000', memLen: 4 }));
    const mem = out.memory as { addr: number; hex: string; ascii: string };
    expect(mem.addr).toBe(0);
    expect(mem.hex.split(' ')).toHaveLength(4);
    expect(typeof mem.ascii).toBe('string');
  });
});

// =========================================================================
// Persistent session — a run advances it; the screen/inspect reflect it
// =========================================================================

describe('persistent session (MCP-PROD-SERVER-004)', () => {
  it('zx_run advances the live session in place (the poke is observable afterwards)', () => {
    project();
    const { session, tools } = catalog();
    jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    const run = jsonOf(call(tools, 'zx_run', { bin: 'build/main.bin', frames: 10 }));
    expect(run.ok).toBe(true);
    expect(run.status).toBe('ok');
    expect(run.framesRun as number).toBeGreaterThan(0);
    // The same hot machine carries the program's memory write across tool calls.
    expect(session.machine.memory[0x9000]).toBe(0xab);
    const ins = jsonOf(call(tools, 'zx_inspect', { memAddr: '0x9000', memLen: 1 }));
    expect((ins.memory as { hex: string }).hex).toBe('AB');
  });

  it('zx_keys injects input and returns a run report with hang detection disabled', () => {
    const { tools } = catalog();
    const env = jsonOf(call(tools, 'zx_keys', { typeText: 'A', extraFrames: 5 }));
    expect(env.stage).toBe('run');
    expect(env.framesRun as number).toBeGreaterThan(0);
  });
});

// =========================================================================
// zx_run file sources — z80/tap wired, sna fail-loud (D7, MCP-PROD-TOOL-RUN-001)
// =========================================================================

describe('zx_run file sources (MCP-PROD-TOOL-RUN-001)', () => {
  function z80(name: string): string {
    const result = assemble(POKE_PROG);
    if (!result.ok) throw new Error('asm failed');
    const memory = new Uint8Array(0x10000);
    memory.set(result.bytes, result.origin);
    writeFileSync(join(dir, name), Buffer.from(writeZ80({ registers: { pc: result.origin, sp: 0xff00 }, memory, border: 1 })));
    return name;
  }

  it('zx_run { z80 } boots the snapshot into the hot session and runs it', () => {
    const { session, tools } = catalog();
    const file = z80('game.z80');
    const env = jsonOf(call(tools, 'zx_run', { z80: file, frames: 10 }));
    expect(env.ok).toBe(true);
    expect((env.boot as { source: string; version?: number }).source).toBe('z80');
    expect(session.machine.memory[0x9000]).toBe(0xab);
  });

  it('zx_run { tap } instant-loads a CODE tape into the hot session and runs it', () => {
    const { session, tools } = catalog();
    const result = assemble(POKE_PROG);
    if (!result.ok) throw new Error('asm failed');
    writeFileSync(
      join(dir, 'game.tap'),
      Buffer.from(tapImageBytes({ bytes: result.bytes, loadAddress: result.origin, name: 'game' })),
    );
    const env = jsonOf(call(tools, 'zx_run', { tap: 'game.tap', frames: 10 }));
    expect((env.boot as { source: string }).source).toBe('tap');
    expect(session.machine.memory[0x9000]).toBe(0xab);
  });

  it('zx_run { sna } fails loud in-band with the missing-codec message (W4-GAP-03)', () => {
    const { tools } = catalog();
    writeFileSync(join(dir, 'game.sna'), Buffer.alloc(49179));
    const res = call(tools, 'zx_run', { sna: 'game.sna' });
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/\.sna codec/);
    expect(text).toMatch(/W4-GAP-03/);
  });
});

// =========================================================================
// zx_debug — break/watch accumulate (and share the .zxs/ store with the CLI)
// =========================================================================

describe('zx_debug accumulates breakpoints across calls (MCP-PROD-TOOL-DEBUG-002)', () => {
  it('break-add then break-list sees it; it hits the shared .zxs/ store', () => {
    const { session, tools } = catalog();
    const add = jsonOf(call(tools, 'zx_debug', { action: 'break-add', spec: '0x8003' }));
    expect(add.op).toBe('add');
    expect((add.breakpoint as { addr: number }).addr).toBe(0x8003);
    // A second add accumulates.
    jsonOf(call(tools, 'zx_debug', { action: 'break-add', spec: '0x9000' }));
    const list = jsonOf(call(tools, 'zx_debug', { action: 'break-list' }));
    expect((list.breakpoints as Array<{ addr: number }>).map((b) => b.addr)).toEqual([0x8003, 0x9000]);
    // It really reached the CLI-shared store on disk.
    expect(loadDebugStore(session.cwd).breakpoints.map((b) => b.addr)).toEqual([0x8003, 0x9000]);
  });

  it('a label spec needs symbols from a prior zx_build; a raw hex spec does not (MCP-PROD-EDGE-003)', () => {
    project();
    const { tools } = catalog();
    // No build yet → an unknown label is an in-band tool error.
    const noSym = call(tools, 'zx_debug', { action: 'break-add', spec: 'start' });
    expect(noSym.isError).toBe(true);
    // Build loads symbols; now the label resolves.
    jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    const ok = call(tools, 'zx_debug', { action: 'break-add', spec: 'start' });
    expect(ok.isError).toBeFalsy();
    expect((jsonOf(ok).breakpoint as { addr: number }).addr).toBe(0x8000);
  });

  it('watch-add --read fails loud (W4-GAP-01); step/disasm/trace return their shapes', () => {
    project();
    const { tools } = catalog();
    jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    jsonOf(call(tools, 'zx_run', { bin: 'build/main.bin', fresh: false, pc: '0x8000', frames: 0 }));
    const readWatch = call(tools, 'zx_debug', { action: 'watch-add', type: 'read', range: '0x9000-0x9000' });
    expect(readWatch.isError).toBe(true);
    const dis = jsonOf(call(tools, 'zx_debug', { action: 'disasm', spec: '0x8000', count: 2 }));
    expect((dis.instructions as unknown[]).length).toBe(2);
    const step = jsonOf(call(tools, 'zx_debug', { action: 'step', count: 1 }));
    expect(step.stage).toBe('step');
    const trace = jsonOf(call(tools, 'zx_debug', { action: 'trace', frames: 1 }));
    expect(trace.stage).toBe('trace');
    expect(trace.instructionsTraced as number).toBeGreaterThan(0);
  });
});

// =========================================================================
// Interop — .zxstate round-trips both ways with the CLI (MCP-PROD-AC-INTEROP-001)
// =========================================================================

describe('CLI <-> MCP .zxstate interop (MCP-PROD-AC-INTEROP-001)', () => {
  it('a state saved by zx_state loads via the CLI state path (MCP -> CLI)', () => {
    project();
    const { tools } = catalog();
    jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    jsonOf(call(tools, 'zx_run', { bin: 'build/main.bin', frames: 10 }));
    // Accumulate a breakpoint so the saved session carries debug state too.
    jsonOf(call(tools, 'zx_debug', { action: 'break-add', spec: '0x8003' }));
    const save = jsonOf(call(tools, 'zx_state', { action: 'save', file: 'snap.zxstate' }));
    expect(save.op).toBe('save');

    // The CLI's own loader reads the MCP-written file (same codec + emulatorId).
    const loaded = loadSession('snap.zxstate', dir);
    expect(loaded.machine.memory[0x9000]).toBe(0xab);
    expect(loaded.debug.breakpoints.map((b) => b.addr)).toContain(0x8003);
    const env = deserializeZxState(readFileSync(join(dir, 'snap.zxstate'), 'utf8'));
    expect(env.machine.memory[0x9000]).toBe(0xab);
  });

  it('a state saved by the CLI loads via zx_state load (CLI -> MCP)', () => {
    // The CLI writes a fresh session to its default path.
    runStateSave('.zxs/state.zxstate', { cwd: dir });
    const { session, tools } = catalog();
    const res = call(tools, 'zx_state', { action: 'load', file: '.zxs/state.zxstate' });
    expect(res.isError).toBeFalsy();
    expect(jsonOf(res).op).toBe('load');
    // The hot session adopted the loaded machine (a fresh clean-ROM boot: ROM DI at 0).
    expect(session.machine.memory[0x0000]).toBe(0xf3);
  });

  it('export-z80 writes a v1 snapshot; reset returns the hot machine to a clean boot', () => {
    project();
    const { session, tools } = catalog();
    jsonOf(call(tools, 'zx_build', { entry: 'main.asm' }));
    jsonOf(call(tools, 'zx_run', { bin: 'build/main.bin', frames: 10 }));
    const exp = jsonOf(call(tools, 'zx_state', { action: 'export-z80', file: 'out.z80' }));
    expect(exp.format).toBe('z80');
    expect(readFileSync(join(dir, 'out.z80')).length).toBeGreaterThan(0);

    jsonOf(call(tools, 'zx_state', { action: 'reset' }));
    expect(session.machine.memory[0x9000]).toBe(0x00); // RAM cleared
    expect(session.machine.registers.pc).toBe(0x0000); // fresh boot
  });

  it('rejects a foreign-emulator .zxstate on load (emulatorId guard)', () => {
    writeFileSync(
      join(dir, 'foreign.zxstate'),
      JSON.stringify({ format: 'zxstate', emulatorId: 'other-emu', machine: { z80: '', halted: false, memptr: 0 }, debug: {} }),
    );
    const { tools } = catalog();
    const res = call(tools, 'zx_state', { action: 'load', file: 'foreign.zxstate' });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toMatch(/different emulator|emulatorId/i);
  });
});

// =========================================================================
// Sandbox — path-escape params are rejected (MCP-PROD-AC-SANDBOX-001)
// =========================================================================

describe('path sandbox (MCP-PROD-AC-SANDBOX-001)', () => {
  it('rejects a "../" path and an absolute path on file params', () => {
    const { tools } = catalog();
    const dotdot = call(tools, 'zx_state', { action: 'save', file: '../escape.zxstate' });
    expect(dotdot.isError).toBe(true);
    expect((dotdot.content[0] as { text: string }).text).toMatch(/error:/);
    // resolve('/abs.zxstate') is absolute on every host (drive-prefixed on
    // Windows); a literal 'C:/...' is only absolute on Windows and resolves
    // inside the project on POSIX.
    const absolute = call(tools, 'zx_state', { action: 'save', file: resolve('/abs.zxstate') });
    expect(absolute.isError).toBe(true);
    const binEscape = call(tools, 'zx_run', { bin: '../../etc/passwd' });
    expect(binEscape.isError).toBe(true);
  });
});
