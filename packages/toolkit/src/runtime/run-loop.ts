// Instruction-granular frame driver — the run loop's execution engine.
//
// `Machine.runFrame` runs a whole frame atomically and exposes NO per-instruction
// hook, but the run service needs instruction granularity for its stop conditions
// (target PC / watchpoints, RT-PROD-RUN-002) and its per-instruction hang checks
// (di-halt / rom-error, ERR-PROD-HANG-KINDS-001). So this driver mirrors
// `Machine.runFrame` (machine-execution.md MACHINE-FRAME-LOOP-001) exactly — the
// once-per-frame INT sampled at instruction boundaries with the post-EI delay — but
// calls an observer after every executed instruction. It composes the PUBLIC core
// primitives (`acceptInterrupt`/`INT_DATA_BUS` from `@zx-vibes/machine`,
// `interruptActive`/`FRAME_T_STATES` from `@zx-vibes/ula`), so it stays faithful to
// the core's interrupt timing rather than inventing its own.
//
// (Determinism guard: a `tests/run-loop` case asserts that, with a no-op observer,
// this driver leaves the machine in byte-identical state to `Machine.runFrame`.)
//
// SEAM: if `@zx-vibes/machine` later exposes an `onInstruction` hook on `runFrame`,
// this file collapses to a thin adapter and the duplicated loop goes away.

import { acceptInterrupt, INT_DATA_BUS, type Machine } from '@zx-vibes/machine';
import { FRAME_T_STATES, interruptActive } from '@zx-vibes/ula';

const EI_OPCODE = 0xfb;

/** Called after each executed instruction (and after an accepted interrupt); return `true` to stop. */
export type InstructionObserver = (machine: Machine) => boolean;

/** Called just before each instruction is fetched (e.g. to timestamp the I/O clock). */
export type BeforeStep = (machine: Machine) => void;

/**
 * Called when the once-per-frame maskable interrupt is accepted, with `wasHalted`
 * = whether the CPU was waiting in HALT when the interrupt arrived. This is the
 * canonical HALT/interrupt-cadence signal (machine-execution.md MACHINE-FRAME-LOOP-001:
 * a HALT-synced loop is the one whose per-frame interrupt resumes it from HALT). The
 * test runner counts these to derive `haltSynced` (ASSERT-PROD-HALT-001).
 */
export type InterruptObserver = (wasHalted: boolean) => void;

function interruptArmed(machine: Machine): boolean {
  return Boolean(machine.registers.iff1) && machine.eiDelay === 0;
}

// Mirror Machine._acceptInterrupt against the public acceptInterrupt(): push the
// return address, vector, and charge the acknowledge T-states onto the clock.
function acceptInterruptOn(machine: Machine): void {
  const result = acceptInterrupt({
    registers: machine.registers,
    memory: machine.memory,
    halted: machine.halted,
    dataBus: INT_DATA_BUS,
  });
  machine.registers = result.registers;
  machine.halted = false;
  machine.eiDelay = 0;
  machine.clock = (machine.clock + result.tStates) % FRAME_T_STATES;
  machine.tStatesTotal += result.tStates;
}

/**
 * Run exactly one frame, observing each instruction. Returns `true` if the observer
 * stopped the run mid-frame (the machine is left at the stop boundary, the frame
 * counter NOT bumped); `false` if the full frame completed.
 */
export function runFrameObserved(
  machine: Machine,
  observe: InstructionObserver,
  beforeStep?: BeforeStep,
  onInterrupt?: InterruptObserver,
): boolean {
  // Run to the frame boundary (not a fixed quantum): any overrun carried in from
  // the previous frame's final instruction shortens this frame, mirroring
  // Machine.runFrame, so the frame edge observed between calls never drifts.
  const budget = FRAME_T_STATES - machine.clock;
  let elapsed = 0;
  let intTaken = false;

  while (elapsed < budget) {
    if (!intTaken && interruptArmed(machine) && interruptActive(machine.clock)) {
      // Capture the HALT-wait state BEFORE acceptance clears it — the HALT-sync signal.
      const wasHalted = machine.halted;
      const before = machine.tStatesTotal;
      acceptInterruptOn(machine);
      elapsed += machine.tStatesTotal - before;
      intTaken = true;
      onInterrupt?.(wasHalted);
      if (observe(machine)) return true;
      continue;
    }

    beforeStep?.(machine);
    const wasEi = machine.memory[machine.registers.pc & 0xffff] === EI_OPCODE;
    if (machine.eiDelay > 0) machine.eiDelay -= 1;
    const before = machine.tStatesTotal;
    machine.stepInstruction();
    elapsed += machine.tStatesTotal - before;
    if (wasEi) machine.eiDelay = 1;

    if (observe(machine)) return true;
  }

  machine.frames += 1;
  return false;
}
