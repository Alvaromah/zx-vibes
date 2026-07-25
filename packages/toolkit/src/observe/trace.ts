// `zxs trace` — run with per-instruction execution tracing
// (cli.md CLI-PROD-TRACE-001, RT-PROD-OBSERVE-001).
//
// Sources a machine (built entry / `--bin` / fresh) and runs a bounded budget
// (`--frames`, default 5) on the REAL run engine (`runProgram` + its new per-instruction
// `onStep` hook), recording every executed instruction. From that it reports the two
// complementary views a trace is for: `--top` hot-spots (the addresses by execution count)
// and `--last` (the tail of the instruction stream), optional `--profile` (actual
// contended T-states by heuristic SLD routine ownership + HALT idle), plus optional
// `--out` (the full ordered trace to a file). Hang detection is OFF so the trace spans the whole budget even
// for a stuck loop (the common reason to reach for `trace`); `coverage` answers the
// orthogonal "was routine X reached?" question hot-spots cannot.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import { disassembleOne } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { runProgram } from '../runtime/run.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
} from './source.js';

/** Trace defaults (CLI-PROD-TRACE-001). */
export const DEFAULT_TRACE_FRAMES = 5;
export const DEFAULT_TRACE_TOP = 10;
export const DEFAULT_TRACE_LAST = 50;

/** A hot-spot: an address and how many times an instruction started there. */
export interface TraceHotspot {
  addr: number;
  count: number;
  text: string;
}

/** A tail-of-stream instruction. */
export interface TraceLine {
  addr: number;
  bytes: number[];
  text: string;
}

/** One routine-level timing bucket produced by `trace --profile`. */
export interface TraceProfileEntry {
  /** Nearest preceding SLD function label, or `<unmapped>` without matching debug data. */
  symbol: string;
  /** SLD label address (`null` for the `<unmapped>` bucket). */
  addr: number | null;
  /** Number of non-idle instructions charged to this bucket. */
  instructions: number;
  /** Real contended T-states charged to this bucket. */
  tStates: number;
  /** Average cost per completed frame in the trace. */
  tStatesPerFrame: number;
  /** Percentage of all non-idle instruction time represented by this bucket. */
  percentOfActive: number;
  /** Average share of the canonical 69,888-T-state frame consumed by this bucket. */
  percentOfFrame: number;
}

/** Timing summary emitted only when `trace --profile` is requested. */
export interface TraceProfile {
  /**
   * Attribution is deliberately heuristic: each instruction is charged to the
   * nearest preceding SLD function label inside the assembled image.
   */
  attribution: 'nearest-preceding-sld-function';
  heuristic: true;
  /** Full elapsed machine time, including HALT waits and interrupt acknowledge. */
  totalTStates: number;
  /** T-states spent executing instructions while the CPU was not already halted. */
  activeTStates: number;
  /** Active instruction share of total elapsed machine time. */
  activePercentOfRun: number;
  /** T-states spent on repeated HALT fetches while waiting for an interrupt. */
  idleTStates: number;
  /** Repeated-HALT idle share of total elapsed machine time. */
  idlePercentOfRun: number;
  /** Residual interrupt-acknowledge time (not attributable to a fetched instruction). */
  interruptTStates: number;
  /** Interrupt-acknowledge share of total elapsed machine time. */
  interruptPercentOfRun: number;
  /** Top routine buckets, limited by the existing `--top` option. */
  entries: TraceProfileEntry[];
}

export type TraceEnvelope = {
  ok: true;
  stage: 'trace';
  boot: ObserveBoot;
  framesRun: number;
  /** Total instructions executed during the traced run. */
  instructionsTraced: number;
  /** Hot-spots: the top `--top` addresses by execution count, descending. */
  top: TraceHotspot[];
  /** The last `--last` executed instructions, in order. */
  last: TraceLine[];
  /** Written full-trace path (`--out`). */
  out?: string;
  /** Actual T-state profile (`--profile`), separate from execution-count hot-spots. */
  profile?: TraceProfile;
};

export interface TraceOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  frames?: number | undefined;
  top?: number | undefined;
  last?: number | undefined;
  out?: string | undefined;
  profile?: boolean | undefined;
}

