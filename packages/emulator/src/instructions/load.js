import { sign8 } from '../utils/helpers.js';

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
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.registers.set(regName, this.memory.readByte(addr));
    return 19;
  }

  /* LD (IX/IY+d),reg */
  loadIndexedFromReg(indexReg, displacement, regName) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.memory.writeByte(addr, this.registers.get(regName));
    return 19;
  }

  /* LD (IX/IY+d),n */
  loadIndexedImmediate(indexReg, displacement, value) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.memory.writeByte(addr, value & 0xff);
    return 19;
  }
}

export { LoadInstructions };
