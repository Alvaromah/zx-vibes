// `zxs-mcp` — the Model Context Protocol server (mcp-tools.md MCP-PROD-*).
//
// A THIN, agent-native skin over the same toolkit runtime the CLI uses (ADR-0027):
// it adds NO new emulation/observe/build logic. Each of the seven tools delegates to
// an already-built service (build/run/observe/state/debug/input) — the two ergonomic
// wins MCP justifies are inline `image` content for vision models (`zx_screen`,
// MCP-PROD-OUT-SCREEN-001) and a HOT in-memory session for interactive debugging
// (MCP-PROD-SERVER-004), the converse of the CLI's stateless-fresh default.
//
// Server identity + transport: registered as `zx-vibes` + the package version, over
// the stdio transport via `@modelcontextprotocol/sdk` (MCP-PROD-SERVER-001/002). The
// catalog is EXACTLY seven tools — no more, no fewer (MCP-PROD-SERVER-003,
// MCP-PROD-SCOPE-003): `zx_build`, `zx_run`, `zx_screen`, `zx_inspect`, `zx_debug`,
// `zx_keys`, `zx_state`. verify/test/preview/new/init/clean/gfx/symbols/coverage/
// doctor/setup and the reverse-engineering add-on are intentionally NOT MCP tools
// (MCP-PROD-RULE-SUBSET-001).
//
// State model (MCP-PROD-SERVER-004 / MCP-PROD-RULE-INTEROP-001): the machine + border
// are held HOT in memory (the D2 justification); the break/watch store is the on-disk
// `.zxs/debug.json` and a saved session is the `.zxstate` codec — both shared verbatim
// with the CLI, so an agent can hand a machine between the two surfaces. Breakpoints,
// watchpoints, and loaded symbols accumulate across tool calls.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { assembleFile, disassemble, disassembleOne } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';

import { CliError, envError, userError } from './output/envelope.js';
import { runBuild } from './build/build.js';
import {
  buildRunEnvelope,
  runProgram,
  READ_WATCH_UNAVAILABLE,
  type RunBoot,
} from './runtime/run.js';
import { bootFreshMachine, RAM_BASE } from './runtime/session.js';
import { loadMachineFromSource, selectedFileSource } from './runtime/machine-source.js';
import { HostIo, DEFAULT_BORDER } from './runtime/io-device.js';
import { parseKeySchedule, DEFAULT_HOLD } from './runtime/schedule.js';
import { parseAddress, parseRange } from './util/address.js';
import { readRegisters } from './observe/registers.js';
import {
  nonBlankCellsImage,
  ocrScreenRows,
  readScreenImage,
  renderRgbaImage,
} from './observe/screen.js';
import { attrInkRows } from './observe/screen-command.js';
import { encodePng, scaleRgba } from './observe/screenshot.js';
import { asciiBytes, hexBytes } from './observe/memory.js';
import { resolveDisasmSpec, type DisasmEntry } from './observe/disasm.js';
import { type StepEntry } from './observe/step.js';
import type { SourceMapEntry, SymbolDef } from './observe/source.js';
import { charToKey } from './input/input-command.js';
import {
  loadDebugStore,
  loadSession,
  saveDebugStore,
  saveSession,
  DEFAULT_STATE_PATH,
} from './state/persist.js';
import {
  addBreakpoint,
  addWatchpoint,
  removeBreakpoints,
  removeWatchpoints,
  type DebugStore,
} from './state/debug-store.js';
import { exportZ80Bytes } from './state/state-command.js';

/** The MCP server identity (MCP-PROD-SERVER-001). */
export const SERVER_NAME = 'zx-vibes';

/** The exactly-seven tool catalog (MCP-PROD-SERVER-003) — order is Incidental. */
export const MCP_TOOL_NAMES = [
  'zx_build',
  'zx_run',
  'zx_screen',
  'zx_inspect',
  'zx_debug',
  'zx_keys',
  'zx_state',
] as const;

// --- the hot in-memory session (MCP-PROD-SERVER-004) ------------------------

/**
 * One persistent machine session per server process. The machine + border are hot in
 * memory; the break/watch store is the on-disk `.zxs/debug.json` (so it accumulates
 * across calls AND interops with the CLI), and SLD symbols from the last `zx_build`
 * back the debugger's label/`file:line` resolution.
 */
