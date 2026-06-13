import type { HangVerdict, Watchdog } from './detect.js';
import type { Machine } from './machine.js';
import type { WatchHit, WatchpointMonitor } from './trace.js';

export const TSTATES_PER_FRAME = 69888;

export type StopReason =
  | 'frames'
  | 'tstates'
  | 'instructions'
  | 'until-pc'
  | 'max-frames'
  | 'hang'
  | 'breakpoint'
  | 'watchpoint';

export interface RunOptions {
  /** Stop after this many complete frames. */
  frames?: number;
  /** Stop after at least this many T-states have elapsed. */
  tstates?: number;
  /** Stop after this many instructions (debugger stepping). */
  instructions?: number;
  /** Stop when PC reaches this address (checked before each instruction). */
  untilPC?: number;
  /** Hard safety cap on frames per run() call. */
  maxFrames?: number;
  /** Called at each frame boundary with the frames-run count for this run. */
  onFrame?: (framesRun: number) => void;
  /** Called before each instruction with its PC (tracer hook). */
  onInstruction?: (pc: number) => void;
  /** Stop when PC reaches any of these addresses. */
  breakpoints?: ReadonlySet<number>;
  /** Skip the breakpoint check for the very first instruction (resume from a hit). */
  skipFirstBreakpoint?: boolean;
  /** Memory access watchpoints; a hit stops after the triggering instruction. */
  watchpoints?: WatchpointMonitor;
  /** Hang/crash classifier; definite verdicts stop the run immediately. */
  watchdog?: Watchdog;
}

export interface RunOutcome {
  reason: StopReason;
  framesRun: number;
  tstatesRun: number;
  pc: number;
  hang?: HangVerdict;
  breakpoint?: { addr: number };
  watchpointHit?: WatchHit;
}

const DEFAULT_MAX_FRAMES = 5000;

/**
 * Drives the machine exactly like ZXSpectrum.runFrame() does
 * (zx-generation@1.0.1 src/spectrum/spectrum.js:466), minus sound:
 * execute -> ula.addCycles -> tape.update -> setTapeInput -> interrupt.
 *
 * Unlike upstream, this loop can stop mid-frame (untilPC, hang verdicts);
 * the partial-frame position is kept in machine.tStatesIntoFrame so a later
 * run resumes the same frame where it left off.
 */
export function runMachine(m: Machine, opts: RunOptions = {}): RunOutcome {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  const targetFrames =
    opts.frames !== undefined ? Math.min(opts.frames, maxFrames) : maxFrames;
  const targetTstates = opts.tstates;
  const targetInstructions = opts.instructions;
  const untilPC = opts.untilPC;
  const wd = opts.watchdog;
  const breakpoints = opts.breakpoints;
  const watch = opts.watchpoints;

  const { cpu, ula, tape } = m;
  let framesRun = 0;
  let tstatesRun = 0;
  let instructionsRun = 0;
  let skipBreakpoint = opts.skipFirstBreakpoint ?? false;

  const finish = (reason: StopReason): RunOutcome => {
    // Budget exhaustion is when probable hangs (tight-loop, sp-corrupt) show.
    if (wd && (reason === 'frames' || reason === 'max-frames' || reason === 'tstates')) {
      const verdict = wd.finalize(m, framesRun);
      if (verdict) {
        return { reason: 'hang', framesRun, tstatesRun, pc: cpu.registers.getPC(), hang: verdict };
      }
    }
    return { reason, framesRun, tstatesRun, pc: cpu.registers.getPC() };
  };

  const restoreWrite = installWriteObservers(
    m,
    [
      wd?.onMemoryWrite.bind(wd),
      watch?.onMemoryWrite.bind(watch),
    ].filter((observer): observer is (addr: number, value: number) => void => observer !== undefined)
  );

  try {
    for (;;) {
    const pc = cpu.registers.getPC();
    if (untilPC !== undefined && pc === untilPC) {
      return { reason: 'until-pc', framesRun, tstatesRun, pc };
    }
    if (breakpoints?.has(pc)) {
      if (!skipBreakpoint) {
        return { reason: 'breakpoint', framesRun, tstatesRun, pc, breakpoint: { addr: pc } };
      }
    }
    skipBreakpoint = false;
    if (targetTstates !== undefined && tstatesRun >= targetTstates) {
      return finish('tstates');
    }
    if (targetInstructions !== undefined && instructionsRun >= targetInstructions) {
      return finish('instructions');
    }

    if (wd) {
      const verdict = wd.beforeInstruction(pc, m);
      if (verdict) {
        return { reason: 'hang', framesRun, tstatesRun, pc, hang: verdict };
      }
    }
    opts.onInstruction?.(pc);

    const elapsed = cpu.execute();
    instructionsRun++;
    ula.addCycles(elapsed);
    ula.setTapeInput(tape.update(cpu.cycles));
    if (ula.shouldGenerateInterrupt()) {
      cpu.interrupt();
    }
    tstatesRun += elapsed;
    m.tStatesIntoFrame += elapsed;

    let frameStop: StopReason | undefined;
    while (m.tStatesIntoFrame >= TSTATES_PER_FRAME) {
      m.tStatesIntoFrame -= TSTATES_PER_FRAME;
      m.frameCount++;
      framesRun++;
      wd?.onFrame();
      opts.onFrame?.(framesRun);

      if (opts.frames !== undefined && framesRun >= targetFrames) {
        frameStop = 'frames';
      }
      if (framesRun >= maxFrames) {
        frameStop = 'max-frames';
      }
    }

    if (watch?.hit) {
      const hit = watch.takeHit();
      return {
        reason: 'watchpoint',
        framesRun,
        tstatesRun,
        pc: cpu.registers.getPC(),
        watchpointHit: { ...hit!, pc },
      };
    }

    if (wd) {
      const verdict = wd.afterInstruction(cpu);
      if (verdict) {
        return {
          reason: 'hang',
          framesRun,
          tstatesRun,
          pc: cpu.registers.getPC(),
          hang: verdict,
        };
      }
    }

    if (frameStop) {
      return finish(frameStop);
    }
  }
  } finally {
    restoreWrite();
  }
}

function installWriteObservers(
  m: Machine,
  observers: ((addr: number, value: number) => void)[]
): () => void {
  if (observers.length === 0) return () => {};

  const originalWrite = m.memory.write;
  m.memory.write = (addr: number, value: number): void => {
    for (const observer of observers) observer(addr, value);
    originalWrite.call(m.memory, addr, value);
  };

  return () => {
    m.memory.write = originalWrite;
  };
}
