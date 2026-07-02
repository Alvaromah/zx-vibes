// Preview server + lifecycle integration — cli.md CLI-PROD-PREVIEW-001/002,
// CLI-PROD-RULE-PREVIEW-PORT-001, CLI-PROD-RULE-PREVIEW-OWN-001; toolkit-runtime.md
// RT-PROD-PREVIEW-001..005.
//
// These are SERVER-LEVEL, deterministic tests (the gated surface): the in-browser
// emulation is the human-review handoff and is NOT exercised here. Every server/timer/SSE
// stream is torn down (no leaked handles). They prove: `GET /` serves the player HTML; the
// player JS bundle + the program payload (+ the ROM) are served; PORT FALLBACK picks a new
// port when the requested one is busy and `--strict-port` errors instead; the
// `.zxs/preview-server.json` lifecycle (record → list → token-gated stop); the `--watch` SSE
// stream emits a reload on a source change; and `preview <file.sna>` fails loud.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewServer, type PreviewServer } from '../src/preview/server.js';
import { resolvePreviewProgram } from '../src/preview/program.js';
import {
  newToken,
  writePreviewRecord,
  readPreviewRecord,
  PREVIEW_OWNER,
} from '../src/preview/lifecycle.js';
import { runPreviewList, runPreviewStop } from '../src/preview/preview-command.js';
import { CliError } from '../src/output/envelope.js';

// --- teardown bookkeeping --------------------------------------------------
const openServers: PreviewServer[] = [];
const rawServers: Server[] = [];
const tmpDirs: string[] = [];
const aborters: AbortController[] = [];

