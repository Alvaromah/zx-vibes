// A request the preview server cannot parse is answered, not fatal. `GET //` made the
// URL parser throw inside the request listener (an empty host), which ended the server
// process; any page could send it (`<img src="http://127.0.0.1:5173//">`).

import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { newToken } from '../src/preview/lifecycle.js';
import { resolvePreviewProgram } from '../src/preview/program.js';
import { createPreviewServer, type PreviewServer } from '../src/preview/server.js';

const openServers: PreviewServer[] = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => s.close().catch(() => undefined)));
});

async function startServer(token = newToken()): Promise<PreviewServer> {
  const server = await createPreviewServer({ program: resolvePreviewProgram({ blank: true }), port: 0, token });
  openServers.push(server);
  return server;
}

/** Send one raw request line (no client-side URL normalisation) and return the status line. */
function rawStatus(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.on('connect', () =>
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`),
    );
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data.split('\r\n')[0] ?? ''));
    socket.on('error', reject);
  });
}

describe('the preview server survives requests it cannot parse', () => {
  it('GET // is a 400 and the server keeps serving', async () => {
    const server = await startServer();
    expect(await rawStatus(server.port, '//')).toBe('HTTP/1.1 400 Bad Request');
    expect(await rawStatus(server.port, '/')).toBe('HTTP/1.1 200 OK');
    expect((await fetch(`${server.url}/control/ping`)).status).toBe(200);
  });

  it('an oversized /control/stop body is a 400, and the server is still up', async () => {
    const token = newToken();
    const server = await startServer(token);
    const res = await fetch(`${server.url}/control/stop`, { method: 'POST', body: 'x'.repeat(2_500_000) });
    expect(res.status).toBe(400);
    expect((await fetch(`${server.url}/control/ping`)).status).toBe(200);
  });
});
