// Write watchpoints fire on any write into their range, including a write of the byte
// already there — cli.md CLI-PROD-RUN-003 / CLI-PROD-RUN-007. They used to compare the
// watched bytes with their starting values, so `ld (0x9000),a` with A equal to the byte
// there never fired. `--until-change` stays value-based.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { runProgram, type RunParams, type RunResult } from '../src/runtime/run.js';
import { loadBytesMachine } from '../src/runtime/session.js';
import { instructionWriteTargets } from '../src/runtime/write-targets.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-write-watch-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(source: string, params: RunParams): RunResult {
  const asm = assemble(source);
  if (!asm.ok) throw new Error(JSON.stringify(asm.errors));
  return runProgram(loadBytesMachine(asm.bytes, asm.origin), asm.origin, { frames: 10, ...params });
}

const RANGE_9000 = { from: 0x9000, to: 0x9000 };

// Stores A = 0 over the 0 already at 0x9000, forever: writes that change nothing.
const SAME_VALUE = ['    ORG 0x8000', '    xor a', 'loop:', '    ld (0x9000), a', '    jr loop', ''].join('\n');

describe('a write of the same value is a write', () => {
  it('--watch-write fires on it (it never did), right after the store', () => {
    const result = run(SAME_VALUE, { watchWrite: [RANGE_9000] });
    expect(result.status).toBe('watchpoint');
    expect(result.exit).toEqual({ reason: 'watchpoint', pc: 0x8004 });
  });

  it('--until-write fires on it too', () => {
    expect(run(SAME_VALUE, { untilWrite: { from: 0x9000, to: 0x9001 } }).status).toBe('watchpoint');
  });

  it('--until-change does NOT: the byte never changes', () => {
    expect(run(SAME_VALUE, { untilChange: 0x9000, detectHangs: false }).status).toBe('ok');
  });

  it('reading the watched byte is not a write', () => {
    const reads = ['    ORG 0x8000', 'loop:', '    ld a, (0x9000)', '    jr loop', ''].join('\n');
    expect(run(reads, { watchWrite: [RANGE_9000], detectHangs: false }).status).toBe('ok');
  });

  it('the CLI flag and the stored `watch add --write` see it as well', async () => {
    writeFileSync(join(dir, 'p.bin'), assemble(SAME_VALUE).bytes);
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const out: string[] = [];
      const streams = { out: (t: string) => out.push(t), err: () => {} };
      await runCli(['run', '--bin', 'p.bin', '--frames', '10', '--watch-write', '0x9000-0x9000', '--json'], { streams });
      expect(JSON.parse(out.pop()!).status).toBe('watchpoint');
      await runCli(['watch', 'add', '--write', '0x9000-0x9000', '--json'], { streams });
      out.length = 0;
      await runCli(['run', '--bin', 'p.bin', '--until-watch', '--json'], { streams });
      expect(JSON.parse(out.pop()!).status).toBe('watchpoint');
    } finally {
      process.chdir(prev);
    }
  });
});

describe('every kind of memory write is seen', () => {
  const watch9000 = { watchWrite: [{ from: 0x9000, to: 0x9001 }], detectHangs: false };

  it('a PUSH onto a watched stack slot', () => {
    const src = ['    ORG 0x8000', '    ld sp, 0x9002', '    ld bc, 0', '    push bc', 'h:', '    jr h', ''].join('\n');
    expect(run(src, watch9000).status).toBe('watchpoint');
  });

  it('a conditional CALL that is not taken writes nothing', () => {
    const src = [
      '    ORG 0x8000',
      '    ld sp, 0x9002',
      '    xor a',
      '    call nz, sub',
      'h:',
      '    jr h',
      'sub:',
      '    ret',
      '',
    ].join('\n');
    expect(run(src, watch9000).status).toBe('ok');
  });

  it("an interrupt's PC push into the watched slot", () => {
    const src = ['    ORG 0x8000', '    ld sp, 0x9002', '    im 1', '    ei', 'h:', '    jr h', ''].join('\n');
    const result = run(src, watch9000);
    expect(result.status).toBe('watchpoint');
    expect(result.exit.pc).toBe(0x0038); // stopped as the ISR is entered
  });

  it('RES on (IX+d) of a bit already clear, and an LDIR of equal bytes', () => {
    const res = ['    ORG 0x8000', '    ld ix, 0x8FFB', '    res 0, (ix+5)', 'h:', '    jr h', ''].join('\n');
    expect(run(res, watch9000).status).toBe('watchpoint');
    const ldir = [
      '    ORG 0x8000',
      '    ld hl, 0xA000',
      '    ld de, 0x9000',
      '    ld bc, 2',
      '    ldir',
      'h:',
      '    jr h',
      '',
    ].join('\n');
    // Watch only the SECOND destination byte: LDIR runs one byte per step, so the first
    // iteration (to 0x9000) must not fire and the second (to 0x9001) must.
    const second = run(ldir, { watchWrite: [{ from: 0x9001, to: 0x9001 }], detectHangs: false });
    expect(second.status).toBe('watchpoint');
    expect(second.exit.pc).toBe(0x800b); // after the second iteration, past the LDIR
  });
});

describe('instructionWriteTargets decodes the write set', () => {
  function targets(source: string, regs: Record<string, number> = {}): ReturnType<typeof instructionWriteTargets> {
    const asm = assemble(`    ORG 0x8000\n${source}\n`);
    const machine = loadBytesMachine(asm.bytes, asm.origin);
    Object.assign(machine.registers, regs);
    return instructionWriteTargets(machine);
  }

  it('memory destinations, and nothing for reads or BIT', () => {
    expect(targets('    ld (hl), a', { h: 0x90, l: 0x10 }).addrs).toEqual([0x9010]);
    expect(targets('    ld (0x9123), hl').addrs).toEqual([0x9123, 0x9124]);
    expect(targets('    ld (0x9123), sp').addrs).toEqual([0x9123, 0x9124]);
    expect(targets('    ld (iy-2), 7', { iyh: 0x90, iyl: 0x10 }).addrs).toEqual([0x900e]);
    expect(targets('    set 7, (ix+1)', { ixh: 0x90, ixl: 0x00 }).addrs).toEqual([0x9001]);
    expect(targets('    bit 7, (ix+1)', { ixh: 0x90, ixl: 0x00 }).addrs).toEqual([]);
    expect(targets('    bit 0, (hl)').addrs).toEqual([]);
    expect(targets('    ld a, (hl)').addrs).toEqual([]);
    expect(targets('    halt').addrs).toEqual([]);
    expect(targets('    rst 0x38').push).toBe(true);
    expect(targets('    ex (sp), ix', { sp: 0x9000 }).addrs).toEqual([0x9000, 0x9001]);
  });
});
