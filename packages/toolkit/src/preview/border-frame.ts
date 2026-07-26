// The preview player's 320×240 bordered frame — raster-border.md geometry
// (RASTER-GEOMETRY-001) with a per-scanline border colour derived from the
// frame's chronological port-0xFE border events, so tape SAVE/LOAD paints its
// red/cyan bands (RASTER-SAVE-PP-001) instead of a whole-frame flicker.
//
// Pure and DOM-free: the player writes into an ImageData buffer it owns. The
// per-SCANLINE colour is the row-granular reading of RASTER-TSTATE-PIXEL-001 —
// each visible row takes the colour in effect where its raster line begins.

import { CONTENTION_START_T, T_STATES_PER_LINE } from '@zx-vibes/ula/timing';

/** Visible border thickness (RASTER-GEOMETRY-001): 32 px left/right, 24 lines top/bottom. */
export const BORDER_X = 32;
export const BORDER_Y = 24;
/** The bordered canvas (RASTER-GEOMETRY-001): 320 = 32+256+32, 240 = 24+192+24. */
export const OUT_WIDTH = 256 + BORDER_X * 2;
export const OUT_HEIGHT = 192 + BORDER_Y * 2;

// Frame T-state where canvas row `y` becomes visible. Display line 0's data
// starts at the contended-display anchor (CONTENTION_START_T = 14335,
// RASTER-TSTATE-PIXEL-001); the visible row starts its 32-px left border 16
// T-states (2 px/T) before that, and the 24-line top border begins 24 lines
// earlier still.
const ROW0_T = CONTENTION_START_T - BORDER_X / 2 - BORDER_Y * T_STATES_PER_LINE;

/** Frame T-state at which visible canvas row `y` (0..239) starts. */
export function scanlineStartT(y: number): number {
  return ROW0_T + y * T_STATES_PER_LINE;
}

/**
 * Collapse one frame's border-change log into a per-row colour array. `log` is
 * a flat `[t0, colour0, t1, colour1, …]` of border-changing `OUT (0xFE)` writes
 * stamped with their frame T-state offset (ascending — the offset must come
 * from the monotonic total T-state clock, not the mod-69888 frame clock, which
 * wraps mid-frame). `carryIn` is the colour in force at the top of the frame
 * (whatever the previous frame left behind). Each of the 240 rows takes the
 * colour active where its scanline begins — the spread that turns a SAVE's
 * writes into horizontal bands. Writes into `rows` when provided (a reusable
 * `Uint8Array(OUT_HEIGHT)`, so a render loop allocates nothing per frame).
 */
export function borderRowsFromLog(
  log: ArrayLike<number>,
  carryIn: number,
  rows?: Uint8Array,
): Uint8Array {
  const out = rows ?? new Uint8Array(OUT_HEIGHT);
  let cursor = 0;
  let colour = carryIn & 0x07;
  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    const rowStart = scanlineStartT(y);
    while (cursor + 1 < log.length && (log[cursor] as number) <= rowStart) {
      colour = (log[cursor + 1] as number) & 0x07;
      cursor += 2;
    }
    out[y] = colour;
  }
  return out;
}

/**
 * Paint every pixel of each canvas row with that row's border colour (RGBA,
 * alpha 255) — the 256×192 display content is then written over the inset
 * region by the caller's framebuffer decode. `palette` maps a colour index
 * 0..7 to `[r, g, b]` (the shared non-bright table, RASTER-PALETTE-001).
 */
export function fillBorderRows(
  data: Uint8ClampedArray,
  rows: ArrayLike<number>,
  palette: ReadonlyArray<readonly number[]>,
): void {
  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    const rgb = palette[(rows[y] as number) & 0x07]!;
    let cursor = y * OUT_WIDTH * 4;
    for (let x = 0; x < OUT_WIDTH; x += 1) {
      data[cursor] = rgb[0]!;
      data[cursor + 1] = rgb[1]!;
      data[cursor + 2] = rgb[2]!;
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
}
