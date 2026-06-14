import { Z80 } from '@zx-vibes/emulator/src/core/cpu.js';
import { SpectrumMemory } from '@zx-vibes/emulator/src/spectrum/memory.js';
import { SpectrumULA, SPECTRUM_KEYS } from '@zx-vibes/emulator/src/spectrum/ula.js';
import { SpectrumDisplay } from '@zx-vibes/emulator/src/spectrum/display.js';
import { Tape } from '@zx-vibes/emulator/src/spectrum/tape.js';
import { Z80SnapshotLoader } from '@zx-vibes/emulator/src/spectrum/snapshot.js';

import { loadRom } from './rom.js';
import { runMachine, type RunOptions, type RunOutcome } from './run-loop.js';
import { applySna, applyState, serializeMachine, type ZxState } from './state.js';

export interface LoadBinaryOptions {
  /** Where to jump after loading. Defaults to org. */
  pc?: number;
  /** Stack pointer. Defaults to leaving SP untouched (the ROM set it up). */
  sp?: number;
  /** Disable interrupts before jumping (as if the program started with DI). */
  di?: boolean;
}

/** Full register set including shadow registers (which Z80.getState() omits). */
export interface RegistersFull {
  pc: number;
  sp: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  afPrime: number;
  bcPrime: number;
  dePrime: number;
  hlPrime: number;
  ix: number;
  iy: number;
  i: number;
  r: number;
  im: number;
  iff1: boolean;
  iff2: boolean;
  halted: boolean;
}

export interface AudioActivity {
  /** Writes to the ULA port 0xFE during the last observed run. */
  portFEWrites: number;
  /** Changes of bit 4 of port 0xFE during the last observed run. */
  beeperEdges: number;
  /** Current bit-4 speaker level after the last observed write. */
  beeperLevel: number;
  /** Last value written to port 0xFE. */
  lastPortFE: number;
}

/**
 * Headless ZX Spectrum 48K: composes the DOM-free internals of zx-generation
 * (Z80, SpectrumMemory, SpectrumULA, SpectrumDisplay, Tape) the same way the
 * browser-only ZXSpectrum facade wires them, minus canvas/audio/DOM keyboard.
 */
export class Machine {
  readonly memory: SpectrumMemory;
  readonly ula: SpectrumULA;
  readonly cpu: Z80;
  readonly tape: Tape;
  readonly display: SpectrumDisplay;

  /** Completed frames since boot/restore. */
  frameCount = 0;
  /** T-states elapsed inside the current (incomplete) frame. */
  tStatesIntoFrame = 0;

  private audioActivity: AudioActivity = {
    portFEWrites: 0,
    beeperEdges: 0,
    beeperLevel: 0,
    lastPortFE: 0,
  };
  private beeperLevel = 0;

  private constructor() {
    this.memory = new SpectrumMemory();
    this.ula = new SpectrumULA();
    this.cpu = new Z80(this.memory, this.ula);
    this.tape = new Tape({ cpu: this.cpu, ula: this.ula });
    this.display = new SpectrumDisplay();
    this.resetAudioActivity();
    this.ula.setPortWriteCallback((value: number) => this.recordPortFEWrite(value));
  }

  /** Fresh machine with the 48K ROM loaded, CPU at the reset vector. */
  static boot(): Machine {
    const m = new Machine();
    m.memory.loadROM(loadRom());
    return m;
  }

  /** Restores a machine from a .zxstate document. */
  static fromState(state: ZxState): Machine {
    const m = Machine.boot();
    applyState(m, state);
    return m;
  }

  saveState(): ZxState {
    return serializeMachine(this);
  }

  /** Loads a 48K .sna snapshot (PC popped from the stack per convention). */
  loadSna(data: Uint8Array): void {
    applySna(this, data);
    this.resetRunClocks();
  }

  /** Loads a .z80 v1 48K snapshot via zx-generation's own loader. */
  loadZ80(data: Uint8Array): void {
    new Z80SnapshotLoader(this.memory, this.cpu, this.ula).load(data);
    this.cpu.halted = false;
    this.resetRunClocks();
  }

  run(opts: RunOptions = {}): RunOutcome {
    return runMachine(this, opts);
  }

