// The detached preview lifecycle — toolkit-runtime.md RT-PROD-PREVIEW-003/004,
// cli.md CLI-PROD-RULE-PREVIEW-OWN-001: the liveness probe only recognises a zx-vibes
// preview server; `--detach` reports a server that is already running instead of
// orphaning it; and a `--detach` that cannot start fails fast with the real error.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewServer, type PreviewServer } from '../src/preview/server.js';
import { resolvePreviewProgram } from '../src/preview/program.js';
import {
  newToken,
  pingServer,
  previewLogPath,
  readPreviewRecord,
  writePreviewRecord,
  PREVIEW_OWNER,
} from '../src/preview/lifecycle.js';
import { runPreviewDetach, runPreviewList, type PreviewParams } from '../src/preview/preview-command.js';
import { CliError } from '../src/output/envelope.js';

const openServers: PreviewServer[] = [];
const rawServers: Server[] = [];
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close().catch(() => undefined)));
  await Promise.all(rawServers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** A plain HTTP server answering every request with `status` + `body`. */
async function rawServer(status: number, body: string): Promise<string> {
  const raw = createServer((_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body);
  });
  rawServers.push(raw);
  await new Promise<void>((resolve) => raw.listen(0, '127.0.0.1', () => resolve()));
  const addr = raw.address();
  return `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

function params(cwd: string, overrides: Partial<PreviewParams> = {}): PreviewParams {
  return { cwd, blank: true, file: undefined, port: 0, strictPort: false, watch: false, ...overrides };
}

// ===========================================================================

describe('pingServer recognises only a zx-vibes preview server', () => {
  it('requires the PREVIEW_OWNER marker, not just any HTTP 200', async () => {
    expect(await pingServer(await rawServer(200, JSON.stringify({ ok: true })))).toBe(false);
    expect(await pingServer(await rawServer(200, JSON.stringify({ ok: true, owner: 'someone-else' })))).toBe(false);
    expect(await pingServer(await rawServer(200, '<html>not json</html>'))).toBe(false);
    expect(await pingServer(await rawServer(500, JSON.stringify({ owner: PREVIEW_OWNER })))).toBe(false);
    expect(await pingServer(await rawServer(200, JSON.stringify({ ok: true, owner: PREVIEW_OWNER })))).toBe(true);

    const real = await createPreviewServer({ program: resolvePreviewProgram({ blank: true }), port: 0, token: newToken() });
    openServers.push(real);
    expect(await pingServer(real.url)).toBe(true);
  });

  it('--list reports a record whose port now belongs to someone else as not running', async () => {
    const dir = tmp('zxs-preview-foreignping-');
    const url = await rawServer(200, JSON.stringify({ ok: true }));
    writePreviewRecord(dir, { pid: 1, port: Number(new URL(url).port), url, token: 't', owner: PREVIEW_OWNER });
    const list = (await runPreviewList(dir)) as unknown as { running: boolean };
    expect(list.running).toBe(false);
  });
});

describe('preview --detach', () => {
  it('reports the recorded live server as already running instead of starting (and orphaning) another', async () => {
    const dir = tmp('zxs-preview-again-');
    const token = newToken();
    const server = await createPreviewServer({ program: resolvePreviewProgram({ blank: true }), port: 0, token });
    openServers.push(server);
    const record = { pid: process.pid, port: server.port, url: server.url, token, owner: PREVIEW_OWNER };
    writePreviewRecord(dir, record);

    const result = (await runPreviewDetach(params(dir))) as unknown as Record<string, unknown>;
    expect(result).toMatchObject({ ok: true, action: 'detach', alreadyRunning: true, url: server.url, port: server.port });
    expect(String(result.note)).toContain('zxs preview --stop');
    // The record is untouched: it still names the running server.
    expect(readPreviewRecord(dir)).toMatchObject(record);
  });

  it('fails fast with the real assembler error when the project does not build', async () => {
    const dir = tmp('zxs-preview-detachbuild-');
    writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm', org: '0x8000' }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'main.asm'), '    ORG 0x8000\n    frobnicate a\n');
    const started = Date.now();
    let err: unknown;
    try {
      await runPreviewDetach(params(dir, { blank: false }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).exitCode).toBe(1);
    expect((err as CliError).message).toMatch(/build failed with 1 error\(s\)[\s\S]*src\/main\.asm:2:/);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(readPreviewRecord(dir)).toBeNull(); // nothing was spawned or recorded
  });

  it('stops waiting as soon as the detached child exits, and quotes its output', async () => {
    // A busy port with --strict-port: the child cannot bind and exits at once.
    const busyUrl = await rawServer(200, 'busy');
    const busy = Number(new URL(busyUrl).port);
    const dir = tmp('zxs-preview-childexit-');
    const started = Date.now();
    let err: unknown;
    try {
      await runPreviewDetach(params(dir, { port: busy, strictPort: true }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    const message = (err as CliError).message;
    expect(message).toMatch(/exited \(exit code 1\) before it was ready/);
    // The child's own error, read back from .zxs/preview-server.log (in an unbuilt
    // checkout the child cannot even load dist/cli.js, and says that instead).
    expect(message).toMatch(new RegExp(`port ${busy} is in use and --strict-port|runtime is incomplete`));
    expect(Date.now() - started).toBeLessThan(10_000); // not the 12 s ready timeout
    expect(previewLogPath(dir)).toBe(join(dir, '.zxs', 'preview-server.log'));
  }, 20_000);
});
