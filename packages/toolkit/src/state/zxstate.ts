// The `.zxstate` session format — the CLI↔MCP interop contract (Slice 7b).
//
// `.zxstate` is the opt-in persistent session: the machine snapshot plus the
// debug stores (breakpoints/watchpoints), shared by `zxs state` (CLI) and the
// future `zxs-mcp` session (Slice 10). The CONTRACT is interop, not bytes:
//   - file-formats.md FF-ZXSTATE-001 + cli.md CLI-PROD-FREE-002: the on-disk byte
//     layout is **Incidental** (implementer's choice) UNLESS a consumer pins it,
//     in which case the path is to author `dna/product/zxstate-format.md`. No
//     conformance fixture pins it today (checked `dna/conformance/formats/` — only
//     z80/scr/tap/tzx round-trips), so this format is a clean-room DESIGN.
//   - mcp-tools.md MCP-PROD-RULE-INTEROP-001 / MCP-PROD-AC-INTEROP-001: a `.zxstate`
//     saved by one surface MUST be loadable by the other, and round-trip.
//
// DESIGN — a self-describing JSON envelope wrapping the core `.z80` snapshot:
//   {
//     emulatorId: "zx-vibes",          // who wrote it (interop guard)
//     format: "zxstate",
//     version: 1,                       // envelope schema version
//     machine: {
//       z80: "<base64 of writeZ80({registers,memory,border})>",
//       halted: false,                  // NOT carried by .z80 — preserved here
//       memptr: 0,                      // the WZ register, likewise not in .z80
//       clock: 0,                       // frame T-state 0..69887 (optional; absent ⇒ 0)
//       eiDelay: 0                      // 1 = an EI just ran (optional; absent ⇒ 0)
//     },
//     debug: { breakpoints: [...], watchpoints: [...] }   // ride-along debug stores
//   }
// The machine snapshot reuses the machine's OWN `.z80` codec (writeZ80/readZ80), so
// registers + 64 KB memory + border round-trip through a format MCP can reconstruct
// identically, and `state export --z80` can hand the very same bytes to a `.z80`.
// `clock` and `eiDelay` keep a session that stopped mid-frame (a breakpoint, a step)
// on the same interrupt schedule when it resumes: without them the resumed machine
// restarted the frame at T-state 0 and took its next interrupt at a different point,
// and an `EI` just before the save no longer delayed that interrupt by one
// instruction. They were added inside envelope version 1 as optional fields — older
// files load with both at 0 (the previous behaviour) and older builds ignore them.
//
// If conformance later pins the `.zxstate` bytes, author `dna/product/zxstate-format.md`
// and conform — this is a flagged W4 follow-up, NOT a silent choice (see the package
// README "The .zxstate session format").

import { createMachine, readZ80, writeZ80, type Machine } from '@zx-vibes/machine';
import { FRAME_T_STATES } from '@zx-vibes/ula';
import { userError } from '../output/envelope.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { loadRom, ROM_SIZE } from '../runtime/rom.js';
import { z80SnapshotProblem } from '../runtime/z80-check.js';
import type { DebugStore } from './debug-store.js';
import { emptyDebugStore, normalizeDebugStore } from './debug-store.js';

/** The emulator that authored a `.zxstate` (the interop identity, MCP-PROD-RULE-INTEROP-001). */
export const ZXSTATE_EMULATOR_ID = 'zx-vibes';
/** The envelope tag — distinguishes a `.zxstate` from any other JSON. */
export const ZXSTATE_FORMAT = 'zxstate';
/** The envelope schema version (bumped if the wrapper shape changes; the inner `.z80` has its own). */
export const ZXSTATE_VERSION = 1;

/** A fully-reconstructed persistent session: the live machine + its provenance + debug stores. */
export interface SessionState {
  machine: Machine;
  /** The border colour (0–7) — round-trips through the inner `.z80` snapshot. */
  border: number;
  /** The breakpoints/watchpoints that rode along with the snapshot. */
  debug: DebugStore;
}

/** The on-disk `.zxstate` JSON envelope (the Incidental byte layout — see FF-ZXSTATE-001). */
interface ZxStateEnvelope {
  emulatorId: string;
  format: string;
  version: number;
  machine: {
    z80: string;
    halted: boolean;
    memptr: number;
    /** The frame T-state (0..FRAME_T_STATES-1); optional, absent in pre-2026-11 files. */
    clock?: number;
    /** 1 while an `EI` holds off the next interrupt for one instruction; optional. */
    eiDelay?: number;
  };
  debug: DebugStore;
}

