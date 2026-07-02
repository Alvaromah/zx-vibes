// Regenerated Z80 single-instruction step, authored from the project DNA
// (dna/domain/z80-opcodes.{md,yaml} encodings + dna/domain/z80-cpu-execution.md
// semantics) and decided by the FUSE per-case conformance oracle
// (dna/conformance/cpu/fuse/*.json). One coherent octal (x/y/z) decoder, not a
// per-opcode table: every instruction is computed from general rules.
//
// Contract (dna/conformance/cpu/run-cpu-exec-fixtures.mjs):
//   step({ registers, memory, io, clock? }) -> { registers, tStates }
//   registers: integer fields a,f,b,c,d,e,h,l, shadows a_..l_, pc,sp,i,r,
//     iff1,iff2,im,memptr, ixh,ixl,iyh,iyl. memory: Uint8Array(0x10000).
//   io: port interface — io.read(port) / io.write(port, value).
//   clock (optional): a machine-supplied bus observer. When present, the CPU
//     reports its bus activity in execution order so the host machine can thread
//     ULA memory contention onto the executed stream (see @zx-vibes/machine and
//     dna/domain/machine-execution.md). Three optional hooks, all guarded:
//       - clock.access(address): legacy per-access hook — one call per memory bus
//         access (MACHINE-CONTENTION-CLOCK-001, the per-access model).
//       - clock.mcycle(address, tStates): the same memory access AND its M-cycle
//         length (M1 opcode fetch = 4 T, operand/data read or write = 3 T), so an
//         exact clock can place each access at its true in-instruction T-offset.
//       - clock.internal(address, n): n internal no-MREQ cycles (1 T each) with
//         `address` on the bus — the contention points a per-access model omits
//         (e.g. ADD HL,rr's 7 IR cycles, INC (HL)'s read-modify-write cycle). See
//         MACHINE-CONTENTION-MCYCLE-001.
//       - clock.inexact(): flags that this instruction's emitted schedule is NOT
//         yet M-cycle-complete (a few internal-cycle forms — EX (SP),HL, the (IX+d)
//         operand index calc, LD (IX+d),n, DJNZ, block I/O); an exact clock falls
//         back to the per-access value for it (no silent debt, MACHINE-CONTENTION-
//         MCYCLE-SCOPE-001).
//     None change the uncontended tStates this function returns — the machine adds
//     the accumulated contention itself. When clock is absent the function behaves
//     identically to before (the FUSE single-step / zex oracles run it with no
//     clock); a clock that implements only access() also behaves exactly as before
//     (mcycle/internal are skipped), so the per-access machine model is unchanged.
//
// Scope: single-step execution including port I/O (IN/OUT, single block I/O
// INI/OUTI/IND/OUTD), HALT, and the REPEATING block ops (LDIR/LDDR/CPIR/CPDR/
// INIR/INDR/OTIR/OTDR). step() runs exactly ONE iteration of a repeating block
// op and rewinds PC by 2 when it must repeat, so a run-to-budget driver (loop
// step() until the FUSE T-state budget is reached) reproduces the full repeat.
// WZ/MEMPTR output is modeled per dna/domain/z80-cpu-execution.md
// (Z80-EXEC-WZ-UPDATE-*): reg.memptr is set on every instruction class that
// updates WZ and left unchanged otherwise (so BIT n,(HL) still reads the latched
// WZ for its 5/3 flags). Asserted on output by the FUSE MEMPTR column. See
// ADR-0009 (G-2 lifted) and ADR-0020.

const S = 0x80, Z = 0x40, F5 = 0x20, H = 0x10, F3 = 0x08, PV = 0x04, N = 0x02, C = 0x01;

const parity = (v) => {
  let p = 0;
  for (let i = 0; i < 8; i += 1) p ^= (v >> i) & 1;
  return p === 0 ? PV : 0;
};
const sz53 = (v) => (v & S) | (v === 0 ? Z : 0) | (v & (F5 | F3));
const sz53p = (v) => sz53(v) | parity(v);

// --- 8-bit ALU (op = 0..7: ADD ADC SUB SBC AND XOR OR CP) -------------------
function alu8(op, a, val, f) {
  const cin = f & C;
  let res, flags;
  switch (op) {
    case 0: // ADD
    case 1: { // ADC
      const carry = op === 1 ? cin : 0;
      const sum = a + val + carry;
      res = sum & 0xff;
      flags = sz53(res) |
        (((a & 0x0f) + (val & 0x0f) + carry) > 0x0f ? H : 0) |
        ((~(a ^ val) & (a ^ res) & 0x80) ? PV : 0) |
        (sum > 0xff ? C : 0);
      break;
    }
    case 2: // SUB
    case 3: // SBC
    case 7: { // CP (same arithmetic as SUB; flags 5/3 from operand)
      const carry = op === 3 ? cin : 0;
      const diff = a - val - carry;
      res = diff & 0xff;
      const base = (res & S) | (res === 0 ? Z : 0) |
        (((a & 0x0f) - (val & 0x0f) - carry) < 0 ? H : 0) |
        (((a ^ val) & (a ^ res) & 0x80) ? PV : 0) | N |
        (diff < 0 ? C : 0);
      flags = op === 7 ? base | (val & (F5 | F3)) : base | (res & (F5 | F3));
      break;
    }
    case 4: // AND
      res = a & val;
      flags = sz53p(res) | H;
      break;
    case 5: // XOR
      res = a ^ val;
      flags = sz53p(res);
      break;
    default: // 6 OR
      res = a | val;
      flags = sz53p(res);
      break;
  }
  return { res: op === 7 ? a : res, f: flags };
}