  /** Clears per-run audio counters while preserving the current speaker baseline. */
  resetAudioActivity(): void {
    this.beeperLevel = this.ula.speakerBit & 0x01;
    this.audioActivity = {
      portFEWrites: 0,
      beeperEdges: 0,
      beeperLevel: this.beeperLevel,
      lastPortFE: this.ula.lastPortFE & 0xff,
    };
  }

  getAudioActivity(): AudioActivity {
    return { ...this.audioActivity };
  }

  private recordPortFEWrite(value: number): void {
    const portValue = value & 0xff;
    const level = (portValue & 0x10) !== 0 ? 1 : 0;
    this.audioActivity.portFEWrites++;
    if (level !== this.beeperLevel) {
      this.audioActivity.beeperEdges++;
      this.beeperLevel = level;
    }
    this.audioActivity.beeperLevel = level;
    this.audioActivity.lastPortFE = portValue;
  }

  /**
   * Injects an assembled binary directly into RAM and points PC at it —
   * the fast path for the agent loop (no tape loading).
   */
  loadBinary(data: Uint8Array, org: number, opts: LoadBinaryOptions = {}): void {
    if (org < 0x4000 || org + data.length > 0x10000) {
      throw new Error(
        `Binary [0x${org.toString(16)}..0x${(org + data.length).toString(16)}) ` +
          'does not fit in RAM (0x4000-0xFFFF)'
      );
    }
    for (let i = 0; i < data.length; i++) {
      this.memory.write(org + i, data[i]!);
    }
    this.cpu.registers.setPC(opts.pc ?? org);
    if (opts.sp !== undefined) {
      this.cpu.registers.set16('SP', opts.sp);
    }
    if (opts.di) {
      this.cpu.iff1 = false;
      this.cpu.iff2 = false;
    }
    this.cpu.halted = false;
  }

  loadTap(data: Uint8Array, filename = 'program.tap'): void {
    this.tape.load(data, filename);
  }

  playTape(): void {
    this.tape.play();
  }

  private resetRunClocks(): void {
    this.cpu.cycles = 0;
    this.frameCount = 0;
    this.tStatesIntoFrame = 0;
  }

  /** Raw RGBA framebuffer, 352x296 (256x192 screen + border). */
  framebufferRGBA(): Uint8Array {
    return this.display.render(
      this.memory.getScreenMemory(),
      this.memory.getAttributeMemory(),
      this.ula.getBorderColor(),
      this.ula.getScanlineBorderColors()
    );
  }

  readMemory(addr: number, len: number): Uint8Array {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      out[i] = this.memory.read((addr + i) & 0xffff);
    }
    return out;
  }

  writeMemory(addr: number, data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      this.memory.write((addr + i) & 0xffff, data[i]!);
    }
  }

  getRegisters(): RegistersFull {
    const r = this.cpu.registers;
    return {
      pc: r.getPC(),
      sp: r.get16('SP'),
      af: (r.get('A') << 8) | r.get('F'),
      bc: (r.get('B') << 8) | r.get('C'),
      de: (r.get('D') << 8) | r.get('E'),
      hl: (r.get('H') << 8) | r.get('L'),
      afPrime: (r.get('A_') << 8) | r.get('F_'),
      bcPrime: (r.get('B_') << 8) | r.get('C_'),
      dePrime: (r.get('D_') << 8) | r.get('E_'),
      hlPrime: (r.get('H_') << 8) | r.get('L_'),
      ix: r.get16('IX'),
      iy: r.get16('IY'),
      i: r.get('I'),
      r: r.get('R'),
      im: this.cpu.interruptMode,
      iff1: this.cpu.iff1,
      iff2: this.cpu.iff2,
      halted: this.cpu.halted,
    };
  }

  /** Press or release a key by Spectrum name (A-Z, 0-9, ENTER, SPACE, CAPS_SHIFT, SYMBOL_SHIFT). */
  setKey(key: string, down: boolean): void {
    const def = SPECTRUM_KEYS[key.toUpperCase()];
    if (!def) {
      throw new Error(`Unknown Spectrum key: ${key}`);
    }
    this.ula.setKey(def.row, def.col, down);
  }
}
