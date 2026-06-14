import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../../src/mcp/server.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const spectralAsmAvailable =
  existsSync(join(root, '..', 'asm', 'dist', 'index.js')) ||
  existsSync(join(root, 'node_modules', '@zx-vibes', 'asm', 'dist', 'index.js'));

interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

let client: Client;
let projectRoot: string;

function textJson(content: ContentItem[]): Record<string, unknown> {
  const text = content.find((c) => c.type === 'text');
  expect(text?.text).toBeDefined();
  return JSON.parse(text!.text!) as Record<string, unknown>;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ContentItem[]> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError ?? false).toBe(false);
  return res.content as ContentItem[];
}

async function callRaw(name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function errorText(res: Awaited<ReturnType<typeof callRaw>>): string {
  const content = res.content as ContentItem[];
  return content.find((c) => c.type === 'text')?.text ?? '';
}

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'zxs-mcp-project-'));
  copyFileSync(join(fixtures, 'hello.asm'), join(projectRoot, 'hello.asm'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ projectRoot }).connect(serverTransport);
  client = new Client({ name: 'zx-vibes-test', version: '0.1.0' });
  await client.connect(clientTransport);
});

describe('zx-vibes MCP server', () => {
  it('lists the seven tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'zx_build',
      'zx_debug',
      'zx_inspect',
      'zx_keys',
      'zx_run',
      'zx_screen',
      'zx_state',
    ]);
  });

  it('zx_build assembles and loads symbols', async () => {
    const result = textJson(await call('zx_build', { entry: 'hello.asm', outDir: 'build' }));
    expect(result['ok']).toBe(true);
    expect(result['symbolsLoaded']).toBe(true);
    expect(result['outputs']).toEqual({ bin: 'build/hello.bin', sld: 'build/hello.sld' });
  });

  const itIfSpectralAsm = spectralAsmAvailable ? it : it.skip;

  itIfSpectralAsm('zx_build can use the embedded Spectral assembler backend', async () => {
    const result = textJson(
      await call('zx_build', {
        entry: 'hello.asm',
        outDir: 'spectral-build',
        assembler: 'spectral',
      })
    );
    expect(result['ok']).toBe(true);
    expect(result['symbolsLoaded']).toBe(true);
  });

  it('zx_run executes the binary with the persistent machine', async () => {
    const result = textJson(
      await call('zx_run', {
        bin: 'build/hello.bin',
        org: '0x8000',
        untilPc: 'done',
        frames: 20,
      })
    );
    expect(result['status']).toBe('ok');
    const exit = result['exit'] as { reason: string; pc: string };
    expect(exit.reason).toBe('until-pc');
    expect(exit.pc).toContain('done');
  });

  it('zx_screen returns a PNG image the client can decode, plus the char grid', async () => {
    const content = await call('zx_screen', {});
    const image = content.find((c) => c.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const png = PNG.sync.read(Buffer.from(image!.data!, 'base64'));
    expect(png.width).toBe(704);

    const text = textJson(content);
    const rows = text['rows'] as string[];
    expect(rows.some((r) => r.includes('HELLO ZX'))).toBe(true);
  });

  it('zx_inspect reads registers and symbol-resolved memory', async () => {
    const result = textJson(await call('zx_inspect', { memAddr: 'msg', memLen: 9 }));
    const mem = result['memory'] as { addr: string; ascii: string };
    expect(mem.addr).toContain('msg');
    expect(mem.ascii).toBe('HELLO ZX.');
  });

  it('zx_run reports beeper activity', async () => {
    writeFileSync(
      join(projectRoot, 'beeper.bin'),
      Buffer.from([0x3e, 0x10, 0xd3, 0xfe, 0xaf, 0xd3, 0xfe, 0xfb, 0x76, 0x18, 0xfd])
    );
    const result = textJson(
      await call('zx_run', {
        bin: 'beeper.bin',
        org: '0x8000',
        frames: 2,
      })
    );
    expect(result['audio']).toMatchObject({
      beeperEdges: 2,
      portFEWrites: 2,
      beeperLevel: 0,
      lastPortFE: 0,
    });
  });

  it('zx_debug: breakpoint by label, continue, step, disasm', async () => {
    const added = textJson(await call('zx_debug', { action: 'break-add', spec: 'print_loop' }));
    expect((added['added'] as { addr: string }).addr).toContain('print_loop');

    // Re-load the program and run into the breakpoint.
    const run = textJson(
      await call('zx_run', { bin: 'build/hello.bin', org: '0x8000', frames: 20 })
    );
    expect(run['status']).toBe('breakpoint');
    expect((run['breakpoint'] as { addr: string }).addr).toContain('print_loop');

    const step = textJson(await call('zx_debug', { action: 'step', count: 2 }));
    expect(step['disasm']).toBeDefined();

    const dis = textJson(await call('zx_debug', { action: 'disasm', spec: 'start', count: 2 }));
    const lines = dis['lines'] as { text: string }[];
    expect(lines[0]!.text).toBe('LD A,0x02');

    await call('zx_debug', { action: 'break-rm' });
  });

  it('zx_keys types into the machine', async () => {
    await call('zx_state', { action: 'reset' });
    const result = textJson(await call('zx_keys', { keys: '2:P*4', extraFrames: 20 }));
    expect(result['ok']).toBe(true);
    // In 48K BASIC, P in keyword mode enters PRINT on the edit line.
    const screen = textJson(await call('zx_screen', {}));
    const rows = screen['rows'] as string[];
    expect(rows.some((r) => r.includes('PRINT'))).toBe(true);
  });

  it('zx_state save/load round-trips through .zxstate files', async () => {
    const file = 'state/mcp.zxstate';
    const saved = textJson(await call('zx_state', { action: 'save', file }));
    expect(saved['saved']).toBe(file);
    const loaded = textJson(await call('zx_state', { action: 'load', file }));
    expect(loaded['loaded']).toBe(file);
  });

  it('rejects absolute and parent-segment paths without leaking the project root', async () => {
    const cases = [
      { name: 'zx_build', args: { entry: join(projectRoot, 'hello.asm'), outDir: 'build' } },
      { name: 'zx_build', args: { entry: 'hello.asm', outDir: '../outside' } },
      { name: 'zx_run', args: { bin: join(projectRoot, 'build', 'hello.bin') } },
      { name: 'zx_run', args: { bin: '../hello.bin' } },
      { name: 'zx_state', args: { action: 'save', file: join(projectRoot, 'state.zxstate') } },
      { name: 'zx_state', args: { action: 'load', file: '../state.zxstate' } },
      { name: 'zx_state', args: { action: 'export-z80', file: '../state.z80' } },
    ];

    for (const item of cases) {
      const res = await callRaw(item.name, item.args);
      expect(res.isError).toBe(true);
      expect(errorText(res)).not.toContain(projectRoot);
    }
  });

  it('reports tool errors as isError content, not crashes', async () => {
    const res = await client.callTool({
      name: 'zx_run',
      arguments: { bin: 'nonexistent.bin' },
    });
    expect(res.isError).toBe(true);
    expect(errorText(res)).toContain('nonexistent.bin');
    expect(errorText(res)).not.toContain(projectRoot);
  });

  it('caps synchronous MCP debug workloads', async () => {
    const stepOver = await callRaw('zx_debug', { action: 'step-over', count: 33 });
    expect(stepOver.isError).toBe(true);
    expect(errorText(stepOver)).toContain('step-over count is capped');

    const trace = await callRaw('zx_debug', { action: 'trace', frames: 301 });
    expect(trace.isError).toBe(true);
    expect(errorText(trace)).toContain('trace frames are capped');
  });
});
