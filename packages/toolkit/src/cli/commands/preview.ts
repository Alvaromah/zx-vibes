import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { build } from '../../build/sjasmplus.js';
import { loadSnapshotMachine } from '../../core/snapshot.js';
import { writeZ80v1 } from '../../core/state.js';
import { EXIT, emit, emitCliError, parseAddress, parsePort, userError } from '../output.js';
import { bootCachedMachine, BOOT_FRAMES } from '../session.js';
import {
  configuredAssembler,
  configuredEntry,
  configuredOrg,
  configuredOutDir,
  loadProjectConfig,
  resolveProjectPath,
} from '../config.js';

const require = createRequire(import.meta.url);

export interface PreviewCommandOptions {
  port: string;
  strictPort: boolean;
  watch: boolean;
  list?: boolean;
  stop?: boolean;
  detach?: boolean;
  detachedChild?: boolean;
  json: boolean;
}

export interface PlayCommandOptions {
  port: string;
  strictPort: boolean;
  json: boolean;
}

interface PreviewBuild {
  buildId: string;
  builtAt: string;
  outputs: { bin?: string; sld?: string };
  bootFrames: number;
}

interface PreviewServerRecord {
  pid: number;
  port: number;
  requestedPort: number;
  url: string;
  startedAt: string;
  watch: boolean;
  buildId?: string;
}

const WATCH_EXTENSIONS = new Set(['.asm', '.inc', '.bin', '.json']);
const WATCH_SKIP_DIRS = new Set(['.git', '.zxs', 'build', 'dist', 'node_modules']);
const PREVIEW_HOST = '127.0.0.1';
const MAX_PORT_FALLBACK_ATTEMPTS = 20;
const PREVIEW_SERVER_RECORD = join('.zxs', 'preview-server.json');

interface PreviewListenResult {
  port: number;
  requestedPort: number;
}

interface PreviewListenOptions {
  host?: string;
  strictPort?: boolean;
  maxAttempts?: number;
}

type BrowserPlayerStage = 'boot' | 'play';
type PlayerMode = 'snapshot' | 'tape';

interface BrowserPlayerServeOptions {
  stage: BrowserPlayerStage;
  playDir: string;
  mode: PlayerMode;
  opts: PlayCommandOptions;
  file?: string;
  boot?: { mode: 'fresh-rom-cache'; frames: number };
}

