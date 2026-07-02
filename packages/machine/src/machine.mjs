// 48K ZX Spectrum machine layer, authored from the project DNA
// (dna/domain/machine-execution.md) and decided by the machine conformance
// fixtures (dna/conformance/machine/*.json). It joins the regenerated CPU
// (@zx-vibes/cpu step()) and ULA timing model (@zx-vibes/ula) into a running
// machine: a register file + 64 KB memory + I/O ports + a frame T-state clock,
// with per-access memory contention threaded onto the executed instruction
// stream and the once-per-frame maskable interrupt accepted at instruction
// boundaries.
import { step } from "@zx-vibes/cpu";
import { FRAME_T_STATES, contentionDelay, interruptActive, isContendedAddress } from "@zx-vibes/ula";
import { INT_DATA_BUS, acceptInterrupt } from "./interrupt.mjs";

// The register fields the CPU step() contract recognizes, all defaulting to 0.
const REGISTER_NAMES = [
  "a", "f", "b", "c", "d", "e", "h", "l",
  "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_",
  "pc", "sp", "i", "r", "iff1", "iff2", "im", "memptr",
  "ixh", "ixl", "iyh", "iyl",
];

const HALT_OPCODE = 0x76;
const EI_OPCODE = 0xfb;

// Power-on / reset register state (dna/domain/machine-execution.md
// MACHINE-RESET-CONTROL-001 + MACHINE-RESET-REGISTERS-001). The Z80 RESET defines
// only PC/I/R = 0, IM 0, IFF1 = IFF2 = 0 (z80-spec); SP/AF and the GP/alternate/index
// registers are undefined and modeled as all-bits-set (0xFF halves -> 0xFFFF pairs)
// per decision:ADR-0021. Stored in the same 8-bit-half representation as the register
// file. MEMPTR is not part of the reset contract.
export const RESET_REGISTERS = Object.freeze({
  a: 0xff, f: 0xff, b: 0xff, c: 0xff, d: 0xff, e: 0xff, h: 0xff, l: 0xff,
  a_: 0xff, f_: 0xff, b_: 0xff, c_: 0xff, d_: 0xff, e_: 0xff, h_: 0xff, l_: 0xff,
  pc: 0x0000, sp: 0xffff, i: 0x00, r: 0x00, iff1: 0, iff2: 0, im: 0, memptr: 0,
  ixh: 0xff, ixl: 0xff, iyh: 0xff, iyl: 0xff,
});

function buildRegisters(initial = {}) {
  const reg = {};
  for (const name of REGISTER_NAMES) reg[name] = 0;
  for (const [name, value] of Object.entries(initial)) {
    if (REGISTER_NAMES.includes(name)) reg[name] = value | 0;
  }
  return reg;
}

function buildMemory(initial) {
  if (initial instanceof Uint8Array) return initial;
  const memory = new Uint8Array(0x10000);
  if (initial && typeof initial === "object") {
    for (const [address, bytes] of Object.entries(initial)) {
      let pointer = Number(address) & 0xffff;
      const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
      for (const byte of data) { memory[pointer & 0xffff] = byte & 0xff; pointer += 1; }
    }
  }
  return memory;
}

// A default I/O interface: reads float high (0xFF), writes are dropped. The
// caller can supply its own { read(port), write(port, value) }.
function defaultIo() {
  return { read: () => 0xff, write: () => {} };
}

export function createMachine(options = {}) {
  return new Machine(options);
}

export class Machine {
  constructor({ registers, memory, io, clock = 0, exactContention = false } = {}) {
    this.registers = buildRegisters(registers);
    this.memory = buildMemory(memory);
    this.io = io ?? defaultIo();
    this.clock = ((clock % FRAME_T_STATES) + FRAME_T_STATES) % FRAME_T_STATES;
    // Contention model: the conformed per-access model (default,
    // MACHINE-CONTENTION-CLOCK-001) or the M-cycle-exact model
    // (MACHINE-CONTENTION-MCYCLE-001), which also charges internal no-MREQ cycles
    // and samples each access at its true in-instruction T-offset.
    this.exactContention = Boolean(exactContention);
    this.halted = false;
    // Boundaries to skip interrupt sampling for (the post-EI one-instruction
    // delay, MACHINE-INT-EI-DELAY-001).
    this.eiDelay = 0;
    // Running totals (across frames), useful for drivers and assertions.
    this.tStatesTotal = 0;
    this.frames = 0;
  }

  // Power-on / reset: restore the documented reset state (MACHINE-RESET-001) —
  // the Z80 control registers cleared, the rest of the register file all-bits-set,
  // RAM all-zero, the frame clock at 0, and not halted. Run totals are cleared too.
  reset() {
    this.registers = { ...RESET_REGISTERS };
    this.memory = new Uint8Array(0x10000);
    this.clock = 0;
    this.halted = false;
    this.eiDelay = 0;
    this.tStatesTotal = 0;
    this.frames = 0;
    return this;
  }

