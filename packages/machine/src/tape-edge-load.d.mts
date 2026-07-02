export function createTapeDeck(pulses: any, { clock, startLevel, keyboard }?: {
    startLevel?: number;
    keyboard?: number;
}): {
    levelAt: (t: any) => number;
    total: number;
    read(port: any): number;
    write(port: any, value: any): void;
};
export function edgeLoadWithDeck(machine: any, deck: any, { ix, de, flag, load, tStateBudget, sentinel }?: {
    load?: boolean;
    tStateBudget?: number;
    sentinel?: number;
}): {
    ok: boolean;
    reason: string;
    bytesLoaded: number;
    tStates: number;
};
export function edgeLoad(machine: any, pulses: any, { ix, de, flag, load, tStateBudget, sentinel, startLevel, keyboard, trailingPulse }?: {
    load?: boolean;
    tStateBudget?: number;
    sentinel?: number;
    startLevel?: number;
    keyboard?: number;
    trailingPulse?: number;
}): {
    ok: boolean;
    reason: string;
    bytesLoaded: number;
    tStates: number;
};
export function instantLoad(machine: any, body: any, { ix, de, flag, load }?: {
    load?: boolean;
}): {
    ok: boolean;
    reason: string;
    bytesLoaded: number;
    tStates: number;
};
export const LD_BYTES_ENTRY: 1366;
export { FRAME_T_STATES };
import { FRAME_T_STATES } from "@zx-vibes/ula";