export class McpSession {
  readonly cwd: string;
  machine: Machine;
  border: number;
  symbols: SymbolDef[] = [];
  sourceMap: SourceMapEntry[] = [];

  constructor(cwd: string) {
    this.cwd = resolve(cwd);
    this.machine = bootFreshMachine();
    this.border = DEFAULT_BORDER;
  }

  /** The shared, CLI-interoperable break/watch store (`.zxs/debug.json`). */
  loadDebug(): DebugStore {
    return loadDebugStore(this.cwd);
  }

  saveDebug(store: DebugStore): void {
    saveDebugStore(store, this.cwd);
  }
}

// --- result helpers (MCP-PROD-OUT-001 / MCP-PROD-ERR-001) -------------------

/** A pretty-printed JSON text result (the same `{ ok, ... }` shapes the CLI returns). */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** An in-band tool error: `isError: true` + a single `error: <message>` text part. */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `error: ${message}` }], isError: true };
}

/** Extract a human message from any thrown value (CliError / Error / other). */
function messageOf(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Run a tool body, converting any throw into the in-band `isError` result. */
function guard(fn: () => CallToolResult): CallToolResult {
  try {
    return fn();
  } catch (error) {
    return errorResult(messageOf(error));
  }
}

// --- path sandbox (MCP-PROD-RULE-SANDBOX-001 / MCP-PROD-AC-SANDBOX-001) ------

/**
 * Reject a file-path parameter that is absolute or contains a `..` segment, and
 * confirm the resolved path stays inside the project root. Returns the (validated)
 * relative path for the delegated service to resolve under `cwd`.
 */
function sandbox(cwd: string, rel: string, stage: string): string {
  if (isAbsolute(rel) || /(^|[\\/])\.\.([\\/]|$)/.test(rel)) {
    throw userError(
      `path "${rel}" is not allowed (paths must be project-relative — no absolute paths, no "..")`,
      stage,
    );
  }
  const resolved = resolve(cwd, rel);
  const back = relative(cwd, resolved);
  if (back.startsWith('..') || isAbsolute(back)) {
    throw userError(`path "${rel}" escapes the project root`, stage);
  }
  return rel;
}

// --- shared decode/step glue (public asm + machine primitives) --------------

const STEP_OVER_CAP = 5_000_000;

/** Whether opcode `op` is a CALL / CALL cc / RST (the step-over targets). */
function isCallOrRst(op: number): boolean {
  return op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;
}

/**
 * Single-step the hot machine `steps` times (the same logic as the `step` command's
 * core, applied to the session machine instead of a freshly-sourced one). `over`
 * runs a called routine to completion (bounded by {@link STEP_OVER_CAP}, so a debug
 * call always terminates — MCP-PROD-EDGE-002).
 */
function stepMachine(machine: Machine, steps: number, over: boolean): { from: number; instructions: StepEntry[] } {
  if (!machine.io) machine.io = new HostIo();
  const from = machine.registers.pc & 0xffff;
  const read = (a: number): number => machine.memory[a & 0xffff] ?? 0;
  const instructions: StepEntry[] = [];
  for (let i = 0; i < steps; i += 1) {
    const pcBefore = machine.registers.pc & 0xffff;
    const spBefore = machine.registers.sp & 0xffff;
    const line = disassembleOne(read, pcBefore);
    const op = read(pcBefore);
    machine.stepInstruction();
    instructions.push({ addr: pcBefore, bytes: line.bytes, text: line.text });
    if (over && isCallOrRst(op)) {
      const fallthrough = (pcBefore + line.bytes.length) & 0xffff;
      const transferred =
        (machine.registers.pc & 0xffff) !== fallthrough && (machine.registers.sp & 0xffff) < spBefore;
      if (transferred) {
        for (let k = 0; k < STEP_OVER_CAP; k += 1) {
          machine.stepInstruction();
          if ((machine.registers.pc & 0xffff) === fallthrough && (machine.registers.sp & 0xffff) >= spBefore) break;
        }
      }
    }
  }
  return { from, instructions };
}

/** Decode `count` instructions from `addr`, annotating each with its SLD label. */
function disasmEntries(machine: Machine, symbols: SymbolDef[], addr: number, count: number): DisasmEntry[] {
  const labelAt = new Map<number, string>();
  for (const sym of symbols) if (!labelAt.has(sym.value & 0xffff)) labelAt.set(sym.value & 0xffff, sym.name);
  const read = (a: number): number => machine.memory[a & 0xffff] ?? 0;
  return disassemble(read, addr, count).map((line) => {
    const label = labelAt.get(line.addr & 0xffff);
    return label !== undefined
      ? { addr: line.addr, bytes: line.bytes, text: line.text, label }
      : { addr: line.addr, bytes: line.bytes, text: line.text };
  });
}

/** Reconstruct the in-order tail from a circular buffer written `cursor` times. */
function recentAddresses(ring: number[], cursor: number): number[] {
  const size = ring.length;
  const have = Math.min(cursor, size);
  const out: number[] = [];
  for (let i = cursor - have; i < cursor; i += 1) out.push(ring[i % size]!);
  return out;
}

const TRACE_TOP = 10;
const TRACE_LAST = 50;

/** Run the hot machine `frames` with per-instruction tracing (hot-spots + tail). */
function traceSession(session: McpSession, frames: number): Record<string, unknown> {
  const machine = session.machine;
  const counts = new Map<number, number>();
  const lastRing = new Array<number>(TRACE_LAST);
  let lastCursor = 0;
  let total = 0;
  const result = runProgram(machine, RAM_BASE, {
    frames,
    detectHangs: false,
    onStep: (m: Machine) => {
      const pc = m.registers.pc & 0xffff;
      counts.set(pc, (counts.get(pc) ?? 0) + 1);
      lastRing[lastCursor % TRACE_LAST] = pc;
      lastCursor += 1;
      total += 1;
    },
  });
  session.machine = result.machine;
  session.border = result.io.borderColor();
  const read = (a: number): number => machine.memory[a & 0xffff] ?? 0;
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, TRACE_TOP)
    .map(([addr, count]) => ({ addr, count, text: disassembleOne(read, addr).text }));
  const last = recentAddresses(lastRing, lastCursor).map((addr) => {
    const line = disassembleOne(read, addr);
    return { addr, bytes: line.bytes, text: line.text };
  });
  return { ok: true, stage: 'trace', framesRun: result.framesRun, instructionsTraced: total, top, last };
}

