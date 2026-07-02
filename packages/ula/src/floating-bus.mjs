// Regenerated 48K ZX Spectrum floating-bus read model, authored from the project
// DNA (dna/domain/ula-timing.md "Floating bus", ULA-FLOATBUS-*) and decided by the
// floating-bus conformance fixtures (dna/conformance/timing/floating-bus.json).
//
// Scope (decision:ADR-0026, refining ADR-0021's E2 assumption): the port-decode
// precondition and the idle-bus value are pinned hardware facts; the timing-exact
// IN-window byte depends on the deferred active-area pixel timing (A5, ADR-0021)
// and is reported as UNMODELLED — never fabricated. The active-fetch window is the
// contended display window of ula-timing.mjs (anchor 14335), NOT the legacy 14384.
import {
  FRAME_T_STATES,
  T_STATES_PER_LINE,
  CONTENTION_START_T,
  DISPLAY_LINES,
  CONTENDED_T_PER_LINE,
} from "./ula-timing.mjs";

// The value an undriven (floating) bus reads outside the display fetch: the data
// lines float high (ULA-FLOATBUS-IDLE-001).
export const FLOATING_BUS_IDLE = 0xff;

// ULA-FLOATBUS-PORT-001: the ULA decodes I/O on A0. It drives every EVEN port
// (A0 = 0) — that is the keyboard / EAR read surface (host-io-port-fe.md). An IN
// from an ODD port (A0 = 1) that no other device decodes is undriven and reads the
// floating bus. At the 48K base nothing decodes odd ports, so every odd port floats
// (the canonical floating-bus port is the odd 0xFF). A later peripheral that decodes
// an odd port (e.g. Kempston at 0x1F) carves out its own port and stops it floating.
export function portFloats(port) {
  return (port & 0x0001) === 1;
}

// True iff frame T-state `t` is inside the active display-fetch window — exactly the
// contended window of ULA-TIME-CONTENTION-WINDOW-001 (192 lines, 224 T apart, each
// starting at frame T 14335 for the first 128 T). This is the ULA display-fetch
// activity that both contends memory and drives the floating bus.
export function activeDisplayFetch(t) {
  const f = ((t % FRAME_T_STATES) + FRAME_T_STATES) % FRAME_T_STATES;
  const offset = f - CONTENTION_START_T;
  if (offset < 0) return false; // before the first display line
  const line = Math.floor(offset / T_STATES_PER_LINE);
  if (line >= DISPLAY_LINES) return false; // after the last display line
  const column = offset % T_STATES_PER_LINE;
  return column < CONTENDED_T_PER_LINE; // border + retrace are not fetches
}

// The value an IN from a floating (odd, undriven) port reads at frame T-state `t`:
//   outside the display-fetch window -> { value: 0xFF, modeled: true }
//       the idle bus floats high (ULA-FLOATBUS-IDLE-001).
//   inside  the display-fetch window -> { value: null,  modeled: false }
//       the byte is the ULA-fetched display/attribute byte (ULA-FLOATBUS-FETCH-001),
//       but the exact T->byte phase mapping is the deferred A5 timing
//       (ULA-FLOATBUS-DEFER-001) and is NOT pinned — reported unmodelled, not faked.
export function floatingBusByte(t) {
  if (activeDisplayFetch(t)) {
    return { value: null, modeled: false };
  }
  return { value: FLOATING_BUS_IDLE, modeled: true };
}
