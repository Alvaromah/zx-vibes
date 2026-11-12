// `zxs key` + `zxs type` — scheduled keyboard input (cli.md CLI-PROD-INPUT-001 /
// CLI-PROD-INPUT-002, keyboard-input.md KBD-MATRIX-001/KBD-LATCH-001).
//
// Both are thin sugar over the canonical scheduled `--keys` model (schedule.ts): they
// synthesize a key schedule, source a machine (a fresh/`--bin`/built-entry boot, or a
// resumed `--state` session), run it so the program actually SEES the input through the
// 48K matrix, and (when `--state`) persist the resulting machine (RT-PROD-SESSION-003).
// The run is under `run`'s hang watchdog, and a hang is reported, not hidden: `ok:false`,
// the verdict, exit 2 (CLI-PROD-INPUT-003).
//   - `key <key> [--hold n]`   presses one key for `--hold` frames (default 3).
//   - `type <text> [--frames-per-key n]`  types a string, one key per `--frames-per-key`
//                              frames (default 3), keys scheduled back-to-back.

import type { Command } from 'commander';
import { ExitCode, userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { runProgram, type RunExit } from '../runtime/run.js';
import type { HangVerdict } from '../runtime/hang.js';
import { RAM_BASE } from '../runtime/session.js';
import { DEFAULT_HOLD, normalizeKeyToken, type KeyEvent } from '../runtime/schedule.js';
import { type RegisterSnapshot } from '../observe/registers.js';
import { type ScreenSummary } from '../observe/screen.js';
import { openSession } from '../state/persist.js';

/** Default frames-per-key for `type` (CLI-PROD-INPUT-002). */
export const DEFAULT_FRAMES_PER_KEY = 3;
/** Frames run after the scheduled input ends, so the program can react to the last key. */
export const INPUT_SETTLE_FRAMES = 2;

export type InputEnvelope = {
  ok: true;
  stage: 'key' | 'type';
  /** The realized key schedule that was applied (CLI-PROD-RUN-004 shape). */
  input: { keys: KeyEvent[] };
  framesRun: number;
  /** True iff the resulting machine was persisted to a `--state` session. */
  persisted: boolean;
  registers: RegisterSnapshot;
  screen: ScreenSummary;
  /** `key`: the pressed key + hold (echoed for convenience). */
  key?: string;
  hold?: number;
  /** `type`: the typed text + per-key frames. */
  text?: string;
  framesPerKey?: number;
};

/**
 * A `key`/`type` whose run hung (cli.md CLI-PROD-INPUT-003): not a success. It carries the
 * run's `status`/`exit`/`hang` verdict and exits 2 (HANG), exactly as `run` reports one.
 */
export type InputHangEnvelope = Omit<InputEnvelope, 'ok'> & {
  ok: false;
  status: 'hang';
  exit: RunExit;
  hang: HangVerdict;
  error: { message: string; exitCode: typeof ExitCode.HANG };
};

/** What one input command reports: the success envelope, or a hang (exit 2). */
export type InputResult = InputEnvelope | InputHangEnvelope;

/** The run outcome of a key schedule, before it is shaped into an envelope. */
interface KeyScheduleRun {
  input: { keys: KeyEvent[] };
  framesRun: number;
  persisted: boolean;
  registers: RegisterSnapshot;
  screen: ScreenSummary;
  /** Set when the watchdog stopped (or ended) the run with a hang verdict. */
  hang?: { exit: RunExit; verdict: HangVerdict };
}

interface InputCommonOptions {
  cwd?: string | undefined;
  state?: string | undefined;
  bin?: string | undefined;
  org?: string | undefined;
  noSave?: boolean | undefined;
  frames?: number | undefined;
}

/** Run a synthesized key schedule against a sourced/resumed machine and persist it. */
function runKeySchedule(
  stage: 'key' | 'type',
  events: KeyEvent[],
  options: InputCommonOptions,
): KeyScheduleRun {
  const session = openSession({
    cwd: options.cwd,
    state: options.state,
    bin: options.bin,
    org: options.org,
    noSave: options.noSave,
    stage,
  });
  const scheduleEnd = events.reduce((end, e) => Math.max(end, e.frame + e.hold), 0);
  const frames = options.frames ?? scheduleEnd + INPUT_SETTLE_FRAMES;
  const keysSpec = events.map((e) => `${e.frame}:${e.key}*${e.hold}`).join(',');

  // Seed the session's border so a run that never writes port 0xFE keeps it (it used
  // to report and save the power-on 7). A resumed session continues like `run --state`:
  // the watchdog's RAM floor, not wherever the session paused (which may be in ROM).
  const result = runProgram(session.machine, session.resumed ? RAM_BASE : session.org, {
    keys: keysSpec,
    frames,
    border: session.border,
  });
  // Saved even when it hung, like `run --state`: the hung machine is what to inspect.
  session.save(result.io.borderColor());
  return {
    input: { keys: result.input.keys },
    framesRun: result.framesRun,
    persisted: session.persistent && options.noSave !== true,
    registers: result.registers,
    screen: result.screen,
    ...(result.status === 'hang' && result.hang
      ? { hang: { exit: result.exit, verdict: result.hang } }
      : {}),
  };
}

/** `key <key> [--hold n]` — press one key (CLI-PROD-INPUT-001). */
export function runKey(key: string, hold: number, options: InputCommonOptions): InputResult {
  const normalized = normalizeKeyToken(key);
  const events: KeyEvent[] = [{ frame: 0, key: normalized, hold }];
  const { hang, ...run } = runKeySchedule('key', events, options);
  return inputEnvelope({ stage: 'key', key: normalized, hold, ...run }, hang);
}

/**
 * The input command's envelope: the unchanged success shape, or — when the machine hung
 * while consuming the keys — `ok:false` with the run's verdict and exit 2 (HANG), the way
 * `run` reports one (cli.md CLI-PROD-INPUT-003, CLI-PROD-EXIT-003). Never a silent
 * success over a hung machine (ERR-PROD-NOSILENT-001).
 */
function inputEnvelope(
  report: Omit<InputEnvelope, 'ok'>,
  hang: KeyScheduleRun['hang'],
): InputResult {
  if (hang === undefined) return { ok: true, ...report };
  return {
    ok: false,
    ...report,
    status: 'hang',
    exit: hang.exit,
    hang: hang.verdict,
    error: {
      message: `${report.stage}: the program hung (${hang.verdict.kind}) at PC 0x${hang.verdict.pc
        .toString(16)
        .toUpperCase()} while the keys were applied`,
      exitCode: ExitCode.HANG,
    },
  };
}

// Characters `type` accepts beyond letters/digits → their Spectrum key token.
const TYPE_NAMED: Readonly<Record<string, string>> = {
  ' ': 'SPACE',
  '\n': 'ENTER',
  '\r': 'ENTER',
  '\t': 'SPACE',
};

/**
 * Map one character of a `type` string to a Spectrum key token (USER_ERROR if unmappable).
 * Exported (module-level) so the MCP `zx_keys` tool (Slice 10) reuses the exact same
 * char→key contract as the CLI `type` command — not added to the public barrel.
 */
export function charToKey(ch: string): string {
  if (/^[A-Za-z0-9]$/.test(ch)) return ch.toUpperCase();
  const named = TYPE_NAMED[ch];
  if (named) return named;
  throw userError(
    `type: cannot map character ${JSON.stringify(ch)} to a Spectrum key (use letters, digits, space, or newline)`,
    'type',
  );
}

/**
 * Frames a key stays released before the SAME key is pressed again. Held back to back,
 * a repeated key is one continuous press, so the ROM keyboard routine reads "11" as "1";
 * measured against the real ROM, a 3-frame gap still drops it and 6 frames is reliable.
 */
export const REPEAT_RELEASE_FRAMES = 6;

/**
 * The key schedule that types `text`: each character held `framesPerKey` frames, keys
 * back to back, with a {@link REPEAT_RELEASE_FRAMES} release before a repeated key.
 * Shared by `zxs type` and the MCP `zx_keys` `typeText` so both type the same way.
 */
export function typeSchedule(text: string, framesPerKey: number): KeyEvent[] {
  const events: KeyEvent[] = [];
  let frame = 0;
  for (let i = 0; i < text.length; i += 1) {
    const key = charToKey(text[i]!);
    if (i > 0 && key === events[i - 1]!.key) frame += REPEAT_RELEASE_FRAMES;
    events.push({ frame, key, hold: framesPerKey });
    frame += framesPerKey;
  }
  return events;
}

/** `type <text> [--frames-per-key n]` — type a string through the matrix (CLI-PROD-INPUT-002). */
export function runType(text: string, framesPerKey: number, options: InputCommonOptions): InputResult {
  if (text.length === 0) throw userError('type requires a non-empty <text>', 'type');
  const { hang, ...run } = runKeySchedule('type', typeSchedule(text, framesPerKey), options);
  return inputEnvelope({ stage: 'type', text, framesPerKey, ...run }, hang);
}

function parsePositiveInt(input: string, stage: string, flag: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw userError(`Invalid ${flag}: "${input}" (expected a positive integer)`, stage);
  }
  return n;
}

