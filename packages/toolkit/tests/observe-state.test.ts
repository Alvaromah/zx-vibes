// The observe verbs read (and the executing ones advance) an opt-in `--state` session —
// cli.md CLI-PROD-SCOPE-003 / CLI-PROD-CONV-SOURCE-001 / CLI-PROD-RULE-SESSION-001 and
// the CLI-PROD-STATE-OBSERVE-001 claim. Before this, `screen`/`step`/`disasm`/`trace`/
// `symbols`/`coverage` rejected `--state` as an unknown option, so the documented
// run→look loop showed a fresh, never-run machine.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { writeZ80 } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { deserializeZxState } from '../src/state/zxstate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-observe-state-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Env = Record<string, unknown> & { ok: boolean };

/** Run `zxs <argv> --json` inside the temp project; returns the envelope and exit code. */
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

const STATE = '.zxs/state.zxstate';

/** A program that copies the ROM glyph of `ch` into the top-left cell, then idles on HALT. */
function drawGlyph(ch: string): string {
  return [
    '    ORG 0x8000',
    'main:',
    `    ld hl, 0x3D00 + (${ch.charCodeAt(0)} - 32) * 8`,
    '    ld de, 0x4000',
    '    ld b, 8',
    'copy:',
    '    ld a, (hl)',
    '    ld (de), a',
    '    inc hl',
    '    inc d',
    '    djnz copy',
    '    ei',
    'idle:',
    '    halt',
    '    jr idle',
    '',
  ].join('\n');
}

/** Write a one-file project (`zx.config.json` + `src/main.asm`). */
function project(source: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm' }));
  writeFileSync(join(dir, 'src', 'main.asm'), source);
}

const rows = (env: Env): string[] => env.rows as string[];
const pcOf = (env: Env): number => (env.registers as { pc: number }).pc;
const sessionPc = (): number =>
  deserializeZxState(readFileSync(join(dir, STATE), 'utf8')).machine.registers.pc & 0xffff;

describe('the run→look loop over a --state session (CLI-PROD-STATE-OBSERVE-001)', () => {
  it('screen --state shows what the run drew, and follows a source edit', async () => {
    project(drawGlyph('A'));
    expect((await cli(['build'])).code).toBe(0);
    expect((await cli(['state', 'reset'])).code).toBe(0);
    const run = await cli(['run', '--state', STATE, '--frames', '5']);
    expect(run.code).toBe(0);
    expect(run.env.status).toBe('ok');

    const look = await cli(['screen', '--text', '--state', STATE]);
    expect(look.code).toBe(0);
    expect(look.env.boot).toMatchObject({ source: 'state', file: STATE });
    expect(rows(look.env)[0]!.startsWith('A')).toBe(true);

    // Without --state the observer stays stateless: the entry loaded, never run.
    const fresh = await cli(['screen', '--text']);
    expect(rows(fresh.env)[0]!.trim()).toBe('');

    // Edit → build → reset → run → look sees the NEW program, not the old session.
    project(drawGlyph('B'));
    expect((await cli(['build'])).code).toBe(0);
    expect((await cli(['state', 'reset'])).code).toBe(0);
    expect((await cli(['run', '--state', STATE, '--frames', '5'])).code).toBe(0);
    const again = await cli(['screen', '--state', STATE]);
    expect(rows(again.env)[0]!.startsWith('B')).toBe(true);
  });

  it('screen / disasm / symbols --state never write the session file', async () => {
    project(drawGlyph('A'));
    await cli(['state', 'reset']);
    const before = readFileSync(join(dir, STATE), 'utf8');
    expect((await cli(['screen', '--state', STATE])).code).toBe(0);
    expect((await cli(['disasm', 'PC', '--state', STATE])).code).toBe(0);
    expect((await cli(['symbols', '--state', STATE])).code).toBe(0);
    expect(readFileSync(join(dir, STATE), 'utf8')).toBe(before);
  });

  it('a missing session is a user error naming it, never a silent fresh boot', async () => {
    project(drawGlyph('A'));
    for (const argv of [
      ['screen', '--state', 'nope.zxstate'],
      ['step', '--state', 'nope.zxstate'],
      ['disasm', 'PC', '--state', 'nope.zxstate'],
      ['trace', '--state', 'nope.zxstate'],
      ['symbols', '--state', 'nope.zxstate'],
      ['coverage', '--state', 'nope.zxstate'],
      ['run', '--state', 'nope.zxstate'],
    ]) {
      const { code, env } = await cli(argv);
      expect(code, argv.join(' ')).toBe(1);
      expect(env.stage, argv.join(' ')).toBe(argv[0]);
      expect((env.error as { message: string }).message).toMatch(/No session at "nope\.zxstate"/);
    }
  });
});

