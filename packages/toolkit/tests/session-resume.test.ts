// Continuing a session (`run --state`, the MCP hot session, `type`) must carry the
// machine's state forward: step past the breakpoint it stopped at, keep the border it
// had, and type repeated characters as separate key presses.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { REPEAT_RELEASE_FRAMES, typeSchedule } from '../src/input/input-command.js';
import { buildCatalog, McpSession } from '../src/mcp.js';
import { deserializeZxState } from '../src/state/zxstate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-resume-'));
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

function program(source: string): ReturnType<typeof assemble> {
  const result = assemble(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  writeFileSync(join(dir, 'p.bin'), result.bytes);
  return result;
}

const STATE = '.zxs/state.zxstate';
const accumulator = (env: Record<string, unknown>): number =>
  ((env.registers as { af: number }).af >> 8) & 0xff;

describe('run --state continues past the stop it resumed from', () => {
  it('a second --until-break runs a full loop iteration instead of stopping at once', async () => {
    const asm = program('    ORG 0x8000\n    di\n    xor a\nloop:\n    inc a\nbp:\n    nop\n    jr loop\n');
    const bp = asm.symbols.find((s) => s.name === 'bp')!.value;
    await cli(['state', 'save', '--bin', 'p.bin']);
    await cli(['break', 'add', `0x${bp.toString(16)}`]);

    const first = await cli(['run', '--state', STATE, '--until-break']);
    const second = await cli(['run', '--state', STATE, '--until-break']);
    expect(first.status).toBe('breakpoint');
    expect(second.status).toBe('breakpoint');
    expect(second.tstatesRun as number).toBeGreaterThan(0);
    expect(accumulator(first)).toBe(1);
    expect(accumulator(second)).toBe(2);
  });
});

describe('a continued run keeps the border it resumed with', () => {
  // Sets the border once, then idles on HALT without writing port 0xFE again.
  const SOURCE = '    ORG 0x8000\n    ld a,2\n    out (0xfe),a\n    ei\nidle:\n    halt\n    jr idle\n';

  it('run --state reports and saves the session border, not the power-on 7', async () => {
    program(SOURCE);
    await cli(['state', 'save', '--bin', 'p.bin']);
    const first = await cli(['run', '--state', STATE, '--frames', '3']);
    const second = await cli(['run', '--state', STATE, '--frames', '3']);
    expect((first.screen as { border: number }).border).toBe(2);
    expect((second.screen as { border: number }).border).toBe(2);
    expect(deserializeZxState(readFileSync(join(dir, STATE), 'utf8')).border).toBe(2);
  });

  it('the MCP hot session keeps it across zx_run continuations', () => {
    program(SOURCE);
    const session = new McpSession(dir);
    const tools = new Map(buildCatalog(session).map((t) => [t.name, t]));
    const run = (args: Record<string, unknown>): Record<string, unknown> => {
      const result = tools.get('zx_run')!.handler(args) as { content: Array<{ text: string }> };
      return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    };
    expect((run({ bin: 'p.bin', frames: 3 }).screen as { border: number }).border).toBe(2);
    expect((run({ frames: 3 }).screen as { border: number }).border).toBe(2);
    expect(session.border).toBe(2);
  });
});

describe('typeSchedule — repeated keys are released between presses', () => {
  it('inserts a release gap only before a repeated key', () => {
    expect(typeSchedule('12', 3)).toEqual([
      { frame: 0, key: '1', hold: 3 },
      { frame: 3, key: '2', hold: 3 },
    ]);
    expect(typeSchedule('11', 3)).toEqual([
      { frame: 0, key: '1', hold: 3 },
      { frame: 3 + REPEAT_RELEASE_FRAMES, key: '1', hold: 3 },
    ]);
    // Case-folded letters and both newline forms are the same key.
    expect(typeSchedule('aA', 2)[1]!.frame).toBe(2 + REPEAT_RELEASE_FRAMES);
    expect(typeSchedule('\n\r', 2)[1]!.frame).toBe(2 + REPEAT_RELEASE_FRAMES);
  });
});
