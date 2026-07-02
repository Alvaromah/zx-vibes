// `preview` command — cli.md CLI-PROD-PREVIEW-001/002, CLI-PROD-RULE-PREVIEW-PORT-001,
// CLI-PROD-RULE-PREVIEW-OWN-001, CLI-PROD-FREE-002; toolkit-runtime.md RT-PROD-PREVIEW-001..005.
//
// One verb, three modes (CLI-PROD-PREVIEW-002): default serves the built project, `--blank`
// a clean 48K boot screen, `<file>` a `.z80`/`.tap`/`.tzx` image. Plus the lifecycle flags
// `--detach`/`--list`/`--stop` over the `.zxs/preview-server.json` record (with the per-server
// ownership token), the `--watch` SSE live-reload, and `--port`/`--strict-port`. The
// in-browser emulation is the human-review handoff; this command only manages the server +
// its lifecycle (the gated surface). `--detached-child` is the Incidental internal flag
// (CLI-PROD-FREE-002) the detached child runs.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { successEnvelope, userError, type Envelope } from '../output/envelope.js';
import type { CommandContext } from '../registry.js';
import { resolveConfig } from '../config/config.js';
import { parseNumber } from '../util/address.js';
import {
  newToken,
  pingServer,
  readPreviewRecord,
  removePreviewRecord,
  stopServer,
  writePreviewRecord,
  PREVIEW_OWNER,
  type PreviewRecord,
} from './lifecycle.js';
import { resolvePreviewProgram, type PreviewProgram } from './program.js';
import { createPreviewServer, DEFAULT_PREVIEW_PORT, type PreviewServer } from './server.js';

interface PreviewCliOptions {
  blank?: boolean;
  port?: string;
  strictPort?: boolean;
  watch?: boolean;
  detach?: boolean;
  list?: boolean;
  stop?: boolean;
  detachedChild?: boolean;
}

/** Parameters the command shares with its lower-level helpers (already parsed). */
export interface PreviewParams {
  cwd: string;
  blank: boolean;
  file: string | undefined;
  port: number;
  strictPort: boolean;
  watch: boolean;
}

/** Parse a `--port` value to a valid TCP port (1..65535), defaulting when absent. */
function parsePort(input: string | undefined): number {
  if (input === undefined) return DEFAULT_PREVIEW_PORT;
  const value = parseNumber(input);
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw userError(`preview: invalid --port "${input}" (expected 1..65535)`, 'preview');
  }
  return value;
}

/** Parse the CLI context into preview parameters. */
function readParams(context: CommandContext): PreviewParams {
  const options = context.options as PreviewCliOptions;
  return {
    cwd: process.cwd(),
    blank: Boolean(options.blank),
    file: context.args[0],
    port: parsePort(options.port),
    strictPort: Boolean(options.strictPort),
    watch: Boolean(options.watch),
  };
}

/**
 * The `preview` command handler (CLI-PROD-PREVIEW-002). Dispatches the lifecycle verbs
 * (`--list`/`--stop`/the detached child) and the serve modes (`--detach` vs foreground).
 */
export async function previewCommand(context: CommandContext): Promise<Envelope> {
  const options = context.options as PreviewCliOptions;

  if (options.list) return runPreviewList(process.cwd());
  if (options.stop) return runPreviewStop(process.cwd());

  const params = readParams(context);
  if (options.detachedChild) return runDetachedChild(params);
  if (options.detach) return runPreviewDetach(params);
  return runPreviewForeground(params);
}

// --- list / stop -----------------------------------------------------------

/** `preview --list`: report the recorded detached server and whether it is live (RT-PROD-PREVIEW-003). */
export async function runPreviewList(cwd: string): Promise<Envelope> {
  const record = readPreviewRecord(cwd);
  if (!record) {
    return successEnvelope('preview', { action: 'list', running: false, server: null });
  }
  const running = await pingServer(record.url);
  return successEnvelope('preview', {
    action: 'list',
    running,
    server: { pid: record.pid, port: record.port, url: record.url, owner: record.owner },
  });
}

/**
 * `preview --stop`: stop the recorded server, proving ownership with its recorded token
 * (RT-PROD-PREVIEW-004 / CLI-PROD-RULE-PREVIEW-OWN-001). A missing record or a foreign token
 * is a USER_ERROR (exit 1); a stale record (server already gone) is cleared and reported.
 */
