/**
 * I/O Interface
 * Provides abstraction layer for I/O port access
 */
class IOInterface {
  constructor(ula) {
    this.ula = ula;
  }

  /**
   * Read from I/O port
   */
  readPort(port) {
    return this.ula.readPort(port & 0xffff);
  }

  /**
   * Write to I/O port
   */
  writePort(port, value) {
    this.ula.writePort(port & 0xffff, value & 0xff);
  }
}

export { IOInterface };
