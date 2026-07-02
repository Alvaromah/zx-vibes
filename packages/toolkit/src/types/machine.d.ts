// Ambient typings for the untyped ESM dependency `@zx-vibes/machine`.
//
// The machine core ships as plain `.mjs` with no `.d.ts`. We only consume a thin
// public surface here (a fresh-boot machine for the stateless session, RT-PROD-
// SESSION-*); this declaration types exactly that surface so the toolkit can stay
// `strict` without reaching into the core's implementation. Authored from the
// machine package's PUBLIC exports (`src/index.mjs`, `src/machine.mjs`), a
// legitimate dependency under the clean-room seal.
declare module '@zx-vibes/machine' {
  /** The Z80 register file as the machine models it (8-bit halves, all keys present). */
  export type MachineRegisters = Record<string, number> & {
    pc: number;
    sp: number;
    a: number;
    f: number;
  };

  export interface MachineIo {
    read(port: number): number;
    write(port: number, value: number): void;
  }

  export interface StepResult {
    tStates: number;
    contention: number;
    halted: boolean;
  }

  export interface FrameResult {
    tStates: number;
    accepted: number;
  }

  export interface MachineOptions {
    registers?: Record<string, number>;
    memory?: Uint8Array | Record<string, ArrayLike<number>>;
    io?: MachineIo;
    clock?: number;
    exactContention?: boolean;
  }

  export class Machine {
    constructor(options?: MachineOptions);
    registers: MachineRegisters;
    memory: Uint8Array;
    io: MachineIo;
    clock: number;
    halted: boolean;
    /**
     * Post-EI one-instruction interrupt-inhibit countdown (MACHINE-INT-EI-DELAY-001).
     * Public so an instruction-granular driver can mirror the frame loop's interrupt
     * sampling (the run service's observed loop, RT-PROD-RUN-002).
     */
    eiDelay: number;
    tStatesTotal: number;
    frames: number;
    reset(): this;
    stepInstruction(): StepResult;
    runFrame(options?: { dataBus?: number }): FrameResult;
  }

  export function createMachine(options?: MachineOptions): Machine;

  export const RESET_REGISTERS: Readonly<Record<string, number>>;

  // --- .z80 snapshot codec (snapshot-z80.mjs) -------------------------------
  // The community .z80 snapshot format: registers + 64 KB memory + border. WRITES
  // version 3, READS v1/v2/v3 (dna/domain/snapshot-z80.md). Consumed by the toolkit's
  // `.zxstate` session codec (it wraps a writeZ80 snapshot) and by `state export --z80`
  // (which writes the bytes directly). Round-tripping preserves RAM + register file +
  // border (NOT the separate `halted`/`memptr`, which the .zxstate envelope carries).
  export interface Z80Snapshot {
    registers: Record<string, number>;
    memory: Uint8Array;
    border: number;
    version: number;
  }
  export function writeZ80(state: {
    registers?: Record<string, number>;
    memory: Uint8Array | ArrayLike<number>;
    border?: number;
  }): Uint8Array;
  export function readZ80(bytes: Uint8Array | ArrayLike<number>): Z80Snapshot;

  // --- .tap tape-image codec (tap-format.mjs) -------------------------------
  // The community .tap block stream: each block is [len:2 LE][flag][data][XOR checksum]
  // (dna/domain/file-formats.md FMT-TAP-*). Tape, like a snapshot, is a file the machine
  // loads; consumed by the loadable-format emitter (`build --tap` / `state export --tap`).
  export interface TapBlock {
    flag: number;
    data: Uint8Array;
    checksum: number;
  }
  export function tapChecksum(flag: number, data: Uint8Array | ArrayLike<number>): number;
  export function parseTap(bytes: Uint8Array | ArrayLike<number>): TapBlock[];
  export function serializeTap(
    blocks: ReadonlyArray<{ flag: number; data: Uint8Array | ArrayLike<number> }>,
  ): Uint8Array;

  // --- ROM tape pulse encoding (tape-pulses.mjs) ----------------------------
  // A block body [flag, ...data, checksum] -> the EAR pulse stream the ROM LD-BYTES reads
  // (dna/domain/tape-loading.md TAPE-PULSE-*).
  export function blockToPulses(body: Uint8Array | ArrayLike<number>): number[];
  export function bytePulses(byte: number): number[];

  // --- ROM tape edge / instant loading (tape-edge-load.mjs) -----------------
  // `edgeLoad` drives the opaque ROM `LD-BYTES` (0x0556) over the EAR pulse stream;
  // `instantLoad` reproduces the same observable result without running the ROM
  // (dna/domain/tape-loading.md TAPE-EDGE-* / TAPE-INSTANT-*). Register contract:
  // ix = RAM destination, de = data byte count, flag = expected flag byte.
  export interface TapeLoadOptions {
    ix: number;
    de: number;
    flag: number;
    load?: boolean;
    tStateBudget?: number;
    sentinel?: number;
  }
  export interface TapeLoadResult {
    ok: boolean;
    reason: string;
    bytesLoaded: number;
    tStates: number;
  }
  export function edgeLoad(
    machine: Machine,
    pulses: ArrayLike<number>,
    options: TapeLoadOptions,
  ): TapeLoadResult;
  export function instantLoad(
    machine: Machine,
    body: Uint8Array | ArrayLike<number>,
    options: Pick<TapeLoadOptions, 'ix' | 'de' | 'flag' | 'load'>,
  ): TapeLoadResult;
  export const LD_BYTES_ENTRY: number;

  // --- Maskable interrupt acceptance (interrupt.mjs) ------------------------
  // Consumed by the run service's instruction-granular observed loop to mirror
  // Machine.runFrame's interrupt sampling (MACHINE-FRAME-LOOP-001).
  export interface InterruptResult {
    registers: MachineRegisters;
    tStates: number;
    accepted: boolean;
    halted: boolean;
  }
  export function acceptInterrupt(args: {
    registers: MachineRegisters;
    memory: Uint8Array;
    halted?: boolean;
    dataBus?: number;
  }): InterruptResult;
  export const INT_DATA_BUS: number;

  // --- Kempston joystick read model (re-exported from @zx-vibes/ula) --------
  // peripherals.md JOY-KEMPSTON-*. Drives the run loop's scheduled `--joy` input.
  export interface KempstonState {
    up?: boolean;
    down?: boolean;
    left?: boolean;
    right?: boolean;
    fire?: boolean;
  }
  export function kempstonByte(state?: KempstonState): number;
  export function kempstonDecodes(port: number): boolean;
  export const KEMPSTON_PORT: number;
  export const KEMPSTON_RIGHT: number;
  export const KEMPSTON_LEFT: number;
  export const KEMPSTON_DOWN: number;
  export const KEMPSTON_UP: number;
  export const KEMPSTON_FIRE: number;

  // --- Screen address decode (re-exported from @zx-vibes/ula) ---------------
  // memory-map.md MM-SCREEN-ADDR-001 / MM-ATTR-ADDR-001. Backs the screen-read
  // primitive's non-blank-cell scan.
  export function displayByteAddress(x: number, y: number): number;
  export function attributeAddress(x: number, y: number): number;
}
