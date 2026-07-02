// Run service — cli.md CLI-PROD-RUN-001..005 + CLI-PROD-OUT-RUN-001/002,
// toolkit-runtime.md RT-PROD-RUN-001..006, errors.md ERR-PROD-HANG-*.
//
// `zxs run` executes the emulator FRESH BY DEFAULT — a pure function of (source,
// frame budget, scheduled input) (CLI-PROD-RUN-001, RT-PROD-SESSION-001). It boots
// a clean 48K ROM machine, loads the program (the `bin` source / the configured
// entry built on the fly), installs the observable `HostIo` device, runs a bounded
// frame budget under the hang watchdog while applying the scheduled keyboard + Kempston
// plans and the instruction-granular stop conditions, then reports the `run` envelope
// (CLI-PROD-OUT-RUN-001): `{ ok, stage:"run", status, boot, exit, framesRun,
// tstatesRun, audio, registers, screen, input }` (+ a `hang` verdict on a hang).
//
// The run loop is built on `HostIo` (port-`0xFE` write observation → beeper edges +
// border + port-write count, the single primitive that makes RUN-BEEPER-001
// observable) and `runFrameObserved` (instruction granularity for stop conditions +
// definite-hang checks).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Machine } from '@zx-vibes/machine';
import { resolveConfig } from '../config/config.js';
import { ExitCode, envError, userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { runBuild } from '../build/build.js';
import { captureScreenshot } from '../observe/screenshot.js';
import { loadBinMachine, RAM_BASE } from './session.js';
import { loadMachineFromSource, selectedFileSource } from './machine-source.js';
import { renderBeeperWav } from './wav.js';
import { loadDebugStore, loadSession, saveSession } from '../state/persist.js';
import { parseAddress, parseRange, type AddressRange } from '../util/address.js';
import { HostIo } from './io-device.js';
import { runFrameObserved } from './run-loop.js';
import {
  definiteHang,
  newHangStats,
  probableHang,
  updateHangStats,
  type HangVerdict,
} from './hang.js';
import { readRegisters, type RegisterSnapshot } from '../observe/registers.js';
import { summarizeScreen, type ScreenSummary } from '../observe/screen.js';
import {
  joyByteAt,
  keysPressedAt,
  parseJoySchedule,
  parseKeySchedule,
  planFrames,
  type JoyEvent,
  type KeyEvent,
} from './schedule.js';

/**
 * Why `--watch-read` cannot be honored (CLI-PROD-RUN-003 mandates the flag, but the
 * cores expose no memory-read bus hook). Used to fail loudly — never accept-and-never-fire
 * (ERR-PROD-NOSILENT-001 / C5). It is an environment/capability gap, not a user mistake,
 * so it maps to ENV_ERROR (exit 3): the recovery is a toolchain/core change, not an arg fix.
 */
export const READ_WATCH_UNAVAILABLE =
  'Read watchpoints (--watch-read) are unavailable in this build: the emulator core ' +
  '(@zx-vibes/cpu / @zx-vibes/machine) exposes no memory-read bus hook, so a read cannot be ' +
  'observed (a tracked contract gap). Use --watch-write / --until-write to stop on a write, ' +
  'or --until-change to stop when a byte changes.';

/** 48K Z80 clock (BEEPER-PCM-CLOCK-001) — used for the audio tone estimate. */
export const CPU_CLOCK_HZ = 3_500_000;
/** Default frame budget (RT-PROD-RUN-001 / CLI-PROD-RUN-002); 50 frames ≈ 1 second. */
export const DEFAULT_FRAMES = 300;
/** `--until-break`/`--until-watch` raise the budget so a stop condition can fire (RT-PROD-RUN-006). */
export const UNTIL_BREAK_MIN_FRAMES = 3000;

/** The final run status (CLI-PROD-OUT-RUN-001). */
export type RunStatus = 'ok' | 'hang' | 'breakpoint' | 'watchpoint';

/** The audio summary (RT-PROD-RUN-005). */
export interface RunAudio {
  /** Port-`0xFE` bit-4 edge count — the contract field (CLI-PROD-OUT-RUN-AUDIO-001, RUN-BEEPER-001). */
  beeperEdges: number;
  /** Total ULA (port-`0xFE`) writes during the run (ASSERT-PROD-PORTFE-001). */
  portFEWrites: number;
  /** Final speaker level (0/1). */
  level: number;
  /** Rough average tone in Hz from the edge spacing (0 when < 2 edges). */
  toneHz: number;
}

/** How the run's machine was sourced (CLI-PROD-OUT-RUN-001 `boot`). */
export interface RunBoot {
  source: 'bin' | 'z80' | 'tap' | 'build' | 'state';
  org: number;
  file?: string;
  entry?: string;
  /** Snapshot version (1/2/3) when the source is a `.z80`. */
  version?: number;
}

/** The exit summary (CLI-PROD-OUT-RUN-001 `exit`, enriched on a hang per CLI-PROD-OUT-RUN-002). */
export interface RunExit {
  reason: 'frame-budget' | 'until-pc' | 'breakpoint' | 'watchpoint' | 'hang';
  pc: number;
  kind?: HangVerdict['kind'];
  likelyCause?: string;
}

/** Per-invocation run parameters (RT-PROD-CONFIG-002) — already parsed to numbers/ranges. */
export interface RunParams {
  /** Frame budget (default {@link DEFAULT_FRAMES}). */
  frames?: number | undefined;
  /** Hang watchdog on/off (default true, RT-PROD-RUN-003). */
  detectHangs?: boolean | undefined;
  /** Raw `--keys` schedule spec (CLI-PROD-RUN-004). */
  keys?: string | undefined;
  /** Raw `--joy` schedule spec (CLI-PROD-RUN-005). */
  joy?: string | undefined;
  /** Stop when PC reaches this address (`--until-pc`). */
  untilPc?: number | undefined;
  /** Raise the budget for a persistent break/watch to fire (`--until-break`). */
  untilBreak?: boolean | undefined;
  /** Raise the budget for a persistent watch to fire (`--until-watch`). */
  untilWatch?: boolean | undefined;
  /**
   * Stored breakpoint PCs to stop at (the persistent `break` store, fed by
   * `run --until-break`). Each is a 16-bit PC; the run stops with status `breakpoint`
   * when execution reaches one — the same watchpoint model as `--until-pc` (RT-PROD-RUN-002).
   */
  breakpoints?: number[] | undefined;
  /** Stop when any byte in this range changes (`--until-write`). */
  untilWrite?: AddressRange | undefined;
  /** Stop when the byte at this address changes (`--until-change`). */
  untilChange?: number | undefined;
  /** Temporary read watchpoints (`--watch-read`) — see the read-watch observability note below. */
  watchRead?: AddressRange[] | undefined;
  /** Temporary write watchpoints (`--watch-write`). */
  watchWrite?: AddressRange[] | undefined;
  /** Per-frame checkpoint hook (seam for the test runner's temporal/`at` snapshots, Slice 4). */
  onFrame?: ((frame: number, machine: Machine, io: HostIo) => void) | undefined;
  /**
   * Per-instruction hook (Slice 7a): called just before each instruction executes,
   * with the live machine (PC = the instruction about to run). The seam `trace`
   * (instruction log + hot-spots) and `coverage` (executed-address set) build on —
   * read-only, it must not mutate the machine. Not called for the interrupt-accept
   * boundary (which is not a fetched instruction); the ISR entry is observed on its
   * own next instruction.
   */
  onStep?: ((machine: Machine) => void) | undefined;
}

/** The structured run result the run service produces (consumed by `verify`/`test`/the CLI). */
export interface RunResult {
  status: RunStatus;
  framesRun: number;
  tstatesRun: number;
  /**
   * Whether the run was paced by the HALT/interrupt cadence (ASSERT-PROD-HALT-001):
   * true iff the hang watchdog was on, the run did not hang, and the once-per-frame
   * interrupt resumed the CPU from HALT for the majority of frames (the HALT-synced
   * 50 Hz game-loop substrate, machine-execution.md MACHINE-FRAME-LOOP-001). The
   * detection threshold is an Incidental heuristic; the contract is that it reflects
   * HALT/interrupt-cadence alignment (REC-PROD-EDGE-002: meaningless when hangs are off).
   */
  haltSynced: boolean;
  exit: RunExit;
  hang?: HangVerdict;
  audio: RunAudio;
  registers: RegisterSnapshot;
  screen: ScreenSummary;
  input: { keys: KeyEvent[]; joy: JoyEvent[] };
  /** The post-run machine (live access for `verify`/`test`/observe commands). */
  machine: Machine;
  /** The observable I/O device (border, beeper edge stream, port-write counts). */
  io: HostIo;
}

/**
 * Execute a loaded program for a bounded frame budget and produce the structured run
 * result (RT-PROD-RUN-001..005). `machine` is an already-booted machine with the
 * program loaded and PC at its entry; `org` is the load origin (used by the hang
 * heuristics to distinguish a RAM program from ROM). Stateless: it mutates only the
 * passed machine and never resumes/persists on-disk state (RT-PROD-SESSION-001).
 *
 * NOTE — read-watch observability: write/change stop conditions (`--until-write`,
 * `--until-change`, `--watch-write`) are detected by per-instruction memory diffing.
 * `--watch-read` (CLI-PROD-RUN-003, mandated on `run`) CANNOT be honored: `@zx-vibes/cpu`/
 * `@zx-vibes/machine` read memory directly (a raw `Uint8Array`) with no read-bus hook to
 * observe a read. So a non-empty `watchRead` FAILS LOUDLY with an ENV_ERROR (a tracked
 * contract gap, never a silent accept-and-never-fire — ERR-PROD-NOSILENT-001 / C5), pointing
 * the caller at the stop conditions that DO work. The `watchRead` param + plumbing stay
 * dormant so dropping the guard is all a future memory-read hook needs.
 */
export function runProgram(machine: Machine, org: number, params: RunParams = {}): RunResult {
  // Read watchpoints are unobservable with the current cores — fail loudly, do not
  // accept-and-never-fire (the C5 silent-debt the regeneration forbids).
  if (params.watchRead && params.watchRead.length > 0) {
    throw envError(READ_WATCH_UNAVAILABLE, 'run');
  }

  const io = new HostIo();
  machine.io = io;

  const keys = parseKeySchedule(params.keys);
  const joy = parseJoySchedule(params.joy);
  const detectHangs = params.detectHangs !== false;

  let budget = params.frames ?? DEFAULT_FRAMES;
  if (params.untilBreak || params.untilWatch) budget = Math.max(budget, UNTIL_BREAK_MIN_FRAMES);
  budget = Math.max(budget, planFrames(keys, joy));

  // Build the watched-address shadow for the write/change stop conditions.
  const watchAddrs = collectWatchAddresses(params);
  const watchInit = watchAddrs.map((addr) => machine.memory[addr]!);
  const untilPc = params.untilPc;
  // Stored breakpoints (the persistent `break` store, via `--until-break`) — the same
  // PC-stop model as `--until-pc`, kept as a Set for O(1) per-instruction membership.
  const breakpoints = new Set((params.breakpoints ?? []).map((pc) => pc & 0xffff));

  const startTotal = machine.tStatesTotal;
  const stats = newHangStats();
  // HALT-sync cadence (ASSERT-PROD-HALT-001): count frames whose once-per-frame
  // interrupt resumed the CPU from a HALT wait (the interrupt-paced game loop).
  let haltedInterruptFrames = 0;

  let status: RunStatus = 'ok';
  let reason: RunExit['reason'] = 'frame-budget';
  let stopPc = machine.registers.pc & 0xffff;
  let verdict: HangVerdict | undefined;
  let stopped = false;

  // The per-instruction observer: a definite hang (immediate), the target-PC
  // breakpoint, then the write/change watchpoints.
  const observe = (m: Machine): boolean => {
    if (detectHangs) {
      const v = definiteHang(m, org);
      if (v) {
        verdict = v;
        status = 'hang';
        reason = 'hang';
        stopPc = v.pc;
        return true;
      }
    }
    const pc = m.registers.pc & 0xffff;
    if (untilPc !== undefined && pc === untilPc) {
      status = 'breakpoint';
      reason = 'until-pc';
      stopPc = untilPc;
      return true;
    }
    if (breakpoints.has(pc)) {
      status = 'breakpoint';
      reason = 'breakpoint';
      stopPc = pc;
      return true;
    }
    for (let i = 0; i < watchAddrs.length; i += 1) {
      if (m.memory[watchAddrs[i]!] !== watchInit[i]) {
        status = 'watchpoint';
        reason = 'watchpoint';
        stopPc = m.registers.pc & 0xffff;
        return true;
      }
    }
    return false;
  };

  // Entry guard: a target PC / stored breakpoint equal to the entry fires before
  // executing anything.
  const entryPc = machine.registers.pc & 0xffff;
  if (untilPc !== undefined && entryPc === untilPc) {
    status = 'breakpoint';
    reason = 'until-pc';
    stopPc = untilPc;
    stopped = true;
  } else if (breakpoints.has(entryPc)) {
    status = 'breakpoint';
    reason = 'breakpoint';
    stopPc = entryPc;
    stopped = true;
  }

  let framesRun = 0;
  for (let f = 0; !stopped && f < budget; f += 1) {
    io.setInput(keysPressedAt(keys, f), joyByteAt(joy, f));
    // Whether THIS frame's interrupt resumed the CPU from HALT — the healthy
    // HALT-synced cadence the hang stats must count as progress (an idle HALT
    // loop looks byte-identical at every pinned frame boundary).
    let haltResumed = false;
    stopped = runFrameObserved(
      machine,
      observe,
      (m) => {
        io.setClock(m.tStatesTotal);
        params.onStep?.(m);
      },
      (wasHalted) => {
        if (wasHalted) {
          haltedInterruptFrames += 1;
          haltResumed = true;
        }
      },
    );
    framesRun = f + 1;
    params.onFrame?.(f, machine, io);
    if (stopped) break;
    if (detectHangs) updateHangStats(stats, machine, haltResumed);
  }

  // A run that reached its budget with no early stop may still be a PROBABLE hang
  // (tight-loop / sp-corrupt / pc-in-rom), decided here (ERR-PROD-HANG-KINDS-001).
  if (status === 'ok' && detectHangs && !stopped) {
    const v = probableHang(machine, org, stats);
    if (v) {
      verdict = v;
      status = 'hang';
      reason = 'hang';
      stopPc = v.pc;
    }
  }

  const tstatesRun = machine.tStatesTotal - startTotal;
  const seconds = tstatesRun / CPU_CLOCK_HZ;
  const toneHz = io.beeperEdges >= 2 && seconds > 0 ? Math.round(io.beeperEdges / (2 * seconds)) : 0;

  const exit: RunExit = { reason, pc: stopPc };
  if (status === 'hang' && verdict) {
    exit.kind = verdict.kind;
    if (verdict.likelyCause !== undefined) exit.likelyCause = verdict.likelyCause;
  }

  // HALT-synced iff hangs were watched, the run did not hang, and the interrupt
  // resumed the CPU from HALT in the majority of frames (ASSERT-PROD-HALT-001). The
  // signal is bimodal (a HALT loop ≈ every frame; a busy/non-halting loop = 0), so a
  // simple majority threshold separates them robustly (Incidental heuristic).
  const haltSynced =
    detectHangs && status !== 'hang' && framesRun > 0 && haltedInterruptFrames * 2 > framesRun;

  return {
    status,
    framesRun,
    tstatesRun,
    haltSynced,
    exit,
    ...(verdict ? { hang: verdict } : {}),
    audio: {
      beeperEdges: io.beeperEdges,
      portFEWrites: io.portFEWrites,
      level: io.speaker(),
      toneHz,
    },
    registers: readRegisters(machine),
    screen: summarizeScreen(machine, io.borderColor()),
    input: { keys, joy },
    machine,
    io,
  };
}

/** Flatten the write/change stop conditions to a de-duplicated address list. */
function collectWatchAddresses(params: RunParams): number[] {
  const addrs = new Set<number>();
  if (params.untilChange !== undefined) addrs.add(params.untilChange & 0xffff);
  const addRange = (range: AddressRange): void => {
    for (let a = range.from; a <= range.to; a += 1) addrs.add(a & 0xffff);
  };
  if (params.untilWrite) addRange(params.untilWrite);
  for (const range of params.watchWrite ?? []) addRange(range);
  return [...addrs];
}

// --- CLI envelope ----------------------------------------------------------

type RunReport = {
  stage: 'run';
  status: RunStatus;
  boot: RunBoot;
  exit: RunExit;
  framesRun: number;
  tstatesRun: number;
  audio: RunAudio;
  registers: RegisterSnapshot;
  screen: ScreenSummary;
  input: { keys: KeyEvent[]; joy: JoyEvent[] };
};

export type RunSuccessEnvelope = RunReport & { ok: true };
export type RunHangEnvelope = RunReport & {
  ok: false;
  hang: HangVerdict;
  error: { message: string; exitCode: typeof ExitCode.HANG };
};
/** The `run` report envelope — a successful run (exit 0) or a hang (exit 2, CLI-PROD-OUT-RUN-002). */
export type RunEnvelope = RunSuccessEnvelope | RunHangEnvelope;

/** Assemble the run envelope from a {@link RunResult} (CLI-PROD-OUT-RUN-001). */
export function buildRunEnvelope(result: RunResult, boot: RunBoot): RunEnvelope {
  const report: RunReport = {
    stage: 'run',
    status: result.status,
    boot,
    exit: result.exit,
    framesRun: result.framesRun,
    tstatesRun: result.tstatesRun,
    audio: result.audio,
    registers: result.registers,
    screen: result.screen,
    input: result.input,
  };
  if (result.status === 'hang' && result.hang) {
    return {
      ok: false,
      ...report,
      hang: result.hang,
      error: {
        message: `Run detected a hang (${result.hang.kind}) at PC 0x${result.hang.pc
          .toString(16)
          .toUpperCase()}`,
        exitCode: ExitCode.HANG,
      },
    };
  }
  return { ok: true, ...report };
}

// --- CLI wiring ------------------------------------------------------------

interface RunCliOptions {
  bin?: string;
  sna?: string;
  z80?: string;
  tap?: string;
  org?: string;
  frames?: string;
  untilPc?: string;
  untilBreak?: boolean;
  untilWatch?: boolean;
  untilWrite?: string;
  untilChange?: string;
  watchRead?: string[];
  watchWrite?: string[];
  keys?: string;
  joy?: string;
  screenshot?: string;
  wav?: string;
  state?: string;
  /** Commander negation of `--no-save`: `false` when the flag is present (default true). */
  save?: boolean;
  readOnly?: boolean;
}

/** Boot the run machine from the source flags / configured entry, returning the boot descriptor. */
function resolveRunMachine(options: RunCliOptions, cwd: string): { machine: Machine; org: number; boot: RunBoot } {
  const resolved = resolveConfig({ cwd, flags: { org: options.org } });
  const org = parseAddress(resolved.org, 'run');

  // Opt-in persistent session (`--state`): resume the saved machine instead of a
  // fresh boot (RT-PROD-SESSION-001/002). The resumed PC is wherever the session
  // paused; `org` is the RAM floor for the hang heuristics (a resumed program lives
  // in RAM — a PC in ROM is still suspicious).
  if (options.state !== undefined) {
    const session = loadSession(options.state, cwd);
    return { machine: session.machine, org: RAM_BASE, boot: { source: 'state', org: RAM_BASE, file: options.state } };
  }

  // A concrete file-image source (`--bin` / `--z80` / `--tap` / `--sna`) routes through the
  // ONE shared loader (CLI-PROD-CONV-SOURCE-001), so `run`, observe, and MCP agree on the
  // source contract. The hang heuristics use the loader's `ramFloor` (the `--bin` origin, or
  // `RAM_BASE` for a snapshot/tape that lives across RAM); `--sna` fails loud (W4-GAP-03).
  if (selectedFileSource({ bin: options.bin, z80: options.z80, tap: options.tap, sna: options.sna }) !== undefined) {
    const loaded = loadMachineFromSource({
      cwd,
      stage: 'run',
      bin: options.bin,
      z80: options.z80,
      tap: options.tap,
      sna: options.sna,
      org: options.org,
    });
    return { machine: loaded.machine, org: loaded.ramFloor, boot: loaded.boot };
  }

  // No explicit source: build the configured entry fresh, then load it at `org`
  // (CLI-PROD-RUN-001 "or the configured entry"; the verify pipeline's path).
  const build = runBuild({ cwd, outDir: resolved.outDir });
  if (!build.ok) {
    throw userError(
      `Cannot run: build failed with ${build.errorCount} error(s) in ${build.entry} (run \`zxs build\` for details)`,
      'run',
    );
  }
  const binPath = build.outputs.bin;
  if (!binPath) throw userError('Cannot run: the build produced no binary', 'run');
  return {
    machine: loadBinMachine(resolve(cwd, binPath), org),
    org,
    boot: { source: 'build', org, entry: build.entry },
  };
}

function parseRanges(values: string[] | undefined): AddressRange[] {
  return (values ?? []).map((v) => parseRange(v, 'run'));
}

/** The `run` command handler: map the CLI context onto the run service (CLI-PROD-RUN-001..005). */
export function runCommand(context: CommandContext): RunEnvelope {
  const options = context.options as RunCliOptions;

  // Read watchpoints are a mandated flag (CLI-PROD-RUN-003) the cores cannot honor —
  // reject on PRESENCE, before parsing the range value, so any use gets the honest
  // "unavailable" verdict rather than a misleading range-format error (ENV_ERROR, exit 3).
  if (options.watchRead !== undefined && options.watchRead.length > 0) {
    throw envError(READ_WATCH_UNAVAILABLE, 'run');
  }

  const cwd = process.cwd();
  const { machine, org, boot } = resolveRunMachine(options, cwd);

  // The persistent break/watch store feeds the ONE watchpoint model when the caller
  // opts in via `--until-break`/`--until-watch` (RT-PROD-RUN-002, CLI-PROD-EDGE-001
  // raises the budget). Stored read watchpoints CANNOT be honored — fail loud
  // (W4-GAP-01), never silently no-op.
  const breakpoints: number[] = [];
  const storedWatchWrite: AddressRange[] = [];
  if (options.untilBreak || options.untilWatch) {
    const store = loadDebugStore(cwd);
    if (options.untilBreak) breakpoints.push(...store.breakpoints.map((b) => b.addr));
    if (options.untilWatch) {
      if (store.watchpoints.some((w) => w.type === 'read')) {
        throw envError(READ_WATCH_UNAVAILABLE, 'run');
      }
      for (const w of store.watchpoints) {
        if (w.type === 'write') storedWatchWrite.push({ from: w.from, to: w.to });
      }
    }
  }

  const params: RunParams = {
    frames: options.frames !== undefined ? parsePositiveInt(options.frames) : undefined,
    keys: options.keys,
    joy: options.joy,
    untilPc: options.untilPc !== undefined ? parseAddress(options.untilPc, 'run') : undefined,
    untilBreak: options.untilBreak,
    untilWatch: options.untilWatch,
    untilWrite: options.untilWrite !== undefined ? parseRange(options.untilWrite, 'run') : undefined,
    untilChange: options.untilChange !== undefined ? parseAddress(options.untilChange, 'run') : undefined,
    watchRead: parseRanges(options.watchRead),
    watchWrite: [...parseRanges(options.watchWrite), ...storedWatchWrite],
    breakpoints,
  };

  const result = runProgram(machine, org, params);

  // Output capture (CLI-PROD-RUN-004, RT-PROD-OUT-002): write the post-run screen PNG and/or
  // the beeper WAV to the caller-specified paths. The screenshot routes through the ONE
  // screenshot encoder (CLI-PROD-RULE-SCREENSHOT-001); the WAV renders the run's beeper edge
  // stream per beeper-output.md (BEEPER-PCM-*). Both are deterministic functions of the run.
  if (options.screenshot !== undefined) {
    captureScreenshot(result.machine, resolve(cwd, options.screenshot));
  }
  if (options.wav !== undefined) {
    const startT = result.machine.tStatesTotal - result.tstatesRun;
    const wav = renderBeeperWav(result.io.edges, startT, result.tstatesRun);
    const out = resolve(cwd, options.wav);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, wav);
  }

  // Persist the post-run session when `--state` opted in, unless `--no-save`/`--read-only`
  // (RT-PROD-SESSION-003). The border is the run's realized border; the live debug store
  // rides along so a saved session is self-contained for the MCP handoff.
  if (options.state !== undefined && options.save !== false && options.readOnly !== true) {
    saveSession(
      options.state,
      { machine: result.machine, border: result.io.borderColor(), debug: loadDebugStore(cwd) },
      cwd,
    );
  }

  return buildRunEnvelope(result, boot);
}

