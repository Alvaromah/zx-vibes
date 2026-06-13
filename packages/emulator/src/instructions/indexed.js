import { sign8 } from '../utils/helpers.js';

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
    const highByte = (result >> 8) & 0xff;
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
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.registers.set(regName, this.memory.readByte(addr));
    return 19; // cycles
  }

  /**
   * LD (IX/IY+d), reg
   */
  loadIndexedFromReg(indexReg, displacement, regName) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.memory.writeByte(addr, this.registers.get(regName));
    return 19; // cycles
  }

  /**
   * LD (IX/IY+d), n
   */
  loadIndexedImmediate(indexReg, displacement, value) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    this.memory.writeByte(addr, value);
    return 19; // cycles
  }

  /**
   * Arithmetic operations with (IX/IY+d)
   */
  addAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().addA(value);
    return 19; // cycles
  }

  adcAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().adcA(value);
    return 19; // cycles
  }

  subAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().subA(value);
    return 19; // cycles
  }

  sbcAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().sbcA(value);
    return 19; // cycles
  }

  andAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().andA(value);
    return 19; // cycles
  }

  xorAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().xorA(value);
    return 19; // cycles
  }

  orAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getLogical().orA(value);
    return 19; // cycles
  }

  cpAIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    this.getArithmetic().cpA(value);
    return 19; // cycles
  }

  /**
   * INC (IX/IY+d)
   */
  incIndexed(indexReg, displacement) {
    const signedDisp = sign8(displacement);
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    const result = (value + 1) & 0xff;
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
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    const result = (value - 1) & 0xff;
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
    const addr = (this.registers.get16(indexReg) + signedDisp) & 0xffff;
    const value = this.memory.readByte(addr);
    const bitInst = this.getBit();

    let result;
    let cycles = 20; // Base cycles for indexed bit operations

    switch (operation) {
      case 'BIT': {
        // BIT operations don't modify memory, just test the bit
        const newF = this.flags.updateBitTestFlags(this.registers.get('F'), bit, value);
        this.registers.set('F', newF);
        return cycles;
      }

      case 'SET':
        result = value | (1 << bit);
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
      const bit = (cbOpcode >> 3) & 0x07;
      return this.processIndexedBitOp(indexReg, displacement, 'BIT', bit);
    }
    if ((cbOpcode & 0xc0) === 0x80) {
      // RES operations (0x80-0xBF)
      const bit = (cbOpcode >> 3) & 0x07;
      return this.processIndexedBitOp(indexReg, displacement, 'RES', bit, targetReg);
    }
    if ((cbOpcode & 0xc0) === 0xc0) {
      // SET operations (0xC0-0xFF)
      const bit = (cbOpcode >> 3) & 0x07;
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
        return 23; // Unknown operation
    }

    return this.processIndexedBitOp(indexReg, displacement, opName, 0, targetReg);
  }
}

export { IndexedInstructions };
