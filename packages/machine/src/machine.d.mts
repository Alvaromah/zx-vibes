/** @param {ConstructorParameters<typeof Machine>[0]} [options] */
export function createMachine(options?: ConstructorParameters<typeof Machine>[0]): Machine;
export const RESET_REGISTERS: Readonly<{
    a: 255;
    f: 255;
    b: 255;
    c: 255;
    d: 255;
    e: 255;
    h: 255;
    l: 255;
    a_: 255;
    f_: 255;
    b_: 255;
    c_: 255;
    d_: 255;
    e_: 255;
    h_: 255;
    l_: 255;
    pc: 0;
    sp: 65535;
    i: 0;
    r: 0;
    iff1: 0;
    iff2: 0;
    im: 0;
    memptr: 0;
    ixh: 255;
    ixl: 255;
    iyh: 255;
    iyl: 255;
}>;
export class Machine {
    /**
     * @param {object} [options]
     * @param {Record<string, number>} [options.registers] initial register file (8-bit halves; unknown names are ignored, missing ones are 0)
     * @param {Uint8Array | Record<string, ArrayLike<number>>} [options.memory] a 64 KB image used as-is, or { address: bytes } chunks copied into zeroed RAM
     * @param {{ read(port: number): number, write(port: number, value: number): void }} [options.io] port I/O (default: reads float 0xFF, writes are dropped)
     * @param {number} [options.clock] initial frame T-state (taken modulo FRAME_T_STATES)
     * @param {boolean} [options.exactContention] select the M-cycle-exact contention model
     * @param {boolean} [options.romWriteProtect] ignore writes to 0x0000-0x3FFF, as the 48K ROM does (MACHINE-ROM-READONLY-001); off by default
     */
    constructor({ registers, memory, io, clock, exactContention, romWriteProtect }?: {
        registers?: Record<string, number>;
        memory?: Uint8Array | Record<string, ArrayLike<number>>;
        io?: {
            read(port: number): number;
            write(port: number, value: number): void;
        };
        clock?: number;
        exactContention?: boolean;
        romWriteProtect?: boolean;
    });
    registers: Record<string, number>;
    memory: Uint8Array<ArrayBuffer>;
    io: {
        read(port: number): number;
        write(port: number, value: number): void;
    };
    clock: number;
    exactContention: boolean;
    romWriteProtect: boolean;
    halted: boolean;
    eiDelay: number;
    tStatesTotal: number;
    frames: number;
    /** The first writable address: 0x4000 when the ROM is write-protected, else 0. */
    romTop(): 0 | 16384;
    reset(): this;
    _contentionClock(instructionStart: any): {
        base: any;
        extra: number;
        access(address: any): void;
    };
    _exactClock(instructionStart: any): {
        base: any;
        runT: number;
        extra: number;
        perAccessExtra: number;
        incomplete: boolean;
        access(address: any): void;
        mcycle(address: any, tStates: any): void;
        internal(address: any, n: any): void;
        inexact(): void;
        total(): number;
    };
    stepInstruction(): {
        tStates: any;
        contention: any;
        halted: boolean;
    };
    _acceptInterrupt(dataBus?: number): {
        registers: any;
        tStates: number;
        accepted: boolean;
        halted: boolean;
    };
    _interruptArmed(): boolean;
    runFrame({ dataBus }?: {
        dataBus?: number;
    }): {
        tStates: number;
        accepted: number;
    };
}