export async function runPreviewStop(cwd: string): Promise<Envelope> {
  const record = readPreviewRecord(cwd);
  if (!record) {
    throw userError('preview --stop: no recorded preview server to stop (.zxs/preview-server.json absent).', 'preview');
  }
  const outcome = await stopServer(record.url, record.token);
  if (outcome === 'foreign') {
    throw userError(
      `preview --stop: the server at ${record.url} rejected the recorded ownership token ` +
        '(a foreign server holds that port). Not stopping it.',
      'preview',
    );
  }
  if (outcome === 'unreachable') {
    // The recorded server is not answering — a stale record. Clear it; nothing to stop.
    removePreviewRecord(cwd);
    return successEnvelope('preview', {
      action: 'stop',
      stopped: false,
      port: record.port,
      note: 'recorded server was not running; cleared the stale record',
    });
  }
  removePreviewRecord(cwd);
  return successEnvelope('preview', { action: 'stop', stopped: true, port: record.port, url: record.url });
}

// --- serve modes -----------------------------------------------------------

/** Build the server options for a serve mode (shared by foreground + detached child). */
async function startServer(params: PreviewParams, token: string, onStop: (() => void) | undefined): Promise<{
  server: PreviewServer;
  program: PreviewProgram;
}> {
  const program = resolvePreviewProgram({ cwd: params.cwd, blank: params.blank, file: params.file });
  const watchPaths = params.watch ? watchPathsFor(params) : undefined;
  const rebuild = params.watch
    ? (): PreviewProgram => resolvePreviewProgram({ cwd: params.cwd, blank: params.blank, file: params.file })
    : undefined;
  const server = await createPreviewServer({
    program,
    port: params.port,
    strictPort: params.strictPort,
    token,
    ...(watchPaths ? { watchPaths } : {}),
    ...(rebuild ? { rebuild } : {}),
    ...(onStop ? { onStop } : {}),
  });
  return { server, program };
}

/**
 * `preview` (foreground): serve until interrupted. Prints a readiness notice to stderr (the
 * blocking dev-server convention; the JSON channel stays clean) and blocks on SIGINT/SIGTERM,
 * then returns the stop envelope. Not part of the gated surface (the gate uses `--detach`).
 */
