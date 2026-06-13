import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverPath = join(root, 'dist', 'mcp', 'server.js');

describe('zxs-mcp over real stdio (the built binary)', () => {
  it('spawns, lists tools, and returns a screen image', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [serverPath] });
    const client = new Client({ name: 'stdio-smoke', version: '0.0.1' });
    await client.connect(transport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('zx_screen');

      const res = await client.callTool({ name: 'zx_screen', arguments: {} });
      const content = res.content as { type: string; mimeType?: string }[];
      expect(content.some((c) => c.type === 'image' && c.mimeType === 'image/png')).toBe(true);
    } finally {
      await client.close();
    }
  }, 30000);
});