function commonOptions(options: Record<string, unknown>): InputCommonOptions {
  return {
    cwd: process.cwd(),
    state: options.state as string | undefined,
    bin: options.bin as string | undefined,
    org: options.org as string | undefined,
    noSave: options.save === false || options.readOnly === true,
    frames: options.frames !== undefined ? parsePositiveInt(options.frames as string, 'key', '--frames') : undefined,
  };
}

/** Map the CLI context onto the `key` service. */
export function keyCommand(context: CommandContext): InputResult {
  const key = context.args[0];
  if (key === undefined) throw userError('key requires a <key> (A–Z, 0–9, ENTER, SPACE, ...)', 'key');
  const options = context.options as Record<string, unknown>;
  const hold = options.hold !== undefined ? parsePositiveInt(options.hold as string, 'key', '--hold') : DEFAULT_HOLD;
  return runKey(key, hold, commonOptions(options));
}

/** Map the CLI context onto the `type` service. */
export function typeCommand(context: CommandContext): InputResult {
  const text = context.args[0];
  if (text === undefined) throw userError('type requires a <text> string', 'type');
  const options = context.options as Record<string, unknown>;
  const framesPerKey =
    options.framesPerKey !== undefined
      ? parsePositiveInt(options.framesPerKey as string, 'type', '--frames-per-key')
      : DEFAULT_FRAMES_PER_KEY;
  return runType(text, framesPerKey, commonOptions(options));
}