/** Build a `frame:KEY*hold` schedule string for `zx_keys typeText` (CLI `type` parity). */
function textToKeySpec(text: string): string {
  if (text.length === 0) throw userError('zx_keys typeText must be a non-empty string', 'keys');
  const per = DEFAULT_HOLD;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += 1) parts.push(`${i * per}:${charToKey(text[i]!)}*${per}`);
  return parts.join(',');
}

// --- the seven tools (each delegates to an existing service) ----------------

interface ToolArgs {
  [key: string]: unknown;
}

/** `zx_build` (MCP-PROD-TOOL-BUILD-001 / MCP-PROD-OUT-BUILD-001). */
function toolBuild(session: McpSession, args: ToolArgs): CallToolResult {
  const cwd = session.cwd;
  const entry = args.entry as string | undefined;
  const outDir = args.outDir as string | undefined;
  if (entry !== undefined) sandbox(cwd, entry, 'build');
  if (outDir !== undefined) sandbox(cwd, outDir, 'build');

  const build = runBuild({
    cwd,
    entry,
    outDir,
    assembler: args.assembler as string | undefined,
  });

  let symbolsLoaded = 0;
  if (build.ok) {
    // Load SLD symbols for the debugger tools (MCP-PROD-TOOL-BUILD-001): re-assemble
    // the resolved entry in-memory for its symbol table + source map.
    const asm = assembleFile(build.entry, { cwd, sandbox: true });
    if (asm.ok) {
      session.symbols = asm.symbols;
      session.sourceMap = asm.sourceMap;
      symbolsLoaded = asm.symbols.length;
    }
  }

  const outputs: { bin?: string; sld?: string; artifacts: string[] } = {
    artifacts: build.outputs.artifacts,
  };
  if (build.outputs.bin) outputs.bin = build.outputs.bin;
  if (build.outputs.sld) outputs.sld = build.outputs.sld;

  return jsonResult({
    ok: build.ok,
    errors: build.errors,
    warnings: build.warnings,
    outputs,
    symbolsLoaded,
  });
}

