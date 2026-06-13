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
    const fullPort = port | (a << 8);
    this.registers.set('A', io.readPort(fullPort));
    return 11; // cycles
  }

  /**
   * OUT (n), A
   */
  outAImmediate(port, io) {
    const a = this.registers.get('A');
    const fullPort = port | (a << 8);
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

export { MiscInstructions };