/** Declare the `key` command's argument / flags (CLI-PROD-INPUT-001). */
export function configureKeyCommand(command: Command): void {
  command
    .description('Press one key (A–Z, 0–9, ENTER, SPACE, CAPS_SHIFT, SYMBOL_SHIFT)')
    .argument('[key]', 'the key to press')
    .option('--hold <frames>', `frames to hold the key (default ${DEFAULT_HOLD})`)
    .option('--frames <n>', 'total frames to run (default: hold + a small settle window)')
    .option('--state <file>', 'press into an opt-in persistent session (.zxstate)')
    .option('--bin <file>', 'press into a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--no-save', 'do not persist the session (when --state is active)')
    .option('--read-only', 'do not persist the session (when --state is active)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

/** Declare the `type` command's argument / flags (CLI-PROD-INPUT-002). */
export function configureTypeCommand(command: Command): void {
  command
    .description('Type a string through the keyboard matrix')
    .argument('[text]', 'the text to type')
    .option('--frames-per-key <n>', `frames per key (default ${DEFAULT_FRAMES_PER_KEY})`)
    .option('--frames <n>', 'total frames to run (default: schedule length + a small settle window)')
    .option('--state <file>', 'type into an opt-in persistent session (.zxstate)')
    .option('--bin <file>', 'type into a raw binary loaded at --org')
    .option('--org <addr>', 'load origin for --bin (default 0x8000)')
    .option('--no-save', 'do not persist the session (when --state is active)')
    .option('--read-only', 'do not persist the session (when --state is active)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}