export async function previewCommand(opts: PreviewCommandOptions): Promise<number> {
  if (opts.list) return previewListCommand(opts);
  if (opts.stop) return previewStopCommand(opts);
  if (opts.detach && !opts.detachedChild) return previewDetachCommand(opts);

  const requestedPort = parsePort(opts.port);
  const loaded = loadProjectConfig();
  const entry = configuredEntry(undefined, loaded.config);
  if (!entry) {
    throw userError('No entry configured. Add "entry" to zx.config.json or run zxs build <file>.', 'preview');
  }

  const assembler = configuredAssembler(undefined, loaded.config);
  if (!assembler) {
    throw userError(`Unknown assembler backend: ${loaded.config.assembler}`, 'preview');
  }

  const outDir = configuredOutDir(undefined, loaded.config);
  const previewDir = join('.zxs', 'preview');
  mkdirSync(previewDir, { recursive: true });

  const emulatorPkg = dirname(require.resolve('@zx-vibes/emulator/package.json'));
  const emulatorBundle = join(emulatorPkg, 'dist', 'zxgeneration.esm.js');
  if (!existsSync(emulatorBundle)) {
    throw userError('Emulator browser bundle is missing. Run pnpm --filter @zx-vibes/emulator build first.', 'preview');
  }

  const initialBuild = await writePreviewBuild({
    entry,
    outDir,
    assembler,
    previewDir,
    org: configuredOrg(undefined, loaded.config),
    watch: opts.watch,
  });
  if (!initialBuild) {
    const result = await build(resolveProjectPath(entry), { outDir, assembler });
    emit({ ok: false, stage: 'preview', build: result }, opts.json, () => 'Build failed; preview not started');
    return EXIT.USER_ERROR;
  }
  let currentBuild: PreviewBuild = initialBuild;

  const files = new Map<string, string>([
    ['/', join(previewDir, 'index.html')],
    ['/index.html', join(previewDir, 'index.html')],
    ['/game.z80', join(previewDir, 'game.z80')],
    ['/preview.json', join(previewDir, 'preview.json')],
    ['/48k.rom', join(emulatorPkg, 'rom', '48k.rom')],
    ['/zxgeneration.esm.js', emulatorBundle],
  ]);

  const clients = new Set<ServerResponse>();
  let selectedPort = requestedPort;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${PREVIEW_HOST}:${selectedPort}`);
    if (opts.watch && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: build\ndata: ${JSON.stringify(currentBuild)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const file = files.get(url.pathname);
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = file.endsWith('.html')
      ? 'text/html'
      : file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });

  let watchTimer: NodeJS.Timeout | undefined;
  const startWatcher = () => {
    if (!opts.watch) return;
    let lastSourceHash = hashPreviewInputs(process.cwd());
    watchTimer = setInterval(async () => {
      const sourceHash = hashPreviewInputs(process.cwd());
      if (sourceHash === lastSourceHash) return;
      lastSourceHash = sourceHash;
      const nextBuild = await writePreviewBuild({
        entry,
        outDir,
        assembler,
        previewDir,
        org: configuredOrg(undefined, loaded.config),
        watch: true,
      });
      if (!nextBuild) {
        console.error('zxs preview: rebuild failed; keeping previous snapshot');
        return;
      }
      currentBuild = nextBuild;
      for (const client of clients) {
        client.write(`event: reload\ndata: ${JSON.stringify(currentBuild)}\n\n`);
      }
    }, 500);
    server.once('close', () => {
      if (watchTimer) clearInterval(watchTimer);
    });
  };

  return await new Promise<number>((resolve) => {
    listenWithPortFallback(server, requestedPort, { host: PREVIEW_HOST, strictPort: opts.strictPort })
      .then((listen) => {
        selectedPort = listen.port;
        startWatcher();
        const record = writePreviewServerRecord({
          pid: process.pid,
          port: selectedPort,
          requestedPort,
          url: `http://${PREVIEW_HOST}:${selectedPort}/`,
          startedAt: new Date().toISOString(),
          watch: opts.watch,
          buildId: currentBuild.buildId,
        });
        server.once('close', () => clearPreviewServerRecord(record.pid));
        emit(
          {
            ok: true,
            stage: 'preview',
            url: `http://${PREVIEW_HOST}:${selectedPort}/`,
            port: selectedPort,
            requestedPort,
            portFallback: selectedPort !== requestedPort,
            watch: opts.watch,
            buildId: currentBuild.buildId,
            builtAt: currentBuild.builtAt,
            boot: { mode: 'fresh-rom-cache', frames: currentBuild.bootFrames },
            build: currentBuild.outputs,
          },
          opts.json,
          () =>
            [
              selectedPort !== requestedPort
                ? `WARNING: requested preview port ${requestedPort} was busy; using ${selectedPort}`
                : undefined,
              `Preview running at http://${PREVIEW_HOST}:${selectedPort}/` +
                ` (build ${currentBuild.buildId}${opts.watch ? ', watching' : ''})`,
            ]
              .filter((line): line is string => line !== undefined)
              .join('\n')
        );
        resolve(EXIT.OK);
      })
      .catch((err: unknown) => {
        resolve(emitCliError(err, opts.json, 'preview'));
      });
  });
}

export async function playCommand(file: string, opts: PlayCommandOptions): Promise<number> {
  const playDir = preparePlayerDir();
  const mode = preparePlayable(file, playDir);
  return serveBrowserPlayer({ stage: 'play', playDir, mode, opts, file });
}

export async function bootCommand(opts: PlayCommandOptions): Promise<number> {
  const playDir = preparePlayerDir();
  prepareCleanBoot(playDir);
  return serveBrowserPlayer({
    stage: 'boot',
    playDir,
    mode: 'snapshot',
    opts,
    boot: { mode: 'fresh-rom-cache', frames: BOOT_FRAMES },
  });
}

function preparePlayerDir(): string {
  const playDir = join('.zxs', 'play');
  mkdirSync(playDir, { recursive: true });
  return playDir;
}

