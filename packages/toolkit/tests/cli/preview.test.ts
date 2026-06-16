import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Tape } from '@zx-vibes/emulator/src/spectrum/tape.js';
import {
  isOwnedPreviewServerRecord,
  listenWithPortFallback,
  playHtml,
  preparePlayable,
} from '../../src/cli/commands/preview.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (typeof address === 'object' && address) {
        resolve(address.port);
      } else {
        reject(new Error('server did not expose a TCP port'));
      }
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('preview port selection', () => {
  it('tries later ports when the requested port is busy', async () => {
    const blocker = createServer();
    const preview = createServer();
    const requestedPort = await listen(blocker);

    try {
      const selected = await listenWithPortFallback(preview, requestedPort, { maxAttempts: 5 });

      expect(selected.requestedPort).toBe(requestedPort);
      expect(selected.port).toBeGreaterThan(requestedPort);
      expect(preview.listening).toBe(true);
    } finally {
      await close(preview);
      await close(blocker);
    }
  });

  it('fails on a busy requested port in strict mode', async () => {
    const blocker = createServer();
    const preview = createServer();
    const requestedPort = await listen(blocker);

    try {
      await expect(
        listenWithPortFallback(preview, requestedPort, { strictPort: true })
      ).rejects.toThrow(`Preview port ${requestedPort} is already in use`);
      expect(preview.listening).toBe(false);
    } finally {
      await close(preview);
      await close(blocker);
    }
  });
});

describe('preview server records', () => {
  it('requires a zx-vibes ownership token before stop can target a process', () => {
    expect(
      isOwnedPreviewServerRecord({
        owner: 'zx-vibes-preview-server',
        token: 'token',
        kind: 'preview',
        pid: 123,
        port: 5173,
      })
    ).toBe(true);

    expect(
      isOwnedPreviewServerRecord({
        pid: 123,
        port: 5173,
      })
    ).toBe(false);
  });
});

describe('play browser tape handling', () => {
  it('preserves .tzx filenames so the emulator parses TZX data as TZX', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zxs-play-tzx-'));
    const source = join(dir, 'sample.tzx');
    writeFileSync(source, minimalTzx());

    const playable = preparePlayable(source, dir);

    expect(playable).toEqual({ mode: 'tape', fileName: 'game.tzx' });
    expect(existsSync(join(dir, 'game.tzx'))).toBe(true);
    expect(playHtml(playable.mode, playable.fileName)).toContain('spectrum.loadTape(tape, "game.tzx")');

    const tape = new Tape({ cpu: { cycles: 0 }, ula: {} });
    tape.load(new Uint8Array(readFileSync(join(dir, 'game.tzx'))), playable.fileName);
    expect((tape as unknown as { format: string }).format).toBe('TZX');
  });
});

function minimalTzx(): Buffer {
  return Buffer.from([
    0x5a,
    0x58,
    0x54,
    0x61,
    0x70,
    0x65,
    0x21,
    0x1a,
    0x01,
    0x14,
    0x10,
    0xe8,
    0x03,
    0x02,
    0x00,
    0x00,
    0x00,
  ]);
}
