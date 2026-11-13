// A PC written from outside (`regs set pc`, MCP `zx_run { pc }`) is where execution
// continues — also when the machine was waiting on a HALT. A halted CPU stays on its
// HALT until an interrupt, and that interrupt returns to PC + 1; left halted, the session
// skipped the first byte of the routine it was sent to.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { buildCatalog, McpSession } from '../src/mcp.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-halted-pc-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<Record<string, unknown>> {
  const out: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    await runCli([...argv, '--json'], { streams: { out: (t) => out.push(t), err: () => {} } });
  } finally {
    process.chdir(prev);
  }
  return JSON.parse(out.join('')) as Record<string, unknown>;
}

// Idles on HALT with interrupts on. `inject` is the routine the debugger jumps to: it
// stores 5 at 0xA000. Entered one byte late it runs `dec b` and stores the old A (0xFF).
const SOURCE = [
  '    ORG 0x8000',
  '    ei',
  'idle:',
  '    halt',
  '    jr idle',
  'inject:',
  '    ld a,5',
  '    ld (0xA000),a',
  'spin:',
  '    jr spin',
  '',
].join('\n');

function program(): number {
  const result = assemble(SOURCE);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  writeFileSync(join(dir, 'p.bin'), result.bytes);
  return result.symbols.find((s) => s.name === 'inject')!.value;
}

const STATE = '.zxs/state.zxstate';
const hex = (n: number): string => `0x${n.toString(16)}`;

describe('writing PC on a machine that waits on a HALT', () => {
  it('regs set pc: the session resumes at that address, not one byte later', async () => {
    const inject = program();
    await cli(['state', 'save', '--bin', 'p.bin']);
    const idle = await cli(['run', '--state', STATE, '--frames', '5']);
    expect((idle.registers as { halted: boolean }).halted).toBe(true);

    const set = await cli(['regs', 'set', 'pc', hex(inject), '--state', STATE]);
    expect((set.registers as { halted: boolean }).halted).toBe(false);

    await cli(['run', '--state', STATE, '--frames', '2', '--no-detect-hangs']);
    const stored = await cli(['mem', 'read', '0xA000', '--len', '1', '--state', STATE]);
    expect(stored.bytes).toEqual([5]);
  });

  it('MCP zx_run { pc }: the hot session starts at that address too', () => {
    const inject = program();
    const session = new McpSession(dir);
    const tools = new Map(buildCatalog(session).map((t) => [t.name, t]));
    const call = (name: string, args: Record<string, unknown>): Record<string, unknown> => {
      const result = tools.get(name as 'zx_run')!.handler(args) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    };

    const idle = call('zx_run', { bin: 'p.bin', frames: 5 });
    expect((idle.registers as { halted: boolean }).halted).toBe(true);

    call('zx_run', { pc: hex(inject), frames: 2, detectHangs: false });
    const inspect = call('zx_inspect', { memAddr: '0xA000', memLen: 1 });
    expect((inspect.memory as { hex: string }).hex).toBe('05');
  });
});