async function serveBrowserPlayer(params: BrowserPlayerServeOptions): Promise<number> {
  const { opts, playDir, mode } = params;
  const requestedPort = parsePort(opts.port);

  const emulatorPkg = dirname(require.resolve('@zx-vibes/emulator/package.json'));
  const emulatorBundle = join(emulatorPkg, 'dist', 'zxgeneration.esm.js');
  if (!existsSync(emulatorBundle)) {
    throw userError(
      'Emulator browser bundle is missing. Run pnpm --filter @zx-vibes/emulator build first.',
      params.stage
    );
  }

  writeFileSync(join(playDir, 'index.html'), playHtml(mode));

  const files = new Map<string, string>([
    ['/', join(playDir, 'index.html')],
    ['/index.html', join(playDir, 'index.html')],
    ['/48k.rom', join(emulatorPkg, 'rom', '48k.rom')],
    ['/zxgeneration.esm.js', emulatorBundle],
    ['/game.z80', join(playDir, 'game.z80')],
    ['/game.tap', join(playDir, 'game.tap')],
  ]);

  let selectedPort = requestedPort;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${PREVIEW_HOST}:${selectedPort}`);
    const path = files.get(url.pathname);
    if (!path || !existsSync(path)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = path.endsWith('.html')
      ? 'text/html'
      : path.endsWith('.js')
        ? 'text/javascript'
        : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(readFileSync(path));
  });

  return await new Promise<number>((resolve) => {
    listenWithPortFallback(server, requestedPort, { host: PREVIEW_HOST, strictPort: opts.strictPort })
      .then((listen) => {
        selectedPort = listen.port;
        const record = writePreviewServerRecord({
          pid: process.pid,
          port: selectedPort,
          requestedPort,
          url: `http://${PREVIEW_HOST}:${selectedPort}/`,
          startedAt: new Date().toISOString(),
          watch: false,
        });
        server.once('close', () => clearPreviewServerRecord(record.pid));
        emit(
          {
            ok: true,
            stage: params.stage,
            url: record.url,
            ...(params.file !== undefined ? { file: params.file } : {}),
            mode,
            ...(params.boot !== undefined ? { boot: params.boot } : {}),
            port: selectedPort,
            requestedPort,
            portFallback: selectedPort !== requestedPort,
          },
          opts.json,
          () =>
            [
              selectedPort !== requestedPort
                ? `WARNING: requested ${params.stage} port ${requestedPort} was busy; using ${selectedPort}`
                : undefined,
              `${params.stage === 'boot' ? 'Boot' : 'Play'} running at ${record.url} (${params.stage === 'boot' ? 'clean Spectrum' : mode})`,
            ]
              .filter((line): line is string => line !== undefined)
              .join('\n')
        );
        resolve(EXIT.OK);
      })
      .catch((err: unknown) => {
        resolve(emitCliError(err, opts.json, params.stage));
      });
  });
}

function previewListCommand(opts: { json: boolean }): number {
  const record = readPreviewServerRecord();
  const running = record ? isProcessRunning(record.pid) : false;
  emit(
    {
      ok: true,
      stage: 'preview',
      servers: record ? [{ ...record, running }] : [],
    },
    opts.json,
    () => (record ? `${running ? 'running' : 'stale'} pid=${record.pid} ${record.url}` : 'no tracked preview server')
  );
  return EXIT.OK;
}

function previewStopCommand(opts: { json: boolean }): number {
  const record = readPreviewServerRecord();
  if (!record) {
    emit({ ok: true, stage: 'preview', stopped: false }, opts.json, () => 'no tracked preview server');
    return EXIT.OK;
  }
  let stopped = false;
  if (isProcessRunning(record.pid)) {
    process.kill(record.pid);
    stopped = true;
  }
  clearPreviewServerRecord(record.pid);
  emit(
    { ok: true, stage: 'preview', stopped, pid: record.pid, url: record.url },
    opts.json,
    () => (stopped ? `stopped preview pid ${record.pid}` : `removed stale preview pid ${record.pid}`)
  );
  return EXIT.OK;
}

