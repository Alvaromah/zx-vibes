/**
 * Memory Interface
 * Provides abstraction layer for memory access
 */
class MemoryInterface {
  constructor(memory) {
    this.memory = memory;
    this.extraCycles = 0;
  }

  applyContention(address) {
    if (!this.memory || typeof this.memory.getContentionDelay !== 'function') {
      return;
    }
    const delay = this.memory.getContentionDelay(address & 0xffff, this.extraCycles);
    this.extraCycles += delay;
  }

  consumeExtraCycles() {
    const cycles = this.extraCycles;
    this.extraCycles = 0;
    return cycles;
  }

  /**
   * Read a byte from memory
   */
  readByte(address) {
    const addr = address & 0xffff;
    this.applyContention(addr);
    return this.memory.read(addr);
  }

  /**
   * Write a byte to memory
   */
  writeByte(address, value) {
    const addr = address & 0xffff;
    this.applyContention(addr);
    this.memory.write(addr, value & 0xff);
  }

  /**
   * Read a 16-bit word from memory (little-endian)
   */
  readWord(address) {
    const addr = address & 0xffff;
    const low = this.readByte(addr);
    const high = this.readByte((addr + 1) & 0xffff);
    return low | (high << 8);
  }

  /**
   * Write a 16-bit word to memory (little-endian)
   */
  writeWord(address, value) {
    const addr = address & 0xffff;
    const val = value & 0xffff;
    this.writeByte(addr, val & 0xff);
    this.writeByte((addr + 1) & 0xffff, (val >> 8) & 0xff);
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
    return low | (high << 8);
  }

  /**
   * Push byte to stack
   */
  pushByte(registers, value) {
    const sp = (registers.get16('SP') - 1) & 0xffff;
    registers.set16('SP', sp);
    this.writeByte(sp, value);
  }

  /**
   * Pop byte from stack
   */
  popByte(registers) {
    const sp = registers.get16('SP');
    const value = this.readByte(sp);
    registers.set16('SP', (sp + 1) & 0xffff);
    return value;
  }

  /**
   * Push word to stack
   */
  pushWord(registers, value) {
    this.pushByte(registers, (value >> 8) & 0xff);
    this.pushByte(registers, value & 0xff);
  }

  /**
   * Pop word from stack
   */
  popWord(registers) {
    const low = this.popByte(registers);
    const high = this.popByte(registers);
    return low | (high << 8);
  }
}

export { MemoryInterface };
