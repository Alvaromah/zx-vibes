// Regenerated ROM tape edge-loading model, authored from the project DNA
// (dna/domain/tape-loading.md "Edge loading" + dna/domain/host-io-port-fe.md
// HOST-IO-PORTFE-READ-BITS-001) and decided by the tape edge-load conformance
// fixtures (dna/conformance/tape/edge-load.json). The opaque 48K ROM LD-BYTES
// routine (0x0556, memory-map.md MM-ROM-ARTIFACT-001 / ADR-0024) consumes the W10.9
// EAR pulse stream (tape-pulses.mjs blockToPulses) on port 0xFE bit 6 and loads a
// tape block byte-for-byte into RAM. This lives beside the .tap/.tzx codecs and the
// pulse encoder, since the same machine loads the tape.
import { FRAME_T_STATES } from "@zx-vibes/ula";

// The ROM tape-load entry point. The DNA references ONLY this address of the opaque
// ROM (ADR-0024); no other ROM routine is documented.
export const LD_BYTES_ENTRY = 0x0556;

// Z80 F-register carry bit (TAPE-EDGE-LDBYTES-001: CARRY set on entry = LOAD).
const CARRY = 0x01;

// A generous default ceiling so a wrong register setup or a broken deck can never
// hang: a full data block is ~7M T-states of leader; 50M T covers a large block with
// headroom. Exceeding the budget is a load failure, never a spin (risk guard).
const DEFAULT_T_STATE_BUDGET = 50_000_000;

// Stack the loader runs on (high RAM, clear of a 0x4000+ destination). LD-BYTES pushes
// its own SA/LD-RET return plus a couple of saves; this leaves ample room below.
const STACK_TOP = 0xff58;

// A return address the ROM never sets PC to during a load; pushed as the sentinel so
// the loader's final RET lands here and the run loop stops (TAPE-EDGE-LDBYTES-001).
const DEFAULT_SENTINEL = 0x7fff;

// TAPE-EDGE-TRAILING-001: a block's data pulses end on the second pulse of the
// checksum's last bit; the loader reads each bit as one full period (two edges), so the
// FINAL bit needs a closing edge AFTER the last pulse. On a real tape that edge is the
// leading transition of the inter-block pause (TZX 0x20). `edgeLoad` therefore appends one
// trailing pulse — a ~1 ms pause segment (3500 T at 3.5 MHz) — so the line transitions
// once after the block and the loader detects the end of the final bit. Its exact length
// is not load-bearing (any closing edge works); only that the transition occurs.
const TRAILING_EDGE_PULSE_T = 3500;

// TAPE-EDGE-DECK-001 / HOST-IO-PORTFE-READ-BITS-001: a "tape deck" implementing the
// machine `io` contract { read(port), write(port, value) }. On a port-0xFE read (ULA:
// address bit A0 = 0) it returns the keyboard/idle byte with bit 6 driven from the tape
// level at the current tape clock. The deck holds the pulse list and a MONOTONIC tape
// T-state cursor (supplied by `clock`); the level toggles at every pulse boundary from a
// fixed start convention. Once the cursor runs past the last pulse the tape is silent and
// bit 6 falls back to the issue-3 idle rule: it tracks the last bit-4 (speaker/EAR-out)
// written to port 0xFE.
export function createTapeDeck(pulses, { clock, startLevel = 0, keyboard = 0x1f } = {}) {
  if (typeof clock !== "function") {
    throw new Error("createTapeDeck: a clock() returning the tape T-state cursor is required");
  }
  const durations = pulses instanceof Uint16Array || pulses instanceof Array ? pulses : Array.from(pulses ?? []);
  // ends[i] = cumulative T-state at which pulse i finishes; pulse i spans [ends[i-1], ends[i]).
  const ends = new Array(durations.length);
  let acc = 0;
  for (let i = 0; i < durations.length; i += 1) {
    acc += durations[i];
    ends[i] = acc;
  }
  const total = acc;
  const start = startLevel & 1;
  // Issue-3 idle level (the EAR-in level when the tape is not driving the line): the last
  // value written to bit 4 of port 0xFE. Initialized to the tape's start level.
  let idleLevel = start;

  // The tape-in level at tape clock `t`. Within the stream the level is the start level
  // XOR the parity of the pulse index; past the end it is the issue-3 idle level.
  function levelAt(t) {
    if (durations.length === 0 || t >= total) return idleLevel;
    // Smallest i with ends[i] > t — the index of the pulse covering t.
    let lo = 0;
    let hi = ends.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] > t) hi = mid;
      else lo = mid + 1;
    }
    return (start ^ (lo & 1)) & 1;
  }

  return {
    levelAt,
    total,
    read(port) {
      // Only the ULA (even port, A0 = 0) answers; other ports float high.
      if ((port & 0x01) !== 0) return 0xff;
      const level = levelAt(clock());
      // HOST-IO-PORTFE-READ-BITS-001: b0–b4 keyboard (1 = released), b5/b7 = 1 (unused),
      // b6 = EAR/tape-in level.
      return ((keyboard & 0x1f) | 0xa0 | (level ? 0x40 : 0x00)) & 0xff;
    },
    write(port, value) {
      // Issue-3 idle rule: bit 6 idles at the last bit-4 (EAR-out) written to port 0xFE.
      if ((port & 0x01) === 0) idleLevel = (value >> 4) & 1;
    },
  };
}

