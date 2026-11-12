// Tape autoload for the preview player: the ROM `LOAD ""` keystrokes and the
// LD-BYTES instant-load trap (toolkit-runtime.md RT-PROD-FORMATS-001: `preview
// <file>` serves a `.tap`/`.tzx` image).
//
// A BASIC-loader tape is loaded the faithful way: the player types `LOAD ""` on the
// real ROM and traps LD-BYTES (0x0556) to instant-load each block in tape order with
// the core `instantLoad` (whose correctness is `instant == edge`). Two independent
// pieces of state come out of that:
//   - the TYPING schedule, which owns the keyboard from power-on until `LOAD ""` and
//     ENTER have been typed and released, and then hands the keyboard back; and
//   - the TAPE cursor, which the trap keeps serving for as long as blocks remain —
//     a loader asks for its later blocks long after the typing is over.
//
// Pure and DOM-free: the tsup-bundled player and the Node tests share it.

import { instantLoad, LD_BYTES_ENTRY, parseTap, parseTzx, type Machine } from '@zx-vibes/machine';

// ---------------------------------------------------------------------------
// Tape blocks
// ---------------------------------------------------------------------------

/** Standard tape header type of a CODE ("Bytes:") file (file-formats.md FMT-TAP). */
export const TAPE_TYPE_CODE = 3;

/**
 * A tape image as its raw block bodies `[flag, ...data, checksum]` — the
 * `instantLoad` input. `.tzx` keeps only the blocks that carry data (standard,
 * turbo and pure-data blocks); tones, pauses and metadata carry none. Codec
 * errors (a truncated block, a bad checksum, a bad signature) propagate.
 */
export function tapeBlocks(kind: 'tap' | 'tzx', bytes: Uint8Array): Uint8Array[] {
  if (kind === 'tap') {
    return parseTap(bytes).map((b) => Uint8Array.of(b.flag & 0xff, ...b.data, b.checksum & 0xff));
  }
  const bodies: Uint8Array[] = [];
  for (const block of parseTzx(bytes).blocks) {
    if (block.data !== undefined && block.data.length >= 2) bodies.push(Uint8Array.from(block.data));
  }
  return bodies;
}

/** The fields of a standard 17-byte tape header the player needs. */
export interface StandardHeader {
  /** 0 Program, 1 Number array, 2 Character array, 3 Bytes (CODE). */
  type: number;
  /** Data block length the header announces. */
  length: number;
  /** Parameter 1: the load address of a CODE file, the autostart line of a Program. */
  param1: number;
}

/** Decode a standard header block body (flag 0x00, 17 data bytes, checksum), else null. */
export function parseStandardHeader(body: Uint8Array): StandardHeader | null {
  // body = [flag 0x00][type][name x10][length LE][param1 LE][param2 LE][checksum] = 19 bytes.
  if (body.length !== 19 || (body[0]! & 0xff) !== 0x00) return null;
  return {
    type: body[1]! & 0xff,
    length: (body[12]! & 0xff) | ((body[13]! & 0xff) << 8),
    param1: (body[14]! & 0xff) | ((body[15]! & 0xff) << 8),
  };
}

// ---------------------------------------------------------------------------
// The `LOAD ""` typing schedule
// ---------------------------------------------------------------------------

/**
 * First frame of the typing. From power-on the ROM spends ~80 frames testing RAM
 * and printing the copyright message before its editor reads keys; keys typed
 * earlier are lost (measured against the real ROM: a schedule starting at frame 60
 * keeps only one `"`, and the old frame-40 schedule typed nothing).
 */
export const AUTOTYPE_START_FRAME = 100;
/** Frames each keystroke is held — several 50 Hz scans, so the ROM always sees it. */
export const AUTOTYPE_PRESS_FRAMES = 4;
/**
 * Frames between keystrokes with every key up. The ROM only accepts a key again
 * once its KSTATE slot has been released for several interrupts, so the repeated
 * `"` needs a real gap (3 released frames still drop it).
 */
export const AUTOTYPE_RELEASE_FRAMES = 8;

/**
 * `LOAD ""` + ENTER in K mode: J is the LOAD keyword, SYMBOL SHIFT + P is `"`. It
 * opens with a lone CAPS SHIFT tap, which types nothing but primes the ROM's key
 * debounce so the first real keystroke cannot be swallowed (the demos do the same).
 */
export const LOAD_KEYSTROKES: readonly (readonly string[])[] = [
  ['CAPS_SHIFT'],
  ['J'],
  ['SYMBOL_SHIFT', 'P'],
  ['SYMBOL_SHIFT', 'P'],
  ['ENTER'],
];

/** One keystroke: `keys` are held for frames `from` (inclusive) to `to` (exclusive). */
export interface AutotypeStep {
  from: number;
  to: number;
  keys: readonly string[];
}

