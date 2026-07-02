// @zx-vibes/ula — regenerated 48K ZX Spectrum Kempston joystick interface read model,
// authored from the project DNA (dna/domain/peripherals.md "Kempston joystick",
// JOY-KEMPSTON-*) and decided by the peripherals conformance fixtures
// (dna/conformance/peripherals/kempston.json).
//
// The Kempston interface is an EXTERNAL peripheral, not part of the ULA; it is modeled
// in @zx-vibes/ula beside the floating-bus model because both resolve an `IN` from the
// I/O bus, and the Kempston port decode is precisely what carves port 0x1F out of the
// floating odd-port set (ula-timing.mjs portFloats / ula-timing.md ULA-FLOATBUS-PORT-001).
//
// Scope (decision:ADR-0021, which ratified F1 as "port 0x1F active-high 000FUDLR"):
// the bit layout + active-high read at the canonical port are pinned hardware. The
// interface decodes the LOW address byte (the high byte — register B of `IN A,(C)` —
// is don't-care); finer incomplete decoding (clones that alias 0x1F across any A5=0
// port) is interface-specific and out of scope.

// The canonical Kempston joystick port (low byte). Reads return the button state.
export const KEMPSTON_PORT = 0x1f;

// Active-high button bit masks in the read byte `000FUDLR` (bits 7-5 are always 0).
export const KEMPSTON_RIGHT = 0x01; // bit 0
export const KEMPSTON_LEFT = 0x02; // bit 1
export const KEMPSTON_DOWN = 0x04; // bit 2
export const KEMPSTON_UP = 0x08; // bit 3
export const KEMPSTON_FIRE = 0x10; // bit 4

// JOY-KEMPSTON-PORT-001: true iff `port` addresses the Kempston interface. The
// canonical decode is low byte 0x1F; the high address byte is don't-care, so any port
// whose low 8 bits are 0x1F reads the joystick. Finer A5-only aliasing is out of scope.
export function kempstonDecodes(port) {
  return (port & 0x00ff) === KEMPSTON_PORT;
}

// JOY-KEMPSTON-READ-001: map a joystick button state to the active-high read byte
// `000FUDLR`. Each pressed control sets its bit; the unused top three bits are always
// 0; idle (nothing pressed) reads 0x00. An absent/false field is "not pressed". The
// five controls are independent — the hardware imposes no interlock, so the model does
// not mask the physically-impossible Left+Right / Up+Down; it returns the OR of the
// pressed bits exactly.
export function kempstonByte(state = {}) {
  let byte = 0;
  if (state.right) byte |= KEMPSTON_RIGHT;
  if (state.left) byte |= KEMPSTON_LEFT;
  if (state.down) byte |= KEMPSTON_DOWN;
  if (state.up) byte |= KEMPSTON_UP;
  if (state.fire) byte |= KEMPSTON_FIRE;
  return byte;
}