async function runPreviewForeground(params: PreviewParams): Promise<Envelope> {
  const token = newToken();
  // Start FIRST (and await): a `.sna`/build/port failure rejects here and the dispatcher
  // renders it as a clean `{ ok:false, stage:"preview", error }` envelope — not an
  // unhandled rejection (ERR-PROD-NOSILENT-001).
  const { server } = await startServer(params, token, undefined);
  process.stderr.write(`preview: serving at ${server.url} (Ctrl-C to stop)\n`);
  // Then block until interrupted (the dev-server convention).
  await new Promise<void>((resolveBlock) => {
    const shutdown = (): void => {
      void server.close().then(() => resolveBlock());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return successEnvelope('preview', { action: 'served', port: server.port });
}

/**
 * `--detached-child` (Incidental internal, CLI-PROD-FREE-002): the detached child process.
 * Starts the server, records `{ pid, port, url, token, owner }` (RT-PROD-PREVIEW-003), and
 * keeps running (never resolves) until a token-verified `/control/stop` removes the record and
 * exits. Its stdout is ignored by the parent, so it prints nothing.
 */
async function runDetachedChild(params: PreviewParams): Promise<Envelope> {
  const token = newToken();
  const onStop = (): void => {
    removePreviewRecord(params.cwd);
    process.exit(0);
  };
  const { server } = await startServer(params, token, onStop);
  const record: PreviewRecord = {
    pid: process.pid,
    port: server.port,
    url: server.url,
    token,
    owner: PREVIEW_OWNER,
    startedAt: new Date().toISOString(),
  };
  writePreviewRecord(params.cwd, record);
  // Also clean up on a direct kill of the child.
  const cleanup = (): void => {
    removePreviewRecord(params.cwd);
    process.exit(0);
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  // Keep the child alive; the server's listening handle holds the event loop open.
  return new Promise<Envelope>(() => {
    /* never resolves — the child serves until stopped */
  });
}

/**
 * `preview --detach`: spawn a detached child that runs the server, wait for it to record
 * `.zxs/preview-server.json` (RT-PROD-PREVIEW-003) and answer its control endpoint, then print
 * the record and exit — leaving the server running.
 */
async function runPreviewDetach(params: PreviewParams): Promise<Envelope> {
  const bin = findCliBin();
  const childArgs = [bin, 'preview', '--detached-child', '--port', String(params.port)];
  if (params.blank) childArgs.push('--blank');
  if (params.strictPort) childArgs.push('--strict-port');
  if (params.watch) childArgs.push('--watch');
  if (params.file !== undefined) childArgs.push(params.file);

  const child = spawn(process.execPath, childArgs, {
    cwd: params.cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const record = await waitForChildRecord(params.cwd, child.pid ?? -1, 12000);
  if (!record) {
    try {
      if (child.pid) process.kill(child.pid);
    } catch {
      /* best effort */
    }
    throw userError(
      'preview --detach: the detached server did not report ready in time ' +
        '(no .zxs/preview-server.json). Check the project builds and the port is bindable.',
      'preview',
    );
  }
  return successEnvelope('preview', {
    action: 'detach',
    detached: true,
    pid: record.pid,
    port: record.port,
    url: record.url,
    owner: record.owner,
  });
}

/** Poll for the detached child's record (matching its pid) + a live server, up to `timeoutMs`. */
async function waitForChildRecord(cwd: string, childPid: number, timeoutMs: number): Promise<PreviewRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = readPreviewRecord(cwd);
    if (record && (childPid < 0 || record.pid === childPid) && (await pingServer(record.url))) {
      return record;
    }
    await delay(150);
  }
  return null;
}

// --- helpers ---------------------------------------------------------------

/** The source files `--watch` polls for the current mode (RT-PROD-PREVIEW-005). */
function watchPathsFor(params: PreviewParams): string[] {
  if (params.file !== undefined) {
    return [resolve(params.cwd, params.file)];
  }
  if (params.blank) return []; // nothing to rebuild for a blank boot screen
  // Default mode: the configured entry, the project config, and sibling .asm sources.
  const resolved = resolveConfig({ cwd: params.cwd });
  const paths = new Set<string>();
  paths.add(resolve(params.cwd, 'zx.config.json'));
  if (resolved.entry) {
    const entry = resolve(params.cwd, resolved.entry);
    paths.add(entry);
    const dir = dirname(entry);
    try {
      for (const name of readdirSync(dir)) {
        if (extname(name).toLowerCase() === '.asm') paths.add(join(dir, name));
      }
    } catch {
      /* entry dir unreadable — just watch the entry + config */
    }
  }
  return [...paths];
}

/** Locate the `zxs` CLI bin (`bin/zxs.js`) by walking up from this module (built or src). */
function findCliBin(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'bin', 'zxs.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw userError('preview --detach: could not locate the zxs CLI bin to spawn the detached server.', 'preview');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Declare the `preview` command's modes + flags (CLI-PROD-PREVIEW-002). */
export function configurePreviewCommand(command: Command): void {
  command
    .description('Build + serve the project in the bundled core player (the human-review handoff)')
    .argument('[file]', 'serve a .z80 snapshot or a .tap/.tzx tape image (legacy `play` mode)')
    .option('--blank', 'serve a clean 48K boot screen (legacy `boot` mode)')
    .option('--port <n>', `HTTP port (default ${DEFAULT_PREVIEW_PORT})`)
    .option('--strict-port', 'fail instead of falling back when the port is busy')
    .option('--watch', 'poll the source and live-reload the player on a change (SSE)')
    .option('--detach', 'run the server in a detached background process')
    .option('--list', 'report the recorded detached preview server')
    .option('--stop', 'stop the recorded detached preview server (ownership-token verified)')
    .option('--detached-child', 'internal: the detached server worker (do not use directly)')
    .option('--json', 'emit a single machine-readable JSON envelope');
}

// `previewCommand` returns an `Envelope` (async). This assertion documents the contract.
const _envelopeCheck: (c: CommandContext) => Promise<Envelope> = previewCommand;
void _envelopeCheck;