// TAPE-EDGE-LDBYTES-001: set up the LD-BYTES register contract on `machine`, push the
// sentinel return, and run the machine instruction-by-instruction until PC returns to the
// sentinel (success/failure) or the T-state budget is hit. `deck` (already the machine's
// io) supplies the tape edge stream. Returns { ok, reason, bytesLoaded, tStates }; ok is
// the CARRY flag the ROM reports (set = the block loaded and its checksum verified).
export function edgeLoadWithDeck(machine, deck, { ix, de, flag, load = true, tStateBudget = DEFAULT_T_STATE_BUDGET, sentinel = DEFAULT_SENTINEL } = {}) {
  if (typeof ix !== "number" || typeof de !== "number" || typeof flag !== "number") {
    throw new Error("edgeLoadWithDeck: ix, de and flag are required numbers");
  }
  machine.io = deck;
  const reg = machine.registers;
  // Entry contract: A = expected flag byte, CARRY set = LOAD (reset = VERIFY). LD-BYTES
  // moves the entry AF into AF' (EX AF,AF'); set both so the flag/carry reach AF'
  // regardless of the exchange.
  const entryF = load ? CARRY : 0;
  reg.a = flag & 0xff;
  reg.f = entryF;
  reg.a_ = flag & 0xff;
  reg.f_ = entryF;
  // IX = destination, DE = data byte count.
  reg.ixh = (ix >> 8) & 0xff;
  reg.ixl = ix & 0xff;
  reg.d = (de >> 8) & 0xff;
  reg.e = de & 0xff;
  // The ROM disables interrupts itself (DI); keep them off so the direct call is clean.
  reg.iff1 = 0;
  reg.iff2 = 0;
  // Push the sentinel return address, then enter LD-BYTES.
  machine.memory[(STACK_TOP - 1) & 0xffff] = (sentinel >> 8) & 0xff;
  machine.memory[(STACK_TOP - 2) & 0xffff] = sentinel & 0xff;
  reg.sp = (STACK_TOP - 2) & 0xffff;
  reg.pc = LD_BYTES_ENTRY;

  const startRun = machine.tStatesTotal;
  while ((machine.registers.pc & 0xffff) !== (sentinel & 0xffff)) {
    if (machine.tStatesTotal - startRun > tStateBudget) {
      return { ok: false, reason: "budget", bytesLoaded: 0, tStates: machine.tStatesTotal - startRun };
    }
    machine.stepInstruction();
  }
  const ok = Boolean(machine.registers.f & CARRY);
  const deLeft = ((machine.registers.d & 0xff) << 8) | (machine.registers.e & 0xff);
  return {
    ok,
    reason: ok ? "ok" : "load-error",
    bytesLoaded: (de - deLeft) & 0xffff,
    tStates: machine.tStatesTotal - startRun,
  };
}

