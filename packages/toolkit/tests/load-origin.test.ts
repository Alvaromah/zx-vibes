// One load-origin rule for every command that runs a built program — cli.md
// CLI-PROD-CONV-ORIGIN-001. `run`/`verify` used to load the binary at the configured
// `org` (0x8000 by default) while the observe/state commands and `test` used the
// assembled ORG, so a source with `ORG 0x9000` ran from the wrong address in `run`:
// its absolute `JP` landed in empty RAM and the run "hung".

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZ80 } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { programLoadOrigin } from '../src/runtime/session.js';
import { runTestSuite } from '../src/test/runner.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-load-origin-'));
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

/**
 * Jumps over a data byte with an ABSOLUTE `JP`, stores a marker, then idles. Loaded
 * anywhere but its ORG, the `JP` lands in empty RAM and the program never runs.
 */
const AT_9000 = [
  '    ORG 0x9000',
  '    jp start',
  'flag:',
  '    defb 0',
  'start:',
  '    ld a, 0x55',
  '    ld (0xA000), a',
  '    ei',
  'idle:',
  '    halt',
  '    jr idle',
  '',
].join('\n');

/** Position-independent and without ORG: assembled at 0x0000, so it loads at `org`. */
const NO_ORG = ['    ld a, 0x66', '    ld (0xA000), a', '    ei', 'idle:', '    halt', '    jr idle', ''].join('\n');

function project(source: string, config: Record<string, string> = {}): void {
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'main.asm', ...config }));
  writeFileSync(join(dir, 'main.asm'), source);
}

const marker = async (state?: string): Promise<number> =>
  ((await cli(['mem', 'read', '0xA000', '--len', '1', ...(state ? ['--state', state] : [])])).env
    .bytes as number[])[0]!;

describe('programLoadOrigin (CLI-PROD-CONV-ORIGIN-001)', () => {
  it('an ORG wins over the configured org; no ORG falls back to it', () => {
    expect(programLoadOrigin(0x9000, 0x8000)).toBe(0x9000);
    expect(programLoadOrigin(0x0000, 0x8000)).toBe(0x8000);
    expect(programLoadOrigin(0x0000, () => 0xa000)).toBe(0xa000);
    // The fallback is only consulted for a source without ORG.
    expect(programLoadOrigin(0x9000, () => {
      throw new Error('not needed');
    })).toBe(0x9000);
  });
});

describe('run / verify load a built entry at its ORG, like every other command', () => {
  it('run: ORG 0x9000 with the default config org 0x8000 runs from 0x9000', async () => {
    project(AT_9000, { org: '0x8000' });
    const run = await cli(['run', '--frames', '20']);
    expect(run.code).toBe(0);
    expect(run.env.status).toBe('ok');
    expect(run.env.boot).toMatchObject({ source: 'build', org: 0x9000 });
    // The program really ran: it reached the store past the absolute JP.
    const state = '.zxs/o.zxstate';
    await cli(['state', 'reset', '--state', state]);
    await cli(['run', '--frames', '20', '--state', state]);
    expect(await marker(state)).toBe(0x55);
  });

  it('verify embeds a run from the same address and passes', async () => {
    project(AT_9000);
    const verify = await cli(['verify']);
    expect(verify.code).toBe(0);
    expect((verify.env.run as Env).boot).toMatchObject({ org: 0x9000 });
    expect((verify.env.run as Env).status).toBe('ok');
  });

  it('run, regs, state reset and test all agree on the address', async () => {
    project(AT_9000);
    const run = await cli(['run', '--frames', '1']);
    const regs = await cli(['regs']);
    const reset = await cli(['state', 'reset']);
    expect((run.env.boot as { org: number }).org).toBe(0x9000);
    expect((regs.env.boot as { org: number }).org).toBe(0x9000);
    expect(reset.env.pc).toBe(0x9000);

    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'p.asm'), AT_9000);
    writeFileSync(
      join(dir, 'tests', 'p.test.json'),
      JSON.stringify({ build: 'p.asm', frames: 10, assert: [{ type: 'memEquals', addr: '0xA000', hex: '55' }] }),
    );
    expect(runTestSuite(join(dir, 'tests'), dir).failed).toBe(0);
  });
});

describe('a source without ORG loads at the configured org everywhere', () => {
  it('run keeps loading it at org (unchanged) and honours --org', async () => {
    project(NO_ORG, { org: '0x8000' });
    const run = await cli(['run', '--frames', '5']);
    expect(run.code).toBe(0);
    expect(run.env.boot).toMatchObject({ org: 0x8000 });
    const moved = await cli(['run', '--frames', '5', '--org', '0xB000']);
    expect(moved.env.boot).toMatchObject({ org: 0xb000 });
  });

  it('the observe commands load it at org too (they used to refuse: "below RAM")', async () => {
    project(NO_ORG, { org: '0xC000' });
    const regs = await cli(['regs']);
    expect(regs.code).toBe(0);
    expect(regs.env.boot).toMatchObject({ source: 'build', org: 0xc000 });
    expect((regs.env.registers as { pc: number }).pc).toBe(0xc000);
  });

  it('build --z80 snapshots it at org instead of failing', async () => {
    project(NO_ORG, { org: '0xC000' });
    const build = await cli(['build', '--z80']);
    expect(build.code).toBe(0);
    const z80 = readZ80(new Uint8Array(readFileSync(join(dir, 'build', 'main.z80'))));
    expect(z80.registers.pc).toBe(0xc000);
    expect(z80.memory[0xc000]).toBe(0x3e); // ld a, n
  });

  it('a test spec without org loads it at 0x8000 (REC-PROD-SPEC-003 default)', () => {
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'p.asm'), NO_ORG);
    writeFileSync(
      join(dir, 'tests', 'p.test.json'),
      JSON.stringify({ build: 'p.asm', frames: 10, assert: [{ type: 'memEquals', addr: '0xA000', hex: '66' }] }),
    );
    const suite = runTestSuite(join(dir, 'tests'), dir);
    expect(suite.results[0]?.failures).toEqual([]);
    expect(suite.failed).toBe(0);
  });
});
