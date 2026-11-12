// Boot the preview player's machine from the served program — the ONE place that
// turns a program payload (blank / `.bin` at org / `.z80` / `.tap` / `.tzx`) into a
// machine, so the browser player and the server-side validation in ./program.ts
// decode every file with the same core codecs and fail with the same message.
//
// Every decode problem throws a plain `Error` naming it (errors.md
// ERR-PROD-NOSILENT-001): the server turns it into a USER_ERROR before serving, the
// player shows it in its status line instead of hanging on "loading…".
//
// Pure and DOM-free: no `node:` imports, so tsup can bundle it for the browser.

import { instantLoad, readZ80, type Machine } from '@zx-vibes/machine';
import { z80SnapshotProblem } from '../runtime/z80-check.js';
import {
  loadTypeSchedule,
  parseStandardHeader,
  tapeBlocks,
  TAPE_TYPE_CODE,
  type AutotypeSchedule,
  type TapeCursor,
} from './autoload.js';
import { createPreviewMachine } from './frame-step.js';

/** First RAM address: a program image must load at or above it. */
export const RAM_BASE = 0x4000;
/** One past the last address of the 64 KB map. */
const MEMORY_END = 0x10000;

/** A program the player can boot (the server's PreviewProgram kinds). */
export type PlayerProgramKind = 'blank' | 'bin' | 'z80' | 'tap' | 'tzx';

/** A booted, not yet running, player machine plus how to drive it. */
export interface BootedProgram {
  machine: Machine;
  /** Border colour in force at boot (a snapshot's own border, else white). */
  border: number;
  /** A short human status for the page. */
  status: string;
  /** Blocks still to be played into LD-BYTES, or null when nothing loads from tape. */
  tape: TapeCursor | null;
  /** The `LOAD ""` keystrokes a BASIC-loader tape needs, or null. */
  autotype: AutotypeSchedule | null;
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;

/** Why an image of `length` bytes cannot load at `org`, or undefined when it fits RAM. */
export function ramFitProblem(org: number, length: number): string | undefined {
  if (org < RAM_BASE) return `it loads at ${hex(org)}, below RAM (${hex(RAM_BASE)}) — it would overwrite the ROM`;
  if (org + length > MEMORY_END) {
    return `${length} bytes at ${hex(org)} overrun the 64K address space (the last byte would land at ${hex(org + length - 1)})`;
  }
  return undefined;
}

/** A clean 64 KB power-on image: the ROM at 0x0000-0x3FFF, RAM zeroed. */
export function bootMemory(rom: Uint8Array): Uint8Array {
  const memory = new Uint8Array(MEMORY_END);
  memory.set(rom.subarray(0, RAM_BASE), 0);
  return memory;
}

/**
 * Boot the player machine for a program. Throws an `Error` that names the problem
 * when the bytes cannot be loaded: a codec failure (truncated/corrupt `.z80`,
 * `.tap` or `.tzx`), an empty tape, an image that does not fit RAM, or a CODE
 * block the ROM loader would reject.
 */
export function bootPreviewProgram(
  kind: PlayerProgramKind,
  bytes: Uint8Array,
  org: number,
  rom: Uint8Array,
): BootedProgram {
  switch (kind) {
    case 'blank':
      return { machine: createPreviewMachine(bootMemory(rom)), border: 7, status: 'blank 48K', tape: null, autotype: null };
    case 'bin':
      return bootBin(bytes, org & 0xffff, rom);
    case 'z80':
      return bootZ80(bytes, rom);
    case 'tap':
    case 'tzx':
      return bootTape(kind, bytes, rom);
    default:
      throw new Error(`unsupported program kind "${String(kind)}"`);
  }
}

function bootBin(bytes: Uint8Array, org: number, rom: Uint8Array): BootedProgram {
  const problem = ramFitProblem(org, bytes.length);
  if (problem !== undefined) throw new Error(`the binary does not fit RAM: ${problem}`);
  const memory = bootMemory(rom);
  memory.set(bytes, org);
  const machine = createPreviewMachine(memory);
  machine.registers.pc = org;
  return { machine, border: 7, status: `program @ ${hex(org)}`, tape: null, autotype: null };
}

function bootZ80(bytes: Uint8Array, rom: Uint8Array): BootedProgram {
  const problem = z80SnapshotProblem(bytes);
  if (problem !== undefined) throw new Error(`not a loadable 48K .z80 snapshot: ${problem}`);
  const snap = readZ80(bytes);
  const memory = new Uint8Array(MEMORY_END);
  memory.set(snap.memory.subarray(RAM_BASE, MEMORY_END), RAM_BASE);
  memory.set(rom.subarray(0, RAM_BASE), 0); // the ROM the snapshot omits
  const machine = createPreviewMachine(memory, { ...snap.registers });
  return {
    machine,
    border: (snap.border ?? 7) & 0x07,
    status: `.z80 snapshot (v${snap.version})`,
    tape: null,
    autotype: null,
  };
}

function bootTape(kind: 'tap' | 'tzx', bytes: Uint8Array, rom: Uint8Array): BootedProgram {
  const blocks = tapeBlocks(kind, bytes);
  if (blocks.length === 0) throw new Error(`the .${kind} image contains no loadable data blocks`);
  const machine = createPreviewMachine(bootMemory(rom));
  const header = parseStandardHeader(blocks[0]!);

  if (header !== null && header.type === TAPE_TYPE_CODE && blocks.length >= 2) {
    // A CODE tape (e.g. the toolkit's own `build --tap`): instant-load its data block
    // at the header's address and enter it — the convention of `run --tap` and of a
    // preview `.bin`. Nothing runs the ROM loader here, so check what it would check.
    const dest = header.param1 & 0xffff;
    const want = header.length & 0xffff;
    const problem = ramFitProblem(dest, want);
    if (problem !== undefined) throw new Error(`the CODE block does not fit RAM: ${problem}`);
    const result = instantLoad(machine, blocks[1]!, { ix: dest, de: want, flag: 0xff, load: true });
    if (!result.ok || result.bytesLoaded !== want) {
      throw new Error(
        `the CODE block did not load (${result.reason}: ${result.bytesLoaded} of ${want} bytes ` +
          `for ${hex(dest)}) — the ROM loader would report "R Tape loading error"`,
      );
    }
    machine.registers.pc = dest;
    // Any further blocks stay on the tape for a loader the program runs itself.
    const tape = blocks.length > 2 ? { blocks, next: 2 } : null;
    return { machine, border: 7, status: `.${kind} CODE @ ${hex(dest)}`, tape, autotype: null };
  }

  // A BASIC-loader / multi-block tape: type `LOAD ""` on the real ROM and trap
  // LD-BYTES to instant-load each block in tape order — the faithful general path.
  return {
    machine,
    border: 7,
    status: `.${kind} — LOAD "" (autoloading)`,
    tape: { blocks, next: 0 },
    autotype: loadTypeSchedule(),
  };
}
