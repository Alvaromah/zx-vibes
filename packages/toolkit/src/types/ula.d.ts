// Ambient typings for the untyped ESM core `@zx-vibes/ula`.
//
// The run service's instruction-granular observed loop (RT-PROD-RUN-002) needs
// two ULA-timing primitives the integrated `@zx-vibes/machine` entry does NOT
// re-export: the frame length and the once-per-frame INT window. They are part of
// the public ULA timing surface (`ula-timing.mjs`, ULA-TIME-FRAME-001 /
// MACHINE-INT-SAMPLE-001) — a legitimate reconstructed-core dependency under the
// clean-room seal. This declaration types exactly the two symbols consumed.
declare module '@zx-vibes/ula' {
  /** Frame length in T-states (ULA-TIME-FRAME-001) — 69888 on a 48K machine. */
  export const FRAME_T_STATES: number;
  /** True iff the ULA is asserting INT at frame-relative T-state `t`. */
  export function interruptActive(t: number): boolean;

  // --- Screen content decode (screen-render.md SCREEN-FRAMEBUFFER-001) -------
  // The framebuffer renderer composes these with the gallery palette to assemble a
  // captured 6912-byte screen image into the visible 256x192 canvas. Authored from
  // the ULA package's PUBLIC exports (`screen-address.mjs`, `screen-attribute.mjs`),
  // a legitimate reconstructed-core dependency under the clean-room seal.

  /** Base address of the display file (`0x4000`); image offset 0 maps here. */
  export const DISPLAY_FILE_BASE: number;
  /**
   * FLASH phase of a frame counter (MM-ATTR-FLASH-001): the ULA inverts every 16
   * frames. Phase `0` is normal, phase `1` the INK↔PAPER-swapped state.
   */
  export function flashPhase(frame: number): number;
  /**
   * Final palette index `0..15` of a pixel (MM-PIXEL-COLOUR-001) from its attribute
   * byte, the bitmap bit (`pixelOn` 0/1), and the FLASH `phase` (0/1). BRIGHT raises
   * whichever colour is shown; FLASH swaps INK/PAPER on the odd phase.
   */
  export function pixelColorIndex(byte: number, pixelOn: number, phase: number): number;
}