/** A typing schedule in frames since power-on; it ends, keys released, at `end`. */
export interface AutotypeSchedule {
  steps: readonly AutotypeStep[];
  end: number;
}

/** The `LOAD ""` schedule: each keystroke held, then every key released, in turn. */
export function loadTypeSchedule(
  keystrokes: readonly (readonly string[])[] = LOAD_KEYSTROKES,
  start: number = AUTOTYPE_START_FRAME,
): AutotypeSchedule {
  const steps: AutotypeStep[] = [];
  let frame = start;
  for (const keys of keystrokes) {
    steps.push({ from: frame, to: frame + AUTOTYPE_PRESS_FRAMES, keys });
    frame += AUTOTYPE_PRESS_FRAMES + AUTOTYPE_RELEASE_FRAMES;
  }
  return { steps, end: frame };
}

/** The keys the schedule holds down at `frame` (none in the gaps and once it ended). */
export function scheduledKeys(schedule: AutotypeSchedule, frame: number): readonly string[] {
  for (const step of schedule.steps) {
    if (frame >= step.from && frame < step.to) return step.keys;
  }
  return [];
}

// ---------------------------------------------------------------------------
// The LD-BYTES trap
// ---------------------------------------------------------------------------

/** The tape in the deck: its block bodies and the next block the "tape" will play. */
export interface TapeCursor {
  blocks: Uint8Array[];
  next: number;
}

/** The outcome of one trapped LD-BYTES call (for the player's status line). */
export interface LdBytesServed {
  ok: boolean;
  /** Blocks left on the tape after this one. */
  remaining: number;
}

/**
 * Restore the LD-BYTES caller contract after an instant-loaded block: IX advanced
 * by the bytes loaded, DE the remainder, CARRY = ok, then the routine's RET (pop the
 * return address). This is the OBSERVABLE result of the real ROM LD-BYTES (0x0556)
 * for the block, via the documented `instantLoad` seam — no ROM bytes are fabricated.
 */
export function ldBytesReturn(
  m: Machine,
  result: { ok: boolean; bytesLoaded: number },
  ix: number,
  de: number,
): void {
  const loaded = result.bytesLoaded | 0;
  const newIx = (ix + loaded) & 0xffff;
  m.registers.ixh = (newIx >> 8) & 0xff;
  m.registers.ixl = newIx & 0xff;
  const newDe = (de - loaded) & 0xffff;
  m.registers.d = (newDe >> 8) & 0xff;
  m.registers.e = newDe & 0xff;
  m.registers.f = ((m.registers.f ?? 0) & ~0x01) | (result.ok ? 0x01 : 0x00);
  const sp = (m.registers.sp ?? 0) & 0xffff;
  const lo = m.memory[sp]! & 0xff;
  const hi = m.memory[(sp + 1) & 0xffff]! & 0xff;
  m.registers.pc = (hi << 8) | lo;
  m.registers.sp = (sp + 2) & 0xffff;
}

/**
 * The per-instruction trap that plays `tape` into the ROM's LD-BYTES. On entry
 * (PC = 0x0556) it takes the next block off the tape and instant-loads it with the
 * ROM's own register contract: IX = destination, DE = length, A = expected flag,
 * CARRY = LOAD (set) or VERIFY (reset).
 *
 * Like a real tape, a block is consumed whether or not it matches: on a flag
 * mismatch LD-BYTES returns failure with nothing written and the tape has moved
 * on, so the ROM's header search skips a data block it did not ask for instead of
 * retrying it forever. Once the tape has run out the trap stands aside and the real
 * LD-BYTES runs: it waits for a signal that never comes, exactly like a machine
 * with an empty deck, and BREAK (CAPS SHIFT + SPACE) gets out of it.
 */
export function createLdBytesTrap(
  tape: TapeCursor,
  onBlock?: (served: LdBytesServed) => void,
): (m: Machine) => void {
  return (m) => {
    if (((m.registers.pc ?? 0) & 0xffff) !== LD_BYTES_ENTRY) return;
    if (tape.next >= tape.blocks.length) return; // tape over: the real ROM waits
    const r = m.registers;
    const ix = (((r.ixh ?? 0) & 0xff) << 8) | ((r.ixl ?? 0) & 0xff);
    const de = (((r.d ?? 0) & 0xff) << 8) | ((r.e ?? 0) & 0xff);
    const flag = (r.a ?? 0) & 0xff;
    const load = ((r.f ?? 0) & 0x01) === 0x01;
    const body = tape.blocks[tape.next]!;
    tape.next += 1;
    const result = instantLoad(m, body, { ix, de, flag, load });
    ldBytesReturn(m, result, ix, de);
    onBlock?.({ ok: result.ok, remaining: tape.blocks.length - tape.next });
  };
}
