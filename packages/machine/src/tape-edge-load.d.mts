/**
 * @param {ArrayLike<number> | Iterable<number>} pulses
 * @param {object} [options]
 * @param {() => number} [options.clock] returns the tape T-state cursor (required)
 * @param {number} [options.startLevel]
 * @param {number} [options.keyboard]
 */
export function createTapeDeck(pulses: ArrayLike<number> | Iterable<number>, { clock, startLevel, keyboard }?: {
    clock?: () => number;
    startLevel?: number;
    keyboard?: number;
}): {
    levelAt: (t: any) => number;
    total: number;
    read(port: any): number;
    write(port: any, value: any): void;
};
/**
 * @param {import("./machine.mjs").Machine} machine
 * @param {ReturnType<typeof createTapeDeck>} deck
 * @param {object} [options]
 * @param {number} [options.ix] LD-BYTES destination address (required)
 * @param {number} [options.de] LD-BYTES byte count (required)
 * @param {number} [options.flag] expected flag byte (required)
 * @param {boolean} [options.load] LOAD (true) or VERIFY (false)
 * @param {number} [options.tStateBudget]
 * @param {number} [options.sentinel]
 */
export function edgeLoadWithDeck(machine: import("./machine.mjs").Machine, deck: ReturnType<typeof createTapeDeck>, { ix, de, flag, load, tStateBudget, sentinel }?: {
    ix?: number;
    de?: number;
    flag?: number;
    load?: boolean;
    tStateBudget?: number;
    sentinel?: number;
}): {
    ok: boolean;
    reason: string;
    bytesLoaded: number;
    tStates: number;
};
/**
 * @param {import("./machine.mjs").Machine} machine
 * @param {ArrayLike<number> | Iterable<number>} pulses
 * @param {object} [options]
 * @param {number} [options.ix] LD-BYTES destination address (required)
 * @param {number} [options.de] LD-BYTES byte count (required)
 * @param {number} [options.flag] expected flag byte (required)
 * @param {boolean} [options.load] LOAD (true) or VERIFY (false)
 * @param {number} [options.tStateBudget]
 * @param {number} [options.sentinel]
 * @param {number} [options.startLevel]
 * @param {number} [options.keyboard]
 * @param {number} [options.trailingPulse]
 */
export function edgeLoad(machine: import("./machine.mjs").Machine, pulses: ArrayLike<number> | Iterable<number>, { ix, de, flag, load, tStateBudget, sentinel, startLevel, keyboard, trailingPulse }?: {
    ix?: number;
    de?: number;
    flag?: number;
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
/**
 * @param {import("./machine.mjs").Machine} machine
 * @param {ArrayLike<number>} body
 * @param {object} [options]
 * @param {number} [options.ix] LD-BYTES destination address (required)
 * @param {number} [options.de] LD-BYTES byte count (required)
 * @param {number} [options.flag] expected flag byte (required)
 * @param {boolean} [options.load] LOAD (true) or VERIFY (false)
 */
export function instantLoad(machine: import("./machine.mjs").Machine, body: ArrayLike<number>, { ix, de, flag, load }?: {
    ix?: number;
    de?: number;
    flag?: number;
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
