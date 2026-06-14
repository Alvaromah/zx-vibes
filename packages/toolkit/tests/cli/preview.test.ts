import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { listenWithPortFallback } from '../../src/cli/commands/preview.js';

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
