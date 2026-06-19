/**
 * ZXGeneration - ZX Spectrum Emulator
 * @version 0.2.0
 * @license MIT
 */
/**
 * Z80 Registers Manager
 * Handles all register operations and 16-bit register pairs
 */
class Registers {
  constructor() {
    this.reset();
  }
  reset() {
    this.data = {
      A: 0,
      F: 0,
      B: 0,
      C: 0,
      D: 0,
      E: 0,
      H: 0,
      L: 0,
      A_: 0,
      F_: 0,
      B_: 0,
      C_: 0,
      D_: 0,
      E_: 0,
      H_: 0,
      L_: 0,
      I: 0,
      R: 0,
      IX: 0,
      IY: 0,
      SP: 0xffff,
      PC: 0x0000
    };
    // "Q" latch: the flags value left by the last instruction that modified F
    // (0 if it did not). Used only by SCF/CCF for their undocumented bits 3/5.
    this.q = 0;
  }

  // 8-bit register access
  get(name) {
    return this.data[name] & 0xff;
  }
  set(name, value) {
    this.data[name] = value & 0xff;
  }

  // 16-bit register pair getters
  getBC() {
    return this.data.B << 8 | this.data.C;
  }
  getDE() {
    return this.data.D << 8 | this.data.E;
  }
  getHL() {
    return this.data.H << 8 | this.data.L;
  }
  getAF() {
    return this.data.A << 8 | this.data.F;
  }

  // 16-bit register pair setters
  setBC(value) {
    const val = value & 0xffff;
    this.data.B = val >> 8 & 0xff;
    this.data.C = val & 0xff;
  }
  setDE(value) {
    const val = value & 0xffff;
    this.data.D = val >> 8 & 0xff;
    this.data.E = val & 0xff;
  }
  setHL(value) {
    const val = value & 0xffff;
    this.data.H = val >> 8 & 0xff;
    this.data.L = val & 0xff;
  }
  setAF(value) {
    const val = value & 0xffff;
    this.data.A = val >> 8 & 0xff;
    this.data.F = val & 0xff;
  }

  // 16-bit register access
  get16(name) {
    switch (name) {
      case 'BC':
        return this.getBC();
      case 'DE':
        return this.getDE();
      case 'HL':
        return this.getHL();
      case 'AF':
        return this.getAF();
      case 'SP':
        return this.data.SP & 0xffff;
      case 'PC':
        return this.data.PC & 0xffff;
      case 'IX':
        return this.data.IX & 0xffff;
      case 'IY':
        return this.data.IY & 0xffff;
      default:
        throw new Error(`Unknown 16-bit register: ${name}`);
    }
  }
  set16(name, value) {
    const val = value & 0xffff;
    switch (name) {
      case 'BC':
        this.setBC(val);
        break;
      case 'DE':
        this.setDE(val);
        break;
      case 'HL':
        this.setHL(val);
        break;
      case 'AF':
        this.setAF(val);
        break;
      case 'SP':
        this.data.SP = val;
        break;
      case 'PC':
        this.data.PC = val;
        break;
      case 'IX':
        this.data.IX = val;
        break;
      case 'IY':
        this.data.IY = val;
        break;
      default:
        throw new Error(`Unknown 16-bit register: ${name}`);
    }
  }

  // Increment/Decrement 16-bit registers
  inc16(name) {
    const value = this.get16(name);
    this.set16(name, value + 1 & 0xffff);
  }
  dec16(name) {
    const value = this.get16(name);
    this.set16(name, value - 1 & 0xffff);
  }

  // Program counter operations
  incrementPC(amount = 1) {
    this.data.PC = this.data.PC + amount & 0xffff;
  }
  setPC(address) {
    this.data.PC = address & 0xffff;
  }
  getPC() {
    return this.data.PC & 0xffff;
  }

  // R register operations (7-bit counter with bit 7 unchanged)
  incrementR() {
    this.data.R = this.data.R + 1 & 0x7f | this.data.R & 0x80;
  }

  // Exchange operations
  exchangeAF() {
    const tempA = this.data.A;
    const tempF = this.data.F;
    this.data.A = this.data.A_;
    this.data.F = this.data.F_;
    this.data.A_ = tempA;
    this.data.F_ = tempF;
  }
  exchangeAll() {
    // EXX - Exchange BC, DE, HL with their shadow registers
    const tempB = this.data.B;
    const tempC = this.data.C;
    const tempD = this.data.D;
    const tempE = this.data.E;
    const tempH = this.data.H;
    const tempL = this.data.L;
    this.data.B = this.data.B_;
    this.data.C = this.data.C_;
    this.data.D = this.data.D_;
    this.data.E = this.data.E_;
    this.data.H = this.data.H_;
    this.data.L = this.data.L_;
    this.data.B_ = tempB;
    this.data.C_ = tempC;
    this.data.D_ = tempD;
    this.data.E_ = tempE;
    this.data.H_ = tempH;
    this.data.L_ = tempL;
  }
  exchangeDE_HL() {
    const tempDE = this.getDE();
    this.setDE(this.getHL());
    this.setHL(tempDE);
  }

  // Debug helper
  dump() {
    return {
      A: this.data.A.toString(16).padStart(2, '0'),
      F: this.data.F.toString(16).padStart(2, '0'),
      BC: this.getBC().toString(16).padStart(4, '0'),
      DE: this.getDE().toString(16).padStart(4, '0'),
      HL: this.getHL().toString(16).padStart(4, '0'),
      SP: this.data.SP.toString(16).padStart(4, '0'),
      PC: this.data.PC.toString(16).padStart(4, '0'),
      IX: this.data.IX.toString(16).padStart(4, '0'),
      IY: this.data.IY.toString(16).padStart(4, '0'),
      I: this.data.I.toString(16).padStart(2, '0'),
      R: this.data.R.toString(16).padStart(2, '0')
    };
  }

  // Undocumented IX/IY half registers
  getIXH() {
    return this.data.IX >> 8 & 0xff;
  }
  setIXH(value) {
    this.data.IX = this.data.IX & 0x00ff | (value & 0xff) << 8;
  }
  getIXL() {
    return this.data.IX & 0xff;
  }
  setIXL(value) {
    this.data.IX = this.data.IX & 0xff00 | value & 0xff;
  }
  getIYH() {
    return this.data.IY >> 8 & 0xff;
  }
  setIYH(value) {
    this.data.IY = this.data.IY & 0x00ff | (value & 0xff) << 8;
  }
  getIYL() {
    return this.data.IY & 0xff;
  }
  setIYL(value) {
    this.data.IY = this.data.IY & 0xff00 | value & 0xff;
  }

  // Property accessors for test compatibility
  get a() {
    return this.get('A');
  }
  set a(value) {
    this.set('A', value);
  }
  get f() {
    return this.get('F');
  }
  set f(value) {
    this.set('F', value);
  }
  get b() {
    return this.get('B');
  }
  set b(value) {
    this.set('B', value);
  }
  get c() {
    return this.get('C');
  }
  set c(value) {
    this.set('C', value);
  }
  get d() {
    return this.get('D');
  }
  set d(value) {
    this.set('D', value);
  }
  get e() {
    return this.get('E');
  }
  set e(value) {
    this.set('E', value);
  }
  get h() {
    return this.get('H');
  }
  set h(value) {
    this.set('H', value);
  }
  get l() {
    return this.get('L');
  }
  set l(value) {
    this.set('L', value);
  }
  get i() {
    return this.get('I');
  }
  set i(value) {
    this.set('I', value);
  }
  get r() {
    return this.get('R');
  }
  set r(value) {
    this.set('R', value);
  }
  get pc() {
    return this.getPC();
  }
  set pc(value) {
    this.setPC(value);
  }
  get sp() {
    return this.data.SP & 0xffff;
  }
  set sp(value) {
    this.data.SP = value & 0xffff;
  }
  get ix() {
    return this.data.IX & 0xffff;
  }
  set ix(value) {
    this.data.IX = value & 0xffff;
  }
  get iy() {
    return this.data.IY & 0xffff;
  }
  set iy(value) {
    this.data.IY = value & 0xffff;
  }
  get bc() {
    return this.getBC();
  }
  set bc(value) {
    this.setBC(value);
  }
  get de() {
    return this.getDE();
  }
  set de(value) {
    this.setDE(value);
  }
  get hl() {
    return this.getHL();
  }
  set hl(value) {
    this.setHL(value);
  }
  get af() {
    return this.getAF();
  }
  set af(value) {
    this.setAF(value);
  }
}

/**
 * Z80 Flags Manager
 * Handles all flag operations including undocumented F3/F5 flags
 */
class Flags {
  constructor() {
    this.masks = {
      S: 0x80,
      // Sign
      Z: 0x40,
      // Zero
      F5: 0x20,
      // Undocumented - copy of bit 5
      H: 0x10,
      // Half carry
      F3: 0x08,
      // Undocumented - copy of bit 3
      PV: 0x04,
      // Parity/Overflow
      N: 0x02,
      // Add/Subtract
      C: 0x01 // Carry
    };
  }

  /**
   * Get flag value from F register
   */
  getFlag(fRegister, flagMask) {
    return (fRegister & flagMask) !== 0;
  }

  /**
   * Set or clear a flag in F register
   */
  setFlag(fRegister, flagMask, value) {
    if (value) {
      return fRegister | flagMask;
    }
    return fRegister & ~flagMask;
  }

  /**
   * Update flags after arithmetic/logical operations
   */
  updateFlags(fRegister, result, operation = 'arithmetic') {
    const result8 = result & 0xff;
    let newF = fRegister;

    // Always update undocumented flags F3 and F5
    newF = this.setFlag(newF, this.masks.F5, (result8 & 0x20) !== 0);
    newF = this.setFlag(newF, this.masks.F3, (result8 & 0x08) !== 0);
    newF = this.setFlag(newF, this.masks.S, (result8 & 0x80) !== 0);
    newF = this.setFlag(newF, this.masks.Z, result8 === 0);
    if (operation === 'subtract') {
      newF = this.setFlag(newF, this.masks.N, true);
    } else if (operation === 'arithmetic') {
      newF = this.setFlag(newF, this.masks.N, false);
    } else if (operation === 'logical') {
      newF = this.setFlag(newF, this.masks.N, false);
      // For logical operations, set parity flag
      newF = this.setFlag(newF, this.masks.PV, this.calculateParity(result8));
    }
    return newF;
  }

  /**
   * Calculate parity of an 8-bit value
   */
  calculateParity(value) {
    let parity = 0;
    let temp = value & 0xff;
    for (let i = 0; i < 8; i++) {
      if (temp & 1) {
        parity++;
      }
      temp >>= 1;
    }
    return (parity & 1) === 0;
  }

  /**
   * Update flags for IN instruction
   */
  updateInFlags(fRegister, value) {
    let newF = fRegister;
    newF = this.setFlag(newF, this.masks.S, (value & 0x80) !== 0);
    newF = this.setFlag(newF, this.masks.Z, value === 0);
    newF = this.setFlag(newF, this.masks.H, false);
    newF = this.setFlag(newF, this.masks.N, false);
    newF = this.setFlag(newF, this.masks.PV, this.calculateParity(value));

    // Undocumented flags
    newF = this.setFlag(newF, this.masks.F5, (value & 0x20) !== 0);
    newF = this.setFlag(newF, this.masks.F3, (value & 0x08) !== 0);
    return newF;
  }

  /**
   * Update flags for increment operation
   */
  updateIncFlags(fRegister, originalValue, result) {
    let newF = fRegister;
    newF = this.setFlag(newF, this.masks.S, (result & 0x80) !== 0);
    newF = this.setFlag(newF, this.masks.Z, result === 0);
    newF = this.setFlag(newF, this.masks.H, (originalValue & 0x0f) === 0x0f);
    newF = this.setFlag(newF, this.masks.PV, originalValue === 0x7f);
    newF = this.setFlag(newF, this.masks.N, false);

    // Undocumented flags
    newF = this.setFlag(newF, this.masks.F5, (result & 0x20) !== 0);
    newF = this.setFlag(newF, this.masks.F3, (result & 0x08) !== 0);
    return newF;
  }

  /**
   * Update flags for decrement operation
   */
  updateDecFlags(fRegister, originalValue, result) {
    let newF = fRegister;
    newF = this.setFlag(newF, this.masks.S, (result & 0x80) !== 0);
    newF = this.setFlag(newF, this.masks.Z, result === 0);
    newF = this.setFlag(newF, this.masks.H, (originalValue & 0x0f) === 0);
    newF = this.setFlag(newF, this.masks.PV, originalValue === 0x80);
    newF = this.setFlag(newF, this.masks.N, true);

    // Undocumented flags - FIXED: was this.flags.F3, now this.masks.F3
    newF = this.setFlag(newF, this.masks.F5, (result & 0x20) !== 0);
    newF = this.setFlag(newF, this.masks.F3, (result & 0x08) !== 0);
    return newF;
  }

  /**
   * Update flags for BIT test operation
   */
  updateBitTestFlags(fRegister, bit, value) {
    const mask = 1 << bit;
    const result = value & mask;
    let newF = fRegister;
    newF = this.setFlag(newF, this.masks.Z, result === 0);
    newF = this.setFlag(newF, this.masks.H, true);
    newF = this.setFlag(newF, this.masks.N, false);
    newF = this.setFlag(newF, this.masks.S, bit === 7 && result !== 0);
    newF = this.setFlag(newF, this.masks.PV, result === 0); // PV acts as Z for BIT

    // Undocumented flags: F3 and F5 are set from the value being tested
    newF = this.setFlag(newF, this.masks.F5, (value & 0x20) !== 0);
    newF = this.setFlag(newF, this.masks.F3, (value & 0x08) !== 0);
    return newF;
  }
}

/**
 * Memory Interface
 * Provides abstraction layer for memory access
 */
class MemoryInterface {
  constructor(memory) {
    this.memory = memory;
  }

  /**
   * Read a byte from memory
   */
  readByte(address) {
    return this.memory.read(address & 0xffff);
  }

  /**
   * Write a byte to memory
   */
  writeByte(address, value) {
    this.memory.write(address & 0xffff, value & 0xff);
  }

  /**
   * Read a 16-bit word from memory (little-endian)
   */
  readWord(address) {
    const addr = address & 0xffff;
    const low = this.memory.read(addr);
    const high = this.memory.read(addr + 1 & 0xffff);
    return low | high << 8;
  }

  /**
   * Write a 16-bit word to memory (little-endian)
   */
  writeWord(address, value) {
    const addr = address & 0xffff;
    const val = value & 0xffff;
    this.memory.write(addr, val & 0xff);
    this.memory.write(addr + 1 & 0xffff, val >> 8 & 0xff);
  }

  /**
   * Read byte and increment PC
   */
  fetchByte(registers) {
    const byte = this.readByte(registers.getPC());
    registers.incrementPC();
    return byte;
  }

  /**
   * Read word and increment PC by 2
   */
  fetchWord(registers) {
    const low = this.fetchByte(registers);
    const high = this.fetchByte(registers);
    return low | high << 8;
  }

  /**
   * Push byte to stack
   */
  pushByte(registers, value) {
    const sp = registers.get16('SP') - 1 & 0xffff;
    registers.set16('SP', sp);
    this.writeByte(sp, value);
  }

  /**
   * Pop byte from stack
   */
  popByte(registers) {
    const sp = registers.get16('SP');
    const value = this.readByte(sp);
    registers.set16('SP', sp + 1 & 0xffff);
    return value;
  }

  /**
   * Push word to stack
   */
  pushWord(registers, value) {
    this.pushByte(registers, value >> 8 & 0xff);
    this.pushByte(registers, value & 0xff);
  }

  /**
   * Pop word from stack
   */
  popWord(registers) {
    const low = this.popByte(registers);
    const high = this.popByte(registers);
    return low | high << 8;
  }
}

/**
 * I/O Interface
 * Provides abstraction layer for I/O port access
 */
class IOInterface {
  constructor(ula) {
    this.ula = ula;
  }

  /**
   * Read from I/O port
   */
  readPort(port) {
    return this.ula.readPort(port & 0xffff);
  }

  /**
   * Write to I/O port
   */
  writePort(port, value) {
    this.ula.writePort(port & 0xffff, value & 0xff);
  }
}

/**
 * ArithmeticInstructions – fixed version
 * Implements ADD, SUB, ADC, SBC, INC, DEC, CP, ADD HL, NEG
 * ------------------------------------------------------------------
 * Fixes applied :
 *  1. **Overflow flag preservation** – `updateFlags()` is called, then
 *     the pre-computed overflow bit is restored so parity logic inside
 *     `updateFlags()` cannot overwrite it.
 *  2. **Accurate timing** – every public method now accepts an optional
 *     `cycles` argument.  It defaults to 4 T (the register-to-register
 *     form) but the caller can supply **7 T** or **11 T** for immediate
 *     or memory forms, IX/IY variants, etc.  This keeps the interface
 *     simple while allowing cycle-exact emulation at call-site level.
 * ------------------------------------------------------------------
 */

class ArithmeticInstructions {
  /** @param {Registers} registers
   *  @param {Flags}     flags
   *  @param {Memory}    memory
   */
  constructor(registers, flags, memory) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
  }

  /* -------------------------------------------------------------
   * 8-bit arithmetic
   * ----------------------------------------------------------- */

  /**
   * ADD A, value
   * @param {number} value  8-bit operand
   * @param {number} cycles T-states to report (default 4)
   */
  addA(value, cycles = 4) {
    const a = this.registers.get('A');
    const result = a + value;
    const halfCarry = (a & 0x0f) + (value & 0x0f) > 0x0f;
    const carry = result > 0xff;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, carry);
    f = this.flags.setFlag(f, this.flags.masks.H, halfCarry);
    f = this.flags.setFlag(f, this.flags.masks.N, false);

    // overflow when operands have same sign, result has opposite
    const overflow = ((a ^ value) & 0x80) === 0 && ((a ^ result) & 0x80) !== 0;

    // Update S,Z,F5,F3 (and possibly PV) from result
    f = this.flags.updateFlags(f, result & 0xff);

    // restore correct overflow
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    this.registers.set('A', result & 0xff);
    this.registers.set('F', f);
    return cycles;
  }

  /**
   * SUB A, value
   */
  subA(value, cycles = 4) {
    const a = this.registers.get('A');
    const result = a - value;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;
    const borrow = result < 0;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, borrow);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    const overflow = ((a ^ value) & 0x80) !== 0 && ((a ^ result) & 0x80) !== 0;
    f = this.flags.updateFlags(f, result & 0xff, 'subtract');
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    this.registers.set('A', result & 0xff);
    this.registers.set('F', f);
    return cycles;
  }

  /**
   * ADC A, value (Add with Carry)
   */
  adcA(value, cycles = 4) {
    const a = this.registers.get('A');
    const carry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const result = a + value + carry;
    const halfCarry = (a & 0x0f) + (value & 0x0f) + carry > 0x0f;
    const carryOut = result > 0xff;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, carryOut);
    f = this.flags.setFlag(f, this.flags.masks.H, halfCarry);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    const overflow = ((a ^ value) & 0x80) === 0 && ((a ^ result) & 0x80) !== 0;
    f = this.flags.updateFlags(f, result & 0xff);
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    this.registers.set('A', result & 0xff);
    this.registers.set('F', f);
    return cycles;
  }

  /**
   * SBC A, value (Subtract with Carry)
   */
  sbcA(value, cycles = 4) {
    const a = this.registers.get('A');
    const carry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const result = a - value - carry;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) - carry < 0;
    const borrow = result < 0;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, borrow);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    const overflow = ((a ^ value) & 0x80) !== 0 && ((a ^ result) & 0x80) !== 0;
    f = this.flags.updateFlags(f, result & 0xff, 'subtract');
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    this.registers.set('A', result & 0xff);
    this.registers.set('F', f);
    return cycles;
  }

  /**
   * CP value  (Compare with A)
   */
  cpA(value, cycles = 4) {
    const a = this.registers.get('A');
    const result = a - value;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;
    const borrow = result < 0;
    const temp = result & 0xff;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, borrow);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    f = this.flags.setFlag(f, this.flags.masks.S, (temp & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, temp === 0);
    const overflow = ((a ^ value) & 0x80) !== 0 && ((a ^ temp) & 0x80) !== 0;
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);

    // undocumented bits from *operand*
    f = this.flags.setFlag(f, this.flags.masks.F5, (value & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (value & 0x08) !== 0);
    this.registers.set('F', f);
    return cycles;
  }

  /* -------------------------------------------------------------
   * INC / DEC single-register helpers
   * ----------------------------------------------------------- */

  incReg(regName, cycles = 4) {
    const before = this.registers.get(regName);
    const after = before + 1 & 0xff;
    this.registers.set(regName, after);
    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }
  decReg(regName, cycles = 4) {
    const before = this.registers.get(regName);
    const after = before - 1 & 0xff;
    this.registers.set(regName, after);
    const f = this.flags.updateDecFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }

  /* -------------------------------------------------------------
   * INC / DEC on a raw 8-bit value (used by the undocumented
   * INC/DEC IXH/IXL/IYH/IYL forms). Updates F exactly as INC/DEC r
   * and returns the new byte so the caller can store it back into
   * the appropriate half of IX/IY.
   * ----------------------------------------------------------- */

  inc8(value) {
    const before = value & 0xff;
    const after = before + 1 & 0xff;
    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return after;
  }
  dec8(value) {
    const before = value & 0xff;
    const after = before - 1 & 0xff;
    const f = this.flags.updateDecFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return after;
  }

  /* -------------------------------------------------------------
   * INC / DEC (HL) memory cell
   * ----------------------------------------------------------- */

  incHL(cycles = 11) {
    const addr = this.registers.getHL();
    const before = this.memory.readByte(addr);
    const after = before + 1 & 0xff;
    this.memory.writeByte(addr, after);
    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }
  decHL(cycles = 11) {
    const addr = this.registers.getHL();
    const before = this.memory.readByte(addr);
    const after = before - 1 & 0xff;
    this.memory.writeByte(addr, after);
    const f = this.flags.updateDecFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }

  /* -------------------------------------------------------------
   * 16-bit arithmetic
   * ----------------------------------------------------------- */

  /**
   * ADD HL, rr
   * @param {number} value 16-bit source register-pair
   */
  addHL(value, cycles = 11) {
    const hl = this.registers.getHL();
    const result = hl + value;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, result > 0xffff);
    f = this.flags.setFlag(f, this.flags.masks.H, (hl & 0x0fff) + (value & 0x0fff) > 0x0fff);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    this.registers.setHL(result & 0xffff);

    // undocumented bits from high byte of result
    const high = result >> 8 & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (high & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (high & 0x08) !== 0);
    this.registers.set('F', f);
    return cycles;
  }

  /* -------------------------------------------------------------
   * NEG
   * ----------------------------------------------------------- */

  neg(cycles = 8) {
    const a = this.registers.get('A');
    const result = -a & 0xff;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, a !== 0);
    f = this.flags.setFlag(f, this.flags.masks.H, (a & 0x0f) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.PV, a === 0x80);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, result === 0);
    f = this.flags.setFlag(f, this.flags.masks.F5, (result & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (result & 0x08) !== 0);
    this.registers.set('A', result);
    this.registers.set('F', f);
    return cycles;
  }
}

/**
 * Logical Instructions
 * Handles AND, OR, XOR, CPL, SCF, CCF, DAA operations
 */
class LogicalInstructions {
  constructor(registers, flags) {
    this.registers = registers;
    this.flags = flags;
  }

  /**
   * AND A, value
   */
  andA(value) {
    const result = this.registers.get('A') & value;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, false);
    newF = this.flags.setFlag(newF, this.flags.masks.H, true);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * OR A, value
   */
  orA(value) {
    const result = this.registers.get('A') | value;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, false);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * XOR A, value
   */
  xorA(value) {
    const result = this.registers.get('A') ^ value;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, false);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * CPL (Complement A)
   */
  cpl() {
    this.registers.set('A', ~this.registers.get('A') & 0xff);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.H, true);
    newF = this.flags.setFlag(newF, this.flags.masks.N, true);

