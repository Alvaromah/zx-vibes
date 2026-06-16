/**
 * Spectral MCP server (zxs-mcp): exposes the toolkit over stdio with one
 * persistent Machine per server process — the live-session counterpart of
 * the one-shot CLI. zx_screen returns the display as MCP image content, so
 * vision-capable clients literally see the Spectrum screen.
 *
 * Resources (docs/reference) arrive with Phase 4.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { build, type Diagnostic } from '../build/sjasmplus.js';
import { Watchdog } from '../core/detect.js';
import { disassemble, disassembleOne } from '../core/disasm.js';
import { KeyPlanRunner, compileTypeText, parseKeysSpec } from '../core/input.js';
import { Machine } from '../core/machine.js';
import type { RunOptions, RunOutcome } from '../core/run-loop.js';
import { screenshotPNG } from '../core/screen.js';
import { screenText } from '../core/screen-text.js';
import { writeZ80v1 } from '../core/state.js';
import { SymbolTable } from '../core/symbols.js';
import { Tracer, WatchpointMonitor, type Watchpoint } from '../core/trace.js';
import { bootCachedMachine, readStateFile, writeStateFile } from '../cli/session.js';
import { hex, parseAddress } from '../cli/output.js';
import { configuredAssembler, configuredEntry, configuredOutDir, loadProjectConfig, resolveProjectPath } from '../cli/config.js';

interface PackageMetadata {
  version: string;
}

interface KeyEventInput {
  keys?: string | undefined;
  typeText?: string | undefined;
}

interface McpServerOptions {
  projectRoot?: string;
}

interface ProjectPath {
  absolute: string;
  relative: string;
}

const MCP_STEP_OVER_MAX_COUNT = 32;
const MCP_STEP_OVER_MAX_FRAMES = 100;
const MCP_TRACE_MAX_FRAMES = 300;
const packageMetadata = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as PackageMetadata;

class SpectralSession {
  private machine: Machine | null = null;
  symbols: SymbolTable | undefined;
  breakpoints = new Map<number, { spec: string; addr: number }>();
  watchpoints: Watchpoint[] = [];
  nextId = 1;

  constructor(private readonly projectRoot: string) {}

  ensure(): Machine {
    this.machine ??= bootCachedMachine();
    return this.machine;
  }

  fresh(): Machine {
    this.machine = bootCachedMachine();
    return this.machine;
  }

  replace(m: Machine): void {
    this.machine = m;
  }

  sym(addr: number): string {
    return this.symbols ? this.symbols.symbolicate(addr) : hex(addr);
  }

  resolve(spec: string): number | undefined {
    if (this.symbols) {
      const addr = this.symbols.resolve(spec);
      if (addr !== undefined) return addr;
    }
    try {
      return parseAddress(spec);
    } catch {
      return undefined;
    }
  }

  /** Shared run path: watchdog + breakpoints + watchpoints + key plan. */
  run(
    opts: Omit<RunOptions, 'watchdog' | 'breakpoints' | 'watchpoints' | 'onFrame'> & {
      detectHangs?: boolean;
      input?: KeyEventInput;
    }
  ): { outcome: RunOutcome; haltSynced: boolean | undefined } {
    const m = this.ensure();
    const events = opts.input?.keys
      ? parseKeysSpec(opts.input.keys)
      : opts.input?.typeText
        ? compileTypeText(opts.input.typeText)
        : [];
    const runner = new KeyPlanRunner(events, m);
    runner.applyDue(0);

    const wd = (opts.detectHangs ?? true) ? new Watchdog() : undefined;
    const bps = this.breakpoints.size
      ? new Set([...this.breakpoints.values()].map((b) => b.addr))
      : undefined;
    const monitor = this.watchpoints.length ? new WatchpointMonitor(this.watchpoints) : undefined;

    wd?.attach(m);
    monitor?.attach(m);
    m.resetAudioActivity();
    const outcome = m.run({
      ...opts,
      frames: Math.max(opts.frames ?? 300, runner.planFrames),
      onFrame: (f) => runner.applyDue(f),
      ...(wd ? { watchdog: wd } : {}),
      ...(bps ? { breakpoints: bps } : {}),
      ...(bps?.has(m.cpu.registers.getPC()) ? { skipFirstBreakpoint: true } : {}),
      ...(monitor ? { watchpoints: monitor } : {}),
    });
    monitor?.detach();
    wd?.detach();
    return { outcome, haltSynced: wd?.haltSynced(outcome.framesRun) };
  }

  report(outcome: RunOutcome, haltSynced: boolean | undefined): Record<string, unknown> {
    const m = this.ensure();
    const regs = m.getRegisters();
    const text = screenText(m);
    const hang = outcome.hang;
    return {
      ok: !hang,
      status: hang
        ? 'hang'
        : outcome.reason === 'breakpoint' || outcome.reason === 'watchpoint'
          ? outcome.reason
          : 'ok',
      exit: { reason: outcome.reason, pc: this.sym(outcome.pc) },
      ...(hang ? { hang: { ...hang, pc: this.sym(hang.pc) } } : {}),
      ...(outcome.breakpoint
        ? {
            breakpoint: {
              addr: this.sym(outcome.breakpoint.addr),
              ...(this.source(outcome.breakpoint.addr)
                ? { source: this.source(outcome.breakpoint.addr) }
                : {}),
            },
          }
        : {}),
      ...(outcome.watchpointHit
        ? {
            watchpoint: {
              ...outcome.watchpointHit,
              addr: hex(outcome.watchpointHit.addr),
              ...(outcome.watchpointHit.pc !== undefined
                ? { pc: this.sym(outcome.watchpointHit.pc) }
                : {}),
            },
          }
        : {}),
      framesRun: outcome.framesRun,
      tstatesRun: outcome.tstatesRun,
      ...(haltSynced !== undefined ? { loop: { haltSynced } } : {}),
      audio: m.getAudioActivity(),
      registers: {
        pc: this.sym(regs.pc),
        sp: hex(regs.sp),
        af: hex(regs.af),
        bc: hex(regs.bc),
        de: hex(regs.de),
        hl: hex(regs.hl),
        im: regs.im,
        iff1: regs.iff1,
        halted: regs.halted,
      },
      screen: { nonBlankCells: text.nonBlankCells, borderColor: text.borderColor },
    };
  }

  source(addr: number): { file: string; line: number } | undefined {
    const source = this.symbols?.addrToSource(addr);
    return source
      ? { ...source, file: projectPathForResponse(this.projectRoot, source.file) }
      : undefined;
  }
}