/** An optional integer envelope field: absent ⇒ 0; present but malformed ⇒ a USER_ERROR. */
function optionalMachineInt(value: unknown, max: number, field: string, label: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw userError(
      `Corrupt ${label} session file: machine.${field} must be an integer 0–${max}, got ${JSON.stringify(value)}`,
      'state',
    );
  }
  return value;
}

/**
 * Serialize a session to the `.zxstate` JSON text. The machine snapshot is the
 * core `.z80` codec output (registers + 64 KB + border), base64-wrapped; `halted`
 * and `memptr` (which `.z80` does not carry) ride in the envelope, as do the debug
 * stores. Deterministic for a fixed machine + debug store (no timestamps).
 */
export function serializeZxState(state: SessionState): string {
  const snapshot = writeZ80({
    registers: state.machine.registers,
    memory: state.machine.memory,
    border: state.border & 0x07,
  });
  const envelope: ZxStateEnvelope = {
    emulatorId: ZXSTATE_EMULATOR_ID,
    format: ZXSTATE_FORMAT,
    version: ZXSTATE_VERSION,
    machine: {
      z80: Buffer.from(snapshot).toString('base64'),
      halted: Boolean(state.machine.halted),
      memptr: (state.machine.registers.memptr ?? 0) & 0xffff,
      clock: state.machine.clock,
      eiDelay: state.machine.eiDelay > 0 ? 1 : 0,
    },
    debug: normalizeDebugStore(state.debug),
  };
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/**
 * Parse `.zxstate` JSON text back into a live session (the inverse of
 * {@link serializeZxState}). Reconstructs the machine from the inner `.z80`
 * snapshot, then restores `halted`/`memptr` and the debug stores. A wrong
 * `format`/`emulatorId` or malformed body is a USER_ERROR — never a silent
 * mis-load (ERR-PROD-NOSILENT-001).
 */
export function deserializeZxState(text: string, label = '.zxstate'): SessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Invalid ${label} session file: not JSON (${reason})`, 'state');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw userError(`Invalid ${label} session file: expected a JSON object`, 'state');
  }
  const env = parsed as Partial<ZxStateEnvelope>;
  if (env.format !== ZXSTATE_FORMAT) {
    throw userError(
      `Not a ${ZXSTATE_FORMAT} session file (${label}): format is ${JSON.stringify(env.format)}`,
      'state',
    );
  }
  if (env.emulatorId !== ZXSTATE_EMULATOR_ID) {
    throw userError(
      `${label} was written by a different emulator (${JSON.stringify(env.emulatorId)}); ` +
        `this build reads only "${ZXSTATE_EMULATOR_ID}" sessions`,
      'state',
    );
  }
  // A version this build does not know, or a body whose snapshot is not a loadable
  // `.z80`, must fail loud rather than resume a zeroed machine (ERR-PROD-EMU-001).
  if (env.version !== ZXSTATE_VERSION) {
    throw userError(
      `Unsupported ${label} session version ${JSON.stringify(env.version)}; ` +
        `this build reads version ${ZXSTATE_VERSION}`,
      'state',
    );
  }
  if (!env.machine || typeof env.machine.z80 !== 'string') {
    throw userError(`Invalid ${label} session file: missing machine snapshot`, 'state');
  }

  const inner = Buffer.from(env.machine.z80, 'base64');
  const problem = z80SnapshotProblem(inner);
  if (problem !== undefined) {
    throw userError(`Corrupt ${label} session file: its machine snapshot is invalid (${problem})`, 'state');
  }
  const clock = optionalMachineInt(env.machine.clock, FRAME_T_STATES - 1, 'clock', label);
  const eiDelay = optionalMachineInt(env.machine.eiDelay, 1, 'eiDelay', label);
  const snapshot = readZ80(inner);
  // The `.z80` format snapshots only the three RAM pages (0x4000–0xFFFF); the fixed
  // 48K ROM (0x0000–0x3FFF) is IMPLIED, not stored. Re-map it on load — the standard
  // snapshot-load semantics — so a resumed session can still call ROM routines.
  snapshot.memory.set(loadRom().subarray(0, ROM_SIZE), 0x0000);
  const machine = createMachine({
    registers: snapshot.registers,
    memory: snapshot.memory,
    clock,
    romWriteProtect: true, // MACHINE-ROM-READONLY-001, as for a fresh boot
  });
  machine.halted = Boolean(env.machine.halted);
  machine.registers.memptr = (env.machine.memptr ?? 0) & 0xffff;
  machine.eiDelay = eiDelay;

  return {
    machine,
    border: snapshot.border ?? DEFAULT_BORDER,
    debug: env.debug ? normalizeDebugStore(env.debug) : emptyDebugStore(),
  };
}