    // Undocumented flags from A
    const a = this.registers.get('A');
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (a & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (a & 0x08) !== 0);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * SCF (Set Carry Flag)
   */
  scf() {
    const a = this.registers.get('A');
    const f = this.registers.get('F');
    let newF = f;
    newF = this.flags.setFlag(newF, this.flags.masks.C, true);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented bits 3/5 on the NMOS Z80: ((Q ^ F) | A). The Q latch holds
    // the flags left by the last flag-modifying instruction (0 otherwise), so
    // this is `A` right after an ALU op and `F | A` after a non-flag op.
    newF = this.applyScfCcfUndocumented(newF, f, a);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /** Shared SCF/CCF bit 3/5 derivation (see scf for the rationale). */
  applyScfCcfUndocumented(newF, f, a) {
    const xy = this.flags.masks.F5 | this.flags.masks.F3;
    const q = this.registers.q || 0;
    return newF & ~xy | (q ^ f | a) & xy;
  }

  /**
   * CCF (Complement Carry Flag)
   */
  ccf() {
    const a = this.registers.get('A');
    const f = this.registers.get('F');
    const oldCarry = this.flags.getFlag(f, this.flags.masks.C);
    let newF = f;
    newF = this.flags.setFlag(newF, this.flags.masks.H, oldCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.C, !oldCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented bits 3/5: ((Q ^ F) | A) — same NMOS rule as SCF.
    newF = this.applyScfCcfUndocumented(newF, f, a);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * DAA (Decimal Adjust Accumulator)
   *
   * Flags affected: S Z H PV N C F5 F3
   * This is the official Z80 logic for DAA.
   * - H is set if there is a half-carry out of bit 3 of the result (after correction)
   * - C is set if correction was >= 0x60, or if C was already set and a correction was done
   * - N is not changed
   */
  daa() {
    let a = this.registers.get('A');
    let f = this.registers.get('F');
    const c = this.flags.getFlag(f, this.flags.masks.C);
    const h = this.flags.getFlag(f, this.flags.masks.H);
    const n = this.flags.getFlag(f, this.flags.masks.N);
    let correction = 0;
    let setC = false;

    // DAA algorithm
    if (!n) {
      // After addition
      if (h || (a & 0x0f) > 9) {
        correction |= 0x06;
      }
      if (c || a > 0x99) {
        correction |= 0x60;
        setC = true;
      }
      const newA = a + correction & 0xff;
      // Set or clear H: was there a half-carry?
      const halfCarry = (a & 0x0f) + (correction & 0x0f) > 0x0f;
      f = this.flags.setFlag(f, this.flags.masks.H, halfCarry);
      a = newA;
    } else {
      // After subtraction - DAA adjusts based on invalid BCD digits
      if (h) {
        correction |= 0x06;
      }
      if (c) {
        correction |= 0x60;
      }
      const newA = a - correction & 0xff;
      // H flag behavior after subtraction DAA is complex:
      // Set if there was a borrow from bit 4 during the correction
      const halfBorrow = (a & 0x0f) < (correction & 0x0f);
      f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
      a = newA;

      // C flag remains as it was (set by the previous SUB/SBC)
      setC = c;
    }

    // Set S, Z, PV
    f = this.flags.setFlag(f, this.flags.masks.S, (a & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, a === 0);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.flags.calculateParity(a));

    // Set/clear carry
    f = this.flags.setFlag(f, this.flags.masks.C, setC);

    // F5/F3 undocumented: from result
    f = this.flags.setFlag(f, this.flags.masks.F5, (a & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (a & 0x08) !== 0);
    this.registers.set('A', a);
    this.registers.set('F', f);
    return 4; // cycles
  }
}

/**
 * Common utility functions for the Z80 emulator
 */

/**
 * Sign-extend an 8-bit value to a signed integer
 * @param {number} value - 8-bit unsigned value
 * @returns {number} Sign-extended value (-128 to 127)
 */
function sign8(value) {
  return value & 0x80 ? value - 256 : value;
}

/**
 * Memory interface recommendation for performance
 * @example
 * // For best performance, back your memory with TypedArray:
 * class Memory {
 *     constructor(size = 65536) {
 *         this.ram = new Uint8Array(size);
 *     }
 *
 *     read(address) {
 *         return this.ram[address & 0xFFFF];
 *     }
 *
 *     write(address, value) {
 *         this.ram[address & 0xFFFF] = value & 0xFF;
 *     }
 * }
 */

/**
 * Load Instructions
 * Handles all LD operations for 8‐bit and 16‐bit loads, including special
 * cases LD A,I and LD A,R with correct flag behaviour (PV = IFF2).
 */
class LoadInstructions {
  constructor(registers, memory, io, flags, cpu = null) {
    this.registers = registers;
    this.memory = memory;
    this.io = io;
    this.flags = flags;
    this.cpu = cpu; // optional, only needed for IFF2 in LD A,I and LD A,R
  }

  /* LD reg, value */
  loadRegImmediate(regName, value) {
    this.registers.set(regName, value & 0xff);
    return 7;
  }

  /* LD reg16, value */
  loadReg16Immediate(regName, value) {
    this.registers.set16(regName, value & 0xffff);
    return regName === 'IX' || regName === 'IY' ? 14 : 10;
  }

  /* LD reg, reg */
  loadRegReg(destReg, srcReg) {
    this.registers.set(destReg, this.registers.get(srcReg));
    return 4;
  }

  /* LD reg, (HL) */
  loadRegFromHL(regName) {
    const addr = this.registers.getHL();
    this.registers.set(regName, this.memory.readByte(addr));
    return 7;
  }

  /* LD (HL), reg */
  loadHLFromReg(regName) {
    const addr = this.registers.getHL();
    this.memory.writeByte(addr, this.registers.get(regName));
    return 7;
  }

  /* LD (HL), n */
  loadHLImmediate(value) {
    const addr = this.registers.getHL();
    this.memory.writeByte(addr, value & 0xff);
    return 10;
  }

  /* LD A,(BC) */
  loadAFromBC() {
    const addr = this.registers.getBC();
    this.registers.set('A', this.memory.readByte(addr));
    return 7;
  }

  /* LD A,(DE) */
  loadAFromDE() {
    const addr = this.registers.getDE();
    this.registers.set('A', this.memory.readByte(addr));
    return 7;
  }

  /* LD (BC),A */
  loadBCFromA() {
    const addr = this.registers.getBC();
    this.memory.writeByte(addr, this.registers.get('A'));
    return 7;
  }

  /* LD (DE),A */
  loadDEFromA() {
    const addr = this.registers.getDE();
    this.memory.writeByte(addr, this.registers.get('A'));
    return 7;
  }

  /* LD A,(nn) */
  loadAFromAddress(address) {
    this.registers.set('A', this.memory.readByte(address & 0xffff));
    return 13;
  }

  /* LD (nn),A */
  loadAddressFromA(address) {
    this.memory.writeByte(address & 0xffff, this.registers.get('A'));
    return 13;
  }

  /* LD HL,(nn) */
  loadHLFromAddress(address) {
    this.registers.setHL(this.memory.readWord(address & 0xffff));
    return 16;
  }

  /* LD (nn),HL */
  loadAddressFromHL(address) {
    this.memory.writeWord(address & 0xffff, this.registers.getHL());
    return 16;
  }

  /* LD reg16,(nn)  (ED) */
  loadReg16FromAddress(regName, address) {
    this.registers.set16(regName, this.memory.readWord(address & 0xffff));
    return 20;
  }

  /* LD (nn),reg16 (ED) */
  loadAddressFromReg16(address, regName) {
    this.memory.writeWord(address & 0xffff, this.registers.get16(regName));
    return 20;
  }

  /* LD SP,HL */
  loadSPFromHL() {
    this.registers.set16('SP', this.registers.getHL());
    return 6;
  }

  /* LD I,A */
  loadIFromA() {
    this.registers.set('I', this.registers.get('A'));
    return 9;
  }

  /* LD R,A */
  loadRFromA() {
    this.registers.set('R', this.registers.get('A'));
    return 9;
  }

  /**
   * Helper used by LD A,I and LD A,R to compute flags.
   * @param {number} value  The value loaded into A (either I or R)
   */
  _updateFlagsAfterLoadAIorAR(value) {
    let f = this.registers.get('F');
    const carryState = this.flags.getFlag(f, this.flags.masks.C); // preserve C

    f = this.flags.setFlag(f, this.flags.masks.S, (value & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, value === 0);
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);

    // PV == IFF2 when CPU context is provided
    if (this.cpu) {
      f = this.flags.setFlag(f, this.flags.masks.PV, !!this.cpu.iff2);
    }

    // Undocumented flags
    f = this.flags.setFlag(f, this.flags.masks.F5, (value & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (value & 0x08) !== 0);

    // Restore original carry
    f = this.flags.setFlag(f, this.flags.masks.C, carryState);
    this.registers.set('F', f);
  }

  /* LD A,I */
  loadAFromI() {
    const i = this.registers.get('I') & 0xff;
    this.registers.set('A', i);
    this._updateFlagsAfterLoadAIorAR(i);
    return 9;
  }

  /* LD A,R */
  loadAFromR() {
    const r = this.registers.get('R') & 0xff;
    this.registers.set('A', r);
    this._updateFlagsAfterLoadAIorAR(r);
    return 9;
  }

  /* LD reg,(IX/IY+d) */
  loadRegFromIndexed(regName, indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.registers.set(regName, this.memory.readByte(addr));
    return 19;
  }

  /* LD (IX/IY+d),reg */
  loadIndexedFromReg(indexReg, displacement, regName) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.memory.writeByte(addr, this.registers.get(regName));
    return 19;
  }

  /* LD (IX/IY+d),n */
  loadIndexedImmediate(indexReg, displacement, value) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.memory.writeByte(addr, value & 0xff);
    return 19;
  }
}

/**
 * Jump and Flow Control Instructions
 * Handles JP, JR, CALL, RET, RST, DJNZ operations
 */
class JumpInstructions {
  constructor(registers, flags, memory) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
  }

  /**
   * JP nn (Unconditional jump)
   */
  jump(address) {
    this.registers.setPC(address);
    return 10; // cycles
  }

  /**
   * JP cc, nn (Conditional jump)
   */
  jumpConditional(condition, address) {
    if (this.checkCondition(condition)) {
      this.registers.setPC(address);
    }
    return 10; // cycles
  }

  /**
   * JP (HL)
   */
  jumpHL() {
    this.registers.setPC(this.registers.getHL());
    return 4; // cycles
  }

  /**
   * JP (IX) / JP (IY)
   */
  jumpIndexed(indexReg) {
    this.registers.setPC(this.registers.get16(indexReg));
    return 8; // cycles
  }

  /**
   * JR e (Relative jump)
   */
  jumpRelative(offset) {
    const signedOffset = offset > 127 ? offset - 256 : offset;
    const newPC = this.registers.getPC() + signedOffset & 0xffff;
    this.registers.setPC(newPC);
    return 12; // cycles
  }

  /**
   * JR cc, e (Conditional relative jump)
   */
  jumpRelativeConditional(condition, offset) {
    if (this.checkCondition(condition)) {
      const signedOffset = offset > 127 ? offset - 256 : offset;
      const newPC = this.registers.getPC() + signedOffset & 0xffff;
      this.registers.setPC(newPC);
      return 12; // cycles
    }
    return 7; // cycles
  }

  /**
   * CALL nn (Unconditional call)
   */
  call(address) {
    this.memory.pushWord(this.registers, this.registers.getPC());
    this.registers.setPC(address);
    return 17; // cycles
  }

  /**
   * CALL cc, nn (Conditional call)
   */
  callConditional(condition, address) {
    if (this.checkCondition(condition)) {
      this.memory.pushWord(this.registers, this.registers.getPC());
      this.registers.setPC(address);
      return 17; // cycles
    }
    return 10; // cycles
  }

  /**
   * RET (Unconditional return)
   */
  ret() {
    const address = this.memory.popWord(this.registers);
    this.registers.setPC(address);
    return 10; // cycles
  }

  /**
   * RET cc (Conditional return)
   */
  retConditional(condition) {
    if (this.checkCondition(condition)) {
      const address = this.memory.popWord(this.registers);
      this.registers.setPC(address);
      return 11; // cycles
    }
    return 5; // cycles
  }

  /**
   * RETI (Return from interrupt)
   */
  reti() {
    const address = this.memory.popWord(this.registers);
    this.registers.setPC(address);
    // RETI also signals to peripherals that interrupt routine is complete
    return 14; // cycles
  }

  /**
   * RETN (Return from non-maskable interrupt)
   */
  retn(cpu) {
    const address = this.memory.popWord(this.registers);
    this.registers.setPC(address);
    // Restore interrupt state: IFF1 = IFF2
    if (cpu) {
      cpu.iff1 = cpu.iff2;
    }
    return 14; // cycles
  }

  /**
   * RST p (Restart)
   */
  rst(address) {
    this.memory.pushWord(this.registers, this.registers.getPC());
    this.registers.setPC(address);
    return 11; // cycles
  }

  /**
   * DJNZ e (Decrement B and jump if not zero)
   */
  djnz(offset) {
    const b = this.registers.get('B') - 1 & 0xff;
    this.registers.set('B', b);
    if (b !== 0) {
      const signedOffset = offset > 127 ? offset - 256 : offset;
      const newPC = this.registers.getPC() + signedOffset & 0xffff;
      this.registers.setPC(newPC);
      return 13; // cycles
    }
    return 8; // cycles
  }

  /**
   * Check condition codes
   */
  checkCondition(condition) {
    const f = this.registers.get('F');
    switch (condition) {
      case 'NZ':
        return !this.flags.getFlag(f, this.flags.masks.Z);
      case 'Z':
        return this.flags.getFlag(f, this.flags.masks.Z);
      case 'NC':
        return !this.flags.getFlag(f, this.flags.masks.C);
      case 'C':
        return this.flags.getFlag(f, this.flags.masks.C);
      case 'PO':
        return !this.flags.getFlag(f, this.flags.masks.PV);
      case 'PE':
        return this.flags.getFlag(f, this.flags.masks.PV);
      case 'P':
        return !this.flags.getFlag(f, this.flags.masks.S);
      case 'M':
        return this.flags.getFlag(f, this.flags.masks.S);
      default:
        return false;
    }
  }
}

/**
 * Bit Manipulation Instructions
 * Handles BIT, SET, RES and rotate/shift operations (CB prefix)
 */
class BitInstructions {
  constructor(registers, flags, memory) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
  }

  /**
   * BIT bit, reg/memory
   * @param {number} bit - The bit position to test (0-7)
   * @param {number} value - The value to test
   * @param {boolean} isMemory - Whether this is a memory operation (HL)
   * @returns {number} Total cycles: 8 for register, 12 for (HL)
   */
  bitTest(bit, value, isMemory = false) {
    const newF = this.flags.updateBitTestFlags(this.registers.get('F'), bit, value);
    this.registers.set('F', newF);
    return isMemory ? 12 : 8;
  }

  /**
   * SET bit, reg
   */
  setBitReg(bit, regName) {
    const value = this.registers.get(regName);
    this.registers.set(regName, value | 1 << bit);
    return 8; // cycles
  }

  /**
   * RES bit, reg
   */
  resBitReg(bit, regName) {
    const value = this.registers.get(regName);
    this.registers.set(regName, value & ~(1 << bit));
    return 8; // cycles
  }

  /**
   * SET bit, (HL)
   */
  setBitHL(bit) {
    const addr = this.registers.getHL();
    const value = this.memory.readByte(addr);
    this.memory.writeByte(addr, value | 1 << bit);
    return 15; // cycles
  }

  /**
   * RES bit, (HL)
   */
  resBitHL(bit) {
    const addr = this.registers.getHL();
    const value = this.memory.readByte(addr);
    this.memory.writeByte(addr, value & ~(1 << bit));
    return 15; // cycles
  }

  /**
   * RLC (Rotate Left Circular)
   */
  rlc(value) {
    const carry = (value & 0x80) !== 0;
    const result = (value << 1 | (carry ? 1 : 0)) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    // F3 and F5 flags are already set by updateFlags

    this.registers.set('F', newF);
    return result;
  }

  /**
   * RRC (Rotate Right Circular)
   */
  rrc(value) {
    const carry = (value & 0x01) !== 0;
    const result = (value >> 1 | (carry ? 0x80 : 0)) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * RL (Rotate Left through Carry)
   */
  rl(value) {
    const oldCarry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const newCarry = (value & 0x80) !== 0;
    const result = (value << 1 | oldCarry) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, newCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * RR (Rotate Right through Carry)
   */
  rr(value) {
    const oldCarry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 0x80 : 0;
    const newCarry = (value & 0x01) !== 0;
    const result = (value >> 1 | oldCarry) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, newCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * SLA (Shift Left Arithmetic)
   */
  sla(value) {
    const carry = (value & 0x80) !== 0;
    const result = value << 1 & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * SRA (Shift Right Arithmetic)
   */
  sra(value) {
    const carry = (value & 0x01) !== 0;
    const result = (value >> 1 | value & 0x80) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * SLL (Shift Left Logical) - undocumented
   * Note: This implements the behavior commonly known as SLI (Shift Left and Increment),
   * which shifts left and sets bit 0 to 1. Some assemblers use SLL for this operation.
   */
  sll(value) {
    const carry = (value & 0x80) !== 0;
    const result = (value << 1 | 1) & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * SRL (Shift Right Logical)
   */
  srl(value) {
    const carry = (value & 0x01) !== 0;
    const result = value >> 1 & 0xff;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);
    newF = this.flags.updateFlags(newF, result, 'logical');
    this.registers.set('F', newF);
    return result;
  }

  /**
   * RLCA (Rotate Left Circular Accumulator)
   */
  rlca() {
    const a = this.registers.get('A');
    const carry = (a & 0x80) !== 0;
    const result = (a << 1 | (carry ? 1 : 0)) & 0xff;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (result & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (result & 0x08) !== 0);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * RRCA (Rotate Right Circular Accumulator)
   */
  rrca() {
    const a = this.registers.get('A');
    const carry = (a & 0x01) !== 0;
    const result = (a >> 1 | (carry ? 0x80 : 0)) & 0xff;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, carry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (result & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (result & 0x08) !== 0);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * RLA (Rotate Left Accumulator)
   */
  rla() {
    const a = this.registers.get('A');
    const oldCarry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const newCarry = (a & 0x80) !== 0;
    const result = (a << 1 | oldCarry) & 0xff;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, newCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (result & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (result & 0x08) !== 0);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * RRA (Rotate Right Accumulator)
   */
  rra() {
    const a = this.registers.get('A');
    const oldCarry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 0x80 : 0;
    const newCarry = (a & 0x01) !== 0;
    const result = (a >> 1 | oldCarry) & 0xff;
    this.registers.set('A', result);
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, newCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (result & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (result & 0x08) !== 0);
    this.registers.set('F', newF);
    return 4; // cycles
  }

  /**
   * Process CB instruction on register
   */
  processRegister(operation, regName) {
    const value = this.registers.get(regName);
    let result;
    const cycles = 8;
    switch (operation) {
      case 'RLC':
        result = this.rlc(value);
        break;
      case 'RRC':
        result = this.rrc(value);
        break;
      case 'RL':
        result = this.rl(value);
        break;
      case 'RR':
        result = this.rr(value);
        break;
      case 'SLA':
        result = this.sla(value);
        break;
      case 'SRA':
        result = this.sra(value);
        break;
      case 'SLL':
        result = this.sll(value);
        break;
      case 'SRL':
        result = this.srl(value);
        break;
      default:
        return 0;
    }
    this.registers.set(regName, result);
    return cycles;
  }

  /**
   * Process CB instruction on (HL)
   */
  processHL(operation) {
    const addr = this.registers.getHL();
    const value = this.memory.readByte(addr);
    let result;
    const cycles = 15;
    switch (operation) {
      case 'RLC':
        result = this.rlc(value);
        break;
      case 'RRC':
        result = this.rrc(value);
        break;
      case 'RL':
        result = this.rl(value);
        break;
      case 'RR':
        result = this.rr(value);
        break;
      case 'SLA':
        result = this.sla(value);
        break;
      case 'SRA':
        result = this.sra(value);
        break;
      case 'SLL':
        result = this.sll(value);
        break;
      case 'SRL':
        result = this.srl(value);
        break;
      default:
        return 0;
    }
    this.memory.writeByte(addr, result);
    return cycles;
  }
}

/**
 * Miscellaneous Instructions
 * Handles NOP, HALT, DI, EI, EX operations and stack operations
 */
class MiscInstructions {
  constructor(registers, memory) {
    this.registers = registers;
    this.memory = memory;
  }

  /**
   * NOP
   */
  nop() {
    return 4; // cycles
  }

  /**
   * HALT
   */
  halt(cpu) {
    if (cpu) {
      cpu.halted = true;
    }
    return 4; // cycles
  }

  /**
   * DI (Disable Interrupts)
   */
  di(cpu) {
    if (cpu) {
      cpu.iff1 = false;
      cpu.iff2 = false;
      cpu.eiDelay = 0;
    }
    return 4; // cycles
  }

  /**
   * EI (Enable Interrupts)
   */
  ei(cpu) {
    if (cpu) {
      cpu.eiDelay = 2;
    }
    return 4; // cycles
  }

  /**
   * EX AF, AF'
   */
  exAF() {
    this.registers.exchangeAF();
    return 4; // cycles
  }

  /**
   * EXX
   */
  exx() {
    this.registers.exchangeAll();
    return 4; // cycles
  }

  /**
   * EX DE, HL
   */
  exDEHL() {
    this.registers.exchangeDE_HL();
    return 4; // cycles
  }

  /**
   * EX (SP), HL
   */
  exSPHL() {
    const spValue = this.memory.readWord(this.registers.get16('SP'));
    this.memory.writeWord(this.registers.get16('SP'), this.registers.getHL());
    this.registers.setHL(spValue);
    return 19; // cycles
  }

  /**
   * EX (SP), IX
   */
  exSPIX() {
    const spValue = this.memory.readWord(this.registers.get16('SP'));
    this.memory.writeWord(this.registers.get16('SP'), this.registers.get16('IX'));
    this.registers.set16('IX', spValue);
    return 23; // cycles
  }

  /**
   * EX (SP), IY
   */
  exSPIY() {
    const spValue = this.memory.readWord(this.registers.get16('SP'));
    this.memory.writeWord(this.registers.get16('SP'), this.registers.get16('IY'));
    this.registers.set16('IY', spValue);
    return 23; // cycles
  }

  /**
   * PUSH reg16
   */
  push(regName) {
    const value = this.registers.get16(regName);
    this.memory.pushWord(this.registers, value);
    if (regName === 'IX' || regName === 'IY') {
      return 15; // cycles
    }
    return 11; // cycles
  }

  /**
   * POP reg16
   */
  pop(regName) {
    const value = this.memory.popWord(this.registers);
    this.registers.set16(regName, value);
    if (regName === 'IX' || regName === 'IY') {
      return 14; // cycles
    }
    return 10; // cycles
  }

  /**
   * IN A, (n)
   */
  inAImmediate(port, io) {
    const a = this.registers.get('A');
    const fullPort = port | a << 8;
    this.registers.set('A', io.readPort(fullPort));
    return 11; // cycles
  }

  /**
   * OUT (n), A
   */
  outAImmediate(port, io) {
    const a = this.registers.get('A');
    const fullPort = port | a << 8;
    io.writePort(fullPort, a);
    return 11; // cycles
  }

  /**
   * IN reg, (C)
   */
  inRegC(regName, io, flags) {
    const port = this.registers.getBC();
    const value = io.readPort(port);
    if (regName !== null) {
      this.registers.set(regName, value);
    }
    // Note: When regName is null, this is the IN F,(C) instruction
    // where the value is read but discarded (only flags are affected)

    // Update flags
    const newF = flags.updateInFlags(this.registers.get('F'), value);
    this.registers.set('F', newF);
    return 12; // cycles
  }

  /**
   * OUT (C), reg
   */
  outRegC(regName, io) {
    const port = this.registers.getBC();
    const value = regName ? this.registers.get(regName) : 0;
    io.writePort(port, value);
    return 12; // cycles
  }

  /**
   * IM 0/1/2 (Set Interrupt Mode)
   */
  setInterruptMode(mode, cpu) {
    if (cpu) {
      cpu.interruptMode = mode;
    }
    return 8; // cycles
  }
}

/**
 * Extended Instructions (ED prefix)
 * Handles block operations, 16‐bit arithmetic, and other extended Z80 instructions
 *
 * Fixed P/V flag handling for the block I/O repeat instructions
 * (INIR, INDR, OTIR, OTDR). P/V is preserved through iterations and only
 * set to 0 on the final iteration when B becomes 0.
 * Carry flag (C) remains unmodified throughout, matching hardware behaviour.
 */
class ExtendedInstructions {
  constructor(registers, flags, memory, io) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
    this.io = io;
  }

  /* ------------------------------------------------------------ */
  /*                    Block transfer group                      */
  /* ------------------------------------------------------------ */

  /** LDI – Load and Increment */
  ldi() {
    const value = this.memory.readByte(this.registers.getHL());
    this.memory.writeByte(this.registers.getDE(), value);
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    this.registers.setDE(this.registers.getDE() + 1 & 0xffff);
    this.registers.setBC(this.registers.getBC() - 1 & 0xffff);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);

    // undocumented flags – A + value
    const n = this.registers.get('A') + value & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);
    this.registers.set('F', f);
    return 16;
  }

  /** LDIR – Load, Increment and Repeat */
  ldir() {
    const cycles = this.ldi();
    if (this.registers.getBC() !== 0) {
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21; // repeat form
    }
    return cycles;
  }

  /** LDD – Load and Decrement */
  ldd() {
    const value = this.memory.readByte(this.registers.getHL());
    this.memory.writeByte(this.registers.getDE(), value);
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    this.registers.setDE(this.registers.getDE() - 1 & 0xffff);
    this.registers.setBC(this.registers.getBC() - 1 & 0xffff);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);
    const n = this.registers.get('A') + value & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);
    this.registers.set('F', f);
    return 16;
  }

  /** LDDR – Load, Decrement and Repeat */
  lddr() {
    const cycles = this.ldd();
    if (this.registers.getBC() !== 0) {
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21;
    }
    return cycles;
  }

  /* ------------------------------------------------------------ */
  /*                  Compare & search block group                */
  /* ------------------------------------------------------------ */

  /** CPI – Compare and Increment */
  cpi() {
    const value = this.memory.readByte(this.registers.getHL());
    const a = this.registers.get('A');
    const result = a - value & 0xffff;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    this.registers.setBC(this.registers.getBC() - 1 & 0xffff);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xff) === 0);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);

    // Undocumented flags for CPI: F3/F5 are based on A - (HL) - H
    const n = (result & 0xff) - (halfBorrow ? 1 : 0) & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    this.registers.set('F', f);
    return 16;
  }

  /** CPIR – Compare, Increment and Repeat */
  cpir() {
    const cycles = this.cpi();
    const notEqual = !this.flags.getFlag(this.registers.get('F'), this.flags.masks.Z);
    if (this.registers.getBC() !== 0 && notEqual) {
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      let f = this.registers.get('F');
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      return 21;
    }
    // On successful match (Z=1), P/V must be 0 regardless of BC
    if (!notEqual) {
      let f = this.registers.get('F');
      f = this.flags.setFlag(f, this.flags.masks.PV, false);
      this.registers.set('F', f);
    }
    return cycles;
  }

  /** CPD – Compare and Decrement */
  cpd() {
    const value = this.memory.readByte(this.registers.getHL());
    const a = this.registers.get('A');
    const result = a - value & 0xffff;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    this.registers.setBC(this.registers.getBC() - 1 & 0xffff);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xff) === 0);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);

    // Undocumented flags for CPD: F3/F5 are based on A - (HL) - H
    const n = (result & 0xff) - (halfBorrow ? 1 : 0) & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    this.registers.set('F', f);
    return 16;
  }

  /** CPDR – Compare, Decrement and Repeat */
  cpdr() {
    const cycles = this.cpd();
    const notEqual = !this.flags.getFlag(this.registers.get('F'), this.flags.masks.Z);
    if (this.registers.getBC() !== 0 && notEqual) {
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      let f = this.registers.get('F');
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      return 21;
    }
    // On successful match (Z=1), P/V must be 0 regardless of BC
    if (!notEqual) {
      let f = this.registers.get('F');
      f = this.flags.setFlag(f, this.flags.masks.PV, false);
      this.registers.set('F', f);
    }
    return cycles;
  }

  /* ------------------------------------------------------------ */
  /*                    16‐bit arithmetic group                    */
  /* ------------------------------------------------------------ */

  sbcHL(value) {
    const carry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const hl = this.registers.getHL();
    const result = hl - value - carry & 0x1ffff; // 17‐bit to test carry

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, (result & 0x10000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.H, (hl & 0x0fff) - (value & 0x0fff) - carry < 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x8000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xffff) === 0);
    const overflow = ((hl ^ value) & 0x8000) !== 0 && ((hl ^ result) & 0x8000) !== 0;
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    const high = result >> 8 & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (high & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (high & 0x08) !== 0);
    this.registers.setHL(result & 0xffff);
    this.registers.set('F', f);
    return 15;
  }
  adcHL(value) {
    const carry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const hl = this.registers.getHL();
    const result = hl + value + carry & 0x1ffff;
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, (result & 0x10000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.H, (hl & 0x0fff) + (value & 0x0fff) + carry > 0x0fff);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x8000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xffff) === 0);
    const overflow = ((hl ^ value) & 0x8000) === 0 && ((hl ^ result) & 0x8000) !== 0;
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);
    const high = result >> 8 & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (high & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (high & 0x08) !== 0);
    this.registers.setHL(result & 0xffff);
    this.registers.set('F', f);
    return 15;
  }

  /* ------------------------------------------------------------ */
  /*                  Rotate decimal group (RLD/RRD)              */
  /* ------------------------------------------------------------ */

  rld() {
    const addr = this.registers.getHL();
    const mem = this.memory.readByte(addr);
    const a = this.registers.get('A');
    const newMem = (mem << 4 | a & 0x0f) & 0xff;
    const newA = a & 0xf0 | mem >> 4 & 0x0f;
    this.memory.writeByte(addr, newMem);
    this.registers.set('A', newA);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.updateFlags(f, newA, 'logical');
    this.registers.set('F', f);
    return 18;
  }
  rrd() {
    const addr = this.registers.getHL();
    const mem = this.memory.readByte(addr);
    const a = this.registers.get('A');
    const newMem = (a << 4 | mem >> 4) & 0xff;
    const newA = a & 0xf0 | mem & 0x0f;
    this.memory.writeByte(addr, newMem);
    this.registers.set('A', newA);
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.updateFlags(f, newA, 'logical');
    this.registers.set('F', f);
    return 18;
  }

  /* ------------------------------------------------------------ */
  /*                   I/O block transfer group                   */
  /* ------------------------------------------------------------ */

  /* Helper to apply Z and N for IN/OUT single‐step variants */
  _applyInOutFlags(preservePV = false) {
    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.Z, this.registers.get('B') === 0);
    f = this.flags.setFlag(f, this.flags.masks.N, false); // N is reset for I/O instructions

    // For non-repeat versions, set P/V based on B == 0
    if (!preservePV) {
      f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.get('B') === 0);
    }
    return f;
  }

  /* ---- Single‐step variants ---------------------------------- */

  ini() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }
  ind() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }
  outi() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }
  outd() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }

  /* ---- Repeat variants --------------------------------------- */

  inir() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }
  indr() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }
  otir() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL(this.registers.getHL() + 1 & 0xffff);
    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }
  otdr() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', this.registers.get('B') - 1 & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL(this.registers.getHL() - 1 & 0xffff);
    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC(this.registers.getPC() - 2 & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }
}

/**
 * Indexed Instructions (DD/FD prefix)
 * Handles IX and IY indexed operations
 */
class IndexedInstructions {
  constructor(registers, flags, memory, instructionFactories) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;

    // Use factories to avoid circular dependencies
    this.getArithmetic = instructionFactories.getArithmetic;
    this.getLogical = instructionFactories.getLogical;
    this.getLoad = instructionFactories.getLoad;
    this.getBit = instructionFactories.getBit;
  }

  /**
   * ADD IX/IY, reg16
   */
  addIndex(indexReg, value) {
    const index = this.registers.get16(indexReg);
    const result = index + value;
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, result > 0xffff);
    newF = this.flags.setFlag(newF, this.flags.masks.H, (index & 0x0fff) + (value & 0x0fff) > 0x0fff);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from high byte
    const highByte = result >> 8 & 0xff;
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (highByte & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (highByte & 0x08) !== 0);
    this.registers.set16(indexReg, result & 0xffff);
    this.registers.set('F', newF);
    return 15; // cycles
  }

  /**
   * LD reg, (IX/IY+d)
   */
  loadRegFromIndexed(regName, indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.registers.set(regName, this.memory.readByte(addr));
    return 19; // cycles
  }

  /**
   * LD (IX/IY+d), reg
   */
  loadIndexedFromReg(indexReg, displacement, regName) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.memory.writeByte(addr, this.registers.get(regName));
    return 19; // cycles
  }

  /**
   * LD (IX/IY+d), n
   */
  loadIndexedImmediate(indexReg, displacement, value) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    this.memory.writeByte(addr, value);
    return 19; // cycles
  }

  /**
   * Arithmetic operations with (IX/IY+d)
   */
  addAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().addA(value);
    return 19; // cycles
  }
  adcAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().adcA(value);
    return 19; // cycles
  }
  subAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().subA(value);
    return 19; // cycles
  }
  sbcAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().sbcA(value);
    return 19; // cycles
  }
  andAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().andA(value);
    return 19; // cycles
  }
  xorAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().xorA(value);
    return 19; // cycles
  }
  orAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().orA(value);
    return 19; // cycles
  }
  cpAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().cpA(value);
    return 19; // cycles
  }

  /**
   * INC (IX/IY+d)
   */
  incIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    const result = value + 1 & 0xff;
    this.memory.writeByte(addr, result);
    const newF = this.flags.updateIncFlags(this.registers.get('F'), value, result);
    this.registers.set('F', newF);
    return 23; // cycles
  }

  /**
   * DEC (IX/IY+d)
   */
  decIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    const result = value - 1 & 0xff;
    this.memory.writeByte(addr, result);
    const newF = this.flags.updateDecFlags(this.registers.get('F'), value, result);
    this.registers.set('F', newF);
    return 23; // cycles
  }

  /**
   * JP (IX/IY)
   */
  jumpIndexed(indexReg) {
    this.registers.setPC(this.registers.get16(indexReg));
    return 8; // cycles
  }

  /**
   * EX (SP), IX/IY
   */
  exchangeSPIndexed(indexReg) {
    const spValue = this.memory.readWord(this.registers.get16('SP'));
    this.memory.writeWord(this.registers.get16('SP'), this.registers.get16(indexReg));
    this.registers.set16(indexReg, spValue);
    return 23; // cycles
  }

  /**
   * PUSH IX/IY
   */
  pushIndexed(indexReg) {
    const value = this.registers.get16(indexReg);
    this.memory.pushWord(this.registers, value);
    return 15; // cycles
  }

  /**
   * POP IX/IY
   */
  popIndexed(indexReg) {
    const value = this.memory.popWord(this.registers);
    this.registers.set16(indexReg, value);
    return 14; // cycles
  }

  /**
   * Bit operations with (IX/IY+d)
   * These are complex operations that involve both reading and potentially writing
   */
  processIndexedBitOp(indexReg, displacement, operation, bit, targetReg = null) {
    const signedDisp = sign8(displacement);
    const addr = this.registers.get16(indexReg) + signedDisp & 0xffff;
    const value = this.memory.readByte(addr);
    const bitInst = this.getBit();
    let result;
    let cycles = 20; // Base cycles for indexed bit operations

    switch (operation) {
      case 'BIT':
        {
          // BIT operations don't modify memory, just test the bit
          const newF = this.flags.updateBitTestFlags(this.registers.get('F'), bit, value);
          this.registers.set('F', newF);
          return cycles;
        }
      case 'SET':
        result = value | 1 << bit;
        cycles = 23;
        break;
      case 'RES':
        result = value & ~(1 << bit);
        cycles = 23;
        break;
      case 'RLC':
        result = bitInst.rlc(value);
        cycles = 23;
        break;
      case 'RRC':
        result = bitInst.rrc(value);
        cycles = 23;
        break;
      case 'RL':
        result = bitInst.rl(value);
        cycles = 23;
        break;
      case 'RR':
        result = bitInst.rr(value);
        cycles = 23;
        break;
      case 'SLA':
        result = bitInst.sla(value);
        cycles = 23;
        break;
      case 'SRA':
        result = bitInst.sra(value);
        cycles = 23;
        break;
      case 'SLL':
        result = bitInst.sll(value);
        cycles = 23;
        break;
      case 'SRL':
        result = bitInst.srl(value);
        cycles = 23;
        break;
      default:
        return cycles;
    }

    // Store result in memory
    this.memory.writeByte(addr, result);

    // Also store in register if specified (undocumented behavior)
    if (targetReg && targetReg !== 'NONE') {
      this.registers.set(targetReg, result);
    }
    return cycles;
  }

  /**
   * Get register name from index (for DD/FD CB operations)
   */
  getRegisterFromIndex(index) {
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', 'NONE', 'A'];
    return regMap[index] || 'NONE';
  }

  /**
   * Process DDCB/FDCB instruction
   */
  processIndexedCB(indexReg, displacement, cbOpcode) {
    const regIndex = cbOpcode & 0x07;
    const targetReg = this.getRegisterFromIndex(regIndex);
    if ((cbOpcode & 0xc0) === 0x40) {
      // BIT operations (0x40-0x7F)
      const bit = cbOpcode >> 3 & 0x07;
      return this.processIndexedBitOp(indexReg, displacement, 'BIT', bit);
    }
    if ((cbOpcode & 0xc0) === 0x80) {
      // RES operations (0x80-0xBF)
      const bit = cbOpcode >> 3 & 0x07;
      return this.processIndexedBitOp(indexReg, displacement, 'RES', bit, targetReg);
    }
    if ((cbOpcode & 0xc0) === 0xc0) {
      // SET operations (0xC0-0xFF)
      const bit = cbOpcode >> 3 & 0x07;
      return this.processIndexedBitOp(indexReg, displacement, 'SET', bit, targetReg);
    }
    // Rotate/Shift operations (0x00-0x3F)
    const operation = cbOpcode & 0xf8;
    let opName;
    switch (operation) {
      case 0x00:
        opName = 'RLC';
        break;
      case 0x08:
        opName = 'RRC';
        break;
      case 0x10:
        opName = 'RL';
        break;
      case 0x18:
        opName = 'RR';
        break;
      case 0x20:
        opName = 'SLA';
        break;
      case 0x28:
        opName = 'SRA';
        break;
      case 0x30:
        opName = 'SLL';
        break;
      case 0x38:
        opName = 'SRL';
        break;
      default:
        return 23;
      // Unknown operation
    }
    return this.processIndexedBitOp(indexReg, displacement, opName, 0, targetReg);
  }
}

