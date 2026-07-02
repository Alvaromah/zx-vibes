// Regenerated 48K ZX Spectrum memory map & screen-address decode, authored from the
// project DNA (dna/domain/memory-map.md) and decided by the screen conformance
// fixtures (dna/conformance/screen/screen-address.json). Pure functions of a pixel
// coordinate: no machine state, no CPU coupling. This models the documented address
// arithmetic only — the bitmap/attribute byte *interpretation* (bit->pixel,
// INK/PAPER/BRIGHT/FLASH -> palette index) is a later slice and is not here.

// --- Region constants (MM-LAYOUT-001 / MM-SCREEN-DISPLAY-FILE-001 / MM-ATTR-FILE-001) ---
export const DISPLAY_FILE_BASE = 0x4000;
export const DISPLAY_FILE_END = 0x57ff;
export const DISPLAY_FILE_SIZE = 6144;

export const ATTR_FILE_BASE = 0x5800;
export const ATTR_FILE_END = 0x5aff;
export const ATTR_FILE_SIZE = 768;

// --- Geometry constants ---
export const SCREEN_WIDTH = 256;
export const SCREEN_HEIGHT = 192;
export const CHAR_COLS = 32;
export const CHAR_ROWS = 24;
export const THIRD_SIZE = 0x800;

// --- Display-file decode (MM-SCREEN-ADDR-001) -------------------------------------
// The display file is NOT linear. The 16-bit address of the byte holding pixel
// (x, y) (line y = y7 y6 y5 y4 y3 y2 y1 y0) has the bit layout:
//   bit: 15 14 13 12 11 10  9  8   7  6  5  4  3  2  1  0
//         0  1  0  y7 y6 y2 y1 y0  y5 y4 y3 x4 x3 x2 x1 x0
// i.e. 0x4000 + third*0x800 + pixelRow*0x100 + charRow*0x20 + col, where
// third = y>>6, pixelRow = y&7, charRow = (y>>3)&7, col = x>>3.
export function displayByteAddress(x, y) {
  return (
    0x4000 +
    ((y & 0xc0) << 5) + // y7 y6   -> bits 12-11 (third)
    ((y & 0x07) << 8) + // y2 y1 y0 -> bits 10-8 (pixel row within cell)
    ((y & 0x38) << 2) + // y5 y4 y3 -> bits 7-5 (char row within third)
    (x >> 3) //           x4..x0   -> bits 4-0 (byte column)
  );
}

// First byte (column 0) of pixel line y; the 32 bytes of a line are contiguous.
// (MM-SCREEN-LINE-ADDR-001)
export function displayLineAddress(y) {
  return displayByteAddress(0, y);
}

// --- Attribute decode (MM-ATTR-ADDR-001) ------------------------------------------
// Linear, row-major (no thirds interleave): 0x5800 + charRow*32 + charCol.
export function attributeAddress(x, y) {
  return 0x5800 + (y >> 3) * 32 + (x >> 3);
}