/** `zx_run` (MCP-PROD-TOOL-RUN-001 / MCP-PROD-OUT-RUN-001). */
function toolRun(session: McpSession, args: ToolArgs): CallToolResult {
  const cwd = session.cwd;
  const bin = args.bin as string | undefined;
  const z80 = args.z80 as string | undefined;
  const tap = args.tap as string | undefined;
  const sna = args.sna as string | undefined;

  let boot: RunBoot;
  let hangOrg: number;
  if (selectedFileSource({ bin, z80, tap, sna }) !== undefined) {
    // Loading a program boots clean first (MCP-PROD-TOOL-RUN-001). Sandbox the given
    // project-relative path, then load through the ONE shared source loader — `z80`/`tap`
    // are wired; `sna` fails loud with the honest missing-codec verdict (W4-GAP-03), never
    // "not implemented" (ERR-PROD-NOSILENT-001).
    for (const file of [bin, z80, tap, sna]) if (file !== undefined) sandbox(cwd, file, 'run');
    const loaded = loadMachineFromSource({
      cwd,
      stage: 'run',
      bin,
      z80,
      tap,
      sna,
      org: args.org as string | undefined,
    });
    session.machine = loaded.machine;
    session.border = loaded.border;
    hangOrg = loaded.ramFloor;
    boot = loaded.boot;
  } else if (args.fresh === true) {
    session.machine = bootFreshMachine();
    session.border = DEFAULT_BORDER;
    hangOrg = RAM_BASE;
    boot = { source: 'state', org: RAM_BASE };
  } else {
    // Otherwise execution continues from the current live state.
    hangOrg = RAM_BASE;
    boot = { source: 'state', org: RAM_BASE };
  }
  if (args.pc !== undefined) session.machine.registers.pc = parseAddress(args.pc as string, 'run') & 0xffff;

  // The persistent break/watch store feeds every run (additions persist for
  // subsequent runs — MCP-PROD-TOOL-DEBUG-002). Read watchpoints cannot be stored
  // (they fail loud at add-time), so only write watchpoints reach here.
  const store = session.loadDebug();
  const breakpoints = store.breakpoints.map((b) => b.addr);
  const watchWrite = store.watchpoints
    .filter((w) => w.type === 'write')
    .map((w) => ({ from: w.from, to: w.to }));

  const result = runProgram(session.machine, hangOrg, {
    frames: args.frames as number | undefined,
    keys: args.keys as string | undefined,
    untilPc: args.untilPc !== undefined ? parseAddress(args.untilPc as string, 'run') : undefined,
    detectHangs: args.detectHangs as boolean | undefined,
    breakpoints,
    watchWrite,
  });
  session.machine = result.machine;
  session.border = result.io.borderColor();
  return jsonResult(buildRunEnvelope(result, boot));
}

/** `zx_screen` (MCP-PROD-TOOL-SCREEN-001 / MCP-PROD-OUT-SCREEN-001) — multipart. */
function toolScreen(session: McpSession, args: ToolArgs): CallToolResult {
  const scale = (args.scale as number | undefined) ?? 2;
  const image = readScreenImage(session.machine);
  const png = encodePng(scaleRgba(renderRgbaImage(image, session.border), scale)).toString('base64');
  const grid = {
    rows: ocrScreenRows(image),
    nonBlankCells: nonBlankCellsImage(image),
    borderColor: session.border,
    attrs: attrInkRows(image),
  };
  const result: CallToolResult = {
    content: [
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify(grid, null, 2) },
    ],
  };
  return result;
}

/** `zx_inspect` (MCP-PROD-TOOL-INSPECT-001 / MCP-PROD-OUT-INSPECT-001). */
function toolInspect(session: McpSession, args: ToolArgs): CallToolResult {
  const r = readRegisters(session.machine);
  const registers = {
    pc: r.pc,
    sp: r.sp,
    af: r.af,
    bc: r.bc,
    de: r.de,
    hl: r.hl,
    afPrime: r.alt.af,
    bcPrime: r.alt.bc,
    dePrime: r.alt.de,
    hlPrime: r.alt.hl,
    ix: r.ix,
    iy: r.iy,
    i: r.i,
    r: r.r,
    im: r.im,
    iff1: r.iff1,
    halted: r.halted,
  };
  const out: { registers: typeof registers; memory?: { addr: number; hex: string; ascii: string } } = {
    registers,
  };
  if (args.memAddr !== undefined) {
    const addr = parseAddress(args.memAddr as string, 'inspect');
    const len = (args.memLen as number | undefined) ?? 64;
    const bytes = session.machine.memory.slice(addr, Math.min(addr + len, 0x10000));
    out.memory = { addr, hex: hexBytes(bytes), ascii: asciiBytes(bytes) };
  }
  return jsonResult(out);
}