  // The contention observer handed to step(): it accumulates the ULA delay for
  // each contended memory access, sampling at (instructionStart + accumulated)
  // per MACHINE-CONTENTION-CLOCK-001.
  _contentionClock(instructionStart) {
    const clock = {
      base: instructionStart,
      extra: 0,
      access(address) {
        if (isContendedAddress(address)) {
          const t = (this.base + this.extra) % FRAME_T_STATES;
          this.extra += contentionDelay(t);
        }
      },
    };
    return clock;
  }

  // The M-cycle-exact contention observer (MACHINE-CONTENTION-MCYCLE-001). It
  // threads a running uncontended T-offset through the instruction's bus cycles
  // (memory M-cycles via mcycle(), internal no-MREQ cycles via internal()),
  // sampling contentionDelay at (instructionStart + runT + accumulated) for each
  // contended cycle. It also keeps the per-access tally and an `incomplete` flag:
  // when the CPU signals inexact() (an instruction whose internal cycles this
  // slice does not yet model exactly), the machine falls back to the conformed
  // per-access value, so no instruction is ever silently mis-timed (C5).
  _exactClock(instructionStart) {
    return {
      base: instructionStart,
      runT: 0,
      extra: 0,
      perAccessExtra: 0,
      incomplete: false,
      access(address) {
        if (isContendedAddress(address)) {
          const t = (this.base + this.perAccessExtra) % FRAME_T_STATES;
          this.perAccessExtra += contentionDelay(t);
        }
      },
      mcycle(address, tStates) {
        if (isContendedAddress(address)) {
          const t = (this.base + this.runT + this.extra) % FRAME_T_STATES;
          this.extra += contentionDelay(t);
        }
        this.runT += tStates;
      },
      internal(address, n) {
        for (let i = 0; i < n; i += 1) {
          if (isContendedAddress(address)) {
            const t = (this.base + this.runT + this.extra) % FRAME_T_STATES;
            this.extra += contentionDelay(t);
          }
          this.runT += 1;
        }
      },
      inexact() { this.incomplete = true; },
      total() { return this.incomplete ? this.perAccessExtra : this.extra; },
    };
  }

  // Execute exactly one instruction with contention threaded. Advances the clock
  // by the real (uncontended + contention) duration and tracks the HALT state.
  // Does NOT sample interrupts — that is the frame loop's job
  // (MACHINE-INT-SAMPLE-001 fixes interrupt sampling to boundaries it controls).
  stepInstruction() {
    const reg = this.registers;
    const pcBefore = reg.pc & 0xffff;
    const opcode = this.memory[pcBefore];
    const clock = this.exactContention
      ? this._exactClock(this.clock)
      : this._contentionClock(this.clock);

    const result = step({ registers: reg, memory: this.memory, io: this.io, clock });
    this.registers = result.registers;

    const contention = this.exactContention ? clock.total() : clock.extra;
    const tStates = result.tStates + contention;
    this.clock = (this.clock + tStates) % FRAME_T_STATES;
    this.tStatesTotal += tStates;

    // HALT is the only instruction that does not advance PC; the CPU leaves PC on
    // the HALT opcode and reports 4 T per refetch.
    this.halted = opcode === HALT_OPCODE && (this.registers.pc & 0xffff) === pcBefore;

    return { tStates, contention, halted: this.halted };
  }

  // Accept the pending maskable interrupt (caller has verified the conditions).
  _acceptInterrupt(dataBus = INT_DATA_BUS) {
    const result = acceptInterrupt({
      registers: this.registers,
      memory: this.memory,
      halted: this.halted,
      dataBus,
    });
    this.registers = result.registers;
    this.halted = false;
    this.eiDelay = 0;
    this.clock = (this.clock + result.tStates) % FRAME_T_STATES;
    this.tStatesTotal += result.tStates;
    return result;
  }

  // True iff the machine may accept a maskable interrupt at the current boundary:
  // interrupts enabled and not inside the post-EI one-instruction delay.
  _interruptArmed() {
    return Boolean(this.registers.iff1) && this.eiDelay === 0;
  }

  // Run one whole frame: execute instructions until the clock crosses the frame
  // length, sampling INT at each boundary and accepting at most once
  // (MACHINE-FRAME-LOOP-001). Returns { tStates, accepted } for the frame.
  runFrame({ dataBus = INT_DATA_BUS } = {}) {
    const start = this.tStatesTotal;
    let accepted = 0;
    let intTaken = false;

    // The frame ends when the running clock would wrap. Because the clock is kept
    // modulo the frame length, we track elapsed T-states for this frame directly.
    let elapsed = 0;
    while (elapsed < FRAME_T_STATES) {
      if (!intTaken && this._interruptArmed() && interruptActive(this.clock)) {
        const before = this.tStatesTotal;
        this._acceptInterrupt(dataBus);
        elapsed += this.tStatesTotal - before;
        accepted += 1;
        intTaken = true;
        continue;
      }
      const wasEi = this.memory[this.registers.pc & 0xffff] === EI_OPCODE;
      if (this.eiDelay > 0) this.eiDelay -= 1;
      const before = this.tStatesTotal;
      this.stepInstruction();
      elapsed += this.tStatesTotal - before;
      if (wasEi) this.eiDelay = 1;
    }

    this.frames += 1;
    return { tStates: this.tStatesTotal - start, accepted };
  }
}
