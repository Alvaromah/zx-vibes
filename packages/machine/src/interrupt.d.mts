export function acceptInterrupt({ registers, memory, halted, dataBus, romTop }: {
    registers: any;
    memory: any;
    halted?: boolean;
    dataBus?: number;
    romTop?: number;
}): {
    registers: any;
    tStates: number;
    accepted: boolean;
    halted: boolean;
};
export function acceptNmi({ registers, memory, halted, romTop }: {
    registers: any;
    memory: any;
    halted?: boolean;
    romTop?: number;
}): {
    registers: any;
    tStates: number;
    accepted: boolean;
    halted: boolean;
};
export const INT_DATA_BUS: 255;
export const IM01_T_STATES: 13;
export const IM2_T_STATES: 19;
export const NMI_VECTOR: 102;
export const NMI_T_STATES: 11;
