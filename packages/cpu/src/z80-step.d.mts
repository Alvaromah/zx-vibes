/**
 * Execute one instruction.
 * @param {object} state
 * @param {Record<string, number>} state.registers the register file (8-bit halves), updated in place
 * @param {Uint8Array} state.memory the 64 KB address space
 * @param {{ read(port: number): number, write(port: number, value: number): void }} state.io port I/O (used by IN/OUT)
 * @param {{ access?(address: number): void, mcycle?(address: number, tStates: number): void, internal?(address: number, n: number): void, inexact?(): void }} [state.clock] optional bus-cycle hooks for contention
 * @param {number} [state.romTop] writes to addresses below this are ignored, as a
 *   ROM ignores them (0x4000 on a 48K machine; MACHINE-ROM-READONLY-001). The
 *   write's bus cycle still happens and is timed. Default 0: all memory writable.
 * @returns {{ registers: Record<string, number>, tStates: number }}
 */
export function step({ registers: reg, memory, io, clock, romTop }: {
    registers: Record<string, number>;
    memory: Uint8Array;
    io: {
        read(port: number): number;
        write(port: number, value: number): void;
    };
    clock?: {
        access?(address: number): void;
        mcycle?(address: number, tStates: number): void;
        internal?(address: number, n: number): void;
        inexact?(): void;
    };
    romTop?: number;
}): {
    registers: Record<string, number>;
    tStates: number;
};
