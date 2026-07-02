export function createMachine(options?: {}): Machine;
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
    constructor({ registers, memory, io, clock, exactContention }?: {
        clock?: number;
        exactContention?: boolean;
    });
    registers: {};
    memory: Uint8Array<ArrayBuffer>;
    io: any;
    clock: number;
    exactContention: boolean;
    halted: boolean;
    eiDelay: number;
    tStatesTotal: number;
    frames: number;
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
