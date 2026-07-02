export function step({ registers: reg, memory, io, clock }: {
    registers: any;
    memory: any;
    io: any;
    clock: any;
}): {
    registers: any;
    tStates: number;
};
