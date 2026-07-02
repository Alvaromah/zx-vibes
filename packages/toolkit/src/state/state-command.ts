// `zxs state` — manage the opt-in persistent session (cli.md CLI-PROD-STATE-001,
// toolkit-runtime.md RT-PROD-SESSION-001..003).
//
// Sub-commands:
//   - `save [file]`        snapshot the current machine + live debug store to a
//                          `.zxstate` (default `.zxs/state.zxstate`).
//   - `load <file>`        adopt a `.zxstate` as the active session: copy it to the
//                          default session path and republish its embedded debug
//                          store to `.zxs/debug.json` (the MCP→CLI handoff,
//                          MCP-PROD-RULE-INTEROP-001).
//   - `reset`              reset the session machine to a fresh clean-ROM boot.
//   - `export --z80 <f>`   export the session machine as a `.z80` **v1** snapshot
//                          (CLI-PROD-STATE-001, contract). `--tap`/`--scr` export the
//                          same machine in those formats via the real formats emitter
//                          (Slice 8a): `--scr` is the live screen image, `--tap` wraps
//                          the session RAM as a loadable CODE tape. NOTE the `.z80` split:
//                          `state export --z80` stays **v1** (the contract, this file),
//                          while `build --z80` is the core's **v3** (W4-GAP-02).
//
// Why a hand-rolled v1 writer (z80V1Bytes): CLI-PROD-STATE-001 (contract tier) mandates
// the exported `.z80` is a **version 1** snapshot, but the core `@zx-vibes/machine`
// `writeZ80` only emits version 3 (it takes one `{registers,memory,border}` arg — no
// version selector). So the toolkit authors a v1 encoder here from the documented v1
// layout (the 30-byte header + single 48K image), validated by round-tripping through
// the core's `readZ80` (which reads v1/v2/v3). FF-RULE-001 makes each version's byte
// layout domain-authoritative — it does NOT license picking a version other than the
// CLI contract's. So: v1 it is.
//
// The `.zxstate` format itself is documented in zxstate.ts + the package README.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command } from 'commander';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { bootFreshMachine } from '../runtime/session.js';
import { resolveObserveMachine } from '../observe/source.js';
import {
  requestedFormats,
  scrImageBytes,
  tapImageBytes,
  type FormatKind,
  type FormatRequest,
} from '../build/formats.js';
import {
  DEFAULT_STATE_PATH,
  loadDebugStore,
  loadSession,
  saveDebugStore,
  saveSession,
  sessionExists,
} from './persist.js';
import type { SessionState } from './zxstate.js';

export type StateEnvelope = {
  ok: true;
  stage: 'state';
  op: 'save' | 'load' | 'reset' | 'export';
  /** The session/output file the op acted on. */
  file: string;
  /** The session machine's PC (save/load/reset). */
  pc?: number;
  /** The session border colour (save/load). */
  border?: number;
  /** Breakpoint/watchpoint counts that ride with the session (save/load). */
  breakpoints?: number;
  watchpoints?: number;
  /** Export format + byte length (`export`). */
  format?: 'z80' | 'tap' | 'scr';
  bytes?: number;
};

export interface StateCommonOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  org?: string | undefined;
}

/**
 * Source the machine a `save`/`export` should snapshot: resume the `--state` session
 * if present, else a fresh/`--bin`/built-entry boot (the same precedence as observe).
 */
function sourceSessionState(options: StateCommonOptions): SessionState {
  const cwd = resolve(options.cwd ?? process.cwd());
  if (options.state !== undefined && sessionExists(options.state, cwd)) {
    return loadSession(options.state, cwd);
  }
  const { machine } = resolveObserveMachine({
    cwd,
    bin: options.bin,
    org: options.org,
    stage: 'state',
  });
  return { machine, border: DEFAULT_BORDER, debug: loadDebugStore(cwd) };
}

/** `state save [file]` — write the current session to a `.zxstate` (CLI-PROD-STATE-001). */
export function runStateSave(file: string, options: StateCommonOptions = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = sourceSessionState(options);
  // Embed the live debug store (a save is self-contained for the MCP handoff).
  state.debug = loadDebugStore(cwd);
  saveSession(file, state, cwd);
  return {
    ok: true,
    stage: 'state',
    op: 'save',
    file,
    pc: state.machine.registers.pc & 0xffff,
    border: state.border,
    breakpoints: state.debug.breakpoints.length,
    watchpoints: state.debug.watchpoints.length,
  };
}

