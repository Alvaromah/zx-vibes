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
    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.C, true);
    newF = this.flags.setFlag(newF, this.flags.masks.H, false);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    const a = this.registers.get('A');
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (a & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (a & 0x08) !== 0);

    this.registers.set('F', newF);

    return 4; // cycles
  }

  /**
   * CCF (Complement Carry Flag)
   */
  ccf() {
    const oldCarry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C);

    let newF = this.registers.get('F');
    newF = this.flags.setFlag(newF, this.flags.masks.H, oldCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.C, !oldCarry);
    newF = this.flags.setFlag(newF, this.flags.masks.N, false);

    // Undocumented flags from A
    const a = this.registers.get('A');
    newF = this.flags.setFlag(newF, this.flags.masks.F5, (a & 0x20) !== 0);
    newF = this.flags.setFlag(newF, this.flags.masks.F3, (a & 0x08) !== 0);

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

      const newA = (a + correction) & 0xff;
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

      const newA = (a - correction) & 0xff;
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

export { LogicalInstructions };