afterEach(async () => {
  for (const c of aborters.splice(0)) c.abort();
  await Promise.all(openServers.splice(0).map((s) => s.close().catch(() => undefined)));
  await Promise.all(
    rawServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** Start a preview server on an ephemeral port (0) and register it for teardown. */
async function startServer(
  overrides: Partial<Parameters<typeof createPreviewServer>[0]> = {},
): Promise<PreviewServer> {
  const program = overrides.program ?? resolvePreviewProgram({ blank: true });
  const server = await createPreviewServer({
    program,
    port: 0,
    token: overrides.token ?? newToken(),
    ...overrides,
  });
  openServers.push(server);
  return server;
}

/** Occupy a concrete port with a raw server, returning that port (for the fallback test). */
async function occupyPort(): Promise<number> {
  const raw = createServer((_req, res) => res.end('busy'));
  rawServers.push(raw);
  await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', () => resolve()));
  const addr = raw.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

// ===========================================================================

describe('preview server — serves the bundled player + program (RT-PROD-PREVIEW-001)', () => {
  it('GET / returns 200 with the player HTML hosting a <canvas> and the module script', async () => {
    const server = await startServer();
    const res = await fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<canvas id="screen"');
    expect(html).toContain('player.js');
  });

  it('serves the bundled browser player JS (the reconstructed cores, not the legacy emulator)', async () => {
    const server = await startServer();
    const res = await fetch(`${server.url}/player.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const js = await res.text();
    expect(js.length).toBeGreaterThan(1000);
    // The bundle inlines the reconstructed machine (a core symbol), never the legacy emulator.
    expect(js).not.toContain('@zx-vibes/emulator');
  });

  it('serves the 48K ROM the player boots (16384 bytes)', async () => {
    const server = await startServer();
    const res = await fetch(`${server.url}/rom`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(16384);
  });

  it('serves the program metadata + bytes for the blank and file modes (CLI-PROD-PREVIEW-002)', async () => {
    // Blank mode: a clean boot screen, no bytes.
    const blank = await startServer();
    const meta = await (await fetch(`${blank.url}/program.json`)).json();
    expect(meta).toMatchObject({ mode: 'blank', kind: 'blank', byteLength: 0 });

    // File mode: a raw .bin served at the configured org.
    const dir = tmp('zxs-preview-bin-');
    const binBytes = Uint8Array.from([0xaf, 0xc9]); // XOR A : RET
    writeFileSync(join(dir, 'p.bin'), binBytes);
    const program = resolvePreviewProgram({ cwd: dir, file: 'p.bin' });
    const server = await startServer({ program });
    const fileMeta = await (await fetch(`${server.url}/program.json`)).json();
    expect(fileMeta).toMatchObject({ mode: 'file', kind: 'bin', byteLength: 2, org: 0x8000 });
    const served = new Uint8Array(await (await fetch(`${server.url}/program.bin`)).arrayBuffer());
    expect([...served]).toEqual([...binBytes]);
  });
});

describe('preview server — port fallback (CLI-PROD-RULE-PREVIEW-PORT-001 / RT-PROD-PREVIEW-002)', () => {
  it('falls back to a free port when the requested one is busy', async () => {
    const busy = await occupyPort();
    const server = await startServer({ port: busy });
    expect(server.port).not.toBe(busy);
    expect(server.port).toBeGreaterThanOrEqual(busy + 1);
    // The fallen-back server is actually serving.
    expect((await fetch(`${server.url}/control/ping`)).status).toBe(200);
  });

  it('--strict-port fails (USER_ERROR) instead of falling back', async () => {
    const busy = await occupyPort();
    await expect(startServer({ port: busy, strictPort: true })).rejects.toBeInstanceOf(CliError);
  });

  it('two preview servers requesting the same port coexist, each with its own token (RT-PROD-EDGE-003)', async () => {
    const a = await startServer({ port: 0 });
    const b = await startServer({ port: a.port }); // requests A's port → falls back
    expect(b.port).not.toBe(a.port);
    expect(a.token).not.toBe(b.token);
    expect((await fetch(`${a.url}/control/ping`)).status).toBe(200);
    expect((await fetch(`${b.url}/control/ping`)).status).toBe(200);
  });
});

describe('preview lifecycle — record / list / token-gated stop (RT-PROD-PREVIEW-003/004)', () => {
  it('--list reports a recorded live server; --stop verifies the token, stops it, removes the record', async () => {
    const dir = tmp('zxs-preview-life-');
    let stopped = false;
    const token = newToken();
    const server = await startServer({ token, onStop: () => { stopped = true; } });
    writePreviewRecord(dir, {
      pid: process.pid,
      port: server.port,
      url: server.url,
      token,
      owner: PREVIEW_OWNER,
    });

    // --list sees it live.
    const list = (await runPreviewList(dir)) as unknown as { running: boolean; server: { port: number } };
    expect(list.running).toBe(true);
    expect(list.server.port).toBe(server.port);

    // --stop owns the token → stops + removes the record.
    const stop = (await runPreviewStop(dir)) as unknown as { ok: boolean; stopped: boolean };
    expect(stop.stopped).toBe(true);
    expect(readPreviewRecord(dir)).toBeNull();
    // The server's onStop fired (the control endpoint shut it down).
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped).toBe(true);
  });

  it('--stop with a FOREIGN token is a USER_ERROR and does not stop the server (CLI-PROD-RULE-PREVIEW-OWN-001)', async () => {
    const dir = tmp('zxs-preview-foreign-');
    const server = await startServer({ token: newToken() });
    // Record a DIFFERENT token than the server actually holds.
    writePreviewRecord(dir, {
      pid: process.pid,
      port: server.port,
      url: server.url,
      token: 'not-the-real-token',
      owner: PREVIEW_OWNER,
    });
    await expect(runPreviewStop(dir)).rejects.toBeInstanceOf(CliError);
    // The server is untouched (the foreign token was rejected).
    expect((await fetch(`${server.url}/control/ping`)).status).toBe(200);
  });

  it('--stop with no recorded server is a USER_ERROR (exit 1)', async () => {
    const dir = tmp('zxs-preview-norec-');
    await expect(runPreviewStop(dir)).rejects.toBeInstanceOf(CliError);
  });

  it('--list with no recorded server reports running:false (informational, not an error)', async () => {
    const dir = tmp('zxs-preview-nolist-');
    const list = (await runPreviewList(dir)) as unknown as { ok: boolean; running: boolean; server: unknown };
    expect(list.ok).toBe(true);
    expect(list.running).toBe(false);
    expect(list.server).toBeNull();
  });
});

describe('preview control endpoint — token gate (RT-PROD-PREVIEW-004)', () => {
  it('POST /control/stop rejects a wrong token (403) and accepts the right one (200)', async () => {
    const token = newToken();
    const server = await startServer({ token });

    const bad = await fetch(`${server.url}/control/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' }),
    });
    expect(bad.status).toBe(403);
    // Still alive after the rejected stop.
    expect((await fetch(`${server.url}/control/ping`)).status).toBe(200);

    const good = await fetch(`${server.url}/control/stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(good.status).toBe(200);
  });
});

describe('preview --watch — SSE live reload on a source change (RT-PROD-PREVIEW-005)', () => {
  it('emits a reload event over /events when a watched source changes', async () => {
    const dir = tmp('zxs-preview-watch-');
    const src = join(dir, 'main.asm');
    writeFileSync(src, 'ORG 0x8000\n ret\n');

    const server = await startServer({
      watchPaths: [src],
      watchIntervalMs: 40,
    });

    const ac = new AbortController();
    aborters.push(ac);
    const res = await fetch(`${server.url}/events`, {
      headers: { accept: 'text/event-stream' },
      signal: ac.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Wait for the connection preamble, then mutate the source to trigger a reload.
    let buffer = '';
    const first = await reader.read();
    buffer += decoder.decode(first.value, { stream: true });

    // Change the watched file (a new mtime/size) → the ~40ms poller pushes a reload.
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(src, 'ORG 0x8000\n nop\n ret\n');

    const sawReload = await Promise.race([
      (async () => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          if (buffer.includes('event: reload')) return true;
        }
        return false;
      })(),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3500)),
    ]);

    await reader.cancel().catch(() => undefined);
    expect(sawReload).toBe(true);
  });
});

describe('preview <file.sna> — fails loud (tracked core-codec gap)', () => {
  it('resolving an .sna program throws a USER_ERROR naming the missing core codec', () => {
    let err: unknown;
    try {
      resolvePreviewProgram({ file: 'snapshot.sna' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toMatch(/\.sna codec/i);
  });
});
