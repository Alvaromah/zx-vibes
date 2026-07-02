// `zxs regs` — report the CPU registers, and `regs set <reg> <value>` writes one
// register into the session (cli.md CLI-PROD-REGS-001, RT-PROD-OBSERVE-001).
//
// The read path sources a machine (built entry / `--bin` / fresh / `--state` session)
// and decodes its register file through the shared `readRegisters` primitive (the same
// view the `run` envelope reports). The write path (`regs set`, Slice 7b) opens a
// mutation session, writes one register, and persists it back to the `--state` file
// (RT-PROD-SESSION-003) — on a fresh source it applies in-memory and (with `--state`)
// can create the session. A bad register name / value is a USER_ERROR, never a silent
// no-op (ERR-PROD-NOSILENT-001).

import type { Command } from 'commander';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { parseNumber } from '../util/address.js';
import { openSession } from '../state/persist.js';
import { readRegisters, type RegisterSnapshot } from './registers.js';
import {
  resolveObserveMachine,
  addSnapshotSourceFlags,
  snapshotSourceFlags,
  type ObserveBoot,
} from './source.js';

export type RegsEnvelope = {
  ok: true;
  stage: 'regs';
  boot: ObserveBoot;
  registers: RegisterSnapshot;
};

/** The `regs set` result: the written register + value, whether it was persisted, and the new view. */
export type RegsSetEnvelope = {
  ok: true;
  stage: 'regs';
  op: 'set';
  reg: string;
  value: number;
  /** True iff the mutation was persisted to a `--state` session. */
  persisted: boolean;
  registers: RegisterSnapshot;
};

export interface RegsOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  z80?: string | undefined;
  tap?: string | undefined;
  sna?: string | undefined;
  org?: string | undefined;
}

/** The `regs` service (CLI-PROD-REGS-001): source a machine and decode its registers. */
export function runRegs(options: RegsOptions = {}): RegsEnvelope {
  const { machine, boot } = resolveObserveMachine({
    cwd: options.cwd,
    state: options.state,
    bin: options.bin,
    z80: options.z80,
    tap: options.tap,
    sna: options.sna,
    org: options.org,
    stage: 'regs',
  });
  return { ok: true, stage: 'regs', boot, registers: readRegisters(machine) };
}

// How each writable register name maps onto the machine's 8-bit-half register file.
// Pairs split hi/lo; pc/sp are stored as 16-bit; control regs clamp to their width.
const REG8 = new Set([
  'a', 'f', 'b', 'c', 'd', 'e', 'h', 'l',
  'a_', 'f_', 'b_', 'c_', 'd_', 'e_', 'h_', 'l_',
  'i', 'r', 'ixh', 'ixl', 'iyh', 'iyl',
]);
const PAIR: Readonly<Record<string, readonly [string, string]>> = {
  af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'],
  ix: ['ixh', 'ixl'], iy: ['iyh', 'iyl'],
  "af'": ['a_', 'f_'], "bc'": ['b_', 'c_'], "de'": ['d_', 'e_'], "hl'": ['h_', 'l_'],
};
const REG16 = new Set(['pc', 'sp']);
const CONTROL: Readonly<Record<string, number>> = { im: 3, iff1: 1, iff2: 1 };

/** Normalize a register name to its canonical key (lower-case; `'`/`2` alt suffixes accepted). */
function normalizeRegName(name: string): string {
  const n = name.trim().toLowerCase();
  // Accept `a2`/`bc2` as aliases for the alternate set alongside `a'`/`bc'`.
  if (/^(af|bc|de|hl)2$/.test(n)) return `${n.slice(0, 2)}'`;
  if (/^[a-l]2$/.test(n)) return `${n.slice(0, 1)}_`;
  return n;
}

/**
 * Write one register into a machine (`regs set`). Accepts 8-bit registers, the
 * 16-bit pairs (`af`/`bc`/`de`/`hl`/`ix`/`iy` + alternates), `pc`/`sp`, and the
 * control registers `im`/`iff1`/`iff2`. An unknown name or out-of-range value is a
 * USER_ERROR.
 */
export function setRegister(machine: Machine, rawName: string, value: number): void {
  const name = normalizeRegName(rawName);
  const reg = machine.registers as Record<string, number>;

  if (REG16.has(name)) {
    requireRange(rawName, value, 0xffff);
    reg[name] = value & 0xffff;
    return;
  }
  if (REG8.has(name)) {
    requireRange(rawName, value, 0xff);
    reg[name] = value & 0xff;
    return;
  }
  const pair = PAIR[name];
  if (pair) {
    requireRange(rawName, value, 0xffff);
    reg[pair[0]] = (value >> 8) & 0xff;
    reg[pair[1]] = value & 0xff;
    return;
  }
  if (name in CONTROL) {
    requireRange(rawName, value, CONTROL[name]!);
    reg[name] = value;
    return;
  }
  throw userError(
    `Unknown register "${rawName}" (use a/f/b/c/d/e/h/l, af/bc/de/hl, ix/iy, pc/sp, i/r, im, iff1/iff2, or an alternate like bc')`,
    'regs',
  );
}

function requireRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw userError(`Invalid value for ${name}: ${value} (expected 0..${max})`, 'regs');
  }
}

export interface RegsSetOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  org?: string | undefined;
  noSave?: boolean | undefined;
  reg: string;
  value: number;
}

/** The `regs set` service (CLI-PROD-REGS-001): open a session, write a register, persist. */
export function runRegsSet(options: RegsSetOptions): RegsSetEnvelope {
  const session = openSession({
    cwd: options.cwd,
    state: options.state,
    bin: options.bin,
    org: options.org,
    noSave: options.noSave,
    stage: 'regs',
  });
  setRegister(session.machine, options.reg, options.value);
  session.save();
  return {
    ok: true,
    stage: 'regs',
    op: 'set',
    reg: options.reg,
    value: options.value,
    persisted: session.persistent && options.noSave !== true,
    registers: readRegisters(session.machine),
  };
}

/** Map the CLI context onto the `regs` / `regs set` services. */
export function regsCommand(context: CommandContext): RegsEnvelope | RegsSetEnvelope {
  const options = context.options as Record<string, unknown>;
  if (context.args[0] === 'set') {
    const reg = context.args[1];
    const rawValue = context.args[2];
    if (reg === undefined || rawValue === undefined) {
      throw userError('regs set requires <reg> <value>, e.g. `regs set hl 0x8000`', 'regs');
    }
    const value = parseNumber(rawValue);
    if (value === undefined) {
      throw userError(`Invalid value: "${rawValue}" (use 0x1F, $1F, 1Fh, or decimal)`, 'regs');
    }
    return runRegsSet({
      cwd: process.cwd(),
      state: options.state as string | undefined,
      bin: options.bin as string | undefined,
      org: options.org as string | undefined,
      noSave: options.save === false || options.readOnly === true,
      reg,
      value,
    });
  }
  return runRegs({
    cwd: process.cwd(),
    state: options.state as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    ...snapshotSourceFlags(options),
  });
}

/** Declare the `regs` command's flags (CLI-PROD-REGS-001). */
export function configureRegsCommand(command: Command): void {
  command
    .description('Report the CPU registers, or `set <reg> <value>` to write one')
    .argument('[args...]', 'subcommand: `set <reg> <value>`')
    .option('--state <file>', 'read/write an opt-in persistent session (.zxstate)')
    .option('--bin <file>', 'read registers from a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)');
  addSnapshotSourceFlags(command)
    .option('--no-save', 'do not persist the mutation (when --state is active)')
    .option('--read-only', 'do not persist the mutation (when --state is active)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
