/* ZX Spectrum emulator bundle — @zx-vibes/machine. ROM (c) Amstrad plc, by permission. */
var ZXSpectrum = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // examples/tooling/browser-entry.mjs
  var browser_entry_exports = {};
  __export(browser_entry_exports, {
    Spectrum: () => Spectrum,
    create: () => create
  });

  // packages/cpu/src/z80-step.mjs
  var S = 128;
  var Z = 64;
  var F5 = 32;
  var H = 16;
  var F3 = 8;
  var PV = 4;
  var N = 2;
  var C = 1;
  var parity = (v) => {
    let p = 0;
    for (let i = 0; i < 8; i += 1) p ^= v >> i & 1;
    return p === 0 ? PV : 0;
  };
  var sz53 = (v) => v & S | (v === 0 ? Z : 0) | v & (F5 | F3);
  var sz53p = (v) => sz53(v) | parity(v);
  function alu8(op, a, val, f) {
    const cin = f & C;
    let res, flags;
    switch (op) {
      case 0:
      // ADD
      case 1: {
        const carry = op === 1 ? cin : 0;
        const sum = a + val + carry;
        res = sum & 255;
        flags = sz53(res) | ((a & 15) + (val & 15) + carry > 15 ? H : 0) | (~(a ^ val) & (a ^ res) & 128 ? PV : 0) | (sum > 255 ? C : 0);
        break;
      }
      case 2:
      // SUB
      case 3:
      // SBC
      case 7: {
        const carry = op === 3 ? cin : 0;
        const diff = a - val - carry;
        res = diff & 255;
        const base = res & S | (res === 0 ? Z : 0) | ((a & 15) - (val & 15) - carry < 0 ? H : 0) | ((a ^ val) & (a ^ res) & 128 ? PV : 0) | N | (diff < 0 ? C : 0);
        flags = op === 7 ? base | val & (F5 | F3) : base | res & (F5 | F3);
        break;
      }
      case 4:
        res = a & val;
        flags = sz53p(res) | H;
        break;
      case 5:
        res = a ^ val;
        flags = sz53p(res);
        break;
      default:
        res = a | val;
        flags = sz53p(res);
        break;
    }
    return { res: op === 7 ? a : res, f: flags };
  }
  function inc8(v, f) {
    const res = v + 1 & 255;
    return { res, f: f & C | sz53(res) | ((v & 15) === 15 ? H : 0) | (v === 127 ? PV : 0) };
  }
  function dec8(v, f) {
    const res = v - 1 & 255;
    return { res, f: f & C | sz53(res) | ((v & 15) === 0 ? H : 0) | (v === 128 ? PV : 0) | N };
  }
  function rot(op, v, f) {
    const cin = f & C;
    let res, carry;
    switch (op) {
      case 0:
        carry = v >> 7 & 1;
        res = (v << 1 | carry) & 255;
        break;
      // RLC
      case 1:
        carry = v & 1;
        res = (v >> 1 | carry << 7) & 255;
        break;
      // RRC
      case 2:
        carry = v >> 7 & 1;
        res = (v << 1 | cin) & 255;
        break;
      // RL
      case 3:
        carry = v & 1;
        res = (v >> 1 | cin << 7) & 255;
        break;
      // RR
      case 4:
        carry = v >> 7 & 1;
        res = v << 1 & 255;
        break;
      // SLA
      case 5:
        carry = v & 1;
        res = (v >> 1 | v & 128) & 255;
        break;
      // SRA
      case 6:
        carry = v >> 7 & 1;
        res = (v << 1 | 1) & 255;
        break;
      // SLL (undoc)
      default:
        carry = v & 1;
        res = v >> 1 & 255;
        break;
    }
    return { res, f: sz53p(res) | carry };
  }
  function step({ registers: reg, memory, io, clock }) {
    const onCycle = clock ? (a, t) => {
      const m = a & 65535;
      if (clock.access) clock.access(m);
      if (clock.mcycle) clock.mcycle(m, t);
    } : null;
    const internal = clock && clock.internal ? (a, n) => clock.internal(a & 65535, n) : null;
    const inexact = clock && clock.inexact ? () => clock.inexact() : null;
    const rd = (a, t = 3) => {
      const v = memory[a & 65535];
      if (onCycle) onCycle(a, t);
      return v;
    };
    const wr = (a, v, t = 3) => {
      memory[a & 65535] = v & 255;
      if (onCycle) onCycle(a, t);
    };
    let pc = reg.pc & 65535;
    const fetch = (t = 3) => {
      const b = rd(pc, t);
      pc = pc + 1 & 65535;
      return b;
    };
    const incR = () => {
      reg.r = reg.r & 128 | reg.r + 1 & 127;
    };
    const ir = () => (reg.i << 8 | reg.r) & 65535;
    const RP = ["bc", "de", "hl", "sp"];
    const get16 = (hi, lo) => reg[hi] << 8 | reg[lo];
    const set16 = (hi, lo, v) => {
      reg[hi] = v >> 8 & 255;
      reg[lo] = v & 255;
    };
    const getHL = () => reg.h << 8 | reg.l;
    const flagCC = (y2) => {
      switch (y2) {
        case 0:
          return !(reg.f & Z);
        case 1:
          return !!(reg.f & Z);
        case 2:
          return !(reg.f & C);
        case 3:
          return !!(reg.f & C);
        case 4:
          return !(reg.f & PV);
        case 5:
          return !!(reg.f & PV);
        case 6:
          return !(reg.f & S);
        default:
          return !!(reg.f & S);
      }
    };
    incR();
    let op = fetch(4);
    let idx = null;
    if (op === 221 || op === 253) {
      idx = op === 221 ? "ix" : "iy";
      op = fetch(4);
      if (op === 221 || op === 253 || op === 237) {
        reg.pc = pc - 1 & 65535;
        return { registers: reg, tStates: 4 };
      }
      incR();
    }
    const IXY = idx === "ix" ? ["ixh", "ixl"] : idx === "iy" ? ["iyh", "iyl"] : null;
    const getIDX = () => idx ? get16(IXY[0], IXY[1]) : getHL();
    if (op === 203) {
      let addr;
      if (idx) {
        const d = fetch() << 24 >> 24;
        addr = getIDX() + d & 65535;
        reg.memptr = addr;
      }
      const cbop = fetch(idx ? 3 : 4);
      if (!idx) incR();
      const x2 = cbop >> 6, y2 = cbop >> 3 & 7, zc2 = cbop & 7;
      const reg8 = ["b", "c", "d", "e", "h", "l", null, "a"];
      const memAddr = idx ? addr : zc2 === 6 ? getHL() : null;
      if (internal && idx) internal(pc - 1 & 65535, 2);
      const readSrc = () => idx ? rd(addr) : zc2 === 6 ? rd(getHL()) : reg[reg8[zc2]];
      const v = readSrc();
      if (x2 === 1) {
        if (internal && memAddr !== null) internal(memAddr, 1);
        const bit = v >> y2 & 1;
        let f = reg.f & C | H | (bit === 0 ? Z | PV : 0) | (y2 === 7 && bit ? S : 0);
        let src53;
        if (idx) src53 = addr >> 8 & 255;
        else if (zc2 === 6) src53 = reg.memptr >> 8 & 255;
        else src53 = v;
        f |= src53 & (F5 | F3);
        reg.f = f;
        reg.pc = pc;
        return { registers: reg, tStates: idx ? 20 : zc2 === 6 ? 12 : 8 };
      }
      let res;
      if (x2 === 0) res = rot(y2, v, reg.f), reg.f = res.f, res = res.res;
      else if (x2 === 2) res = v & ~(1 << y2);
      else res = v | 1 << y2;
      if (internal && memAddr !== null) internal(memAddr, 1);
      if (idx) {
        wr(addr, res);
        if (zc2 !== 6) reg[reg8[zc2]] = res;
      } else if (zc2 === 6) {
        wr(getHL(), res);
      } else {
        reg[reg8[zc2]] = res;
      }
      reg.pc = pc;
      const t = idx ? 23 : zc2 === 6 ? 15 : 8;
      return { registers: reg, tStates: t };
    }
    if (op === 237) {
      incR();
      const eop = fetch(4);
      const result = stepED(eop);
      reg.pc = pc;
      return result;
    }
    const x = op >> 6, y = op >> 3 & 7, zc = op & 7, p = y >> 1, q = y & 1;
    let dispAddr = null;
    const refsMemCode = x === 1 && (y === 6 || zc === 6) || x === 2 && zc === 6 || x === 0 && (zc === 4 || zc === 5 || zc === 6) && y === 6;
    const needDisp = idx && refsMemCode;
    const half = (code) => {
      if (code === 4) return idx && !needDisp ? IXY[0] : "h";
      if (code === 5) return idx && !needDisp ? IXY[1] : "l";
      return ["b", "c", "d", "e", "h", "l", null, "a"][code];
    };
    const ensureDisp = () => {
      if (dispAddr === null) {
        const d = fetch() << 24 >> 24;
        dispAddr = getIDX() + d & 65535;
        reg.memptr = dispAddr;
      }
      return dispAddr;
    };
    const get8 = (code) => {
      if (code === 6) {
        if (idx) {
          if (inexact) inexact();
          return rd(ensureDisp());
        }
        return rd(getHL());
      }
      return reg[half(code)];
    };
    const set8 = (code, v) => {
      if (code === 6) {
        if (idx) {
          if (inexact) inexact();
          wr(ensureDisp(), v);
        } else wr(getHL(), v);
        return;
      }
      reg[half(code)] = v & 255;
    };
    let tStates = 4;
    const t4 = idx ? 4 : 0;
    if (x === 1 && y === 6 && zc === 6 && !idx) {
      reg.pc = pc - 1 & 65535;
      return { registers: reg, tStates: 4 };
    } else if (x === 1) {
      set8(y, get8(zc));
      tStates = y === 6 || zc === 6 ? idx ? 19 : 7 : idx ? 8 : 4;
    } else if (x === 2) {
      const r = alu8(y, reg.a, get8(zc), reg.f);
      reg.a = r.res;
      reg.f = r.f;
      tStates = zc === 6 ? idx ? 19 : 7 : idx ? 8 : 4;
    } else if (x === 0) {
      if (zc === 0) {
        if (y === 0) tStates = 4 + t4;
        else if (y === 1) {
          for (const r of ["a", "f"]) {
            const t = reg[r];
            reg[r] = reg[r + "_"];
            reg[r + "_"] = t;
          }
          tStates = 4 + t4;
        } else if (y === 2) {
          if (inexact) inexact();
          const d = fetch() << 24 >> 24;
          reg.b = reg.b - 1 & 255;
          if (reg.b !== 0) {
            pc = pc + d & 65535;
            reg.memptr = pc;
            tStates = 13 + t4;
          } else tStates = 8 + t4;
        } else if (y === 3) {
          const d = fetch() << 24 >> 24;
          if (internal) internal(pc - 1 & 65535, 5);
          pc = pc + d & 65535;
          reg.memptr = pc;
          tStates = 12 + t4;
        } else {
          const d = fetch() << 24 >> 24;
          if (flagCC(y - 4)) {
            if (internal) internal(pc - 1 & 65535, 5);
            pc = pc + d & 65535;
            reg.memptr = pc;
            tStates = 12 + t4;
          } else tStates = 7 + t4;
        }
      } else if (zc === 1) {
        if (q === 0) {
          const lo = fetch(), hi = fetch();
          if (p === 3) reg.sp = hi << 8 | lo;
          else if (p === 2) set16(IXY ? IXY[0] : "h", IXY ? IXY[1] : "l", hi << 8 | lo);
          else set16(RP[p][0], RP[p][1], hi << 8 | lo);
          tStates = idx ? 14 : 10;
        } else {
          const hl = getIDX();
          reg.memptr = hl + 1 & 65535;
          const rp = p === 3 ? reg.sp & 65535 : p === 2 ? getIDX() : get16(RP[p][0], RP[p][1]);
          const sum = hl + rp;
          const res = sum & 65535;
          reg.f = reg.f & (S | Z | PV) | ((hl & 4095) + (rp & 4095) > 4095 ? H : 0) | res >> 8 & (F5 | F3) | (sum > 65535 ? C : 0);
          if (IXY) set16(IXY[0], IXY[1], res);
          else set16("h", "l", res);
          if (internal) internal(ir(), 7);
          tStates = idx ? 15 : 11;
        }
      } else if (zc === 2) {
        if (y === 0) {
          const a = get16("b", "c");
          wr(a, reg.a);
          reg.memptr = a + 1 & 255 | reg.a << 8;
          tStates = 7 + t4;
        } else if (y === 1) {
          const a = get16("b", "c");
          reg.a = rd(a);
          reg.memptr = a + 1 & 65535;
          tStates = 7 + t4;
        } else if (y === 2) {
          const a = get16("d", "e");
          wr(a, reg.a);
          reg.memptr = a + 1 & 255 | reg.a << 8;
          tStates = 7 + t4;
        } else if (y === 3) {
          const a = get16("d", "e");
          reg.a = rd(a);
          reg.memptr = a + 1 & 65535;
          tStates = 7 + t4;
        } else if (y === 4) {
          const lo = fetch(), hi = fetch();
          const a = hi << 8 | lo;
          const v = getIDX();
          wr(a, v & 255);
          wr(a + 1, v >> 8 & 255);
          reg.memptr = a + 1 & 65535;
          tStates = idx ? 20 : 16;
        } else if (y === 5) {
          const lo = fetch(), hi = fetch();
          const a = hi << 8 | lo;
          const v = rd(a) | rd(a + 1) << 8;
          if (IXY) set16(IXY[0], IXY[1], v);
          else set16("h", "l", v);
          reg.memptr = a + 1 & 65535;
          tStates = idx ? 20 : 16;
        } else if (y === 6) {
          const lo = fetch(), hi = fetch();
          const a = hi << 8 | lo;
          wr(a, reg.a);
          reg.memptr = a + 1 & 255 | reg.a << 8;
          tStates = 13 + t4;
        } else {
          const lo = fetch(), hi = fetch();
          const a = hi << 8 | lo;
          reg.a = rd(a);
          reg.memptr = a + 1 & 65535;
          tStates = 13 + t4;
        }
      } else if (zc === 3) {
        const decw = q === 1;
        const apply = (v) => v + (decw ? -1 : 1) & 65535;
        if (p === 3) reg.sp = apply(reg.sp & 65535);
        else if (p === 2) {
          if (IXY) set16(IXY[0], IXY[1], apply(getIDX()));
          else set16("h", "l", apply(getHL()));
        } else set16(RP[p][0], RP[p][1], apply(get16(RP[p][0], RP[p][1])));
        if (internal) internal(ir(), 2);
        tStates = idx ? 10 : 6;
      } else if (zc === 4) {
        if (y === 6) {
          const a = idx ? ensureDisp() : getHL();
          if (internal && idx) internal(pc - 1 & 65535, 5);
          const v = rd(a);
          if (internal) internal(a, 1);
          const r = inc8(v, reg.f);
          wr(a, r.res);
          reg.f = r.f;
          tStates = idx ? 23 : 11;
        } else {
          const r = inc8(get8(y), reg.f);
          set8(y, r.res);
          reg.f = r.f;
          tStates = idx ? 8 : 4;
        }
      } else if (zc === 5) {
        if (y === 6) {
          const a = idx ? ensureDisp() : getHL();
          if (internal && idx) internal(pc - 1 & 65535, 5);
          const v = rd(a);
          if (internal) internal(a, 1);
          const r = dec8(v, reg.f);
          wr(a, r.res);
          reg.f = r.f;
          tStates = idx ? 23 : 11;
        } else {
          const r = dec8(get8(y), reg.f);
          set8(y, r.res);
          reg.f = r.f;
          tStates = idx ? 8 : 4;
        }
      } else if (zc === 6) {
        if (y === 6) {
          const a = idx ? ensureDisp() : getHL();
          if (inexact && idx) inexact();
          const n = fetch();
          wr(a, n);
          tStates = idx ? 19 : 10;
        } else {
          const n = fetch();
          set8(y, n);
          tStates = idx ? 11 : 7;
        }
      } else {
        tStates = 4 + t4;
        if (y === 0) {
          const c = reg.a >> 7 & 1;
          reg.a = (reg.a << 1 | c) & 255;
          reg.f = reg.f & (S | Z | PV) | reg.a & (F5 | F3) | c;
        } else if (y === 1) {
          const c = reg.a & 1;
          reg.a = (reg.a >> 1 | c << 7) & 255;
          reg.f = reg.f & (S | Z | PV) | reg.a & (F5 | F3) | c;
        } else if (y === 2) {
          const c = reg.a >> 7 & 1;
          reg.a = (reg.a << 1 | reg.f & C) & 255;
          reg.f = reg.f & (S | Z | PV) | reg.a & (F5 | F3) | c;
        } else if (y === 3) {
          const c = reg.a & 1;
          reg.a = (reg.a >> 1 | (reg.f & C) << 7) & 255;
          reg.f = reg.f & (S | Z | PV) | reg.a & (F5 | F3) | c;
        } else if (y === 4) reg.a = daa();
        else if (y === 5) {
          reg.a = ~reg.a & 255;
          reg.f = reg.f & (S | Z | PV | C) | H | N | reg.a & (F5 | F3);
        } else if (y === 6) {
          reg.f = reg.f & (S | Z | PV) | (reg.a | reg.f) & (F5 | F3) | C;
        } else {
          const c = reg.f & C;
          reg.f = reg.f & (S | Z | PV) | (c ? H : 0) | (reg.a | reg.f) & (F5 | F3) | (c ? 0 : C);
        }
      }
    } else {
      if (zc === 0) {
        if (internal) internal(ir(), 1);
        if (flagCC(y)) {
          const sp = reg.sp & 65535;
          pc = rd(sp) | rd(sp + 1) << 8;
          reg.sp = sp + 2 & 65535;
          reg.memptr = pc;
          tStates = 11 + t4;
        } else tStates = 5 + t4;
      } else if (zc === 1) {
        if (q === 0) {
          const sp = reg.sp & 65535;
          const lo = rd(sp), hi = rd(sp + 1);
          reg.sp = sp + 2 & 65535;
          if (p === 3) {
            reg.a = hi;
            reg.f = lo;
          } else if (p === 2) {
            if (IXY) set16(IXY[0], IXY[1], hi << 8 | lo);
            else set16("h", "l", hi << 8 | lo);
          } else set16(RP[p][0], RP[p][1], hi << 8 | lo);
          tStates = idx ? 14 : 10;
        } else {
          if (p === 0) {
            const sp = reg.sp & 65535;
            pc = rd(sp) | rd(sp + 1) << 8;
            reg.sp = sp + 2 & 65535;
            reg.memptr = pc;
            tStates = 10 + t4;
          } else if (p === 1) {
            for (const r of ["b", "c", "d", "e", "h", "l"]) {
              const t = reg[r];
              reg[r] = reg[r + "_"];
              reg[r + "_"] = t;
            }
            tStates = 4 + t4;
          } else if (p === 2) {
            if (IXY) set16(IXY[0], IXY[1], getIDX());
            pc = getIDX();
            tStates = idx ? 8 : 4;
          } else {
            reg.sp = getIDX();
            if (internal) internal(ir(), 2);
            tStates = idx ? 10 : 6;
          }
        }
      } else if (zc === 2) {
        const lo = fetch(), hi = fetch();
        reg.memptr = hi << 8 | lo;
        if (flagCC(y)) pc = hi << 8 | lo;
        tStates = 10 + t4;
      } else if (zc === 3) {
        if (y === 0) {
          const lo = fetch(), hi = fetch();
          pc = hi << 8 | lo;
          reg.memptr = pc;
          tStates = 10 + t4;
        } else if (y === 1) {
          tStates = 4;
        } else if (y === 2) {
          const n = fetch();
          io.write(reg.a << 8 | n, reg.a);
          reg.memptr = n + 1 & 255 | reg.a << 8;
          tStates = 11 + t4;
        } else if (y === 3) {
          const n = fetch();
          const port = reg.a << 8 | n;
          reg.memptr = port + 1 & 65535;
          reg.a = io.read(port) & 255;
          tStates = 11 + t4;
        } else if (y === 4) {
          if (inexact) inexact();
          const sp = reg.sp & 65535;
          const lo = rd(sp), hi = rd(sp + 1);
          const v = getIDX();
          wr(sp, v & 255);
          wr(sp + 1, v >> 8 & 255);
          if (IXY) set16(IXY[0], IXY[1], hi << 8 | lo);
          else set16("h", "l", hi << 8 | lo);
          reg.memptr = hi << 8 | lo;
          tStates = idx ? 23 : 19;
        } else if (y === 5) {
          const t1 = reg.d;
          reg.d = reg.h;
          reg.h = t1;
          const t2 = reg.e;
          reg.e = reg.l;
          reg.l = t2;
          tStates = 4 + t4;
        } else if (y === 6) {
          reg.iff1 = 0;
          reg.iff2 = 0;
          tStates = 4 + t4;
        } else {
          reg.iff1 = 1;
          reg.iff2 = 1;
          tStates = 4 + t4;
        }
      } else if (zc === 4) {
        const lo = fetch(), hi = fetch();
        reg.memptr = hi << 8 | lo;
        if (flagCC(y)) {
          if (internal) internal(pc - 1 & 65535, 1);
          const sp = reg.sp - 2 & 65535;
          wr(sp + 1, pc >> 8 & 255);
          wr(sp, pc & 255);
          reg.sp = sp;
          pc = hi << 8 | lo;
          tStates = 17 + t4;
        } else tStates = 10 + t4;
      } else if (zc === 5) {
        if (q === 0) {
          const sp = reg.sp - 2 & 65535;
          let hi, lo;
          if (p === 3) {
            hi = reg.a;
            lo = reg.f;
          } else if (p === 2) {
            const v = getIDX();
            hi = v >> 8 & 255;
            lo = v & 255;
          } else {
            hi = reg[RP[p][0]];
            lo = reg[RP[p][1]];
          }
          if (internal) internal(ir(), 1);
          wr(sp + 1, hi);
          wr(sp, lo);
          reg.sp = sp;
          tStates = idx ? 15 : 11;
        } else if (p === 0) {
          const lo = fetch(), hi = fetch();
          reg.memptr = hi << 8 | lo;
          if (internal) internal(pc - 1 & 65535, 1);
          const sp = reg.sp - 2 & 65535;
          wr(sp + 1, pc >> 8 & 255);
          wr(sp, pc & 255);
          reg.sp = sp;
          pc = hi << 8 | lo;
          tStates = 17 + t4;
        } else {
          tStates = 4;
        }
      } else if (zc === 6) {
        const r = alu8(y, reg.a, fetch(), reg.f);
        reg.a = r.res;
        reg.f = r.f;
        tStates = 7 + t4;
      } else {
        if (internal) internal(ir(), 1);
        const sp = reg.sp - 2 & 65535;
        wr(sp + 1, pc >> 8 & 255);
        wr(sp, pc & 255);
        reg.sp = sp;
        pc = y * 8;
        reg.memptr = pc;
        tStates = 11 + t4;
      }
    }
    reg.pc = pc;
    return { registers: reg, tStates };
    function daa() {
      const a = reg.a, n = reg.f & N, hf = reg.f & H, cf = reg.f & C;
      const lo = a & 15;
      let corr = 0, cout = 0;
      if (cf || a > 153) {
        corr |= 96;
        cout = C;
      }
      if (hf || lo > 9) corr |= 6;
      const res = (n ? a - corr : a + corr) & 255;
      const hOut = n ? hf && lo < 6 ? H : 0 : lo > 9 ? H : 0;
      reg.f = sz53p(res) | hOut | n | cout;
      return res;
    }
    function stepED(eop) {
      const ppIndex = eop >> 4 & 3;
      const pairGet = { 0: () => get16("b", "c"), 1: () => get16("d", "e"), 2: () => getHL(), 3: () => reg.sp & 65535 };
      const pairSet = {
        0: (v) => set16("b", "c", v),
        1: (v) => set16("d", "e", v),
        2: (v) => set16("h", "l", v),
        3: (v) => {
          reg.sp = v & 65535;
        }
      };
      if ((eop & 199) === 66) {
        const isAdc = (eop & 8) !== 0;
        const hl = getHL(), ss = pairGet[ppIndex](), cin = reg.f & C;
        reg.memptr = hl + 1 & 65535;
        let res, half16, carry, ov;
        if (isAdc) {
          res = hl + ss + cin;
          carry = res > 65535 ? C : 0;
          half16 = (hl & 4095) + (ss & 4095) + cin > 4095 ? H : 0;
          ov = ~(hl ^ ss) & (hl ^ res) & 32768 ? PV : 0;
        } else {
          res = hl - ss - cin;
          carry = res < 0 ? C : 0;
          half16 = (hl & 4095) - (ss & 4095) - cin < 0 ? H : 0;
          ov = (hl ^ ss) & (hl ^ res) & 32768 ? PV : 0;
        }
        res &= 65535;
        set16("h", "l", res);
        const hi = res >> 8 & 255;
        reg.f = hi & S | (res === 0 ? Z : 0) | hi & (F5 | F3) | half16 | ov | (isAdc ? 0 : N) | carry;
        if (internal) internal(ir(), 7);
        return { registers: reg, tStates: 15 };
      }
      if ((eop & 199) === 67) {
        const lo = fetch(), hi = fetch();
        const nn = hi << 8 | lo;
        reg.memptr = nn + 1 & 65535;
        if ((eop & 8) === 0) {
          const v = pairGet[ppIndex]();
          wr(nn, v & 255);
          wr(nn + 1, v >> 8 & 255);
        } else pairSet[ppIndex](rd(nn) | rd(nn + 1) << 8);
        return { registers: reg, tStates: 20 };
      }
      if ((eop & 199) === 68) {
        const a = reg.a, res = 0 - a & 255;
        reg.a = res;
        reg.f = res & S | (res === 0 ? Z : 0) | res & (F5 | F3) | ((a & 15) !== 0 ? H : 0) | (a === 128 ? PV : 0) | N | (a !== 0 ? C : 0);
        return { registers: reg, tStates: 8 };
      }
      if ((eop & 199) === 69) {
        const sp = reg.sp & 65535;
        pc = rd(sp) | rd(sp + 1) << 8;
        reg.sp = sp + 2 & 65535;
        reg.iff1 = reg.iff2;
        reg.memptr = pc;
        return { registers: reg, tStates: 14 };
      }
      if ((eop & 199) === 70) {
        reg.im = { 0: 0, 1: 0, 2: 1, 3: 2 }[eop >> 3 & 3];
        return { registers: reg, tStates: 8 };
      }
      if (eop === 71) {
        if (internal) internal(ir(), 1);
        reg.i = reg.a;
        return { registers: reg, tStates: 9 };
      }
      if (eop === 79) {
        if (internal) internal(ir(), 1);
        reg.r = reg.a;
        return { registers: reg, tStates: 9 };
      }
      if (eop === 87 || eop === 95) {
        if (internal) internal(ir(), 1);
        reg.a = (eop === 87 ? reg.i : reg.r) & 255;
        reg.f = reg.f & C | sz53(reg.a) | (reg.iff2 ? PV : 0);
        return { registers: reg, tStates: 9 };
      }
      if (eop === 103 || eop === 111) {
        const addr = getHL(), m = rd(addr);
        reg.memptr = addr + 1 & 65535;
        if (internal) internal(addr, 4);
        if (eop === 103) {
          wr(addr, (reg.a & 15) << 4 | m >> 4);
          reg.a = reg.a & 240 | m & 15;
        } else {
          wr(addr, (m << 4 | reg.a & 15) & 255);
          reg.a = reg.a & 240 | m >> 4;
        }
        reg.f = reg.f & C | sz53p(reg.a);
        return { registers: reg, tStates: 18 };
      }
      if (eop === 160 || eop === 168 || eop === 176 || eop === 184) {
        const dir = eop === 160 || eop === 176 ? 1 : -1;
        const deAddr = get16("d", "e");
        const val = rd(getHL());
        wr(deAddr, val);
        set16("h", "l", getHL() + dir & 65535);
        set16("d", "e", deAddr + dir & 65535);
        const bc = get16("b", "c") - 1 & 65535;
        set16("b", "c", bc);
        const nn = reg.a + val & 255;
        reg.f = reg.f & (C | Z | S) | (bc !== 0 ? PV : 0) | (nn & 2 ? F5 : 0) | (nn & 8 ? F3 : 0);
        const repeating = (eop === 176 || eop === 184) && bc !== 0;
        if (internal) internal(deAddr, repeating ? 7 : 2);
        if (repeating) {
          reg.memptr = pc - 1 & 65535;
          pc = pc - 2 & 65535;
          return { registers: reg, tStates: 21 };
        }
        return { registers: reg, tStates: 16 };
      }
      if (eop === 161 || eop === 169 || eop === 177 || eop === 185) {
        const dir = eop === 161 || eop === 177 ? 1 : -1;
        const hlAddr = getHL();
        const val = rd(hlAddr);
        const res = reg.a - val & 255;
        const hf = (reg.a & 15) - (val & 15) < 0 ? H : 0;
        set16("h", "l", hlAddr + dir & 65535);
        const bc = get16("b", "c") - 1 & 65535;
        set16("b", "c", bc);
        const nn = res - (hf ? 1 : 0) & 255;
        reg.f = reg.f & C | res & S | (res === 0 ? Z : 0) | hf | N | (bc !== 0 ? PV : 0) | (nn & 2 ? F5 : 0) | (nn & 8 ? F3 : 0);
        const repeating = (eop === 177 || eop === 185) && bc !== 0 && res !== 0;
        if (internal) internal(hlAddr, repeating ? 10 : 5);
        if (repeating) {
          reg.memptr = pc - 1 & 65535;
          pc = pc - 2 & 65535;
          return { registers: reg, tStates: 21 };
        }
        reg.memptr = reg.memptr + dir & 65535;
        return { registers: reg, tStates: 16 };
      }
      const reg8 = ["b", "c", "d", "e", "h", "l", null, "a"];
      if ((eop & 199) === 64) {
        const bc = get16("b", "c");
        const val = io.read(bc) & 255;
        const r = eop >> 3 & 7;
        if (r !== 6) reg[reg8[r]] = val;
        reg.f = reg.f & C | sz53p(val);
        reg.memptr = bc + 1 & 65535;
        return { registers: reg, tStates: 12 };
      }
      if ((eop & 199) === 65) {
        const bc = get16("b", "c");
        const r = eop >> 3 & 7;
        io.write(bc, r === 6 ? 0 : reg[reg8[r]]);
        reg.memptr = bc + 1 & 65535;
        return { registers: reg, tStates: 12 };
      }
      if (eop === 162 || eop === 170 || eop === 163 || eop === 171 || eop === 178 || eop === 186 || eop === 179 || eop === 187) {
        if (inexact) inexact();
        const isIn = eop === 162 || eop === 170 || eop === 178 || eop === 186;
        const dir = eop === 162 || eop === 163 || eop === 178 || eop === 179 ? 1 : -1;
        let data, k;
        if (isIn) {
          const bcIo = get16("b", "c");
          data = io.read(bcIo) & 255;
          wr(getHL(), data);
          reg.b = reg.b - 1 & 255;
          set16("h", "l", getHL() + dir & 65535);
          k = data + (reg.c + dir & 255) & 511;
          reg.memptr = bcIo + dir & 65535;
        } else {
          data = rd(getHL());
          reg.b = reg.b - 1 & 255;
          const bcIo = get16("b", "c");
          io.write(bcIo, data);
          set16("h", "l", getHL() + dir & 65535);
          k = data + reg.l & 511;
          reg.memptr = bcIo + dir & 65535;
        }
        const carry = k > 255 ? H | C : 0;
        reg.f = sz53(reg.b) | (data & 128 ? N : 0) | carry | parity((k & 7 ^ reg.b) & 255);
        if ((eop === 178 || eop === 186 || eop === 179 || eop === 187) && reg.b !== 0) {
          pc = pc - 2 & 65535;
          return { registers: reg, tStates: 21 };
        }
        return { registers: reg, tStates: 16 };
      }
      return { registers: reg, tStates: 8 };
    }
  }

  // packages/ula/src/ula-timing.mjs
  var SCAN_LINES = 312;
  var T_STATES_PER_LINE = 224;
  var FRAME_T_STATES = SCAN_LINES * T_STATES_PER_LINE;
  var INTERRUPT_T_STATES = 32;
  function interruptActive(t) {
    const f = (t % FRAME_T_STATES + FRAME_T_STATES) % FRAME_T_STATES;
    return f < INTERRUPT_T_STATES;
  }
  var CONTENDED_LOW = 16384;
  var CONTENDED_HIGH = 32767;
  function isContendedAddress(address) {
    const a = address & 65535;
    return a >= CONTENDED_LOW && a <= CONTENDED_HIGH;
  }
  var CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];
  var CONTENTION_START_T = 14335;
  var DISPLAY_LINES = 192;
  var CONTENDED_T_PER_LINE = 128;
  function contentionDelay(t) {
    const f = (t % FRAME_T_STATES + FRAME_T_STATES) % FRAME_T_STATES;
    const offset = f - CONTENTION_START_T;
    if (offset < 0) return 0;
    const line = Math.floor(offset / T_STATES_PER_LINE);
    if (line >= DISPLAY_LINES) return 0;
    const column = offset % T_STATES_PER_LINE;
    if (column >= CONTENDED_T_PER_LINE) return 0;
    return CONTENTION_PATTERN[column % CONTENTION_PATTERN.length];
  }

  // packages/ula/src/screen-address.mjs
  var DISPLAY_FILE_SIZE = 6144;
  var ATTR_FILE_SIZE = 768;

  // packages/ula/src/scr-format.mjs
  var SCR_SIZE = DISPLAY_FILE_SIZE + ATTR_FILE_SIZE;

  // packages/ula/src/kempston.mjs
  var KEMPSTON_PORT = 31;
  var KEMPSTON_RIGHT = 1;
  var KEMPSTON_LEFT = 2;
  var KEMPSTON_DOWN = 4;
  var KEMPSTON_UP = 8;
  var KEMPSTON_FIRE = 16;
  function kempstonDecodes(port) {
    return (port & 255) === KEMPSTON_PORT;
  }
  function kempstonByte(state = {}) {
    let byte = 0;
    if (state.right) byte |= KEMPSTON_RIGHT;
    if (state.left) byte |= KEMPSTON_LEFT;
    if (state.down) byte |= KEMPSTON_DOWN;
    if (state.up) byte |= KEMPSTON_UP;
    if (state.fire) byte |= KEMPSTON_FIRE;
    return byte;
  }

  // packages/machine/src/interrupt.mjs
  var INT_DATA_BUS = 255;
  var IM01_T_STATES = 13;
  var IM2_T_STATES = 19;
  function acceptInterrupt({ registers, memory, halted = false, dataBus = INT_DATA_BUS }) {
    const reg = registers;
    if (!reg.iff1) {
      return { registers: reg, tStates: 0, accepted: false, halted };
    }
    let pc = reg.pc & 65535;
    if (halted) pc = pc + 1 & 65535;
    reg.iff1 = 0;
    reg.iff2 = 0;
    reg.r = reg.r & 128 | reg.r + 1 & 127;
    const sp = reg.sp - 2 & 65535;
    memory[sp] = pc & 255;
    memory[sp + 1 & 65535] = pc >> 8 & 255;
    reg.sp = sp;
    let tStates;
    if (reg.im === 2) {
      const vector = (reg.i & 255) << 8 | dataBus & 255;
      reg.pc = (memory[vector & 65535] | memory[vector + 1 & 65535] << 8) & 65535;
      tStates = IM2_T_STATES;
    } else {
      reg.pc = 56;
      tStates = IM01_T_STATES;
    }
    return { registers: reg, tStates, accepted: true, halted: false };
  }

  // packages/machine/src/machine.mjs
  var REGISTER_NAMES = [
    "a",
    "f",
    "b",
    "c",
    "d",
    "e",
    "h",
    "l",
    "a_",
    "f_",
    "b_",
    "c_",
    "d_",
    "e_",
    "h_",
    "l_",
    "pc",
    "sp",
    "i",
    "r",
    "iff1",
    "iff2",
    "im",
    "memptr",
    "ixh",
    "ixl",
    "iyh",
    "iyl"
  ];
  var HALT_OPCODE = 118;
  var EI_OPCODE = 251;
  var RESET_REGISTERS = Object.freeze({
    a: 255,
    f: 255,
    b: 255,
    c: 255,
    d: 255,
    e: 255,
    h: 255,
    l: 255,
    a_: 255,
    f_: 255,
    b_: 255,
    c_: 255,
    d_: 255,
    e_: 255,
    h_: 255,
    l_: 255,
    pc: 0,
    sp: 65535,
    i: 0,
    r: 0,
    iff1: 0,
    iff2: 0,
    im: 0,
    memptr: 0,
    ixh: 255,
    ixl: 255,
    iyh: 255,
    iyl: 255
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
    const memory = new Uint8Array(65536);
    if (initial && typeof initial === "object") {
      for (const [address, bytes] of Object.entries(initial)) {
        let pointer = Number(address) & 65535;
        const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
        for (const byte of data) {
          memory[pointer & 65535] = byte & 255;
          pointer += 1;
        }
      }
    }
    return memory;
  }
  function defaultIo() {
    return { read: () => 255, write: () => {
    } };
  }
  function createMachine(options = {}) {
    return new Machine(options);
  }
  var Machine = class {
    constructor({ registers, memory, io, clock = 0, exactContention = false } = {}) {
      this.registers = buildRegisters(registers);
      this.memory = buildMemory(memory);
      this.io = io ?? defaultIo();
      this.clock = (clock % FRAME_T_STATES + FRAME_T_STATES) % FRAME_T_STATES;
      this.exactContention = Boolean(exactContention);
      this.halted = false;
      this.eiDelay = 0;
      this.tStatesTotal = 0;
      this.frames = 0;
    }
    // Power-on / reset: restore the documented reset state (MACHINE-RESET-001) —
    // the Z80 control registers cleared, the rest of the register file all-bits-set,
    // RAM all-zero, the frame clock at 0, and not halted. Run totals are cleared too.
    reset() {
      this.registers = { ...RESET_REGISTERS };
      this.memory = new Uint8Array(65536);
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
        }
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
        inexact() {
          this.incomplete = true;
        },
        total() {
          return this.incomplete ? this.perAccessExtra : this.extra;
        }
      };
    }
    // Execute exactly one instruction with contention threaded. Advances the clock
    // by the real (uncontended + contention) duration and tracks the HALT state.
    // Does NOT sample interrupts — that is the frame loop's job
    // (MACHINE-INT-SAMPLE-001 fixes interrupt sampling to boundaries it controls).
    stepInstruction() {
      const reg = this.registers;
      const pcBefore = reg.pc & 65535;
      const opcode = this.memory[pcBefore];
      const clock = this.exactContention ? this._exactClock(this.clock) : this._contentionClock(this.clock);
      const result = step({ registers: reg, memory: this.memory, io: this.io, clock });
      this.registers = result.registers;
      const contention = this.exactContention ? clock.total() : clock.extra;
      const tStates = result.tStates + contention;
      this.clock = (this.clock + tStates) % FRAME_T_STATES;
      this.tStatesTotal += tStates;
      this.halted = opcode === HALT_OPCODE && (this.registers.pc & 65535) === pcBefore;
      return { tStates, contention, halted: this.halted };
    }
    // Accept the pending maskable interrupt (caller has verified the conditions).
    _acceptInterrupt(dataBus = INT_DATA_BUS) {
      const result = acceptInterrupt({
        registers: this.registers,
        memory: this.memory,
        halted: this.halted,
        dataBus
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
      const budget = FRAME_T_STATES - this.clock;
      let elapsed = 0;
      while (elapsed < budget) {
        if (!intTaken && this._interruptArmed() && interruptActive(this.clock)) {
          const before2 = this.tStatesTotal;
          this._acceptInterrupt(dataBus);
          elapsed += this.tStatesTotal - before2;
          accepted += 1;
          intTaken = true;
          continue;
        }
        const wasEi = this.memory[this.registers.pc & 65535] === EI_OPCODE;
        if (this.eiDelay > 0) this.eiDelay -= 1;
        const before = this.tStatesTotal;
        this.stepInstruction();
        elapsed += this.tStatesTotal - before;
        if (wasEi) this.eiDelay = 1;
      }
      this.frames += 1;
      return { tStates: this.tStatesTotal - start, accepted };
    }
  };

  // packages/machine/src/snapshot-z80.mjs
  var PAGE_TO_BASE = { 8: 16384, 4: 32768, 5: 49152 };
  function decompressZ80(bytes, expectedLength) {
    const out = [];
    let i = 0;
    while (i < bytes.length && (expectedLength === void 0 || out.length < expectedLength)) {
      if (bytes[i] === 237 && bytes[i + 1] === 237) {
        const count = bytes[i + 2];
        const value = bytes[i + 3];
        for (let k = 0; k < count; k += 1) out.push(value);
        i += 4;
      } else {
        out.push(bytes[i]);
        i += 1;
      }
    }
    return Uint8Array.from(out);
  }
  var word = (lo, hi) => lo & 255 | (hi & 255) << 8;
  function readZ80(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const registers = {
      a: b[0],
      f: b[1],
      c: b[2],
      b: b[3],
      l: b[4],
      h: b[5],
      sp: word(b[8], b[9]),
      i: b[10],
      r: b[11] & 127 | (b[12] & 1) << 7,
      e: b[13],
      d: b[14],
      c_: b[15],
      b_: b[16],
      e_: b[17],
      d_: b[18],
      l_: b[19],
      h_: b[20],
      a_: b[21],
      f_: b[22],
      iyl: b[23],
      iyh: b[24],
      ixl: b[25],
      ixh: b[26],
      iff1: b[27] ? 1 : 0,
      iff2: b[28] ? 1 : 0,
      im: b[29] & 3
    };
    const border = b[12] >> 1 & 7;
    const memory = new Uint8Array(65536);
    const v1pc = word(b[6], b[7]);
    if (v1pc !== 0) {
      registers.pc = v1pc;
      const compressed = ((b[12] === 255 ? 1 : b[12]) & 32) !== 0;
      const body = b.subarray(30);
      const ram = compressed ? decompressZ80(stripV1End(body), 49152) : body.subarray(0, 49152);
      memory.set(ram.subarray(0, 49152), 16384);
      return { registers, memory, border, version: 1 };
    }
    const extraLen = word(b[30], b[31]);
    registers.pc = word(b[32], b[33]);
    const version = extraLen === 23 ? 2 : 3;
    let off = 30 + 2 + extraLen;
    while (off + 3 <= b.length) {
      const len = word(b[off], b[off + 1]);
      const page = b[off + 2];
      off += 3;
      const base = PAGE_TO_BASE[page];
      const uncompressed = len === 65535;
      const blockLen = uncompressed ? 16384 : len;
      const slice = b.subarray(off, off + blockLen);
      off += blockLen;
      if (base === void 0) continue;
      const ram = uncompressed ? slice : decompressZ80(slice, 16384);
      memory.set(ram.subarray(0, 16384), base);
    }
    return { registers, memory, border, version };
  }
  function stripV1End(body) {
    const n = body.length;
    if (n >= 4 && body[n - 4] === 0 && body[n - 3] === 237 && body[n - 2] === 237 && body[n - 1] === 0) {
      return body.subarray(0, n - 4);
    }
    return body;
  }

  // packages/machine/src/tap-format.mjs
  function tapChecksum(flag, data) {
    let checksum = flag & 255;
    for (let i = 0; i < data.length; i += 1) {
      checksum ^= data[i] & 255;
    }
    return checksum & 255;
  }
  function parseTap(bytes) {
    const file = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const blocks = [];
    let offset = 0;
    while (offset < file.length) {
      if (offset + 2 > file.length) {
        throw new Error(`parseTap: truncated length prefix at offset ${offset}`);
      }
      const length = file[offset] | file[offset + 1] << 8;
      const bodyStart = offset + 2;
      const bodyEnd = bodyStart + length;
      if (length < 2) {
        throw new Error(`parseTap: block at offset ${offset} has length ${length} < 2 (no room for flag + checksum)`);
      }
      if (bodyEnd > file.length) {
        throw new Error(`parseTap: block at offset ${offset} runs past end of file (need ${bodyEnd}, have ${file.length})`);
      }
      const flag = file[bodyStart];
      const data = file.slice(bodyStart + 1, bodyEnd - 1);
      const checksum = file[bodyEnd - 1];
      const computed = tapChecksum(flag, data);
      if (computed !== checksum) {
        throw new Error(`parseTap: block at offset ${offset} checksum mismatch (stored 0x${checksum.toString(16)}, computed 0x${computed.toString(16)})`);
      }
      blocks.push({ flag, data, checksum });
      offset = bodyEnd;
    }
    return blocks;
  }

  // packages/machine/src/tzx-format.mjs
  var SIGNATURE_BYTES = Uint8Array.from([90, 88, 84, 97, 112, 101, 33]);

  // packages/machine/src/tape-pulses.mjs
  var PILOT_PULSE_T = 2168;
  var PILOT_PULSES_HEADER = 8063;
  var PILOT_PULSES_DATA = 3223;
  var SYNC1_T = 667;
  var SYNC2_T = 735;
  var BIT0_PULSE_T = 855;
  var BIT1_PULSE_T = 1710;
  var HEADER_FLAG_MAX = 128;
  function blockToPulses(bytes) {
    const body = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    if (body.length === 0) {
      throw new Error("blockToPulses: empty block body (need at least a flag byte)");
    }
    const flag = body[0] & 255;
    const pilotCount = flag < HEADER_FLAG_MAX ? PILOT_PULSES_HEADER : PILOT_PULSES_DATA;
    const pulses = new Array(pilotCount + 2 + body.length * 16);
    let i = 0;
    for (let p = 0; p < pilotCount; p += 1) pulses[i++] = PILOT_PULSE_T;
    pulses[i++] = SYNC1_T;
    pulses[i++] = SYNC2_T;
    for (let b = 0; b < body.length; b += 1) {
      const byte = body[b] & 255;
      for (let bit = 7; bit >= 0; bit -= 1) {
        const length = byte >> bit & 1 ? BIT1_PULSE_T : BIT0_PULSE_T;
        pulses[i++] = length;
        pulses[i++] = length;
      }
    }
    return pulses;
  }

  // packages/machine/src/tape-edge-load.mjs
  function createTapeDeck(pulses, { clock, startLevel = 0, keyboard = 31 } = {}) {
    if (typeof clock !== "function") {
      throw new Error("createTapeDeck: a clock() returning the tape T-state cursor is required");
    }
    const durations = pulses instanceof Uint16Array || pulses instanceof Array ? pulses : Array.from(pulses ?? []);
    const ends = new Array(durations.length);
    let acc = 0;
    for (let i = 0; i < durations.length; i += 1) {
      acc += durations[i];
      ends[i] = acc;
    }
    const total = acc;
    const start = startLevel & 1;
    let idleLevel = start;
    function levelAt(t) {
      if (durations.length === 0 || t >= total) return idleLevel;
      let lo = 0;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = lo + hi >> 1;
        if (ends[mid] > t) hi = mid;
        else lo = mid + 1;
      }
      return (start ^ lo & 1) & 1;
    }
    return {
      levelAt,
      total,
      read(port) {
        if ((port & 1) !== 0) return 255;
        const level = levelAt(clock());
        return (keyboard & 31 | 160 | (level ? 64 : 0)) & 255;
      },
      write(port, value) {
        if ((port & 1) === 0) idleLevel = value >> 4 & 1;
      }
    };
  }

  // examples/tooling/rom-data.generated.mjs
  var ROM_BASE64 = "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DzjJ7yKjAxs4ye8xMAAeojjvATEwAAclBDjDxDYCMTAACaABNwAGoQEFAqE4yf///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAAAAAAAAABAQEBAAEAAAJCQAAAAAAAAkfiQkfiQAAAg+KD4KPggAYmQIECZGAAAQKBAqRDoAAAgQAAAAAAAABAgICAgEAAAgEBAQECAAAAAUCD4IFAAAAAgIPggIAAAAAAAACAgQAAAAAD4AAAAAAAAAABgYAAAAAgQIECAAADxGSlJiPAAAGCgICAg+AAA8QgI8QH4AADxCDAJCPAAACBgoSH4IAAB+QHwCQjwAADxAfEJCPAAAfgIECBAQAAA8QjxCQjwAADxCQj4CPAAAAAAQAAAQAAAAEAAAEBAgAAAECBAIBAAAAAA+AD4AAAAAEAgECBAAADxCBAgACAAAPEpWXkA8AAA8QkJ+QkIAAHxCfEJCfAAAPEJAQEI8AAB4REJCRHgAAH5AfEBAfgAAfkB8QEBAAAA8QkBOQjwAAEJCfkJCQgAAPggICAg+AAACAgJCQjwAAERIcEhEQgAAQEBAQEB+AABCZlpCQkIAAEJiUkpGQgAAPEJCQkI8AAB8QkJ8QEAAADxCQlJKPAAAfEJCfERCAAA8QDwCQjwAAP4QEBAQEAAAQkJCQkI8AABCQkJCJBgAAEJCQkJaJAAAQiQYGCRCAACCRCgQEBAAAH4ECBAgfgAADggICAgOAAAAQCAQCAQAAHAQEBAQcAAAEDhUEBAQAAAAAAAAAAD/ABwieCAgfgAAADgEPEQ8AAAgIDwiIjwAAAAcICAgHAAABAQ8REQ8AAAAOER4QDwAAAwQGBAQEAAAADxERDwEOABAQHhEREQAABAAMBAQOAAABAAEBAQkGAAgKDAwKCQAABAQEBAQDAAAAGhUVFRUAAAAeEREREQAAAA4REREOAAAAHhERHhAQAAAPEREPAQGAAAcICAgIAAAADhAOAR4AAAQOBAQEAwAAABEREREOAAAAEREKCgQAAAARFRUVCgAAABEKBAoRAAAAERERDwEOAAAfAgQIHwAAA4IMAgIDgAACAgICAgIAABwEAwQEHAAABQoAAAAAAA8QpmhoZlCPA==";

  // examples/tooling/render.mjs
  var PALETTE_RGB = [
    [0, 0, 0],
    [0, 0, 205],
    [205, 0, 0],
    [205, 0, 205],
    [0, 205, 0],
    [0, 205, 205],
    [205, 205, 0],
    [205, 205, 205],
    [0, 0, 0],
    [0, 0, 255],
    [255, 0, 0],
    [255, 0, 255],
    [0, 255, 0],
    [0, 255, 255],
    [255, 255, 0],
    [255, 255, 255]
  ];
  var FRAME_WIDTH = 256;
  var FRAME_HEIGHT = 192;
  var BORDER_X = 32;
  var BORDER_Y = 24;
  var OUT_WIDTH = FRAME_WIDTH + BORDER_X * 2;
  var OUT_HEIGHT = FRAME_HEIGHT + BORDER_Y * 2;
  var T_PER_LINE = 224;
  var DISPLAY_START_T = 14336;
  var BORDER_TOP_T = DISPLAY_START_T - BORDER_Y * T_PER_LINE;
  function displayOffset(x, y) {
    return ((y & 192) << 5) + ((y & 7) << 8) + ((y & 56) << 2) + (x >> 3);
  }
  function attributeOffset(x, y) {
    return 6144 + (y >> 3) * 32 + (x >> 3);
  }
  function flashPhase(frame) {
    return frame >> 4 & 1;
  }
  function pixelIndex(image, x, y, phase) {
    const displayByte = image[displayOffset(x, y)] ?? 0;
    const pixelOn = displayByte >> 7 - (x & 7) & 1;
    const attr = image[attributeOffset(x, y)] ?? 0;
    const ink = attr & 7;
    const paper = attr >> 3 & 7;
    const bright = attr >> 6 & 1;
    const flash = attr >> 7 & 1;
    const lit = flash && phase ? !pixelOn : Boolean(pixelOn);
    return (lit ? ink : paper) + (bright ? 8 : 0);
  }
  function borderRowsFromLog(log, carryIn = 7, rows) {
    const out = rows ?? new Uint8Array(OUT_HEIGHT);
    let cursor = 0;
    let colour = carryIn & 7;
    for (let y = 0; y < OUT_HEIGHT; y += 1) {
      const rowStart = BORDER_TOP_T + y * T_PER_LINE;
      while (cursor + 1 < log.length && log[cursor] <= rowStart) {
        colour = log[cursor + 1] & 7;
        cursor += 2;
      }
      out[y] = colour;
    }
    return out;
  }
  function renderWithBorderRows(image, borderRows, frame = 0, out) {
    const data = out ?? new Uint8ClampedArray(OUT_WIDTH * OUT_HEIGHT * 4);
    for (let y = 0; y < OUT_HEIGHT; y += 1) {
      const [br, bg, bb] = PALETTE_RGB[borderRows[y] & 7];
      let di = y * OUT_WIDTH * 4;
      for (let x = 0; x < OUT_WIDTH; x += 1) {
        data[di] = br;
        data[di + 1] = bg;
        data[di + 2] = bb;
        data[di + 3] = 255;
        di += 4;
      }
    }
    const phase = flashPhase(frame);
    for (let y = 0; y < FRAME_HEIGHT; y += 1) {
      const rowBase = ((y + BORDER_Y) * OUT_WIDTH + BORDER_X) * 4;
      for (let x = 0; x < FRAME_WIDTH; x += 1) {
        const rgb = PALETTE_RGB[pixelIndex(image, x, y, phase)];
        const di = rowBase + x * 4;
        data[di] = rgb[0];
        data[di + 1] = rgb[1];
        data[di + 2] = rgb[2];
        data[di + 3] = 255;
      }
    }
    return data;
  }

  // examples/tooling/keyboard.mjs
  var KEY_MATRIX = {
    CAPS: [0, 0],
    Z: [0, 1],
    X: [0, 2],
    C: [0, 3],
    V: [0, 4],
    A: [1, 0],
    S: [1, 1],
    D: [1, 2],
    F: [1, 3],
    G: [1, 4],
    Q: [2, 0],
    W: [2, 1],
    E: [2, 2],
    R: [2, 3],
    T: [2, 4],
    1: [3, 0],
    2: [3, 1],
    3: [3, 2],
    4: [3, 3],
    5: [3, 4],
    0: [4, 0],
    9: [4, 1],
    8: [4, 2],
    7: [4, 3],
    6: [4, 4],
    P: [5, 0],
    O: [5, 1],
    I: [5, 2],
    U: [5, 3],
    Y: [5, 4],
    ENTER: [6, 0],
    L: [6, 1],
    K: [6, 2],
    J: [6, 3],
    H: [6, 4],
    SPACE: [7, 0],
    SYM: [7, 1],
    M: [7, 2],
    N: [7, 3],
    B: [7, 4]
  };
  function keyboardMatrixByte(pressed, highByte) {
    let result = 31;
    for (const key of pressed) {
      const cell = KEY_MATRIX[key];
      if (!cell) continue;
      const [row, bit] = cell;
      if ((highByte >> row & 1) === 0) result &= ~(1 << bit) & 31;
    }
    return result;
  }
  var SYMBOL_KEYS = {
    "!": ["SYM", "1"],
    "@": ["SYM", "2"],
    "#": ["SYM", "3"],
    $: ["SYM", "4"],
    "%": ["SYM", "5"],
    "&": ["SYM", "6"],
    "'": ["SYM", "7"],
    "(": ["SYM", "8"],
    ")": ["SYM", "9"],
    _: ["SYM", "0"],
    '"': ["SYM", "P"],
    ";": ["SYM", "O"],
    ":": ["SYM", "Z"],
    ",": ["SYM", "N"],
    ".": ["SYM", "M"],
    "=": ["SYM", "L"],
    "+": ["SYM", "K"],
    "-": ["SYM", "J"],
    "*": ["SYM", "B"],
    "/": ["SYM", "V"],
    "?": ["SYM", "C"],
    "<": ["SYM", "R"],
    ">": ["SYM", "T"],
    "^": ["SYM", "H"],
    "\xA3": ["SYM", "X"]
  };
  function charToKeys(char) {
    return SYMBOL_KEYS[char] ?? null;
  }
  var CODE_MAP = {
    Enter: ["ENTER"],
    NumpadEnter: ["ENTER"],
    Space: ["SPACE"],
    ShiftLeft: ["CAPS"],
    ShiftRight: ["CAPS"],
    ControlLeft: ["SYM"],
    ControlRight: ["SYM"],
    AltRight: ["SYM"],
    Backspace: ["CAPS", "0"],
    // DELETE
    ArrowLeft: ["CAPS", "5"],
    ArrowDown: ["CAPS", "6"],
    ArrowUp: ["CAPS", "7"],
    ArrowRight: ["CAPS", "8"]
  };
  function browserCodeToKeys(code) {
    if (CODE_MAP[code]) return CODE_MAP[code];
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return [letter[1]];
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (digit) return [digit[1]];
    return null;
  }
  function resolveMatrix(held) {
    const set = /* @__PURE__ */ new Set();
    const entries = [...held];
    let symbolActive = false;
    for (const [, key] of entries) {
      if (key && key.length === 1 && SYMBOL_KEYS[key]) {
        for (const k of SYMBOL_KEYS[key]) set.add(k);
        symbolActive = true;
      }
    }
    for (const [code, key] of entries) {
      if (key && key.length === 1 && SYMBOL_KEYS[key]) continue;
      const byCode = browserCodeToKeys(code);
      if (!byCode) continue;
      for (const k of byCode) {
        if (k === "CAPS" && symbolActive && (code === "ShiftLeft" || code === "ShiftRight")) continue;
        set.add(k);
      }
    }
    return set;
  }

  // examples/tooling/audio.mjs
  var FRAME_T_STATES2 = 69888;
  function beeperSamples(log, carryLevel = 0, count = 882, amp = 0.18, out) {
    const data = out ?? new Float32Array(count);
    const span = FRAME_T_STATES2 / count;
    let cursor = 0;
    let level = carryLevel || 0;
    for (let i = 0; i < count; i += 1) {
      const w0 = i * span;
      const w1 = w0 + span;
      let pos = w0;
      let high = 0;
      while (cursor + 1 < log.length && log[cursor] < w1) {
        const edgeT = log[cursor];
        if (edgeT > pos) {
          high += level * (edgeT - pos);
          pos = edgeT;
        }
        level = log[cursor + 1];
        cursor += 2;
      }
      high += level * (w1 - pos);
      data[i] = amp * (2 * (high / span) - 1);
    }
    return data;
  }

  // examples/tooling/browser-entry.mjs
  var T_PER_MS = 3500;
  var GAP_T = 1e3 * T_PER_MS;
  function pushBits(out, data, zeroLen, oneLen, usedBits) {
    for (let i = 0; i < data.length; i += 1) {
      const byte = data[i] & 255;
      const bits = i === data.length - 1 && usedBits ? usedBits : 8;
      for (let b = 7; b >= 8 - bits; b -= 1) {
        const len = byte >> b & 1 ? oneLen : zeroLen;
        out.push(len, len);
      }
    }
  }
  function tapToPulses(bytes) {
    const pulses = [GAP_T];
    for (const { flag, data } of parseTap(bytes)) {
      const body = Uint8Array.from([flag, ...data, tapChecksum(flag, data)]);
      for (const p of blockToPulses(body)) pulses.push(p);
      pulses.push(GAP_T);
    }
    return pulses;
  }
  function tzxToPulses(bytes) {
    const u8 = (o) => bytes[o] & 255;
    const u16 = (o) => (bytes[o] | bytes[o + 1] << 8) & 65535;
    const u24 = (o) => bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16;
    const u32 = (o) => (bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16 | bytes[o + 3] << 24) >>> 0;
    const pulses = [GAP_T];
    const pausePulse = (ms) => pulses.push(Math.max(ms, 1) * T_PER_MS);
    let i = 10;
    let loopStart = -1;
    let loopLeft = 0;
    while (i < bytes.length) {
      const id = u8(i);
      i += 1;
      switch (id) {
        case 16: {
          const pause = u16(i);
          const len = u16(i + 2);
          for (const p of blockToPulses(bytes.subarray(i + 4, i + 4 + len))) pulses.push(p);
          i += 4 + len;
          pausePulse(pause);
          break;
        }
        case 17: {
          const pilot = u16(i), sync1 = u16(i + 2), sync2 = u16(i + 4);
          const zero = u16(i + 6), one = u16(i + 8), pilotPulses = u16(i + 10);
          const usedBits = u8(i + 12), pause = u16(i + 13), len = u24(i + 15);
          for (let p = 0; p < pilotPulses; p += 1) pulses.push(pilot);
          pulses.push(sync1, sync2);
          pushBits(pulses, bytes.subarray(i + 18, i + 18 + len), zero, one, usedBits);
          i += 18 + len;
          pausePulse(pause);
          break;
        }
        case 18: {
          const len = u16(i), count = u16(i + 2);
          for (let p = 0; p < count; p += 1) pulses.push(len);
          i += 4;
          break;
        }
        case 19: {
          const count = u8(i);
          for (let p = 0; p < count; p += 1) pulses.push(u16(i + 1 + 2 * p));
          i += 1 + 2 * count;
          break;
        }
        case 20: {
          const zero = u16(i), one = u16(i + 2), usedBits = u8(i + 4);
          const pause = u16(i + 5), len = u24(i + 7);
          pushBits(pulses, bytes.subarray(i + 10, i + 10 + len), zero, one, usedBits);
          i += 10 + len;
          pausePulse(pause);
          break;
        }
        case 21: {
          const tps = u16(i), pause = u16(i + 2), usedBits = u8(i + 4), len = u24(i + 5);
          const data = bytes.subarray(i + 8, i + 8 + len);
          i += 8 + len;
          const bits = len > 0 ? (len - 1) * 8 + (usedBits || 8) : 0;
          let run = 0, prev = -1;
          for (let b = 0; b < bits; b += 1) {
            const bit = data[b >> 3] >> 7 - (b & 7) & 1;
            if (bit === prev) run += 1;
            else {
              if (run) pulses.push(run * tps);
              prev = bit;
              run = 1;
            }
          }
          if (run) pulses.push(run * tps);
          pausePulse(pause);
          break;
        }
        case 32: {
          const pause = u16(i);
          i += 2;
          pulses.push(pause > 0 ? pause * T_PER_MS : GAP_T);
          break;
        }
        case 33:
          i += 1 + u8(i);
          break;
        // group start (name) — metadata
        case 34:
          break;
        // group end
        case 35:
          i += 2;
          break;
        // jump — control flow not modelled
        case 36:
          loopLeft = u16(i);
          i += 2;
          loopStart = i;
          break;
        // loop start
        case 37:
          if (loopLeft > 1) {
            loopLeft -= 1;
            i = loopStart;
          } else {
            loopLeft = 0;
            loopStart = -1;
          }
          break;
        case 38:
          i += 2 + 2 * u16(i);
          break;
        // call sequence — not modelled
        case 39:
          break;
        // return from sequence
        case 40:
          i += 2 + u16(i);
          break;
        // select — interactive metadata
        case 48:
          i += 1 + u8(i);
          break;
        // text description
        case 49:
          i += 2 + u8(i + 1);
          break;
        // message (display time + text)
        case 50:
          i += 2 + u16(i);
          break;
        // archive info
        case 51:
          i += 1 + 3 * u8(i);
          break;
        // hardware type (3 bytes per entry)
        case 52:
          i += 8;
          break;
        // emulation info (deprecated, fixed 8)
        case 53:
          i += 20 + u32(i + 16);
          break;
        // custom info (16-char id + DWORD len)
        case 64:
          i += 4 + u24(i + 1);
          break;
        // snapshot (deprecated: type + 3-byte len)
        case 90:
          i += 9;
          break;
        // glue (a concatenated TZX header)
        default:
          i += 4 + u32(i);
          break;
      }
    }
    return pulses;
  }
  function tapeFileToPulses(bytes) {
    const isTzx = bytes.length >= 7 && bytes[0] === 90 && bytes[1] === 88 && bytes[2] === 84 && bytes[3] === 97 && bytes[4] === 112 && bytes[5] === 101 && bytes[6] === 33;
    return isTzx ? tzxToPulses(bytes) : tapToPulses(bytes);
  }
  var SCREEN_BASE = 16384;
  var SCREEN_SIZE = 6912;
  var LINE_T_STATES = 224;
  var DISPLAY_START_T2 = 64 * LINE_T_STATES;
  var RING_SIZE = 1 << 14;
  var AMP = 0.18;
  var TAPE_AMP = 0.14;
  var WORKLET_SRC = `
class ZXBeeperProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(${RING_SIZE});
    this.read = 0;
    this.write = 0;
    this.last = 0;
    this.starved = false;
    this.quanta = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d instanceof Float32Array) {
        const mask = this.ring.length - 1;
        for (let i = 0; i < d.length; i += 1) {
          const next = (this.write + 1) & mask;
          if (next === this.read) break; // full -> drop the rest (bound latency)
          this.ring[this.write] = d[i];
          this.write = next;
        }
      } else if (d && d.flush) {
        this.read = this.write;
        if (d.level !== undefined) this.last = d.level;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const mask = this.ring.length - 1;
    for (let i = 0; i < out.length; i += 1) {
      if (this.read !== this.write) {
        this.last = this.ring[this.read];
        this.read = (this.read + 1) & mask;
      } else {
        this.starved = true;
      }
      out[i] = this.last;
    }
    this.quanta += 1;
    if (this.quanta >= 8) {
      this.quanta = 0;
      this.port.postMessage({ fill: (this.write - this.read) & mask, starved: this.starved });
      this.starved = false;
    }
    return true;
  }
}
registerProcessor('zx-beeper', ZXBeeperProcessor);
`;
  function romBootMemory() {
    const bin = atob(ROM_BASE64);
    const memory = new Uint8Array(65536);
    for (let i = 0; i < bin.length; i += 1) memory[i] = bin.charCodeAt(i);
    return memory;
  }
  var Spectrum = class {
    constructor() {
      this.pressed = /* @__PURE__ */ new Set();
      this.border = 7;
      this.earLevel = 0;
      this.frames = 0;
      this._raf = 0;
      this._frameT0 = 0;
      this._borderLog = [];
      this._borderRows = new Uint8Array(OUT_HEIGHT);
      this._beeperLog = [];
      this._audioLevel = 0;
      this._held = /* @__PURE__ */ new Map();
      this._audioCtx = null;
      this._node = null;
      this._sound = true;
      this._ring = null;
      this._ringRead = 0;
      this._ringWrite = 0;
      this._ringLast = 0;
      this._worklet = null;
      this._workletFill = 0;
      this._chunk = 4096;
      this._audioTarget = 0;
      this._scratch = null;
      this._fillAvg = 0;
      this._starved = false;
      this._joy = { up: false, down: false, left: false, right: false, fire: false };
      this._tapeDeck = null;
      this._tapeTotal = 0;
      this._tapePlaying = false;
      this._tapeStartT = 0;
      this._tapeName = "";
      const io = {
        read: (port) => {
          if (kempstonDecodes(port)) return kempstonByte(this._joy);
          if ((port & 1) === 0) {
            const keys = keyboardMatrixByte(this.pressed, port >> 8 & 255);
            let earBit = this.earLevel ? 64 : 0;
            if (this._tapePlaying && this._tapeDeck) {
              const t = this.machine.tStatesTotal - this._tapeStartT;
              if (t >= 0 && t < this._tapeTotal) earBit = this._tapeDeck.levelAt(t) ? 64 : 0;
              else if (t >= this._tapeTotal) this._tapePlaying = false;
            }
            return keys & 31 | 160 | earBit;
          }
          return this._floatingBus();
        },
        write: (port, value) => {
          if ((port & 1) === 0) {
            const frameT = this.machine.tStatesTotal - this._frameT0;
            const colour = value & 7;
            if (colour !== this.border) {
              this._borderLog.push(frameT, colour);
              this.border = colour;
            }
            this.earLevel = value >> 4 & 1;
            const audio = 0.8 * this.earLevel + 0.2 * (value >> 3 & 1);
            if (audio !== this._audioLevel) {
              this._beeperLog.push(frameT, audio);
              this._audioLevel = audio;
            }
          }
        }
      };
      this.machine = createMachine({
        memory: romBootMemory(),
        registers: { ...RESET_REGISTERS },
        io
      });
    }
    // What an IN from a port nobody decodes actually reads: the data bus is left
    // floating, so the Z80 sees whatever byte the ULA is fetching for the display
    // at that instant (0xFF in border/idle slots, when the ULA isn't fetching).
    // Ocean/Imagine games (Cobra, Arkanoid, Short Circuit...) spin on IN A,(0xFF)
    // until a known attribute byte drifts past to sync with the beam — with a hard
    // 0xFF here they hang at the start of play. Fetch pattern within each 8 T of
    // the visible 128 T of a line: bitmap N, attr N, bitmap N+1, attr N+1, 4 idle.
    _floatingBus() {
      const t = this.machine.tStatesTotal - this._frameT0 - DISPLAY_START_T2;
      if (t < 0) return 255;
      const line = t / LINE_T_STATES | 0;
      const lineT = t % LINE_T_STATES;
      if (line >= 192 || lineT >= 128) return 255;
      const phase = lineT & 7;
      if (phase > 3) return 255;
      const col = lineT >> 3 << 1 | phase >> 1;
      const mem = this.machine.memory;
      if (phase & 1) return mem[22528 | line >> 3 << 5 | col];
      return mem[SCREEN_BASE | (line & 192) << 5 | (line & 7) << 8 | (line & 56) << 2 | col];
    }
    /** Restart from a clean power-on. */
    reset() {
      this.stop();
      this.pressed.clear();
      this._held.clear();
      this.frames = 0;
      this.border = 7;
      this.earLevel = 0;
      this._audioLevel = 0;
      this._borderLog.length = 0;
      this._beeperLog.length = 0;
      this._tapePlaying = false;
      this._joy = { up: false, down: false, left: false, right: false, fire: false };
      if (this._node) this._primeRing(0);
      this.machine.memory = romBootMemory();
      this.machine.registers = { ...RESET_REGISTERS };
      this.machine.clock = 0;
      this.machine.halted = false;
      return this;
    }
    /**
     * Insert a `.tap` or `.tzx` image (container auto-detected). Builds its EAR pulse
     * stream; call `playTape()` to start it, then LOAD "" on the machine.
     */
    insertTape(bytes, { name = "" } = {}) {
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const pulses = tapeFileToPulses(arr);
      this._tapeDeck = createTapeDeck(pulses, { clock: () => 0 });
      this._tapeTotal = this._tapeDeck.total;
      this._tapePlaying = false;
      this._tapeName = name;
      return this;
    }
    /** Start (or rewind and start) tape playback from the current machine time. */
    playTape() {
      if (!this._tapeDeck) return this;
      this._tapeStartT = this.machine.tStatesTotal;
      this._tapePlaying = true;
      return this;
    }
    /** Pause playback (bit 6 falls back to the idle EAR level). */
    stopTape() {
      this._tapePlaying = false;
      return this;
    }
    /** Remove the tape entirely. */
    ejectTape() {
      this._tapeDeck = null;
      this._tapePlaying = false;
      this._tapeName = "";
      return this;
    }
    /** True while the tape is streaming (auto-clears when it reaches the end). */
    isTapePlaying() {
      return this._tapePlaying;
    }
    /** Playback position as 0..1 (0 with no tape or when stopped). */
    tapeProgress() {
      if (!this._tapeDeck || !this._tapePlaying || this._tapeTotal === 0) return 0;
      const t = this.machine.tStatesTotal - this._tapeStartT;
      return Math.max(0, Math.min(1, t / this._tapeTotal));
    }
    /** Set the Kempston joystick state: any of { up, down, left, right, fire }. */
    setJoystick(state = {}) {
      this._joy = {
        up: Boolean(state.up),
        down: Boolean(state.down),
        left: Boolean(state.left),
        right: Boolean(state.right),
        fire: Boolean(state.fire)
      };
      return this;
    }
    /**
     * Load a `.z80` snapshot: restore the register file, the 48K RAM and the border in one
     * shot (the ROM is kept in place). Unlike a tape, a snapshot is instant — the machine
     * resumes exactly where the snapshot was frozen, so the program is already running.
     */
    loadSnapshot(bytes) {
      const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const snap = readZ80(arr);
      const memory = romBootMemory();
      memory.set(snap.memory.subarray(16384), 16384);
      this.stop();
      this.machine.memory = memory;
      this.machine.registers = { ...snap.registers };
      this.machine.clock = 0;
      this.machine.halted = false;
      this.border = snap.border;
      this.earLevel = 0;
      this._audioLevel = 0;
      this._borderLog.length = 0;
      this._beeperLog.length = 0;
      this._borderRows.fill(snap.border);
      this._tapePlaying = false;
      this.pressed.clear();
      this._held.clear();
      if (this._node) this._primeRing(0);
      return this;
    }
    /**
     * Fast (flash) tape load: reboot, type LOAD "", then run the emulation as fast as the
     * CPU allows until the tape stream ends — same real ROM load, no real-time wait. Async:
     * it fast-forwards in chunks, yielding between them so the page keeps painting (screen,
     * progress bar) and stays responsive even for a full multi-minute game tape. Resolves
     * when the load is done. Use for `.tap`/`.tzx`.
     */
    async fastLoadTape(bytes, { name = "" } = {}) {
      const wasRunning = Boolean(this._raf);
      this.stop();
      this.reset();
      const step2 = (n) => {
        for (let i = 0; i < n; i += 1) this._advanceQuiet();
      };
      const tap = (keys) => {
        this.pressed.clear();
        for (const k of keys) this.pressed.add(k);
        step2(4);
        this.pressed.clear();
        step2(8);
      };
      step2(100);
      tap(["CAPS"]);
      for (const k of [["J"], ["SYM", "P"], ["SYM", "P"], ["ENTER"]]) tap(k);
      this.insertTape(bytes, { name });
      this.playTape();
      const budget = Math.ceil(this._tapeTotal / FRAME_T_STATES2) + 500;
      let done = 0;
      while (this._tapePlaying && done < budget) {
        for (let i = 0; i < 100 && this._tapePlaying && done < budget; i += 1) {
          this._advanceQuiet();
          done += 1;
        }
        if (this.ctx) this._present();
        await new Promise((r) => setTimeout(r, 0));
      }
      this._tapePlaying = false;
      step2(50);
      this.pressed.clear();
      if (this._node) this._primeRing(this._audioLevel);
      if (this.ctx) this._present();
      if (wasRunning) this.start();
      return this;
    }
    /** Bind a <canvas> for rendering and (unless opted out) host-keyboard input. */
    attach(canvas, { keyboard = true, sound = true, target = window } = {}) {
      this.canvas = canvas;
      canvas.width = OUT_WIDTH;
      canvas.height = OUT_HEIGHT;
      this.ctx = canvas.getContext("2d");
      this.image = this.ctx.createImageData(OUT_WIDTH, OUT_HEIGHT);
      this._sound = sound;
      if (keyboard) {
        this._onDown = (e) => this._keyDown(e);
        this._onUp = (e) => this._keyUp(e);
        target.addEventListener("keydown", this._onDown);
        target.addEventListener("keyup", this._onUp);
        this._keyTarget = target;
      }
      return this;
    }
    // Rebuild the pressed-key set from all currently-held host keys. Doing this on
    // every event (rather than add/remove per key) keeps symbol chords and the two
    // shift keys correct no matter what order modifiers go up and down.
    _recompute() {
      const next = resolveMatrix(this._held);
      this.pressed.clear();
      for (const k of next) this.pressed.add(k);
    }
    // Does this host key reach the Spectrum's matrix at all? Only claimed keys are
    // preventDefault'ed: function keys (F12 = DevTools, F5 = reload), OS chords, and
    // anything else the machine has no key for must keep working — an embedded demo
    // must not disable the browser.
    _claims(event) {
      if (/^F\d{1,2}$/.test(event.key)) return false;
      if (event.metaKey) return false;
      if (event.key && event.key.length === 1 && charToKeys(event.key)) return true;
      return Boolean(browserCodeToKeys(event.code));
    }
    _keyDown(event) {
      if (!this._claims(event)) return;
      if (this._sound) this._enableAudio();
      this._held.set(event.code, event.key);
      this._recompute();
      event.preventDefault();
    }
    _keyUp(event) {
      if (!this._held.delete(event.code)) return;
      this._recompute();
      event.preventDefault();
    }
    // Run exactly one 50 Hz ZX frame: emulate it, collapse this frame's border log
    // to scanline colours, and push its beeper edges to the audio timeline.
    _advance() {
      const borderCarry = this.border;
      const beeperCarry = this._audioLevel;
      this._borderLog.length = 0;
      this._beeperLog.length = 0;
      this._frameT0 = this.machine.tStatesTotal;
      this.machine.runFrame();
      this.frames += 1;
      borderRowsFromLog(this._borderLog, borderCarry, this._borderRows);
      this._pumpAudio(beeperCarry);
    }
    // Run one frame without touching audio. Used by fastLoadTape's fast-forward, whose
    // frames arrive far faster than the audio clock can consume — feeding them to the ring
    // would swamp it and mute whatever plays next (see fastLoadTape). Still clears the logs
    // each frame so the next real _advance starts clean and nothing accumulates unbounded.
    _advanceQuiet() {
      const borderCarry = this.border;
      this._borderLog.length = 0;
      this._beeperLog.length = 0;
      this._frameT0 = this.machine.tStatesTotal;
      this.machine.runFrame();
      this.frames += 1;
      borderRowsFromLog(this._borderLog, borderCarry, this._borderRows);
    }
    // Blit the current screen + border to the canvas.
    _present() {
      const screen = this.machine.memory.subarray(SCREEN_BASE, SCREEN_BASE + SCREEN_SIZE);
      renderWithBorderRows(screen, this._borderRows, this.frames, this.image.data);
      this.ctx.putImageData(this.image, 0, 0);
    }
    // Drive the machine at a true 50 Hz off wall-clock time (rAF fires at the
    // display rate, usually 60 Hz), catching up whole frames as real time elapses.
    // This keeps emulation speed — and therefore beeper pitch — correct.
    _frameStep(now) {
      if (!this._lastTime) this._lastTime = now;
      let dt = now - this._lastTime;
      this._lastTime = now;
      if (dt > 100) dt = 100;
      this._acc += dt;
      const FRAME_MS = 1e3 / 50;
      if (this._starved && this._sound) {
        this._topUpRing(Math.min(Math.floor(this._acc / FRAME_MS), 6));
      }
      let ran = 0;
      while (this._acc >= FRAME_MS) {
        this._advance();
        this._acc -= FRAME_MS;
        ran += 1;
        if (ran >= 6) {
          this._acc = 0;
          break;
        }
      }
      if (ran > 0) this._present();
      this._raf = requestAnimationFrame((t) => this._frameStep(t));
    }
    // Create the AudioContext on demand (first user gesture) and resume it if the
    // browser suspended it. No-op when sound is off or Web Audio is unavailable
    // (the beeper then stays silent, nothing else breaks).
    //
    // Two delivery paths with identical ring-buffer semantics:
    //  - AudioWorklet (preferred): the ring lives on the audio thread, so a busy
    //    main thread (emulation + canvas blit + GC) can only delay *production*
    //    — which the ~130 ms of queued audio rides out — never *delivery*. A
    //    late ScriptProcessor callback, by contrast, makes the browser drop
    //    render quanta: brief waveform splices heard as crackle.
    //  - ScriptProcessorNode (fallback): main-thread callback draining this._ring,
    //    for browsers that reject the blob: worklet module (e.g. some file://
    //    contexts). Universally supported, glitchier under load.
    _enableAudio() {
      if (!this._sound) return;
      if (this._audioCtx) {
        if (this._audioCtx.state === "suspended") this._audioCtx.resume();
        return;
      }
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      const ctx = new AC();
      this._audioCtx = ctx;
      this._audioTarget = Math.round(ctx.sampleRate * 0.13);
      if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined" && typeof Blob !== "undefined") {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        const finish = (worklet) => {
          URL.revokeObjectURL(url);
          if (this._node) return;
          if (worklet) this._useWorklet();
          else this._useScriptProcessor();
        };
        ctx.audioWorklet.addModule(url).catch(() => ctx.audioWorklet.addModule(`data:text/javascript;base64,${btoa(WORKLET_SRC)}`)).then(() => finish(true), () => finish(false));
        setTimeout(() => finish(false), 500);
      } else {
        this._useScriptProcessor();
      }
      if (ctx.state === "suspended") ctx.resume();
    }
    // Preferred consumer: the worklet owns the ring on the audio thread; we push
    // sample chunks and it reports {fill, starved} back for the controller.
    _useWorklet() {
      if (this._node) return;
      try {
        const node = new AudioWorkletNode(this._audioCtx, "zx-beeper", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        });
        node.port.onmessage = (e) => {
          this._workletFill = e.data.fill;
          if (e.data.starved) this._starved = true;
        };
        this._worklet = node;
        this._chunk = 128;
        this._primeRing(this._audioLevel);
        this._connectGraph(node);
        this._node = node;
      } catch {
        this._worklet = null;
        this._useScriptProcessor();
      }
    }
    // Fallback consumer. ScriptProcessorNode is deprecated but needs no module
    // load. Its callback runs on the main thread, so a stall longer than its
    // buffer (4096 ≈ 85 ms) is the one thing the ring can't hide; 4096 balances
    // that risk against latency for a 50 Hz render.
    _useScriptProcessor() {
      if (this._node) return;
      const ctx = this._audioCtx;
      this._ring = new Float32Array(RING_SIZE);
      this._chunk = 4096;
      this._primeRing(this._audioLevel);
      const node = ctx.createScriptProcessor(this._chunk, 1, 1);
      node.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        const ring = this._ring;
        const mask = ring.length - 1;
        for (let i = 0; i < out.length; i += 1) {
          if (this._ringRead !== this._ringWrite) {
            this._ringLast = ring[this._ringRead];
            this._ringRead = this._ringRead + 1 & mask;
          } else {
            this._starved = true;
          }
          out[i] = this._ringLast;
        }
      };
      this._connectGraph(node);
      this._node = node;
    }
    _connectGraph(node) {
      const ctx = this._audioCtx;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 7e3;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 25;
      node.connect(lp);
      lp.connect(hp);
      hp.connect(ctx.destination);
    }
    // Samples queued but not yet played. SPN path: exact pointer math; worklet
    // path: the audio thread's last report, advanced by what we pushed since.
    _fillNow() {
      if (this._worklet) return this._workletFill;
      if (!this._ring) return 0;
      return this._ringWrite - this._ringRead & this._ring.length - 1;
    }
    // Queue `count` samples for playback. Both paths drop when full (bound latency).
    _push(samples, count) {
      if (this._worklet) {
        const chunk = samples.slice(0, count);
        this._worklet.port.postMessage(chunk, [chunk.buffer]);
        this._workletFill += count;
        return;
      }
      const ring = this._ring;
      const mask = ring.length - 1;
      for (let i = 0; i < count; i += 1) {
        const next = this._ringWrite + 1 & mask;
        if (next === this._ringRead) break;
        ring[this._ringWrite] = samples[i];
        this._ringWrite = next;
      }
    }
    // Replace anything queued with `_audioTarget` samples of the given beeper
    // level's value. Priming at the real level matters: level 0 plays as -AMP, so
    // a 0.0 "silence" prefill would step to -AMP when it drained — a click at
    // every audio start.
    _primeRing(level) {
      const value = AMP * (2 * level - 1);
      if (this._worklet) {
        this._worklet.port.postMessage({ flush: true, level: value });
        const pad = new Float32Array(this._audioTarget).fill(value);
        this._worklet.port.postMessage(pad, [pad.buffer]);
        this._workletFill = this._audioTarget;
      } else if (this._ring) {
        this._ring.fill(value);
        this._ringRead = 0;
        this._ringWrite = this._audioTarget;
        this._ringLast = value;
      }
      this._fillAvg = this._audioTarget;
      this._starved = false;
    }
    // Refill after the consumer ran dry: pad with the current level up to the
    // target minus what the `pending` about-to-run frames will add, so the fill
    // comes out exactly on target once they have been pumped (see _frameStep).
    _topUpRing(pending) {
      this._starved = false;
      const ctx = this._audioCtx;
      if (!this._node || !ctx) return;
      const padTo = this._audioTarget - Math.round(pending * (ctx.sampleRate / 50));
      const missing = padTo - this._fillNow();
      if (missing > 0) {
        const pad = new Float32Array(missing).fill(AMP * (2 * this._audioLevel - 1));
        this._push(pad, missing);
      }
      this._fillAvg = this._audioTarget;
    }
    // Resample this frame's beeper edges into the ring buffer, rate-matched to the
    // audio clock. The producer here runs on the system clock (rAF), the consumer
    // (onaudioprocess) on the audio hardware clock; the two are never exactly equal,
    // so a fixed samples-per-frame would let the ring fill drift to an edge and
    // glitch over minutes. A deadband controller corrects that — but it must watch
    // a *smoothed* fill, not the raw one: the consumer drains a whole
    // ScriptProcessor buffer (4096 samples) at a time, so the instantaneous fill
    // sawtooths with drain phase, and reacting to it would resample — i.e.
    // pitch-shift — frames constantly. The ~1 s EMA erases that sawtooth, so the
    // controller sees only the mean: while the mean sits inside the deadband we
    // emit exactly the nominal count (no resampling, clean tone), and only genuine
    // long-run clock drift walks it past the band, where a gentle trim/pad clamped
    // to ±3 % steers it back.
    _pumpAudio(carryLevel) {
      const ctx = this._audioCtx;
      if (!this._node || !ctx || ctx.state !== "running") return;
      const nominal = ctx.sampleRate / 50;
      const maxDev = Math.round(nominal * 0.03);
      let count = Math.round(nominal);
      const deadband = Math.round(this._chunk / 2 + nominal);
      const err = this._fillAvg - this._audioTarget;
      if (err > deadband) count -= Math.round(Math.min((err - deadband) * 0.05, maxDev));
      else if (err < -deadband) count -= Math.round(Math.max((err + deadband) * 0.05, -maxDev));
      if (count < 1) count = 1;
      if (!this._scratch || this._scratch.length < count) {
        this._scratch = new Float32Array(Math.ceil(nominal) + maxDev + 2);
      }
      const samples = beeperSamples(this._beeperLog, carryLevel, count, AMP, this._scratch);
      if (this._tapePlaying && this._tapeDeck) this._mixTapeAudio(samples, count);
      this._push(samples, count);
      this._fillAvg += (this._fillNow() - this._fillAvg) * 0.02;
    }
    // The loading sound: add this frame's tape EAR level, sampled at the audio rate, on
    // top of the beeper. The frame spans T-states [_frameT0 .. tStatesTotal); the tape
    // clock is (that - _tapeStartT), so a square wave following levelAt() reproduces the
    // pilot tone and data screech. The DC blocker downstream turns its offset into silence.
    _mixTapeAudio(samples, count) {
      const base = this._frameT0 - this._tapeStartT;
      const span = this.machine.tStatesTotal - this._frameT0;
      if (span <= 0) return;
      const step2 = span / count;
      for (let i = 0; i < count; i += 1) {
        const t = base + i * step2;
        if (t < 0 || t >= this._tapeTotal) continue;
        samples[i] += this._tapeDeck.levelAt(t) ? TAPE_AMP : -TAPE_AMP;
      }
    }
    /** Turn beeper sound on/off. */
    setSound(on) {
      this._sound = Boolean(on);
      if (this._sound) this._enableAudio();
      else if (this._worklet) this._worklet.port.postMessage({ flush: true });
      else if (this._ring) this._ringRead = this._ringWrite;
      return this;
    }
    /** Begin the 50 Hz emulation + render loop. */
    start() {
      if (this._raf) return this;
      this._lastTime = 0;
      this._acc = 0;
      this._frameStep(0);
      return this;
    }
    /** Pause the render loop (keyboard bindings stay attached). */
    stop() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      return this;
    }
  };
  function create() {
    return new Spectrum();
  }
  return __toCommonJS(browser_entry_exports);
})();