/** `state load <file>` — adopt a `.zxstate` as the active session (CLI-PROD-STATE-001). */
export function runStateLoad(file: string, options: { cwd?: string | undefined } = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = loadSession(file, cwd);
  // Adopt as the default session, and republish its embedded debug store so a later
  // stateless `run --until-break` (and the MCP session) see the loaded breakpoints.
  if (resolve(cwd, file) !== resolve(cwd, DEFAULT_STATE_PATH)) {
    saveSession(DEFAULT_STATE_PATH, state, cwd);
  }
  saveDebugStore(state.debug, cwd);
  return {
    ok: true,
    stage: 'state',
    op: 'load',
    file,
    pc: state.machine.registers.pc & 0xffff,
    border: state.border,
    breakpoints: state.debug.breakpoints.length,
    watchpoints: state.debug.watchpoints.length,
  };
}

/** `state reset` — reset the session machine to a fresh clean-ROM boot (CLI-PROD-STATE-001). */
export function runStateReset(options: { cwd?: string | undefined; state?: string | undefined } = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const file = options.state ?? DEFAULT_STATE_PATH;
  const machine = bootFreshMachine();
  // Keep the user's breakpoints (resetting machine state is not deleting debug config).
  saveSession(file, { machine, border: DEFAULT_BORDER, debug: loadDebugStore(cwd) }, cwd);
  return { ok: true, stage: 'state', op: 'reset', file, pc: machine.registers.pc & 0xffff, border: DEFAULT_BORDER };
}

