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
    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);
    this.registers.setDE((this.registers.getDE() + 1) & 0xffff);
    this.registers.setBC((this.registers.getBC() - 1) & 0xffff);

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);

    // undocumented flags – A + value
    const n = (this.registers.get('A') + value) & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);

    this.registers.set('F', f);
    return 16;
  }

  /** LDIR – Load, Increment and Repeat */
  ldir() {
    const cycles = this.ldi();
    if (this.registers.getBC() !== 0) {
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
      return 21; // repeat form
    }
    return cycles;
  }

  /** LDD – Load and Decrement */
  ldd() {
    const value = this.memory.readByte(this.registers.getHL());
    this.memory.writeByte(this.registers.getDE(), value);
    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);
    this.registers.setDE((this.registers.getDE() - 1) & 0xffff);
    this.registers.setBC((this.registers.getBC() - 1) & 0xffff);

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.H, false);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);

    const n = (this.registers.get('A') + value) & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (n & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (n & 0x08) !== 0);

    this.registers.set('F', f);
    return 16;
  }

  /** LDDR – Load, Decrement and Repeat */
  lddr() {
    const cycles = this.ldd();
    if (this.registers.getBC() !== 0) {
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
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
    const result = (a - value) & 0xffff;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;

    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);
    this.registers.setBC((this.registers.getBC() - 1) & 0xffff);

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xff) === 0);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);

    // Undocumented flags for CPI: F3/F5 are based on A - (HL) - H
    const n = ((result & 0xff) - (halfBorrow ? 1 : 0)) & 0xff;
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
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
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
    const result = (a - value) & 0xffff;
    const halfBorrow = (a & 0x0f) - (value & 0x0f) < 0;

    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);
    this.registers.setBC((this.registers.getBC() - 1) & 0xffff);

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x80) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xff) === 0);
    f = this.flags.setFlag(f, this.flags.masks.H, halfBorrow);
    f = this.flags.setFlag(f, this.flags.masks.PV, this.registers.getBC() !== 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);

    // Undocumented flags for CPD: F3/F5 are based on A - (HL) - H
    const n = ((result & 0xff) - (halfBorrow ? 1 : 0)) & 0xff;
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
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
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
    const result = (hl - value - carry) & 0x1ffff; // 17‐bit to test carry

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, (result & 0x10000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.H, (hl & 0x0fff) - (value & 0x0fff) - carry < 0);
    f = this.flags.setFlag(f, this.flags.masks.N, true);
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x8000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xffff) === 0);

    const overflow = ((hl ^ value) & 0x8000) !== 0 && ((hl ^ result) & 0x8000) !== 0;
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);

    const high = (result >> 8) & 0xff;
    f = this.flags.setFlag(f, this.flags.masks.F5, (high & 0x20) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.F3, (high & 0x08) !== 0);

    this.registers.setHL(result & 0xffff);
    this.registers.set('F', f);
    return 15;
  }

  adcHL(value) {
    const carry = this.flags.getFlag(this.registers.get('F'), this.flags.masks.C) ? 1 : 0;
    const hl = this.registers.getHL();
    const result = (hl + value + carry) & 0x1ffff;

    let f = this.registers.get('F');
    f = this.flags.setFlag(f, this.flags.masks.C, (result & 0x10000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.H, (hl & 0x0fff) + (value & 0x0fff) + carry > 0x0fff);
    f = this.flags.setFlag(f, this.flags.masks.N, false);
    f = this.flags.setFlag(f, this.flags.masks.S, (result & 0x8000) !== 0);
    f = this.flags.setFlag(f, this.flags.masks.Z, (result & 0xffff) === 0);

    const overflow = ((hl ^ value) & 0x8000) === 0 && ((hl ^ result) & 0x8000) !== 0;
    f = this.flags.setFlag(f, this.flags.masks.PV, overflow);

    const high = (result >> 8) & 0xff;
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

    const newMem = ((mem << 4) | (a & 0x0f)) & 0xff;
    const newA = (a & 0xf0) | ((mem >> 4) & 0x0f);

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

    const newMem = ((a << 4) | (mem >> 4)) & 0xff;
    const newA = (a & 0xf0) | (mem & 0x0f);

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
    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }

  ind() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }

  outi() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }

  outd() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);
    this.registers.set('F', this._applyInOutFlags());
    return 16;
  }

  /* ---- Repeat variants --------------------------------------- */

  inir() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);

    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }

  indr() {
    const value = this.io.readPort(this.registers.getBC());
    this.memory.writeByte(this.registers.getHL(), value);
    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);

    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }

  otir() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL((this.registers.getHL() + 1) & 0xffff);

    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }

  otdr() {
    // B is decremented BEFORE the I/O operation
    this.registers.set('B', (this.registers.get('B') - 1) & 0xff);
    const value = this.memory.readByte(this.registers.getHL());
    this.io.writePort(this.registers.getBC(), value);
    this.registers.setHL((this.registers.getHL() - 1) & 0xffff);

    if (this.registers.get('B') !== 0) {
      // P/V must be set to 1 during repeat
      let f = this._applyInOutFlags(true);
      f = this.flags.setFlag(f, this.flags.masks.PV, true);
      this.registers.set('F', f);
      this.registers.setPC((this.registers.getPC() - 2) & 0xffff);
      return 21;
    }
    // P/V = 0 on final iteration
    this.registers.set('F', this._applyInOutFlags(false));
    return 16;
  }
}

export { ExtendedInstructions };