/**
 * Complete Instruction Decoder
 * Comprehensive opcode decoding and dispatch system for Z80 emulator
 *
 * Timing philosophy: Each instruction handler returns its TOTAL cycle count.
 * The decoder does NOT add extra cycles - it trusts the instruction's return value.
 */
class InstructionDecoder {
  constructor(registers, flags, memory, io, instructions) {
    this.registers = registers;
    this.flags = flags;
    this.memory = memory;
    this.io = io;
    this.instructions = instructions;

    // Build comprehensive instruction lookup tables
    this.buildAllInstructionTables();
  }
  buildAllInstructionTables() {
    this.mainTable = {};
    this.cbTable = {};
    this.edTable = {};
    this.ddTable = {};
    this.fdTable = {};
    this.ddcbTable = {};
    this.fdcbTable = {};
    this.buildMainTable();
    this.buildCBTable();
    this.buildEDTable();
    this.buildDDTable();
    this.buildFDTable();
  }
  buildMainTable() {
    const {
      logical,
      load
    } = this.instructions;

    // 8x8 grid of register-to-register loads (0x40-0x7F)
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];
    for (let dest = 0; dest < 8; dest++) {
      for (let src = 0; src < 8; src++) {
        if (dest === 6 && src === 6) {
          this.mainTable[0x76] = cpu => this.instructions.misc.halt(cpu); // HALT
          continue;
        }
        const opcode = 0x40 + (dest << 3) + src;
        if (dest === 6) {
          // LD (HL), reg
          this.mainTable[opcode] = () => load.loadHLFromReg(regMap[src]);
        } else if (src === 6) {
          // LD reg, (HL)
          this.mainTable[opcode] = () => load.loadRegFromHL(regMap[dest]);
        } else {
          // LD reg, reg
          this.mainTable[opcode] = () => load.loadRegReg(regMap[dest], regMap[src]);
        }
      }
    }

    // Arithmetic operations (0x80-0xBF)
    for (let i = 0; i < 8; i++) {
      const reg = regMap[i];
      if (reg) {
        // Arithmetic with registers - handlers return their own cycle count
        this.mainTable[0x80 + i] = () => this.instructions.arithmetic.addA(this.registers.get(reg));
        this.mainTable[0x88 + i] = () => this.instructions.arithmetic.adcA(this.registers.get(reg));
        this.mainTable[0x90 + i] = () => this.instructions.arithmetic.subA(this.registers.get(reg));
        this.mainTable[0x98 + i] = () => this.instructions.arithmetic.sbcA(this.registers.get(reg));
        this.mainTable[0xa0 + i] = () => logical.andA(this.registers.get(reg));
        this.mainTable[0xa8 + i] = () => logical.xorA(this.registers.get(reg));
        this.mainTable[0xb0 + i] = () => logical.orA(this.registers.get(reg));
        this.mainTable[0xb8 + i] = () => this.instructions.arithmetic.cpA(this.registers.get(reg));
      } else if (i === 6) {
        // Arithmetic with (HL)
        this.mainTable[0x86] = () => {
          this.instructions.arithmetic.addA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x8e] = () => {
          this.instructions.arithmetic.adcA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x96] = () => {
          this.instructions.arithmetic.subA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0x9e] = () => {
          this.instructions.arithmetic.sbcA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xa6] = () => {
          logical.andA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xae] = () => {
          logical.xorA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xb6] = () => {
          logical.orA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
        this.mainTable[0xbe] = () => {
          this.instructions.arithmetic.cpA(this.memory.readByte(this.registers.getHL()));
          return 7;
        };
      }
    }

    // All other main instructions
    this.buildMainInstructions();
  }
  buildMainInstructions() {
    const {
      logical,
      load,
      jump,
      bit
    } = this.instructions;

    // Basic instructions
    this.mainTable[0x00] = () => this.instructions.misc.nop(); // NOP

    // 16-bit loads
    this.mainTable[0x01] = () => load.loadReg16Immediate('BC', this.memory.fetchWord(this.registers));
    this.mainTable[0x11] = () => load.loadReg16Immediate('DE', this.memory.fetchWord(this.registers));
    this.mainTable[0x21] = () => load.loadReg16Immediate('HL', this.memory.fetchWord(this.registers));
    this.mainTable[0x31] = () => load.loadReg16Immediate('SP', this.memory.fetchWord(this.registers));

    // 8-bit immediate loads
    this.mainTable[0x06] = () => load.loadRegImmediate('B', this.memory.fetchByte(this.registers));
    this.mainTable[0x0e] = () => load.loadRegImmediate('C', this.memory.fetchByte(this.registers));
    this.mainTable[0x16] = () => load.loadRegImmediate('D', this.memory.fetchByte(this.registers));
    this.mainTable[0x1e] = () => load.loadRegImmediate('E', this.memory.fetchByte(this.registers));
    this.mainTable[0x26] = () => load.loadRegImmediate('H', this.memory.fetchByte(this.registers));
    this.mainTable[0x2e] = () => load.loadRegImmediate('L', this.memory.fetchByte(this.registers));
    this.mainTable[0x3e] = () => load.loadRegImmediate('A', this.memory.fetchByte(this.registers));
    this.mainTable[0x36] = () => load.loadHLImmediate(this.memory.fetchByte(this.registers));

    // Increments and decrements
    this.mainTable[0x04] = () => this.instructions.arithmetic.incReg('B');
    this.mainTable[0x0c] = () => this.instructions.arithmetic.incReg('C');
    this.mainTable[0x14] = () => this.instructions.arithmetic.incReg('D');
    this.mainTable[0x1c] = () => this.instructions.arithmetic.incReg('E');
    this.mainTable[0x24] = () => this.instructions.arithmetic.incReg('H');
    this.mainTable[0x2c] = () => this.instructions.arithmetic.incReg('L');
    this.mainTable[0x3c] = () => this.instructions.arithmetic.incReg('A');
    this.mainTable[0x34] = () => this.instructions.arithmetic.incHL();
    this.mainTable[0x05] = () => this.instructions.arithmetic.decReg('B');
    this.mainTable[0x0d] = () => this.instructions.arithmetic.decReg('C');
    this.mainTable[0x15] = () => this.instructions.arithmetic.decReg('D');
    this.mainTable[0x1d] = () => this.instructions.arithmetic.decReg('E');
    this.mainTable[0x25] = () => this.instructions.arithmetic.decReg('H');
    this.mainTable[0x2d] = () => this.instructions.arithmetic.decReg('L');
    this.mainTable[0x3d] = () => this.instructions.arithmetic.decReg('A');
    this.mainTable[0x35] = () => this.instructions.arithmetic.decHL();

    // 16-bit arithmetic
    this.mainTable[0x03] = () => {
      this.registers.inc16('BC');
      return 6;
    };
    this.mainTable[0x13] = () => {
      this.registers.inc16('DE');
      return 6;
    };
    this.mainTable[0x23] = () => {
      this.registers.inc16('HL');
      return 6;
    };
    this.mainTable[0x33] = () => {
      this.registers.inc16('SP');
      return 6;
    };
    this.mainTable[0x0b] = () => {
      this.registers.dec16('BC');
      return 6;
    };
    this.mainTable[0x1b] = () => {
      this.registers.dec16('DE');
      return 6;
    };
    this.mainTable[0x2b] = () => {
      this.registers.dec16('HL');
      return 6;
    };
    this.mainTable[0x3b] = () => {
      this.registers.dec16('SP');
      return 6;
    };

    // ADD HL, reg16
    this.mainTable[0x09] = () => this.instructions.arithmetic.addHL(this.registers.getBC());
    this.mainTable[0x19] = () => this.instructions.arithmetic.addHL(this.registers.getDE());
    this.mainTable[0x29] = () => this.instructions.arithmetic.addHL(this.registers.getHL());
    this.mainTable[0x39] = () => this.instructions.arithmetic.addHL(this.registers.get16('SP'));

    // Immediate arithmetic - handlers return base cycles, we add fetch cycles
    this.mainTable[0xc6] = () => {
      this.instructions.arithmetic.addA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xce] = () => {
      this.instructions.arithmetic.adcA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xd6] = () => {
      this.instructions.arithmetic.subA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xde] = () => {
      this.instructions.arithmetic.sbcA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xe6] = () => {
      logical.andA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xee] = () => {
      logical.xorA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xf6] = () => {
      logical.orA(this.memory.fetchByte(this.registers));
      return 7;
    };
    this.mainTable[0xfe] = () => {
      this.instructions.arithmetic.cpA(this.memory.fetchByte(this.registers));
      return 7;
    };

    // Jumps and calls
    this.mainTable[0xc3] = () => jump.jump(this.memory.fetchWord(this.registers));
    this.mainTable[0x18] = () => jump.jumpRelative(this.memory.fetchByte(this.registers));
    this.mainTable[0xe9] = () => jump.jumpHL();
    this.mainTable[0xcd] = () => jump.call(this.memory.fetchWord(this.registers));
    this.mainTable[0xc9] = () => jump.ret();

    // Conditional operations
    this.addConditionalInstructions();

    // Stack operations
    this.mainTable[0xc5] = () => this.instructions.misc.push('BC');
    this.mainTable[0xd5] = () => this.instructions.misc.push('DE');
    this.mainTable[0xe5] = () => this.instructions.misc.push('HL');
    this.mainTable[0xf5] = () => this.instructions.misc.push('AF');
    this.mainTable[0xc1] = () => this.instructions.misc.pop('BC');
    this.mainTable[0xd1] = () => this.instructions.misc.pop('DE');
    this.mainTable[0xe1] = () => this.instructions.misc.pop('HL');
    this.mainTable[0xf1] = () => this.instructions.misc.pop('AF');

    // Rotates
    this.mainTable[0x07] = () => bit.rlca();
    this.mainTable[0x0f] = () => bit.rrca();
    this.mainTable[0x17] = () => bit.rla();
    this.mainTable[0x1f] = () => bit.rra();

    // Misc operations
    this.mainTable[0x37] = () => logical.scf();
    this.mainTable[0x3f] = () => logical.ccf();
    this.mainTable[0x27] = () => logical.daa();
    this.mainTable[0x2f] = () => logical.cpl();

    // Interrupt control
    this.mainTable[0xf3] = cpu => this.instructions.misc.di(cpu);
    this.mainTable[0xfb] = cpu => this.instructions.misc.ei(cpu);

    // Exchange operations
    this.mainTable[0x08] = () => this.instructions.misc.exAF();
    this.mainTable[0xd9] = () => this.instructions.misc.exx();
    this.mainTable[0xeb] = () => this.instructions.misc.exDEHL();
    this.mainTable[0xe3] = () => this.instructions.misc.exSPHL();

    // I/O
    this.mainTable[0xdb] = () => this.instructions.misc.inAImmediate(this.memory.fetchByte(this.registers), this.io);
    this.mainTable[0xd3] = () => this.instructions.misc.outAImmediate(this.memory.fetchByte(this.registers), this.io);

    // Memory operations
    this.addMemoryInstructions();

    // RST instructions
    this.addRSTInstructions();

    // DJNZ
    this.mainTable[0x10] = () => jump.djnz(this.memory.fetchByte(this.registers));

    // LD SP, HL
    this.mainTable[0xf9] = () => load.loadSPFromHL();

    // Prefixed instructions
    this.mainTable[0xcb] = cpu => this.executeCBInstruction(cpu);
    this.mainTable[0xed] = cpu => this.executeEDInstruction(cpu);
    this.mainTable[0xdd] = cpu => this.executeDDInstruction(cpu);
    this.mainTable[0xfd] = cpu => this.executeFDInstruction(cpu);
  }
  addConditionalInstructions() {
    const {
      jump
    } = this.instructions;

    // Conditional jumps
    this.mainTable[0xc2] = () => jump.jumpConditional('NZ', this.memory.fetchWord(this.registers));
    this.mainTable[0xca] = () => jump.jumpConditional('Z', this.memory.fetchWord(this.registers));
    this.mainTable[0xd2] = () => jump.jumpConditional('NC', this.memory.fetchWord(this.registers));
    this.mainTable[0xda] = () => jump.jumpConditional('C', this.memory.fetchWord(this.registers));
    this.mainTable[0xe2] = () => jump.jumpConditional('PO', this.memory.fetchWord(this.registers));
    this.mainTable[0xea] = () => jump.jumpConditional('PE', this.memory.fetchWord(this.registers));
    this.mainTable[0xf2] = () => jump.jumpConditional('P', this.memory.fetchWord(this.registers));
    this.mainTable[0xfa] = () => jump.jumpConditional('M', this.memory.fetchWord(this.registers));

    // Conditional relative jumps
    this.mainTable[0x20] = () => jump.jumpRelativeConditional('NZ', this.memory.fetchByte(this.registers));
    this.mainTable[0x28] = () => jump.jumpRelativeConditional('Z', this.memory.fetchByte(this.registers));
    this.mainTable[0x30] = () => jump.jumpRelativeConditional('NC', this.memory.fetchByte(this.registers));
    this.mainTable[0x38] = () => jump.jumpRelativeConditional('C', this.memory.fetchByte(this.registers));

    // Conditional calls
    this.mainTable[0xc4] = () => jump.callConditional('NZ', this.memory.fetchWord(this.registers));
    this.mainTable[0xcc] = () => jump.callConditional('Z', this.memory.fetchWord(this.registers));
    this.mainTable[0xd4] = () => jump.callConditional('NC', this.memory.fetchWord(this.registers));
    this.mainTable[0xdc] = () => jump.callConditional('C', this.memory.fetchWord(this.registers));
    this.mainTable[0xe4] = () => jump.callConditional('PO', this.memory.fetchWord(this.registers));
    this.mainTable[0xec] = () => jump.callConditional('PE', this.memory.fetchWord(this.registers));
    this.mainTable[0xf4] = () => jump.callConditional('P', this.memory.fetchWord(this.registers));
    this.mainTable[0xfc] = () => jump.callConditional('M', this.memory.fetchWord(this.registers));

    // Conditional returns
    this.mainTable[0xc0] = () => jump.retConditional('NZ');
    this.mainTable[0xc8] = () => jump.retConditional('Z');
    this.mainTable[0xd0] = () => jump.retConditional('NC');
    this.mainTable[0xd8] = () => jump.retConditional('C');
    this.mainTable[0xe0] = () => jump.retConditional('PO');
    this.mainTable[0xe8] = () => jump.retConditional('PE');
    this.mainTable[0xf0] = () => jump.retConditional('P');
    this.mainTable[0xf8] = () => jump.retConditional('M');
  }
  addMemoryInstructions() {
    const {
      load
    } = this.instructions;
    this.mainTable[0x02] = () => load.loadBCFromA();
    this.mainTable[0x12] = () => load.loadDEFromA();
    this.mainTable[0x0a] = () => load.loadAFromBC();
    this.mainTable[0x1a] = () => load.loadAFromDE();
    this.mainTable[0x22] = () => load.loadAddressFromHL(this.memory.fetchWord(this.registers));
    this.mainTable[0x2a] = () => load.loadHLFromAddress(this.memory.fetchWord(this.registers));
    this.mainTable[0x32] = () => load.loadAddressFromA(this.memory.fetchWord(this.registers));
    this.mainTable[0x3a] = () => load.loadAFromAddress(this.memory.fetchWord(this.registers));
    this.mainTable[0x77] = () => load.loadHLFromReg('A');
    this.mainTable[0x7e] = () => load.loadRegFromHL('A');
  }
  addRSTInstructions() {
    const {
      jump
    } = this.instructions;
    this.mainTable[0xc7] = () => jump.rst(0x00);
    this.mainTable[0xcf] = () => jump.rst(0x08);
    this.mainTable[0xd7] = () => jump.rst(0x10);
    this.mainTable[0xdf] = () => jump.rst(0x18);
    this.mainTable[0xe7] = () => jump.rst(0x20);
    this.mainTable[0xef] = () => jump.rst(0x28);
    this.mainTable[0xf7] = () => jump.rst(0x30);
    this.mainTable[0xff] = () => jump.rst(0x38);
  }
  buildCBTable() {
    const {
      bit
    } = this.instructions;
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];

