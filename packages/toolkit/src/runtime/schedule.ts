// Scheduled input plans — keyboard (`--keys`) and Kempston joystick (`--joy`).
//
// Grammar (cli.md CLI-PROD-RUN-004 / -005, recipes-and-assertions.md
// REC-PROD-SPEC-004/005): a comma-separated list of `frame:TOKEN*hold` events,
// `hold` defaulting to 3 frames, the frame relative to the run's start frame. A
// key event presses one Spectrum key for its hold window; a joy event drives the
// Kempston byte for its hold window. The realized (parsed) plan is reported back
// in the run envelope (RT-PROD-RUN-004).
//
// The keyboard read is the 48K matrix (keyboard-input.md KBD-MATRIX-001 /
// host-io-port-fe.md HOST-IO-PORTFE-READ-001/-READ-BITS-001): `IN (0xFE)` returns
// the half-rows selected by the port high byte, key bits active-low, ANDed across
// selected rows. The Kempston byte is the active-high `000FUDLR` on port `0x1F`
// (peripherals.md JOY-KEMPSTON-READ-001), built via the core `kempstonByte`.

import { kempstonByte } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';

/** Default key/joy hold in frames when a `*hold` is omitted (CLI-PROD-INPUT-001). */
export const DEFAULT_HOLD = 3;

/** A realized scheduled key press (CLI-PROD-RUN-004). */
export interface KeyEvent {
  /** Run-relative frame the press begins on. */
  frame: number;
  /** The canonical Spectrum key name (e.g. `O`, `SPACE`, `CAPS_SHIFT`). */
  key: string;
  /** Hold length in frames (≥ 1). */
  hold: number;
}

/** A realized scheduled Kempston event (CLI-PROD-RUN-005). */
export interface JoyEvent {
  frame: number;
  /** The normalized control subset (e.g. `R`, `RF`, `UL`). */
  value: string;
  hold: number;
  /** The active-high `000FUDLR` byte this value drives on port `0x1F`. */
  byte: number;
}

