/**
 * Table-driven Z80 disassembler using the algebraic x/y/z opcode decomposition
 * (per the canonical z80.info decoding guide). Output is sjasmplus-compatible
 * so the round-trip test (assemble → disassemble → reassemble) can verify it.
 */

export interface DisasmLine {
  addr: number;
  bytes: number[];
  text: string;
}

type ReadFn = (addr: number) => number;

const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const RP = ['BC', 'DE', 'HL', 'SP'];
const RP2 = ['BC', 'DE', 'HL', 'AF'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
const X0Z7 = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
const IM = ['0', '0', '1', '2', '0', '0', '1', '2'];
const BLI = [
  ['LDI', 'CPI', 'INI', 'OUTI'],
  ['LDD', 'CPD', 'IND', 'OUTD'],
  ['LDIR', 'CPIR', 'INIR', 'OTIR'],
  ['LDDR', 'CPDR', 'INDR', 'OTDR'],
];

function h8(n: number): string {
  return `0x${(n & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}
function h16(n: number): string {
  return `0x${(n & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}
function signed(b: number): number {
  return b < 128 ? b : b - 256;
}
function disp(d: number): string {
  const s = signed(d);
  return s >= 0 ? `+${h8(s)}` : `-${h8(-s)}`;
}

/** Disassembles one instruction starting at addr. */
export function disassembleOne(read: ReadFn, addr: number): DisasmLine {
  const bytes: number[] = [];
  let a = addr;
  const next = (): number => {
    const b = read(a & 0xffff) & 0xff;
    a = (a + 1) & 0x1ffff; // allow flowing past 0xFFFF without wrapping bytes[]
    bytes.push(b);
    return b;
  };
  const next16 = (): number => {
    const lo = next();
    return lo | (next() << 8);
  };

  let ix: 'IX' | 'IY' | '' = '';
  let op = next();
  let guard = 0;
  while ((op === 0xdd || op === 0xfd) && guard++ < 3) {
    ix = op === 0xdd ? 'IX' : 'IY';
    op = next();
  }

  let text: string;
  if (op === 0xcb) {
    text = ix ? decodeIndexedCB(ix, next) : decodeCB(next());
  } else if (op === 0xed) {
    text = decodeED(next(), next16);
  } else {
    text = decodeMain(op, ix, next, next16, () => a);
  }

  return { addr, bytes, text };
}

/** Disassembles `count` consecutive instructions. */
export function disassemble(read: ReadFn, addr: number, count: number): DisasmLine[] {
  const lines: DisasmLine[] = [];
  let a = addr;
  for (let i = 0; i < count; i++) {
    const line = disassembleOne(read, a);
    lines.push(line);
    a = (a + line.bytes.length) & 0xffff;
  }
  return lines;
}

/* ───────────────────── main page ───────────────────── */

function decodeMain(
  op: number,
  ix: 'IX' | 'IY' | '',
  next: () => number,
  next16: () => number,
  pcAfter: () => number
): string {
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  const p = y >> 1;
  const q = y & 1;

  // Register/pair names under DD/FD substitution. (HL) becomes (IX+d) —
  // displacement is fetched lazily, exactly once, at operand position.
  const hl = ix || 'HL';
  let dCache: string | undefined;
  const mem = (): string => {
    if (!ix) return '(HL)';
    if (dCache === undefined) dCache = `(${ix}${disp(next())})`;
    return dCache;
  };
  // H/L become IXH/IXL only when no (IX+d) operand is involved.
  const r = (i: number, memInvolved: boolean): string => {
    if (i === 6) return mem();
    if (ix && !memInvolved && (i === 4 || i === 5)) return ix + (i === 4 ? 'H' : 'L');
    return R[i]!;
  };
  const rp = (i: number): string => (i === 2 ? hl : RP[i]!);
  const rp2 = (i: number): string => (i === 2 ? hl : RP2[i]!);
  const rel = (): string => {
    const e = signed(next());
    return h16(pcAfter() + e);
  };

  switch (x) {
    case 0:
      switch (z) {
        case 0:
          if (y === 0) return 'NOP';
          if (y === 1) return "EX AF,AF'";
          if (y === 2) return `DJNZ ${rel()}`;
          if (y === 3) return `JR ${rel()}`;
          return `JR ${CC[y - 4]},${rel()}`;
        case 1:
          return q === 0 ? `LD ${rp(p)},${h16(next16())}` : `ADD ${hl},${rp(p)}`;
        case 2: {
          if (p === 0) return q === 0 ? 'LD (BC),A' : 'LD A,(BC)';
          if (p === 1) return q === 0 ? 'LD (DE),A' : 'LD A,(DE)';
          if (p === 2)
            return q === 0 ? `LD (${h16(next16())}),${hl}` : `LD ${hl},(${h16(next16())})`;
          return q === 0 ? `LD (${h16(next16())}),A` : `LD A,(${h16(next16())})`;
        }
        case 3:
          return `${q === 0 ? 'INC' : 'DEC'} ${rp(p)}`;
        case 4:
          return `INC ${r(y, false)}`;
        case 5:
          return `DEC ${r(y, false)}`;
        case 6: {
          // LD r,n — for (IX+d),n the displacement comes BEFORE the literal.
          const dst = r(y, false);
          return `LD ${dst},${h8(next())}`;
        }
        default:
          return X0Z7[y]!;
      }

    case 1: {
      if (y === 6 && z === 6) return 'HALT';
      const memInvolved = y === 6 || z === 6;
      return `LD ${r(y, memInvolved)},${r(z, memInvolved)}`;
    }

    case 2:
      return `${ALU[y]}${r(z, z === 6)}`;

    default:
      switch (z) {
        case 0:
          return `RET ${CC[y]}`;
        case 1:
          if (q === 0) return `POP ${rp2(p)}`;
          if (p === 0) return 'RET';
          if (p === 1) return 'EXX';
          if (p === 2) return `JP (${hl})`;
          return `LD SP,${hl}`;
        case 2:
          return `JP ${CC[y]},${h16(next16())}`;
        case 3:
          if (y === 0) return `JP ${h16(next16())}`;
          if (y === 2) return `OUT (${h8(next())}),A`;
          if (y === 3) return `IN A,(${h8(next())})`;
          if (y === 4) return `EX (SP),${hl}`;
          if (y === 5) return 'EX DE,HL'; // never affected by DD/FD
          if (y === 6) return 'DI';
          return 'EI';
        case 4:
          return `CALL ${CC[y]},${h16(next16())}`;
        case 5:
          if (q === 0) return `PUSH ${rp2(p)}`;
          return `CALL ${h16(next16())}`; // p>0 are the DD/ED/FD prefixes, handled upstream
        case 6:
          return `${ALU[y]}${h8(next())}`;
        default:
          return `RST ${h8(y * 8)}`;
      }
  }
}

/* ───────────────────── CB page ───────────────────── */

function decodeCB(op: number): string {
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  if (x === 0) return `${ROT[y]} ${R[z]}`;
  if (x === 1) return `BIT ${y},${R[z]}`;
  if (x === 2) return `RES ${y},${R[z]}`;
  return `SET ${y},${R[z]}`;
}

/** DDCB/FDCB: displacement byte comes BEFORE the final opcode. */
function decodeIndexedCB(ix: 'IX' | 'IY', next: () => number): string {
  const d = disp(next());
  const op = next();
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  const m = `(${ix}${d})`;
  const copy = z !== 6 ? `,${R[z]}` : ''; // undocumented result-copy register
  if (x === 0) return `${ROT[y]} ${m}${copy}`;
  if (x === 1) return `BIT ${y},${m}`;
  if (x === 2) return `RES ${y},${m}${copy}`;
  return `SET ${y},${m}${copy}`;
}

/* ───────────────────── ED page ───────────────────── */

function decodeED(op: number, next16: () => number): string {
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  const p = y >> 1;
  const q = y & 1;

  if (x === 1) {
    switch (z) {
      case 0:
        return y === 6 ? 'IN (C)' : `IN ${R[y]},(C)`;
      case 1:
        return y === 6 ? 'OUT (C),0' : `OUT (C),${R[y]}`;
      case 2:
        return q === 0 ? `SBC HL,${RP[p]}` : `ADC HL,${RP[p]}`;
      case 3:
        return q === 0 ? `LD (${h16(next16())}),${RP[p]}` : `LD ${RP[p]},(${h16(next16())})`;
      case 4:
        return 'NEG';
      case 5:
        return y === 1 ? 'RETI' : 'RETN';
      case 6:
        return `IM ${IM[y]}`;
      default:
        switch (y) {
          case 0:
            return 'LD I,A';
          case 1:
            return 'LD R,A';
          case 2:
            return 'LD A,I';
          case 3:
            return 'LD A,R';
          case 4:
            return 'RRD';
          case 5:
            return 'RLD';
          default:
            return `DB 0xED,${h8(op)}`;
        }
    }
  }

  if (x === 2 && z <= 3 && y >= 4) {
    return BLI[y - 4]![z]!;
  }
  return `DB 0xED,${h8(op)}`;
}
