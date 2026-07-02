// @zx-vibes/machine — regenerated 48K ZX Spectrum machine layer.
//
// Joins the regenerated CPU (@zx-vibes/cpu) and ULA timing model (@zx-vibes/ula)
// into a running machine: interrupt acceptance at instruction boundaries and
// per-access memory contention threaded onto the executed stream. Authored from
// the project DNA (dna/domain/machine-execution.md) and decided by the machine
// conformance fixtures (dna/conformance/machine/*.json).
export { Machine, createMachine, RESET_REGISTERS } from "./machine.mjs";
export { acceptInterrupt, acceptNmi, INT_DATA_BUS, IM01_T_STATES, IM2_T_STATES, NMI_VECTOR, NMI_T_STATES } from "./interrupt.mjs";
export { readZ80, writeZ80, compressZ80, decompressZ80 } from "./snapshot-z80.mjs";
// `.tap` tape-image codec (dna/domain/file-formats.md FMT-TAP-*) — tape, like a
// snapshot, is a file the machine loads, so it lives beside the .z80 codec.
export { tapChecksum, parseTap, serializeTap } from "./tap-format.mjs";
// `.tzx` tape-image codec (dna/domain/file-formats.md FMT-TZX-*) — the versioned,
// pulse-level tape archive, beside the .tap codec.
export { parseTzx, serializeTzx, TZX_SIGNATURE, TZX_VERSION } from "./tzx-format.mjs";
// ROM tape encoding (dna/domain/tape-loading.md TAPE-PULSE-*) — a block body becomes
// the EAR pulse stream (pilot/sync/bit pulses) the real ROM LD-BYTES reads.
export {
  blockToPulses,
  bytePulses,
  PILOT_PULSE_T,
  PILOT_PULSES_HEADER,
  PILOT_PULSES_DATA,
  SYNC1_T,
  SYNC2_T,
  BIT0_PULSE_T,
  BIT1_PULSE_T,
} from "./tape-pulses.mjs";
// ROM tape edge-loading (dna/domain/tape-loading.md "Edge loading" TAPE-EDGE-*) — the
// opaque ROM LD-BYTES (0x0556) consumes the EAR pulse stream on port 0xFE b6 and loads a
// block byte-for-byte into RAM. The tape deck implements the machine io contract.
// `instantLoad` is the instant/trap counterpart: it reproduces the same observable result
// without running the ROM (its correctness is `instant == edge` for the same block).
export {
  createTapeDeck,
  edgeLoad,
  edgeLoadWithDeck,
  instantLoad,
  LD_BYTES_ENTRY,
} from "./tape-edge-load.mjs";
// Screen-address decode lives in @zx-vibes/ula; re-export it from the integrated
// machine entry so a machine consumer can map a screen pixel to its display/attribute
// byte (dna/domain/memory-map.md, MM-SCREEN-ADDR-001 / MM-ATTR-ADDR-001).
export {
  displayByteAddress,
  displayLineAddress,
  attributeAddress,
  DISPLAY_FILE_BASE,
  DISPLAY_FILE_END,
  DISPLAY_FILE_SIZE,
  ATTR_FILE_BASE,
  ATTR_FILE_END,
  ATTR_FILE_SIZE,
} from "@zx-vibes/ula";
// Floating-bus read model also lives in @zx-vibes/ula; re-export it from the
// integrated machine entry so a machine consumer can resolve an IN from an
// undriven (odd) port (dna/domain/ula-timing.md "Floating bus", ULA-FLOATBUS-*;
// scoped per ADR-0026 — the in-window byte is deferred with A5, never fabricated).
export {
  portFloats,
  floatingBusByte,
  activeDisplayFetch,
  FLOATING_BUS_IDLE,
} from "@zx-vibes/ula";
// Kempston joystick read model also lives in @zx-vibes/ula (beside the floating-bus
// model — the Kempston is what carves port 0x1F out of the floating odd-port set);
// re-export it from the integrated machine entry so a machine consumer can resolve an
// IN from the joystick port (dna/domain/peripherals.md, JOY-KEMPSTON-*; ADR-0021).
export {
  kempstonByte,
  kempstonDecodes,
  KEMPSTON_PORT,
  KEMPSTON_RIGHT,
  KEMPSTON_LEFT,
  KEMPSTON_DOWN,
  KEMPSTON_UP,
  KEMPSTON_FIRE,
} from "@zx-vibes/ula";