// TAPE-EDGE-LOAD-001: the convenience entry. Build the standard tape deck (a MONOTONIC
// tape cursor that advances with the machine's executed T-states — not a frame-modulo
// position, which would lose edges across a frame wrap) over `pulses`, wire it as the
// machine's io, and drive LD-BYTES. `pulses` is the EAR pulse stream of a single block
// body (blockToPulses); `de` is the data byte count (the body length minus the flag and
// checksum), `flag` the block's flag byte, `ix` the RAM destination.
export function edgeLoad(machine, pulses, { ix, de, flag, load = true, tStateBudget = DEFAULT_T_STATE_BUDGET, sentinel = DEFAULT_SENTINEL, startLevel = 0, keyboard = 0x1f, trailingPulse = TRAILING_EDGE_PULSE_T } = {}) {
  const startT = machine.tStatesTotal;
  // Append the closing edge (TAPE-EDGE-TRAILING-001) so the final bit terminates.
  const base = pulses instanceof Array ? pulses : Array.from(pulses ?? []);
  const playable = trailingPulse ? [...base, trailingPulse] : base;
  const deck = createTapeDeck(playable, {
    clock: () => machine.tStatesTotal - startT,
    startLevel,
    keyboard,
  });
  return edgeLoadWithDeck(machine, deck, { ix, de, flag, load, tStateBudget, sentinel });
}

// TAPE-INSTANT-LOAD-001: the instant (a.k.a. trap / flash) loader. A consumer convenience
// that reproduces the OBSERVABLE result of `edgeLoad` (the real ROM `LD-BYTES`) for the same
// tape block WITHOUT executing the ROM or simulating the pulse stream — it traps the load and
// writes the block's data bytes straight to RAM. Its whole correctness criterion is
// `instant == edge` for the same `.tap` block (TAPE-INSTANT-EQUIV-001): a mutual cross-check
// against the real ROM, fabrication-free. `body` is the full block body
// `[flag, ...data, checksum]` (the same input `blockToPulses` takes); `ix`/`de`/`flag` are
// the LD-BYTES register contract (TAPE-EDGE-LDBYTES-001): IX = destination, DE = data byte
// count, A = expected flag. Returns `{ ok, reason, bytesLoaded, tStates }` with `tStates = 0`
// (instant — no machine time elapses). Only the OBSERVABLE triplet — `ok` (the CARRY result),
// `bytesLoaded`, and the bytes written to RAM — is the contract and matches `edgeLoad`; the
// `reason` string is the instant loader's own diagnosis and is NOT part of the contract (the
// real ROM may instead time out or report a generic load error for the same failure).
export function instantLoad(machine, body, { ix, de, flag, load = true } = {}) {
  if (typeof ix !== "number" || typeof de !== "number" || typeof flag !== "number") {
    throw new Error("instantLoad: ix, de and flag are required numbers");
  }
  const bytes = body instanceof Uint8Array || Array.isArray(body) ? body : Array.from(body ?? []);
  const expectedFlag = flag & 0xff;
  const dest = ix & 0xffff;
  const want = de & 0xffff;
  // The block body is [flag][data…][checksum]; a body shorter than 2 bytes has no checksum.
  if (bytes.length < 2) {
    return { ok: false, reason: "empty", bytesLoaded: 0, tStates: 0 };
  }
  const blockFlag = bytes[0] & 0xff;
  // TAPE-INSTANT-FLAG-001: LD-BYTES compares the flag byte BEFORE storing any data; on a flag
  // mismatch it returns failure with NOTHING written (verified against the real ROM: a
  // mismatched edge-load leaves the destination RAM untouched and returns carry reset).
  if (blockFlag !== expectedFlag) {
    return { ok: false, reason: "flag-mismatch", bytesLoaded: 0, tStates: 0 };
  }
  // Data bytes present in the block body (everything between the flag and the final checksum).
  const dataAvailable = bytes.length - 2;
  const n = Math.min(want, Math.max(0, dataAvailable));
  // TAPE-INSTANT-LOAD-001 / TAPE-INSTANT-CHECKSUM-001: store the DE data bytes (the flag and
  // checksum are NOT stored, TAPE-EDGE-LDBYTES-001) while accumulating the running XOR parity
  // over the flag + the data bytes + the checksum byte read after them
  // (file-formats.md FMT-TAP-CHECKSUM-001). CARRY/ok is set iff the parity is zero.
  let parity = blockFlag;
  for (let i = 0; i < n; i += 1) {
    const value = bytes[1 + i] & 0xff;
    if (load) machine.memory[(dest + i) & 0xffff] = value;
    parity ^= value;
  }
  // The byte LD-BYTES reads as the checksum after exactly DE data bytes.
  parity ^= bytes[1 + want] & 0xff;
  const ok = parity === 0;
  return { ok, reason: ok ? "ok" : "checksum-error", bytesLoaded: n, tStates: 0 };
}

// Re-exported so a regeneration / self-test can build a frame-modulo (broken) tape clock
// to prove the monotonic cursor is load-bearing (TAPE-EDGE-DECK-001).
export { FRAME_T_STATES };
