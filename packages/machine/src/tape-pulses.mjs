// Regenerated ROM tape-encoding model, authored from the project DNA
// (dna/domain/tape-loading.md "The EAR pulse stream") and decided by the tape
// conformance fixtures (dna/conformance/tape/tape-pulses.json). A tape block body
// ([flag][data…][checksum]) is transmitted as a sequence of EAR pulses (durations in
// Z80 T-states; the tape-in line, port 0xFE bit 6, toggles each pulse): a pilot tone,
// a sync pair, then each byte MSB-first as two pulses per bit. Same machine loads the
// tape, so this lives beside the .tap/.tzx codecs.

// TAPE-PULSE-TIMINGS-001 / TAPE-PULSE-PILOT-001: fixed pulse durations (T-states at
// 3.5 MHz), identical to the TZX v1.20 turbo-block defaults.
export const PILOT_PULSE_T = 2168;
export const PILOT_PULSES_HEADER = 8063; // flag < 0x80 (~5 s leader)
export const PILOT_PULSES_DATA = 3223; // flag >= 0x80 (~2 s leader)
export const SYNC1_T = 667;
export const SYNC2_T = 735;
export const BIT0_PULSE_T = 855;
export const BIT1_PULSE_T = 1710;

const HEADER_FLAG_MAX = 0x80; // flag < 0x80 => header pilot length

// TAPE-PULSE-DATA-001: one byte -> 16 pulses, most-significant bit first; a 0 bit is
// two 855 T pulses, a 1 bit is two 1710 T pulses.
export function bytePulses(byte) {
  const pulses = [];
  for (let bit = 7; bit >= 0; bit -= 1) {
    const length = (byte >> bit) & 1 ? BIT1_PULSE_T : BIT0_PULSE_T;
    pulses.push(length, length);
  }
  return pulses;
}

// TAPE-PULSE-BLOCK-001: full pulse list for a block body. `bytes` is the on-tape body
// [flag, ...data, checksum]. Pilot count is chosen by the flag (bytes[0]); then sync1,
// sync2, then each byte's data pulses.
export function blockToPulses(bytes) {
  const body = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (body.length === 0) {
    throw new Error("blockToPulses: empty block body (need at least a flag byte)");
  }
  const flag = body[0] & 0xff;
  const pilotCount = flag < HEADER_FLAG_MAX ? PILOT_PULSES_HEADER : PILOT_PULSES_DATA;

  const pulses = new Array(pilotCount + 2 + body.length * 16);
  let i = 0;
  // TAPE-PULSE-PILOT-001: pilot tone.
  for (let p = 0; p < pilotCount; p += 1) pulses[i++] = PILOT_PULSE_T;
  // TAPE-PULSE-SYNC-001: the sync pair, in order.
  pulses[i++] = SYNC1_T;
  pulses[i++] = SYNC2_T;
  // TAPE-PULSE-DATA-001: every body byte, MSB first.
  for (let b = 0; b < body.length; b += 1) {
    const byte = body[b] & 0xff;
    for (let bit = 7; bit >= 0; bit -= 1) {
      const length = (byte >> bit) & 1 ? BIT1_PULSE_T : BIT0_PULSE_T;
      pulses[i++] = length;
      pulses[i++] = length;
    }
  }
  return pulses;
}