/** `zx_debug` (MCP-PROD-TOOL-DEBUG-001/002, MCP-PROD-EDGE-002/003). */
function toolDebug(session: McpSession, args: ToolArgs): CallToolResult {
  const action = args.action as string;
  const id = args.id as number | undefined;
  switch (action) {
    case 'break-add': {
      const spec = requireSpec(args, 'break-add');
      const addr = resolveDisasmSpec(spec, session.machine, session.symbols, session.sourceMap);
      const store = session.loadDebug();
      const breakpoint = addBreakpoint(store, addr, spec);
      session.saveDebug(store);
      return jsonResult({ ok: true, stage: 'break', op: 'add', breakpoint, breakpoints: store.breakpoints });
    }
    case 'break-rm': {
      const store = session.loadDebug();
      const removed = removeBreakpoints(store, id ?? 'all');
      session.saveDebug(store);
      return jsonResult({
        ok: true,
        stage: 'break',
        op: 'rm',
        removed: removed.map((b) => b.id),
        breakpoints: store.breakpoints,
      });
    }
    case 'break-list':
      return jsonResult({ ok: true, stage: 'break', op: 'list', breakpoints: session.loadDebug().breakpoints });
    case 'watch-add': {
      // Read watchpoints are unobservable with the current cores — fail loud
      // (the same guard as `run --watch-read` / `watch add --read`).
      if (args.type === 'read') throw envError(READ_WATCH_UNAVAILABLE, 'watch');
      const rangeSpec = args.range as string | undefined;
      if (rangeSpec === undefined) throw userError('zx_debug watch-add requires "range"', 'watch');
      const range = parseRange(rangeSpec, 'watch');
      const store = session.loadDebug();
      const watchpoint = addWatchpoint(store, 'write', range.from, range.to, rangeSpec);
      session.saveDebug(store);
      return jsonResult({ ok: true, stage: 'watch', op: 'add', watchpoint, watchpoints: store.watchpoints });
    }
    case 'watch-rm': {
      const store = session.loadDebug();
      const removed = removeWatchpoints(store, id ?? 'all');
      session.saveDebug(store);
      return jsonResult({
        ok: true,
        stage: 'watch',
        op: 'rm',
        removed: removed.map((w) => w.id),
        watchpoints: store.watchpoints,
      });
    }
    case 'watch-list':
      return jsonResult({ ok: true, stage: 'watch', op: 'list', watchpoints: session.loadDebug().watchpoints });
    case 'step':
    case 'step-over': {
      const over = action === 'step-over';
      const count = (args.count as number | undefined) ?? 1;
      const { from, instructions } = stepMachine(session.machine, count, over);
      return jsonResult({
        ok: true,
        stage: 'step',
        steps: count,
        over,
        from,
        pc: session.machine.registers.pc & 0xffff,
        instructions,
        registers: readRegisters(session.machine),
      });
    }
    case 'disasm': {
      const spec = requireSpec(args, 'disasm');
      const count = (args.count as number | undefined) ?? 16;
      const addr = resolveDisasmSpec(spec, session.machine, session.symbols, session.sourceMap);
      return jsonResult({
        ok: true,
        stage: 'disasm',
        spec,
        addr,
        count,
        instructions: disasmEntries(session.machine, session.symbols, addr, count),
      });
    }
    case 'trace':
      return jsonResult(traceSession(session, (args.frames as number | undefined) ?? 5));
    default:
      throw userError(`Unknown zx_debug action "${action}"`, 'debug');
  }
}

function requireSpec(args: ToolArgs, action: string): string {
  const spec = args.spec as string | undefined;
  if (spec === undefined) throw userError(`zx_debug ${action} requires "spec"`, 'debug');
  return spec;
}

