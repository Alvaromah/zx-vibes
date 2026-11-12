// The memory addresses the next instruction will WRITE — what a write watchpoint needs
// (cli.md CLI-PROD-RUN-003 / CLI-PROD-RUN-007: "stop when any byte in the range is
// written"). The cores expose no write-bus hook (`@zx-vibes/cpu` stores straight into
// the memory array) and diffing memory cannot see a write of the byte already there, so
// the run loop decodes the write set of the instruction about to execute. The Z80's
// memory-writing instructions are a small fixed set (z80-cpu-execution.md):
//   LD (BC)/(DE)/(nn),A · LD (nn),HL/rr/IX/IY · LD (HL)/(IX+d),r/n · INC/DEC (HL)/(IX+d)
//   · CB/DDCB/FDCB shifts, rotates, RES and SET on memory (not BIT) · RLD/RRD
//   · LDI/LDD/LDIR/LDDR (to DE) · INI/IND/INIR/INDR (to HL) · EX (SP),HL/IX/IY
//   · PUSH / CALL / CALL cc / RST (two bytes below SP, only when the push happens).
// A maskable interrupt's PC push is handled by the run loop, which sees it accepted.
//
// It runs before every instruction of a watched run, so it allocates nothing: a 256-entry
// kind table for the unprefixed opcodes and a caller-owned result object.

import type { Machine } from '@zx-vibes/machine';

/** The write set of one instruction: up to two addresses (-1 = none) and a push flag. */
export interface WriteSet {
  a0: number;
  a1: number;
  /**
   * A two-byte push to `SP-1`/`SP-2`. It happens only if SP really drops by 2 (a
   * conditional `CALL` whose condition fails pushes nothing), so the caller confirms it
   * from SP after the step.
   */
  push: boolean;
}

/** A fresh, reusable {@link WriteSet}. */
export function newWriteSet(): WriteSet {
  return { a0: -1, a1: -1, push: false };
}

// Write kinds of the unprefixed opcodes.
const K_NONE = 0;
const K_BC = 1; // LD (BC),A
const K_DE = 2; // LD (DE),A
const K_NN1 = 3; // LD (nn),A
const K_NN2 = 4; // LD (nn),HL
const K_HL = 5; // LD (HL),r/n, INC/DEC (HL)
const K_SP2 = 6; // EX (SP),HL
const K_PUSH = 7; // PUSH, CALL, CALL cc, RST

