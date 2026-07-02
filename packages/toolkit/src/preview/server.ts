// Preview HTTP server — cli.md CLI-PROD-PREVIEW-001/002, CLI-PROD-RULE-PREVIEW-PORT-001,
// CLI-PROD-RULE-PREVIEW-OWN-001; toolkit-runtime.md RT-PROD-PREVIEW-001..005.
//
// Serves the bundled CORE player + the resolved program over HTTP bound to 127.0.0.1
// (RT-PROD-PREVIEW-001). It implements:
//   - PORT FALLBACK (CLI-PROD-RULE-PREVIEW-PORT-001 / RT-PROD-PREVIEW-002): try the
//     requested port; unless `--strict-port`, fall back to the next free port up to a
//     bounded number of attempts; `--strict-port` fails instead.
//   - the bundled-player routes: `/` (HTML), `/player.js` (the browser bundle), `/rom`
//     (the 48K ROM the player boots), `/program.json` + `/program.bin` (the served program).
//   - the `--watch` SSE stream (RT-PROD-PREVIEW-005): `/events` pushes a `reload` event on a
//     source change.
//   - the ownership-token control endpoint (RT-PROD-PREVIEW-004): `/control/ping` (liveness)
//     and `/control/stop` (token-gated shutdown — a foreign token is HTTP 403).
//
// The server is created in-process and is fully testable (no spawn); the CLI `--detach`
// path runs this same server in a detached child (preview-command.ts).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadRom } from '../runtime/rom.js';
import { userError } from '../output/envelope.js';
import { programMeta, type PreviewProgram } from './program.js';
import { playerBundleExists, playerHtml, readPlayerBundle } from './player-asset.js';
import { baseUrlFor } from './lifecycle.js';
import { SourceWatcher } from './watch.js';

/** Default preview port (CLI-PROD-PREVIEW-002). */
export const DEFAULT_PREVIEW_PORT = 5173;
/** Bounded port-fallback attempts (CLI-PROD-RULE-PREVIEW-PORT-001 — the count is Incidental). */
export const DEFAULT_PORT_ATTEMPTS = 20;
/** Loopback host (RT-PROD-PREVIEW-001). */
export const PREVIEW_HOST = '127.0.0.1';

export interface PreviewServerOptions {
  /** The resolved program to serve (project / blank / file). */
  program: PreviewProgram;
  /** Requested port (default {@link DEFAULT_PREVIEW_PORT}). */
  port?: number | undefined;
  /** Fail instead of falling back when the requested port is busy (CLI-PROD-RULE-PREVIEW-PORT-001). */
  strictPort?: boolean | undefined;
  /** Max port-fallback attempts (default {@link DEFAULT_PORT_ATTEMPTS}). */
  maxPortAttempts?: number | undefined;
  /** The per-server ownership token (default: a fresh UUID supplied by the caller). */
  token: string;
  /** When set, enables `--watch`: these source files are polled and a change pushes a reload. */
  watchPaths?: string[] | undefined;
  /** Poll interval for `--watch` (default 500 ms via {@link SourceWatcher}). */
  watchIntervalMs?: number | undefined;
  /**
   * Optional rebuild hook run before a reload broadcast (default mode rebuilds the project).
   * Returning a fresh {@link PreviewProgram} swaps what the server serves, so the player's
   * post-reload `/program.*` fetch reflects the rebuilt bytes.
   */
  rebuild?: (() => PreviewProgram | void) | undefined;
  /** Invoked when a token-verified `/control/stop` arrives (e.g. remove the record + exit). */
  onStop?: (() => void) | undefined;
}

export interface PreviewServer {
  /** The actually-bound port (may differ from the request after fallback). */
  readonly port: number;
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** The ownership token (RT-PROD-PREVIEW-003). */
  readonly token: string;
  /** Number of connected SSE clients (test/diagnostic). */
  sseClientCount(): number;
  /** Force a reload broadcast (rebuild first if a hook was set) — what `--watch` calls. */
  broadcastReload(): void;
  /** Stop the server, the watcher, and all SSE streams (no leaked handles). */
  close(): Promise<void>;
}

/**
 * Create and start a preview server (RT-PROD-PREVIEW-001). Binds 127.0.0.1 on the requested
 * port with bounded fallback (or fails on `--strict-port`), wires the routes + SSE + the
 * optional source watcher, and resolves once listening.
 */
