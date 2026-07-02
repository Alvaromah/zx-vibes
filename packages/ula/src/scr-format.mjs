// Regenerated `.scr` screen-dump load/save, authored from the project DNA
// (dna/domain/file-formats.md "`.scr` — raw screen dump") and decided by the format
// conformance fixtures (dna/conformance/formats/scr-format.json). A `.scr` file is a
// raw, headerless copy of the screen memory region 0x4000-0x5AFF (the 6144-byte
// display file followed by the 768-byte attribute file) — exactly the 6912-byte image
// the gallery framebuffer consumes (screen-render.md SCREEN-FRAMEBUFFER-001). Pure
// data copy: no header, no reordering, no compression.
import {
  DISPLAY_FILE_BASE,
  DISPLAY_FILE_SIZE,
  ATTR_FILE_SIZE,
} from "./screen-address.mjs";

// FMT-SCR-SIZE-001: 6144 (display) + 768 (attribute).
export const SCR_SIZE = DISPLAY_FILE_SIZE + ATTR_FILE_SIZE; // 6912
// FMT-SCR-LAYOUT-001: file offset o is memory address 0x4000 + o.
export const SCR_BASE = DISPLAY_FILE_BASE; // 0x4000

// FMT-SCR-SAVE-001: read exactly 0x4000-0x5AFF into a 6912-byte file, in address
// order (file[o] = memory[0x4000 + o]). No header, no dropped attribute byte.
export function saveScr(memory) {
  if (!memory || memory.length < SCR_BASE + SCR_SIZE) {
    throw new Error(`saveScr: memory must hold at least 0x${(SCR_BASE + SCR_SIZE).toString(16)} bytes`);
  }
  const scr = new Uint8Array(SCR_SIZE);
  for (let offset = 0; offset < SCR_SIZE; offset += 1) {
    scr[offset] = memory[SCR_BASE + offset] & 0xff;
  }
  return scr;
}

// FMT-SCR-LOAD-001: write the 6912 bytes into memory at 0x4000 + offset and touch no
// address outside 0x4000-0x5AFF. FMT-SCR-SIZE-001: reject any other length.
export function loadScr(memory, scr) {
  if (!scr || scr.length !== SCR_SIZE) {
    throw new Error(`loadScr: a .scr file must be exactly ${SCR_SIZE} bytes, got ${scr ? scr.length : "none"}`);
  }
  if (!memory || memory.length < SCR_BASE + SCR_SIZE) {
    throw new Error(`loadScr: memory must hold at least 0x${(SCR_BASE + SCR_SIZE).toString(16)} bytes`);
  }
  for (let offset = 0; offset < SCR_SIZE; offset += 1) {
    memory[SCR_BASE + offset] = scr[offset] & 0xff;
  }
}