/** `zx_keys` (MCP-PROD-TOOL-KEYS-001 / MCP-PROD-OUT-RUN-001, MCP-PROD-EDGE-001). */
function toolKeys(session: McpSession, args: ToolArgs): CallToolResult {
  const keys = args.keys as string | undefined;
  const typeText = args.typeText as string | undefined;
  const spec = keys ?? (typeText !== undefined ? textToKeySpec(typeText) : undefined);
  if (spec === undefined) throw userError('zx_keys requires "keys" or "typeText"', 'keys');

  const extra = (args.extraFrames as number | undefined) ?? 10;
  const scheduleEnd = parseKeySchedule(spec).reduce((end, e) => Math.max(end, e.frame + e.hold), 0);
  const result = runProgram(session.machine, RAM_BASE, {
    keys: spec,
    frames: scheduleEnd + extra,
    detectHangs: false, // input injection is not a hang (MCP-PROD-EDGE-001)
  });
  session.machine = result.machine;
  session.border = result.io.borderColor();
  return jsonResult(buildRunEnvelope(result, { source: 'state', org: RAM_BASE }));
}

/** `zx_state` (MCP-PROD-TOOL-STATE-001, MCP-PROD-RULE-INTEROP-001). */
function toolState(session: McpSession, args: ToolArgs): CallToolResult {
  const cwd = session.cwd;
  const action = args.action as string;
  const file = args.file as string | undefined;
  switch (action) {
    case 'save': {
      const target = file ?? DEFAULT_STATE_PATH;
      sandbox(cwd, target, 'state');
      // Embed the live (shared) debug store so the saved session is self-contained.
      const debug = session.loadDebug();
      saveSession(target, { machine: session.machine, border: session.border, debug }, cwd);
      return jsonResult({
        ok: true,
        stage: 'state',
        op: 'save',
        file: target,
        pc: session.machine.registers.pc & 0xffff,
        border: session.border,
        breakpoints: debug.breakpoints.length,
        watchpoints: debug.watchpoints.length,
      });
    }
    case 'load': {
      if (file === undefined) throw userError('zx_state load requires "file"', 'state');
      sandbox(cwd, file, 'state');
      // `loadSession` enforces the `.zxstate` format + `emulatorId` interop guard.
      const state = loadSession(file, cwd);
      session.machine = state.machine;
      session.border = state.border;
      // Republish the embedded debug store so loaded breakpoints are live for
      // subsequent runs AND visible to the CLI (MCP-PROD-RULE-INTEROP-001).
      session.saveDebug(state.debug);
      return jsonResult({
        ok: true,
        stage: 'state',
        op: 'load',
        file,
        pc: state.machine.registers.pc & 0xffff,
        border: state.border,
        breakpoints: state.debug.breakpoints.length,
        watchpoints: state.debug.watchpoints.length,
      });
    }
    case 'reset':
      session.machine = bootFreshMachine();
      session.border = DEFAULT_BORDER;
      return jsonResult({
        ok: true,
        stage: 'state',
        op: 'reset',
        pc: session.machine.registers.pc & 0xffff,
        border: session.border,
      });
    case 'export-z80': {
      if (file === undefined) throw userError('zx_state export-z80 requires "file"', 'state');
      sandbox(cwd, file, 'state');
      const bytes = exportZ80Bytes(session.machine, session.border);
      const out = resolve(cwd, file);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      return jsonResult({ ok: true, stage: 'state', op: 'export', file, format: 'z80', bytes: bytes.length });
    }
    default:
      throw userError(`Unknown zx_state action "${action}" (use save | load | reset | export-z80)`, 'state');
  }
}

// --- catalog + server -------------------------------------------------------

/** One registered MCP tool: its name, metadata, zod input shape, and (guarded) handler. */
export interface McpTool {
  name: (typeof MCP_TOOL_NAMES)[number];
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (args: ToolArgs) => CallToolResult;
}