    // Build all CB instructions systematically
    for (let opcode = 0x00; opcode <= 0xff; opcode++) {
      const reg = regMap[opcode & 0x07];
      const isHL = (opcode & 0x07) === 6;
      if ((opcode & 0xc0) === 0x40) {
        // BIT operations (0x40-0x7F)
        const bitNum = opcode >> 3 & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.bitTest(bitNum, this.memory.readByte(this.registers.getHL()), true);
        } else {
          this.cbTable[opcode] = () => bit.bitTest(bitNum, this.registers.get(reg), false);
        }
      } else if ((opcode & 0xc0) === 0x80) {
        // RES operations (0x80-0xBF)
        const bitNum = opcode >> 3 & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.resBitHL(bitNum);
        } else {
          this.cbTable[opcode] = () => bit.resBitReg(bitNum, reg);
        }
      } else if ((opcode & 0xc0) === 0xc0) {
        // SET operations (0xC0-0xFF)
        const bitNum = opcode >> 3 & 0x07;
        if (isHL) {
          this.cbTable[opcode] = () => bit.setBitHL(bitNum);
        } else {
          this.cbTable[opcode] = () => bit.setBitReg(bitNum, reg);
        }
      } else {
        // Rotate/Shift operations (0x00-0x3F)
        const operation = opcode & 0xf8;
        let opName;
        switch (operation) {
          case 0x00:
            opName = 'RLC';
            break;
          case 0x08:
            opName = 'RRC';
            break;
          case 0x10:
            opName = 'RL';
            break;
          case 0x18:
            opName = 'RR';
            break;
          case 0x20:
            opName = 'SLA';
            break;
          case 0x28:
            opName = 'SRA';
            break;
          case 0x30:
            opName = 'SLL';
            break;
          case 0x38:
            opName = 'SRL';
            break;
          default:
            continue;
        }
        if (isHL) {
          this.cbTable[opcode] = () => bit.processHL(opName);
        } else {
          this.cbTable[opcode] = () => bit.processRegister(opName, reg);
        }
      }
    }
  }
  buildEDTable() {
    const {
      extended
    } = this.instructions;

    // Block operations
    this.edTable[0xa0] = () => extended.ldi();
    this.edTable[0xb0] = () => extended.ldir();
    this.edTable[0xa8] = () => extended.ldd();
    this.edTable[0xb8] = () => extended.lddr();
    this.edTable[0xa1] = () => extended.cpi();
    this.edTable[0xb1] = () => extended.cpir();
    this.edTable[0xa9] = () => extended.cpd();
    this.edTable[0xb9] = () => extended.cpdr();

    // 16-bit arithmetic
    this.edTable[0x42] = () => extended.sbcHL(this.registers.getBC());
    this.edTable[0x52] = () => extended.sbcHL(this.registers.getDE());
    this.edTable[0x62] = () => extended.sbcHL(this.registers.getHL());
    this.edTable[0x72] = () => extended.sbcHL(this.registers.get16('SP'));
    this.edTable[0x4a] = () => extended.adcHL(this.registers.getBC());
    this.edTable[0x5a] = () => extended.adcHL(this.registers.getDE());
    this.edTable[0x6a] = () => extended.adcHL(this.registers.getHL());
    this.edTable[0x7a] = () => extended.adcHL(this.registers.get16('SP'));

    // Decimal operations
    this.edTable[0x6f] = () => extended.rld();
    this.edTable[0x67] = () => extended.rrd();

    // NEG
    for (let i = 0x44; i <= 0x7c; i += 8) {
      this.edTable[i] = () => this.instructions.arithmetic.neg();
    }

    // I/O operations
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];
    for (let i = 0; i < 8; i++) {
      const reg = regMap[i];
      if (reg) {
        this.edTable[0x40 + (i << 3)] = () => this.instructions.misc.inRegC(reg, this.io, this.flags);
        this.edTable[0x41 + (i << 3)] = () => this.instructions.misc.outRegC(reg, this.io);
      } else {
        // Special case for F register
        this.edTable[0x70] = () => this.instructions.misc.inRegC(null, this.io, this.flags);
        this.edTable[0x71] = () => this.instructions.misc.outRegC(null, this.io);
      }
    }

    // I/O block operations
    this.edTable[0xa2] = () => extended.ini();
    this.edTable[0xb2] = () => extended.inir();
    this.edTable[0xa3] = () => extended.outi();
    this.edTable[0xb3] = () => extended.otir();
    this.edTable[0xaa] = () => extended.ind();
    this.edTable[0xba] = () => extended.indr();
    this.edTable[0xab] = () => extended.outd();
    this.edTable[0xbb] = () => extended.otdr();

    // Interrupt mode
    this.addInterruptModeInstructions();

    // Return instructions
    this.addEDReturnInstructions();

    // 16-bit load operations
    this.addED16BitLoads();

    // Add undocumented ED instructions
    this.addUndocumentedEDInstructions();
  }
  addInterruptModeInstructions() {
    // IM 0
    this.edTable[0x46] = this.edTable[0x4e] = this.edTable[0x66] = this.edTable[0x6e] = cpu => this.instructions.misc.setInterruptMode(0, cpu);

    // IM 1
    this.edTable[0x56] = this.edTable[0x76] = cpu => this.instructions.misc.setInterruptMode(1, cpu);

    // IM 2
    this.edTable[0x5e] = this.edTable[0x7e] = cpu => this.instructions.misc.setInterruptMode(2, cpu);
  }
  addEDReturnInstructions() {
    const {
      jump
    } = this.instructions;

    // RETI
    this.edTable[0x4d] = () => jump.reti();

    // RETN
    this.edTable[0x45] = this.edTable[0x55] = this.edTable[0x5d] = this.edTable[0x65] = this.edTable[0x6d] = this.edTable[0x75] = this.edTable[0x7d] = cpu => this.instructions.jump.retn(cpu);
  }
  addED16BitLoads() {
    const {
      load
    } = this.instructions;

    // LD (nn), reg16
    this.edTable[0x43] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'BC');
    this.edTable[0x53] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'DE');
    this.edTable[0x63] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'HL');
    this.edTable[0x73] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), 'SP');

    // LD reg16, (nn)
    this.edTable[0x4b] = () => load.loadReg16FromAddress('BC', this.memory.fetchWord(this.registers));
    this.edTable[0x5b] = () => load.loadReg16FromAddress('DE', this.memory.fetchWord(this.registers));
    this.edTable[0x6b] = () => load.loadReg16FromAddress('HL', this.memory.fetchWord(this.registers));
    this.edTable[0x7b] = () => load.loadReg16FromAddress('SP', this.memory.fetchWord(this.registers));

    // LD I/R operations
    this.edTable[0x47] = () => load.loadIFromA();
    this.edTable[0x4f] = () => load.loadRFromA();
    this.edTable[0x57] = () => load.loadAFromI();
    this.edTable[0x5f] = () => load.loadAFromR();
  }
  addUndocumentedEDInstructions() {
    // Add all undocumented ED instructions as NOPs
    const undocumentedOpcodes = [
    // Row 0x0X - all undocumented
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    // Row 0x1X - all undocumented
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    // Row 0x2X - all undocumented
    0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f,
    // Row 0x3X - all undocumented
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
    // Additional undocumented opcodes
    0x77, 0x7f,
    // Row 0x8X - all undocumented
    0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f,
    // Row 0x9X - all undocumented
    0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f,
    // Row 0xAX gaps
    0xa4, 0xa5, 0xa6, 0xa7, 0xac, 0xad, 0xae, 0xaf,
    // Row 0xBX gaps
    0xb4, 0xb5, 0xb6, 0xb7, 0xbc, 0xbd, 0xbe, 0xbf,
    // Row 0xCX - all undocumented
    0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf,
    // Row 0xDX - all undocumented
    0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf,
    // Row 0xEX - all undocumented
    0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
    // Row 0xFX - all undocumented
    0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff];

    // Add all undocumented opcodes as NOPs (they don't modify state)
    undocumentedOpcodes.forEach(opcode => {
      if (!this.edTable[opcode]) {
        this.edTable[opcode] = _cpu =>
        // Undocumented ED instruction - acts as 2-byte NOP
        8; // Standard ED instruction timing
      }
    });
  }
  buildDDTable() {
    // DD prefix instructions for IX operations
    this.buildIndexedTable('IX', this.ddTable);
  }
  buildFDTable() {
    // FD prefix instructions for IY operations
    this.buildIndexedTable('IY', this.fdTable);
  }
  buildIndexedTable(indexReg, table) {
    const {
      indexed,
      load
    } = this.instructions;

    // Basic IX/IY operations
    table[0x21] = () => load.loadReg16Immediate(indexReg, this.memory.fetchWord(this.registers));
    table[0x22] = () => load.loadAddressFromReg16(this.memory.fetchWord(this.registers), indexReg);
    table[0x2a] = () => load.loadReg16FromAddress(indexReg, this.memory.fetchWord(this.registers));
    table[0x23] = () => {
      this.registers.inc16(indexReg);
      return 10;
    };
    table[0x2b] = () => {
      this.registers.dec16(indexReg);
      return 10;
    };

    // ADD IX/IY, reg16
    table[0x09] = () => indexed.addIndex(indexReg, this.registers.getBC());
    table[0x19] = () => indexed.addIndex(indexReg, this.registers.getDE());
    table[0x29] = () => indexed.addIndex(indexReg, this.registers.get16(indexReg));
    table[0x39] = () => indexed.addIndex(indexReg, this.registers.get16('SP'));

    // Indexed memory operations
    table[0x7e] = () => indexed.loadRegFromIndexed('A', indexReg, this.memory.fetchByte(this.registers));
    table[0x77] = () => indexed.loadIndexedFromReg(indexReg, this.memory.fetchByte(this.registers), 'A');
    table[0x36] = () => {
      const disp = this.memory.fetchByte(this.registers);
      const value = this.memory.fetchByte(this.registers);
      return indexed.loadIndexedImmediate(indexReg, disp, value);
    };

    // More indexed loads
    this.addIndexedLoads(table, indexReg, indexed);

    // Indexed arithmetic
    this.addIndexedArithmetic(table, indexReg, indexed);

    // Misc indexed operations
    table[0xe9] = () => indexed.jumpIndexed(indexReg);
    table[0xe3] = () => indexed.exchangeSPIndexed(indexReg);
    table[0xe5] = () => indexed.pushIndexed(indexReg);
    table[0xe1] = () => indexed.popIndexed(indexReg);

    // CB prefix for indexed bit operations
    table[0xcb] = _cpu => this.executeIndexedCBInstruction(_cpu, indexReg);
  }
  addIndexedLoads(table, indexReg, indexed) {
    const regMap = ['B', 'C', 'D', 'E', 'H', 'L', null, 'A'];

    // LD reg, (IX/IY+d)
    const loadOpcodes = [0x46, 0x4e, 0x56, 0x5e, 0x66, 0x6e, null, 0x7e];
    for (let i = 0; i < loadOpcodes.length; i++) {
      if (loadOpcodes[i] && regMap[i]) {
        table[loadOpcodes[i]] = () => {
          const disp = this.memory.fetchByte(this.registers);
          return indexed.loadRegFromIndexed(regMap[i], indexReg, disp);
        };
      }
    }

    // LD (IX/IY+d), reg
    const storeOpcodes = [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, null, 0x77];
    for (let i = 0; i < storeOpcodes.length; i++) {
      if (storeOpcodes[i] && regMap[i]) {
        table[storeOpcodes[i]] = () => {
          const disp = this.memory.fetchByte(this.registers);
          return indexed.loadIndexedFromReg(indexReg, disp, regMap[i]);
        };
      }
    }
  }
  addIndexedArithmetic(table, indexReg, indexed) {
    // Arithmetic with (IX/IY+d)
    table[0x86] = () => indexed.addAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x8e] = () => indexed.adcAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x96] = () => indexed.subAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x9e] = () => indexed.sbcAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xa6] = () => indexed.andAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xae] = () => indexed.xorAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xb6] = () => indexed.orAIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0xbe] = () => indexed.cpAIndexed(indexReg, this.memory.fetchByte(this.registers));

    // INC/DEC (IX/IY+d)
    table[0x34] = () => indexed.incIndexed(indexReg, this.memory.fetchByte(this.registers));
    table[0x35] = () => indexed.decIndexed(indexReg, this.memory.fetchByte(this.registers));
  }

  // Main instruction execution
  execute(opcode, cpu = null) {
    const handler = this.mainTable[opcode];
    if (handler) {
      return handler(cpu);
    }
    console.warn(`Unimplemented opcode: 0x${opcode.toString(16).padStart(2, '0')} at PC: 0x${(this.registers.getPC() - 1).toString(16).padStart(4, '0')}`);
    return 4; // Default cycles
  }

  // Prefixed instruction handlers
  executeCBInstruction() {
    this.registers.incrementR();
    const cbOpcode = this.memory.fetchByte(this.registers);
    const handler = this.cbTable[cbOpcode];
    if (handler) {
      return handler();
    }
    console.warn(`Unimplemented CB opcode: 0x${cbOpcode.toString(16).padStart(2, '0')}`);
    return 8;
  }
  executeEDInstruction(cpu) {
    this.registers.incrementR();
    const edOpcode = this.memory.fetchByte(this.registers);
    const handler = this.edTable[edOpcode];
    if (handler) {
      return handler(cpu);
    }
    // Many ED opcodes act as NOPs
    return 8;
  }
  executeDDInstruction(cpu) {
    const ddOpcode = this.memory.fetchByte(this.registers);
    const handler = this.ddTable[ddOpcode];
    if (handler) {
      this.registers.incrementR(); // Only increment R if we handle the instruction
      return handler(cpu);
    }
    // Handle undocumented IXH/IXL opcodes
    switch (ddOpcode) {
      // LD reg,IXH
      case 0x44:
        this.registers.set('B', this.registers.getIXH());
        return 8;
      case 0x4c:
        this.registers.set('C', this.registers.getIXH());
        return 8;
      case 0x54:
        this.registers.set('D', this.registers.getIXH());
        return 8;
      case 0x5c:
        this.registers.set('E', this.registers.getIXH());
        return 8;
      case 0x7c:
        this.registers.set('A', this.registers.getIXH());
        return 8;

      // LD reg,IXL
      case 0x45:
        this.registers.set('B', this.registers.getIXL());
        return 8;
      case 0x4d:
        this.registers.set('C', this.registers.getIXL());
        return 8;
      case 0x55:
        this.registers.set('D', this.registers.getIXL());
        return 8;
      case 0x5d:
        this.registers.set('E', this.registers.getIXL());
        return 8;
      case 0x7d:
        this.registers.set('A', this.registers.getIXL());
        return 8;

      // LD IXH,reg
      case 0x60:
        this.registers.setIXH(this.registers.get('B'));
        return 8;
      case 0x61:
        this.registers.setIXH(this.registers.get('C'));
        return 8;
      case 0x62:
        this.registers.setIXH(this.registers.get('D'));
        return 8;
      case 0x63:
        this.registers.setIXH(this.registers.get('E'));
        return 8;
      case 0x67:
        this.registers.setIXH(this.registers.get('A'));
        return 8;

      // LD IXL,reg
      case 0x68:
        this.registers.setIXL(this.registers.get('B'));
        return 8;
      case 0x69:
        this.registers.setIXL(this.registers.get('C'));
        return 8;
      case 0x6a:
        this.registers.setIXL(this.registers.get('D'));
        return 8;
      case 0x6b:
        this.registers.setIXL(this.registers.get('E'));
        return 8;
      case 0x6f:
        this.registers.setIXL(this.registers.get('A'));
        return 8;

      // LD IXH,IXH / LD IXL,IXL (NOPs effectively)
      case 0x64:
        return 8;
      // LD IXH,IXH
      case 0x6d:
        return 8;
      // LD IXL,IXL

      // LD IXH,IXL / LD IXL,IXH
      case 0x65:
        this.registers.setIXH(this.registers.getIXL());
        return 8;
      case 0x6c:
        this.registers.setIXL(this.registers.getIXH());
        return 8;

      // Arithmetic with IXH
      case 0x84:
        this.instructions.arithmetic.addA(this.registers.getIXH());
        return 8;
      case 0x85:
        this.instructions.arithmetic.addA(this.registers.getIXL());
        return 8;
      case 0x8c:
        this.instructions.arithmetic.adcA(this.registers.getIXH());
        return 8;
      case 0x8d:
        this.instructions.arithmetic.adcA(this.registers.getIXL());
        return 8;
      case 0x94:
        this.instructions.arithmetic.subA(this.registers.getIXH());
        return 8;
      case 0x95:
        this.instructions.arithmetic.subA(this.registers.getIXL());
        return 8;
      case 0x9c:
        this.instructions.arithmetic.sbcA(this.registers.getIXH());
        return 8;
      case 0x9d:
        this.instructions.arithmetic.sbcA(this.registers.getIXL());
        return 8;

      // Logical with IXH/IXL
      case 0xa4:
        this.instructions.logical.andA(this.registers.getIXH());
        return 8;
      case 0xa5:
        this.instructions.logical.andA(this.registers.getIXL());
        return 8;
      case 0xac:
        this.instructions.logical.xorA(this.registers.getIXH());
        return 8;
      case 0xad:
        this.instructions.logical.xorA(this.registers.getIXL());
        return 8;
      case 0xb4:
        this.instructions.logical.orA(this.registers.getIXH());
        return 8;
      case 0xb5:
        this.instructions.logical.orA(this.registers.getIXL());
        return 8;
      case 0xbc:
        this.instructions.arithmetic.cpA(this.registers.getIXH());
        return 8;
      case 0xbd:
        this.instructions.arithmetic.cpA(this.registers.getIXL());
        return 8;

      // INC/DEC IXH/IXL
      case 0x24:
        {
          const result = this.instructions.arithmetic.inc8(this.registers.getIXH());
          this.registers.setIXH(result);
          return 8;
        }
      case 0x25:
        {
          const result = this.instructions.arithmetic.dec8(this.registers.getIXH());
          this.registers.setIXH(result);
          return 8;
        }
      case 0x2c:
        {
          const result = this.instructions.arithmetic.inc8(this.registers.getIXL());
          this.registers.setIXL(result);
          return 8;
        }
      case 0x2d:
        {
          const result = this.instructions.arithmetic.dec8(this.registers.getIXL());
          this.registers.setIXL(result);
          return 8;
        }

      // LD IXH/IXL,n
      case 0x26:
        this.registers.setIXH(this.memory.fetchByte(this.registers));
        return 11;
      case 0x2e:
        this.registers.setIXL(this.memory.fetchByte(this.registers));
        return 11;
      default:
        // If no DD handler, execute as normal instruction WITHOUT the prefix
        // Don't increment R again since main execute will do it
        return this.execute(ddOpcode, cpu);
    }
  }
  executeFDInstruction(cpu) {
    const fdOpcode = this.memory.fetchByte(this.registers);
    const handler = this.fdTable[fdOpcode];
    if (handler) {
      this.registers.incrementR(); // Only increment R if we handle the instruction
      return handler(cpu);
    }
    // Handle undocumented IYH/IYL opcodes
    switch (fdOpcode) {
      // LD reg,IYH
      case 0x44:
        this.registers.set('B', this.registers.getIYH());
        return 8;
      case 0x4c:
        this.registers.set('C', this.registers.getIYH());
        return 8;
      case 0x54:
        this.registers.set('D', this.registers.getIYH());
        return 8;
      case 0x5c:
        this.registers.set('E', this.registers.getIYH());
        return 8;
      case 0x7c:
        this.registers.set('A', this.registers.getIYH());
        return 8;

      // LD reg,IYL
      case 0x45:
        this.registers.set('B', this.registers.getIYL());
        return 8;
      case 0x4d:
        this.registers.set('C', this.registers.getIYL());
        return 8;
      case 0x55:
        this.registers.set('D', this.registers.getIYL());
        return 8;
      case 0x5d:
        this.registers.set('E', this.registers.getIYL());
        return 8;
      case 0x7d:
        this.registers.set('A', this.registers.getIYL());
        return 8;

      // LD IYH,reg
      case 0x60:
        this.registers.setIYH(this.registers.get('B'));
        return 8;
      case 0x61:
        this.registers.setIYH(this.registers.get('C'));
        return 8;
      case 0x62:
        this.registers.setIYH(this.registers.get('D'));
        return 8;
      case 0x63:
        this.registers.setIYH(this.registers.get('E'));
        return 8;
      case 0x67:
        this.registers.setIYH(this.registers.get('A'));
        return 8;

      // LD IYL,reg
      case 0x68:
        this.registers.setIYL(this.registers.get('B'));
        return 8;
      case 0x69:
        this.registers.setIYL(this.registers.get('C'));
        return 8;
      case 0x6a:
        this.registers.setIYL(this.registers.get('D'));
        return 8;
      case 0x6b:
        this.registers.setIYL(this.registers.get('E'));
        return 8;
      case 0x6f:
        this.registers.setIYL(this.registers.get('A'));
        return 8;

      // LD IYH,IYH / LD IYL,IYL (NOPs effectively)
      case 0x64:
        return 8;
      // LD IYH,IYH
      case 0x6d:
        return 8;
      // LD IYL,IYL

      // LD IYH,IYL / LD IYL,IYH
      case 0x65:
        this.registers.setIYH(this.registers.getIYL());
        return 8;
      case 0x6c:
        this.registers.setIYL(this.registers.getIYH());
        return 8;

      // Arithmetic with IYH
      case 0x84:
        this.instructions.arithmetic.addA(this.registers.getIYH());
        return 8;
      case 0x85:
        this.instructions.arithmetic.addA(this.registers.getIYL());
        return 8;
      case 0x8c:
        this.instructions.arithmetic.adcA(this.registers.getIYH());
        return 8;
      case 0x8d:
        this.instructions.arithmetic.adcA(this.registers.getIYL());
        return 8;
      case 0x94:
        this.instructions.arithmetic.subA(this.registers.getIYH());
        return 8;
      case 0x95:
        this.instructions.arithmetic.subA(this.registers.getIYL());
        return 8;
      case 0x9c:
        this.instructions.arithmetic.sbcA(this.registers.getIYH());
        return 8;
      case 0x9d:
        this.instructions.arithmetic.sbcA(this.registers.getIYL());
        return 8;

      // Logical with IYH/IYL
      case 0xa4:
        this.instructions.logical.andA(this.registers.getIYH());
        return 8;
      case 0xa5:
        this.instructions.logical.andA(this.registers.getIYL());
        return 8;
      case 0xac:
        this.instructions.logical.xorA(this.registers.getIYH());
        return 8;
      case 0xad:
        this.instructions.logical.xorA(this.registers.getIYL());
        return 8;
      case 0xb4:
        this.instructions.logical.orA(this.registers.getIYH());
        return 8;
      case 0xb5:
        this.instructions.logical.orA(this.registers.getIYL());
        return 8;
      case 0xbc:
        this.instructions.arithmetic.cpA(this.registers.getIYH());
        return 8;
      case 0xbd:
        this.instructions.arithmetic.cpA(this.registers.getIYL());
        return 8;

      // INC/DEC IYH/IYL
      case 0x24:
        {
          const result = this.instructions.arithmetic.inc8(this.registers.getIYH());
          this.registers.setIYH(result);
          return 8;
        }
      case 0x25:
        {
          const result = this.instructions.arithmetic.dec8(this.registers.getIYH());
          this.registers.setIYH(result);
          return 8;
        }
      case 0x2c:
        {
          const result = this.instructions.arithmetic.inc8(this.registers.getIYL());
          this.registers.setIYL(result);
          return 8;
        }
      case 0x2d:
        {
          const result = this.instructions.arithmetic.dec8(this.registers.getIYL());
          this.registers.setIYL(result);
          return 8;
        }

      // LD IYH/IYL,n
      case 0x26:
        this.registers.setIYH(this.memory.fetchByte(this.registers));
        return 11;
      case 0x2e:
        this.registers.setIYL(this.memory.fetchByte(this.registers));
        return 11;
      default:
        // If no FD handler, execute as normal instruction WITHOUT the prefix
        // Don't increment R again since main execute will do it
        return this.execute(fdOpcode, cpu);
    }
  }
  executeIndexedCBInstruction(_cpu, indexReg) {
    this.registers.incrementR();
    const displacement = this.memory.fetchByte(this.registers);
    const cbOpcode = this.memory.fetchByte(this.registers);
    return this.instructions.indexed.processIndexedCB(indexReg, displacement, cbOpcode);
  }
}

/**
 * Z80 CPU Emulator
 * Complete and accurate Z80 processor emulation with full instruction set support
 *
 * @class Z80
 */
class Z80 {
  /**
   * Create a Z80 CPU instance
   *
   * @constructor
   * @param {Object} memory - Memory interface for RAM/ROM access
   * @param {Object} ula - ULA interface for I/O operations
   */
  constructor(memory, ula) {
    // Initialize interfaces
    this.memory = new MemoryInterface(memory);
    this.io = new IOInterface(ula);

    // Initialize core components
    this.registers = new Registers();
    this.flags = new Flags();

    // Initialize instruction handlers
    this.instructions = {
      arithmetic: new ArithmeticInstructions(this.registers, this.flags, this.memory),
      logical: new LogicalInstructions(this.registers, this.flags),
      load: new LoadInstructions(this.registers, this.memory, this.io, this.flags, this),
      jump: new JumpInstructions(this.registers, this.flags, this.memory),
      bit: new BitInstructions(this.registers, this.flags, this.memory),
      misc: new MiscInstructions(this.registers, this.memory),
      extended: new ExtendedInstructions(this.registers, this.flags, this.memory, this.io)
    };

    // Initialize indexed instructions with factory pattern to avoid circular dependencies
    const instructionFactories = {
      getArithmetic: () => this.instructions.arithmetic,
      getLogical: () => this.instructions.logical,
      getLoad: () => this.instructions.load,
      getBit: () => this.instructions.bit
    };
    this.instructions.indexed = new IndexedInstructions(this.registers, this.flags, this.memory, instructionFactories);

    // Initialize instruction decoder
    this.decoder = new InstructionDecoder(this.registers, this.flags, this.memory, this.io, this.instructions);

    // CPU state
    this.reset();
  }

  /**
   * Reset the CPU to initial state
   *
   * @returns {void}
   */
  reset() {
    this.registers.reset();
    this.halted = false;
    this.interruptMode = 0;
    this.cycles = 0;
    this.iff1 = false;
    this.iff2 = false;
    this.eiDelay = 0;
  }

  /**
   * Execute a single instruction
   *
   * @returns {void}
   */
  execute() {
    if (this.halted) {
      // HALT instruction continues to consume 4 T-states per M1 cycle
      // until an interrupt occurs. This is important for accurate timing.
      this.cycles += 4;
      this.registers.incrementR();
      this.registers.q = 0; // HALT (executing NOPs) does not modify the flags
      return 4;
    }
    const fBefore = this.registers.get('F');
    const opcode = this.memory.fetchByte(this.registers);
    this.registers.incrementR();
    const instructionCycles = this.decoder.execute(opcode, this);
    this.cycles += instructionCycles;
    this.updateInterruptEnableDelay();
    // Maintain the Q latch: F if this instruction changed the flags, else 0.
    // SCF/CCF read it on the *next* instruction to derive bits 3/5.
    const fAfter = this.registers.get('F');
    this.registers.q = fAfter !== fBefore ? fAfter : 0;
    return instructionCycles;
  }
  updateInterruptEnableDelay() {
    if (this.eiDelay > 0) {
      this.eiDelay--;
      if (this.eiDelay === 0) {
        this.iff1 = true;
        this.iff2 = true;
      }
    }
  }

  /**
   * Trigger a maskable interrupt
   *
   * @returns {void}
   */
  interrupt() {
    if (this.iff1) {
      this.halted = false;
      this.eiDelay = 0;
      this.iff1 = false;
      this.iff2 = false;
      this.registers.incrementR();
      this.registers.q = 0; // the interrupt acknowledge does not modify the flags

      // Handle different interrupt modes
      switch (this.interruptMode) {
        case 0:
          // Mode 0 - Execute instruction on data bus
          // On most systems, data bus contains 0xFF (RST 38H)
          this.memory.pushWord(this.registers, this.registers.getPC());
          this.registers.setPC(0x0038);
          this.cycles += 13;
          break;
        case 1:
          // Mode 1 - RST 38h always
          this.memory.pushWord(this.registers, this.registers.getPC());
          this.registers.setPC(0x0038);
          this.cycles += 13;
          break;
        case 2:
          // Mode 2 - Vectored interrupt
          {
            // Vector formed from I register (high byte) and data bus (low byte)
            const vector = this.registers.get('I') << 8 | 0xff; // Assuming 0xFF on data bus
            const addr = this.memory.readWord(vector);
            this.memory.pushWord(this.registers, this.registers.getPC());
            this.registers.setPC(addr);
            this.cycles += 19;
          }
          break;
      }
    }
  }

  /**
   * Get complete CPU state with nested structure (DEPRECATED)
   * @deprecated Use getState() instead - this method will be removed in future versions
   * @returns {Object} CPU state with nested structure
   */
  getStateNested() {
    return {
      registers: this.registers.dump(),
      flags: {
        S: this.flags.getFlag(this.registers.get('F'), this.flags.masks.S),
        Z: this.flags.getFlag(this.registers.get('F'), this.flags.masks.Z),
        H: this.flags.getFlag(this.registers.get('F'), this.flags.masks.H),
        PV: this.flags.getFlag(this.registers.get('F'), this.flags.masks.PV),
        N: this.flags.getFlag(this.registers.get('F'), this.flags.masks.N),
        C: this.flags.getFlag(this.registers.get('F'), this.flags.masks.C)
      },
      cpu: {
        halted: this.halted,
        interruptMode: this.interruptMode,
        cycles: this.cycles,
        iff1: this.iff1,
        iff2: this.iff2
      }
    };
  }

  /**
   * Set CPU state from nested structure (DEPRECATED)
   * @deprecated Use setState() instead - this method will be removed in future versions
   * @param {Object} state - CPU state with nested structure
   */
  setStateNested(state) {
    if (state.registers) {
      Object.keys(state.registers).forEach(reg => {
        if (reg.length === 1) {
          this.registers.set(reg, parseInt(state.registers[reg], 16));
        } else {
          this.registers.set16(reg, parseInt(state.registers[reg], 16));
        }
      });
    }
    if (state.cpu) {
      this.halted = state.cpu.halted !== undefined ? state.cpu.halted : false;
      this.interruptMode = state.cpu.interruptMode !== undefined ? state.cpu.interruptMode : 0;
      this.cycles = state.cpu.cycles !== undefined ? state.cpu.cycles : 0;
      this.iff1 = state.cpu.iff1 !== undefined ? state.cpu.iff1 : false;
      this.iff2 = state.cpu.iff2 !== undefined ? state.cpu.iff2 : false;
      this.eiDelay = 0;
    }
  }

  // Legacy compatibility methods
  getBC() {
    return this.registers.getBC();
  }
  getDE() {
    return this.registers.getDE();
  }
  getHL() {
    return this.registers.getHL();
  }
  getAF() {
    return this.registers.getAF();
  }
  setBC(value) {
    this.registers.setBC(value);
  }
  setDE(value) {
    this.registers.setDE(value);
  }
  setHL(value) {
    this.registers.setHL(value);
  }
  setAF(value) {
    this.registers.setAF(value);
  }
  getFlag(flag) {
    return this.flags.getFlag(this.registers.get('F'), flag);
  }
  setFlag(flag, value) {
    const newF = this.flags.setFlag(this.registers.get('F'), flag, value);
    this.registers.set('F', newF);
  }
  get flagMasks() {
    return this.flags.masks;
  }

  /**
   * Get complete CPU state in flat structure
   * Used for snapshots and state management
   *
   * @returns {Object} CPU state with all registers and flags
   * @returns {number} .pc - Program counter
   * @returns {number} .sp - Stack pointer
   * @returns {number} .a - Accumulator
   * @returns {number} .f - Flags register
   * @returns {number} .b - B register
   * @returns {number} .c - C register
   * @returns {number} .d - D register
   * @returns {number} .e - E register
   * @returns {number} .h - H register
   * @returns {number} .l - L register
   * @returns {number} .ix - IX index register
   * @returns {number} .iy - IY index register
   * @returns {number} .i - Interrupt vector register
   * @returns {number} .r - Memory refresh register
   * @returns {number} .im - Interrupt mode
   * @returns {boolean} .iff1 - Interrupt flip-flop 1
   * @returns {boolean} .iff2 - Interrupt flip-flop 2
   * @returns {boolean} .halted - HALT state
   * @returns {number} .cycles - Total cycles executed
   *
   * @example
   * const state = cpu.getState();
   * console.log(`PC: ${state.pc.toString(16)}`);
   * console.log(`SP: ${state.sp.toString(16)}`);
   */
  getState() {
    return {
      // 16-bit registers need special handling
      pc: this.registers.getPC(),
      sp: this.registers.get16('SP'),
      // 8-bit registers
      a: this.registers.get('A'),
      f: this.registers.get('F'),
      b: this.registers.get('B'),
      c: this.registers.get('C'),
      d: this.registers.get('D'),
      e: this.registers.get('E'),
      h: this.registers.get('H'),
      l: this.registers.get('L'),
      // Shadow register set (EX AF,AF' / EXX)
      a_: this.registers.get('A_'),
      f_: this.registers.get('F_'),
      b_: this.registers.get('B_'),
      c_: this.registers.get('C_'),
      d_: this.registers.get('D_'),
      e_: this.registers.get('E_'),
      h_: this.registers.get('H_'),
      l_: this.registers.get('L_'),
      // 16-bit index registers
      ix: this.registers.get16('IX'),
      iy: this.registers.get16('IY'),
      // Special registers
      i: this.registers.get('I'),
      r: this.registers.get('R'),
      // CPU state
      im: this.interruptMode,
      iff1: this.iff1,
      iff2: this.iff2,
      halted: this.halted,
      cycles: this.cycles
    };
  }

  /**
   * Set CPU state from flat structure
   *
   * @param {Object} state - CPU state to restore
   * @param {number} [state.pc] - Program counter
   * @param {number} [state.sp] - Stack pointer
   * @param {number} [state.a] - Accumulator
   * @param {number} [state.f] - Flags register
   * @param {number} [state.b] - B register
   * @param {number} [state.c] - C register
   * @param {number} [state.d] - D register
   * @param {number} [state.e] - E register
   * @param {number} [state.h] - H register
   * @param {number} [state.l] - L register
   * @param {number} [state.a_] - Shadow accumulator (A')
   * @param {number} [state.f_] - Shadow flags (F')
   * @param {number} [state.b_] - Shadow B register (B')
   * @param {number} [state.c_] - Shadow C register (C')
   * @param {number} [state.d_] - Shadow D register (D')
   * @param {number} [state.e_] - Shadow E register (E')
   * @param {number} [state.h_] - Shadow H register (H')
   * @param {number} [state.l_] - Shadow L register (L')
   * @param {number} [state.ix] - IX index register
   * @param {number} [state.iy] - IY index register
   * @param {number} [state.i] - Interrupt vector register
   * @param {number} [state.r] - Memory refresh register
   * @param {number} [state.im] - Interrupt mode
   * @param {boolean} [state.iff1] - Interrupt flip-flop 1
   * @param {boolean} [state.iff2] - Interrupt flip-flop 2
   * @param {boolean} [state.halted] - HALT state
   * @param {number} [state.cycles] - Total cycles executed
   * @returns {void}
   *
   * @example
   * cpu.setState({
   *     pc: 0x8000,
   *     sp: 0xFFFF,
   *     a: 0x00
   * });
   */
  setState(state) {
    // 16-bit registers
    if (state.pc !== undefined) {
      this.registers.setPC(state.pc);
    }
    if (state.sp !== undefined) {
      this.registers.set16('SP', state.sp);
    }

    // 8-bit registers
    if (state.a !== undefined) {
      this.registers.set('A', state.a);
    }
    if (state.f !== undefined) {
      this.registers.set('F', state.f);
    }
    if (state.b !== undefined) {
      this.registers.set('B', state.b);
    }
    if (state.c !== undefined) {
      this.registers.set('C', state.c);
    }
    if (state.d !== undefined) {
      this.registers.set('D', state.d);
    }
    if (state.e !== undefined) {
      this.registers.set('E', state.e);
    }
    if (state.h !== undefined) {
      this.registers.set('H', state.h);
    }
    if (state.l !== undefined) {
      this.registers.set('L', state.l);
    }

    // Shadow register set
    if (state.a_ !== undefined) {
      this.registers.set('A_', state.a_);
    }
    if (state.f_ !== undefined) {
      this.registers.set('F_', state.f_);
    }
    if (state.b_ !== undefined) {
      this.registers.set('B_', state.b_);
    }
    if (state.c_ !== undefined) {
      this.registers.set('C_', state.c_);
    }
    if (state.d_ !== undefined) {
      this.registers.set('D_', state.d_);
    }
    if (state.e_ !== undefined) {
      this.registers.set('E_', state.e_);
    }
    if (state.h_ !== undefined) {
      this.registers.set('H_', state.h_);
    }
    if (state.l_ !== undefined) {
      this.registers.set('L_', state.l_);
    }

    // 16-bit index registers
    if (state.ix !== undefined) {
      this.registers.set16('IX', state.ix);
    }
    if (state.iy !== undefined) {
      this.registers.set16('IY', state.iy);
    }

    // Special registers
    if (state.i !== undefined) {
      this.registers.set('I', state.i);
    }
    if (state.r !== undefined) {
      this.registers.set('R', state.r);
    }

    // CPU state
    if (state.im !== undefined) {
      this.interruptMode = state.im;
    }
    if (state.iff1 !== undefined) {
      this.iff1 = state.iff1;
    }
    if (state.iff2 !== undefined) {
      this.iff2 = state.iff2;
    }
    if (state.halted !== undefined) {
      this.halted = state.halted;
    }
    if (state.cycles !== undefined) {
      this.cycles = state.cycles;
    }
    this.eiDelay = 0;
  }
}

/**
 * ZX Spectrum Memory Implementation
 *
 * Memory Map:
 * 0x0000 - 0x3FFF: ROM (16KB)
 * 0x4000 - 0x57FF: Screen memory (6KB)
 * 0x5800 - 0x5AFF: Screen attributes (768 bytes)
 * 0x5B00 - 0x5BFF: Printer buffer
 * 0x5C00 - 0x5CBF: System variables
 * 0x5CC0 - 0x5CFF: Reserved
 * 0x5D00 - 0xFFFF: RAM
 */

/**
 * @class SpectrumMemory
 * @description Implements the ZX Spectrum 48K memory model with 16KB ROM and 48KB RAM.
 * Handles memory-mapped screen display and attributes.
 *
 * @example
 * const memory = new SpectrumMemory();
 * memory.loadROM(romData);
 * memory.write(0x4000, 0xFF); // Write to screen memory
 * const value = memory.read(0x4000); // Read from screen memory
 */
class SpectrumMemory {
  /**
   * Creates a new SpectrumMemory instance
   *
   * @constructor
   */
  constructor() {
    /**
     * @property {Uint8Array} rom - 16KB ROM storage (0x0000-0x3FFF)
     * @private
     */
    this.rom = new Uint8Array(16384); // 16KB ROM

    /**
     * @property {Uint8Array} ram - 48KB RAM storage (0x4000-0xFFFF mapped)
     * @private
     */
    this.ram = new Uint8Array(49152); // 48KB RAM

    /**
     * @property {boolean} romEnabled - Whether ROM is mapped to lower 16KB
     * @private
     */
    this.romEnabled = true;
  }

  /**
   * Read a byte from memory
   *
   * @param {number} address - Memory address (0x0000-0xFFFF)
   * @returns {number} Byte value (0-255)
   *
   * @example
   * const screenByte = memory.read(0x4000); // Read first screen byte
   * const romByte = memory.read(0x0000);    // Read first ROM byte
   */
  read(address) {
    const addr = address & 0xffff;
    if (addr < 0x4000 && this.romEnabled) {
      return this.rom[addr];
    }
    if (addr >= 0x4000) {
      return this.ram[addr - 0x4000];
    }
    return 0xff;
  }