/** The `trace` service (CLI-PROD-TRACE-001). */
export function runTrace(options: TraceOptions = {}): TraceEnvelope {
  const frames = options.frames ?? DEFAULT_TRACE_FRAMES;
  const topN = options.top ?? DEFAULT_TRACE_TOP;
  const lastN = options.last ?? DEFAULT_TRACE_LAST;
  const wantFull = options.out !== undefined;

  const { machine, org, boot, length, symbols } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'trace',
  });

  const counts = new Map<number, number>();
  const lastRing = new Array<number>(Math.max(1, lastN));
  let lastCursor = 0;
  const full: number[] = [];
  const timing = new Map<number, { instructions: number; tStates: number }>();
  let idleTStates = 0;
  let total = 0;

  const result = runProgram(machine, org, {
    frames,
    detectHangs: false,
    onStep: (m: Machine) => {
      const pc = m.registers.pc & 0xffff;
      counts.set(pc, (counts.get(pc) ?? 0) + 1);
      lastRing[lastCursor % lastRing.length] = pc;
      lastCursor += 1;
      total += 1;
      if (wantFull) full.push(pc);
    },
    onStepComplete: (_machine, step) => {
      if (!options.profile) return;
      if (step.wasHalted) {
        idleTStates += step.tStates;
        return;
      }
      const bucket = timing.get(step.pc) ?? { instructions: 0, tStates: 0 };
      bucket.instructions += 1;
      bucket.tStates += step.tStates;
      timing.set(step.pc, bucket);
    },
  });

  const read = (a: number): number => machine.memory[a & 0xffff] ?? 0;
  const decode = (addr: number): string => disassembleOne(read, addr).text;

  const top: TraceHotspot[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.max(0, topN))
    .map(([addr, count]) => ({ addr, count, text: decode(addr) }));

  const last: TraceLine[] = recentAddresses(lastRing, lastCursor).map((addr) => {
    const line = disassembleOne(read, addr);
    return { addr, bytes: line.bytes, text: line.text };
  });

  const envelope: TraceEnvelope = {
    ok: true,
    stage: 'trace',
    boot,
    framesRun: result.framesRun,
    instructionsTraced: total,
    top,
    last,
  };

  if (wantFull) {
    const out = resolve(options.cwd ?? process.cwd(), options.out!);
    mkdirSync(dirname(out), { recursive: true });
    const body = full
      .map((addr) => `${addr.toString(16).toUpperCase().padStart(4, '0')}  ${decode(addr)}`)
      .join('\n');
    writeFileSync(out, full.length > 0 ? `${body}\n` : '');
    envelope.out = options.out!;
  }

  if (options.profile) {
    envelope.profile = buildTraceProfile({
      timing,
      idleTStates,
      totalTStates: result.tstatesRun,
      frameTStates: result.frameBudget.frameTStates,
      framesRun: result.framesRun,
      topN,
      org,
      length,
      symbols,
    });
  }

  return envelope;
}

interface TraceProfileBuild {
  timing: Map<number, { instructions: number; tStates: number }>;
  idleTStates: number;
  totalTStates: number;
  frameTStates: number;
  framesRun: number;
  topN: number;
  org: number;
  length: number;
  symbols: Array<{ name: string; value: number; kind: 'F' | 'D' }>;
}

