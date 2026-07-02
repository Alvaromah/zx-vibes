// Register snapshot — the decoded CPU register view (cli.md CLI-PROD-REGS-001,
// reported in the `run` envelope's `registers` field, CLI-PROD-OUT-RUN-001).
//
// The machine stores the register file as 8-bit halves; this reads them into the
// main + alternate pairs, the index registers, the control registers, and the
// decoded flag bits. A shared observe primitive the standalone `regs` command
// (Slice 7) reuses.

import type { Machine } from '@zx-vibes/machine';

/** The decoded ZX flag bits of the F register (S Z F5 H F3 P/V N C). */
export interface FlagBits {
  s: boolean;
  z: boolean;
  f5: boolean;
  h: boolean;
  f3: boolean;
  pv: boolean;
  n: boolean;
  c: boolean;
}

/** The CPU register view reported by `run`/`regs`. */
export interface RegisterSnapshot {
  pc: number;
  sp: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  /** The alternate register set (AF'/BC'/DE'/HL'). */
  alt: { af: number; bc: number; de: number; hl: number };
  ix: number;
  iy: number;
  i: number;
  r: number;
  im: number;
  iff1: boolean;
  iff2: boolean;
  halted: boolean;
  flags: FlagBits;
}

function byte(reg: Record<string, number>, name: string): number {
  return (reg[name] ?? 0) & 0xff;
}

function pair(reg: Record<string, number>, hi: string, lo: string): number {
  return ((byte(reg, hi) << 8) | byte(reg, lo)) & 0xffff;
}

/** Decode the flag bits of an F-register value. */
export function decodeFlags(f: number): FlagBits {
  return {
    s: (f & 0x80) !== 0,
    z: (f & 0x40) !== 0,
    f5: (f & 0x20) !== 0,
    h: (f & 0x10) !== 0,
    f3: (f & 0x08) !== 0,
    pv: (f & 0x04) !== 0,
    n: (f & 0x02) !== 0,
    c: (f & 0x01) !== 0,
  };
}

/** Read the decoded register view from a machine (CLI-PROD-OUT-RUN-001 `registers`). */
export function readRegisters(machine: Machine): RegisterSnapshot {
  const reg = machine.registers as Record<string, number>;
  return {
    pc: (reg.pc ?? 0) & 0xffff,
    sp: (reg.sp ?? 0) & 0xffff,
    af: pair(reg, 'a', 'f'),
    bc: pair(reg, 'b', 'c'),
    de: pair(reg, 'd', 'e'),
    hl: pair(reg, 'h', 'l'),
    alt: {
      af: pair(reg, 'a_', 'f_'),
      bc: pair(reg, 'b_', 'c_'),
      de: pair(reg, 'd_', 'e_'),
      hl: pair(reg, 'h_', 'l_'),
    },
    ix: pair(reg, 'ixh', 'ixl'),
    iy: pair(reg, 'iyh', 'iyl'),
    i: byte(reg, 'i'),
    r: byte(reg, 'r'),
    im: (reg.im ?? 0) & 0xff,
    iff1: Boolean(reg.iff1),
    iff2: Boolean(reg.iff2),
    halted: machine.halted,
    flags: decodeFlags(byte(reg, 'f')),
  };
}
