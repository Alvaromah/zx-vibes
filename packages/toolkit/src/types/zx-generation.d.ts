/**
 * Ambient type declarations for the zx-generation deep imports.
 *
 * zx-generation@1.0.1 ships plain-JS ES modules under src/ with no exports
 * map, so subpath imports work in Node. These declarations cover only the
 * surface Spectral uses; they were written against the 1.0.1 sources and the
 * dependency is pinned to that exact version. If the pin moves, re-verify
 * every signature here against node_modules/zx-generation/src.
 */

declare module '@zx-vibes/emulator/src/core/cpu.js' {
  export interface Registers {
    data: Record<string, number>;
    get(name: string): number;
    set(name: string, value: number): void;
    get16(name: string): number;
    set16(name: string, value: number): void;
    getPC(): number;
    setPC(value: number): void;
    reset(): void;
  }

  export interface CpuState {
    pc: number;
    sp: number;
    a: number;
    f: number;
    b: number;
    c: number;
    d: number;
    e: number;
    h: number;
    l: number;
    ix: number;
    iy: number;
    i: number;
    r: number;
    im: number;
    iff1: boolean;
    iff2: boolean;
    halted: boolean;
    cycles: number;
  }

  export class Z80 {
    constructor(memory: unknown, ula: unknown);
    registers: Registers;
    halted: boolean;
    interruptMode: number;
    iff1: boolean;
    iff2: boolean;
    cycles: number;
    reset(): void;
    /** Executes one instruction (4 T-states if halted) and returns its T-state cost. */
    execute(): number;
    interrupt(): void;
    getState(): CpuState;
    setState(state: Partial<CpuState>): void;
  }
}

declare module '@zx-vibes/emulator/src/spectrum/memory.js' {
  export class SpectrumMemory {
    rom: Uint8Array;
    ram: Uint8Array;
    romEnabled: boolean;
    read(address: number): number;
    write(address: number, value: number): void;
    loadROM(data: Uint8Array): void;
    /** View of the 6144-byte pixel bitmap (0x4000-0x57FF). */
    getScreenMemory(): Uint8Array;
    /** View of the 768-byte attribute area (0x5800-0x5AFF). */
    getAttributeMemory(): Uint8Array;
    clearRAM(): void;
  }
}

declare module '@zx-vibes/emulator/src/spectrum/ula.js' {
  export class SpectrumULA {
    borderColor: number;
    speakerBit: number;
    micBit: number;
    keyboardMatrix: Uint8Array;
    lastPortFE: number;
    tapeInputBit: number;
    scanline: number;
    scanlineBorderColors: Uint8Array;
    borderChanged: boolean;
    cycleCounter: number;
    interruptPending: boolean;
    readonly SCANLINES_PER_FRAME: number;
    readonly TSTATES_PER_SCANLINE: number;
    readPort(port: number): number;
    writePort(port: number, value: number): void;
    setKey(row: number, col: number, pressed: boolean): void;
    clearKeys(): void;
    getBorderColor(): number;
    addCycles(cycles: number): void;
    getScanlineBorderColors(): Uint8Array;
    shouldGenerateInterrupt(): boolean;
    setBorderColor(color: number): void;
    setTapeInput(bit: number): void;
  }

  export const SPECTRUM_KEYS: Record<string, { row: number; col: number }>;
  export const PC_KEY_MAP: Record<string, string | { keys: string[] }>;
}

declare module '@zx-vibes/emulator/src/spectrum/display.js' {
  export class SpectrumDisplay {
    readonly width: number;
    readonly height: number;
    readonly borderTop: number;
    readonly borderBottom: number;
    readonly borderLeft: number;
    readonly borderRight: number;
    readonly totalWidth: number;
    readonly totalHeight: number;
    /** Returns the internal RGBA buffer (totalWidth x totalHeight x 4). */
    render(
      screenMemory: Uint8Array,
      attributeMemory: Uint8Array,
      borderColor: number,
      scanlineBorderColors?: Uint8Array | null
    ): Uint8Array;
    getDisplaySize(): {
      width: number;
      height: number;
      screenWidth: number;
      screenHeight: number;
      borderTop: number;
      borderBottom: number;
      borderLeft: number;
      borderRight: number;
    };
  }
}

declare module '@zx-vibes/emulator/src/spectrum/tape.js' {
  /** Only reads .cpu and .ula from the object passed to the constructor. */
  export class Tape {
    constructor(spectrum: { cpu: unknown; ula: unknown });
    playing: boolean;
    load(data: Uint8Array, filename?: string): void;
    play(): void;
    stop(): void;
    rewind(): void;
    /** Advances tape playback to the given absolute CPU cycle; returns the EAR bit. */
    update(cycles: number): number;
  }
}

declare module '@zx-vibes/emulator/src/spectrum/snapshot.js' {
  /** .z80 v1 (48K) snapshot loader. Writes shadow registers via registers.data. */
  export class Z80SnapshotLoader {
    constructor(memory: unknown, cpu: unknown, ula: unknown);
    load(data: Uint8Array): void;
  }
}
