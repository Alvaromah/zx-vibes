// `zxs step [n]` — single-step `n` instructions and report the resulting state
// (cli.md CLI-PROD-STEP-001, RT-PROD-OBSERVE-001).
//
// Sources a machine (built entry / `--bin` / fresh, PC at the entry), installs the
// observable `HostIo` (so an `OUT (0xFE),A` during stepping is absorbed, not a crash),
// and executes exactly `n` CPU instructions via the core's `stepInstruction` — classic
// debugger stepping (no interrupt injection). `--over` steps OVER a `CALL`/`RST`: it runs
// the called routine to completion (bounded) and stops at the return address, so a single
// step doesn't disappear into a subroutine. Read-only in Slice 7a: the machine is sourced,
// stepped, and reported; nothing is persisted (the persistent session is Slice 7b).

import type { Command } from 'commander';
import { disassembleOne } from '@zx-vibes/asm';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { HostIo } from '../runtime/io-device.js';
import { readRegisters, type RegisterSnapshot } from './registers.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
} from './source.js';

/** Default step count when `[n]` is omitted (CLI-PROD-STEP-001). */
export const DEFAULT_STEPS = 1;
/** Safety cap on instructions executed while stepping OVER one call (avoids a non-returning routine). */
const STEP_OVER_CAP = 5_000_000;

/** One stepped instruction (the address it started at + its decode). */
export interface StepEntry {
  addr: number;
  bytes: number[];
  text: string;
}

export type StepEnvelope = {
  ok: true;
  stage: 'step';
  boot: ObserveBoot;
  /** Instructions stepped (`n`). */
  steps: number;
  /** Whether `--over` step-over was active. */
  over: boolean;
  /** PC before the first step. */
  from: number;
  /** PC after the last step. */
  pc: number;
  /** The stepped instructions, in order (a step-over lists the call line, not the routine body). */
  instructions: StepEntry[];
  registers: RegisterSnapshot;
};

export interface StepOptions {
  cwd?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
  steps?: number | undefined;
  over?: boolean | undefined;
}

/** Whether opcode byte `op` is a CALL / CALL cc / RST (the step-over targets). */
function isCallOrRst(op: number): boolean {
  return op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;
}

/** Run instructions until the call started at the boundary returns (PC = `returnAddr`, SP restored). */
function runUntilReturn(machine: Machine, returnAddr: number, spBefore: number): void {
  for (let k = 0; k < STEP_OVER_CAP; k += 1) {
    machine.stepInstruction();
    if ((machine.registers.pc & 0xffff) === returnAddr && (machine.registers.sp & 0xffff) >= spBefore) {
      return;
    }
  }
}

/** The `step` service (CLI-PROD-STEP-001). */
export function runStep(options: StepOptions = {}): StepEnvelope {
  const steps = options.steps ?? DEFAULT_STEPS;
  const over = options.over ?? false;
  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'step',
  });
  machine.io = new HostIo();

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
      if (transferred) runUntilReturn(machine, fallthrough, spBefore);
    }
  }

  return {
    ok: true,
    stage: 'step',
    boot,
    steps,
    over,
    from,
    pc: machine.registers.pc & 0xffff,
    instructions,
    registers: readRegisters(machine),
  };
}

/** Map the CLI context onto the `step` service. */
export function stepCommand(context: CommandContext): StepEnvelope {
  const options = context.options as Record<string, unknown>;
  const raw = context.args[0];
  return runStep({
    cwd: process.cwd(),
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
    steps: raw !== undefined ? parseSteps(raw) : undefined,
    over: options.over as boolean | undefined,
  });
}

function parseSteps(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw userError(`Invalid step count: "${input}" (expected a positive integer)`, 'step');
  }
  return n;
}

/** Declare the `step` command's argument / flags (CLI-PROD-STEP-001). */
export function configureStepCommand(command: Command): void {
  addSnapshotSourceFlags(command)
    .description('Execute n instructions and report the resulting state')
    .argument('[n]', `instructions to step (default ${DEFAULT_STEPS})`)
    .option('--bin <file>', 'step a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--over', 'step over CALL/RST (run the called routine to completion)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