function parsePositiveInt(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw userError(`Invalid --frames value: "${input}" (expected a positive integer)`, 'run');
  }
  return n;
}

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Declare the `run` command's flags on its commander instance (CLI-PROD-RUN-001..005). */
export function configureRunCommand(command: Command): void {
  command
    .description('Run the emulator for a frame budget (fresh by default)')
    .option('--bin <file>', 'load a raw binary at --org and run it')
    .option('--sna <file>', 'load a .sna snapshot (unsupported: no core codec, W4-GAP-03 — fails loud)')
    .option('--z80 <file>', 'boot from a .z80 snapshot (v1/v2/v3)')
    .option('--tap <file>', 'boot from a .tap tape (instant-loads its CODE block)')
    .option('--org <addr>', 'load origin for --bin / the built entry (default 0x8000)')
    .option('--frames <n>', 'frame budget (default 300; 50 frames ≈ 1 second)')
    .option('--until-pc <addr>', 'stop when PC reaches this address')
    .option('--until-break', 'run until a breakpoint fires (raises the frame budget)')
    .option('--until-watch', 'run until a watchpoint fires (raises the frame budget)')
    .option('--until-write <range>', 'stop when any byte in the range is written')
    .option('--until-change <addr>', 'stop when the byte at this address changes')
    .option(
      '--watch-read <range>',
      'temporary read watchpoint (repeatable) — unavailable: the core exposes no memory-read hook (use --watch-write)',
      collect,
      [],
    )
    .option('--watch-write <range>', 'temporary write watchpoint (repeatable)', collect, [])
    .option('--keys <spec>', 'scheduled keyboard input, e.g. "60:O*30,120:SPACE*5"')
    .option('--joy <spec>', 'scheduled Kempston input, e.g. "60:R*30,90:RF*10"')
    .option('--screenshot <file>', 'capture the post-run screen to a PNG (the one encoder)')
    .option('--wav <file>', 'capture the run beeper audio to a WAV (mono 16-bit PCM)')
    .option('--state <file>', 'resume + persist an opt-in persistent session (.zxstate)')
    .option('--no-save', 'do not persist the session (when --state is active)')
    .option('--read-only', 'do not persist the session (when --state is active)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
