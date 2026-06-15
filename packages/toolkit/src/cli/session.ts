import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Machine } from '../core/machine.js';
import { EMULATOR_ID, type ZxState } from '../core/state.js';
import { userError } from './output.js';

/** Frames to boot the ROM before the machine is usable (RAM test + banner). */
export const BOOT_FRAMES = 250;

export function sessionStatePath(stateFile?: string): string {
  if (stateFile) return stateFile;
  return join(process.env['ZXS_STATE_DIR'] ?? join(process.cwd(), '.zxs'), 'state.zxstate');
}

export function readStateFile(path: string): ZxState {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ZxState;
  } catch (err) {
    throw userError(`Invalid session state JSON at ${path}: ${(err as Error).message}`, 'state');
  }
}

/** Atomic write (tmp + rename) so a crashed command never corrupts the session. */
export function writeStateFile(path: string, state: ZxState): void {
  writeJsonFile(path, state);
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  replaceFileWithRetry(tmp, path);
}

function replaceFileWithRetry(tmp: string, path: string): void {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      renameSync(tmp, path);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt === 5) break;
      sleepSync(20 * (attempt + 1));
      if (attempt >= 2) {
        try {
          rmSync(path, { force: true });
        } catch {
          // Keep retrying the rename; the original error is more useful.
        }
      }
    }
  }
  try {
    rmSync(tmp, { force: true });
  } catch {
    // Ignore cleanup failure and throw the write error.
  }
  throw lastErr;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function loadSessionMachine(stateFile?: string): Machine | null {
  const path = sessionStatePath(stateFile);
  if (!existsSync(path)) return null;
  return Machine.fromState(readStateFile(path));
}

export function saveSessionMachine(m: Machine, stateFile?: string): string {
  const path = sessionStatePath(stateFile);
  writeStateFile(path, m.saveState());
  return path;
}

export function resetSession(stateFile?: string): void {
  rmSync(sessionStatePath(stateFile), { force: true });
}

/* ───────────────────────── session meta ───────────────────────── */

export interface BreakpointEntry {
  id: number;
  spec: string;
  addr: number;
}

export interface WatchpointEntry {
  id: number;
  type: 'read' | 'write';
  from: number;
  to: number;
}

/** Debugger state persisted alongside the machine state in .zxs/session.json. */
export interface SessionMeta {
  symbolsPath?: string;
  breakpoints: BreakpointEntry[];
  watchpoints: WatchpointEntry[];
  nextId: number;
}

export function sessionMetaPath(stateFile?: string): string {
  return join(dirname(sessionStatePath(stateFile)), 'session.json');
}

export function loadSessionMeta(stateFile?: string): SessionMeta {
  const path = sessionMetaPath(stateFile);
  if (!existsSync(path)) {
    return { breakpoints: [], watchpoints: [], nextId: 1 };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SessionMeta;
  } catch (err) {
    throw userError(`Invalid session metadata JSON at ${path}: ${(err as Error).message}`, 'state');
  }
}

export function saveSessionMeta(meta: SessionMeta, stateFile?: string): void {
  const path = sessionMetaPath(stateFile);
  writeJsonFile(path, meta);
}

/* ───────────────────────── boot cache ───────────────────────── */

function bootCachePath(): string {
  const base = process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache');
  return join(base, 'zxs', `boot-48k-${EMULATOR_ID.version}-v1.zxstate`);
}

/**
 * A freshly booted machine (ROM banner visible). The boot is deterministic,
 * so it is computed once and cached under ~/.cache/zxs.
 */
export function bootCachedMachine(): Machine {
  const cache = bootCachePath();
  if (existsSync(cache)) {
    try {
      return Machine.fromState(readStateFile(cache));
    } catch {
      rmSync(cache, { force: true }); // stale/corrupt cache: fall through to re-boot
    }
  }
  const m = Machine.boot();
  m.run({ frames: BOOT_FRAMES });
  try {
    writeStateFile(cache, m.saveState());
  } catch {
    // Cache is an optimization; never fail a run because of it.
  }
  return m;
}
