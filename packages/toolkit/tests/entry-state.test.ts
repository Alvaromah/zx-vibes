// How a built program is entered — toolkit-runtime.md RT-PROD-ENTRY-001. The toolkit
// loads the build and starts it at its ORG from the power-on state (the reset register
// file, zeroed RAM, the write-protected ROM). The ROM's start-up never runs, so every
// system variable is zero; the ROM's frame interrupt handler still runs (IM 0 takes
// `rst 0x38` off the 0xFF data bus) and ticks FRAMES.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESET_REGISTERS } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { bootPreviewProgram } from '../src/preview/player-boot.js';
import { loadRom } from '../src/runtime/rom.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-entry-'));
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

/** `ei` (IM 0, as the starters use) and a HALT loop: the ROM handler runs each frame. */
const IDLE = ['    ORG 0x8000', 'start:', '    ei', 'loop:', '    halt', '    jr loop', ''].join('\n');

const SESSION = '.zxs/state.zxstate';
const FRAMES = 0x5c78;
const ERR_NR = 0x5c3a; // 0xFF once the ROM's start-up has run
const FLAGS = 0x5c3b;

function writeProject(): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'zx.config.json'), JSON.stringify({ entry: 'src/main.asm' }));
  writeFileSync(join(dir, 'src', 'main.asm'), IDLE);
}

async function memRead(addr: number, len: number): Promise<number[]> {
  const { code, env } = await cli(['mem', 'read', `0x${addr.toString(16)}`, '--len', String(len), '--state', SESSION]);
  expect(code).toBe(0);
  return env.bytes as number[];
}

describe('RT-PROD-ENTRY-001: a built program starts from the power-on state', () => {
  it('enters at ORG with the reset register file', async () => {
    writeProject();
    expect((await cli(['build'])).code).toBe(0);
    expect((await cli(['state', 'reset'])).code).toBe(0);

    const { code, env } = await cli(['regs', '--state', SESSION]);
    expect(code).toBe(0);
    expect(env.registers).toMatchObject({
      pc: 0x8000,
      sp: 0xffff,
      af: 0xffff,
      bc: 0xffff,
      de: 0xffff,
      hl: 0xffff,
      alt: { af: 0xffff, bc: 0xffff, de: 0xffff, hl: 0xffff },
      ix: 0xffff,
      iy: 0xffff,
      i: 0,
      r: 0,
      im: 0,
      iff1: false,
      iff2: false,
    });
  });

  it('leaves the system variables zero while the ROM handler ticks FRAMES', async () => {
    writeProject();
    expect((await cli(['build'])).code).toBe(0);
    expect((await cli(['state', 'reset'])).code).toBe(0);
    const run = await cli(['run', '--frames', '50', '--state', SESSION]);
    expect(run.code).toBe(0);
    expect(run.env.status).toBe('ok');

    // The ROM's frame handler ran once per frame...
    expect(await memRead(FRAMES, 2)).toEqual([50, 0]);
    // ...but its start-up never did: ERR_NR and FLAGS are still zero.
    expect(await memRead(ERR_NR, 2)).toEqual([0, 0]);
    expect((await memRead(FLAGS, 1))[0]).toBe(0);
  });

  it('boots the preview player the same way for a built binary', () => {
    const rom = loadRom();
    const program = Uint8Array.from([0xfb, 0x76, 0x18, 0xfd]); // ei / halt / jr -3
    const booted = bootPreviewProgram('bin', program, 0x8000, rom);
    const { machine } = booted;

    expect(machine.registers.pc).toBe(0x8000);
    for (const [name, value] of Object.entries(RESET_REGISTERS)) {
      if (name === 'pc') continue;
      expect(machine.registers[name as keyof typeof machine.registers], name).toBe(value);
    }
    // RAM other than the program is zero: no system variables.
    expect(machine.memory.subarray(0x5c00, 0x5cc0).every((byte) => byte === 0)).toBe(true);
    // The ROM is write-protected.
    expect(machine.romTop()).toBe(0x4000);
  });
});