  /**
   * Write a byte to memory
   * ROM area (0x0000-0x3FFF) is read-only and writes are ignored
   *
   * @param {number} address - Memory address (0x0000-0xFFFF)
   * @param {number} value - Byte value to write (0-255)
   * @returns {void}
   *
   * @example
   * memory.write(0x4000, 0xFF); // Write to screen memory
   * memory.write(0x5800, 0x47); // Write white on black attribute
   */
  write(address, value) {
    const addr = address & 0xffff;

    // ROM area is read-only
    if (addr >= 0x4000) {
      this.ram[addr - 0x4000] = value & 0xff;
    }
  }

  /**
   * Load ROM data into memory
   *
   * @param {Uint8Array} data - ROM data to load
   * @throws {Error} If ROM data exceeds 16384 bytes
   * @returns {void}
   *
   * @example
   * const response = await fetch('48k.rom');
   * const romData = new Uint8Array(await response.arrayBuffer());
   * memory.loadROM(romData);
   */
  loadROM(data) {
    if (data.length > this.rom.length) {
      throw new Error(`ROM too large: ${data.length} bytes (max ${this.rom.length})`);
    }
    this.rom.set(data);
  }

  /**
   * Get screen pixel memory for rendering
   * Returns a view of the 6KB screen memory area (0x4000-0x57FF)
   *
   * @returns {Uint8Array} View of screen pixel memory (6144 bytes)
   *
   * @example
   * const screenMem = memory.getScreenMemory();
   * // Each byte contains 8 pixels (1 bit per pixel)
   */
  getScreenMemory() {
    return this.ram.subarray(0, 0x1800); // 6KB of screen pixels
  }

  /**
   * Get screen attribute memory for rendering
   * Returns a view of the 768-byte attribute area (0x5800-0x5AFF)
   *
   * Each attribute byte controls an 8x8 pixel cell:
   * - Bits 0-2: INK color (0-7)
   * - Bits 3-5: PAPER color (0-7)
   * - Bit 6: BRIGHT flag
   * - Bit 7: FLASH flag
   *
   * @returns {Uint8Array} View of attribute memory (768 bytes)
   *
   * @example
   * const attrs = memory.getAttributeMemory();
   * attrs[0] = 0x47; // White ink on black paper
   * attrs[0] = 0xC7; // Bright white ink on black paper with flash
   */
  getAttributeMemory() {
    return this.ram.subarray(0x1800, 0x1b00); // 768 bytes of attributes
  }

  /**
   * Clear all RAM to zero
   * Typically called during system reset
   *
   * @returns {void}
   *
   * @example
   * memory.clearRAM(); // Clear all 48KB of RAM
   */
  clearRAM() {
    this.ram.fill(0);
  }
}

/**
 * ZX Spectrum ULA (Uncommitted Logic Array) Emulation
 * Handles I/O ports, keyboard, border color, and speaker
 */
class SpectrumULA {
  constructor() {
    this.borderColor = 1; // Blue border by default
    this.speakerBit = 0;
    this.micBit = 0;

    // Keyboard matrix (8x5)
    this.keyboardMatrix = new Uint8Array(8).fill(0xff);

    // Port FE is the main ULA port
    this.lastPortFE = 0;

    // Callback for speaker changes
    this.onSpeakerChange = null;

    // NEW: Callback for port writes with exact timing
    this.onPortWrite = null;

    // Tape input bit (EAR)
    this.tapeInputBit = 1;

    // Scanline tracking for border effects
    this.scanline = 0;
    this.scanlineBorderColors = new Uint8Array(312).fill(1);
    this.borderChanged = false;

    // Timing constants
    this.SCANLINES_PER_FRAME = 312;
    this.TSTATES_PER_SCANLINE = 224;
    this.cycleCounter = 0;

    // Interrupt generation
    this.interruptPending = false;
  }
  readPort(port) {
    // Port 0xFE - Keyboard and tape input
    if ((port & 0x01) === 0) {
      let result = 0xbf; // Initial value with bit 6 set (no tape input)

      // Check keyboard rows based on high byte of port address
      const highByte = port >> 8 & 0xff;
      for (let row = 0; row < 8; row++) {
        // Check if this row is selected (bit is 0)
        if ((highByte & 1 << row) === 0) {
          // AND the result with this row's keys
          result &= this.keyboardMatrix[row];
        }
      }

      // Set bit 6 based on tape input (EAR)
      if (this.tapeInputBit) {
        result |= 0x40; // Set bit 6
      } else {
        result &= -65; // Clear bit 6
      }
      return result;
    }
    return 0xff;
  }
  writePort(port, value) {
    const portByte = port & 0xff;
    const val = value & 0xff;

    // Port 0xFE - Border color and speaker
    if ((portByte & 0x01) === 0) {
      this.lastPortFE;
      this.lastPortFE = val;
      const newBorderColor = val & 0x07; // Bits 0-2: border color
      const newSpeakerBit = (val & 0x10) >> 4; // Bit 4: speaker
      this.micBit = (val & 0x08) >> 3; // Bit 3: mic

      // Update border color and track change
      if (newBorderColor !== this.borderColor) {
        this.borderColor = newBorderColor;
        this.borderChanged = true;
        this.scanlineBorderColors[this.scanline] = newBorderColor;
      }

      // Notify about port write with the value (for accurate beeper tracking)
      if (this.onPortWrite) {
        this.onPortWrite(val);
      }

      // Legacy speaker change notification (kept for compatibility)
      if (newSpeakerBit !== this.speakerBit) {
        this.speakerBit = newSpeakerBit;
        if (this.onSpeakerChange) {
          this.onSpeakerChange(this.speakerBit);
        }
      }
    }
  }

  // Additional method to set the port write callback
  setPortWriteCallback(callback) {
    this.onPortWrite = callback;
  }

  // Set key state (row 0-7, col 0-4)
  setKey(row, col, pressed) {
    if (row >= 0 && row < 8 && col >= 0 && col < 5) {
      this.keyboardMatrix[row];
      if (pressed) {
        this.keyboardMatrix[row] &= ~(1 << col);
      } else {
        this.keyboardMatrix[row] |= 1 << col;
      }
    }
  }

  // Clear all keys
  clearKeys() {
    this.keyboardMatrix.fill(0xff);
  }

  // Get current border color
  getBorderColor() {
    return this.borderColor;
  }

  // Get speaker state
  getSpeakerState() {
    return this.speakerBit;
  }

  // Add cycles for scanline tracking
  addCycles(cycles) {
    this.cycleCounter += cycles;

    // Check if we've completed a scanline
    while (this.cycleCounter >= this.TSTATES_PER_SCANLINE) {
      this.cycleCounter -= this.TSTATES_PER_SCANLINE;

      // Record border color for this scanline
      this.scanlineBorderColors[this.scanline] = this.borderColor;

      // Move to next scanline
      this.scanline++;
      if (this.scanline >= this.SCANLINES_PER_FRAME) {
        this.scanline = 0;
        // Generate interrupt at start of frame
        this.interruptPending = true;
      }
    }
  }

  /**
   * Get per-scanline border colors for multicolor effects
   *
   * @returns {Uint8Array} Array of 312 border colors (one per scanline)
   */
  getScanlineBorderColors() {
    return this.scanlineBorderColors;
  }

  /**
   * Check if border color changed during this frame
   *
   * @returns {boolean} True if border color changed
   */
  isBorderColorChanged() {
    return this.borderChanged;
  }

  /**
   * Reset border changed flag for new frame
   *
   * @returns {void}
   */
  resetBorderChanged() {
    this.borderChanged = false;
  }

  /**
   * Check if interrupt should be generated
   * Interrupts occur at the start of the vertical retrace period
   *
   * @returns {boolean} True if interrupt should be generated
   */
  shouldGenerateInterrupt() {
    if (this.interruptPending) {
      this.interruptPending = false;
      return true;
    }
    return false;
  }

  /**
   * Set border color directly (used for snapshot loading)
   *
   * @param {number} color - Border color index (0-7)
   * @returns {void}
   */
  setBorderColor(color) {
    this.borderColor = color & 0x07;
    this.borderChanged = true;
    // Update scanline border color for current scanline
    this.scanlineBorderColors[this.scanline] = this.borderColor;
  }

  /**
   * Set tape input bit (EAR)
   *
   * @param {number} bit - Tape input state (0 or 1)
   * @returns {void}
   */
  setTapeInput(bit) {
    this.tapeInputBit = bit ? 1 : 0;
  }
}

// ZX Spectrum keyboard mapping
const SPECTRUM_KEYS = {
  // Row 0 (CAPS SHIFT, Z, X, C, V)
  CAPS_SHIFT: {
    row: 0,
    col: 0
  },
  Z: {
    row: 0,
    col: 1
  },
  X: {
    row: 0,
    col: 2
  },
  C: {
    row: 0,
    col: 3
  },
  V: {
    row: 0,
    col: 4
  },
  // Row 1 (A, S, D, F, G)
  A: {
    row: 1,
    col: 0
  },
  S: {
    row: 1,
    col: 1
  },
  D: {
    row: 1,
    col: 2
  },
  F: {
    row: 1,
    col: 3
  },
  G: {
    row: 1,
    col: 4
  },
  // Row 2 (Q, W, E, R, T)
  Q: {
    row: 2,
    col: 0
  },
  W: {
    row: 2,
    col: 1
  },
  E: {
    row: 2,
    col: 2
  },
  R: {
    row: 2,
    col: 3
  },
  T: {
    row: 2,
    col: 4
  },
  // Row 3 (1, 2, 3, 4, 5)
  1: {
    row: 3,
    col: 0
  },
  2: {
    row: 3,
    col: 1
  },
  3: {
    row: 3,
    col: 2
  },
  4: {
    row: 3,
    col: 3
  },
  5: {
    row: 3,
    col: 4
  },
  // Row 4 (0, 9, 8, 7, 6)
  0: {
    row: 4,
    col: 0
  },
  9: {
    row: 4,
    col: 1
  },
  8: {
    row: 4,
    col: 2
  },
  7: {
    row: 4,
    col: 3
  },
  6: {
    row: 4,
    col: 4
  },
  // Row 5 (P, O, I, U, Y)
  P: {
    row: 5,
    col: 0
  },
  O: {
    row: 5,
    col: 1
  },
  I: {
    row: 5,
    col: 2
  },
  U: {
    row: 5,
    col: 3
  },
  Y: {
    row: 5,
    col: 4
  },
  // Row 6 (ENTER, L, K, J, H)
  ENTER: {
    row: 6,
    col: 0
  },
  L: {
    row: 6,
    col: 1
  },
  K: {
    row: 6,
    col: 2
  },
  J: {
    row: 6,
    col: 3
  },
  H: {
    row: 6,
    col: 4
  },
  // Row 7 (SPACE, SYMBOL SHIFT, M, N, B)
  SPACE: {
    row: 7,
    col: 0
  },
  SYMBOL_SHIFT: {
    row: 7,
    col: 1
  },
  M: {
    row: 7,
    col: 2
  },
  N: {
    row: 7,
    col: 3
  },
  B: {
    row: 7,
    col: 4
  }
};

// PC to Spectrum key mappings with modifiers
const PC_KEY_MAP = {
  // Direct mappings
  Enter: 'ENTER',
  ' ': 'SPACE',
  Shift: 'CAPS_SHIFT',
  Control: 'SYMBOL_SHIFT',
  Alt: 'SYMBOL_SHIFT',
  Meta: 'SYMBOL_SHIFT',
  // Mac Command key
  AltGraph: 'SYMBOL_SHIFT',
  // Right Alt on some keyboards

  // Arrow keys using Spectrum cursor keys (Caps Shift + 5,6,7,8)
  ArrowLeft: {
    keys: ['CAPS_SHIFT', '5']
  },
  // Caps Shift + 5
  ArrowDown: {
    keys: ['CAPS_SHIFT', '6']
  },
  // Caps Shift + 6
  ArrowUp: {
    keys: ['CAPS_SHIFT', '7']
  },
  // Caps Shift + 7
  ArrowRight: {
    keys: ['CAPS_SHIFT', '8']
  },
  // Caps Shift + 8

  // Common symbols with Symbol Shift
  '!': {
    keys: ['SYMBOL_SHIFT', '1']
  },
  '@': {
    keys: ['SYMBOL_SHIFT', '2']
  },
  '#': {
    keys: ['SYMBOL_SHIFT', '3']
  },
  $: {
    keys: ['SYMBOL_SHIFT', '4']
  },
  '%': {
    keys: ['SYMBOL_SHIFT', '5']
  },
  '&': {
    keys: ['SYMBOL_SHIFT', '6']
  },
  "'": {
    keys: ['SYMBOL_SHIFT', '7']
  },
  '(': {
    keys: ['SYMBOL_SHIFT', '8']
  },
  ')': {
    keys: ['SYMBOL_SHIFT', '9']
  },
  _: {
    keys: ['SYMBOL_SHIFT', '0']
  },
  // Other symbols
  '-': {
    keys: ['SYMBOL_SHIFT', 'J']
  },
  '+': {
    keys: ['SYMBOL_SHIFT', 'K']
  },
  '=': {
    keys: ['SYMBOL_SHIFT', 'L']
  },
  ':': {
    keys: ['SYMBOL_SHIFT', 'Z']
  },
  ';': {
    keys: ['SYMBOL_SHIFT', 'O']
  },
  '"': {
    keys: ['SYMBOL_SHIFT', 'P']
  },
  ',': {
    keys: ['SYMBOL_SHIFT', 'N']
  },
  '.': {
    keys: ['SYMBOL_SHIFT', 'M']
  },
  '<': {
    keys: ['SYMBOL_SHIFT', 'R']
  },
  '>': {
    keys: ['SYMBOL_SHIFT', 'T']
  },
  '?': {
    keys: ['SYMBOL_SHIFT', 'C']
  },
  '/': {
    keys: ['SYMBOL_SHIFT', 'V']
  },
  '*': {
    keys: ['SYMBOL_SHIFT', 'B']
  },
  // Special keys
  Backspace: {
    keys: ['CAPS_SHIFT', '0']
  },
  // DELETE key on Spectrum
  Delete: {
    keys: ['CAPS_SHIFT', '0']
  },
  Escape: {
    keys: ['CAPS_SHIFT', 'SPACE']
  },
  // BREAK
  Tab: {
    keys: ['CAPS_SHIFT', 'SYMBOL_SHIFT']
  } // EXTENDED MODE
};

/**
 * ZX Spectrum Display Renderer
 * Converts screen memory to pixels
 */

/**
 * @class SpectrumDisplay
 * @description Handles rendering of the ZX Spectrum display including the main screen area
 * (256x192 pixels) and border. Implements authentic attribute handling with BRIGHT and FLASH.
 *
 * The display uses the original ZX Spectrum color palette and handles the complex
 * screen memory layout where pixels are stored in a non-linear format.
 *
 * @example
 * const display = new SpectrumDisplay();
 * const imageData = display.render(screenMem, attrMem, borderColor);
 * ctx.putImageData(imageData, 0, 0);
 */
class SpectrumDisplay {
  /**
   * Creates a new SpectrumDisplay instance
   *
   * @constructor
   */
  constructor() {
    /**
     * @property {number} width - Screen width in pixels (excluding border)
     * @readonly
     */
    this.width = 256;

    /**
     * @property {number} height - Screen height in pixels (excluding border)
     * @readonly
     */
    this.height = 192;

    /**
     * @property {number} borderTop - Top border size in pixels
     * @readonly
     */
    this.borderTop = 48;

    /**
     * @property {number} borderBottom - Bottom border size in pixels
     * @readonly
     */
    this.borderBottom = 56;

    /**
     * @property {number} borderLeft - Left border size in pixels
     * @readonly
     */
    this.borderLeft = 48;

    /**
     * @property {number} borderRight - Right border size in pixels
     * @readonly
     */
    this.borderRight = 48;

    /**
     * @property {number} totalWidth - Total display width including border
     * @readonly
     */
    this.totalWidth = this.width + this.borderLeft + this.borderRight;

    /**
     * @property {number} totalHeight - Total display height including border
     * @readonly
     */
    this.totalHeight = this.height + this.borderTop + this.borderBottom;

    /**
     * @property {Uint8Array} displayBuffer - RGBA pixel buffer for the entire display
     * @private
     */
    this.displayBuffer = new Uint8Array(this.totalWidth * this.totalHeight * 4);

    /**
     * @property {boolean} flashPhase - Current flash state (true = swapped colors)
     * @private
     */
    this.flashPhase = false;

    /**
     * @property {number} flashCounter - Frame counter for flash timing
     * @private
     */
    this.flashCounter = 0;

    /**
     * @property {number} FLASH_FRAMES - Frames between flash toggles
     * @private
     */
    this.FLASH_FRAMES = 16; // Toggle every 16 emulated frames (full cycle is 32 frames)

    // Pre-compute attribute cache for performance
    this.initAttributeCache();

    /**
     * @property {Array<Array<number>>} palette - ZX Spectrum color palette in RGBA format
     * @private
     */
    this.palette = [[0x00, 0x00, 0x00, 0xff],
    // 0: Black
    [0x00, 0x00, 0xd7, 0xff],
    // 1: Blue
    [0xd7, 0x00, 0x00, 0xff],
    // 2: Red
    [0xd7, 0x00, 0xd7, 0xff],
    // 3: Magenta
    [0x00, 0xd7, 0x00, 0xff],
    // 4: Green
    [0x00, 0xd7, 0xd7, 0xff],
    // 5: Cyan
    [0xd7, 0xd7, 0x00, 0xff],
    // 6: Yellow
    [0xd7, 0xd7, 0xd7, 0xff],
    // 7: White
    // Bright colors
    [0x00, 0x00, 0x00, 0xff],
    // 8: Black (bright)
    [0x00, 0x00, 0xff, 0xff],
    // 9: Blue (bright)
    [0xff, 0x00, 0x00, 0xff],
    // 10: Red (bright)
    [0xff, 0x00, 0xff, 0xff],
    // 11: Magenta (bright)
    [0x00, 0xff, 0x00, 0xff],
    // 12: Green (bright)
    [0x00, 0xff, 0xff, 0xff],
    // 13: Cyan (bright)
    [0xff, 0xff, 0x00, 0xff],
    // 14: Yellow (bright)
    [0xff, 0xff, 0xff, 0xff] // 15: White (bright)
    ];
  }

  /**
   * Initialize attribute cache for fast rendering
   * Pre-computes color values for all possible attribute combinations
   *
   * @private
   * @returns {void}
   */
  initAttributeCache() {
    this.attributeCache = new Array(256);
    for (let attr = 0; attr < 256; attr++) {
      const ink = attr & 0x07;
      const paper = attr >> 3 & 0x07;
      const bright = attr >> 6 & 0x01;
      const flash = attr >> 7 & 0x01;
      this.attributeCache[attr] = {
        ink: ink + (bright ? 8 : 0),
        paper: paper + (bright ? 8 : 0),
        flash: flash !== 0
      };
    }
  }

  /**
   * Render the display from screen and attribute memory
   *
   * @param {Uint8Array} screenMemory - 6KB of screen pixel data
   * @param {Uint8Array} attributeMemory - 768 bytes of attribute data
   * @param {number} borderColor - Border color index (0-7)
   * @param {Uint8Array} [scanlineBorderColors=null] - Per-scanline border colors for effects
   * @returns {Uint8Array} RGBA pixel data for the entire display
   *
   * @example
   * const pixels = display.render(screenMem, attrMem, 1); // Blue border
   */
  advanceFrame() {
    this.flashCounter++;
    if (this.flashCounter >= this.FLASH_FRAMES) {
      this.flashPhase = !this.flashPhase;
      this.flashCounter = 0;
    }
  }
  render(screenMemory, attributeMemory, borderColor, scanlineBorderColors = null) {
    // Fill border - use scanline colors if available for stripe effects
    if (scanlineBorderColors) {
      this.fillBorderWithScanlines(scanlineBorderColors);
    } else {
      this.fillBorder(borderColor);
    }

    // Then render the screen content
    for (let y = 0; y < 192; y++) {
      for (let x = 0; x < 32; x++) {
        // 32 bytes per line (256 pixels / 8)
        // Calculate screen memory address
        // ZX Spectrum has a complex screen layout
        const screenAddr = this.getScreenAddress(x, y);
        const pixelByte = screenMemory[screenAddr];

        // Get attribute for this character cell
        const attrAddr = Math.floor(y / 8) * 32 + x;
        const attr = attributeMemory[attrAddr];

        // Use pre-computed attribute data
        const attrData = this.attributeCache[attr];
        let inkColor = attrData.ink;
        let paperColor = attrData.paper;

        // Apply flash effect by swapping ink and paper colors
        if (attrData.flash && this.flashPhase) {
          const temp = inkColor;
          inkColor = paperColor;
          paperColor = temp;
        }

        // Render 8 pixels
        for (let bit = 0; bit < 8; bit++) {
          const pixel = pixelByte >> 7 - bit & 0x01;
          const color = pixel ? inkColor : paperColor;

          // Calculate position in display buffer
          const px = x * 8 + bit + this.borderLeft;
          const py = y + this.borderTop;
          const offset = (py * this.totalWidth + px) * 4;

          // Set pixel color
          this.displayBuffer[offset] = this.palette[color][0];
          this.displayBuffer[offset + 1] = this.palette[color][1];
          this.displayBuffer[offset + 2] = this.palette[color][2];
          this.displayBuffer[offset + 3] = this.palette[color][3];
        }
      }
    }
    return this.displayBuffer;
  }

  /**
   * Calculate screen memory address for given coordinates
   * Implements the ZX Spectrum's non-linear screen memory layout
   *
   * The address calculation splits the Y coordinate into sections:
   * - Y7,Y6 determine the third of the screen
   * - Y5,Y4,Y3 determine the character row within the third
   * - Y2,Y1,Y0 determine the pixel row within the character
   *
   * @private
   * @param {number} x - Character column (0-31)
   * @param {number} y - Pixel row (0-191)
   * @returns {number} Memory offset within screen area (0-6143)
   *
   * @example
   * const addr = this.getScreenAddress(0, 0);   // Returns 0
   * const addr = this.getScreenAddress(0, 8);   // Returns 256
   * const addr = this.getScreenAddress(0, 64);  // Returns 2048
   */
  getScreenAddress(x, y) {
    // Split y into components
    const y7 = y >> 7 & 0x01;
    const y6 = y >> 6 & 0x01;
    const y5 = y >> 5 & 0x01;
    const y4 = y >> 4 & 0x01;
    const y3 = y >> 3 & 0x01;
    const y2 = y >> 2 & 0x01;
    const y1 = y >> 1 & 0x01;
    const y0 = y & 0x01;

    // Calculate address
    return y7 << 12 | y6 << 11 | y2 << 10 | y1 << 9 | y0 << 8 | y5 << 7 | y4 << 6 | y3 << 5 | x;
  }

