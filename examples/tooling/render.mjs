// Screen RAM -> pixels. Pure (browser-safe): no Node APIs, so it bundles for the
// web. Decodes a 6912-byte ZX Spectrum screen image (6144-byte bitmap + 768-byte
// attribute file, the `.scr` layout, exactly what sits at 0x4000 in RAM) into a
// 256x192 RGBA framebuffer.

/** The 16-entry ZX Spectrum palette (index 0..15 -> [r,g,b]); 205 normal, 255 bright. */
export const PALETTE_RGB = [
  [0, 0, 0], [0, 0, 205], [205, 0, 0], [205, 0, 205],
  [0, 205, 0], [0, 205, 205], [205, 205, 0], [205, 205, 205],
  [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255],
  [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
];

export const FRAME_WIDTH = 256;
export const FRAME_HEIGHT = 192;
export const SCREEN_IMAGE_SIZE = 6912;

// Border thickness. 32x24 gives a tidy 320x240 (4:3) rendered frame.
export const BORDER_X = 32;
export const BORDER_Y = 24;
export const OUT_WIDTH = FRAME_WIDTH + BORDER_X * 2; // 320
export const OUT_HEIGHT = FRAME_HEIGHT + BORDER_Y * 2; // 240

// 48K ULA frame geometry, used to place a border colour change (an `OUT (0xFE)`
// captured with its frame T-state) onto the right scanline. Fixed for the 48K:
// 224 T-states per line, and the top-left display pixel is reached 14336 T-states
// after the frame interrupt. Our 24-row top border therefore begins 24 lines
// earlier, at T-state 8960.
export const T_PER_LINE = 224;
export const DISPLAY_START_T = 14336;
export const BORDER_TOP_T = DISPLAY_START_T - BORDER_Y * T_PER_LINE; // 8960

function displayOffset(x, y) {
  return ((y & 0xc0) << 5) + ((y & 0x07) << 8) + ((y & 0x38) << 2) + (x >> 3);
}
function attributeOffset(x, y) {
  return 6144 + (y >> 3) * 32 + (x >> 3);
}

/** The ULA swaps INK/PAPER every 16 frames when a cell's FLASH bit is set. */
export function flashPhase(frame) {
  return (frame >> 4) & 1;
}

/** Palette index 0..15 of pixel (x, y) for a FLASH phase. */
export function pixelIndex(image, x, y, phase) {
  const displayByte = image[displayOffset(x, y)] ?? 0;
  const pixelOn = (displayByte >> (7 - (x & 7))) & 1;
  const attr = image[attributeOffset(x, y)] ?? 0;
  const ink = attr & 0x07;
  const paper = (attr >> 3) & 0x07;
  const bright = (attr >> 6) & 0x01;
  const flash = (attr >> 7) & 0x01;
  const lit = flash && phase ? !pixelOn : Boolean(pixelOn);
  return (lit ? ink : paper) + (bright ? 8 : 0);
}

/**
 * Render a 6912-byte screen image into a 256x192 RGBA framebuffer (alpha 255).
 * `frame` drives FLASH. Writes into `out` (a Uint8ClampedArray of length
 * 256*192*4) when provided, so a render loop can reuse one ImageData buffer.
 */
export function scrToRgba(image, frame = 0, out) {
  const phase = flashPhase(frame);
  const data = out ?? new Uint8ClampedArray(FRAME_WIDTH * FRAME_HEIGHT * 4);
  let cursor = 0;
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const rgb = PALETTE_RGB[pixelIndex(image, x, y, phase)];
      data[cursor] = rgb[0];
      data[cursor + 1] = rgb[1];
      data[cursor + 2] = rgb[2];
      data[cursor + 3] = 255;
      cursor += 4;
    }
  }
  return data;
}

/**
 * Render the 256x192 display centred inside a solid `border`-coloured frame, into
 * a 320x240 RGBA buffer. `border` is a 0..7 palette index (the border has no BRIGHT
 * bit — it is driven by port 0xFE bits 0..2). Writes into `out` when provided.
 */
export function renderWithBorder(image, border = 7, frame = 0, out) {
  const data = out ?? new Uint8ClampedArray(OUT_WIDTH * OUT_HEIGHT * 4);
  const [br, bg, bb] = PALETTE_RGB[border & 0x07];
  for (let i = 0; i < data.length; i += 4) {
    data[i] = br;
    data[i + 1] = bg;
    data[i + 2] = bb;
    data[i + 3] = 255;
  }
  const phase = flashPhase(frame);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const rowBase = ((y + BORDER_Y) * OUT_WIDTH + BORDER_X) * 4;
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const rgb = PALETTE_RGB[pixelIndex(image, x, y, phase)];
      const di = rowBase + x * 4;
      data[di] = rgb[0];
      data[di + 1] = rgb[1];
      data[di + 2] = rgb[2];
      data[di + 3] = 255;
    }
  }
  return data;
}

/**
 * Collapse a frame's border-change log into a per-output-row colour array.
 * `log` is a flat [t0, colour0, t1, colour1, ...] of `OUT (0xFE)` border writes
 * captured with their frame T-state (ascending). `carryIn` is the border colour
 * in force at the top of the frame (i.e. the value left over from the previous
 * frame). Each of the 240 output rows takes the colour active at the T-state
 * where that scanline begins — that spread of colours across rows is exactly
 * what makes the SAVE/LOAD stripes appear instead of a whole-frame flicker.
 * Writes into `rows` (a Uint8Array(OUT_HEIGHT)) when provided.
 */
export function borderRowsFromLog(log, carryIn = 7, rows) {
  const out = rows ?? new Uint8Array(OUT_HEIGHT);
  let cursor = 0;
  let colour = carryIn & 0x07;
  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    const rowStart = BORDER_TOP_T + y * T_PER_LINE;
    while (cursor + 1 < log.length && log[cursor] <= rowStart) {
      colour = log[cursor + 1] & 0x07;
      cursor += 2;
    }
    out[y] = colour;
  }
  return out;
}

/**
 * Like renderWithBorder, but the border colour varies per scanline: `borderRows`
 * is a Uint8Array(OUT_HEIGHT) of 0..7 palette indices (see borderRowsFromLog).
 * This is the beam-timed border — with a static screen every row shares one
 * colour and it looks identical to renderWithBorder; during tape SAVE/LOAD the
 * rows differ and you get the classic horizontal stripes.
 */
export function renderWithBorderRows(image, borderRows, frame = 0, out) {
  const data = out ?? new Uint8ClampedArray(OUT_WIDTH * OUT_HEIGHT * 4);
  for (let y = 0; y < OUT_HEIGHT; y += 1) {
    const [br, bg, bb] = PALETTE_RGB[borderRows[y] & 0x07];
    let di = y * OUT_WIDTH * 4;
    for (let x = 0; x < OUT_WIDTH; x += 1) {
      data[di] = br;
      data[di + 1] = bg;
      data[di + 2] = bb;
      data[di + 3] = 255;
      di += 4;
    }
  }
  const phase = flashPhase(frame);
  for (let y = 0; y < FRAME_HEIGHT; y += 1) {
    const rowBase = ((y + BORDER_Y) * OUT_WIDTH + BORDER_X) * 4;
    for (let x = 0; x < FRAME_WIDTH; x += 1) {
      const rgb = PALETTE_RGB[pixelIndex(image, x, y, phase)];
      const di = rowBase + x * 4;
      data[di] = rgb[0];
      data[di + 1] = rgb[1];
      data[di + 2] = rgb[2];
      data[di + 3] = 255;
    }
  }
  return data;
}
