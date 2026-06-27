/**
 * I/O Interface
 * Provides abstraction layer for I/O port access
 */
class IOInterface {
  constructor(ula) {
    this.ula = ula;
    this.extraCycles = 0;
  }

  applyContention(port) {
    if (!this.ula || typeof this.ula.getPortContentionDelay !== 'function') {
      return;
    }
    const delay = this.ula.getPortContentionDelay(port & 0xffff, this.extraCycles);
    this.extraCycles += delay;
  }

  consumeExtraCycles() {
    const cycles = this.extraCycles;
    this.extraCycles = 0;
    return cycles;
  }

  /**
   * Read from I/O port
   */
  readPort(port) {
    const p = port & 0xffff;
    this.applyContention(p);
    return this.ula.readPort(p);
  }

  /**
   * Write to I/O port
   */
  writePort(port, value) {
    const p = port & 0xffff;
    this.applyContention(p);
    this.ula.writePort(p, value & 0xff);
  }
}

export { IOInterface };
