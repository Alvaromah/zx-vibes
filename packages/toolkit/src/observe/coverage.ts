// `zxs coverage` — report which code was reached over a run (cli.md
// CLI-PROD-COVERAGE-001, RT-PROD-OBSERVE-001 v2 addition).
//
// Sources a machine (built entry / `--bin` / fresh) and runs it the SAME way `run` does —
// a frame budget (`--frames`, default 300) plus scheduled `--keys` / `--joy` input — on the
// real run engine (`runProgram` + its per-instruction `onStep` hook), recording the set of
// instruction-start addresses. It cross-references that set with the SLD symbol table to
// answer "was routine X executed?" — the question `trace` hot-spots cannot. The report is
// `{ ok, stage:"coverage", executed, routines:[{name,addr,reached}], reachedCount,
// totalSymbols }`, matching CLI-PROD-COVERAGE-001 exactly. `executed` is the distinct
// reached addresses WITHIN the loaded program range (the user's code, not incidental ROM).

import type { Command } from 'commander';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { runProgram } from '../runtime/run.js';
import { resolveObserveMachine, addSnapshotSourceFlags, snapshotSourceFlags } from './source.js';

/** Default frame budget when `--frames` is omitted (like `run`, CLI-PROD-COVERAGE-001). */
export const DEFAULT_COVERAGE_FRAMES = 300;

/** One routine and whether the run reached it. */
export interface CoverageRoutine {
  name: string;
  addr: number;
  reached: boolean;
}

export type CoverageEnvelope = {
  ok: true;
  stage: 'coverage';
  /** Distinct executed instruction-start addresses within the loaded program range, sorted. */
  executed: number[];
  routines: CoverageRoutine[];
  reachedCount: number;
  totalSymbols: number;
};

export interface CoverageOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  frames?: number | undefined;
  keys?: string | undefined;
  joy?: string | undefined;
}

/** The `coverage` service (CLI-PROD-COVERAGE-001). */
export function runCoverage(options: CoverageOptions = {}): CoverageEnvelope {
  const frames = options.frames ?? DEFAULT_COVERAGE_FRAMES;
  const { machine, org, length, symbols } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'coverage',
  });

  const reached = new Set<number>();
  runProgram(machine, org, {
    frames,
    keys: options.keys,
    joy: options.joy,
    onStep: (m: Machine) => reached.add(m.registers.pc & 0xffff),
  });

  const lo = org;
  const hi = org + length;
  const executed = [...reached].filter((a) => a >= lo && a < hi).sort((a, b) => a - b);

  const routines: CoverageRoutine[] = symbols.map((s) => ({
    name: s.name,
    addr: s.value & 0xffff,
    reached: reached.has(s.value & 0xffff),
  }));
  const reachedCount = routines.reduce((n, r) => n + (r.reached ? 1 : 0), 0);

  return {
    ok: true,
    stage: 'coverage',
    executed,
    routines,
    reachedCount,
    totalSymbols: routines.length,
  };
}

/** Map the CLI context onto the `coverage` service. */
export function coverageCommand(context: CommandContext): CoverageEnvelope {
  const options = context.options as Record<string, unknown>;
  return runCoverage({
    cwd: process.cwd(),
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
    frames: options.frames !== undefined ? parseFrames(options.frames as string) : undefined,
    keys: options.keys as string | undefined,
    joy: options.joy as string | undefined,
  });
}

function parseFrames(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw userError(`Invalid --frames: "${input}" (expected a positive integer)`, 'coverage');
  }
  return n;
}

/** Declare the `coverage` command's flags (CLI-PROD-COVERAGE-001). */
export function configureCoverageCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Run the program and report which code (SLD routines) was reached')
    .option('--bin <file>', 'cover a raw binary loaded at --org (no symbols)')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--frames <n>', `frame budget (default ${DEFAULT_COVERAGE_FRAMES})`)
    .option('--keys <spec>', 'scheduled keyboard input, e.g. "60:O*30,120:SPACE*5"')
    .option('--joy <spec>', 'scheduled Kempston input, e.g. "60:R*30,90:RF*10"')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
