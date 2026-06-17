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
    const after = (before + 1) & 0xff;

    this.registers.set(regName, after);
    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }

  decReg(regName, cycles = 4) {
    const before = this.registers.get(regName);
    const after = (before - 1) & 0xff;

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
    const after = (before + 1) & 0xff;
    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return after;
  }

  dec8(value) {
    const before = value & 0xff;
    const after = (before - 1) & 0xff;
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
    const after = (before + 1) & 0xff;

    this.memory.writeByte(addr, after);

    const f = this.flags.updateIncFlags(this.registers.get('F'), before, after);
    this.registers.set('F', f);
    return cycles;
  }

  decHL(cycles = 11) {
    const addr = this.registers.getHL();
    const before = this.memory.readByte(addr);
    const after = (before - 1) & 0xff;

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
    const high = (result >> 8) & 0xff;
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

export { ArithmeticInstructions };