  /**
   * Fill the border with the specified color
   *
   * @private
   * @param {number} borderColor - Color index (0-7)
   * @returns {void}
   */
  fillBorder(borderColor) {
    const color = this.palette[borderColor & 0x07];

    // Top border
    for (let y = 0; y < this.borderTop; y++) {
      for (let x = 0; x < this.totalWidth; x++) {
        const offset = (y * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }

    // Bottom border
    for (let y = this.totalHeight - this.borderBottom; y < this.totalHeight; y++) {
      for (let x = 0; x < this.totalWidth; x++) {
        const offset = (y * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }

    // Left and right borders (for the screen area)
    for (let y = this.borderTop; y < this.totalHeight - this.borderBottom; y++) {
      // Left border
      for (let x = 0; x < this.borderLeft; x++) {
        const offset = (y * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }

      // Right border
      for (let x = this.totalWidth - this.borderRight; x < this.totalWidth; x++) {
        const offset = (y * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }
  }

  /**
   * Fill border with per-scanline colors for multicolor effects
   * Used for demos and games that change border color mid-frame
   *
   * @private
   * @param {Uint8Array} scanlineBorderColors - Array of 312 color values (one per scanline)
   * @returns {void}
   */
  fillBorderWithScanlines(scanlineBorderColors) {
    if (!scanlineBorderColors || scanlineBorderColors.length < 312) {
      this.fillBorder(7); // Default white border
      return;
    }

    // Constants for ZX Spectrum timing
    const firstVisibleScanline = 64;
    const visibleScanlines = 192;
    const topBorderScanlines = 48;

    // Top border (scanlines 64-111, displayed in 48 pixel rows)
    for (let y = 0; y < this.borderTop; y++) {
      const scanline = firstVisibleScanline - topBorderScanlines + y;
      const color = this.palette[scanlineBorderColors[scanline] & 0x07];
      for (let x = 0; x < this.totalWidth; x++) {
        const offset = (y * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }

    // Side borders during screen area (scanlines 112-303)
    for (let y = 0; y < this.height; y++) {
      const scanline = firstVisibleScanline + y;
      const color = this.palette[scanlineBorderColors[scanline] & 0x07];
      const displayY = y + this.borderTop;

      // Left border
      for (let x = 0; x < this.borderLeft; x++) {
        const offset = (displayY * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }

      // Right border
      for (let x = this.totalWidth - this.borderRight; x < this.totalWidth; x++) {
        const offset = (displayY * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }

    // Bottom border (scanlines 304-311 and 0-63, displayed in 56 pixel rows)
    for (let y = 0; y < this.borderBottom; y++) {
      const displayY = this.borderTop + this.height + y;
      const scanline = firstVisibleScanline + visibleScanlines + y;
      const actualScanline = scanline < 312 ? scanline : scanline - 312;
      const color = this.palette[scanlineBorderColors[actualScanline] & 0x07];
      for (let x = 0; x < this.totalWidth; x++) {
        const offset = (displayY * this.totalWidth + x) * 4;
        this.displayBuffer[offset] = color[0];
        this.displayBuffer[offset + 1] = color[1];
        this.displayBuffer[offset + 2] = color[2];
        this.displayBuffer[offset + 3] = color[3];
      }
    }
  }

  /**
   * Get display dimensions including border
   *
   * @returns {Object} Display dimensions
   * @returns {number} .width - Total width including border (352)
   * @returns {number} .height - Total height including border (296)
   * @returns {number} .screenWidth - Screen area width (256)
   * @returns {number} .screenHeight - Screen area height (192)
   * @returns {number} .borderTop - Top border size (48)
   * @returns {number} .borderBottom - Bottom border size (56)
   * @returns {number} .borderLeft - Left border size (48)
   * @returns {number} .borderRight - Right border size (48)
   *
   * @example
   * const size = display.getDisplaySize();
   * canvas.width = size.width;
   * canvas.height = size.height;
   */
  getDisplaySize() {
    return {
      width: this.totalWidth,
      height: this.totalHeight,
      screenWidth: this.width,
      screenHeight: this.height,
      borderTop: this.borderTop,
      borderBottom: this.borderBottom,
      borderLeft: this.borderLeft,
      borderRight: this.borderRight
    };
  }

  /**
   * Get ImageData object for canvas rendering
   * Creates a new ImageData from the current display buffer
   *
   * @returns {ImageData} ImageData object ready for canvas putImageData
   *
   * @example
   * const imageData = display.getImageData();
   * ctx.putImageData(imageData, 0, 0);
   */
  getImageData() {
    if (typeof ImageData === 'undefined') {
      throw new Error('ImageData is not available in this environment (Node). ' + 'Read the raw RGBA pixels from display.displayBuffer instead.');
    }
    // Create ImageData object with the display buffer
    return new ImageData(new Uint8ClampedArray(this.displayBuffer), this.totalWidth, this.totalHeight);
  }
}

/**
 * ZX Spectrum Sound (Beeper) Emulation - Fallback Implementation
 * Uses ScriptProcessorNode for browsers that don't support AudioWorklet
 *
 * Note: ScriptProcessorNode is deprecated but still widely supported
 * This serves as a fallback when AudioWorklet is not available
 */
class SpectrumSound {
  constructor() {
    this.audioContext = null;
    this.gainNode = null;
    this.compressor = null;
    this.scriptNode = null;
    this.enabled = false;
    this.volume = 0.3;

    // Timing
    this.cpuFrequency = 3500000; // 3.5 MHz
    this.currentBeeperState = 0;
    this.lastBeeperState = 0;
    this.beeperChanges = [];
    this.frameStartTState = 0;
    this.totalTStates = 0;

    // Buffer for more accurate sound generation
    this.sampleRate = 44100;
    this.bufferSize = 2048; // Smaller buffer for lower latency
    this.tStatesPerSample = this.cpuFrequency / this.sampleRate;

    // Audio processing state
    this.lastTState = 0;
    this.edges = [];
    this.edgeIndex = 0;
    this.currentLevel = 0;
    this.targetLevel = 0;

    // Filters
    this.filterCoeff = 0.3; // Low-pass filter
    this.lastOutput = 0;

    // DC blocker
    this.dcBlockerCoeff = 0.995;
    this.lastInput = 0;
    this.lastDCOutput = 0;

    // Debug
    this.debugMode = false;
    this.edgeCount = 0;
  }

  /**
   * Initialize Web Audio API
   */
  async init() {
    if (this.audioContext) {
      return this.enabled;
    }
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: this.sampleRate
      });

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.volume;

      // Add compressor to prevent clipping
      this.compressor = this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -10;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.001;
      this.compressor.release.value = 0.1;

      // Create script processor for custom waveform generation
      // Note: ScriptProcessorNode is deprecated but still needed for compatibility
      this.scriptNode = this.audioContext.createScriptProcessor(this.bufferSize, 0, 1);
      this.scriptNode.onaudioprocess = event => {
        this.processAudio(event);
      };

      // Connect audio graph
      this.scriptNode.connect(this.compressor);
      this.compressor.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.enabled = true;
      console.log('Basic sound (ScriptProcessor) initialized at', this.sampleRate, 'Hz'); // eslint-disable-line no-console
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      this.enabled = false;
      return false;
    }
  }

  /**
   * Process audio in the ScriptProcessor callback
   */
  processAudio(event) {
    const output = event.outputBuffer.getChannelData(0);
    for (let i = 0; i < output.length; i++) {
      // Calculate the T-state for this sample
      const currentTState = this.lastTState + i * this.tStatesPerSample;

      // Process any edges that occurred before this sample
      while (this.edgeIndex < this.edges.length && this.edges[this.edgeIndex].tState <= currentTState) {
        const edge = this.edges[this.edgeIndex++];
        // Immediate level change for sharper edges
        this.targetLevel = edge.value ? 0.7 : -0.7;
      }

      // Move current level towards target (slight smoothing)
      this.currentLevel = this.currentLevel + (this.targetLevel - this.currentLevel) * 0.8;

      // Apply low-pass filter
      const filtered = this.lastOutput + (this.currentLevel - this.lastOutput) * this.filterCoeff;
      this.lastOutput = filtered;

      // DC blocker to remove clicks and pops
      const dcBlocked = filtered - this.lastInput + this.dcBlockerCoeff * this.lastDCOutput;
      this.lastInput = filtered;
      this.lastDCOutput = dcBlocked;

      // Write sample with controlled amplitude
      output[i] = dcBlocked * 0.6;
    }

    // Update time state for next buffer
    this.lastTState += output.length * this.tStatesPerSample;

    // Clean up processed edges
    if (this.edgeIndex > 1000) {
      this.edges = this.edges.slice(this.edgeIndex);
      this.edgeIndex = 0;
    }

    // Sync with frame timing
    if (this.edges.length === 0 && this.beeperChanges.length > 0) {
      // Process pending changes
      this.edges.push(...this.beeperChanges);
      this.beeperChanges = [];
    }
  }

  /**
   * Record a beeper state change with exact timing
   * Compatible with AudioWorklet API
   */
  setBeeperState(value, tState) {
    if (!this.enabled) {
      return;
    }
    const newState = value & 0x10 ? 1 : 0;
    if (newState !== this.currentBeeperState || this.beeperChanges.length === 0) {
      const absoluteTState = this.frameStartTState + tState;

      // Ensure edges are in chronological order
      if (this.beeperChanges.length > 0 && absoluteTState <= this.beeperChanges[this.beeperChanges.length - 1].tState) {
        return;
      }
      this.beeperChanges.push({
        tState: absoluteTState,
        value: newState
      });
      this.currentBeeperState = newState;
      if (this.debugMode && this.edgeCount < 100) {
        // eslint-disable-next-line no-console
        console.log(`[Basic] Edge ${this.edgeCount++}: ${this.lastBeeperState} -> ${newState} at T-state ${absoluteTState}`);
      }
      this.lastBeeperState = newState;
    }
  }

  /**
   * Start a new frame - compatible with AudioWorklet API
   */
  startFrame() {
    this.frameStartTState = this.totalTStates;
    // Don't clear beeperChanges here - let them accumulate
  }

  /**
   * End frame and process changes - compatible with AudioWorklet API
   */
  endFrame(frameTStates) {
    if (!this.enabled) {
      return;
    }
    this.totalTStates = this.frameStartTState + frameTStates;

    // The changes will be processed in the audio callback
    // This avoids timing issues with the main thread

    if (this.debugMode && this.beeperChanges.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[Basic] Frame ended: ${this.beeperChanges.length} edges pending`);
    }
  }

  /**
   * Reset audio state
   */
  reset() {
    this.currentBeeperState = 0;
    this.lastBeeperState = 0;
    this.beeperChanges = [];
    this.edges = [];
    this.edgeIndex = 0;
    this.frameStartTState = 0;
    this.totalTStates = 0;
    this.lastTState = 0;
    this.currentLevel = 0;
    this.targetLevel = 0;
    this.lastOutput = 0;
    this.lastInput = 0;
    this.lastDCOutput = 0;
    this.edgeCount = 0;
  }

  /**
   * Set volume (0.0 to 1.0)
   */
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      // Use exponential ramp for smoother volume changes
      this.gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), this.audioContext.currentTime + 0.1);
    }
  }

  /**
   * Mute/unmute
   */
  setMuted(muted) {
    if (this.gainNode) {
      const targetValue = muted ? 0.0001 : this.volume;
      this.gainNode.gain.exponentialRampToValueAtTime(targetValue, this.audioContext.currentTime + 0.05);
    }
  }

  /**
   * Enable/disable debug mode
   */
  setDebugMode(enabled) {
    this.debugMode = enabled;
    this.edgeCount = 0;
  }

  /**
   * Start audio - compatible with AudioWorklet API
   */
  async start() {
    return await this.init();
  }

  /**
   * Stop audio
   */
  stop() {
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.enabled = false;
  }

  /**
   * Check if audio is ready
   */
  isReady() {
    return this.enabled && this.audioContext?.state === 'running';
  }

  /**
   * Get audio statistics - compatible with AudioWorklet API
   */
  getStats() {
    return {
      enabled: this.enabled,
      contextState: this.audioContext?.state,
      sampleRate: this.audioContext?.sampleRate,
      edgesQueued: this.beeperChanges.length,
      totalTStates: this.totalTStates,
      implementation: 'ScriptProcessor (Fallback)'
    };
  }

  /**
   * Legacy beep method (no longer used but kept for compatibility)
   */
  beep(speakerBit) {
    // Convert to new API
    this.setBeeperState(speakerBit ? 0x10 : 0x00, 0);
  }
}

/**
 * Band-limited beeper resampler (pure DSP, no Web Audio / DOM).
 *
 * The ZX beeper is a 1-bit speaker: tones are square waves whose edges fall on
 * arbitrary T-states, not on the audio sample grid. Point-sampling the level at
 * each output sample (the previous approach) snaps every edge to the nearest
 * sample, jittering the square wave's duty cycle and folding high harmonics back
 * into the audible band — the "dirty"/rough beeper.
 *
 * This resampler integrates the speaker level over each output sample's exact
 * time window using the edge T-states (time-weighted average) — a box-filter
 * anti-aliaser that captures sub-sample edge positions, so pitch and duty cycle
 * are accurate and aliasing is suppressed. A gentle one-pole low-pass softens the
 * very top end and a DC blocker removes clicks/offset.
 *
 * It is driven per emulation frame with frame-relative edges and the frame's
 * exact T-state length, and emits a VARIABLE number of samples per frame so the
 * output clock never drifts from real time (a frame is 69888 T-states =
 * 19.968 ms, not exactly 20 ms). Partial-sample state carries across frames.
 *
 * Self-contained on purpose: the AudioWorklet processor is injected as source
 * text, so this class is embedded there via `toString()`. Keep it dependency-free.
 */
class BeeperResampler {
  /**
   * @param {number} sampleRate  output sample rate (Hz)
   * @param {number} cpuFreq     CPU T-states per second (real Spectrum = 3.5 MHz)
   * @param {number} lpCutoff    one-pole low-pass cutoff (Hz)
   */
  constructor(sampleRate, cpuFreq = 3500000, lpCutoff = 7000) {
    this.tps = cpuFreq / sampleRate; // T-states per output sample
    this.level = 0; // carried speaker level (0..~1.2 with mic mix)
    this.windowFilled = 0; // T-states already integrated into the in-progress sample
    this.accCarry = 0; // area (level·T-states) accumulated for the in-progress sample
    this.lpAlpha = 1 - Math.exp(-2 * Math.PI * lpCutoff / sampleRate);
    this.lp = 0;
    this.dcCoeff = 0.9995;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }

  /**
   * Render one emulation frame. Emits as many whole samples as fit the frame's
   * real duration and carries the partial sample to the next frame, so the
   * sample clock stays locked to emulation time.
   *
   * @param {Float64Array} edges    flat [tState, level] pairs, frame-relative, ascending
   * @param {number} count          number of edge pairs
   * @param {number} frameTStates   exact T-state length of this frame
   * @param {Float32Array} out      destination (>= ~tps^-1·frameTStates + 1 samples)
   * @returns {number}              samples written to `out`
   */
  renderFrame(edges, count, frameTStates, out) {
    const tps = this.tps;
    let eix = 0;
    let cur = 0; // integration cursor within this frame
    let level = this.level;
    let written = 0;
    for (;;) {
      const need = tps - this.windowFilled; // T-states left to finish current sample
      const end = cur + need;
      if (end <= frameTStates) {
        // sample completes inside this frame: integrate [cur, end)
        let area = 0;
        while (eix < count && edges[eix * 2] < end) {
          const et = edges[eix * 2];
          if (et > cur) {
            area += level * (et - cur);
            cur = et;
          }
          level = edges[eix * 2 + 1];
          ++eix;
        }
        area += level * (end - cur);
        cur = end;
        const avg = (this.accCarry + area) / tps;
        this.accCarry = 0;
        this.windowFilled = 0;
        out[written++] = this._shape(avg);
      } else {
        // frame ends mid-sample: integrate [cur, frameTStates) and carry the partial
        let area = 0;
        while (eix < count && edges[eix * 2] < frameTStates) {
          const et = edges[eix * 2];
          if (et > cur) {
            area += level * (et - cur);
            cur = et;
          }
          level = edges[eix * 2 + 1];
          ++eix;
        }
        area += level * (frameTStates - cur);
        this.accCarry += area;
        this.windowFilled += frameTStates - cur;
        break;
      }
    }
    this.level = level;
    return written;
  }

  /** one-pole low-pass + bipolar + DC blocker + output trim */
  _shape(avg) {
    this.lp += this.lpAlpha * (avg - this.lp);
    const bipolar = (this.lp - 0.5) * 2;
    const out0 = bipolar - this.dcPrevIn + this.dcCoeff * this.dcPrevOut;
    this.dcPrevIn = bipolar;
    this.dcPrevOut = out0;
    return out0 * 0.6;
  }
  reset() {
    this.level = 0;
    this.windowFilled = 0;
    this.accCarry = 0;
    this.lp = 0;
    this.dcPrevIn = 0;
    this.dcPrevOut = 0;
  }
}

class SpectrumAudioWorklet {
  /* -------------------------- ZX constants --------------------------- */
  static T_STATES_PER_FRAME = 69_888; // PAL Spectrum
  static FRAMES_PER_SECOND = 50;
  static CPU_FREQ = SpectrumAudioWorklet.T_STATES_PER_FRAME * SpectrumAudioWorklet.FRAMES_PER_SECOND; // 3 494 400 Hz
  static MAX_EDGES_PER_FRAME = 2_048; // safe worst-case

  /* =================================================================== */
  constructor() {
    /* Audio graph (created in init) --------------------------------- */
    this.audioContext = null;
    this.workletNode = null;
    this.compressor = null;
    this.gainNode = null;

    /* Edge-buffer pool (pre-allocated, reused every frame) ---------- */
    this.edgePool = Array.from({
      length: 4
    },
    // 4 buffers = 80 ms latency guard
    () => new Float64Array(SpectrumAudioWorklet.MAX_EDGES_PER_FRAME * 2));

    /* Frame / beeper state ----------------------------------------- */
    this.currentLevel = 0; // last beeper level (0-1)
    this.frameEdges = []; // edges for current frame
    this.totalTStates = 0; // absolute CPU clock
    this.frameCount = 0;
    this.edgeCountTot = 0;

    /* UI / misc ----------------------------------------------------- */
    this.volume = 0.5;
    this.enabled = false;
    this.resumeButton = null;
    this.debugMode = false;
  }

  /* ============================ INIT ================================= */
  async init() {
    if (this.audioContext) {
      return this.enabled;
    }
    try {
      /* ---------- 1. Create AudioContext ------------------------- */
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive',
        sampleRate: 48_000 // polite request; browser may ignore
      });
      this.audioContext.addEventListener('statechange', () => this.#updateResumeBtn());
      const SR = this.audioContext.sampleRate; // actual rate granted

      /* ---------- 2. Inject AudioWorklet processor --------------- */
      const processorSrc = this.#buildProcessorSource(SR);
      const blobURL = URL.createObjectURL(new Blob([processorSrc], {
        type: 'application/javascript'
      }));
      await this.audioContext.audioWorklet.addModule(blobURL);
      URL.revokeObjectURL(blobURL);

      /* ---------- 3. Create nodes & graph ------------------------ */
      this.workletNode = new AudioWorkletNode(this.audioContext, 'zx-beeper');
      this.workletNode.port.onmessage = e => {
        if (e.data?.returnBuffer instanceof ArrayBuffer) {
          // Buffer returned from the worklet, reuse it.
          this.edgePool.push(new Float64Array(e.data.returnBuffer));
        }
      };
      this.compressor = this.audioContext.createDynamicsCompressor();
      /* AudioParams must be set via `.value` */
      this.compressor.threshold.value = -12;
      this.compressor.knee.value = 2;
      this.compressor.ratio.value = 2;
      this.compressor.attack.value = 0.001;
      this.compressor.release.value = 0.1;
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 0;
      this.workletNode.connect(this.compressor);
      this.compressor.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      /* ---------- 4. Fade-in & UI resume button ------------------ */
      this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
      this.gainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.1);
      if (this.audioContext.state === 'suspended') {
        this.#createResumeBtn();
      }
      this.enabled = true;
      return true;
    } catch (err) {
      console.error('AudioWorklet init failed:', err);
      this.enabled = false;
      return false;
    }
  }

  /* =================================================================== */
  /* ---------------------- FRAME-LEVEL API ---------------------------- */
  setBeeperState(value, tState) {
    if (!this.enabled) {
      return;
    }
    const ear = value & 0x10 ? 1 : 0; // speaker bit
    const mic = value & 0x08 ? 0 : 1; // MIC is inverted
    const level = ear * 0.9 + mic * 0.33; // empiric mix

    if (level !== this.currentLevel) {
      this.frameEdges.push({
        tState,
        level
      });
      this.currentLevel = level;
      ++this.edgeCountTot;
    }
  }
  startFrame() {
    // First edge guarantees we always have a starting level.
    this.frameEdges = [{
      tState: 0,
      level: this.currentLevel
    }];
  }
  endFrame(frameTStates) {
    if (!this.enabled || !this.workletNode) {
      return;
    }
    this.totalTStates += frameTStates;
    ++this.frameCount;
    const buf = this.edgePool.pop() ||
    // reuse if available
    new Float64Array(SpectrumAudioWorklet.MAX_EDGES_PER_FRAME * 2);
    const count = Math.min(this.frameEdges.length, SpectrumAudioWorklet.MAX_EDGES_PER_FRAME);
    for (let i = 0; i < count; ++i) {
      const e = this.frameEdges[i];
      buf[i * 2] = e.tState;
      buf[i * 2 + 1] = e.level;
    }
    this.workletNode.port.postMessage({
      frame: true,
      edges: buf,
      edgeCount: count,
      frameTStates,
      syncTState: this.totalTStates
    }, [buf.buffer]); // transfer ownership
  }

  /* =============================== UTILITIES ========================= */
  reset() {
    if (!this.enabled) {
      return;
    }
    this.gainNode?.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.02);
    this.currentLevel = 0;
    this.frameEdges = [];
    this.totalTStates = 0;
    this.frameCount = 0;
    this.edgeCountTot = 0;
    this.workletNode?.port.postMessage({
      reset: true
    });
    setTimeout(() => {
      this.gainNode?.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + 0.05);
    }, 30);
  }
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gainNode) {
      this.gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), this.audioContext.currentTime + 0.1);
    }
  }
  setMuted(muted) {
    this.setVolume(muted ? 0 : this.volume);
  }
  setDebugMode(on) {
    this.debugMode = !!on;
  }
  isReady() {
    return this.enabled && this.audioContext?.state === 'running';
  }
  getStats() {
    return {
      enabled: this.enabled,
      contextState: this.audioContext ? this.audioContext.state : 'closed',
      sampleRate: this.audioContext ? this.audioContext.sampleRate : 0,
      totalTStates: this.totalTStates,
      frameCount: this.frameCount,
      totalEdges: this.edgeCountTot,
      bufferSize: SpectrumAudioWorklet.MAX_EDGES_PER_FRAME,
      volume: this.volume
    };
  }

  /* ---------------------------- SHUTDOWN ----------------------------- */
  async stop() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    this.gainNode?.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 0.05);
    await new Promise(res => setTimeout(res, 60));
    this.workletNode?.disconnect();
    this.compressor?.disconnect();
    this.gainNode?.disconnect();
    await this.audioContext?.close();
    this.workletNode = this.compressor = this.gainNode = this.audioContext = null;
    this.resumeButton?.remove();
    this.resumeButton = null;
  }

  /* ======================= PRIVATE HELPERS =========================== */
  #buildProcessorSource(sr) {
    /* String-template so we can embed sample-rate-dependent constants. The
       shared band-limited resampler is inlined via toString() so there is one
       source of truth for the DSP across the worklet, the fallback and tests. */
    return `
            const BeeperResampler = ${BeeperResampler.toString()};

            class ZXBeeperProcessor extends AudioWorkletProcessor {
                constructor () {
                    super();
                    this.sr = ${sr};
                    this.samplesPerFrame = Math.round(this.sr / 50);
                    this.resampler = new BeeperResampler(this.sr, 3500000);
                    this.tmp = new Float32Array(this.samplesPerFrame + 16);

                    /* Sample ring buffer: decouples bursty postMessage frame
                       delivery from the steady audio callback, so late or
                       batched frames no longer drop/repeat (the old clicks). */
                    this.RING   = this.samplesPerFrame * 8;
                    this.ring   = new Float32Array(this.RING);
                    this.rHead  = 0;
                    this.rTail  = 0;
                    this.avail  = 0;
                    this.lastOut = 0;

                    this.port.onmessage = e => this.#onMessage(e.data);
                }

                #onMessage (d) {
                    if (d.frame) {
                        const edgeBuf = new Float64Array(d.edges);
                        const n = this.resampler.renderFrame(
                            edgeBuf, d.edgeCount | 0, d.frameTStates | 0, this.tmp);
                        for (let s = 0; s < n; ++s) {
                            if (this.avail < this.RING) {
                                this.ring[this.rHead] = this.tmp[s];
                                this.rHead = (this.rHead + 1) % this.RING;
                                ++this.avail;
                            }
                        }
                        /* return buffer for reuse */
                        this.port.postMessage({ returnBuffer: edgeBuf.buffer },
                                              [edgeBuf.buffer]);
                    } else if (d.reset) {
                        this.resampler.reset();
                        this.rHead = this.rTail = this.avail = 0;
                        this.lastOut = 0;
                    }
                }

                process (_in, out) {
                    const ch = out[0][0];
                    if (!ch) return true;
                    for (let i = 0, n = ch.length; i < n; ++i) {
                        if (this.avail > 0) {
                            this.lastOut = this.ring[this.rTail];
                            this.rTail = (this.rTail + 1) % this.RING;
                            --this.avail;
                        }
                        ch[i] = this.lastOut; // hold last sample on underrun (click-free)
                    }
                    return true;
                }
            }
            registerProcessor("zx-beeper", ZXBeeperProcessor);
        `;
  }

  /* ----------- resume-button helpers (unchanged UI) ------------------ */
  #createResumeBtn() {
    // Resume button creation disabled - audio context will be resumed programmatically
    return;
  }
  #updateResumeBtn() {
    // No resume button to update
    return;
  }
}

/**
 * ZX Spectrum .z80 Snapshot Loader.
 *
 * Supports 48K v1 snapshots and the 48K-compatible v2/v3 page layout used by
 * many emulators for saved 48K games.
 */

const BASE_HEADER_LENGTH = 30;
const RAM_48K_LENGTH = 49152;
const RAM_PAGE_LENGTH = 0x4000;
const EXTENDED_HEADER_START = 30;
const EXTENDED_MEMORY_PAGES_48K = new Map([[8, 0x4000], [4, 0x8000], [5, 0xc000]]);
const REQUIRED_48K_PAGES = [4, 5, 8];
class Z80SnapshotLoader {
  constructor(memory, cpu, ula) {
    this.memory = memory;
    this.cpu = cpu;
    this.ula = ula;
  }

  /**
   * Load a snapshot from a Uint8Array
   * @param {Uint8Array} data snapshot data
   */
  load(data) {
    if (!(data instanceof Uint8Array)) {
      throw new Error('Snapshot data must be Uint8Array');
    }
    if (data.length < BASE_HEADER_LENGTH) {
      throw new Error('Snapshot too small');
    }
    const header = data.subarray(0, BASE_HEADER_LENGTH);
    const basePc = this._word(header, 6);
    const snapshot = basePc === 0 ? this._readExtended48K(data) : {
      pc: basePc,
      blocks: [{
        address: 0x4000,
        data: this._readV1Memory(data)
      }]
    };

    // Byte 12 per the .z80 spec: bit 0 = bit 7 of R, bits 1-3 = border,
    // bit 5 = data compressed. Compatibility rule: 255 means 1.
    const flags1 = header[12] === 0xff ? 1 : header[12];
    this._loadRegisters(header, flags1, snapshot.pc);
    for (const block of snapshot.blocks) {
      this._writeMemory(block.address, block.data);
    }
  }
  _loadRegisters(header, flags1, pc) {
    const regs = this.cpu.registers;
    regs.set('A', header[0]);
    regs.set('F', header[1]);
    regs.set('C', header[2]);
    regs.set('B', header[3]);
    regs.set('L', header[4]);
    regs.set('H', header[5]);
    regs.set16('PC', pc);
    regs.set16('SP', this._word(header, 8));
    regs.data.I = header[10];
    regs.data.R = header[11] & 0x7f | (flags1 & 0x01) << 7;
    const border = flags1 >> 1 & 0x07;
    regs.set('E', header[13]);
    regs.set('D', header[14]);
    regs.data.C_ = header[15];
    regs.data.B_ = header[16];
    regs.data.E_ = header[17];
    regs.data.D_ = header[18];
    regs.data.L_ = header[19];
    regs.data.H_ = header[20];
    regs.data.A_ = header[21];
    regs.data.F_ = header[22];
    regs.set16('IY', header[23] | header[24] << 8);
    regs.set16('IX', header[25] | header[26] << 8);
    this.cpu.iff1 = header[27] !== 0;
    this.cpu.iff2 = header[28] !== 0;
    this.cpu.interruptMode = header[29] & 0x03; // bits 2-7 are other flags

    if (this.ula && typeof this.ula.setBorderColor === 'function') {
      this.ula.setBorderColor(border);
    }
  }
  _readV1Memory(data) {
    const flags1 = data[12] === 0xff ? 1 : data[12];
    const compressed = (flags1 & 0x20) !== 0;
    return compressed ? this._decompress(data.subarray(BASE_HEADER_LENGTH), RAM_48K_LENGTH, true) : this._copyFixed(data.subarray(BASE_HEADER_LENGTH), RAM_48K_LENGTH);
  }
  _readExtended48K(data) {
    if (data.length < 32) {
      throw new Error('Unsupported .z80 extended snapshot: missing extended header length');
    }
    const extraLength = this._word(data, EXTENDED_HEADER_START);
    const version = this._extendedVersion(extraLength);
    if (!version) {
      throw new Error(`Unsupported .z80 extended snapshot header length: ${extraLength}`);
    }
    const headerEnd = EXTENDED_HEADER_START + 2 + extraLength;
    if (data.length < headerEnd) {
      throw new Error('Truncated .z80 extended snapshot header');
    }
    const hardwareMode = data[34];
    if (!this._is48KCompatibleHardware(version, hardwareMode)) {
      throw new Error(`Unsupported .z80 ${version} hardware mode for 48K emulator: ${hardwareMode}`);
    }
    const blocks = [];
    const seenPages = new Set();
    let offset = headerEnd;
    while (offset < data.length) {
      if (offset + 3 > data.length) {
        throw new Error('Truncated .z80 memory block header');
      }
      const encodedLength = this._word(data, offset);
      const page = data[offset + 2];
      offset += 3;
      const payloadLength = encodedLength === 0xffff ? RAM_PAGE_LENGTH : encodedLength;
      if (offset + payloadLength > data.length) {
        throw new Error('Truncated .z80 memory block data');
      }
      const address = EXTENDED_MEMORY_PAGES_48K.get(page);
      const payload = data.subarray(offset, offset + payloadLength);
      offset += payloadLength;
      if (address === undefined) {
        continue;
      }
      const pageData = encodedLength === 0xffff ? this._copyFixed(payload, RAM_PAGE_LENGTH) : this._decompress(payload, RAM_PAGE_LENGTH, false);
      blocks.push({
        address,
        data: pageData
      });
      seenPages.add(page);
    }
    for (const page of REQUIRED_48K_PAGES) {
      if (!seenPages.has(page)) {
        throw new Error(`Truncated .z80 48K snapshot: missing RAM page ${page}`);
      }
    }
    return {
      pc: this._word(data, 32),
      blocks
    };
  }
  _writeMemory(address, data) {
    for (let i = 0; i < data.length; i++) {
      this.memory.write(address + i, data[i]);
    }
  }
  _copyFixed(data, length) {
    const result = new Uint8Array(length);
    result.set(data.subarray(0, length));
    return result;
  }
  _decompress(data, expectedLength, stopAtEndMarker) {
    const result = new Uint8Array(expectedLength);
    let ptr = 0;
    let i = 0;
    while (i < data.length && ptr < result.length) {
      const b = data[i++];
      if (stopAtEndMarker && b === 0x00 && i + 2 < data.length && data[i] === 0xed && data[i + 1] === 0xed && data[i + 2] === 0x00) {
        break;
      }
      if (b === 0xed && i < data.length && data[i] === 0xed) {
        if (i + 2 >= data.length) {
          break;
        }
        const count = data[i + 1];
        const value = data[i + 2];
        i += 3;
        if (count !== 0) {
          const end = Math.min(ptr + count, result.length);
          result.fill(value, ptr, end);
          ptr = end;
        }
        continue;
      }
      result[ptr++] = b;
    }
    return result;
  }
  _extendedVersion(extraLength) {
    if (extraLength === 23) return 'v2';
    if (extraLength === 54 || extraLength === 55) return 'v3';
    return undefined;
  }
  _is48KCompatibleHardware(version, hardwareMode) {
    if (hardwareMode === 0 || hardwareMode === 1) return true;
    return version === 'v3' && hardwareMode === 3;
  }
  _word(data, offset) {
    return (data[offset] | data[offset + 1] << 8) & 0xffff;
  }
}

/**
 * ZX Spectrum Tape Emulation
 * Supports TAP and TZX tape formats
 *
 * Key findings from research:
 * - Each bit is represented by 2 pulses (complete square wave)
 * - Pilot tone: 8063 pulses for headers, 3223 for data blocks
 * - Standard timings: PILOT=2168, SYNC1=667, SYNC2=735, ZERO=855, ONE=1710 T-states
 * - Edge-triggered loading (polarity doesn't matter)
 * - TAP format is simple: 2-byte length + data (including flag + checksum)
 * - TZX format supports multiple block types for custom loaders
 */
/* eslint-disable no-console */

class Tape {
  constructor(spectrum) {
    this.spectrum = spectrum;
    this.cpu = spectrum.cpu;
    this.ula = spectrum.ula;

    // Tape state
    this.playing = false;
    this.paused = false;
    this.position = 0;
    this.data = null;
    this.format = null;

    // Verbose per-block/per-pulse tracing. Off by default so playback does not
    // flood the console (and pay the formatting cost) on every edge; set to true
    // to debug loaders. console.warn/console.error remain unconditional.
    this.debug = false;

    // Current block info
    this.currentBlock = null;
    this.blockIndex = 0;
    this.bitPosition = 0;
    this.currentBit = 0; // Current bit value (0 or 1)
    this.lastEarBit = 0; // Last EAR bit state (0 or 1)

    // Timing
    this.nextEdgeCycle = 0;
    this.lastUpdateCycle = 0;

    // Block state machine
    this.state = 'IDLE';
    this.pulseCount = 0; // Number of pulses generated
    this.edgeCount = 0; // Number of edges generated
    this.bytePosition = 0;
    this.pauseCycles = 0;

    // Pulse sequence state
    this.pulseIndex = 0;
    this.pulseCycles = 0;

    // Parsed blocks
    this.blocks = [];

    // TAP/TZX block types
    this.BLOCK_STANDARD = 0x10;
    this.BLOCK_TURBO = 0x11;
    this.BLOCK_PURE_TONE = 0x12;
    this.BLOCK_PULSE_SEQUENCE = 0x13;
    this.BLOCK_PURE_DATA = 0x14;
    this.BLOCK_PAUSE = 0x20;
    this.BLOCK_GROUP_START = 0x21;
    this.BLOCK_GROUP_END = 0x22;
    this.BLOCK_TEXT = 0x30;
    this.BLOCK_MESSAGE = 0x31;
    this.BLOCK_ARCHIVE_INFO = 0x32;
    this.BLOCK_HARDWARE_TYPE = 0x33;

    // Standard timing constants (in T-states)
    this.PILOT_PULSE = 2168;
    this.SYNC1_PULSE = 667;
    this.SYNC2_PULSE = 735;
    this.ZERO_PULSE = 855;
    this.ONE_PULSE = 1710;
    this.PILOT_PULSES_HEADER = 8063; // Number of pilot pulses for headers
    this.PILOT_PULSES_DATA = 3223; // Number of pilot pulses for data

    // Standard pause after block (in milliseconds)
    this.STANDARD_PAUSE = 500; // Reduced from 1000ms for better compatibility

    // Cycles per millisecond (3.5MHz for 48K Spectrum)
    this.CYCLES_PER_MS = 3500;
  }

  /** Gated verbose log — only emitted when `this.debug` is enabled. */
  _log(...args) {
    if (this.debug) {
      console.log(...args);
    }
  }

  /**
   * Load a tape file
   * @param {ArrayBuffer} buffer - The tape file data
   * @param {string} filename - The filename to determine format
   */
  load(buffer, filename) {
    this.data = new Uint8Array(buffer);
    this.position = 0;
    this.blockIndex = 0;
    this.reset();

    // Determine format from extension
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'tap') {
      this.format = 'TAP';
      this.parseTAP();
    } else if (ext === 'tzx') {
      this.format = 'TZX';
      this.parseTZX();
    } else {
      throw new Error(`Unsupported tape format: ${ext}`);
    }
    this._log(`Loaded ${this.format} file: ${filename}`);
    this._log(`Total blocks: ${this.blocks.length}`);
    this.blocks.forEach((block, i) => {
      const type = this.getBlockTypeName(block.type);
      this._log(`Block ${i}: ${type}, ` + `${block.data ? `${block.data.length} bytes` : 'no data'}, ` + `pause=${block.pause || 0}ms`);
    });
  }

  /**
   * Parse TAP format
   */
  parseTAP() {
    this.blocks = [];
    let pos = 0;
    while (pos < this.data.length) {
      // Check if we have at least 2 bytes for length
      if (pos + 2 > this.data.length) {
        console.warn('TAP file truncated at position', pos);
        break;
      }

      // Read block length (little-endian)
      const length = this.data[pos] | this.data[pos + 1] << 8;
      pos += 2;
      if (pos + length > this.data.length) {
        console.warn(`TAP file truncated: expected ${length} bytes at position ${pos}`);
        break;
      }

      // Create standard speed data block
      const blockData = this.data.slice(pos, pos + length);
      const flagByte = blockData[0];

      // Different pause times for headers vs data blocks
      const pauseTime = flagByte < 128 ? 100 : 500; // Shorter pause after headers

      const block = {
        type: this.BLOCK_STANDARD,
        data: blockData,
        pilotPulse: this.PILOT_PULSE,
        sync1Pulse: this.SYNC1_PULSE,
        sync2Pulse: this.SYNC2_PULSE,
        zeroPulse: this.ZERO_PULSE,
        onePulse: this.ONE_PULSE,
        pilotPulses: flagByte < 128 ? this.PILOT_PULSES_HEADER : this.PILOT_PULSES_DATA,
        pause: pauseTime,
        // Different pauses for header/data
        usedBits: 8 // All bits used in TAP format
      };
      this.blocks.push(block);

      // Log block info
      const blockType = flagByte === 0x00 ? 'Header' : 'Data';
      this._log(`TAP Block ${this.blocks.length - 1}: ${blockType} (flag=0x${flagByte.toString(16).padStart(2, '0')}), ` + `${length} bytes`);
      pos += length;
    }
  }

  /**
   * Parse TZX format
   */
  parseTZX() {
    this.blocks = [];

    // Check TZX header
    const header = String.fromCharCode(...this.data.slice(0, 7));
    if (header !== 'ZXTape!') {
      throw new Error('Invalid TZX file header');
    }
    const eofMarker = this.data[7];
    if (eofMarker !== 0x1a) {
      throw new Error('Invalid TZX EOF marker');
    }
    const majorVersion = this.data[8];
    const minorVersion = this.data[9];
    this._log(`TZX version ${majorVersion}.${minorVersion}`);

    // Skip header
    let pos = 10;
    while (pos < this.data.length) {
      const blockId = this.data[pos];
      pos++;
      try {
        switch (blockId) {
          case this.BLOCK_STANDARD:
            pos = this.parseTZXStandardBlock(pos);
            break;
          case this.BLOCK_TURBO:
            pos = this.parseTZXTurboBlock(pos);
            break;
          case this.BLOCK_PURE_TONE:
            pos = this.parseTZXPureToneBlock(pos);
            break;
          case this.BLOCK_PULSE_SEQUENCE:
            pos = this.parseTZXPulseSequenceBlock(pos);
            break;
          case this.BLOCK_PURE_DATA:
            pos = this.parseTZXPureDataBlock(pos);
            break;
          case this.BLOCK_PAUSE:
            pos = this.parseTZXPauseBlock(pos);
            break;
          case this.BLOCK_GROUP_START:
          case this.BLOCK_GROUP_END:
          case this.BLOCK_TEXT:
          case this.BLOCK_MESSAGE:
          case this.BLOCK_ARCHIVE_INFO:
          case this.BLOCK_HARDWARE_TYPE:
            pos = this.skipTZXInfoBlock(pos, blockId);
            break;
          default:
            console.warn(`Unknown TZX block type: 0x${blockId.toString(16)} at position ${pos - 1}`);
            // Try to skip unknown block by looking for size. Clamp the jump so a
            // corrupt/oversized length can neither move backwards nor overshoot.
            if (pos + 4 <= this.data.length) {
              const size = this.readDWord(pos);
              const next = pos + 4 + size;
              pos = next > this.data.length ? this.data.length : next;
            } else {
              pos = this.data.length;
            }
        }
      } catch (e) {
        console.error(`Error parsing TZX block 0x${blockId.toString(16)} at position ${pos - 1}:`, e);
        break;
      }
    }
  }

  /**
   * Parse TZX standard speed data block (ID 10h)
   */
  parseTZXStandardBlock(pos) {
    if (pos + 4 > this.data.length) {
      throw new Error('Insufficient data for standard block');
    }
    const pause = this.readWord(pos);
    const length = this.readWord(pos + 2);
    if (pos + 4 + length > this.data.length) {
      throw new Error('Insufficient data for standard block data');
    }
    const blockData = this.data.slice(pos + 4, pos + 4 + length);
    const flagByte = blockData[0];
    const block = {
      type: this.BLOCK_STANDARD,
      data: blockData,
      pilotPulse: this.PILOT_PULSE,
      sync1Pulse: this.SYNC1_PULSE,
      sync2Pulse: this.SYNC2_PULSE,
      zeroPulse: this.ZERO_PULSE,
      onePulse: this.ONE_PULSE,
      pilotPulses: flagByte < 128 ? this.PILOT_PULSES_HEADER : this.PILOT_PULSES_DATA,
      pause,
      usedBits: 8
    };
    this.blocks.push(block);
    return pos + 4 + length;
  }

  /**
   * Parse TZX turbo speed data block (ID 11h)
   */
  parseTZXTurboBlock(pos) {
    if (pos + 18 > this.data.length) {
      throw new Error('Insufficient data for turbo block');
    }
    const block = {
      type: this.BLOCK_TURBO,
      pilotPulse: this.readWord(pos),
      sync1Pulse: this.readWord(pos + 2),
      sync2Pulse: this.readWord(pos + 4),
      zeroPulse: this.readWord(pos + 6),
      onePulse: this.readWord(pos + 8),
      pilotPulses: this.readWord(pos + 10),
      usedBits: this.data[pos + 12],
      pause: this.readWord(pos + 13),
      dataLength: this.readTriple(pos + 15)
    };
    const dataStart = pos + 18;
    if (dataStart + block.dataLength > this.data.length) {
      throw new Error('Insufficient data for turbo block data');
    }
    block.data = this.data.slice(dataStart, dataStart + block.dataLength);
    this.blocks.push(block);
    return dataStart + block.dataLength;
  }

  /**
   * Parse TZX pure tone block (ID 12h)
   */
  parseTZXPureToneBlock(pos) {
    if (pos + 4 > this.data.length) {
      throw new Error('Insufficient data for pure tone block');
    }
    const block = {
      type: this.BLOCK_PURE_TONE,
      pulseLength: this.readWord(pos),
      pulseCount: this.readWord(pos + 2)
    };
    this.blocks.push(block);
    return pos + 4;
  }

  /**
   * Parse TZX pulse sequence block (ID 13h)
   */
  parseTZXPulseSequenceBlock(pos) {
    if (pos + 1 > this.data.length) {
      throw new Error('Insufficient data for pulse sequence block');
    }
    const count = this.data[pos];
    const dataPos = pos + 1;
    if (dataPos + count * 2 > this.data.length) {
      throw new Error('Insufficient data for pulse sequence');
    }
    const block = {
      type: this.BLOCK_PULSE_SEQUENCE,
      pulses: []
    };
    for (let i = 0; i < count; i++) {
      block.pulses.push(this.readWord(dataPos + i * 2));
    }
    this.blocks.push(block);
    return dataPos + count * 2;
  }

  /**
   * Parse TZX pure data block (ID 14h)
   */
  parseTZXPureDataBlock(pos) {
    if (pos + 10 > this.data.length) {
      throw new Error('Insufficient data for pure data block');
    }
    const block = {
      type: this.BLOCK_PURE_DATA,
      zeroPulse: this.readWord(pos),
      onePulse: this.readWord(pos + 2),
      usedBits: this.data[pos + 4],
      pause: this.readWord(pos + 5),
      dataLength: this.readTriple(pos + 7)
    };
    const dataStart = pos + 10;
    if (dataStart + block.dataLength > this.data.length) {
      throw new Error('Insufficient data for pure data block data');
    }
    block.data = this.data.slice(dataStart, dataStart + block.dataLength);
    this.blocks.push(block);
    return dataStart + block.dataLength;
  }

  /**
   * Parse TZX pause/silence block (ID 20h)
   */
  parseTZXPauseBlock(pos) {
    if (pos + 2 > this.data.length) {
      throw new Error('Insufficient data for pause block');
    }
    const pause = this.readWord(pos);

    // Pause of 0 means stop the tape
    if (pause === 0) {
      this._log('TZX: Stop the tape block encountered');
    }
    this.blocks.push({
      type: this.BLOCK_PAUSE,
      pause
    });
    return pos + 2;
  }

  /**
   * Skip TZX info blocks
   */
  skipTZXInfoBlock(pos, blockId) {
    switch (blockId) {
      case this.BLOCK_GROUP_START:
        // Group start: length byte + text
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos];
      case this.BLOCK_GROUP_END:
        // Group end: no data
        return pos;
      case this.BLOCK_TEXT:
        // Text description: length byte + text
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos];
      case this.BLOCK_MESSAGE:
        // Message block: time byte + length byte + text
        if (pos + 2 > this.data.length) {
          return this.data.length;
        }
        return pos + 2 + this.data[pos + 1];
      case this.BLOCK_ARCHIVE_INFO:
        // Archive info: length word + data
        if (pos + 2 > this.data.length) {
          return this.data.length;
        }
        return pos + 2 + this.readWord(pos);
      case this.BLOCK_HARDWARE_TYPE:
        // Hardware type: count byte + 3 bytes per entry
        if (pos + 1 > this.data.length) {
          return this.data.length;
        }
        return pos + 1 + this.data[pos] * 3;
      default:
        return pos;
    }
  }

  /**
   * Read a 16-bit word (little-endian)
   */
  readWord(pos) {
    return this.data[pos] | this.data[pos + 1] << 8;
  }

  /**
   * Read a 24-bit triple (little-endian)
   */
  readTriple(pos) {
    return this.data[pos] | this.data[pos + 1] << 8 | this.data[pos + 2] << 16;
  }

  /**
   * Read a 32-bit dword (little-endian)
   */
  readDWord(pos) {
    // `>>> 0` forces an unsigned 32-bit result; without it a high byte >= 0x80
    // makes the `<< 24` term negative, which can drive parse offsets backwards.
    return (this.data[pos] | this.data[pos + 1] << 8 | this.data[pos + 2] << 16 | this.data[pos + 3] << 24) >>> 0;
  }

  /**
   * Get block type name
   */
  getBlockTypeName(type) {
    const names = {
      0x10: 'Standard Speed Data',
      0x11: 'Turbo Speed Data',
      0x12: 'Pure Tone',
      0x13: 'Pulse Sequence',
      0x14: 'Pure Data',
      0x20: 'Pause/Stop',
      0x21: 'Group Start',
      0x22: 'Group End',
      0x30: 'Text Description',
      0x31: 'Message',
      0x32: 'Archive Info',
      0x33: 'Hardware Type'
    };
    return names[type] || `Unknown (0x${type.toString(16)})`;
  }

  /**
   * Reset tape state
   */
  reset() {
    this.state = 'IDLE';
    this.currentBlock = null;
    this.lastEarBit = 0;
    this.nextEdgeCycle = 0;
    this.pulseCount = 0;
    this.edgeCount = 0;
    this.bitPosition = 0;
    this.bytePosition = 0;
    this.currentBit = 0;
    this.pauseCycles = 0;
    this.pulseIndex = 0;
    this.pulseCycles = 0;
  }

  /**
   * Start playing the tape
   */
  play() {
    if (!this.blocks || this.blocks.length === 0) {
      this._log('No blocks to play');
      return;
    }
    this._log('Starting tape playback');
    this.playing = true;
    this.paused = false;

    // Initialize timing
    this.lastUpdateCycle = this.cpu.cycles;
    if (!this.currentBlock) {
      this.nextBlock();
    }
  }

  /**
   * Pause tape playback
   */
  pause() {
    this.paused = true;
    this._log('Tape paused');
  }

  /**
   * Stop tape playback
   */
  stop() {
    this.playing = false;
    this.paused = false;
    this.blockIndex = 0;
    this.reset();
    this._log('Tape stopped');
  }

  /**
   * Rewind tape to beginning
   */
  rewind() {
    this.stop();
    this.blockIndex = 0;
    this._log('Tape rewound');
  }

  /**
   * Move to next block
   */
  nextBlock() {
    if (this.blockIndex >= this.blocks.length) {
      this._log('End of tape reached');
      this.stop();
      return;
    }
    this.currentBlock = this.blocks[this.blockIndex];
    const blockType = this.getBlockTypeName(this.currentBlock.type);
    this._log(`\nStarting block ${this.blockIndex}: ${blockType}`);
    if (this.currentBlock.data) {
      const flagByte = this.currentBlock.data[0];
      this._log(`  Flag byte: 0x${flagByte.toString(16).padStart(2, '0')} (${flagByte < 128 ? 'Header' : 'Data'})`);
      this._log(`  Data length: ${this.currentBlock.data.length} bytes`);
      this._log(`  Pause after: ${this.currentBlock.pause || 0}ms`);
    }
    this.blockIndex++;

    // Reset block state
    this.bitPosition = 0;
    this.bytePosition = 0;
    this.pulseCount = 0;
    this.edgeCount = 0;
    this.pulseIndex = 0;
    this.pulseCycles = 0;

    // Initialize block state based on type
    switch (this.currentBlock.type) {
      case this.BLOCK_STANDARD:
      case this.BLOCK_TURBO:
        this.state = 'PILOT';
        // Initialize next edge timing
        this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pilotPulse;
        this._log(`  Starting PILOT state with ${this.currentBlock.pilotPulses} pulses`);
        break;
      case this.BLOCK_PAUSE:
        this.state = 'PAUSE';
        this.pauseCycles = this.currentBlock.pause * this.CYCLES_PER_MS;
        // If pause is 0, stop the tape
        if (this.currentBlock.pause === 0) {
          this._log('Stop the tape command encountered');
          this.stop();
        }
        break;
      case this.BLOCK_PURE_TONE:
        this.state = 'TONE';
        this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pulseLength;
        break;
      case this.BLOCK_PULSE_SEQUENCE:
        this.state = 'PULSES';
        if (this.currentBlock.pulses.length > 0) {
          this.nextEdgeCycle = this.cpu.cycles + this.currentBlock.pulses[0];
        }
        break;
      case this.BLOCK_PURE_DATA:
        this.state = 'DATA';
        // Pure data block starts directly with data, no pilot or sync
        this.nextEdgeCycle = this.cpu.cycles;
        break;
      default:
        console.warn(`Unsupported block type: ${this.currentBlock.type}`);
        this.nextBlock();
    }
  }

  /**
   * Update tape playback
   * @param {number} cycles - Current CPU cycle count
   * @returns {number} - Current tape input bit (0 or 1)
   */
  update(cycles) {
    if (!this.playing || this.paused || !this.currentBlock) {
      return this.lastEarBit;
    }

    // Handle pause state first (can occur after any block type)
    if (this.state === 'PAUSE') {
      this.updatePauseState(cycles);
      this.lastUpdateCycle = cycles;
      return this.lastEarBit;
    }

    // Update based on current block type
    switch (this.currentBlock.type) {
      case this.BLOCK_STANDARD:
      case this.BLOCK_TURBO:
        this.updateDataBlock(cycles);
        break;
      case this.BLOCK_PAUSE:
        this.updatePauseBlock(cycles);
        break;
      case this.BLOCK_PURE_TONE:
        this.updateToneBlock(cycles);
        break;
      case this.BLOCK_PULSE_SEQUENCE:
        this.updatePulseSequenceBlock(cycles);
        break;
      case this.BLOCK_PURE_DATA:
        this.updatePureDataBlock(cycles);
        break;
    }
    this.lastUpdateCycle = cycles;
    return this.lastEarBit;
  }

  /**
   * Update standard/turbo data block
   */
  updateDataBlock(cycles) {
    const block = this.currentBlock;

    // Check if it's time for next edge
    if (cycles < this.nextEdgeCycle) {
      return;
    }

    // Toggle EAR bit
    this.lastEarBit = 1 - this.lastEarBit;
    switch (this.state) {
      case 'PILOT':
        // Generate pilot tone
        this.nextEdgeCycle += block.pilotPulse;
        this.edgeCount++;

        // Each pulse consists of 2 edges
        if (this.edgeCount >= block.pilotPulses * 2) {
          this._log(`Pilot complete after ${this.edgeCount} edges`);
          this.state = 'SYNC1';
          this.nextEdgeCycle = cycles + block.sync1Pulse;
        }
        break;
      case 'SYNC1':
        // First sync pulse
        this.state = 'SYNC2';
        this.nextEdgeCycle = cycles + block.sync2Pulse;
        break;
      case 'SYNC2':
        // Second sync pulse - prepare for data
        this.state = 'DATA';
        this.bytePosition = 0;
        this.bitPosition = 0;
        this.pulseCount = 0;

        // Start with first bit
        if (block.data && block.data.length > 0) {
          this.currentBit = block.data[0] >> 7 & 1;
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
          this._log(`Starting DATA state: ${block.data.length} bytes, first bit=${this.currentBit}`);
        } else {
          // No data, move to next block
          this._log('No data in block, moving to next');
          this.handleBlockEnd();
        }
        break;
      case 'DATA':
        // Output data bits
        this.pulseCount++;

        // Each bit consists of 2 pulses (4 edges)
        if (this.pulseCount < 2) {
          // Same bit, next pulse
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
        } else {
          // Move to next bit
          this.pulseCount = 0;
          this.bitPosition++;
          if (this.bitPosition >= 8) {
            // Move to next byte
            this.bitPosition = 0;
            this.bytePosition++;
            if (this.bytePosition >= block.data.length) {
              // All data sent
              this.handleBlockEnd();
              return;
            }
          }

          // Check if this is the last byte and we have limited bits
          const isLastByte = this.bytePosition === block.data.length - 1;
          const bitsInByte = isLastByte ? block.usedBits : 8;
          if (this.bitPosition < bitsInByte) {
            // Get next bit
            const byte = block.data[this.bytePosition];
            this.currentBit = byte >> 7 - this.bitPosition & 1;
            const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
            this.nextEdgeCycle = cycles + pulseLength;
          } else {
            // No more bits in last byte
            this.handleBlockEnd();
          }
        }
        break;
    }
  }

  /**
   * Update pause state (can occur after any block)
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePauseState(cycles) {
    if (this.pauseCycles > 0) {
      const elapsed = cycles - this.lastUpdateCycle;
      this.pauseCycles -= elapsed;

      // During pause, keep EAR bit low (0)
      this.lastEarBit = 0;
      if (this.pauseCycles <= 0) {
        this._log(`Pause complete after ${elapsed} cycles, moving to next block`);
        this._log(`Current state: ${this.state}, Block index: ${this.blockIndex}/${this.blocks.length}`);
        this.pauseCycles = 0;
        this.state = 'IDLE'; // Reset state before moving to next block
        this.nextBlock();
      }
    } else {
      // No pause cycles, move to next block immediately
      this._log('No pause cycles remaining, moving to next block');
      this.state = 'IDLE';
      this.nextBlock();
    }
  }

  /**
   * Update pause block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePauseBlock(cycles) {
    // For explicit pause blocks, delegate to updatePauseState
    this.updatePauseState(cycles);
  }

  /**
   * Update pure tone block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updateToneBlock(cycles) {
    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;
      this.nextEdgeCycle += this.currentBlock.pulseLength;
      this.pulseCount++;
      if (this.pulseCount >= this.currentBlock.pulseCount) {
        this._log(`Pure tone complete after ${this.pulseCount} pulses`);
        this.nextBlock();
      }
    }
  }

  /**
   * Update pulse sequence block
   *
   * @private
   * @param {number} cycles - Current CPU cycle count
   * @returns {void}
   */
  updatePulseSequenceBlock(cycles) {
    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;
      if (this.pulseIndex < this.currentBlock.pulses.length) {
        this.nextEdgeCycle += this.currentBlock.pulses[this.pulseIndex];
        this.pulseIndex++;
      } else {
        this._log('Pulse sequence complete');
        this.nextBlock();
      }
    }
  }

  /**
   * Update pure data block
   */
  updatePureDataBlock(cycles) {
    const block = this.currentBlock;
    if (cycles >= this.nextEdgeCycle) {
      this.lastEarBit = 1 - this.lastEarBit;
      this.pulseCount++;

      // Each bit consists of 2 pulses
      if (this.pulseCount < 2) {
        // Same bit, next pulse
        const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
        this.nextEdgeCycle = cycles + pulseLength;
      } else {
        // Move to next bit
        this.pulseCount = 0;
        this.bitPosition++;
        if (this.bitPosition >= 8) {
          // Move to next byte
          this.bitPosition = 0;
          this.bytePosition++;
          if (this.bytePosition >= block.data.length) {
            // All data sent
            this.handleBlockEnd();
            return;
          }
        }

        // Check if this is the last byte and we have limited bits
        const isLastByte = this.bytePosition === block.data.length - 1;
        const bitsInByte = isLastByte ? block.usedBits : 8;
        if (this.bitPosition < bitsInByte) {
          // Get next bit
          const byte = block.data[this.bytePosition];
          this.currentBit = byte >> 7 - this.bitPosition & 1;
          const pulseLength = this.currentBit ? block.onePulse : block.zeroPulse;
          this.nextEdgeCycle = cycles + pulseLength;
        } else {
          // No more bits in last byte
          this.handleBlockEnd();
        }
      }
    }
  }

  /**
   * Handle end of current block
   *
   * @private
   * @returns {void}
   */
  handleBlockEnd() {
    const block = this.currentBlock;
    this._log(`Block ${this.blockIndex - 1} complete: ${this.bytePosition} bytes sent`);

    // Check if there's a pause after this block
    if (block.pause && block.pause > 0) {
      this.state = 'PAUSE';
      this.pauseCycles = block.pause * this.CYCLES_PER_MS;
      this._log(`Entering PAUSE state for ${block.pause}ms (${this.pauseCycles} cycles)`);
      this._log(`Next block will be ${this.blockIndex < this.blocks.length ? `block ${this.blockIndex}` : 'end of tape'}`);
    } else {
      // Move to next block immediately
      this._log('No pause, moving to next block immediately');
      this.nextBlock();
    }
  }

  /**
   * Get current tape position as percentage
   *
   * @returns {number} Position as percentage (0-100)
   */
  getPosition() {
    if (!this.blocks || this.blocks.length === 0) {
      return 0;
    }
    const currentBlock = Math.max(0, this.blockIndex - 1);
    return currentBlock / this.blocks.length * 100;
  }

  /**
   * Get human-readable tape status
   *
   * @returns {string} Status message
   */
  getStatus() {
    if (!this.blocks || this.blocks.length === 0) {
      return 'No tape loaded';
    }
    if (!this.playing) {
      return 'Stopped';
    }
    if (this.paused) {
      return 'Paused';
    }
    const currentBlock = Math.max(0, this.blockIndex - 1);
    return `Playing block ${currentBlock + 1}/${this.blocks.length} (${this.state})`;
  }

  /**
   * Get current EAR bit for tape input
   * This is what the Spectrum reads from port 0xFE bit 6
   *
   * @returns {number} Current EAR bit (0 or 1)
   */
  getEarBit() {
    return this.lastEarBit;
  }
}

/**
 * Touch/Virtual Keyboard for ZX Spectrum Emulator
 * Provides on-screen keyboard for mobile devices
 */

class TouchKeyboard {
  constructor(spectrum, container) {
    this.spectrum = spectrum;
    this.container = container;
    this.element = null;
    this.isVisible = false;
    this.activeKeys = new Set();
    this._init();
  }
  _init() {
    // Create keyboard container
    this.element = document.createElement('div');
    this.element.className = 'zx-touch-keyboard';
    this.element.innerHTML = this._generateKeyboardHTML();

    // Add default styles
    this._addStyles();

    // Attach to container
    if (typeof this.container === 'string') {
      document.querySelector(this.container).appendChild(this.element);
    } else {
      this.container.appendChild(this.element);
    }

    // Setup event handlers
    this._setupEventHandlers();

    // Auto-detect if we should show keyboard
    if (this._isTouchDevice()) {
      this.show();
    }
  }
  _generateKeyboardHTML() {
    const rows = [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'], ['CAPS', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'SYMB', 'SPACE']];
    let html = '<div class="zx-keyboard-toggle">⌨️</div>';
    html += '<div class="zx-keyboard-layout">';
    rows.forEach((row, rowIndex) => {
      html += `<div class="zx-keyboard-row row-${rowIndex}">`;
      row.forEach(key => {
        const displayKey = this._getDisplayKey(key);
        const className = this._getKeyClass(key);
        html += `<button class="zx-key ${className}" data-key="${key}">${displayKey}</button>`;
      });
      html += '</div>';
    });

    // Add arrow keys row
    html += '<div class="zx-keyboard-row row-arrows">';
    html += '<button class="zx-key key-arrow" data-key="ArrowLeft">←</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowDown">↓</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowUp">↑</button>';
    html += '<button class="zx-key key-arrow" data-key="ArrowRight">→</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }
  _getDisplayKey(key) {
    const displayMap = {
      CAPS: 'CAPS SHIFT',
      SYMB: 'SYMBOL',
      SPACE: '━━━━━',
      ENTER: '↵'
    };
    return displayMap[key] || key;
  }
  _getKeyClass(key) {
    const classes = [];
    if (['CAPS', 'SYMB', 'ENTER', 'SPACE'].includes(key)) {
      classes.push('key-special');
    }
    if (key === 'SPACE') {
      classes.push('key-space');
    }
    if (key === 'ENTER') {
      classes.push('key-enter');
    }
    if (['CAPS', 'SYMB'].includes(key)) {
      classes.push('key-modifier');
    }
    return classes.join(' ');
  }
  _addStyles() {
    if (document.getElementById('zx-touch-keyboard-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'zx-touch-keyboard-styles';
    style.textContent = `
            .zx-touch-keyboard {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                background: rgba(0, 0, 0, 0.9);
                padding: 10px;
                z-index: 1000;
                user-select: none;
                -webkit-user-select: none;
                touch-action: manipulation;
            }
            
            .zx-keyboard-toggle {
                position: absolute;
                top: -40px;
                right: 10px;
                background: rgba(0, 0, 0, 0.8);
                border: 2px solid #666;
                border-radius: 5px;
                padding: 5px 10px;
                font-size: 24px;
                cursor: pointer;
            }
            
            .zx-keyboard-layout {
                display: none;
            }
            
            .zx-touch-keyboard.visible .zx-keyboard-layout {
                display: block;
            }
            
            .zx-keyboard-row {
                display: flex;
                justify-content: center;
                margin-bottom: 5px;
                gap: 3px;
            }
            
            .zx-key {
                background: #333;
                color: white;
                border: 2px solid #666;
                border-radius: 5px;
                padding: 10px;
                min-width: 35px;
                font-family: monospace;
                font-size: 14px;
                cursor: pointer;
                touch-action: manipulation;
                -webkit-tap-highlight-color: transparent;
            }
            
            .zx-key:active, .zx-key.active {
                background: #666;
                border-color: #999;
            }
            
            .zx-key.key-special {
                background: #444;
                font-size: 12px;
            }
            
            .zx-key.key-space {
                flex: 2;
            }
            
            .zx-key.key-modifier {
                background: #555;
            }
            
            .zx-key.key-modifier.active {
                background: #888;
                border-color: #bbb;
            }
            
            .zx-key.key-arrow {
                min-width: 45px;
            }
            
            @media (max-width: 600px) {
                .zx-key {
                    padding: 8px;
                    min-width: 28px;
                    font-size: 12px;
                }
                
                .zx-key.key-special {
                    font-size: 10px;
                }
            }
        `;
    document.head.appendChild(style);
  }
  _setupEventHandlers() {
    const toggle = this.element.querySelector('.zx-keyboard-toggle');
    toggle.addEventListener('click', () => this.toggle());

    // Handle key presses
    const keys = this.element.querySelectorAll('.zx-key');
    keys.forEach(keyElement => {
      // Use touch events for better mobile support
      keyElement.addEventListener('touchstart', e => {
        e.preventDefault();
        this._handleKeyDown(keyElement);
      });
      keyElement.addEventListener('touchend', e => {
        e.preventDefault();
        this._handleKeyUp(keyElement);
      });

      // Also support mouse for desktop testing
      keyElement.addEventListener('mousedown', e => {
        e.preventDefault();
        this._handleKeyDown(keyElement);
      });
      keyElement.addEventListener('mouseup', e => {
        e.preventDefault();
        this._handleKeyUp(keyElement);
      });
      keyElement.addEventListener('mouseleave', e => {
        if (this.activeKeys.has(keyElement)) {
          this._handleKeyUp(keyElement);
        }
      });
    });

    // Prevent context menu on long press
    this.element.addEventListener('contextmenu', e => e.preventDefault());
  }
  _handleKeyDown(keyElement) {
    const key = keyElement.dataset.key;
    if (this.activeKeys.has(keyElement)) {
      return;
    }
    this.activeKeys.add(keyElement);
    keyElement.classList.add('active');

    // Map special keys
    const mappedKey = this._mapKey(key);
    this.spectrum.keyDown(mappedKey);
  }
  _handleKeyUp(keyElement) {
    const key = keyElement.dataset.key;
    if (!this.activeKeys.has(keyElement)) {
      return;
    }
    this.activeKeys.delete(keyElement);
    keyElement.classList.remove('active');

    // Map special keys
    const mappedKey = this._mapKey(key);
    this.spectrum.keyUp(mappedKey);
  }
  _mapKey(key) {
    const keyMap = {
      CAPS: 'Shift',
      SYMB: 'Control',
      SPACE: ' '
    };
    return keyMap[key] || key;
  }
  _isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }
  show() {
    this.element.classList.add('visible');
    this.isVisible = true;
  }
  hide() {
    this.element.classList.remove('visible');
    this.isVisible = false;

    // Release any stuck keys
    this.activeKeys.forEach(keyElement => {
      this._handleKeyUp(keyElement);
    });
  }
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

/**
 * ZXSpectrum - Main emulator class for the ZX Spectrum 48K
 *
 * @class ZXSpectrum
 * @example
 * const spectrum = new ZXSpectrum('#canvas', {
 *     scale: 2,
 *     sound: true,
 *     autoStart: true
 * });
 */
class ZXSpectrum {
  /**
   * Create a new ZX Spectrum emulator instance
   *
   * @constructor
   * @param {string|HTMLCanvasElement} canvasOrSelector - Canvas element or CSS selector
   * @param {Object} [options={}] - Configuration options
   * @param {string|Uint8Array} [options.rom='https://cdn.jsdelivr.net/npm/@zx-vibes/emulator@latest/rom/48k.rom'] - ROM data or URL
   * @param {boolean} [options.autoStart=true] - Start emulation automatically after ROM loads
   * @param {boolean} [options.sound=true] - Enable sound emulation
   * @param {boolean} [options.useAudioWorklet=true] - Use AudioWorklet for better sound
   * @param {number|string} [options.scale='auto'] - Display scale factor
   * @param {boolean} [options.handleKeyboard=true] - Handle keyboard input automatically
   * @param {boolean|string} [options.touchKeyboard='auto'] - Touch keyboard support
   * @param {number} [options.fps=50] - Frames per second (PAL standard)
   * @param {Function} [options.onReady] - Callback when emulator is ready
   * @param {Function} [options.onError] - Error callback
   */
  constructor(canvasOrSelector, options = {}) {
    // Initialize options with defaults
    this.options = {
      rom: 'https://cdn.jsdelivr.net/npm/@zx-vibes/emulator@latest/rom/48k.rom',
      autoStart: true,
      sound: true,
      useAudioWorklet: true,
      scale: 'auto',
      handleKeyboard: true,
      touchKeyboard: 'auto',
      // 'auto', true, false, or custom element/selector
      fps: 50,
      onReady: null,
      onError: null,
      ...options
    };

    // Get or create canvas
    this.canvas = this._resolveCanvas(canvasOrSelector);
    this.ctx = this.canvas.getContext('2d');

    // Initialize hardware components
    this.memory = new SpectrumMemory();
    this.ula = new SpectrumULA();
    this.display = new SpectrumDisplay();

    // Initialize sound if enabled
    this.useAudioWorklet = this.options.sound && this.options.useAudioWorklet;
    if (this.options.sound) {
      this.sound = this.useAudioWorklet ? new SpectrumAudioWorklet() : new SpectrumSound();
    } else {
      this.sound = null;
    }
    this.cpu = new Z80(this.memory, this.ula);
    this.tape = new Tape(this);

    // Setup sound callbacks
    this._prevTapeBit = 1; // last tape EAR level, for loading-sound mixing
    if (this.sound) {
      this.ula.setPortWriteCallback(portValue => {
        if (this.sound && this.sound.enabled && this.useAudioWorklet) {
          const tStateOffset = this.cpu.cycles - this.frameStartCycles;
          this.sound.setBeeperState(this._mixTapeAudio(portValue), tStateOffset);
        }
      });
      this.ula.onSpeakerChange = speakerBit => {
        if (this.sound && this.sound.enabled) {
          if (!this.useAudioWorklet && this.sound.beep) {
            this.sound.beep(speakerBit);
          }
        }
      };
    }

    // Emulation timing
    this.FRAMES_PER_SECOND = this.options.fps;
    this.TSTATES_PER_FRAME = 69888;
    this.INTERRUPT_TSTATES = 32;

    // State
    this.running = false;
    this.frameCount = 0;
    this.lastFrameTime = 0;
    this.accumulatedTime = 0;
    this.frameStartCycles = 0;

    // Stats
    this.fps = 0;
    this.lastFpsUpdate = 0;
    this.framesSinceLastFps = 0;

    // Animation
    this.animationId = null;
    this.renderAnimationId = null;

    // Features
    this.turboMode = false;

    // Custom key mappings
    this.customKeyMap = {};

    // Audio resume gesture handling
    this._audioResumeHandler = null;

    // Touch keyboard
    this.touchKeyboard = null;

    // Setup canvas
    this._setupCanvas();

    // Setup keyboard handling if enabled
    if (this.options.handleKeyboard) {
      this._setupKeyboard();
    }

    // Setup touch keyboard if needed
    if (this.options.touchKeyboard !== false) {
      this._setupTouchKeyboard();
    }

    // Setup visibility handling
    this._setupVisibilityHandling();

    // Setup audio resume handling for browser autoplay policies
    this._setupAudioResumeHandling();

    // Initialize with ROM if provided
    if (this.options.rom) {
      this._initialize();
    }
  }

  /**
   * Resolve canvas element from selector or element
   *
   * @private
   * @param {string|HTMLCanvasElement} canvasOrSelector - Canvas element or CSS selector
   * @returns {HTMLCanvasElement} Canvas element
   * @throws {Error} If canvas element not found or invalid
   */
  _resolveCanvas(canvasOrSelector) {
    if (typeof canvasOrSelector === 'string') {
      // It's a selector
      if (typeof document === 'undefined') {
        throw new Error('Canvas selectors need a DOM. In Node, pass a canvas-like object ' + '(e.g. from the "canvas" package) instead of a selector string.');
      }
      const element = document.querySelector(canvasOrSelector);
      if (!element) {
        throw new Error(`Canvas element not found: ${canvasOrSelector}`);
      }
      if (element.tagName !== 'CANVAS') {
        // Create a canvas inside the element
        const canvas = document.createElement('canvas');
        element.appendChild(canvas);
        return canvas;
      }
      return element;
    }
    if (typeof HTMLCanvasElement !== 'undefined' && canvasOrSelector instanceof HTMLCanvasElement) {
      return canvasOrSelector;
    }
    if (canvasOrSelector && canvasOrSelector.tagName === 'CANVAS') {
      return canvasOrSelector;
    }
    throw new Error('Invalid canvas parameter. Expected selector string or canvas element.');
  }

  /**
   * Setup canvas dimensions and rendering properties
   *
   * @private
   * @returns {void}
   */
  _setupCanvas() {
    const displaySize = this.display.getDisplaySize();

    // Set internal canvas size
    this.canvas.width = displaySize.width;
    this.canvas.height = displaySize.height;

    // Handle scaling
    if (this.options.scale === 'auto') {
      // Default 2x scale
      this.canvas.style.width = `${displaySize.width * 2}px`;
      this.canvas.style.height = `${displaySize.height * 2}px`;
    } else if (typeof this.options.scale === 'number') {
      this.canvas.style.width = `${displaySize.width * this.options.scale}px`;
      this.canvas.style.height = `${displaySize.height * this.options.scale}px`;
    }

    // Pixelated rendering
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = '-moz-crisp-edges';
    this.canvas.style.imageRendering = 'crisp-edges';
  }

  /**
   * Setup keyboard event handlers
   *
   * @private
   * @returns {void}
   */
  _setupKeyboard() {
    // Store bound functions for removal
    this._keyDownHandler = e => this._handleKeyDown(e);
    this._keyUpHandler = e => this._handleKeyUp(e);

    // Add event listeners (headless callers drive keyDown()/keyUp() directly)
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this._keyDownHandler);
      document.addEventListener('keyup', this._keyUpHandler);
    }

    // Release every key when the window loses focus. Otherwise a key still held
    // during an alt-tab / click-away never receives its keyup and stays stuck —
    // the classic "UP is always pressed" bug.
    if (typeof window !== 'undefined') {
      this._blurHandler = () => this.ula.clearKeys();
      window.addEventListener('blur', this._blurHandler);
    }
  }

  /**
   * Setup touch keyboard for mobile devices
   *
   * @private
   * @returns {void}
   */
  _setupTouchKeyboard() {
    const shouldShow = this.options.touchKeyboard === 'auto' ? this._isTouchDevice() : this.options.touchKeyboard;
    if (shouldShow) {
      if (typeof document === 'undefined') {
        return;
      }
      // Determine container
      let container;
      if (typeof this.options.touchKeyboard === 'string' && this.options.touchKeyboard !== 'auto') {
        container = this.options.touchKeyboard;
      } else {
        if (!this.canvas.parentNode) {
          return;
        }
        // Create container after canvas
        container = document.createElement('div');
        container.className = 'zx-touch-container';
        this.canvas.parentNode.insertBefore(container, this.canvas.nextSibling);
      }
      this.touchKeyboard = new TouchKeyboard(this, container);
    }
  }

  /**
   * Check if device supports touch input
   *
   * @private
   * @returns {boolean} True if touch device
   */
  _isTouchDevice() {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false; // headless
    }
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
  }

  /**
   * Handle keyboard key down events
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {void}
   */
  _handleKeyDown(e) {
    if (!this.running) {
      return;
    }
    const handled = this._processKey(e.key, true);
    if (handled) {
      e.preventDefault();
    }
  }

  /**
   * Handle keyboard key up events
   *
   * @private
   * @param {KeyboardEvent} e - Keyboard event
   * @returns {void}
   */
  _handleKeyUp(e) {
    // Always honour key releases, even while paused/stopped: if the keydown was
    // seen while running, dropping its keyup would leave the key stuck "pressed".
    const handled = this._processKey(e.key, false);
    if (handled) {
      e.preventDefault();
    }
  }

  /**
   * Process key press/release for Spectrum keyboard mapping
   *
   * @private
   * @param {string} key - Key string
   * @param {boolean} isDown - True if key pressed, false if released
   * @returns {boolean} True if key was handled
   */
  _processKey(key, isDown) {
    // Check custom mappings first
    const customMapping = this.customKeyMap[key];
    if (customMapping) {
      if (typeof customMapping === 'string') {
        return this._processKey(customMapping, isDown);
      }
      if (customMapping.keys) {
        customMapping.keys.forEach(k => this._processKey(k, isDown));
        return true;
      }
    }

    // Check PC key mappings
    const pcMapping = PC_KEY_MAP[key];
    if (pcMapping) {
      if (typeof pcMapping === 'string') {
        // Direct mapping to a Spectrum key
        const keyMapping = SPECTRUM_KEYS[pcMapping];
        if (keyMapping) {
          this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
          return true;
        }
      } else if (pcMapping.keys) {
        // Multiple keys need to be pressed
        pcMapping.keys.forEach(spectrumKey => {
          const keyMapping = SPECTRUM_KEYS[spectrumKey];
          if (keyMapping) {
            this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
          }
        });
        return true;
      }
    }

    // Check direct Spectrum key mapping
    const keyMapping = SPECTRUM_KEYS[key] || SPECTRUM_KEYS[key.toUpperCase()];
    if (keyMapping) {
      this.ula.setKey(keyMapping.row, keyMapping.col, isDown);
      return true;
    }
    return false;
  }

  /**
   * Setup page visibility handling for audio context
   *
   * @private
   * @returns {void}
   */
  _setupVisibilityHandling() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.ula.clearKeys(); // drop any held keys when the tab is backgrounded
        }
        if (this.running && this.sound && this.sound.audioContext) {
          if (document.hidden) {
            this.sound.audioContext.suspend().catch(err => console.warn('Failed to suspend audio context:', err));
          } else {
            this.sound.audioContext.resume().catch(err => console.warn('Failed to resume audio context:', err));
          }
        }
      });
    }
  }

  /**
   * Resume suspended audio contexts from user gestures.
   *
   * @private
   * @returns {void}
   */
  _setupAudioResumeHandling() {
    if (!this.sound || typeof document === 'undefined') {
      return;
    }
    this._audioResumeHandler = () => {
      this.resumeAudio().catch(err => console.warn('Failed to resume audio context:', err));
    };
    document.addEventListener('pointerdown', this._audioResumeHandler);
    document.addEventListener('keydown', this._audioResumeHandler);
  }

  /**
   * Remove audio gesture listeners installed by _setupAudioResumeHandling().
   *
   * @private
   * @returns {void}
   */
  _removeAudioResumeHandling() {
    if (!this._audioResumeHandler || typeof document === 'undefined') {
      return;
    }
    document.removeEventListener('pointerdown', this._audioResumeHandler);
    document.removeEventListener('keydown', this._audioResumeHandler);
    this._audioResumeHandler = null;
  }

  /**
   * Initialize emulator with ROM and options
   *
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _initialize() {
    try {
      if (this.options.rom instanceof Uint8Array) {
        this.loadROM(this.options.rom);
      } else if (typeof this.options.rom === 'string') {
        await this.loadROMFromURL(this.options.rom);
      }
      if (this.options.onReady) {
        this.options.onReady(this);
      }
      if (this.options.autoStart) {
        await this.start();
      }
    } catch (error) {
      console.error('Failed to initialize emulator:', error);
      if (this.options.onError) {
        this.options.onError(error);
      }
    }
  }

  /**
   * Load ROM data into the emulator
   *
   * @param {Uint8Array} romData - ROM data (must be 16384 bytes)
   * @throws {Error} If romData is not a Uint8Array
   */
  loadROM(romData) {
    if (!(romData instanceof Uint8Array)) {
      throw new Error('ROM data must be a Uint8Array');
    }
    this.memory.loadROM(romData);
    this.reset();
  }

  /**
   * Load ROM from a URL
   *
   * @async
   * @param {string} url - URL to ROM file
   * @throws {Error} If ROM loading fails
   */
  async loadROMFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ROM: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const romData = new Uint8Array(arrayBuffer);
      this.loadROM(romData);
    } catch (error) {
      throw new Error(`Error loading ROM from URL: ${error.message}`);
    }
  }

  /**
   * Reset the emulator to initial state
   */
  reset() {
    this.cpu.reset();
    this.memory.clearRAM();
    this.ula.clearKeys();
    this.ula.borderColor = 1;
    this.frameCount = 0;
    const attrs = this.memory.getAttributeMemory();
    attrs.fill(0x38);
    if (this.sound && this.sound.reset) {
      this.sound.reset();
    }
    this.memory.getScreenMemory();
    const attrMem = this.memory.getAttributeMemory();
    for (let i = 0; i < attrMem.length; i++) {
      attrMem[i] = 0x38;
    }
  }

  /**
   * Run a single frame of emulation (69888 T-states)
   *
   * @private
   * @returns {void}
   */
  /**
   * Fold the current tape EAR input into the speaker bit while a tape is playing,
   * so the loading signal is audible (real hardware mixes EAR into the audio out).
   * A no-op during normal play, when no tape is running.
   *
   * @private
   * @param {number} portValue - last value written to port 0xFE
   * @returns {number} value with the tape level mixed into the speaker bit
   */
  _mixTapeAudio(portValue) {
    if (this.tape && this.tape.playing) {
      return portValue & 0xef | (this._prevTapeBit ? 0x10 : 0);
    }
    return portValue;
  }
  _updateTapeInput() {
    const tapeInputBit = this.tape.update(this.cpu.cycles);
    this.ula.setTapeInput(tapeInputBit);
    // Make the tape loading signal audible like real hardware: the ULA mixes the
    // EAR input into the speaker output, so emit an audio edge on each tape flip.
    if (tapeInputBit !== this._prevTapeBit) {
      this._prevTapeBit = tapeInputBit;
      if (this.sound && this.sound.enabled && this.useAudioWorklet && this.tape.playing) {
        this.sound.setBeeperState(this._mixTapeAudio(this.ula.lastPortFE), this.cpu.cycles - this.frameStartCycles);
      }
    }
  }
  runFrame() {
    let tStates = 0;
    this.frameStartCycles = this.cpu.cycles;
    if (this.useAudioWorklet && this.sound && this.sound.startFrame) {
      this.sound.startFrame();
    }
    while (tStates < this.TSTATES_PER_FRAME) {
      const beforeCycles = this.cpu.cycles;
      this.cpu.execute();
      const cyclesExecuted = this.cpu.cycles - beforeCycles;
      this.ula.addCycles(cyclesExecuted);
      this._updateTapeInput();
      if (this.ula.shouldGenerateInterrupt()) {
        const beforeInterruptCycles = this.cpu.cycles;
        this.cpu.interrupt();
        const interruptCycles = this.cpu.cycles - beforeInterruptCycles;
        if (interruptCycles > 0) {
          this.ula.addCycles(interruptCycles);
          this._updateTapeInput();
          tStates += interruptCycles;
        }
      }
      tStates += cyclesExecuted;
    }
    if (this.useAudioWorklet && this.sound && this.sound.endFrame) {
      this.sound.endFrame(tStates);
    }
    this.frameCount++;
    this.display.advanceFrame();
    const now = performance.now();
    this.framesSinceLastFps++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.framesSinceLastFps;
      this.framesSinceLastFps = 0;
      this.lastFpsUpdate = now;
    }
  }

  /**
   * Start the emulation
   *
   * @async
   * @returns {Promise<void>}
   */
  async start() {
    if (this.running) {
      return;
    }

    // Initialize sound if enabled
    if (this.sound) {
      if (this.useAudioWorklet) {
        try {
          let success = await this.sound.init();
          if (!success && this.sound.audioContext && this.sound.audioContext.state === 'suspended') {
            try {
              await this.sound.audioContext.resume();
              success = true;
              this.sound.enabled = true;
            } catch (err) {
              console.warn('Failed to resume audio context:', err);
            }
          }
          if (!success) {
            console.warn('AudioWorklet failed, falling back to basic sound');
            this.useAudioWorklet = false;
            this.sound = new SpectrumSound();
            try {
              await this.sound.start();
            } catch (err) {
              console.warn('Basic sound also failed, continuing without audio:', err);
              this.sound.enabled = false;
            }
          }
        } catch (error) {
          console.warn('Audio initialization failed, continuing without audio:', error);
          this.sound.enabled = false;
        }
      } else {
        try {
          await this.sound.start();
        } catch (error) {
          console.warn('Sound start failed, continuing without audio:', error);
          this.sound.enabled = false;
        }
      }
    }
    this.running = true;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = this.lastFrameTime;
    this.framesSinceLastFps = 0;

    // Start emulation loop
    this.emulationLoop();

    // Start render loop
    this._startRenderLoop();
  }

  /**
   * Stop the emulation
   */
  stop() {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.renderAnimationId) {
      cancelAnimationFrame(this.renderAnimationId);
      this.renderAnimationId = null;
    }
    if (this.sound && this.sound.stop) {
      this.sound.stop();
    }
  }

  /**
   * Main emulation loop - executes CPU cycles and manages timing
   *
   * @private
   * @returns {void}
   */
  emulationLoop() {
    if (!this.running) {
      this.animationId = null;
      return;
    }
    const now = performance.now();
    const deltaTime = this.lastFrameTime ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;
    this.accumulatedTime += deltaTime;
    const frameTime = 1000 / this.FRAMES_PER_SECOND;
    if (this.accumulatedTime >= frameTime) {
      this.runFrame();
      this.accumulatedTime -= frameTime;
      if (this.accumulatedTime > frameTime * 2) {
        this.accumulatedTime = 0;
      }
    }
    this.animationId = requestAnimationFrame(() => this.emulationLoop());
  }

  /**
   * Start the rendering loop
   *
   * @private
   * @returns {void}
   */
  _startRenderLoop() {
    const render = () => {
      if (!this.running) {
        this.renderAnimationId = null;
        return;
      }
      this.renderDisplay();
      this.draw();
      this.renderAnimationId = requestAnimationFrame(render);
    };
    render();
  }

  /**
   * Render the display from memory to pixel buffer
   *
   * @private
   * @returns {Uint8Array} Display buffer
   */
  renderDisplay() {
    const screenMemory = this.memory.getScreenMemory();
    const attributeMemory = this.memory.getAttributeMemory();
    const borderColor = this.ula.getBorderColor();
    const scanlineBorderColors = this.ula.getScanlineBorderColors();
    this.ula.resetBorderChanged();
    return this.display.render(screenMemory, attributeMemory, borderColor, scanlineBorderColors);
  }

  /**
   * Draw the display buffer to canvas
   *
   * @private
   * @param {HTMLCanvasElement} [canvas=null] - Target canvas (uses default if null)
   * @returns {void}
   */
  draw(canvas = null) {
    canvas || this.canvas;
    const ctx = canvas ? canvas.getContext('2d') : this.ctx;
    const imageData = this.display.getImageData();
    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Simulate a key press
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   */
  keyDown(keyOrEvent) {
    const key = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent.key;
    this._processKey(key, true);
  }

  /**
   * Simulate a key release
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   */
  keyUp(keyOrEvent) {
    const key = typeof keyOrEvent === 'string' ? keyOrEvent : keyOrEvent.key;
    this._processKey(key, false);
  }

  /**
   * Simulate a key press and release
   *
   * @param {string|KeyboardEvent} keyOrEvent - Key string or keyboard event
   * @param {number} [duration=50] - Duration of key press in milliseconds
   * @returns {Promise<void>}
   */
  async keyPress(keyOrEvent, duration = 50) {
    this.keyDown(keyOrEvent);
    await new Promise(resolve => setTimeout(resolve, duration));
    this.keyUp(keyOrEvent);
  }

  /**
   * Type text automatically with realistic timing
   *
   * @param {string} text - Text to type
   * @param {Object} [options={}] - Typing options
   * @param {number} [options.keyDelay=100] - Delay between key presses in milliseconds
   * @param {number} [options.keyDuration=50] - Duration of each key press in milliseconds
   * @returns {Promise<void>}
   */
  async typeText(text, options = {}) {
    const {
      keyDelay = 100,
      keyDuration = 50
    } = options;
    for (const char of text) {
      await this.keyPress(char, keyDuration);
      await new Promise(resolve => setTimeout(resolve, keyDelay));
    }
  }

  /**
   * Load a snapshot from saved state data
   *
   * @param {Object} data - Snapshot data
   * @param {Uint8Array} [data.ram] - RAM contents
   * @param {Object} [data.cpu] - CPU state
   * @param {Object} [data.ula] - ULA state
   */
  loadSnapshot(data) {
    if (data.ram && data.ram.length === 49152) {
      this.memory.ram.set(data.ram);
    }
    if (data.cpu) {
      this.cpu.setState(data.cpu);
    }
    if (data.ula) {
      this.ula.borderColor = data.ula.borderColor ?? 7;
    }
  }

  /**
   * Load a Z80 snapshot file
   *
   * @param {ArrayBuffer|Uint8Array} data - Z80 snapshot data
   */
  loadZ80Snapshot(data) {
    const snapshotLoader = new Z80SnapshotLoader(this.memory, this.cpu, this.ula);
    snapshotLoader.load(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  }

  /**
   * Save current state as snapshot
   *
   * @returns {Object} Snapshot data with ram, cpu, and ula state
   */
  saveSnapshot() {
    return {
      ram: new Uint8Array(this.memory.ram),
      cpu: this.cpu.getState(),
      ula: {
        borderColor: this.ula.borderColor
      }
    };
  }

  /**
   * Get emulator statistics
   *
   * @returns {Object} Statistics object
   * @returns {number} .fps - Current frames per second
   * @returns {number} .frameCount - Total frames rendered
   * @returns {Object} .cpuState - Current CPU state
   * @returns {boolean} .running - Whether emulator is running
   * @returns {Object} .audioStats - Audio statistics (if available)
   */
  getStats() {
    return {
      fps: this.fps,
      frameCount: this.frameCount,
      cpuState: this.cpu.getState(),
      running: this.running,
      audioStats: this.sound?.getStats ? this.sound.getStats() : null
    };
  }

  /**
   * Write a byte to memory (POKE)
   *
   * @param {number} address - Memory address (0-65535)
   * @param {number} value - Value to write (0-255)
   * @returns {void}
   *
   * @example
   * spectrum.poke(23624, 0); // Clear keyboard buffer
   */
  poke(address, value) {
    this.memory.write(address, value);
  }

  /**
   * Read a byte from memory (PEEK)
   *
   * @param {number} address - Memory address (0-65535)
   * @returns {number} Byte value (0-255)
   *
   * @example
   * const borderColor = spectrum.peek(23624); // Read current border color
   */
  peek(address) {
    return this.memory.read(address);
  }

  /**
   * Enable or disable turbo mode
   *
   * @param {boolean} enabled - True to enable turbo mode
   * @returns {void}
   */
  setTurboMode(enabled) {
    this.turboMode = enabled;
  }

  /**
   * Load a TAP or TZX file for tape emulation
   *
   * @param {ArrayBuffer|Uint8Array} buffer - Tape file data
   * @param {string} filename - Filename used to determine format (.tap or .tzx)
   */
  loadTape(buffer, filename) {
    this.tape.load(buffer, filename);
  }

  /**
   * Load a TAP file from URL
   *
   * @async
   * @param {string} url - URL to TAP file
   * @throws {Error} If tape loading fails
   */
  async loadTapeFromURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load tape: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const filename = url.split('/').pop();
      this.loadTape(arrayBuffer, filename);
    } catch (error) {
      throw new Error(`Error loading tape from URL: ${error.message}`);
    }
  }

  /**
   * Start tape playback
   */
  playTape() {
    this.tape.play();
  }

  /**
   * Pause tape playback
   */
  pauseTape() {
    this.tape.pause();
  }

  /**
   * Stop tape playback
   */
  stopTape() {
    this.tape.stop();
  }

  /**
   * Rewind tape to beginning
   */
  rewindTape() {
    this.tape.rewind();
  }

  /**
   * Get current tape status
   *
   * @returns {Object} Tape status
   * @returns {string} .status - Current status message
   * @returns {number} .position - Current position in tape
   * @returns {boolean} .playing - Whether tape is playing
   * @returns {boolean} .paused - Whether tape is paused
   */
  getTapeStatus() {
    return {
      status: this.tape.getStatus(),
      position: this.tape.getPosition(),
      playing: this.tape.playing,
      paused: this.tape.paused
    };
  }

  /**
   * Set audio volume
   *
   * @param {number} volume - Volume level (0.0 to 1.0)
   * @returns {void}
   */
  setVolume(volume) {
    if (this.sound && this.sound.setVolume) {
      this.sound.setVolume(volume);
    }
  }

  /**
   * Mute or unmute audio
   *
   * @param {boolean} muted - True to mute, false to unmute
   * @returns {void}
   */
  setMuted(muted) {
    if (this.sound && this.sound.setMuted) {
      this.sound.setMuted(muted);
    }
  }

  /**
   * Resume the browser audio context after a user gesture.
   *
   * @async
   * @returns {Promise<boolean>} True when audio is running after the attempt
   */
  async resumeAudio() {
    const context = this.sound?.audioContext;
    if (!context) {
      return false;
    }
    if (context.state === 'suspended') {
      await context.resume();
    }
    return context.state === 'running';
  }

  /**
   * Enable or disable audio debug mode
   *
   * @param {boolean} enabled - True to enable debug mode
   * @returns {void}
   */
  setAudioDebugMode(enabled) {
    if (this.sound && this.sound.setDebugMode) {
      this.sound.setDebugMode(enabled);
    }
  }

  /**
   * Set custom key mapping
   *
   * @param {string} pcKey - PC keyboard key
   * @param {string|Object} spectrumKey - Spectrum key or key combination
   * @returns {void}
   *
   * @example
   * spectrum.setKeyMapping('Tab', 'CAPS_SHIFT');
   * spectrum.setKeyMapping('F1', { keys: ['CAPS_SHIFT', '1'] });
   */
  setKeyMapping(pcKey, spectrumKey) {
    this.customKeyMap[pcKey] = spectrumKey;
  }

  /**
   * Set multiple custom key mappings
   *
   * @param {Object} mappings - Object with PC key to Spectrum key mappings
   * @returns {void}
   *
   * @example
   * spectrum.setKeyMappings({
   *     'Tab': 'CAPS_SHIFT',
   *     'F1': { keys: ['CAPS_SHIFT', '1'] }
   * });
   */
  setKeyMappings(mappings) {
    Object.assign(this.customKeyMap, mappings);
  }

  /**
   * Clear all custom key mappings
   *
   * @returns {void}
   */
  clearCustomKeyMappings() {
    this.customKeyMap = {};
  }

  /**
   * Clean up and destroy the emulator instance
   *
   * Stops emulation, removes event listeners, and cleans up resources
   */
  destroy() {
    this.stop();
    this._removeAudioResumeHandling();

    // Remove keyboard handlers
    if (this.options.handleKeyboard && this._keyDownHandler) {
      document.removeEventListener('keydown', this._keyDownHandler);
      document.removeEventListener('keyup', this._keyUpHandler);
    }
    if (this._blurHandler && typeof window !== 'undefined') {
      window.removeEventListener('blur', this._blurHandler);
    }

    // Destroy touch keyboard
    if (this.touchKeyboard) {
      this.touchKeyboard.destroy();
      this.touchKeyboard = null;
    }

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

export { Flags, PC_KEY_MAP, Registers, SPECTRUM_KEYS, SpectrumDisplay, SpectrumMemory, SpectrumSound, SpectrumULA, Tape, Z80, Z80SnapshotLoader, ZXSpectrum };
//# sourceMappingURL=zxgeneration.esm.js.map
