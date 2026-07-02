#!/usr/bin/env node
// Reference visible-raster / border-pixel model, authored from dna/product/
// raster-border.md (the gallery's raster rendering policy, ADR-0016 §4 default) over
// the documented 48K display timing. It is the conformance model for S4 (R-W8-04):
// the default --module of run-raster-fixtures.mjs. The geometry margins are the
// DEFAULTED, FLAGGED-FOR-REVIEW rendering choice (the user may have exact shell
// constants).

// Documented hardware timing (ADR-0010 / ula-timing.md):
export const DISPLAY_START_T = 14335; // frame T-state of display-data start, line 0
export const T_PER_LINE = 224;        // T-states per scan line
export const DISPLAY_LINES = 192;     // active display lines
export const DISPLAY_COLS = 256;      // active display pixels per line
export const PIXELS_PER_TSTATE = 2;   // 7 MHz pixel clock / 3.5 MHz CPU clock

// Gallery rendering policy (decision:ADR-0016 §4 default — FLAGGED for user review):
export const BORDER_LEFT = 32;        // visible left/right border margin (px)
export const BORDER_TOP = 24;         // visible top/bottom border margin (lines)
export const CANVAS_WIDTH = DISPLAY_COLS + 2 * BORDER_LEFT;   // 320
export const CANVAS_HEIGHT = DISPLAY_LINES + 2 * BORDER_TOP;  // 240

// True iff canvas pixel (x,y) is in the border (outside the 256x192 active area
// inset by BORDER_LEFT/BORDER_TOP).
export function isBorderPixel(x, y) {
  return (
    x < BORDER_LEFT || x >= BORDER_LEFT + DISPLAY_COLS ||
    y < BORDER_TOP || y >= BORDER_TOP + DISPLAY_LINES
  );
}

// The frame T-state at which the ULA draws canvas pixel (x,y). Line (y - BORDER_TOP)
// display data starts at DISPLAY_START_T + line*T_PER_LINE; column (x - BORDER_LEFT)
// is floor((x-BORDER_LEFT)/2) T from the line's display start (left border negative,
// right border beyond 128 T). visible-line-start = display - BORDER_TOP lines.
export function pixelTState(x, y) {
  const line = y - BORDER_TOP;
  const colOffsetT = Math.floor((x - BORDER_LEFT) / PIXELS_PER_TSTATE);
  return DISPLAY_START_T + line * T_PER_LINE + colOffsetT;
}

// Standard ZX Spectrum non-bright palette at the 205 level the gallery renders
// (decision:ADR-0016): 0 black, 1 blue, 2 red, 3 magenta, 4 green, 5 cyan, 6 yellow,
// 7 white. SAVE tape bands are red (2) and cyan (5).
const PALETTE = [
  [0, 0, 0], [0, 0, 205], [205, 0, 0], [205, 0, 205],
  [0, 205, 0], [0, 205, 205], [205, 205, 0], [205, 205, 205],
];
export function palette(colorIndex) { return PALETTE[colorIndex & 7]; }

// Border colour index in effect at frame T-state t, given the border event stream
// [{ tFrame, value }] (S1, chronological) and the colour before the first event.
export function borderColorAt(t, events, initial = 0) {
  let color = initial;
  for (const event of events ?? []) {
    if (event.tFrame <= t) color = event.value;
    else break;
  }
  return color;
}

// The RGB of canvas border pixel (x,y) for a given border event stream.
export function borderPixelRgb(x, y, events, initial = 0) {
  return palette(borderColorAt(pixelTState(x, y), events, initial));
}