function previewDetachCommand(opts: PreviewCommandOptions): number {
  const args = process.argv.slice(1).filter((arg) => arg !== '--detach');
  args.push('--detached-child');
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  mkdirSync(dirname(PREVIEW_SERVER_RECORD), { recursive: true });
  writeFileSync(
    PREVIEW_SERVER_RECORD,
    JSON.stringify(
      {
        pid: child.pid ?? -1,
        port: parsePort(opts.port),
        requestedPort: parsePort(opts.port),
        url: `http://${PREVIEW_HOST}:${parsePort(opts.port)}/`,
        startedAt: new Date().toISOString(),
        watch: opts.watch,
      },
      null,
      2
    )
  );
  emit(
    {
      ok: true,
      stage: 'preview',
      detached: true,
      pid: child.pid,
      next: ['zxs preview --list', 'zxs preview --stop'],
    },
    opts.json,
    () => `preview starting in background (pid ${child.pid}); run zxs preview --list for the URL`
  );
  return EXIT.OK;
}

function readPreviewServerRecord(): PreviewServerRecord | undefined {
  if (!existsSync(PREVIEW_SERVER_RECORD)) return undefined;
  try {
    return JSON.parse(readFileSync(PREVIEW_SERVER_RECORD, 'utf8')) as PreviewServerRecord;
  } catch {
    return undefined;
  }
}

function writePreviewServerRecord(record: PreviewServerRecord): PreviewServerRecord {
  mkdirSync(dirname(PREVIEW_SERVER_RECORD), { recursive: true });
  writeFileSync(PREVIEW_SERVER_RECORD, JSON.stringify(record, null, 2));
  return record;
}

function clearPreviewServerRecord(pid: number): void {
  const current = readPreviewServerRecord();
  if (!current || current.pid === pid) {
    rmSync(PREVIEW_SERVER_RECORD, { force: true });
  }
}

