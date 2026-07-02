// Regenerated 48K ZX Spectrum ULA timing model, authored from the project DNA
// (dna/domain/ula-timing.md) and decided by the timing conformance fixtures
// (dna/conformance/timing/*.json). Pure functions of a frame T-state and a
// memory address: no machine state, no CPU coupling. Integrating these into the
// executed instruction stream (contention applied to each memory access) and
// interrupt acceptance is a later slice; this models the documented timing only.

// --- Frame and interrupt (ULA-TIME-FRAME-001 / ULA-TIME-INT-001) -------------
export const SCAN_LINES = 312;
export const T_STATES_PER_LINE = 224;
export const FRAME_T_STATES = SCAN_LINES * T_STATES_PER_LINE; // 69888
export const INTERRUPT_T_STATES = 32; // INT held LOW for the first 32 T of a frame

// True iff the ULA is asserting INT at frame-relative T-state `t`. Works for any
// integer t (negative or beyond one frame) by reducing modulo the frame length.
export function interruptActive(t) {
  const f = ((t % FRAME_T_STATES) + FRAME_T_STATES) % FRAME_T_STATES;
  return f < INTERRUPT_T_STATES;
}

// --- Memory contention (ULA-TIME-CONTENDED-ADDR-001 / -PATTERN / -WINDOW) -----
export const CONTENDED_LOW = 0x4000;
export const CONTENDED_HIGH = 0x7fff;

// Only the lower 16K RAM is contended on a 48K machine.
export function isContendedAddress(address) {
  const a = address & 0xffff;
  return a >= CONTENDED_LOW && a <= CONTENDED_HIGH;
}

// The repeating period-8 delay pattern applied during the display fetch window.
export const CONTENTION_PATTERN = [6, 5, 4, 3, 2, 1, 0, 0];

// Canonical 48K early-timing geometry (pinned per ADR-0010).
export const CONTENTION_START_T = 14335; // first contended frame T-state
export const DISPLAY_LINES = 192; // contended display lines
export const CONTENDED_T_PER_LINE = 128; // contended T-states at the start of each line

// Extra T-states the ULA adds to a CONTENDED-RAM access that begins at frame
// T-state `t`. Returns 0 outside the display fetch window (border, retrace, and
// any access to uncontended memory must use isContendedAddress() first). The
// caller is responsible for only applying this to contended addresses.
export function contentionDelay(t) {
  const f = ((t % FRAME_T_STATES) + FRAME_T_STATES) % FRAME_T_STATES;
  const offset = f - CONTENTION_START_T;
  if (offset < 0) return 0; // before the first display line
  const line = Math.floor(offset / T_STATES_PER_LINE);
  if (line >= DISPLAY_LINES) return 0; // after the last display line
  const column = offset % T_STATES_PER_LINE;
  if (column >= CONTENDED_T_PER_LINE) return 0; // border + horizontal retrace
  return CONTENTION_PATTERN[column % CONTENTION_PATTERN.length];
}