function inc8(v, f) {
  const res = (v + 1) & 0xff;
  return { res, f: (f & C) | sz53(res) | ((v & 0x0f) === 0x0f ? H : 0) | (v === 0x7f ? PV : 0) };
}
function dec8(v, f) {
  const res = (v - 1) & 0xff;
  return { res, f: (f & C) | sz53(res) | ((v & 0x0f) === 0x00 ? H : 0) | (v === 0x80 ? PV : 0) | N };
}

// --- CB rotates/shifts (op 0..7: RLC RRC RL RR SLA SRA SLL SRL) -------------
function rot(op, v, f) {
  const cin = f & C;
  let res, carry;
  switch (op) {
    case 0: carry = (v >> 7) & 1; res = ((v << 1) | carry) & 0xff; break; // RLC
    case 1: carry = v & 1; res = ((v >> 1) | (carry << 7)) & 0xff; break; // RRC
    case 2: carry = (v >> 7) & 1; res = ((v << 1) | cin) & 0xff; break; // RL
    case 3: carry = v & 1; res = ((v >> 1) | (cin << 7)) & 0xff; break; // RR
    case 4: carry = (v >> 7) & 1; res = (v << 1) & 0xff; break; // SLA
    case 5: carry = v & 1; res = ((v >> 1) | (v & 0x80)) & 0xff; break; // SRA
    case 6: carry = (v >> 7) & 1; res = ((v << 1) | 1) & 0xff; break; // SLL (undoc)
    default: carry = v & 1; res = (v >> 1) & 0xff; break; // SRL
  }
  return { res, f: sz53p(res) | carry };
}

