// `zxs key` + `zxs type` — scheduled keyboard input (cli.md CLI-PROD-INPUT-001 /
// CLI-PROD-INPUT-002, keyboard-input.md KBD-MATRIX-001/KBD-LATCH-001).
//
// Both are thin sugar over the canonical scheduled `--keys` model (schedule.ts): they
// synthesize a key schedule, source a machine (a fresh/`--bin`/built-entry boot, or a
// resumed `--state` session), run it so the program actually SEES the input through the
// 48K matrix, and (when `--state`) persist the resulting machine (RT-PROD-SESSION-003).
//   - `key <key> [--hold n]`   presses one key for `--hold` frames (default 3).
//   - `type <text> [--frames-per-key n]`  types a string, one key per `--frames-per-key`
//                              frames (default 3), keys scheduled back-to-back.

import type { Command } from 'commander';
import { userError } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { runProgram } from '../runtime/run.js';
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
): { input: { keys: KeyEvent[] }; framesRun: number; persisted: boolean; registers: RegisterSnapshot; screen: ScreenSummary } {
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

  const result = runProgram(session.machine, session.org, { keys: keysSpec, frames });
  session.save(result.io.borderColor());
  return {
    input: { keys: result.input.keys },
    framesRun: result.framesRun,
    persisted: session.persistent && options.noSave !== true,
    registers: result.registers,
    screen: result.screen,
  };
}

/** `key <key> [--hold n]` — press one key (CLI-PROD-INPUT-001). */
export function runKey(key: string, hold: number, options: InputCommonOptions): InputEnvelope {
  const normalized = normalizeKeyToken(key);
  const events: KeyEvent[] = [{ frame: 0, key: normalized, hold }];
  const run = runKeySchedule('key', events, options);
  return { ok: true, stage: 'key', key: normalized, hold, ...run };
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

/** `type <text> [--frames-per-key n]` — type a string through the matrix (CLI-PROD-INPUT-002). */
export function runType(text: string, framesPerKey: number, options: InputCommonOptions): InputEnvelope {
  if (text.length === 0) throw userError('type requires a non-empty <text>', 'type');
  const events: KeyEvent[] = [];
  for (let i = 0; i < text.length; i += 1) {
    events.push({ frame: i * framesPerKey, key: charToKey(text[i]!), hold: framesPerKey });
  }
  const run = runKeySchedule('type', events, options);
  return { ok: true, stage: 'type', text, framesPerKey, ...run };
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
export function keyCommand(context: CommandContext): InputEnvelope {
  const key = context.args[0];
  if (key === undefined) throw userError('key requires a <key> (A–Z, 0–9, ENTER, SPACE, ...)', 'key');
  const options = context.options as Record<string, unknown>;
  const hold = options.hold !== undefined ? parsePositiveInt(options.hold as string, 'key', '--hold') : DEFAULT_HOLD;
  return runKey(key, hold, commonOptions(options));
}

/** Map the CLI context onto the `type` service. */
export function typeCommand(context: CommandContext): InputEnvelope {
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
