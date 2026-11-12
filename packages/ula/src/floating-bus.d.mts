export function portFloats(port: any): boolean;
export function activeDisplayFetch(t: any): boolean;
/**
 * @param {number} t frame T-state
 * @returns {{ value: number | null, modeled: boolean }}
 */
export function floatingBusByte(t: number): {
    value: number | null;
    modeled: boolean;
};
export const FLOATING_BUS_IDLE: 255;
