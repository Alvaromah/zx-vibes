// The address grammar — cli.md CLI-PROD-CONV-ADDR-001/002. An `h`-suffixed hex literal
// must start with a decimal digit, as in Z80 assemblers: `break add each` used to parse
// `each` as 0x0EAC and set a breakpoint there instead of on the label `each`.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildCatalog, McpSession } from '../src/mcp.js';
import { parseAddress, parseNumber } from '../src/util/address.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-addr-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Env = Record<string, unknown> & { ok: boolean };

async function cli(argv: string[]): Promise<{ code: number; env: Env }> {
  const out: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const code = await runCli([...argv, '--json'], {
      streams: { out: (t) => out.push(t), err: () => {} },
    });
    return { code, env: JSON.parse(out.join('')) as Env };
  } finally {
    process.chdir(prev);
  }
}

// Labels that look like letter-led hex words: `each` (= "0EAC" + h) and `beach`.
const PROGRAM = [
  '    ORG 0x8000',
  'main:',
  '    nop',
  'each:',
  '    nop',
  'beach:',
  '    jr main',
  '',
].join('\n');

function project(): void {
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }));
  writeFileSync(join(dir, 'main.asm'), PROGRAM);
}

describe('parseNumber / parseAddress (CLI-PROD-CONV-ADDR-001/002)', () => {
  it('accepts every documented form, with a digit-led h suffix', () => {
    expect(parseNumber('0x8000')).toBe(0x8000);
    expect(parseNumber('$8000')).toBe(0x8000);
    expect(parseNumber('8000h')).toBe(0x8000);
    expect(parseNumber('8000H')).toBe(0x8000);
    expect(parseNumber('0C000h')).toBe(0xc000);
    expect(parseNumber('0FFh')).toBe(0xff);
    expect(parseNumber('32768')).toBe(32768);
  });

  it('a letter-led h word is not a number', () => {
    for (const word of ['FFh', 'C000h', 'each', 'beach', 'ah', 'deadh']) {
      expect(parseNumber(word), word).toBeUndefined();
    }
  });

  it('parseAddress rejects FFh with advice to write 0FFh', () => {
    expect(() => parseAddress('FFh')).toThrow(/must start with a digit, e\.g\. 0FFh/);
    expect(parseAddress('0FFh')).toBe(0xff);
  });
});

describe('break add resolves a hex-looking word as the label it names', () => {
  it('break add each → the label `each`, not 0x0EAC', async () => {
    project();
    const add = await cli(['break', 'add', 'each']);
    expect(add.code).toBe(0);
    expect((add.env.breakpoint as { addr: number }).addr).toBe(0x8001);
    const beach = await cli(['break', 'add', 'beach']);
    expect((beach.env.breakpoint as { addr: number }).addr).toBe(0x8002);
  });

  it('break add each with no such label is a clear user error (it used to add 0x0EAC)', async () => {
    writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm' }));
    writeFileSync(join(dir, 'main.asm'), '    ORG 0x8000\nmain:\n    jr main\n');
    const add = await cli(['break', 'add', 'each']);
    expect(add.code).toBe(1);
    expect((add.env.error as { message: string }).message).toMatch(/cannot resolve "each"/);
    const fh = await cli(['break', 'add', 'FFh']);
    expect(fh.code).toBe(1);
    expect((fh.env.error as { message: string }).message).toMatch(/e\.g\. 0FFh/);
  });

  it('digit-led h addresses still need no build (CLI-PROD-EDGE-002)', async () => {
    const add = await cli(['break', 'add', '0FFh']); // no project at all
    expect(add.code).toBe(0);
    expect((add.env.breakpoint as { addr: number }).addr).toBe(0xff);
    const hex = await cli(['break', 'add', '8000h']);
    expect((hex.env.breakpoint as { addr: number }).addr).toBe(0x8000);
  });

  it('disasm each and the MCP break-add resolve the label too', async () => {
    project();
    const dis = await cli(['disasm', 'each', '--count', '1']);
    expect(dis.env.addr).toBe(0x8001);

    const session = new McpSession(dir);
    const tools = new Map(buildCatalog(session).map((t) => [t.name, t]));
    const call = (name: Parameters<typeof tools.get>[0], args: Record<string, unknown>): Env => {
      const result = tools.get(name)!.handler(args) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text) as Env;
    };
    call('zx_build', {});
    const added = call('zx_debug', { action: 'break-add', spec: 'each' });
    expect((added.breakpoint as { addr: number }).addr).toBe(0x8001);
  });

  it('an address flag rejects FFh with the advice (exit 1)', async () => {
    project();
    const run = await cli(['run', '--until-pc', 'FFh']);
    expect(run.code).toBe(1);
    expect((run.env.error as { message: string }).message).toMatch(/0FFh/);
  });
});
