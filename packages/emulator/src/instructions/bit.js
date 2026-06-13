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
    this.registers.set(regName, value | (1 << bit));
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
    this.memory.writeByte(addr, value | (1 << bit));
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
    const result = ((value << 1) | (carry ? 1 : 0)) & 0xff;

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
    const result = ((value >> 1) | (carry ? 0x80 : 0)) & 0xff;

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
    const result = ((value << 1) | oldCarry) & 0xff;

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
    const result = ((value >> 1) | oldCarry) & 0xff;

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
    const result = (value << 1) & 0xff;

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
    const result = ((value >> 1) | (value & 0x80)) & 0xff;

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
    const result = ((value << 1) | 1) & 0xff;

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
    const result = (value >> 1) & 0xff;

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
    const result = ((a << 1) | (carry ? 1 : 0)) & 0xff;

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
    const result = ((a >> 1) | (carry ? 0x80 : 0)) & 0xff;

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
    const result = ((a << 1) | oldCarry) & 0xff;

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
    const result = ((a >> 1) | oldCarry) & 0xff;

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

export { BitInstructions };