describe('step / trace / coverage --state advance the session like run --state', () => {
  // Three 2-byte loads, then a HALT-synced loop bumping a 16-bit counter at 0x9000.
  const COUNTER = [
    '    ORG 0x8000',
    'main:',
    '    ld a, 1',
    '    ld a, 2',
    '    ld a, 3',
    '    ei',
    'loop:',
    '    halt',
    '    ld hl, (0x9000)',
    '    inc hl',
    '    ld (0x9000), hl',
    '    jr loop',
    '',
  ].join('\n');

  it('step --state saves the stepped machine back; --no-save leaves the file alone', async () => {
    project(COUNTER);
    await cli(['state', 'reset']);
    const first = await cli(['step', '--state', STATE]);
    expect(first.env.from).toBe(0x8000);
    expect(first.env.pc).toBe(0x8002);
    expect(first.env.persisted).toBe(true);
    expect(sessionPc()).toBe(0x8002);

    const second = await cli(['step', '--state', STATE]);
    expect(second.env.from).toBe(0x8002); // continues from the saved session
    expect(sessionPc()).toBe(0x8004);

    const dry = await cli(['step', '--state', STATE, '--no-save']);
    expect(dry.env.pc).toBe(0x8006);
    expect(dry.env.persisted).toBe(false);
    expect(sessionPc()).toBe(0x8004);

    // Stateless step is unchanged: it starts at the entry and reports no persistence.
    const stateless = await cli(['step']);
    expect(stateless.env.from).toBe(0x8000);
    expect(stateless.env.persisted).toBeUndefined();
    expect(sessionPc()).toBe(0x8004);
  });

  it('trace --state runs the session on and saves it; --read-only does not', async () => {
    project(COUNTER);
    await cli(['state', 'reset']);
    const traced = await cli(['trace', '--state', STATE, '--frames', '3']);
    expect(traced.code).toBe(0);
    expect(traced.env.boot).toMatchObject({ source: 'state' });
    expect(traced.env.persisted).toBe(true);
    const counter = async (): Promise<number[]> =>
      (await cli(['mem', 'read', '0x9000', '--len', '2', '--state', STATE])).env.bytes as number[];
    const afterTrace = await counter();
    expect(afterTrace[0]).toBeGreaterThan(0);

    const dry = await cli(['trace', '--state', STATE, '--frames', '3', '--read-only']);
    expect(dry.env.persisted).toBe(false);
    expect(await counter()).toEqual(afterTrace);
  });

  it('trace --profile --state attributes time to the entry routines', async () => {
    project(COUNTER);
    await cli(['state', 'reset']);
    const traced = await cli(['trace', '--state', STATE, '--frames', '3', '--profile']);
    const entries = (traced.env.profile as { entries: Array<{ symbol: string }> }).entries;
    expect(entries.map((e) => e.symbol)).toContain('loop');
  });

  it('coverage --state reports the executed RAM code and the entry routines', async () => {
    project(COUNTER);
    await cli(['state', 'reset']);
    const cov = await cli(['coverage', '--state', STATE, '--frames', '5']);
    expect(cov.code).toBe(0);
    expect(cov.env.persisted).toBe(true);
    expect(cov.env.executed as number[]).toContain(0x8000);
    const routines = cov.env.routines as Array<{ name: string; reached: boolean }>;
    expect(routines.find((r) => r.name === 'loop')?.reached).toBe(true);
  });

  it('coverage --z80 reports the executed code (a snapshot image spans RAM, not zero bytes)', async () => {
    const asm = assemble(COUNTER);
    const memory = new Uint8Array(0x10000);
    memory.set(asm.bytes, asm.origin);
    writeFileSync(
      join(dir, 'snap.z80'),
      writeZ80({ registers: { pc: asm.origin, sp: 0xff00 }, memory, border: 7 }),
    );
    const cov = await cli(['coverage', '--z80', 'snap.z80', '--frames', '5']);
    expect(cov.code).toBe(0);
    expect(cov.env.executed as number[]).toContain(0x8000);
  });
});

describe('disasm / symbols --state borrow the configured entry SLD', () => {
  const PROGRAM = ['    ORG 0x8000', 'main:', '    nop', 'here:', '    jr here', ''].join('\n');

  it('disasm PC --state starts at the session PC; a label resolves from the entry', async () => {
    project(PROGRAM);
    await cli(['state', 'reset']);
    await cli(['step', '--state', STATE]); // PC -> 0x8001 (`here`)
    const atPc = await cli(['disasm', 'PC', '--count', '1', '--state', STATE]);
    expect(atPc.env.addr).toBe(0x8001);
    const byLabel = await cli(['disasm', 'here', '--count', '1', '--state', STATE]);
    expect(byLabel.env.addr).toBe(0x8001);
    expect((byLabel.env.instructions as Array<{ label?: string }>)[0]!.label).toBe('here');
  });

  it('with a broken entry, PC still disassembles but a label fails loud', async () => {
    project(PROGRAM);
    await cli(['state', 'reset']);
    writeFileSync(join(dir, 'src', 'main.asm'), '    ORG 0x8000\n    bogus_instruction\n');
    const atPc = await cli(['disasm', 'PC', '--state', STATE]);
    expect(atPc.code).toBe(0);
    const byLabel = await cli(['disasm', 'here', '--state', STATE]);
    expect(byLabel.code).toBe(1);
    expect((byLabel.env.error as { message: string }).message).toMatch(/build failed/);
  });

  it('symbols --state reports the entry symbols the session is labelled with', async () => {
    project(PROGRAM);
    await cli(['state', 'reset']);
    const syms = await cli(['symbols', '--state', STATE]);
    expect((syms.env.symbols as Array<{ name: string }>).map((s) => s.name)).toEqual(['main', 'here']);
  });
});

describe('pc reported by run --state matches what step --state continues from', () => {
  it('a run that stopped at a breakpoint is stepped from that PC', async () => {
    project(['    ORG 0x8000', '    di', 'top:', '    nop', 'bp:', '    nop', '    jr top', ''].join('\n'));
    await cli(['state', 'reset']);
    await cli(['break', 'add', 'bp']);
    const run = await cli(['run', '--state', STATE, '--until-break']);
    expect(run.env.status).toBe('breakpoint');
    expect(pcOf(run.env)).toBe(0x8002);
    const step = await cli(['step', '--state', STATE]);
    expect(step.env.from).toBe(0x8002);
  });
});
