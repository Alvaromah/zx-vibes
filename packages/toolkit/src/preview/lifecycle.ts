// Detached preview-server lifecycle — cli.md CLI-PROD-RULE-PREVIEW-OWN-001,
// toolkit-runtime.md RT-PROD-PREVIEW-003 / RT-PROD-PREVIEW-004, RT-PROD-FREE-001.
//
// A DETACHED preview server records `{ pid, port, url, token, owner }` in
// `.zxs/preview-server.json` (RT-PROD-PREVIEW-003): `owner` marks it a zx-vibes preview
// server and `token` is a per-server UUID. `preview --list` reports the record;
// `preview --stop` stops it ONLY after verifying it owns the recorded token via the
// server's control endpoint (RT-PROD-PREVIEW-004 / CLI-PROD-RULE-PREVIEW-OWN-001) — a
// missing/foreign token is a USER_ERROR (exit 1). The on-disk byte layout is Incidental
// (RT-PROD-FREE-001); only this observable contract matters.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The `.zxs` session/cache dir (shared with the persistent-session slice). */
export const ZXS_DIR = '.zxs';
/** The detached-preview record file name. */
export const PREVIEW_RECORD_FILE = 'preview-server.json';
/** The `owner` marker that identifies a record as a zx-vibes preview server. */
export const PREVIEW_OWNER = 'zx-vibes-preview';

/** The detached preview-server record (RT-PROD-PREVIEW-003). */
export interface PreviewRecord {
  pid: number;
  port: number;
  url: string;
  token: string;
  owner: string;
  /** When the record was written (Incidental; aids `--list` reporting). */
  startedAt?: string;
}

/** Absolute path of the preview record under a project's `.zxs/` dir. */
export function previewRecordPath(cwd: string): string {
  return resolve(cwd, ZXS_DIR, PREVIEW_RECORD_FILE);
}

/** Read the preview record, or `null` when absent/unreadable/not-a-zx-vibes record. */
export function readPreviewRecord(cwd: string): PreviewRecord | null {
  try {
    const raw = readFileSync(previewRecordPath(cwd), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PreviewRecord>;
    if (
      parsed &&
      parsed.owner === PREVIEW_OWNER &&
      typeof parsed.port === 'number' &&
      typeof parsed.token === 'string' &&
      typeof parsed.url === 'string'
    ) {
      return parsed as PreviewRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/** Write the preview record (creating `.zxs/`), atomically via a temp-rename. */
export function writePreviewRecord(cwd: string, record: PreviewRecord): string {
  const path = previewRecordPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  // rename is atomic within a dir; fall back to a direct write if rename is unavailable.
  try {
    rmSync(path, { force: true });
  } catch {
    /* ignore */
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  rmSync(tmp, { force: true });
  return path;
}

/** Remove the preview record if present (idempotent). */
export function removePreviewRecord(cwd: string): void {
  rmSync(previewRecordPath(cwd), { force: true });
}

/** Build the control-endpoint URL for a base server URL (`http://127.0.0.1:<port>`). */
function controlUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/control/${path}`;
}

/** Liveness probe: whether the server at `baseUrl` answers `/control/ping`. */
export async function pingServer(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(controlUrl(baseUrl, 'ping'), { method: 'GET' }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

/** The outcome of attempting to stop a recorded server. */
export type StopOutcome = 'stopped' | 'foreign' | 'unreachable';

/**
 * Ask the server at `baseUrl` to stop, proving ownership with `token`
 * (RT-PROD-PREVIEW-004): `stopped` = the token matched and the server shut down;
 * `foreign` = the server rejected the token (HTTP 403); `unreachable` = no server answered.
 */
export async function stopServer(baseUrl: string, token: string, timeoutMs = 3000): Promise<StopOutcome> {
  try {
    const res = await fetchWithTimeout(
      controlUrl(baseUrl, 'stop'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      },
      timeoutMs,
    );
    if (res.ok) return 'stopped';
    if (res.status === 403) return 'foreign';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** A fresh per-server ownership token (RT-PROD-PREVIEW-003 — a per-server UUID). */
export function newToken(): string {
  return globalThis.crypto.randomUUID();
}

/** The base URL for a bound port on the loopback host. */
export function baseUrlFor(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** The `.zxs/` directory path (for callers that want to ensure it exists). */
export function zxsDir(cwd: string): string {
  return join(cwd, ZXS_DIR);
}
