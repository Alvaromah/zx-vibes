// On-disk persistence for the opt-in session + the debug store (Slice 7b).
//
// Two artifacts live under the project's `.zxs/` cache dir (CLI-PROD-CLEAN-001 —
// `clean` removes `.zxs/`):
//   - `.zxs/debug.json`     — the LIVE break/watch store (debug-store.ts). The
//     authoritative source for `break`/`watch` commands and `run --until-break`/
//     `--until-watch`. Independent of any session, so it survives stateless calls.
//   - `.zxs/state.zxstate`  — the DEFAULT opt-in persistent session (zxstate.ts).
//     Only written/read when `--state` is requested (CLI-PROD-CONV-SOURCE-001 default
//     session path; RT-PROD-SESSION-001 stateless-by-default).
//
// `openSession` unifies the mutation commands (`regs set`, `mem write`, `mem load`,
// `key`, `type`): it sources a machine (resume an existing `--state` session, else a
// fresh/`--bin`/built-entry boot), applies the mutation, and persists back to the
// `--state` file unless `--no-save`/`--read-only` (RT-PROD-SESSION-003).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Machine } from '@zx-vibes/machine';
import { userError } from '../output/envelope.js';
import { DEFAULT_BORDER } from '../runtime/io-device.js';
import { resolveObserveMachine } from '../observe/source.js';
import {
  emptyDebugStore,
  normalizeDebugStore,
  type DebugStore,
} from './debug-store.js';
import { deserializeZxState, serializeZxState, type SessionState } from './zxstate.js';

/** The project session/cache dir (CLI-PROD-CLEAN-001). */
export const ZXS_DIR = '.zxs';
/** The live break/watch store file. */
export const DEBUG_STORE_FILE = '.zxs/debug.json';
/** The default opt-in persistent session file (CLI-PROD-CONV-SOURCE-001). */
export const DEFAULT_STATE_PATH = '.zxs/state.zxstate';

/** Absolute path to the live debug store under `cwd`. */
export function debugStorePath(cwd: string = process.cwd()): string {
  return resolve(cwd, DEBUG_STORE_FILE);
}

/** Absolute path to the default session file under `cwd`. */
export function defaultStatePath(cwd: string = process.cwd()): string {
  return resolve(cwd, DEFAULT_STATE_PATH);
}

/** Load the live debug store (empty if it does not exist yet). */
export function loadDebugStore(cwd: string = process.cwd()): DebugStore {
  const path = debugStorePath(cwd);
  if (!existsSync(path)) return emptyDebugStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw userError(`Invalid debug store ${DEBUG_STORE_FILE}: ${reason}`, 'break');
  }
  return normalizeDebugStore(parsed);
}

/** Persist the live debug store (creating `.zxs/` as needed). */
export function saveDebugStore(store: DebugStore, cwd: string = process.cwd()): void {
  const path = debugStorePath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalizeDebugStore(store), null, 2)}\n`);
}

/** Whether a `.zxstate` session file exists at the given (relative-to-cwd or absolute) path. */
export function sessionExists(file: string, cwd: string = process.cwd()): boolean {
  return existsSync(resolve(cwd, file));
}

/** Read + reconstruct a `.zxstate` session from disk (USER_ERROR if missing/malformed). */
export function loadSession(file: string, cwd: string = process.cwd()): SessionState {
  const path = resolve(cwd, file);
  if (!existsSync(path)) {
    throw userError(
      `No session at "${file}" (run \`zxs state save\` to create one first)`,
      'state',
    );
  }
  return deserializeZxState(readFileSync(path, 'utf8'), file);
}

/** Write a `.zxstate` session to disk (creating `.zxs/` as needed). */
export function saveSession(file: string, state: SessionState, cwd: string = process.cwd()): void {
  const path = resolve(cwd, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeZxState(state));
}

/** Options shared by every mutation command (`regs set`, `mem write`/`load`, `key`, `type`). */
export interface OpenSessionOptions {
  cwd?: string | undefined;
  /** Opt-in persistent session file (`--state`); resume it and persist back to it. */
  state?: string | undefined;
  /** Suppress persistence even with `--state` (`--no-save`/`--read-only`). */
  noSave?: boolean | undefined;
  /** Non-session source flags (used when there is no `--state`, or the file is new). */
  bin?: string | undefined;
  org?: string | undefined;
  /** Command name, so a sourcing/persist failure carries the command's stage. */
  stage?: string | undefined;
}

/** A mutation session: the live machine + how to persist it after the mutation. */
export interface MutationSession {
  machine: Machine;
  /** The load origin (a resumed session reports its paused PC) — used by run-based mutations. */
  org: number;
  /** The border to carry through a save (preserved from a resumed session). */
  border: number;
  /** True iff `--state` opted into persistence. */
  persistent: boolean;
  /** Absolute session file path (when persistent). */
  statePath: string | undefined;
  /**
   * Persist the (now-mutated) machine back to the `--state` file with the current
   * live debug store embedded. No-op under the stateless default or `--no-save`
   * (RT-PROD-SESSION-003). `border` overrides the carried border (e.g. a post-run
   * border); omit to keep the resumed/default border.
   */
  save(border?: number): void;
}

/**
 * Open a session for a mutating command (RT-PROD-SESSION-001..003). Precedence:
 * resume the `--state` session if its file exists; else source a fresh/`--bin`/
 * built-entry machine (so a mutation can also CREATE a `--state` session). The
 * returned `save()` persists back to the `--state` file (debug store embedded)
 * unless the caller is stateless or asked for no-save.
 */
export function openSession(options: OpenSessionOptions = {}): MutationSession {
  const cwd = resolve(options.cwd ?? process.cwd());
  const stage = options.stage ?? 'state';
  const persistent = options.state !== undefined;
  const statePath = persistent ? resolve(cwd, options.state!) : undefined;
  const noSave = options.noSave ?? false;

  let machine: Machine;
  let border = DEFAULT_BORDER;
  let org: number;
  if (persistent && existsSync(statePath!)) {
    const session = loadSession(options.state!, cwd);
    machine = session.machine;
    border = session.border;
    org = session.machine.registers.pc & 0xffff;
  } else {
    const sourced = resolveObserveMachine({
      cwd,
      bin: options.bin,
      org: options.org,
      stage,
    });
    machine = sourced.machine;
    org = sourced.org;
  }

  return {
    machine,
    org,
    border,
    persistent,
    statePath,
    save(overrideBorder?: number): void {
      if (!persistent || noSave || statePath === undefined) return;
      const effectiveBorder = overrideBorder ?? border;
      saveSession(
        statePath,
        { machine, border: effectiveBorder, debug: loadDebugStore(cwd) },
        cwd,
      );
    },
  };
}
