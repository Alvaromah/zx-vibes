// The preview player's machine and frame stepper.
//
// `stepFrame` mirrors `Machine.runFrame` (machine-execution.md MACHINE-FRAME-LOOP-001:
// the once-per-frame INT sampled at instruction boundaries, with the post-EI delay)
// and adds an optional per-instruction trap, which the tape autoloader uses to catch
// the ROM's LD-BYTES entry (./autoload.ts). With no trap it is step-for-step the same
// as `machine.runFrame()`; the preview-player tests pin that parity.
//
// Pure and DOM-free: the tsup-bundled player and the Node tests share it.

import {
  acceptInterrupt,
  createMachine,
  INT_DATA_BUS,
  RESET_REGISTERS,
  type Machine,
} from '@zx-vibes/machine';
import { FRAME_T_STATES, interruptActive } from '@zx-vibes/ula';

const EI_OPCODE = 0xfb;

/** A hook run before each instruction (e.g. to trap a ROM entry point). */
export type InstructionTrap = (machine: Machine) => void;

/**
 * The player's machine over a 64 KB memory image. The ROM is write-protected
 * (MACHINE-ROM-READONLY-001): as on a real 48K, a write below 0x4000 is a timed
 * bus cycle that stores nothing, so a stray `LD (0x0010),A` cannot corrupt the ROM.
 */
export function createPreviewMachine(
  memory: Uint8Array,
  registers: Record<string, number> = { ...RESET_REGISTERS },
): Machine {
  return createMachine({ memory, registers, romWriteProtect: true });
}

/**
 * Run the machine to the next frame boundary (not a fixed quantum): an overrun
 * carried in from the previous frame's last instruction shortens this frame, as in
 * `Machine.runFrame`. That pins the render point (the player samples memory between
 * frames) at the top of the frame — a drifting sample point catches HALT-synced
 * games mid-erase and their sprites dissolve.
 */
export function stepFrame(m: Machine, trap: InstructionTrap | null = null): void {
  const budget = FRAME_T_STATES - m.clock;
  let elapsed = 0;
  let intTaken = false;
  while (elapsed < budget) {
    if (!intTaken && Boolean(m.registers.iff1) && m.eiDelay === 0 && interruptActive(m.clock)) {
      const before = m.tStatesTotal;
      const accepted = acceptInterrupt({
        registers: m.registers,
        memory: m.memory,
        halted: m.halted,
        dataBus: INT_DATA_BUS,
        romTop: m.romTop(),
      });
      m.registers = accepted.registers;
      m.halted = false;
      m.eiDelay = 0;
      m.clock = (m.clock + accepted.tStates) % FRAME_T_STATES;
      m.tStatesTotal += accepted.tStates;
      elapsed += m.tStatesTotal - before;
      intTaken = true;
      continue;
    }
    if (trap) trap(m);
    const wasEi = m.memory[(m.registers.pc ?? 0) & 0xffff] === EI_OPCODE;
    if (m.eiDelay > 0) m.eiDelay -= 1;
    const before = m.tStatesTotal;
    m.stepInstruction();
    elapsed += m.tStatesTotal - before;
    if (wasEi) m.eiDelay = 1;
  }
  m.frames += 1;
}
