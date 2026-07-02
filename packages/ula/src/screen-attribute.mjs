// Regenerated 48K ZX Spectrum attribute / colour decode, authored from the project
// DNA (dna/domain/memory-map.md "Attribute & colour decode") and decided by the
// screen conformance fixtures (dna/conformance/screen/attr-decode.json). Pure
// functions of an attribute byte (and, for the per-pixel form, a bitmap bit and the
// FLASH phase): no machine state. This produces a palette INDEX 0..15 (hardware
// truth); the index -> RGB triple is gallery render policy (dna/product/palette.yaml).

// Attribute bit fields (MM-ATTR-BITS-001):
//   bit 7 FLASH | bit 6 BRIGHT | bits 5..3 PAPER (0..7) | bits 2..0 INK (0..7)
export function attributeInk(byte) {
  return byte & 0x07;
}
export function attributePaper(byte) {
  return (byte >> 3) & 0x07;
}
export function attributeBright(byte) {
  return (byte >> 6) & 1;
}
export function attributeFlash(byte) {
  return (byte >> 7) & 1;
}

// Palette index 0..15 = base colour 0..7 + 8*BRIGHT (MM-ATTR-COLOUR-INDEX-001).
// BRIGHT raises the whole cell; it is not a separate hue.
export function inkColorIndex(byte) {
  return attributeInk(byte) + attributeBright(byte) * 8;
}
export function paperColorIndex(byte) {
  return attributePaper(byte) + attributeBright(byte) * 8;
}

// FLASH phase (MM-ATTR-FLASH-001): the ULA inverts every 16 frames. Phase 0 is the
// normal state, phase 1 the swapped (INK<->PAPER) state.
export const FLASH_FRAMES = 16;
export function flashPhase(frame) {
  return Math.floor(frame / FLASH_FRAMES) & 1;
}

// Final palette index of a pixel (MM-PIXEL-COLOUR-001): pixelOn=1 shows INK, 0 shows
// PAPER. When the FLASH bit is set and the phase is odd, INK and PAPER swap first;
// BRIGHT applies after the swap (it raises whichever colour is shown).
export function pixelColorIndex(byte, pixelOn, phase) {
  let ink = attributeInk(byte);
  let paper = attributePaper(byte);
  if (attributeFlash(byte) && (phase & 1)) {
    const swap = ink;
    ink = paper;
    paper = swap;
  }
  const base = pixelOn ? ink : paper;
  return base + attributeBright(byte) * 8;
}