/** Aggregate real instruction timings into heuristic routine buckets. */
function buildTraceProfile(input: TraceProfileBuild): TraceProfile {
  const imageEnd = input.org + input.length;
  const labels = input.symbols
    .filter(
      (symbol) =>
        symbol.kind === 'F' && symbol.value >= input.org && symbol.value < imageEnd,
    )
    .sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));

  const grouped = new Map<
    string,
    { symbol: string; addr: number | null; instructions: number; tStates: number }
  >();
  for (const [pc, sample] of input.timing) {
    const label =
      pc >= input.org && pc < imageEnd ? nearestPrecedingLabel(labels, pc) : undefined;
    const key = label ? `${label.value}:${label.name}` : '<unmapped>';
    const bucket = grouped.get(key) ?? {
      symbol: label?.name ?? '<unmapped>',
      addr: label?.value ?? null,
      instructions: 0,
      tStates: 0,
    };
    bucket.instructions += sample.instructions;
    bucket.tStates += sample.tStates;
    grouped.set(key, bucket);
  }

  const activeTStates = [...grouped.values()].reduce(
    (total, entry) => total + entry.tStates,
    0,
  );
  const round = (value: number): number => Math.round(value * 100) / 100;
  const entries = [...grouped.values()]
    .sort(
      (a, b) =>
        b.tStates - a.tStates ||
        (a.addr ?? Number.MAX_SAFE_INTEGER) - (b.addr ?? Number.MAX_SAFE_INTEGER) ||
        a.symbol.localeCompare(b.symbol),
    )
    .slice(0, Math.max(0, input.topN))
    .map((entry): TraceProfileEntry => ({
      ...entry,
      tStatesPerFrame: input.framesRun > 0 ? round(entry.tStates / input.framesRun) : 0,
      percentOfActive:
        activeTStates > 0 ? round((entry.tStates * 100) / activeTStates) : 0,
      percentOfFrame:
        input.framesRun > 0
          ? round((entry.tStates * 100) / (input.framesRun * input.frameTStates))
          : 0,
    }));

  const interruptTStates = Math.max(
    0,
    input.totalTStates - activeTStates - input.idleTStates,
  );
  const percentOfRun = (value: number): number =>
    input.totalTStates > 0 ? round((value * 100) / input.totalTStates) : 0;
  return {
    attribution: 'nearest-preceding-sld-function',
    heuristic: true,
    totalTStates: input.totalTStates,
    activeTStates,
    activePercentOfRun: percentOfRun(activeTStates),
    idleTStates: input.idleTStates,
    idlePercentOfRun: percentOfRun(input.idleTStates),
    interruptTStates,
    interruptPercentOfRun: percentOfRun(interruptTStates),
    entries,
  };
}

function nearestPrecedingLabel<T extends { value: number }>(
  labels: T[],
  pc: number,
): T | undefined {
  let match: T | undefined;
  for (const label of labels) {
    if (label.value > pc) break;
    if (match === undefined || label.value > match.value) match = label;
  }
  return match;
}

/** Reconstruct the in-order tail from a circular buffer written `cursor` times. */
function recentAddresses(ring: number[], cursor: number): number[] {
  const size = ring.length;
  const have = Math.min(cursor, size);
  const out: number[] = [];
  for (let i = cursor - have; i < cursor; i += 1) out.push(ring[i % size]!);
  return out;
}

/** Map the CLI context onto the `trace` service. */
export function traceCommand(context: CommandContext): TraceEnvelope {
  const options = context.options as Record<string, unknown>;
  return runTrace({
    cwd: process.cwd(),
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
    frames: options.frames !== undefined ? parsePositive(options.frames as string, '--frames') : undefined,
    top: options.top !== undefined ? parseNonNegative(options.top as string, '--top') : undefined,
    last: options.last !== undefined ? parseNonNegative(options.last as string, '--last') : undefined,
    out: options.out as string | undefined,
    profile: options.profile === true,
  });
}

function parsePositive(input: string, flag: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw userError(`Invalid ${flag}: "${input}" (expected a positive integer)`, 'trace');
  }
  return n;
}

function parseNonNegative(input: string, flag: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0) {
    throw userError(`Invalid ${flag}: "${input}" (expected a non-negative integer)`, 'trace');
  }
  return n;
}

/** Declare the `trace` command's flags (CLI-PROD-TRACE-001). */
export function configureTraceCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Run with per-instruction execution tracing')
    .option('--bin <file>', 'trace a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--frames <n>', `frame budget (default ${DEFAULT_TRACE_FRAMES})`)
    .option('--top <n>', `hot-spots to report (default ${DEFAULT_TRACE_TOP})`)
    .option('--last <n>', `trailing instructions to report (default ${DEFAULT_TRACE_LAST})`)
    .option('--out <file>', 'write the full ordered trace to this file')
    .option(
      '--profile',
      'report actual T-states by nearest preceding SLD function label (heuristic)',
    )
    .option('--no-save', 'do not persist the session (no-op under the stateless default)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