/** `state export --z80 <file>` — export the session machine as a `.z80` v1 snapshot. */
export function runStateExportZ80(file: string, options: StateCommonOptions = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = sourceSessionState(options);
  const bytes = exportZ80Bytes(state.machine, state.border);
  const out = resolve(cwd, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return { ok: true, stage: 'state', op: 'export', file, format: 'z80', bytes: bytes.length };
}

/**
 * `state export --tap <file>` — export the session machine as a loadable `.tap` (Slice
 * 8a). The session RAM image (`0x4000`–`0xFFFF`, the same region the v1 `.z80` export
 * carries) is wrapped as a CODE tape at load address `0x4000` via the real formats
 * emitter (header block + data block, FMT-TAP-*). Round-trips through `parseTap`; the
 * data block edge-/instant-loads back to `0x4000`.
 */
export function runStateExportTap(file: string, options: StateCommonOptions = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = sourceSessionState(options);
  const ram = state.machine.memory.slice(0x4000, 0x10000);
  const bytes = tapImageBytes({ bytes: ram, loadAddress: 0x4000, name: tapeNameFromFile(file) });
  writeExport(cwd, file, bytes);
  return { ok: true, stage: 'state', op: 'export', file, format: 'tap', bytes: bytes.length };
}

/**
 * `state export --scr <file>` — export the session machine's 6912-byte screen image
 * (display file + attribute file, FMT-SCR-*) via the real formats emitter (Slice 8a).
 * Round-trips byte-for-byte against the machine's `0x4000`–`0x5AFF` region.
 */
export function runStateExportScr(file: string, options: StateCommonOptions = {}): StateEnvelope {
  const cwd = resolve(options.cwd ?? process.cwd());
  const state = sourceSessionState(options);
  const bytes = scrImageBytes(state.machine);
  writeExport(cwd, file, bytes);
  return { ok: true, stage: 'state', op: 'export', file, format: 'scr', bytes: bytes.length };
}

/** Dispatch `state export --<kind> <file>` to the matching exporter (Slice 8a). */
function runStateExport(
  kind: FormatKind,
  file: string,
  options: StateCommonOptions,
): StateEnvelope {
  switch (kind) {
    case 'z80':
      return runStateExportZ80(file, options);
    case 'tap':
      return runStateExportTap(file, options);
    case 'scr':
      return runStateExportScr(file, options);
  }
}

/** Write an export artifact, creating parent directories (shared by the export ops). */
function writeExport(cwd: string, file: string, bytes: Uint8Array): void {
  const out = resolve(cwd, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
}

/** A ≤10-char tape name derived from the export file's stem (cosmetic header field). */
function tapeNameFromFile(file: string): string {
  const stem = file.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return stem.length > 0 ? stem : 'session';
}

/**
 * Serialize a machine to **`.z80` version 1** bytes (CLI-PROD-STATE-001 mandates v1).
 * A v1 snapshot is a 30-byte register header (with PC in bytes 6–7 — a NON-zero PC is
 * the v1 marker, since PC=0 selects v2/v3) followed by the single 48K RAM image
 * (0x4000–0xFFFF), stored uncompressed (header byte 12 bit 5 clear). The fixed 48K ROM
 * is implied by the format, not stored. Round-trips through the core `readZ80`
 * (`version === 1`). Authored from the documented v1 layout — the core `writeZ80`
 * emits only v3, so the toolkit owns the v1 path.
 */
export function exportZ80Bytes(machine: Machine, border: number): Uint8Array {
  const r = machine.registers as Record<string, number>;
  const lo = (name: string): number => (r[name] ?? 0) & 0xff;
  const pc = (r.pc ?? 0) & 0xffff;
  if (pc === 0) {
    throw userError(
      'state export --z80 (v1) requires a non-zero PC: a .z80 v1 snapshot encodes PC in its header ' +
        '(PC=0 is the v2/v3 marker). Run the session, or `regs set pc <addr>`, before exporting.',
      'state',
    );
  }
  const sp = (r.sp ?? 0) & 0xffff;
  const rr = (r.r ?? 0) & 0xff;

  const header = new Uint8Array(30);
  header[0] = lo('a'); header[1] = lo('f');
  header[2] = lo('c'); header[3] = lo('b');
  header[4] = lo('l'); header[5] = lo('h');
  header[6] = pc & 0xff; header[7] = (pc >> 8) & 0xff; // non-zero => version 1
  header[8] = sp & 0xff; header[9] = (sp >> 8) & 0xff;
  header[10] = lo('i');
  header[11] = rr & 0x7f;
  // byte 12: bit0 = R bit7, bits1–3 = border, bit5 = compressed (0 = uncompressed image).
  header[12] = ((rr >> 7) & 1) | ((border & 0x07) << 1);
  header[13] = lo('e'); header[14] = lo('d');
  header[15] = lo('c_'); header[16] = lo('b_');
  header[17] = lo('e_'); header[18] = lo('d_');
  header[19] = lo('l_'); header[20] = lo('h_');
  header[21] = lo('a_'); header[22] = lo('f_');
  header[23] = lo('iyl'); header[24] = lo('iyh');
  header[25] = lo('ixl'); header[26] = lo('ixh');
  header[27] = (r.iff1 ?? 0) ? 1 : 0;
  header[28] = (r.iff2 ?? 0) ? 1 : 0;
  header[29] = (r.im ?? 0) & 0x03;

  const ram = machine.memory.subarray(0x4000, 0x10000); // 0xC000 bytes, uncompressed
  const out = new Uint8Array(header.length + ram.length);
  out.set(header, 0);
  out.set(ram, header.length);
  return out;
}

/** Map the CLI context onto the `state` sub-commands. */
export function stateCommand(context: CommandContext): StateEnvelope {
  const sub = context.args[0];
  const options = context.options as Record<string, unknown>;
  const cwd = process.cwd();
  const common: StateCommonOptions = {
    cwd,
    state: options.state as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
  };

  switch (sub) {
    case 'save': {
      const file = context.args[1] ?? (options.state as string | undefined) ?? DEFAULT_STATE_PATH;
      return runStateSave(file, common);
    }
    case 'load': {
      const file = context.args[1] ?? (options.state as string | undefined);
      if (file === undefined) throw userError('state load requires <file>', 'state');
      return runStateLoad(file, { cwd });
    }
    case 'reset':
      return runStateReset({ cwd, state: options.state as string | undefined });
    case 'export': {
      // `state export --<fmt> <file>` (CLI-PROD-STATE-001): a format FLAG, not a separate
      // verb. `--z80` is the v1 toolkit snapshot (the contract); `--tap`/`--scr` export the
      // SAME session machine via the real Slice-8a emitter. The `.z80` version split is
      // intentional: state export = v1 (here), `build --z80` = the core's v3 (W4-GAP-02).
      const request: FormatRequest = {
        z80: options.z80 as string | undefined,
        tap: options.tap as string | undefined,
        scr: options.scr as string | undefined,
      };
      const requested = requestedFormats(request);
      if (requested.length === 0) {
        throw userError(
          'state export requires a format target, e.g. `state export --z80 <file>` (or --tap/--scr)',
          'state',
        );
      }
      // Emit each requested format (each flag carries its own <file>); return the last.
      let envelope: StateEnvelope | undefined;
      for (const kind of requested) {
        envelope = runStateExport(kind, request[kind] as string, common);
      }
      return envelope as StateEnvelope;
    }
    case undefined:
      throw userError('state requires a sub-command: save | load | reset | export --z80 <file>', 'state');
    default:
      throw userError(
        `Unknown state sub-command "${sub}" (use save | load | reset | export --z80 <file>)`,
        'state',
      );
  }
}

/** Declare the `state` command's arguments / flags (CLI-PROD-STATE-001). */
export function configureStateCommand(command: Command): void {
  command
    .description('Manage the opt-in persistent session: save | load | reset | export --z80')
    .argument('[args...]', '`save [file]`, `load <file>`, `reset`, or `export --z80 <file>`')
    .option('--state <file>', 'session file to source/target (default .zxs/state.zxstate)')
    .option('--bin <file>', 'source a raw binary at --org when there is no session yet')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--z80 <file>', 'export target for `state export` (a .z80 v1 snapshot)')
    .option('--tap <file>', 'export the session RAM as a loadable .tap (CODE tape at 0x4000)')
    .option('--scr <file>', 'export the session screen as a 6912-byte .scr image')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