const BASE_KIND = ((): Uint8Array => {
  const kinds = new Uint8Array(256);
  kinds[0x02] = K_BC;
  kinds[0x12] = K_DE;
  kinds[0x22] = K_NN2;
  kinds[0x32] = K_NN1;
  kinds[0x34] = K_HL;
  kinds[0x35] = K_HL;
  kinds[0x36] = K_HL;
  for (let op = 0x70; op <= 0x77; op += 1) if (op !== 0x76) kinds[op] = K_HL; // 0x76 = HALT
  kinds[0xe3] = K_SP2;
  for (let op = 0; op < 256; op += 1) {
    if ((op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7) kinds[op] = K_PUSH; // CALL cc / RST
  }
  for (const op of [0xc5, 0xd5, 0xe5, 0xf5, 0xcd]) kinds[op] = K_PUSH; // PUSH rr, CALL nn
  return kinds;
})();

/** Decode the write set of the instruction at PC into `out` (see the module comment). */
export function decodeWriteSet(machine: Machine, out: WriteSet): void {
  out.a0 = -1;
  out.a1 = -1;
  out.push = false;
  const mem = machine.memory;
  const r = machine.registers as Record<string, number>;
  const pc = r.pc! & 0xffff;
  const op = mem[pc]!;

  if (op === 0xcb) {
    const op2 = mem[(pc + 1) & 0xffff]!;
    // Rotates/shifts, RES and SET on (HL) write it back; BIT b,(HL) (0x46..0x7E) only reads.
    if ((op2 & 0x07) === 0x06 && (op2 < 0x40 || op2 > 0x7f)) out.a0 = ((r.h! & 0xff) << 8) | (r.l! & 0xff);
    return;
  }
  if (op === 0xed) {
    const op2 = mem[(pc + 1) & 0xffff]!;
    if (op2 === 0x43 || op2 === 0x53 || op2 === 0x63 || op2 === 0x73) {
      // LD (nn),BC/DE/HL/SP
      const nn = mem[(pc + 2) & 0xffff]! | (mem[(pc + 3) & 0xffff]! << 8);
      out.a0 = nn;
      out.a1 = (nn + 1) & 0xffff;
    } else if (op2 === 0x67 || op2 === 0x6f || op2 === 0xa2 || op2 === 0xb2 || op2 === 0xaa || op2 === 0xba) {
      out.a0 = ((r.h! & 0xff) << 8) | (r.l! & 0xff); // RRD/RLD, INI/INIR/IND/INDR
    } else if (op2 === 0xa0 || op2 === 0xb0 || op2 === 0xa8 || op2 === 0xb8) {
      out.a0 = ((r.d! & 0xff) << 8) | (r.e! & 0xff); // LDI/LDIR/LDD/LDDR (one byte per step)
    }
    return;
  }
  if (op === 0xdd || op === 0xfd) {
    const op2 = mem[(pc + 1) & 0xffff]!;
    // A prefix followed by another prefix is a 4 T no-op; the next byte runs next step.
    if (op2 === 0xdd || op2 === 0xfd || op2 === 0xed) return;
    const index =
      op === 0xdd
        ? ((r.ixh! & 0xff) << 8) | (r.ixl! & 0xff)
        : ((r.iyh! & 0xff) << 8) | (r.iyl! & 0xff);
    const displaced = (index + ((mem[(pc + 2) & 0xffff]! << 24) >> 24)) & 0xffff;
    if (op2 === 0xcb) {
      // Every DDCB/FDCB form writes (IX+d) except BIT (0x40..0x7F).
      const op3 = mem[(pc + 3) & 0xffff]!;
      if (op3 < 0x40 || op3 > 0x7f) out.a0 = displaced;
      return;
    }
    if (op2 === 0x22) {
      // LD (nn),IX/IY
      const nn = mem[(pc + 2) & 0xffff]! | (mem[(pc + 3) & 0xffff]! << 8);
      out.a0 = nn;
      out.a1 = (nn + 1) & 0xffff;
      return;
    }
    if (BASE_KIND[op2] === K_HL) {
      out.a0 = displaced; // (HL) becomes (IX+d): LD (IX+d),r/n, INC/DEC (IX+d)
      return;
    }
    // Anything else ignores the prefix for its memory write (LD (BC),A, PUSH, CALL, …;
    // EX (SP),IX and PUSH IX write the same addresses as their HL forms).
    applyBaseKind(BASE_KIND[op2]!, (pc + 1) & 0xffff, machine, out);
    return;
  }
  applyBaseKind(BASE_KIND[op]!, pc, machine, out);
}

function applyBaseKind(kind: number, opAt: number, machine: Machine, out: WriteSet): void {
  if (kind === K_NONE) return;
  const mem = machine.memory;
  const r = machine.registers as Record<string, number>;
  switch (kind) {
    case K_BC:
      out.a0 = ((r.b! & 0xff) << 8) | (r.c! & 0xff);
      return;
    case K_DE:
      out.a0 = ((r.d! & 0xff) << 8) | (r.e! & 0xff);
      return;
    case K_NN1:
    case K_NN2: {
      const nn = mem[(opAt + 1) & 0xffff]! | (mem[(opAt + 2) & 0xffff]! << 8);
      out.a0 = nn;
      if (kind === K_NN2) out.a1 = (nn + 1) & 0xffff;
      return;
    }
    case K_HL:
      out.a0 = ((r.h! & 0xff) << 8) | (r.l! & 0xff);
      return;
    case K_SP2: {
      const sp = r.sp! & 0xffff;
      out.a0 = sp;
      out.a1 = (sp + 1) & 0xffff;
      return;
    }
    case K_PUSH:
      out.push = true;
      return;
    default:
      return;
  }
}

/**
 * Whether the executed step wrote an address flagged in `watched` (a 64K byte mask):
 * its decoded addresses, plus its push when SP really dropped by 2.
 */
export function stepWroteWatched(
  set: WriteSet,
  spBefore: number,
  spAfter: number,
  watched: Uint8Array,
): boolean {
  if (set.a0 >= 0 && watched[set.a0] === 1) return true;
  if (set.a1 >= 0 && watched[set.a1] === 1) return true;
  if (set.push && ((spBefore - 2) & 0xffff) === (spAfter & 0xffff)) {
    return watched[(spBefore - 1) & 0xffff] === 1 || watched[(spBefore - 2) & 0xffff] === 1;
  }
  return false;
}

/** The decoded write set as a list (tests / diagnostics; allocates). */
export function instructionWriteTargets(machine: Machine): { addrs: number[]; push: boolean } {
  const set = newWriteSet();
  decodeWriteSet(machine, set);
  return { addrs: [set.a0, set.a1].filter((a) => a >= 0), push: set.push };
}