// The 48K keyboard matrix (KBD-MATRIX-001): canonical key name → [row, bit].
// Row r is selected when high-byte bit r is LOW; key bits are active-low on b0–b4
// (outermost key = b0). Aliases are normalized in `normalizeKeyToken`.
const KEY_MATRIX: Readonly<Record<string, readonly [number, number]>> = {
  CAPS_SHIFT: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  '1': [3, 0], '2': [3, 1], '3': [3, 2], '4': [3, 3], '5': [3, 4],
  '0': [4, 0], '9': [4, 1], '8': [4, 2], '7': [4, 3], '6': [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYMBOL_SHIFT: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};

// Accepted aliases for the two shift keys (CLI-PROD-INPUT-001 names + common forms).
const KEY_ALIASES: Readonly<Record<string, string>> = {
  CAPSSHIFT: 'CAPS_SHIFT', CS: 'CAPS_SHIFT', CAPS: 'CAPS_SHIFT',
  SYMBOLSHIFT: 'SYMBOL_SHIFT', SYMSHIFT: 'SYMBOL_SHIFT', SS: 'SYMBOL_SHIFT', SYMBOL: 'SYMBOL_SHIFT',
};

/** Normalize a key token to its canonical matrix name (case-insensitive, alias-folded). */
export function normalizeKeyToken(token: string): string {
  const upper = token.trim().toUpperCase();
  return KEY_ALIASES[upper] ?? upper;
}

const EVENT_RE = /^(\d+):([A-Za-z0-9_]+)(?:\*(\d+))?$/;

/** Parse one `frame:TOKEN*hold` event, returning the frame/token/hold parts. */
function parseEvent(entry: string, stage: string): { frame: number; token: string; hold: number } {
  const match = EVENT_RE.exec(entry.trim());
  if (!match) {
    throw userError(`Invalid input schedule entry: "${entry}" (expected frame:TOKEN*hold)`, stage);
  }
  const frame = Number(match[1]);
  const token = match[2]!;
  // A `*0` (or omitted) hold collapses to ≥ 1 frame so a scheduled tap is always
  // visible to at least one keyboard scan (the frame-quantized analogue of the
  // quick-tap latch, keyboard-input.md KBD-LATCH-001).
  const hold = match[3] !== undefined ? Math.max(1, Number(match[3])) : DEFAULT_HOLD;
  return { frame, token, hold };
}

/** Parse a `--keys` schedule (CLI-PROD-RUN-004). An empty/undefined spec is no events. */
export function parseKeySchedule(spec: string | undefined): KeyEvent[] {
  if (!spec || spec.trim() === '') return [];
  return spec.split(',').map((entry) => {
    const { frame, token, hold } = parseEvent(entry, 'run');
    const key = normalizeKeyToken(token);
    if (!(key in KEY_MATRIX)) {
      throw userError(`Unknown key in --keys schedule: "${token}"`, 'run');
    }
    return { frame, key, hold };
  });
}

const JOY_BITS: Readonly<Record<string, keyof import('@zx-vibes/machine').KempstonState>> = {
  U: 'up', D: 'down', L: 'left', R: 'right', F: 'fire',
};

/** Build the active-high `000FUDLR` byte from a control subset like `RF` (JOY-KEMPSTON-READ-001). */
export function joyByte(value: string): number {
  const state: import('@zx-vibes/machine').KempstonState = {};
  for (const ch of value.toUpperCase()) {
    const field = JOY_BITS[ch];
    if (!field) throw userError(`Unknown Kempston control "${ch}" in --joy (use any of U D L R F)`, 'run');
    state[field] = true;
  }
  return kempstonByte(state);
}

/** Parse a `--joy` schedule (CLI-PROD-RUN-005). An empty/undefined spec is no events. */
export function parseJoySchedule(spec: string | undefined): JoyEvent[] {
  if (!spec || spec.trim() === '') return [];
  return spec.split(',').map((entry) => {
    const { frame, token, hold } = parseEvent(entry, 'run');
    const value = token.toUpperCase();
    return { frame, value, hold, byte: joyByte(value) };
  });
}

/** The set of keys held on a given run-relative frame (KBD-LATCH-001, frame-quantized). */
export function keysPressedAt(events: readonly KeyEvent[], frame: number): Set<string> {
  const pressed = new Set<string>();
  for (const event of events) {
    if (frame >= event.frame && frame < event.frame + event.hold) pressed.add(event.key);
  }
  return pressed;
}

/** The Kempston byte driven on a given run-relative frame (OR of all active events). */
export function joyByteAt(events: readonly JoyEvent[], frame: number): number {
  let byte = 0;
  for (const event of events) {
    if (frame >= event.frame && frame < event.frame + event.hold) byte |= event.byte;
  }
  return byte & 0xff;
}

/** The first frame after the last scheduled event ends — the run's minimum length. */
export function planFrames(keys: readonly KeyEvent[], joy: readonly JoyEvent[]): number {
  let last = 0;
  for (const event of keys) last = Math.max(last, event.frame + event.hold);
  for (const event of joy) last = Math.max(last, event.frame + event.hold);
  return last;
}

/**
 * Compute the `IN (0xFE)` byte for a set of pressed keys and a port high byte
 * (KBD-MATRIX-001 / HOST-IO-PORTFE-READ-BITS-001): key bits b0–b4 active-low,
 * ANDed across the half-rows the high byte selects (bit r LOW = row r selected);
 * b5/b7 read `1`; b6 is the EAR-in idle level (issue-3: it tracks the last b4
 * written, HOST-IO-PORTFE-EARIN-IDLE-001).
 */
export function keyboardByte(pressed: ReadonlySet<string>, highByte: number, earLevel: number): number {
  let keyBits = 0x1f;
  for (let row = 0; row < 8; row += 1) {
    if ((highByte & (1 << row)) !== 0) continue; // row not selected
    let rowMask = 0x1f;
    for (const key of pressed) {
      const cell = KEY_MATRIX[key];
      if (cell && cell[0] === row) rowMask &= ~(1 << cell[1]) & 0x1f;
    }
    keyBits &= rowMask;
  }
  return (keyBits & 0x1f) | 0x20 | 0x80 | (earLevel ? 0x40 : 0);
}