export async function createPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  if (!playerBundleExists()) {
    throw userError(
      'preview: the bundled player (assets/preview/player.js) is missing. ' +
        'Run `pnpm --filter @zx-vibes/toolkit run build` to produce it.',
      'preview',
    );
  }

  // The served program is mutable so a `--watch` rebuild can swap in fresh bytes.
  const holder: { program: PreviewProgram } = { program: options.program };
  const requestedPort = options.port ?? DEFAULT_PREVIEW_PORT;
  const maxAttempts = options.strictPort ? 1 : options.maxPortAttempts ?? DEFAULT_PORT_ATTEMPTS;
  const romBytes = loadRom();

  const sseClients = new Set<ServerResponse>();
  let watcher: SourceWatcher | undefined;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const server = createServer((req, res) => {
    handleRequest(req, res, {
      holder,
      romBytes,
      token: options.token,
      sseClients,
      onStop: () => {
        // Token-verified stop: let the owner react (remove record / exit), then close.
        options.onStop?.();
        void serverHandle.close();
      },
    });
  });

  // Keep SSE connections alive (and prove the stream is open) with a periodic comment ping.
  keepAlive = setInterval(() => {
    for (const client of sseClients) client.write(': ping\n\n');
  }, 15000);
  if (typeof keepAlive.unref === 'function') keepAlive.unref();

  let port: number;
  try {
    port = await listenWithFallback(server, requestedPort, maxAttempts, Boolean(options.strictPort));
  } catch (error) {
    // Listen failed (busy + strict-port, or exhausted fallback): release the keep-alive
    // timer so a failed start leaks no handles, then surface the user error.
    if (keepAlive) clearInterval(keepAlive);
    throw error;
  }

  const broadcastReload = (): void => {
    if (options.rebuild) {
      try {
        const next = options.rebuild();
        if (next) holder.program = next; // serve the rebuilt bytes after reload
      } catch {
        // A failed rebuild still reloads the page (the player surfaces the error state).
      }
    }
    for (const client of sseClients) {
      client.write('event: reload\n');
      client.write(`data: ${JSON.stringify({ at: Date.now() })}\n\n`);
    }
  };

  if (options.watchPaths && options.watchPaths.length > 0) {
    watcher = new SourceWatcher(options.watchPaths, broadcastReload, options.watchIntervalMs).start();
  }

  const serverHandle: PreviewServer = {
    port,
    url: baseUrlFor(port),
    token: options.token,
    sseClientCount: () => sseClients.size,
    broadcastReload,
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) {
          resolve();
          return;
        }
        closed = true;
        watcher?.stop();
        if (keepAlive) clearInterval(keepAlive);
        for (const client of sseClients) {
          try {
            client.end();
          } catch {
            /* already closed */
          }
        }
        sseClients.clear();
        server.close(() => resolve());
        // server.close() waits for in-flight connections; SSE clients are ended above.
      }),
  };

  return serverHandle;
}

interface RequestContext {
  holder: { program: PreviewProgram };
  romBytes: Uint8Array;
  token: string;
  sseClients: Set<ServerResponse>;
  onStop: () => void;
}

function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  const program = ctx.holder.program;

  if (method === 'GET' && (path === '/' || path === '/index.html')) {
    return sendText(res, 200, 'text/html; charset=utf-8', playerHtml(program.label));
  }
  if (method === 'GET' && path === '/player.js') {
    try {
      return sendText(res, 200, 'text/javascript; charset=utf-8', readPlayerBundle());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return sendText(res, 500, 'text/plain; charset=utf-8', `// preview player unavailable: ${reason}`);
    }
  }
  if (method === 'GET' && path === '/rom') {
    return sendBytes(res, 200, 'application/octet-stream', ctx.romBytes);
  }
  if (method === 'GET' && path === '/program.json') {
    return sendJson(res, 200, programMeta(program));
  }
  if (method === 'GET' && path === '/program.bin') {
    return sendBytes(res, 200, 'application/octet-stream', program.bytes);
  }
  if (method === 'GET' && path === '/events') {
    return openSseStream(req, res, ctx.sseClients);
  }
  if (method === 'GET' && path === '/control/ping') {
    return sendJson(res, 200, { ok: true, owner: 'zx-vibes-preview' });
  }
  if (method === 'POST' && path === '/control/stop') {
    return handleStop(req, res, ctx);
  }
  return sendJson(res, 404, { ok: false, error: 'not found' });
}

/** The token-gated shutdown endpoint (RT-PROD-PREVIEW-004): a foreign token is HTTP 403. */
function handleStop(req: IncomingMessage, res: ServerResponse, ctx: RequestContext): void {
  readBody(req)
    .then((body) => {
      let token: unknown;
      try {
        token = (JSON.parse(body || '{}') as { token?: unknown }).token;
      } catch {
        token = undefined;
      }
      if (typeof token !== 'string' || token !== ctx.token) {
        return sendJson(res, 403, { ok: false, error: 'foreign or missing ownership token' });
      }
      sendJson(res, 200, { ok: true, stopped: true });
      // Shut down after the response flushes.
      res.on('finish', () => ctx.onStop());
    })
    .catch(() => sendJson(res, 400, { ok: false, error: 'bad request' }));
}

/** Open an SSE stream and register the client; deregister on close. */
function openSseStream(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 1000\n');
  res.write(': connected\n\n');
  clients.add(res);
  const drop = (): void => {
    clients.delete(res);
  };
  req.on('close', drop);
  res.on('close', drop);
}

/**
 * Listen on the loopback host, trying `requested`, `requested+1`, … up to `maxAttempts`
 * (CLI-PROD-RULE-PREVIEW-PORT-001). A busy port (`EADDRINUSE`/`EACCES`) advances to the next;
 * exhausting the attempts — or `strictPort` on the first conflict — is a USER_ERROR (exit 1,
 * RT-PROD-ERR-001).
 */
async function listenWithFallback(
  server: Server,
  requested: number,
  maxAttempts: number,
  strictPort: boolean,
): Promise<number> {
  let lastError: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = requested + attempt;
    try {
      await tryListen(server, PREVIEW_HOST, port);
      // Read the ACTUAL bound port from the socket (correct for an ephemeral `port: 0`
      // request, and identical to `port` for a concrete request).
      const address = server.address();
      return address && typeof address === 'object' ? (address as AddressInfo).port : port;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      lastError = err;
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
        throw userError(`preview: failed to bind ${PREVIEW_HOST}:${port}: ${err.message}`, 'preview');
      }
      if (strictPort) {
        throw userError(
          `preview: port ${requested} is in use and --strict-port was set (no fallback).`,
          'preview',
        );
      }
    }
  }
  throw userError(
    `preview: could not find a free port in ${maxAttempts} attempts from ${requested} ` +
      `(last error: ${lastError?.code ?? 'unknown'}).`,
    'preview',
  );
}

function tryListen(server: Server, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendText(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-cache' });
  res.end(body);
}

function sendBytes(res: ServerResponse, status: number, contentType: string, body: Uint8Array): void {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-cache' });
  res.end(Buffer.from(body));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(body));
}
