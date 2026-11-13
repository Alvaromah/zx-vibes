// One meaning for `boot` — cli.md CLI-PROD-CONV-BOOT-001. `boot.org` is a program's load
// origin; a source without one (a `--state` session, a `.z80` snapshot, a fresh boot)
// reports the PC the command starts at as `boot.pc`. Before, the same session file gave
// `org: 16384` in `run` (its internal hang floor) and `org: <session PC>` in `regs`.
// Also: the `pc-in-rom` verdict names the commonest cause at entry — a ROM routine that
// needs the system variables (toolkit-runtime.md RT-PROD-ENTRY-001).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-boot-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Env = Record<string, unknown> & { ok: boolean; boot?: Record<string, unknown> };

async function cli(argv: string[]): Promise<{ code: number; env: Env }> {
  const out: string[] = [];
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const code = await runCli([...argv, '--json'], { streams: { out: (t) => out.push(t), err: () => {} } });
    return { code, env: JSON.parse(out.join('')) as Env };
  } finally {
    process.chdir(prev);
  }
}

function project(source: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm' }));
  writeFileSync(join(dir, 'src', 'main.asm'), source);
}

const IDLE = ['    ORG 0x8000', '    ei', 'loop:', '    halt', '    jr loop', ''].join('\n');
const SESSION = '.zxs/state.zxstate';

describe('boot reports an origin only where there is one (CLI-PROD-CONV-BOOT-001)', () => {
  it('a --state session: run, regs and mem report the same boot, with pc and no org', async () => {
    project(IDLE);
    expect((await cli(['build'])).code).toBe(0);
    expect((await cli(['state', 'reset'])).code).toBe(0);
    // Pause the session on its HALT (0x8001), as in FEEDBACK #13.
    expect((await cli(['run', '--frames', '1', '--state', SESSION])).code).toBe(0);

    const run = await cli(['run', '--frames', '1', '--state', SESSION, '--no-save']);
    const regs = await cli(['regs', '--state', SESSION]);
    const mem = await cli(['mem', 'read', '0x8000', '--state', SESSION]);
    const expected = { source: 'state', pc: 0x8001, file: SESSION };
    for (const env of [run.env, regs.env, mem.env]) {
      expect(env.boot).toEqual(expected);
    }
  });

  it('a built program keeps its origin; a fresh boot reports its reset PC', async () => {
    project(IDLE);
    const run = await cli(['run', '--frames', '1']);
    expect(run.env.boot).toEqual({ source: 'build', org: 0x8000, entry: 'src/main.asm' });

    rmSync(join(dir, 'zx.config.json'));
    const fresh = await cli(['regs']);
    expect(fresh.env.boot).toEqual({ source: 'fresh', pc: 0 });
  });
});

describe('pc-in-rom names the ROM routine that needs the system variables (RT-PROD-ENTRY-001)', () => {
  it('rst 0x10 at entry hangs as pc-in-rom with the start-up hint', async () => {
    project(['    ORG 0x8000', '    ld sp, 0xFF00', '    ld a, 0x41', '    rst 0x10', '    ei', 'loop:', '    halt', '    jr loop', ''].join('\n'));
    const { code, env } = await cli(['run']);
    expect(code).toBe(2);
    const exit = env.exit as { kind?: string; likelyCause?: string };
    expect(exit.kind).toBe('pc-in-rom');
    expect(exit.likelyCause).toContain('`rst 0x10`');
    expect(exit.likelyCause).toContain('system variables');
    expect(exit.likelyCause).toContain("without the ROM's start-up");
  });
});
