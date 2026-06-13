/**
 * Z80 Flags Manager
 * Handles all flag operations including undocumented F3/F5 flags
 */
class Flags {
  constructor() {
    this.masks = {
      S: 0x80, // Sign
      Z: 0x40, // Zero
      F5: 0x20, // Undocumented - copy of bit 5
      H: 0x10, // Half carry
      F3: 0x08, // Undocumented - copy of bit 3
      PV: 0x04, // Parity/Overflow
      N: 0x02, // Add/Subtract
      C: 0x01, // Carry
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

export { Flags };
