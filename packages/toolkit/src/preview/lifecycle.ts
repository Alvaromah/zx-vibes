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

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ZXS_DIR } from '../state/persist.js';

/** The `.zxs` session/cache dir — the persistent-session slice's, re-exported for the preview API. */
export { ZXS_DIR };
/** The detached-preview record file name. */
export const PREVIEW_RECORD_FILE = 'preview-server.json';
/** Where a detached preview server's stdout/stderr go (its rebuild failures, a crash). */
export const PREVIEW_LOG_FILE = 'preview-server.log';
/**
 * The `owner` marker of a zx-vibes preview server: written into the record and
 * answered by the server's `/control/ping`, so a liveness probe can tell our
 * server from whatever else holds the port.
 */
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

/** Absolute path of the detached server's log under a project's `.zxs/` dir. */
export function previewLogPath(cwd: string): string {
  return resolve(cwd, ZXS_DIR, PREVIEW_LOG_FILE);
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
  const body = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(tmp, body, 'utf8');
  // rename is atomic within a dir, so a concurrent `--list`/`--stop` never sees a missing
  // or half-written record; fall back to a direct write if rename is unavailable.
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, body, 'utf8');
    rmSync(tmp, { force: true });
  }
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

/**
 * Liveness probe: whether a zx-vibes preview server answers `/control/ping` at
 * `baseUrl` — an HTTP 200 whose JSON `owner` is {@link PREVIEW_OWNER}. Any other
 * answer (another program that reused the port, a non-JSON page) is "not ours".
 */
export async function pingServer(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const { status, body } = await fetchWithTimeout(controlUrl(baseUrl, 'ping'), { method: 'GET' }, timeoutMs);
    if (status !== 200) return false;
    const parsed = JSON.parse(body) as { owner?: unknown } | null;
    return parsed !== null && typeof parsed === 'object' && parsed.owner === PREVIEW_OWNER;
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
    if (res.status >= 200 && res.status < 300) return 'stopped';
    if (res.status === 403) return 'foreign';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** Fetch `url` and read its body, all within `timeoutMs` (a stalled body counts too). */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { status: res.status, body: await res.text() };
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
