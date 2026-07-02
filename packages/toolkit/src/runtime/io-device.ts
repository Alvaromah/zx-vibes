// Host I/O device — the toolkit's observable port surface over `@zx-vibes/machine`.
//
// `@zx-vibes/machine` drives every IN/OUT through a settable `io` object
// (`{ read(port), write(port, value) }`) that the CPU's `step()` calls at the I/O
// bus cycle (host-io-port-fe.md HOST-IO-PORTFE-EVENT-TIME-001). The default machine
// `io` drops writes; the run service installs THIS device instead, which is how the
// toolkit OBSERVES port-`0xFE` traffic:
//
//   - WRITE (RT-PROD-RUN-005, HOST-IO-PORTFE-WRITE-BITS-001): b0–b2 border colour,
//     b4 speaker/beeper level. We count beeper edges (b4 transitions,
//     HOST-IO-PORTFE-BEEPER-001), track the border (HOST-IO-PORTFE-BORDER-001), and
//     count ULA port writes (the `portFEWrites` audio stat, ASSERT-PROD-PORTFE-001).
//   - READ (KBD-MATRIX-001 / JOY-KEMPSTON-READ-001): an even port reads the keyboard
//     matrix half-rows; a port whose low byte is `0x1F` reads the active-high Kempston
//     byte; any other undriven odd port floats idle `0xFF` (ULA-FLOATBUS, idle pinned,
//     exact in-window byte deferred per ADR-0026).
//
// This is the single machine primitive that makes RUN-BEEPER-001 observable.

import { kempstonDecodes, type MachineIo } from '@zx-vibes/machine';
import { keyboardByte } from './schedule.js';

/** A beeper edge — `t` is the chronological machine clock at the write (seam for WAV). */
export interface BeeperEdge {
  /** Instruction-start machine clock (the I/O-cycle offset is deferred, HOST-IO-PORTFE-IO-OFFSET-001). */
  t: number;
  /** The b4 speaker level after the edge (0 or 1). */
  level: 0 | 1;
}

/** Border colour reported when no port-`0xFE` write set it during the run (conventional white boot border). */
export const DEFAULT_BORDER = 7;

export class HostIo implements MachineIo {
  // --- scheduled input (set per frame by the run loop) ---------------------
  private pressedKeys: ReadonlySet<string> = new Set();
  private joyValue = 0;

  // --- observed write state (host-io-port-fe.md write model) ---------------
  /** Current speaker level driving the beeper; rest level is 0 at power-on (HOST-IO-PORTFE-BEEPER-001). */
  private speakerLevel = 0;
  /** EAR-in idle level = last b4 written (issue-3, HOST-IO-PORTFE-EARIN-IDLE-001). */
  private earLevel = 0;
  /** Running border colour; `null` until the first write sets it (HOST-IO-PORTFE-BORDER-001). */
  private border: number | null = null;
  /** Instruction-start clock used to timestamp edges (set by the run loop). */
  private clockT = 0;

  /** Count of b4 transitions during the run — the contract `audio.beeperEdges` (RUN-BEEPER-001). */
  beeperEdges = 0;
  /** Total writes decoded to the ULA (even/`A0=0`) port — the `portFEWrites` stat. */
  portFEWrites = 0;
  /** Chronological beeper edge stream (seam consumed by the future WAV/PCM slice, beeper-output.md). */
  readonly edges: BeeperEdge[] = [];

  /** Drive the scheduled input for the current frame (keyboard matrix + Kempston byte). */
  setInput(pressedKeys: ReadonlySet<string>, joyByte: number): void {
    this.pressedKeys = pressedKeys;
    this.joyValue = joyByte & 0xff;
  }

  /** Advance the timestamp clock used for the next observed edge (instruction-start time). */
  setClock(t: number): void {
    this.clockT = t;
  }

  /** The border colour in effect (the cheap-eyes scalar; defaults when never written). */
  borderColor(): number {
    return this.border ?? DEFAULT_BORDER;
  }

  /** The final speaker level (0/1) at end of run. */
  speaker(): number {
    return this.speakerLevel;
  }

  read(port: number): number {
    // The ULA answers any even port (A0 = 0); `0xFE` is the canonical keyboard read
    // (HOST-IO-PORTFE-ADDR-001). The high byte selects the half-rows.
    if ((port & 0x0001) === 0) {
      return keyboardByte(this.pressedKeys, (port >> 8) & 0xff, this.earLevel);
    }
    // A fitted Kempston carves port `0x1F` (low byte) out of the floating odd ports.
    if (kempstonDecodes(port)) {
      return this.joyValue;
    }
    // Any other undriven odd port floats idle high (ULA-FLOATBUS-PORT-001 idle = 0xFF).
    return 0xff;
  }

  write(port: number, value: number): void {
    // Only the ULA (even/`A0=0`) port has a 48K side effect; odd ports (AY etc.) are
    // out of scope for the 48K base and ignored.
    if ((port & 0x0001) !== 0) return;
    this.portFEWrites += 1;
    const byte = value & 0xff;

    // Border colour (b0–b2): track the running colour; first write opens the span.
    const colour = byte & 0x07;
    if (this.border === null || colour !== this.border) this.border = colour;

    // Beeper (b4): count an edge only when the speaker level changes; the EAR-in idle
    // level follows the last b4 written (issue-3).
    const level = ((byte >> 4) & 1) as 0 | 1;
    this.earLevel = level;
    if (level !== this.speakerLevel) {
      this.speakerLevel = level;
      this.beeperEdges += 1;
      this.edges.push({ t: this.clockT, level });
    }
  }
}