export function step({ registers: reg, memory, io, clock }) {
  // A memory bus cycle: notify the legacy per-access hook and the M-cycle hook
  // (carrying the cycle length t: 4 for an M1 opcode fetch, 3 for an operand or
  // data access). Both are optional; absent clock => no calls (no-clock oracle).
  const onCycle = clock
    ? (a, t) => { const m = a & 0xffff; if (clock.access) clock.access(m); if (clock.mcycle) clock.mcycle(m, t); }
    : null;
  // Internal (no-MREQ) cycles: n one-T cycles with `a` on the address bus. Only
  // emitted when the clock opts in via internal(); the per-access model omits them.
  const internal = clock && clock.internal ? (a, n) => clock.internal(a & 0xffff, n) : null;
  // Marks the current instruction's emitted schedule as NOT yet M-cycle-complete
  // (it has internal cycles this slice does not model exactly — e.g. EX (SP),HL,
  // the (IX+d) operand index calc, block I/O). An exact clock falls back to the
  // conformed per-access model for such an instruction (MACHINE-CONTENTION-MCYCLE-001).
  const inexact = clock && clock.inexact ? () => clock.inexact() : null;
  const rd = (a, t = 3) => { const v = memory[a & 0xffff]; if (onCycle) onCycle(a, t); return v; };
  const wr = (a, v, t = 3) => { memory[a & 0xffff] = v & 0xff; if (onCycle) onCycle(a, t); };
  let pc = reg.pc & 0xffff;
  // R increments live per M1 fetch (bit 7 fixed). Doing it before the instruction
  // body executes is what makes LD A,R read the post-increment value and LD R,A
  // overwrite it correctly.
  const fetch = (t = 3) => { const b = rd(pc, t); pc = (pc + 1) & 0xffff; return b; };
  const incR = () => { reg.r = (reg.r & 0x80) | ((reg.r + 1) & 0x7f); };
  // The address on the bus during an M1-extension internal cycle is IR (I:R).
  const ir = () => ((reg.i << 8) | reg.r) & 0xffff;

  const RP = ["bc", "de", "hl", "sp"]; // rp[2]=HL or SP variant handled inline
  const get16 = (hi, lo) => (reg[hi] << 8) | reg[lo];
  const set16 = (hi, lo, v) => { reg[hi] = (v >> 8) & 0xff; reg[lo] = v & 0xff; };
  const getHL = () => (reg.h << 8) | reg.l;
  const flagCC = (y) => {
    switch (y) {
      case 0: return !(reg.f & Z);
      case 1: return !!(reg.f & Z);
      case 2: return !(reg.f & C);
      case 3: return !!(reg.f & C);
      case 4: return !(reg.f & PV);
      case 5: return !!(reg.f & PV);
      case 6: return !(reg.f & S);
      default: return !!(reg.f & S);
    }
  };

  incR(); // M1 of the first opcode byte
  let op = fetch(4);

  // --- prefix detection ---
  let idx = null; // null | "ix" | "iy"
  if (op === 0xdd || op === 0xfd) {
    idx = op === 0xdd ? "ix" : "iy";
    op = fetch(4);
    // A DD/FD prefix immediately followed by another prefix byte (DD/FD/ED) acts
    // as a 4 T NONI: the current prefix is abandoned and the following byte is
    // re-fetched next step. R was already incremented for THIS prefix byte (the
    // M1 at the top); do not charge the next byte yet -- that happens when it is
    // re-fetched. (Witnessed by ddfd00 in conformance/cpu/fuse-budget/dd.json for
    // DD->FD, and by conformance/cpu/prefix/ddfd-ed.json for DD/FD->ED.)
    if (op === 0xdd || op === 0xfd || op === 0xed) {
      reg.pc = (pc - 1) & 0xffff; // reprocess the new prefix/ED next step
      return { registers: reg, tStates: 4 };
    }
    incR(); // M1 of the real opcode after the surviving prefix
  }
  const IXY = idx === "ix" ? ["ixh", "ixl"] : idx === "iy" ? ["iyh", "iyl"] : null;
  const getIDX = () => (idx ? get16(IXY[0], IXY[1]) : getHL());

  if (op === 0xcb) {
    // Plain CB: the CB byte was the first M1 (already counted); the cbop is a
    // second M1. DDCB: DD + CB are the two M1s (both already counted); the
    // displacement and cbop are operands, no extra M1.
    let addr;
    if (idx) {
      const d = (fetch() << 24) >> 24; // signed displacement
      addr = (getIDX() + d) & 0xffff;
      reg.memptr = addr; // (IX+d)/(IY+d) access: WZ = effective address
    }
    const cbop = fetch(idx ? 3 : 4); // DDCB: cbop is an operand (3 T); plain CB: M1 (4 T)
    if (!idx) incR(); // plain CB only: cbop is an M1
    const x = cbop >> 6, y = (cbop >> 3) & 7, zc = cbop & 7;
    const reg8 = ["b", "c", "d", "e", "h", "l", null, "a"];
    // The single memory operand address, or null for a register target.
    const memAddr = idx ? addr : zc === 6 ? getHL() : null;
    // DDCB/FDCB spend 2 internal cycles (on the cbop-byte address) computing the
    // effective address before the read (no index calc for plain CB (HL)).
    if (internal && idx) internal((pc - 1) & 0xffff, 2);
    const readSrc = () => (idx ? rd(addr) : (zc === 6 ? rd(getHL()) : reg[reg8[zc]]));
    const v = readSrc();
    if (x === 1) { // BIT y,m
      // BIT m,(HL)/(IX+d): one internal cycle after the read (no write-back).
      if (internal && memAddr !== null) internal(memAddr, 1);
      const bit = (v >> y) & 1;
      let f = (reg.f & C) | H | (bit === 0 ? Z | PV : 0) | (y === 7 && bit ? S : 0);
      // undocumented 5/3: (IX+d)/(IY+d) -> addr high; (HL) -> WZ high; r -> r
      let src53;
      if (idx) src53 = (addr >> 8) & 0xff;
      else if (zc === 6) src53 = (reg.memptr >> 8) & 0xff;
      else src53 = v;
      f |= src53 & (F5 | F3);
      reg.f = f;
      reg.pc = pc;
      return { registers: reg, tStates: idx ? 20 : zc === 6 ? 12 : 8 };
    }
    let res;
    if (x === 0) res = rot(y, v, reg.f), reg.f = res.f, res = res.res;
    else if (x === 2) res = v & ~(1 << y); // RES
    else res = v | (1 << y); // SET
    // (HL)/(IX+d) read-modify-write: one internal cycle between read and write.
    if (internal && memAddr !== null) internal(memAddr, 1);
    // write back; for indexed, also copy to the register named by z (undoc) unless z==6
    if (idx) {
      wr(addr, res);
      if (zc !== 6) reg[reg8[zc]] = res;
    } else if (zc === 6) {
      wr(getHL(), res);
    } else {
      reg[reg8[zc]] = res;
    }
    reg.pc = pc;
    const t = idx ? 23 : zc === 6 ? 15 : 8;
    return { registers: reg, tStates: t };
  }

  if (op === 0xed) {
    incR();
    const eop = fetch(4);
    const result = stepED(eop);
    reg.pc = pc;
    return result;
  }

  // --- unprefixed / DD-FD base decode (octal) --------------------------------
  const x = op >> 6, y = (op >> 3) & 7, zc = op & 7, p = y >> 1, q = y & 1;
  // 8-bit register access with index substitution. The (IX+d) memory operand is
  // used only when the instruction references register code 6 via the half/get8
  // path; when it does, H/L stay plain (not IXH/IXL).
  let dispAddr = null;
  const refsMemCode =
    (x === 1 && (y === 6 || zc === 6)) ||
    (x === 2 && zc === 6) ||
    (x === 0 && (zc === 4 || zc === 5 || zc === 6) && y === 6);
  const needDisp = idx && refsMemCode;
  const half = (code) => {
    if (code === 4) return idx && !needDisp ? IXY[0] : "h";
    if (code === 5) return idx && !needDisp ? IXY[1] : "l";
    return ["b", "c", "d", "e", "h", "l", null, "a"][code];
  };
  const ensureDisp = () => {
    if (dispAddr === null) { const d = (fetch() << 24) >> 24; dispAddr = (getIDX() + d) & 0xffff; reg.memptr = dispAddr; } // (IX+d)/(IY+d) access: WZ = effective address
    return dispAddr;
  };
  const get8 = (code) => {
    if (code === 6) {
      if (idx) { if (inexact) inexact(); return rd(ensureDisp()); } // (IX+d) index-calc internals not modeled
      return rd(getHL());
    }
    return reg[half(code)];
  };
  const set8 = (code, v) => {
    if (code === 6) { if (idx) { if (inexact) inexact(); wr(ensureDisp(), v); } else wr(getHL(), v); return; }
    reg[half(code)] = v & 0xff;
  };
  let tStates = 4;
  // A redundant DD/FD prefix -- one that does not select an index register half
  // or an (IX+d)/(IY+d) operand -- still costs one extra M1 (4 T). Index-relevant
  // opcodes already fold that surcharge into their `idx ? ... : ...` timings; the
  // genuinely flat opcodes add it explicitly via t4. (Witnessed by dd00/ddfd00.)
  const t4 = idx ? 4 : 0;

  if (x === 1 && y === 6 && zc === 6 && !idx) { // HALT: PC stays on the instruction
    reg.pc = (pc - 1) & 0xffff;
    return { registers: reg, tStates: 4 };
  } else if (x === 1) { // LD r,r'
    set8(y, get8(zc));
    tStates = (y === 6 || zc === 6) ? (idx ? 19 : 7) : (idx ? 8 : 4);
  } else if (x === 2) { // ALU A,r
    const r = alu8(y, reg.a, get8(zc), reg.f);
    reg.a = r.res; reg.f = r.f;
    tStates = zc === 6 ? (idx ? 19 : 7) : (idx ? 8 : 4);
  } else if (x === 0) {
    if (zc === 0) {
      if (y === 0) tStates = 4 + t4; // NOP
      else if (y === 1) { // EX AF,AF'
        for (const r of ["a", "f"]) { const t = reg[r]; reg[r] = reg[r + "_"]; reg[r + "_"] = t; }
        tStates = 4 + t4;
      } else if (y === 2) { // DJNZ e
        if (inexact) inexact(); // 5 T M1 + taken-branch internal cycles not modeled exactly
        const d = (fetch() << 24) >> 24;
        reg.b = (reg.b - 1) & 0xff;
        if (reg.b !== 0) { pc = (pc + d) & 0xffff; reg.memptr = pc; tStates = 13 + t4; } else tStates = 8 + t4; // taken: WZ = destination
      } else if (y === 3) { // JR e
        const d = (fetch() << 24) >> 24;
        if (internal) internal((pc - 1) & 0xffff, 5); // 5 internal cycles (relative-jump calc)
        pc = (pc + d) & 0xffff; reg.memptr = pc; tStates = 12 + t4; // WZ = destination
      } else { // JR cc,e (y=4..7)
        const d = (fetch() << 24) >> 24;
        if (flagCC(y - 4)) { if (internal) internal((pc - 1) & 0xffff, 5); pc = (pc + d) & 0xffff; reg.memptr = pc; tStates = 12 + t4; } else tStates = 7 + t4; // taken: WZ = destination
      }
    } else if (zc === 1) {
      if (q === 0) { // LD rp,nn
        const lo = fetch(), hi = fetch();
        if (p === 3) reg.sp = (hi << 8) | lo;
        else if (p === 2) set16(IXY ? IXY[0] : "h", IXY ? IXY[1] : "l", (hi << 8) | lo);
        else set16(RP[p][0], RP[p][1], (hi << 8) | lo);
        tStates = idx ? 14 : 10;
      } else { // ADD HL,rp (16-bit)
        const hl = getIDX();
        reg.memptr = (hl + 1) & 0xffff; // WZ = HL (or IX/IY) + 1, before the add
        const rp = p === 3 ? (reg.sp & 0xffff) : p === 2 ? getIDX() : get16(RP[p][0], RP[p][1]);
        const sum = hl + rp;
        const res = sum & 0xffff;
        reg.f = (reg.f & (S | Z | PV)) | (((hl & 0x0fff) + (rp & 0x0fff)) > 0x0fff ? H : 0) |
          ((res >> 8) & (F5 | F3)) | (sum > 0xffff ? C : 0);
        if (IXY) set16(IXY[0], IXY[1], res); else set16("h", "l", res);
        if (internal) internal(ir(), 7); // 7 internal cycles on IR (the 16-bit add)
        tStates = idx ? 15 : 11;
      }
    } else if (zc === 2) {
      // indirect loads/stores (group by y): 0 LD(BC)A 1 LDA(BC) 2 LD(DE)A
      // 3 LDA(DE) 4 LD(nn)HL 5 LDHL(nn) 6 LD(nn)A 7 LDA(nn)
      if (y === 0) { const a = get16("b", "c"); wr(a, reg.a); reg.memptr = ((a + 1) & 0xff) | (reg.a << 8); tStates = 7 + t4; } // LD (BC),A: WZ low=(BC+1), high=A
      else if (y === 1) { const a = get16("b", "c"); reg.a = rd(a); reg.memptr = (a + 1) & 0xffff; tStates = 7 + t4; } // LD A,(BC): WZ=BC+1
      else if (y === 2) { const a = get16("d", "e"); wr(a, reg.a); reg.memptr = ((a + 1) & 0xff) | (reg.a << 8); tStates = 7 + t4; } // LD (DE),A: WZ low=(DE+1), high=A
      else if (y === 3) { const a = get16("d", "e"); reg.a = rd(a); reg.memptr = (a + 1) & 0xffff; tStates = 7 + t4; } // LD A,(DE): WZ=DE+1
      else if (y === 4) { const lo = fetch(), hi = fetch(); const a = (hi << 8) | lo; const v = getIDX(); wr(a, v & 0xff); wr(a + 1, (v >> 8) & 0xff); reg.memptr = (a + 1) & 0xffff; tStates = idx ? 20 : 16; } // LD (nn),HL: WZ=nn+1
      else if (y === 5) { const lo = fetch(), hi = fetch(); const a = (hi << 8) | lo; const v = rd(a) | (rd(a + 1) << 8); if (IXY) set16(IXY[0], IXY[1], v); else set16("h", "l", v); reg.memptr = (a + 1) & 0xffff; tStates = idx ? 20 : 16; } // LD HL,(nn): WZ=nn+1
      else if (y === 6) { const lo = fetch(), hi = fetch(); const a = (hi << 8) | lo; wr(a, reg.a); reg.memptr = ((a + 1) & 0xff) | (reg.a << 8); tStates = 13 + t4; } // LD (nn),A: WZ low=(nn+1), high=A
      else { const lo = fetch(), hi = fetch(); const a = (hi << 8) | lo; reg.a = rd(a); reg.memptr = (a + 1) & 0xffff; tStates = 13 + t4; } // LD A,(nn): WZ=nn+1
    } else if (zc === 3) { // INC/DEC rp
      const decw = q === 1;
      const apply = (v) => (v + (decw ? -1 : 1)) & 0xffff;
      if (p === 3) reg.sp = apply(reg.sp & 0xffff);
      else if (p === 2) { if (IXY) set16(IXY[0], IXY[1], apply(getIDX())); else set16("h", "l", apply(getHL())); }
      else set16(RP[p][0], RP[p][1], apply(get16(RP[p][0], RP[p][1])));
      if (internal) internal(ir(), 2); // 16-bit INC/DEC: 2 internal cycles on IR
      tStates = idx ? 10 : 6;
    } else if (zc === 4) { // INC r
      if (y === 6) { const a = idx ? ensureDisp() : getHL(); if (internal && idx) internal((pc - 1) & 0xffff, 5); const v = rd(a); if (internal) internal(a, 1); const r = inc8(v, reg.f); wr(a, r.res); reg.f = r.f; tStates = idx ? 23 : 11; }
      else { const r = inc8(get8(y), reg.f); set8(y, r.res); reg.f = r.f; tStates = idx ? 8 : 4; }
    } else if (zc === 5) { // DEC r
      if (y === 6) { const a = idx ? ensureDisp() : getHL(); if (internal && idx) internal((pc - 1) & 0xffff, 5); const v = rd(a); if (internal) internal(a, 1); const r = dec8(v, reg.f); wr(a, r.res); reg.f = r.f; tStates = idx ? 23 : 11; }
      else { const r = dec8(get8(y), reg.f); set8(y, r.res); reg.f = r.f; tStates = idx ? 8 : 4; }
    } else if (zc === 6) { // LD r,n
      if (y === 6) { const a = idx ? ensureDisp() : getHL(); if (inexact && idx) inexact(); const n = fetch(); wr(a, n); tStates = idx ? 19 : 10; } // (disp before n; (IX+d) index internals not modeled)
      else { const n = fetch(); set8(y, n); tStates = idx ? 11 : 7; }
    } else { // zc === 7: rotates/DAA/CPL/SCF/CCF on A
      tStates = 4 + t4;
      if (y === 0) { const c = (reg.a >> 7) & 1; reg.a = ((reg.a << 1) | c) & 0xff; reg.f = (reg.f & (S | Z | PV)) | (reg.a & (F5 | F3)) | c; } // RLCA
      else if (y === 1) { const c = reg.a & 1; reg.a = ((reg.a >> 1) | (c << 7)) & 0xff; reg.f = (reg.f & (S | Z | PV)) | (reg.a & (F5 | F3)) | c; } // RRCA
      else if (y === 2) { const c = (reg.a >> 7) & 1; reg.a = ((reg.a << 1) | (reg.f & C)) & 0xff; reg.f = (reg.f & (S | Z | PV)) | (reg.a & (F5 | F3)) | c; } // RLA
      else if (y === 3) { const c = reg.a & 1; reg.a = ((reg.a >> 1) | ((reg.f & C) << 7)) & 0xff; reg.f = (reg.f & (S | Z | PV)) | (reg.a & (F5 | F3)) | c; } // RRA
      else if (y === 4) reg.a = daa(); // DAA
      else if (y === 5) { reg.a = (~reg.a) & 0xff; reg.f = (reg.f & (S | Z | PV | C)) | H | N | (reg.a & (F5 | F3)); } // CPL
      else if (y === 6) { reg.f = (reg.f & (S | Z | PV)) | ((reg.a | reg.f) & (F5 | F3)) | C; } // SCF (5/3 from A|F)
      else { const c = reg.f & C; reg.f = (reg.f & (S | Z | PV)) | (c ? H : 0) | ((reg.a | reg.f) & (F5 | F3)) | (c ? 0 : C); } // CCF
    }
  } else { // x === 3
    if (zc === 0) { // RET cc
      if (internal) internal(ir(), 1); // condition-evaluation internal cycle on IR
      if (flagCC(y)) { const sp = reg.sp & 0xffff; pc = rd(sp) | (rd(sp + 1) << 8); reg.sp = (sp + 2) & 0xffff; reg.memptr = pc; tStates = 11 + t4; } else tStates = 5 + t4; // taken: WZ = return address
    } else if (zc === 1) {
      if (q === 0) { // POP rp2 (BC/DE/HL/AF)
        const sp = reg.sp & 0xffff; const lo = rd(sp), hi = rd(sp + 1); reg.sp = (sp + 2) & 0xffff;
        if (p === 3) { reg.a = hi; reg.f = lo; }
        else if (p === 2) { if (IXY) set16(IXY[0], IXY[1], (hi << 8) | lo); else set16("h", "l", (hi << 8) | lo); }
        else set16(RP[p][0], RP[p][1], (hi << 8) | lo);
        tStates = idx ? 14 : 10;
      } else {
        if (p === 0) { const sp = reg.sp & 0xffff; pc = rd(sp) | (rd(sp + 1) << 8); reg.sp = (sp + 2) & 0xffff; reg.memptr = pc; tStates = 10 + t4; } // RET: WZ = return address
        else if (p === 1) { for (const r of ["b", "c", "d", "e", "h", "l"]) { const t = reg[r]; reg[r] = reg[r + "_"]; reg[r + "_"] = t; } tStates = 4 + t4; } // EXX (BC/DE/HL only)
        else if (p === 2) { if (IXY) set16(IXY[0], IXY[1], getIDX()); pc = getIDX(); tStates = idx ? 8 : 4; } // JP (HL)/(IX)
        else { reg.sp = getIDX(); if (internal) internal(ir(), 2); tStates = idx ? 10 : 6; } // LD SP,HL (2 internal on IR)
      }
    } else if (zc === 2) { // JP cc,nn
      const lo = fetch(), hi = fetch(); reg.memptr = (hi << 8) | lo; if (flagCC(y)) pc = (hi << 8) | lo; tStates = 10 + t4; // WZ = nn (taken or not)
    } else if (zc === 3) {
      if (y === 0) { const lo = fetch(), hi = fetch(); pc = (hi << 8) | lo; reg.memptr = pc; tStates = 10 + t4; } // JP nn: WZ = nn
      else if (y === 1) { /* CB handled above */ tStates = 4; }
      else if (y === 2) { const n = fetch(); io.write((reg.a << 8) | n, reg.a); reg.memptr = ((n + 1) & 0xff) | (reg.a << 8); tStates = 11 + t4; } // OUT (n),A: WZ low=(n+1), high=A
      else if (y === 3) { const n = fetch(); const port = (reg.a << 8) | n; reg.memptr = (port + 1) & 0xffff; reg.a = io.read(port) & 0xff; tStates = 11 + t4; } // IN A,(n): WZ = (A<<8|n)+1, A before the IN
      else if (y === 4) { // EX (SP),HL/IX/IY
        if (inexact) inexact(); // internal cycles + FUSE write order not modeled exactly
        const sp = reg.sp & 0xffff; const lo = rd(sp), hi = rd(sp + 1); const v = getIDX();
        wr(sp, v & 0xff); wr(sp + 1, (v >> 8) & 0xff);
        if (IXY) set16(IXY[0], IXY[1], (hi << 8) | lo); else set16("h", "l", (hi << 8) | lo);
        reg.memptr = (hi << 8) | lo; // WZ = value loaded into HL/IX/IY
        tStates = idx ? 23 : 19;
      } else if (y === 5) { const t1 = reg.d; reg.d = reg.h; reg.h = t1; const t2 = reg.e; reg.e = reg.l; reg.l = t2; tStates = 4 + t4; } // EX DE,HL
      else if (y === 6) { reg.iff1 = 0; reg.iff2 = 0; tStates = 4 + t4; } // DI
      else { reg.iff1 = 1; reg.iff2 = 1; tStates = 4 + t4; } // EI
    } else if (zc === 4) { // CALL cc,nn
      const lo = fetch(), hi = fetch(); reg.memptr = (hi << 8) | lo; // WZ = nn (taken or not)
      if (flagCC(y)) { if (internal) internal((pc - 1) & 0xffff, 1); const sp = (reg.sp - 2) & 0xffff; wr(sp + 1, (pc >> 8) & 0xff); wr(sp, pc & 0xff); reg.sp = sp; pc = (hi << 8) | lo; tStates = 17 + t4; } else tStates = 10 + t4;
    } else if (zc === 5) {
      if (q === 0) { // PUSH rp2
        const sp = (reg.sp - 2) & 0xffff;
        let hi, lo;
        if (p === 3) { hi = reg.a; lo = reg.f; }
        else if (p === 2) { const v = getIDX(); hi = (v >> 8) & 0xff; lo = v & 0xff; }
        else { hi = reg[RP[p][0]]; lo = reg[RP[p][1]]; }
        if (internal) internal(ir(), 1); // M1-extension internal cycle on IR before the pushes
        wr(sp + 1, hi); wr(sp, lo); reg.sp = sp; // high byte (SP-1) written before low (SP-2)
        tStates = idx ? 15 : 11;
      } else if (p === 0) { // CALL nn
        const lo = fetch(), hi = fetch(); reg.memptr = (hi << 8) | lo; if (internal) internal((pc - 1) & 0xffff, 1); const sp = (reg.sp - 2) & 0xffff; wr(sp + 1, (pc >> 8) & 0xff); wr(sp, pc & 0xff); reg.sp = sp; pc = (hi << 8) | lo; tStates = 17 + t4; // WZ = nn
      } else { tStates = 4; } // DD/FD/ED prefixes handled earlier
    } else if (zc === 6) { // ALU A,n
      const r = alu8(y, reg.a, fetch(), reg.f); reg.a = r.res; reg.f = r.f; tStates = 7 + t4;
    } else { // zc === 7: RST p
      if (internal) internal(ir(), 1); // M1-extension internal cycle on IR before the pushes
      const sp = (reg.sp - 2) & 0xffff; wr(sp + 1, (pc >> 8) & 0xff); wr(sp, pc & 0xff); reg.sp = sp; pc = y * 8; reg.memptr = pc; tStates = 11 + t4; // WZ = p (destination)
    }
  }

  reg.pc = pc;
  return { registers: reg, tStates };

  // ---- DAA (closes over reg) ----
  function daa() {
    const a = reg.a, n = reg.f & N, hf = reg.f & H, cf = reg.f & C;
    const lo = a & 0x0f;
    let corr = 0, cout = 0;
    if (cf || a > 0x99) { corr |= 0x60; cout = C; }
    if (hf || lo > 9) corr |= 0x06;
    const res = (n ? a - corr : a + corr) & 0xff;
    const hOut = n ? (hf && lo < 6 ? H : 0) : (lo > 9 ? H : 0);
    reg.f = sz53p(res) | hOut | n | cout;
    return res;
  }

  // ---- ED-prefixed opcodes ----
  function stepED(eop) {
    const ppIndex = (eop >> 4) & 0x03;
    const pairGet = { 0: () => get16("b", "c"), 1: () => get16("d", "e"), 2: () => getHL(), 3: () => reg.sp & 0xffff };
    const pairSet = {
      0: (v) => set16("b", "c", v), 1: (v) => set16("d", "e", v), 2: (v) => set16("h", "l", v), 3: (v) => { reg.sp = v & 0xffff; },
    };
    if ((eop & 0xc7) === 0x42) { // SBC/ADC HL,ss
      const isAdc = (eop & 0x08) !== 0;
      const hl = getHL(), ss = pairGet[ppIndex](), cin = reg.f & C;
      reg.memptr = (hl + 1) & 0xffff; // WZ = HL + 1, before the add/sub
      let res, half16, carry, ov;
      if (isAdc) { res = hl + ss + cin; carry = res > 0xffff ? C : 0; half16 = ((hl & 0xfff) + (ss & 0xfff) + cin) > 0xfff ? H : 0; ov = (~(hl ^ ss) & (hl ^ res) & 0x8000) ? PV : 0; }
      else { res = hl - ss - cin; carry = res < 0 ? C : 0; half16 = ((hl & 0xfff) - (ss & 0xfff) - cin) < 0 ? H : 0; ov = ((hl ^ ss) & (hl ^ res) & 0x8000) ? PV : 0; }
      res &= 0xffff; set16("h", "l", res);
      const hi = (res >> 8) & 0xff;
      reg.f = (hi & S) | (res === 0 ? Z : 0) | (hi & (F5 | F3)) | half16 | ov | (isAdc ? 0 : N) | carry;
      if (internal) internal(ir(), 7); // 16-bit ADC/SBC HL,ss: 7 internal cycles on IR
      return { registers: reg, tStates: 15 };
    }
    if ((eop & 0xc7) === 0x43) { // LD (nn),ss / LD ss,(nn)
      const lo = fetch(), hi = fetch(); const nn = (hi << 8) | lo;
      reg.memptr = (nn + 1) & 0xffff; // WZ = nn + 1
      if ((eop & 0x08) === 0) { const v = pairGet[ppIndex](); wr(nn, v & 0xff); wr(nn + 1, (v >> 8) & 0xff); }
      else pairSet[ppIndex](rd(nn) | (rd(nn + 1) << 8));
      return { registers: reg, tStates: 20 };
    }
    if ((eop & 0xc7) === 0x44) { // NEG
      const a = reg.a, res = (0 - a) & 0xff; reg.a = res;
      reg.f = (res & S) | (res === 0 ? Z : 0) | (res & (F5 | F3)) | ((a & 0x0f) !== 0 ? H : 0) | (a === 0x80 ? PV : 0) | N | (a !== 0 ? C : 0);
      return { registers: reg, tStates: 8 };
    }
    if ((eop & 0xc7) === 0x45) { // RETN/RETI
      const sp = reg.sp & 0xffff; pc = rd(sp) | (rd(sp + 1) << 8); reg.sp = (sp + 2) & 0xffff; reg.iff1 = reg.iff2; reg.memptr = pc; // WZ = return address
      return { registers: reg, tStates: 14 };
    }
    if ((eop & 0xc7) === 0x46) { reg.im = { 0: 0, 1: 0, 2: 1, 3: 2 }[(eop >> 3) & 3]; return { registers: reg, tStates: 8 }; } // IM
    if (eop === 0x47) { if (internal) internal(ir(), 1); reg.i = reg.a; return { registers: reg, tStates: 9 }; } // LD I,A (1 internal on IR)
    if (eop === 0x4f) { if (internal) internal(ir(), 1); reg.r = reg.a; return { registers: reg, tStates: 9 }; } // LD R,A (1 internal on IR)
    if (eop === 0x57 || eop === 0x5f) { if (internal) internal(ir(), 1); reg.a = (eop === 0x57 ? reg.i : reg.r) & 0xff; reg.f = (reg.f & C) | sz53(reg.a) | (reg.iff2 ? PV : 0); return { registers: reg, tStates: 9 }; } // LD A,I/R (1 internal on IR)
    if (eop === 0x67 || eop === 0x6f) { // RRD/RLD
      const addr = getHL(), m = rd(addr);
      reg.memptr = (addr + 1) & 0xffff; // WZ = HL + 1
      if (internal) internal(addr, 4); // 4 internal cycles on HL between read and write
      if (eop === 0x67) { wr(addr, ((reg.a & 0x0f) << 4) | (m >> 4)); reg.a = (reg.a & 0xf0) | (m & 0x0f); }
      else { wr(addr, ((m << 4) | (reg.a & 0x0f)) & 0xff); reg.a = (reg.a & 0xf0) | (m >> 4); }
      reg.f = (reg.f & C) | sz53p(reg.a);
      return { registers: reg, tStates: 18 };
    }
    if (eop === 0xa0 || eop === 0xa8 || eop === 0xb0 || eop === 0xb8) { // LDI/LDD/LDIR/LDDR
      const dir = (eop === 0xa0 || eop === 0xb0) ? 1 : -1;
      const deAddr = get16("d", "e");
      const val = rd(getHL());
      wr(deAddr, val);
      set16("h", "l", (getHL() + dir) & 0xffff);
      set16("d", "e", (deAddr + dir) & 0xffff);
      const bc = (get16("b", "c") - 1) & 0xffff; set16("b", "c", bc);
      const nn = (reg.a + val) & 0xff;
      reg.f = (reg.f & (C | Z | S)) | (bc !== 0 ? PV : 0) | ((nn & 0x02) ? F5 : 0) | ((nn & 0x08) ? F3 : 0);
      // LDIR/LDDR repeat while BC != 0: rewind PC by 2 to re-fetch (+5 T per
      // repeat). The flags are those of one LDI/LDD iteration (this FUSE suite
      // predates the PC-derived 5/3 repeat correction). See ADR-0009.
      const repeating = (eop === 0xb0 || eop === 0xb8) && bc !== 0;
      // 2 internal cycles on DE per iteration; a repeating iteration adds 5 more.
      if (internal) internal(deAddr, repeating ? 7 : 2);
      // WZ: LDI/LDD leave it unchanged; a repeating LDIR/LDDR iteration sets it to
      // the instruction address + 1 (pc currently points just past the 2-byte op).
      if (repeating) { reg.memptr = (pc - 1) & 0xffff; pc = (pc - 2) & 0xffff; return { registers: reg, tStates: 21 }; }
      return { registers: reg, tStates: 16 };
    }
    if (eop === 0xa1 || eop === 0xa9 || eop === 0xb1 || eop === 0xb9) { // CPI/CPD/CPIR/CPDR
      const dir = (eop === 0xa1 || eop === 0xb1) ? 1 : -1;
      const hlAddr = getHL();
      const val = rd(hlAddr);
      const res = (reg.a - val) & 0xff; const hf = ((reg.a & 0x0f) - (val & 0x0f)) < 0 ? H : 0;
      set16("h", "l", (hlAddr + dir) & 0xffff);
      const bc = (get16("b", "c") - 1) & 0xffff; set16("b", "c", bc);
      const nn = (res - (hf ? 1 : 0)) & 0xff;
      reg.f = (reg.f & C) | (res & S) | (res === 0 ? Z : 0) | hf | N | (bc !== 0 ? PV : 0) | ((nn & 0x02) ? F5 : 0) | ((nn & 0x08) ? F3 : 0);
      // CPIR/CPDR repeat while BC != 0 AND no match (A != (HL), i.e. res != 0).
      const repeating = (eop === 0xb1 || eop === 0xb9) && bc !== 0 && res !== 0;
      // 5 internal cycles on HL per iteration; a repeating iteration adds 5 more.
      if (internal) internal(hlAddr, repeating ? 10 : 5);
      // WZ: a repeating iteration sets it to the instruction address + 1; otherwise
      // CPI adds 1 / CPD subtracts 1 to the latched WZ (dir = +1 for I, -1 for D).
      if (repeating) { reg.memptr = (pc - 1) & 0xffff; pc = (pc - 2) & 0xffff; return { registers: reg, tStates: 21 }; }
      reg.memptr = (reg.memptr + dir) & 0xffff;
      return { registers: reg, tStates: 16 };
    }
    const reg8 = ["b", "c", "d", "e", "h", "l", null, "a"];
    if ((eop & 0xc7) === 0x40) { // IN r,(C)  (r=110 -> flags only, no store)
      const bc = get16("b", "c");
      const val = io.read(bc) & 0xff;
      const r = (eop >> 3) & 7;
      if (r !== 6) reg[reg8[r]] = val;
      reg.f = (reg.f & C) | sz53p(val);
      reg.memptr = (bc + 1) & 0xffff; // WZ = BC + 1
      return { registers: reg, tStates: 12 };
    }
    if ((eop & 0xc7) === 0x41) { // OUT (C),r  (r=110 -> writes 0)
      const bc = get16("b", "c");
      const r = (eop >> 3) & 7;
      io.write(bc, r === 6 ? 0 : reg[reg8[r]]);
      reg.memptr = (bc + 1) & 0xffff; // WZ = BC + 1
      return { registers: reg, tStates: 12 };
    }
    if (eop === 0xa2 || eop === 0xaa || eop === 0xa3 || eop === 0xab ||
        eop === 0xb2 || eop === 0xba || eop === 0xb3 || eop === 0xbb) { // INI/IND/OUTI/OUTD + INIR/INDR/OTIR/OTDR
      if (inexact) inexact(); // block I/O mixes an internal cycle with port I/O (port contention out of scope)
      const isIn = eop === 0xa2 || eop === 0xaa || eop === 0xb2 || eop === 0xba;
      const dir = (eop === 0xa2 || eop === 0xa3 || eop === 0xb2 || eop === 0xb3) ? 1 : -1; // I-forms +1, D-forms -1
      let data, k;
      if (isIn) {
        const bcIo = get16("b", "c"); // port address uses the pre-decrement BC
        data = io.read(bcIo) & 0xff;
        wr(getHL(), data);
        reg.b = (reg.b - 1) & 0xff;
        set16("h", "l", (getHL() + dir) & 0xffff);
        k = (data + ((reg.c + dir) & 0xff)) & 0x1ff; // INI: C+1, IND: C-1
        reg.memptr = (bcIo + dir) & 0xffff; // WZ = BC(used) ± 1 (INI +1, IND -1)
      } else { // OUTI/OUTD: decrement B first, then read (HL), write to port BC
        data = rd(getHL());
        reg.b = (reg.b - 1) & 0xff;
        const bcIo = get16("b", "c"); // port address uses the post-decrement BC
        io.write(bcIo, data);
        set16("h", "l", (getHL() + dir) & 0xffff);
        k = (data + reg.l) & 0x1ff; // L AFTER the HL update (witnessed by FUSE eda3_01)
        reg.memptr = (bcIo + dir) & 0xffff; // WZ = BC(used) ± 1 (OUTI +1, OUTD -1)
      }
      const carry = k > 0xff ? (H | C) : 0;
      reg.f = sz53(reg.b) | (data & 0x80 ? N : 0) | carry | parity(((k & 7) ^ reg.b) & 0xff);
      // INIR/INDR/OTIR/OTDR repeat while B != 0; same per-iteration flags.
      if ((eop === 0xb2 || eop === 0xba || eop === 0xb3 || eop === 0xbb) && reg.b !== 0) { pc = (pc - 2) & 0xffff; return { registers: reg, tStates: 21 }; }
      return { registers: reg, tStates: 16 };
    }
    return { registers: reg, tStates: 8 }; // other ED (incl. NONI) — not in fixtures
  }
}
