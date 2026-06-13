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
    const newPC = (this.registers.getPC() + signedOffset) & 0xffff;
    this.registers.setPC(newPC);
    return 12; // cycles
  }

  /**
   * JR cc, e (Conditional relative jump)
   */
  jumpRelativeConditional(condition, offset) {
    if (this.checkCondition(condition)) {
      const signedOffset = offset > 127 ? offset - 256 : offset;
      const newPC = (this.registers.getPC() + signedOffset) & 0xffff;
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
    const b = (this.registers.get('B') - 1) & 0xff;
    this.registers.set('B', b);

    if (b !== 0) {
      const signedOffset = offset > 127 ? offset - 256 : offset;
      const newPC = (this.registers.getPC() + signedOffset) & 0xffff;
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

export { JumpInstructions };
