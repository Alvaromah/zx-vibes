// Run-report and input fixes from the 2026-11-13 review:
//   - `exit.pc` on a frame-budget exit is where the run ended, not where it was entered;
//   - an empty stack at SP = 0x0000 (`ld sp,0`) is not `sp-corrupt`;
//   - a malformed `--keys`/`--joy` plan, a bad `--frames` and an unknown key are reported
//     under the command that received them (CLI-PROD-CONV-JSON-002);
//   - `type` releases a key before pressing it again even with other keys in between.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { REPEAT_RELEASE_FRAMES, typeSchedule } from '../src/input/input-command.js';
import { runProgram } from '../src/runtime/run.js';
import { loadBytesMachine } from '../src/runtime/session.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-run-report-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]): Promise<{ code: number; env: Record<string, unknown> }> {
  const out: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  let code: number;
  try {
    code = await runCli([...argv, '--json'], { streams: { out: (t) => out.push(t), err: () => {} } });
  } finally {
    process.chdir(prev);
  }
  return { code, env: JSON.parse(out.join('')) as Record<string, unknown> };
}

function run(source: string, frames: number): ReturnType<typeof runProgram> {
  const asm = assemble(source);
  if (!asm.ok) throw new Error(JSON.stringify(asm.errors));
  return runProgram(loadBytesMachine(asm.bytes, asm.origin), asm.origin, { frames });
}

const IDLE = '    ORG 0x8000\n    ei\nidle:\n    halt\n    jr idle\n';

describe('exit.pc on a frame-budget exit', () => {
  it('is the PC the run ended at, the same as registers.pc', () => {
    const result = run(IDLE, 10);
    expect(result.exit.reason).toBe('frame-budget');
    expect(result.registers.pc).not.toBe(0x8000); // it left the entry point
    expect(result.exit.pc).toBe(result.registers.pc);
  });
});

describe('sp-corrupt and an empty stack at 0x0000', () => {
  it('`ld sp,0` with a healthy HALT loop is ok', () => {
    const result = run('    ORG 0x8000\n    ld sp,0\n    ei\nidle:\n    halt\n    jr idle\n', 60);
    expect(result.status).toBe('ok');
    expect(result.hang).toBeUndefined();
    expect(result.haltSynced).toBe(true);
  });

  it('a stack pointer inside the ROM is still flagged', () => {
    // Interrupts off and no calls, so the bad stack is never used: only the rule sees it.
    const source = '    ORG 0x8000\n    di\n    ld sp,0x2000\nbusy:\n    inc a\n    ld (0x9000),a\n    jr busy\n';
    const result = run(source, 60);
    expect(result.status).toBe('hang');
    expect(result.hang?.kind).toBe('sp-corrupt');
  });
});

describe('input errors are reported under the command that received the input', () => {
  beforeEach(() => {
    const asm = assemble(IDLE);
    if (!asm.ok) throw new Error(JSON.stringify(asm.errors));
    writeFileSync(join(dir, 'p.bin'), asm.bytes);
  });

  it('trace --keys / coverage --joy name their own stage', async () => {
    const trace = await cli(['trace', '--bin', 'p.bin', '--frames', '2', '--keys', 'bad']);
    expect(trace.code).toBe(1);
    expect(trace.env.stage).toBe('trace');

    const coverage = await cli(['coverage', '--bin', 'p.bin', '--frames', '2', '--joy', '0:X']);
    expect(coverage.code).toBe(1);
    expect(coverage.env.stage).toBe('coverage');

    // `run` is unchanged.
    expect((await cli(['run', '--bin', 'p.bin', '--keys', 'bad'])).env.stage).toBe('run');
  });

  it('key: an unknown key is a `key` error that names the key', async () => {
    const result = await cli(['key', 'F1', '--bin', 'p.bin']);
    expect(result.code).toBe(1);
    expect(result.env.stage).toBe('key');
    expect((result.env.error as { message: string }).message).toMatch(/Unknown key "F1"/);
  });

  it('type --frames: a bad value is a `type` error', async () => {
    const result = await cli(['type', 'hi', '--bin', 'p.bin', '--frames', '0']);
    expect(result.code).toBe(1);
    expect(result.env.stage).toBe('type');
  });
});

describe('type releases a key before pressing it again', () => {
  it('the schedule waits for the key own release gap, whatever is typed in between', () => {
    // "101": the second 1 must wait REPEAT_RELEASE_FRAMES after the first was released.
    expect(typeSchedule('101', 3)).toEqual([
      { frame: 0, key: '1', hold: 3 },
      { frame: 3, key: '0', hold: 3 },
      { frame: 3 + REPEAT_RELEASE_FRAMES, key: '1', hold: 3 },
    ]);
    // Unchanged cases: back-to-back distinct keys, an immediate repeat, a far repeat.
    expect(typeSchedule('12', 3).map((e) => e.frame)).toEqual([0, 3]);
    expect(typeSchedule('11', 3).map((e) => e.frame)).toEqual([0, 3 + REPEAT_RELEASE_FRAMES]);
    expect(typeSchedule('10p1', 3).map((e) => e.frame)).toEqual([0, 3, 6, 9]);
  });

  it('the ROM editor receives "101" and "ABA" complete', async () => {
    for (const [text, expected] of [
      ['101', '101'],
      ['1012', '1012'],
    ] as const) {
      const state = `${text}.zxstate`;
      await cli(['state', 'reset', '--blank', '--state', state]);
      await cli(['run', '--state', state, '--frames', '150']);
      const typed = await cli(['type', text, '--state', state, '--frames', '80']);
      expect(typed.code).toBe(0);
      const screen = await cli(['screen', '--state', state]);
      const rows = (screen.env.rows as string[]).join('\n');
      expect(rows).toContain(expected);
    }
  });
});
