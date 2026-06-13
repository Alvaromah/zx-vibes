import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { build } from '../../build/sjasmplus.js';
import { Machine } from '../../core/machine.js';
import { writeZ80v1 } from '../../core/state.js';
import { EXIT, emit, emitCliError, parseAddress, parsePort, userError } from '../output.js';
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
  json: boolean;
}

export async function previewCommand(opts: PreviewCommandOptions): Promise<number> {
  const port = parsePort(opts.port);
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
  const result = await build(resolveProjectPath(entry), { outDir, assembler });
  if (!result.ok || !result.outputs.bin) {
    emit({ ok: false, stage: 'preview', build: result }, opts.json, () => 'Build failed; preview not started');
    return EXIT.USER_ERROR;
  }

  const previewDir = join('.zxs', 'preview');
  mkdirSync(previewDir, { recursive: true });
  const machine = Machine.boot();
  machine.loadBinary(new Uint8Array(readFileSync(result.outputs.bin)), parseAddress(configuredOrg(undefined, loaded.config)));
  machine.run({ frames: 1 });
  writeFileSync(join(previewDir, 'game.z80'), writeZ80v1(machine));
  writeFileSync(join(previewDir, 'index.html'), previewHtml());

  const emulatorPkg = dirname(require.resolve('@zx-vibes/emulator/package.json'));
  const files = new Map<string, string>([
    ['/', join(previewDir, 'index.html')],
    ['/index.html', join(previewDir, 'index.html')],
    ['/game.z80', join(previewDir, 'game.z80')],
    ['/48k.rom', join(emulatorPkg, 'rom', '48k.rom')],
    ['/zxgeneration.esm.js', join(emulatorPkg, 'dist', 'zxgeneration.esm.js')],
  ]);

  if (!existsSync(join(emulatorPkg, 'dist', 'zxgeneration.esm.js'))) {
    throw userError('Emulator browser bundle is missing. Run pnpm --filter @zx-vibes/emulator build first.', 'preview');
  }

  const server = createServer((req, res) => {
    const file = files.get(req.url ?? '/');
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(file));
  });

  return await new Promise<number>((resolve) => {
    let settled = false;
    server.once('error', (err) => {
      if (settled) return;
      settled = true;
      const listenError = err as Error & { code?: string };
      const code = typeof listenError.code === 'string' ? ` (${listenError.code})` : '';
      const message =
        listenError.code === 'EADDRINUSE'
          ? `Preview port ${port} is already in use`
          : `Preview server failed to listen on port ${port}${code}: ${listenError.message}`;
      resolve(emitCliError(userError(message, 'preview'), opts.json, 'preview'));
    });
    server.listen(port, '127.0.0.1', () => {
      settled = true;
      emit(
        { ok: true, stage: 'preview', url: `http://127.0.0.1:${port}/`, build: result.outputs },
        opts.json,
        () => `Preview running at http://127.0.0.1:${port}/`
      );
      resolve(EXIT.OK);
    });
  });
}

function previewHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>zx-vibes preview</title>
  <style>
    body { margin: 0; background: #111; color: #f5f5f5; font: 14px system-ui, sans-serif; display: grid; min-height: 100vh; place-items: center; }
    canvas { image-rendering: pixelated; box-shadow: 0 0 0 1px #333; }
  </style>
</head>
<body>
  <canvas id="screen"></canvas>
  <script type="module">
    import { ZXSpectrum } from './zxgeneration.esm.js';
    const snapshot = new Uint8Array(await (await fetch('./game.z80')).arrayBuffer());
    new ZXSpectrum('#screen', {
      rom: './48k.rom',
      scale: 2,
      sound: true,
      onReady: (spectrum) => spectrum.loadZ80Snapshot(snapshot),
    });
  </script>
</body>
</html>`;
}
