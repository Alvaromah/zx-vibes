/**
 * Z80 Debugger
 * Simple debugging utilities for the emulator
 */
/* eslint-disable no-console */
class Z80Debugger {
  constructor(cpu) {
    this.cpu = cpu;
    this.breakpoints = new Set();
    this.history = [];
    this.historySize = 100;
  }

  /**
   * Add a breakpoint at the specified address
   */
  addBreakpoint(address) {
    this.breakpoints.add(address & 0xffff);
  }

  /**
   * Remove a breakpoint
   */
  removeBreakpoint(address) {
    this.breakpoints.delete(address & 0xffff);
  }

  /**
   * Execute one instruction with debugging
   */
  step() {
    const pc = this.cpu.registers.getPC();

    // Check breakpoint
    if (this.breakpoints.has(pc)) {
      console.log(`Breakpoint hit at ${pc.toString(16).padStart(4, '0').toUpperCase()}H`);
      return false;
    }

    // Save state to history
    this.saveState();

    // Execute instruction
    this.cpu.execute();

    return true;
  }

  /**
   * Save current CPU state to history
   */
  saveState() {
    const state = {
      pc: this.cpu.registers.getPC(),
      registers: { ...this.cpu.registers.data },
      flags: this.cpu.registers.get('F'),
      cycles: this.cpu.cycles,
    };

    this.history.push(state);
    if (this.history.length > this.historySize) {
      this.history.shift();
    }
  }

  /**
   * Print current CPU state
   */
  printState() {
    const regs = this.cpu.registers;
    const flags = this.cpu.flags;
    const f = regs.get('F');

    console.log('\n--- CPU State ---');
    console.log(
      `PC: ${regs.getPC().toString(16).padStart(4, '0').toUpperCase()}H  SP: ${regs.get16('SP').toString(16).padStart(4, '0').toUpperCase()}H`,
    );
    console.log(
      `AF: ${regs.getAF().toString(16).padStart(4, '0').toUpperCase()}H  BC: ${regs.getBC().toString(16).padStart(4, '0').toUpperCase()}H  DE: ${regs.getDE().toString(16).padStart(4, '0').toUpperCase()}H  HL: ${regs.getHL().toString(16).padStart(4, '0').toUpperCase()}H`,
    );
    console.log(
      `IX: ${regs.get16('IX').toString(16).padStart(4, '0').toUpperCase()}H  IY: ${regs.get16('IY').toString(16).padStart(4, '0').toUpperCase()}H  I: ${regs.get('I').toString(16).padStart(2, '0').toUpperCase()}H  R: ${regs.get('R').toString(16).padStart(2, '0').toUpperCase()}H`,
    );

    const flagStr = [
      flags.getFlag(f, flags.masks.S) ? 'S' : '-',
      flags.getFlag(f, flags.masks.Z) ? 'Z' : '-',
      flags.getFlag(f, flags.masks.F5) ? '5' : '-',
      flags.getFlag(f, flags.masks.H) ? 'H' : '-',
      flags.getFlag(f, flags.masks.F3) ? '3' : '-',
      flags.getFlag(f, flags.masks.PV) ? 'P' : '-',
      flags.getFlag(f, flags.masks.N) ? 'N' : '-',
      flags.getFlag(f, flags.masks.C) ? 'C' : '-',
    ].join('');

    console.log(`Flags: ${flagStr}  Cycles: ${this.cpu.cycles}`);
  }

  /**
   * Show memory dump
   */
  memoryDump(address, lines = 8) {
    console.log(`\n--- Memory Dump from ${address.toString(16).padStart(4, '0').toUpperCase()}H ---`);

    for (let i = 0; i < lines; i++) {
      const addr = (address + i * 16) & 0xffff;
      const bytes = [];
      const chars = [];

      for (let j = 0; j < 16; j++) {
        const byte = this.cpu.memory.readByte(addr + j);
        bytes.push(byte.toString(16).padStart(2, '0').toUpperCase());
        chars.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.');
      }

      console.log(`${addr.toString(16).padStart(4, '0').toUpperCase()}H: ${bytes.join(' ')}  ${chars.join('')}`);
    }
  }
}

export { Z80Debugger };
