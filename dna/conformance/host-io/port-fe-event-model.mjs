#!/usr/bin/env node
// Reference port-0xFE event extractor, authored straight from
// dna/domain/host-io-port-fe.md (HOST-IO-PORTFE-WRITE-BITS-001 / -BORDER-001 /
// -BEEPER-001 / -EVENT-ORDER-001).
//
// Given a chronological sequence of OUT (0xFE) writes `{ tFrame, value }`, derive
// the ordered border/beeper event stream a host renderer consumes:
//   border event  { tFrame, kind: "border", value: colour }  on a b0-2 change
//   beeper event  { tFrame, kind: "beeper", level }           on a b4 change
//
// This is the conformance MODEL for the host-I/O event surface until a host-I/O
// package is regenerated (the same role @zx-vibes/ula plays for the timing
// fixtures). It is the default `--module` of run-host-io-fixtures.mjs; the fixture
// is the authority and the self-test's collapse-negative proves the gate's teeth.

export const BORDER_MASK = 0x07;
export const MIC_BIT = 0x08;
export const SPEAKER_BIT = 0x10;

// ULA-TIME-FRAME-001 (312 * 224). Re-declared here (as the timing self-test does)
// so the event-time helpers below are standalone; it is the same canonical value.
export const FRAME_T_STATES = 69888;

// initialBorder: null => the first write always emits its colour (the border has
// no assumed power-on default). initialBeeper: 0 => the speaker rest level, so a
// first write with b4 = 0 emits no edge. Per write, the border event is emitted
// before the beeper event (HOST-IO-PORTFE-EVENT-ORDER-001).
export function extractPortFeEvents(writes, { initialBorder = null, initialBeeper = 0 } = {}) {
  const events = [];
  let border = initialBorder;
  let beeper = initialBeeper;
  for (const write of writes ?? []) {
    const tFrame = write.tFrame;
    const value = write.value & 0xff;
    const colour = value & BORDER_MASK;
    const level = value & SPEAKER_BIT ? 1 : 0;
    if (colour !== border) {
      events.push({ tFrame, kind: "border", value: colour });
      border = colour;
    }
    if (level !== beeper) {
      events.push({ tFrame, kind: "beeper", level });
      beeper = level;
    }
  }
  return events;
}

// S2 (R-W8-02) — event timestamp semantics (HOST-IO-PORTFE-EVENT-CHRONO-001).
//
// The audio/event timestamp is a CHRONOLOGICAL frame-relative offset from the
// start of the runFrame call: a monotonically increasing value, so edges never
// reorder when the contended-machine clock crosses a frame boundary (C7). It is
// the absolute machine clock at the I/O cycle minus the clock at runFrame start.
export function chronologicalOffset(clock, frameStart) {
  return clock - frameStart;
}

// The DISPLAY raster position is the ULA-frame T-state, taken modulo the frame
// length (used by the raster renderer, S4 — NOT the audio/event stream). Sorting
// the event stream by this modulo value is the C7 bug: it reorders edges that
// straddle the frame wrap once the machine clock has drifted off zero.
export function ulaFrameTState(clock) {
  return ((clock % FRAME_T_STATES) + FRAME_T_STATES) % FRAME_T_STATES;
}

// Extract the chronological event stream from one runFrame's port-0xFE writes.
// Each write carries its ABSOLUTE machine clock (monotonic across the frame wrap);
// its event tFrame is the chronological offset from frameStart. Border/beeper
// change semantics are exactly the S1 model, so the stream stays in chronological
// order even when the absolute clock exceeds FRAME_T_STATES (C7).
export function extractFrameEvents(writes, { frameStart = 0, initialBorder = null, initialBeeper = 0 } = {}) {
  const timed = (writes ?? []).map((write) => ({
    tFrame: chronologicalOffset(write.clock, frameStart),
    value: write.value,
  }));
  return extractPortFeEvents(timed, { initialBorder, initialBeeper });
}