function jsonContent(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function errorContent(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return { content: [{ type: 'text', text: `error: ${message}` }], isError: true };
}

function formatRelativePath(path: string): string {
  return path === '' ? '.' : path.replace(/\\/g, '/');
}

function projectPathForResponse(projectRoot: string, path: string): string {
  const rel = relative(projectRoot, resolve(path));
  if (rel.startsWith('..') || isAbsolute(rel)) return '<outside-project>';
  return formatRelativePath(rel);
}

function resolveMcpPath(projectRoot: string, input: string, label: string): ProjectPath {
  const trimmed = input.trim();
  if (!trimmed) throw new Error(`${label} path is required`);
  if (isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('\\\\')) {
    throw new Error(`${label} path must be relative to the MCP project root`);
  }
  if (trimmed.split(/[\\/]+/).includes('..')) {
    throw new Error(`${label} path must not contain '..'`);
  }

  const absolute = resolve(projectRoot, trimmed);
  const rel = relative(projectRoot, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} path escapes the MCP project root`);
  }
  return { absolute, relative: formatRelativePath(rel) };
}

function readProjectFile(path: ProjectPath, label: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path.absolute));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`${label} file not found or unreadable: ${path.relative}${code ? ` (${code})` : ''}`);
  }
}

function writeProjectFile(path: ProjectPath, data: Uint8Array): void {
  try {
    mkdirSync(dirname(path.absolute), { recursive: true });
    writeFileSync(path.absolute, data);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(`could not write file: ${path.relative}${code ? ` (${code})` : ''}`);
  }
}

function buildOutputsForResponse(
  projectRoot: string,
  outputs: { bin?: string; sld?: string; artifacts?: string[] }
): { bin?: string; sld?: string; artifacts?: string[] } {
  return {
    ...(outputs.bin ? { bin: projectPathForResponse(projectRoot, outputs.bin) } : {}),
    ...(outputs.sld ? { sld: projectPathForResponse(projectRoot, outputs.sld) } : {}),
    ...(outputs.artifacts ? { artifacts: outputs.artifacts.map((p) => projectPathForResponse(projectRoot, p)) } : {}),
  };
}

function diagnosticForResponse(projectRoot: string, diagnostic: Diagnostic): Diagnostic {
  return {
    ...diagnostic,
    file: projectPathForResponse(projectRoot, diagnostic.file),
  };
}

export function createServer(options: McpServerOptions = {}): McpServer {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const server = new McpServer({ name: 'zx-vibes', version: packageMetadata.version });
  const session = new SpectralSession(projectRoot);

  server.registerTool(
    'zx_build',
    {
      title: 'Assemble Z80 source',
      description:
        'Assemble a .asm file. Returns JSON diagnostics (with source lines ' +
        'and did-you-mean hints) plus output paths. Loads SLD symbols for the debugger tools.',
      inputSchema: {
        entry: z.string().optional().describe('path to the entry .asm file; defaults to zx.config.json entry'),
        outDir: z.string().optional().describe('output directory (default: ./build)'),
        assembler: z.enum(['sjasmplus', 'spectral']).optional().describe('assembler backend'),
      },
    },
    async ({ entry, outDir, assembler }) => {
      try {
        const loaded = loadProjectConfig(projectRoot);
        const effectiveEntry = configuredEntry(entry, loaded.config);
        if (!effectiveEntry) return errorContent('entry is required when zx.config.json has no entry');
        const effectiveAssembler = configuredAssembler(assembler, loaded.config);
        if (!effectiveAssembler) return errorContent(`unknown assembler backend: ${assembler ?? loaded.config.assembler}`);
        const entryPath = resolveMcpPath(projectRoot, effectiveEntry, 'entry');
        const outDirPath = resolveMcpPath(projectRoot, configuredOutDir(outDir, loaded.config), 'outDir');
        const result = await build(resolveProjectPath(entryPath.relative, projectRoot), {
          outDir: outDirPath.absolute,
          assembler: effectiveAssembler,
          cwd: projectRoot,
        });
        if (result.ok && result.outputs.sld) {
          session.symbols = SymbolTable.parse(readFileSync(result.outputs.sld, 'utf8'));
        }
        return jsonContent({
          ok: result.ok,
          errors: result.errors.map((d) => diagnosticForResponse(projectRoot, d)),
          warnings: result.warnings.map((d) => diagnosticForResponse(projectRoot, d)),
          outputs: buildOutputsForResponse(projectRoot, result.outputs),
          symbolsLoaded: Boolean(result.ok && result.outputs.sld),
        });
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_run',
    {
      title: 'Run the Spectrum',
      description:
        'Run the live machine. Loading a program (bin/sna/z80/tap) boots clean first; ' +
        'otherwise execution continues from the current state. The watchdog classifies ' +
        'hangs (di-halt, tight-loop, rom-error, sp-corrupt, pc-in-rom) and breakpoints/watchpoints ' +
        'set via zx_debug are honored. Returns a JSON report; call zx_screen to see the display.',
      inputSchema: {
        bin: z.string().optional().describe('raw binary file to inject'),
        org: z.string().optional().describe('load address for bin (default 0x8000)'),
        pc: z.string().optional().describe('start address (default: org)'),
        sna: z.string().optional().describe('48K .sna snapshot to load'),
        z80: z.string().optional().describe('.z80 v1 snapshot to load'),
        tap: z.string().optional().describe('TAP/TZX tape to insert and play'),
        fresh: z.boolean().optional().describe('boot clean before running'),
        frames: z.number().int().min(0).max(50000).optional().describe('frame budget (default 300; 50 = 1s)'),
        untilPc: z.string().optional().describe('stop when PC reaches this address/label'),
        keys: z.string().optional().describe('scheduled keys, e.g. "60:O*30,120:SPACE*5"'),
        detectHangs: z.boolean().optional().describe('hang watchdog (default true)'),
      },
    },
    async (args) => {
      try {
        const loadRequested = Boolean(args.bin ?? args.sna ?? args.z80 ?? args.tap);
        const m = args.fresh || loadRequested ? session.fresh() : session.ensure();

        if (args.bin) {
          const bin = resolveMcpPath(projectRoot, args.bin, 'bin');
          const org = args.org !== undefined ? parseAddress(args.org) : 0x8000;
          m.loadBinary(
            readProjectFile(bin, 'bin'),
            org,
            args.pc !== undefined ? { pc: parseAddress(args.pc) } : {}
          );
        } else if (args.sna) {
          const sna = resolveMcpPath(projectRoot, args.sna, 'sna');
          m.loadSna(readProjectFile(sna, 'sna'));
        } else if (args.z80) {
          const z80 = resolveMcpPath(projectRoot, args.z80, 'z80');
          m.loadZ80(readProjectFile(z80, 'z80'));
        } else if (args.tap) {
          const tap = resolveMcpPath(projectRoot, args.tap, 'tap');
          m.loadTap(readProjectFile(tap, 'tap'), tap.relative);
          m.playTape();
        }

        const untilPC = args.untilPc !== undefined ? session.resolve(args.untilPc) : undefined;
        if (args.untilPc !== undefined && untilPC === undefined) {
          return errorContent(`cannot resolve untilPc '${args.untilPc}'`);
        }
        const { outcome, haltSynced } = session.run({
          ...(args.frames !== undefined ? { frames: args.frames } : {}),
          ...(untilPC !== undefined ? { untilPC } : {}),
          ...(args.detectHangs !== undefined ? { detectHangs: args.detectHangs } : {}),
          input: { keys: args.keys },
        });
        return jsonContent(session.report(outcome, haltSynced));
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_screen',
    {
      title: 'See the Spectrum screen',
      description:
        'Returns the current display as a PNG image plus a 32x24 character grid ' +
        '(ROM-font OCR; unknown graphics shown as density glyphs ░▒▓█) and attribute summary.',
      inputSchema: {
        scale: z.number().int().min(1).max(4).optional().describe('PNG upscale factor (default 2)'),
      },
    },
    async ({ scale }) => {
      try {
        const m = session.ensure();
        const png = screenshotPNG(m, scale !== undefined ? { scale } : {});
        const text = screenText(m);
        return {
          content: [
            { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' as const },
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  rows: text.rows,
                  nonBlankCells: text.nonBlankCells,
                  borderColor: text.borderColor,
                  attrs: text.attrs.slice(0, 8),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_inspect',
    {
      title: 'Inspect registers and memory',
      description:
        'Returns the full register set (including shadow registers) and, optionally, a memory dump.',
      inputSchema: {
        memAddr: z.string().optional().describe('memory address/label to dump'),
        memLen: z.number().int().min(1).max(4096).optional().describe('bytes to dump (default 64)'),
      },
    },
    async ({ memAddr, memLen }) => {
      try {
        const m = session.ensure();
        const regs = m.getRegisters();
        const out: Record<string, unknown> = {
          registers: {
            pc: session.sym(regs.pc),
            sp: hex(regs.sp),
            af: hex(regs.af),
            bc: hex(regs.bc),
            de: hex(regs.de),
            hl: hex(regs.hl),
            afPrime: hex(regs.afPrime),
            bcPrime: hex(regs.bcPrime),
            dePrime: hex(regs.dePrime),
            hlPrime: hex(regs.hlPrime),
            ix: hex(regs.ix),
            iy: hex(regs.iy),
            i: hex(regs.i, 2),
            r: hex(regs.r, 2),
            im: regs.im,
            iff1: regs.iff1,
            halted: regs.halted,
          },
        };
        if (memAddr !== undefined) {
          const addr = session.resolve(memAddr);
          if (addr === undefined) return errorContent(`cannot resolve address '${memAddr}'`);
          const data = m.readMemory(addr, memLen ?? 64);
          out['memory'] = {
            addr: session.sym(addr),
            hex: Buffer.from(data).toString('hex'),
            ascii: [...data].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(''),
          };
        }
        return jsonContent(out);
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_debug',
    {
      title: 'Debugger: breakpoints, watchpoints, step, disasm, trace',
      description:
        'Debug actions on the live machine. break-add/watch-add persist for zx_run ' +
        '(run with untilPc or frames to continue to them). spec accepts hex (0x8000), ' +
        'a label, or file.asm:line once zx_build has loaded symbols.',
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
        spec: z.string().optional().describe('address/label/file:line (break-add, disasm)'),
        id: z.number().int().optional().describe('breakpoint/watchpoint id (break-rm, watch-rm; omit = all)'),
        type: z.enum(['read', 'write']).optional().describe('watch-add access type (default write)'),
        range: z.string().optional().describe('watch-add range, e.g. 0x5800-0x5AFF'),
        count: z.number().int().min(1).max(256).optional().describe('instructions (step, disasm)'),
        frames: z.number().int().min(1).max(5000).optional().describe('frames to trace (default 5)'),
      },
    },
    async (args) => {
      try {
        const m = session.ensure();
        const read = (a: number) => m.memory.read(a);
        switch (args.action) {
          case 'break-add': {
            if (!args.spec) return errorContent('break-add requires spec');
            const addr = session.resolve(args.spec);
            if (addr === undefined) return errorContent(`cannot resolve '${args.spec}'`);
            const id = session.nextId++;
            session.breakpoints.set(id, { spec: args.spec, addr });
            return jsonContent({ added: { id, spec: args.spec, addr: session.sym(addr) } });
          }
          case 'break-rm': {
            if (args.id !== undefined) session.breakpoints.delete(args.id);
            else session.breakpoints.clear();
            return jsonContent({ breakpoints: session.breakpoints.size });
          }
          case 'break-list':
            return jsonContent({
              breakpoints: [...session.breakpoints.entries()].map(([id, b]) => ({
                id,
                spec: b.spec,
                addr: session.sym(b.addr),
              })),
            });
          case 'watch-add': {
            if (!args.range) return errorContent('watch-add requires range');
            const [fromS, toS] = args.range.split('-');
            const from = parseAddress(fromS!);
            const to = toS !== undefined ? parseAddress(toS) : from;
            const id = session.nextId++;
            session.watchpoints.push({ id, type: args.type ?? 'write', from, to });
            return jsonContent({ added: { id, type: args.type ?? 'write', from: hex(from), to: hex(to) } });
          }
          case 'watch-rm': {
            session.watchpoints =
              args.id !== undefined
                ? session.watchpoints.filter((w) => w.id !== args.id)
                : [];
            return jsonContent({ watchpoints: session.watchpoints.length });
          }
          case 'watch-list':
            return jsonContent({
              watchpoints: session.watchpoints.map((w) => ({
                ...w,
                from: hex(w.from),
                to: hex(w.to),
              })),
            });
          case 'step':
          case 'step-over': {
            const n = args.count ?? 1;
            let note: string | undefined;
            if (args.action === 'step-over') {
              if (n > MCP_STEP_OVER_MAX_COUNT) {
                return errorContent(`step-over count is capped at ${MCP_STEP_OVER_MAX_COUNT}`);
              }
              for (let i = 0; i < n; i++) {
                const pc = m.cpu.registers.getPC();
                const instr = disassembleOne(read, pc);
                if (/^(CALL|RST)/.test(instr.text)) {
                  const after = (pc + instr.bytes.length) & 0xffff;
                  const outcome = m.run({ breakpoints: new Set([after]), maxFrames: MCP_STEP_OVER_MAX_FRAMES });
                  if (outcome.reason !== 'breakpoint') {
                    note = `step-over of '${instr.text}' stopped: ${outcome.reason}`;
                    break;
                  }
                } else {
                  m.run({ instructions: 1 });
                }
              }
            } else {
              m.run({ instructions: n });
            }
            const pc = m.cpu.registers.getPC();
            return jsonContent({
              pc: session.sym(pc),
              ...(note !== undefined ? { note } : {}),
              ...(session.source(pc) ? { source: session.source(pc) } : {}),
              disasm: disassemble(read, pc, 4).map((l) => ({ addr: session.sym(l.addr), text: l.text })),
            });
          }
          case 'disasm': {
            const addr =
              args.spec === undefined || args.spec.toUpperCase() === 'PC'
                ? m.cpu.registers.getPC()
                : session.resolve(args.spec);
            if (addr === undefined) return errorContent(`cannot resolve '${args.spec}'`);
            return jsonContent({
              lines: disassemble(read, addr, args.count ?? 16).map((l) => ({
                addr: session.sym(l.addr),
                bytes: l.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
                text: l.text,
              })),
            });
          }
          case 'trace': {
            const frames = args.frames ?? 5;
            if (frames > MCP_TRACE_MAX_FRAMES) {
              return errorContent(`trace frames are capped at ${MCP_TRACE_MAX_FRAMES}`);
            }
            const tracer = new Tracer(256);
            const outcome = m.run({
              frames,
              onInstruction: (pc) => tracer.onInstruction(pc),
            });
            return jsonContent({
              framesRun: outcome.framesRun,
              instructions: tracer.instructionCount,
              hot: tracer.topHot(10).map((h) => ({
                pc: session.sym(h.pc),
                count: h.count,
                text: disassembleOne(read, h.pc).text,
              })),
              recent: tracer.lastPCs(20).map((pc) => ({
                pc: session.sym(pc),
                text: disassembleOne(read, pc).text,
              })),
            });
          }
        }
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_keys',
    {
      title: 'Press keys / type text',
      description:
        'Inject keyboard input into the live machine and run long enough for it to register. ' +
        'Use keys for frame-scheduled presses ("10:O*20") or typeText for text entry.',
      inputSchema: {
        keys: z.string().optional().describe('frame:KEY*hold list, e.g. "10:O*20,40:SPACE*5"'),
        typeText: z.string().optional().describe('text typed via the key matrix'),
        extraFrames: z.number().int().min(0).max(5000).optional().describe('frames to run after the input (default 10)'),
      },
    },
    async ({ keys, typeText, extraFrames }) => {
      try {
        if (!keys && !typeText) return errorContent('provide keys or typeText');
        const { outcome, haltSynced } = session.run({
          frames: extraFrames ?? 10,
          detectHangs: false,
          input: { keys, typeText },
        });
        return jsonContent(session.report(outcome, haltSynced));
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  server.registerTool(
    'zx_state',
    {
      title: 'Save/load machine state',
      description:
        'Persist or restore the live machine as a .zxstate file (interoperable with the zxs CLI ' +
        'session in .zxs/state.zxstate), reset to a clean boot, or export a .z80 snapshot.',
      inputSchema: {
        action: z.enum(['save', 'load', 'reset', 'export-z80']),
        file: z.string().optional().describe('state file path (save/load/export-z80)'),
      },
    },
    async ({ action, file }) => {
      try {
        switch (action) {
          case 'save': {
            if (!file) return errorContent('save requires file');
            const stateFile = resolveMcpPath(projectRoot, file, 'state');
            try {
              writeStateFile(stateFile.absolute, session.ensure().saveState());
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code;
              throw new Error(`could not save state: ${stateFile.relative}${code ? ` (${code})` : ''}`);
            }
            return jsonContent({ saved: stateFile.relative });
          }
          case 'load': {
            if (!file) return errorContent('load requires file');
            const stateFile = resolveMcpPath(projectRoot, file, 'state');
            if (!existsSync(stateFile.absolute)) return errorContent(`state file not found: ${stateFile.relative}`);
            session.replace(Machine.fromState(readStateFile(stateFile.absolute)));
            return jsonContent({ loaded: stateFile.relative });
          }
          case 'reset':
            session.fresh();
            return jsonContent({ reset: true });
          case 'export-z80': {
            if (!file) return errorContent('export-z80 requires file');
            const z80File = resolveMcpPath(projectRoot, file, 'z80');
            writeProjectFile(z80File, writeZ80v1(session.ensure()));
            return jsonContent({ exported: z80File.relative, format: 'z80v1' });
          }
        }
      } catch (err) {
        return errorContent((err as Error).message);
      }
    }
  );

  return server;
}

const isMain = (() => {
  try {
    return process.argv[1]
      ? import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
      : false;
  } catch {
    return false;
  }
})();

export async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error('zx-vibes: MCP server on stdio (tools: zx_build, zx_run, zx_screen, zx_inspect, zx_debug, zx_keys, zx_state)');
}

if (isMain) {
  await startStdioServer();
}
