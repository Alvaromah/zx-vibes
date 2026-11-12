// `key` / `type` report a hang instead of hiding it — cli.md CLI-PROD-INPUT-003 /
// CLI-PROD-EXIT-003, errors.md ERR-PROD-HANG-SHAPE-001. They run the machine under
// `run`'s watchdog but used to drop its verdict and exit 0 over a hung machine.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { deserializeZxState } from '../src/state/zxstate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-input-hang-'));
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

function bin(name: string, source: string): string {
  const asm = assemble(source);
  if (!asm.ok) throw new Error(JSON.stringify(asm.errors));
  writeFileSync(join(dir, name), asm.bytes);
  return name;
}

// Waits for O (row 5 bit 1); on the press stores 0x99 at 0x9000 and halts with DI.
const HANG_ON_O = [
  '    ORG 0x8000',
  '    di',
  'poll:',
  '    ld bc, 0xDFFE',
  '    in a, (c)',
  '    bit 1, a',
  '    jr nz, poll',
  '    ld a, 0x99',
  '    ld (0x9000), a',
  '    halt',
  '',
].join('\n');

// Waits for O, then idles HALT-synced with interrupts on (healthy).
const IDLE_ON_O = [
  '    ORG 0x8000',
  'poll:',
  '    ld bc, 0xDFFE',
  '    in a, (c)',
  '    bit 1, a',
  '    jr nz, poll',
  '    ld a, 0x99',
  '    ld (0x9000), a',
  '    ei',
  'idle:',
  '    halt',
  '    jr idle',
  '',
].join('\n');

describe('a hang while consuming the keys exits 2 with the verdict, like run', () => {
  it('key: the keypress leads to DI+HALT → exit 2, di-halt (it used to exit 0)', async () => {
    const { code, env } = await cli(['key', 'O', '--bin', bin('p.bin', HANG_ON_O)]);
    expect(code).toBe(2);
    expect(env.ok).toBe(false);
    expect(env.stage).toBe('key');
    expect(env.status).toBe('hang');
    expect((env.hang as { kind: string }).kind).toBe('di-halt');
    expect((env.exit as { kind: string }).kind).toBe('di-halt');
    expect((env.error as { exitCode: number }).exitCode).toBe(2);
  });

  it('type: a DI tight loop over a long run → exit 2, tight-loop', async () => {
    const tight = bin('t.bin', '    ORG 0x8000\n    di\nself:\n    jr self\n');
    const { code, env } = await cli(['type', 'go', '--frames', '120', '--bin', tight]);
    expect(code).toBe(2);
    expect((env.hang as { kind: string }).kind).toBe('tight-loop');
  });

  it('with --state the hung machine is still saved (like run --state)', async () => {
    const p = bin('p.bin', HANG_ON_O);
    await cli(['state', 'save', '.zxs/s.zxstate', '--bin', p]);
    const { code, env } = await cli(['key', 'O', '--state', '.zxs/s.zxstate']);
    expect(code).toBe(2);
    expect(env.persisted).toBe(true);
    const saved = deserializeZxState(readFileSync(join(dir, '.zxs/s.zxstate'), 'utf8'));
    expect(saved.machine.halted).toBe(true);
    expect(saved.machine.memory[0x9000]).toBe(0x99);
  });
});

describe('a healthy key / type is unchanged (exit 0, the same success envelope)', () => {
  it('key into a program that reacts and idles: exit 0, no verdict fields', async () => {
    const { code, env } = await cli(['key', 'O', '--bin', bin('p.bin', IDLE_ON_O)]);
    expect(code).toBe(0);
    expect(env.ok).toBe(true);
    expect(env.status).toBeUndefined();
    expect(env.hang).toBeUndefined();
    expect(env.key).toBe('O');
  });

  it('type a 20+ character line into a fresh boot (no project): exit 0', async () => {
    const { code, env } = await cli(['type', 'the quick brown fox jumps']);
    expect(code).toBe(0);
    expect(env.ok).toBe(true);
    expect(env.framesRun as number).toBeGreaterThan(60);
  });

  it('type into a BASIC session idling in the editor: exit 0', async () => {
    const state = '.zxs/basic.zxstate';
    await cli(['state', 'reset', '--blank', '--state', state]);
    expect((await cli(['run', '--state', state, '--frames', '150'])).code).toBe(0);
    const typed = await cli(['type', '10p1\n', '--state', state, '--frames', '120']);
    expect(typed.code).toBe(0);
    const screen = await cli(['screen', '--state', state]);
    // The listing marks the current line with `>`: "  10>PRINT 1".
    expect((screen.env.rows as string[])[0]).toMatch(/^\s+10>PRINT 1\s*$/);
  });

  it('typing BASIC that reports an error is not a hang (it used to exit 2, rom-error)', async () => {
    const state = '.zxs/basic.zxstate';
    await cli(['state', 'reset', '--blank', '--state', state]);
    await cli(['run', '--state', state, '--frames', '150']);
    const typed = await cli(['type', 'pa\n', '--state', state, '--frames', '100']); // PRINT a
    expect(typed.code).toBe(0);
    const screen = await cli(['screen', '--state', state]);
    expect((screen.env.rows as string[]).join('\n')).toContain('2 Variable not found');
  });
});