/** Build the seven-tool catalog bound to a session (MCP-PROD-SERVER-003). */
export function buildCatalog(session: McpSession): McpTool[] {
  return [
    {
      name: 'zx_build',
      title: 'Build (assemble) a ZX program',
      description:
        'Assemble a .asm entry into an output directory and load its SLD symbols for the debugger tools.',
      inputSchema: {
        entry: z.string().optional(),
        outDir: z.string().optional(),
        assembler: z.string().optional(),
      },
      handler: (args) => guard(() => toolBuild(session, args)),
    },
    {
      name: 'zx_run',
      title: 'Run the live machine',
      description:
        'Run the emulator for a frame budget. Loading a program boots clean first; otherwise execution continues from the current live state.',
      inputSchema: {
        bin: z.string().optional(),
        org: z.string().optional(),
        pc: z.string().optional(),
        sna: z.string().optional(),
        z80: z.string().optional(),
        tap: z.string().optional(),
        fresh: z.boolean().optional(),
        frames: z.number().int().min(0).max(50000).optional(),
        untilPc: z.string().optional(),
        keys: z.string().optional(),
        detectHangs: z.boolean().optional(),
      },
      handler: (args) => guard(() => toolRun(session, args)),
    },
    {
      name: 'zx_screen',
      title: 'Capture the current display',
      description: 'Return the current display as an inline PNG plus a 32x24 ROM-font OCR grid.',
      inputSchema: {
        scale: z.number().int().min(1).max(4).optional(),
      },
      handler: (args) => guard(() => toolScreen(session, args)),
    },
    {
      name: 'zx_inspect',
      title: 'Inspect registers and memory',
      description: 'Return the full register set (including shadow registers) and an optional memory dump.',
      inputSchema: {
        memAddr: z.string().optional(),
        memLen: z.number().int().min(1).max(4096).optional(),
      },
      handler: (args) => guard(() => toolInspect(session, args)),
    },
    {
      name: 'zx_debug',
      title: 'Debugger actions',
      description:
        'Perform a debugger action: break-add, break-rm, break-list, watch-add, watch-rm, watch-list, step, step-over, disasm, trace.',
      inputSchema: {
        action: z.enum([
          'break-add',
          'break-rm',
          'break-list',
          'watch-add',
          'watch-rm',
          'watch-list',
          'step',
          'step-over',
          'disasm',
          'trace',
        ]),
        spec: z.string().optional(),
        id: z.number().int().optional(),
        type: z.enum(['read', 'write']).optional(),
        range: z.string().optional(),
        count: z.number().int().min(1).max(256).optional(),
        frames: z.number().int().min(1).max(5000).optional(),
      },
      handler: (args) => guard(() => toolDebug(session, args)),
    },
    {
      name: 'zx_keys',
      title: 'Inject keyboard input',
      description: 'Inject a keyboard schedule (or type text) and run enough frames for it to register.',
      inputSchema: {
        keys: z.string().optional(),
        typeText: z.string().optional(),
        extraFrames: z.number().int().min(0).max(5000).optional(),
      },
      handler: (args) => guard(() => toolKeys(session, args)),
    },
    {
      name: 'zx_state',
      title: 'Manage the persistent session',
      description:
        'Perform a state action: save, load, reset, or export-z80. State files interoperate with the CLI session (.zxstate).',
      inputSchema: {
        action: z.enum(['save', 'load', 'reset', 'export-z80']),
        file: z.string().optional(),
      },
      handler: (args) => guard(() => toolState(session, args)),
    },
  ];
}

/** Read the toolkit package version (MCP-PROD-SERVER-001 — the server reports it). */
function packageVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Create the `zx-vibes` MCP server with its hot session and the seven registered
 * tools. Returns the server plus the session/catalog for in-process testing.
 */
export function createMcpServer(options: { cwd?: string | undefined } = {}): {
  server: McpServer;
  session: McpSession;
  catalog: McpTool[];
} {
  const session = new McpSession(options.cwd ?? process.cwd());
  const catalog = buildCatalog(session);
  const server = new McpServer({ name: SERVER_NAME, version: packageVersion() });
  for (const tool of catalog) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (args: ToolArgs) => tool.handler(args),
    );
  }
  return { server, session, catalog };
}

export interface RunMcpOptions {
  /** Project root the session sandboxes paths against (default `process.cwd()`). */
  cwd?: string | undefined;
}

/**
 * Start the `zxs-mcp` stdio server (the bin entry, MCP-PROD-SERVER-001/002). Resolves
 * once connected; the stdio transport keeps the process alive on stdin and tears it
 * down cleanly when the client disconnects (no process-exit codes — MCP-PROD-RULE-NOEXIT-001).
 */
export async function runMcp(options: RunMcpOptions = {}): Promise<void> {
  const { server } = createMcpServer({ cwd: options.cwd ?? process.cwd() });
  await server.connect(new StdioServerTransport());
}
