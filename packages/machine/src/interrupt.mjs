// Maskable interrupt acceptance for the 48K ZX Spectrum machine layer, authored
// from the project DNA (dna/domain/machine-execution.md) and decided by the
// machine conformance fixtures (dna/conformance/machine/interrupt-accept.json).
//
// This is the CPU's response to the ULA's once-per-frame INT, the part that lives
// at an instruction boundary and so is not expressible by the single-step CPU
// contract. The caller (the Machine frame loop) decides *whether* to accept
// (IFF1 set, INT asserted, not in the post-EI delay); this function performs the
// documented sequence once that decision is made.

// 48K interrupt-acknowledge data-bus value (floats high). Pins IM 0 to RST 38h
// and the IM 2 vector low byte to 0xFF. (MACHINE-INT-DATABUS-001, ADR-0011.)
export const INT_DATA_BUS = 0xff;

// Total instruction-acknowledge cost: IM 0 / IM 1 take 13 T, IM 2 takes 19 T.
export const IM01_T_STATES = 13;
export const IM2_T_STATES = 19;

// Non-maskable interrupt: fixed restart vector 0x0066, 11 T-states (a 5 T
// acknowledge M1 cycle plus the two 3 T stack writes). (MACHINE-NMI-ACCEPT-001.)
export const NMI_VECTOR = 0x0066;
export const NMI_T_STATES = 11;

// Accept a maskable interrupt against the given CPU state.
//
//   acceptInterrupt({ registers, memory, halted?, dataBus? })
//     -> { registers, tStates, accepted, halted }
//
// registers: the same plain register object the CPU step() uses (a,f,...,pc,sp,
//   i,r,iff1,iff2,im,...). memory: Uint8Array(0x10000). halted: whether the CPU
//   was in the HALT state at the boundary (so the return address skips the HALT).
//   dataBus: the byte on the data bus during acknowledge (default 0xFF on 48K).
//
// Mutates and returns `registers` (clearing IFF1/IFF2, bumping R, moving SP/PC)
// and writes the pushed return address into `memory`. If IFF1 is clear the
// interrupt is masked: nothing changes, accepted=false, tStates=0.
export function acceptInterrupt({ registers, memory, halted = false, dataBus = INT_DATA_BUS }) {
  const reg = registers;
  if (!reg.iff1) {
    return { registers: reg, tStates: 0, accepted: false, halted };
  }

  // Leaving HALT: the frozen PC sits on the HALT opcode, so the return address is
  // the instruction after it. (MACHINE-INT-ACCEPT-001 step 1.)
  let pc = reg.pc & 0xffff;
  if (halted) pc = (pc + 1) & 0xffff;

  // Disable further interrupts; the acknowledge cycle bumps R (low 7 bits).
  reg.iff1 = 0;
  reg.iff2 = 0;
  reg.r = (reg.r & 0x80) | ((reg.r + 1) & 0x7f);

  // Push the return address, high byte first.
  const sp = (reg.sp - 2) & 0xffff;
  memory[sp] = pc & 0xff;
  memory[(sp + 1) & 0xffff] = (pc >> 8) & 0xff;
  reg.sp = sp;

  let tStates;
  if (reg.im === 2) {
    const vector = ((reg.i & 0xff) << 8) | (dataBus & 0xff);
    reg.pc = (memory[vector & 0xffff] | (memory[(vector + 1) & 0xffff] << 8)) & 0xffff;
    tStates = IM2_T_STATES;
  } else {
    // IM 0 (data bus = 0xFF = RST 38h on 48K) and IM 1 both vector to 0x0038.
    reg.pc = 0x0038;
    tStates = IM01_T_STATES;
  }

  return { registers: reg, tStates, accepted: true, halted: false };
}

// Accept a non-maskable interrupt against the given CPU state.
//
//   acceptNmi({ registers, memory, halted? })
//     -> { registers, tStates, accepted, halted }
//
// NMI is edge-triggered and NON-maskable: unlike acceptInterrupt it ignores
// IFF1, so it always accepts (there is no masked no-accept case). It clears IFF1
// but PRESERVES IFF2 (which holds the pre-NMI IFF1, so a later RETN restores the
// maskable-interrupt enable state), bumps R, leaves HALT with the post-HALT
// return address, pushes PC high-byte first, and vectors to 0x0066 in 11 T.
// (dna/domain/machine-execution.md MACHINE-NMI-SAMPLE-001 / -ACCEPT-001 /
// -RETN-001; decided by dna/conformance/machine/nmi-accept.json.)
//
// Mutates and returns `registers` (clearing IFF1, bumping R, moving SP/PC) and
// writes the pushed return address into `memory`; IFF2 and IM are untouched.
export function acceptNmi({ registers, memory, halted = false }) {
  const reg = registers;

  // Leaving HALT: the frozen PC sits on the HALT opcode, so the return address is
  // the instruction after it. (MACHINE-NMI-ACCEPT-001 step 1.)
  let pc = reg.pc & 0xffff;
  if (halted) pc = (pc + 1) & 0xffff;

  // Disable maskable interrupts but PRESERVE IFF2 (so RETN can restore IFF1);
  // the acknowledge cycle bumps R (low 7 bits).
  reg.iff1 = 0;
  reg.r = (reg.r & 0x80) | ((reg.r + 1) & 0x7f);

  // Push the return address, high byte first.
  const sp = (reg.sp - 2) & 0xffff;
  memory[sp] = pc & 0xff;
  memory[(sp + 1) & 0xffff] = (pc >> 8) & 0xff;
  reg.sp = sp;

  // Fixed NMI restart vector.
  reg.pc = NMI_VECTOR;

  return { registers: reg, tStates: NMI_T_STATES, accepted: true, halted: false };
}