function isProcessRunning(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function preparePlayable(file: string, playDir: string): 'snapshot' | 'tape' {
  const ext = extname(file).toLowerCase();
  const data = new Uint8Array(readFileSync(file));
  if (ext === '.z80') {
    writeFileSync(join(playDir, 'game.z80'), data);
    return 'snapshot';
  }
  if (ext === '.sna') {
    const machine = loadSnapshotMachine(file, data);
    writeFileSync(join(playDir, 'game.z80'), writeZ80v1(machine));
    return 'snapshot';
  }
  if (ext === '.tap' || ext === '.tzx') {
    writeFileSync(join(playDir, 'game.tap'), data);
    return 'tape';
  }
  throw userError('zxs play supports .z80, .sna, .tap, and .tzx files', 'play');
}

function prepareCleanBoot(playDir: string): void {
  writeFileSync(join(playDir, 'game.z80'), writeZ80v1(bootCachedMachine()));
}

function playHtml(mode: PlayerMode): string {
  const loader =
    mode === 'snapshot'
      ? `const snapshot = new Uint8Array(await (await fetch('./game.z80')).arrayBuffer());
          spectrum.loadZ80Snapshot(snapshot);`
      : `const tape = await (await fetch('./game.tap')).arrayBuffer();
          spectrum.loadTape(tape, 'game.tap');
          spectrum.playTape();`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>zx-vibes play</title>
  <style>
    body { margin: 0; background: #111; color: #f5f5f5; font: 14px system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
    main { display: grid; gap: 10px; justify-items: center; }
    canvas { image-rendering: pixelated; box-shadow: 0 0 0 1px #333; }
    .status { color: #a7f3d0; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <main>
    <canvas id="screen"></canvas>
    <div class="status">${mode}</div>
  </main>
  <script type="module">
    import { ZXSpectrum } from './zxgeneration.esm.js';
    new ZXSpectrum('#screen', {
      rom: './48k.rom',
      scale: 2,
      sound: true,
      onReady: async (spectrum) => {
        ${loader}
      },
    });
  </script>
</body>
</html>`;
}

export function listenWithPortFallback(
  server: Server,
  requestedPort: number,
  opts: PreviewListenOptions = {}
): Promise<PreviewListenResult> {
  const host = opts.host ?? PREVIEW_HOST;
  const strictPort = opts.strictPort ?? false;
  const maxAttempts = strictPort ? 1 : (opts.maxAttempts ?? MAX_PORT_FALLBACK_ATTEMPTS);
  let port = requestedPort;
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const tryListen = () => {
      attempts += 1;

      const onError = (err: Error) => {
        server.off('error', onError);
        server.off('listening', onListening);

        const listenError = err as Error & { code?: string };
        if (listenError.code === 'EADDRINUSE' && !strictPort && attempts < maxAttempts && port < 65535) {
          port += 1;
          tryListen();
          return;
        }

        reject(userError(previewListenErrorMessage(listenError, requestedPort, port), 'preview'));
      };

      const onListening = () => {
        server.off('error', onError);
        server.off('listening', onListening);
        resolve({ port, requestedPort });
      };

      server.once('error', onError);
      server.once('listening', onListening);
      try {
        server.listen(port, host);
      } catch (err) {
        onError(err as Error);
      }
    };

    tryListen();
  });
}

function previewListenErrorMessage(err: Error & { code?: string }, requestedPort: number, lastPort: number): string {
  if (err.code === 'EADDRINUSE') {
    return requestedPort === lastPort
      ? `Preview port ${requestedPort} is already in use`
      : `Preview ports ${requestedPort}-${lastPort} are already in use`;
  }
  const code = typeof err.code === 'string' ? ` (${err.code})` : '';
  return `Preview server failed to listen on port ${lastPort}${code}: ${err.message}`;
}

async function writePreviewBuild(opts: {
  entry: string;
  outDir: string;
  assembler: 'spectral' | 'sjasmplus';
  previewDir: string;
  org: string;
  watch: boolean;
}): Promise<PreviewBuild | null> {
  const result = await build(resolveProjectPath(opts.entry), { outDir: opts.outDir, assembler: opts.assembler });
  if (!result.ok || !result.outputs.bin) {
    return null;
  }

  const bin = new Uint8Array(readFileSync(result.outputs.bin));
  const buildId = createHash('sha1').update(bin).digest('hex').slice(0, 12);
  const builtAt = new Date().toISOString();
  const machine = bootCachedMachine();
  machine.loadBinary(bin, parseAddress(opts.org));
  machine.run({ frames: 1 });
  writeFileSync(join(opts.previewDir, 'game.z80'), writeZ80v1(machine));
  writeFileSync(join(opts.previewDir, 'preview.json'), JSON.stringify({ buildId, builtAt, outputs: result.outputs }, null, 2));
  writeFileSync(join(opts.previewDir, 'index.html'), previewHtml({ buildId, builtAt, watch: opts.watch }));
  return { buildId, builtAt, outputs: result.outputs, bootFrames: BOOT_FRAMES };
}

function hashPreviewInputs(root: string): string {
  const h = createHash('sha1');
  for (const file of collectWatchFiles(root)) {
    h.update(relative(root, file));
    h.update(readFileSync(file));
  }
  return h.digest('hex');
}

function collectWatchFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (WATCH_SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectWatchFiles(full));
    } else if (WATCH_EXTENSIONS.has(extname(entry).toLowerCase())) {
      out.push(full);
    }
  }
  return out.sort();
}

function previewHtml(opts: { buildId: string; builtAt: string; watch: boolean }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>zx-vibes preview</title>
  <style>
    body { margin: 0; background: #111; color: #f5f5f5; font: 14px system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
    main { display: grid; gap: 10px; justify-items: center; }
    canvas { image-rendering: pixelated; box-shadow: 0 0 0 1px #333; }
    .status { color: #a7f3d0; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <main>
    <canvas id="screen"></canvas>
    <div class="status" id="status">build ${opts.buildId} · ${opts.watch ? 'watching' : 'one-shot'} · ${opts.builtAt}</div>
  </main>
  <script type="module">
    import { ZXSpectrum } from './zxgeneration.esm.js';
    const buildId = ${JSON.stringify(opts.buildId)};
    const watch = ${JSON.stringify(opts.watch)};
    const snapshot = new Uint8Array(await (await fetch('./game.z80?build=' + buildId)).arrayBuffer());
    new ZXSpectrum('#screen', {
      rom: './48k.rom',
      scale: 2,
      sound: true,
      onReady: (spectrum) => spectrum.loadZ80Snapshot(snapshot),
    });
    if (watch) {
      const events = new EventSource('./events');
      events.addEventListener('reload', () => location.reload());
    }
  </script>
</body>
</html>`;
}
