// The ROM idling is not a hang — errors.md ERR-PROD-HANG-IDLE-001 (beside
// ERR-PROD-HANG-KINDS-001). A 48K waiting in the BASIC editor busy-polls in ROM with a
// frozen fingerprint, so the watchdog used to call a fresh boot, or a BASIC program that
// ended normally, `pc-in-rom` (and, failing that, `tight-loop`). The same rule must keep
// real hangs: `di`+`jr $`, `di`+`halt`, a RAM `ei` busy loop, a program stuck in a ROM
// routine with interrupts off, and a program that resets the machine.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { runCli } from '../src/cli.js';
import { buildCatalog, McpSession } from '../src/mcp.js';
import { runProgram, type RunResult } from '../src/runtime/run.js';
import { bootFreshMachine, loadBytesMachine, RAM_BASE } from '../src/runtime/session.js';
import { typeSchedule } from '../src/input/input-command.js';
import { ocrScreenRows, readScreenImage } from '../src/observe/screen.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-hang-idle-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Assemble and run a RAM program fresh under the watchdog (the `zxs run --bin` path). */
function runAsm(source: string, frames: number): RunResult {
  const asm = assemble(source);
  if (!asm.ok) throw new Error(JSON.stringify(asm.errors));
  return runProgram(loadBytesMachine(asm.bytes, asm.origin), asm.origin, { frames });
}

/** A power-on boot run for `frames` frames (what MCP `zx_run { fresh: true }` does). */
function bootRun(frames: number): RunResult {
  return runProgram(bootFreshMachine(), RAM_BASE, { frames });
}

/** A key schedule spec typing `text` (3 frames per key, repeats released). */
const typed = (text: string): string =>
  typeSchedule(text, 3)
    .map((e) => `${e.frame}:${e.key}*${e.hold}`)
    .join(',');

const screenText = (result: RunResult): string =>
  ocrScreenRows(readScreenImage(result.machine)).join('\n');

describe('the ROM idling in BASIC is not a hang (ERR-PROD-HANG-IDLE-001)', () => {
  for (const frames of [50, 100, 200, 300]) {
    it(`a power-on boot run for ${frames} frames is ok`, () => {
      const result = bootRun(frames);
      expect(result.status).toBe('ok');
      expect(result.hang).toBeUndefined();
    });
  }

  it('the boot ends in the editor showing the copyright, interrupts on', () => {
    const result = bootRun(300);
    expect(screenText(result)).toContain('1982 Sinclair Research Ltd');
    expect(result.registers.iff1).toBe(true);
  });

  it('a BASIC program that ends normally ("0 OK") is ok, not a hang', () => {
    const booted = runProgram(bootFreshMachine(), RAM_BASE, { frames: 120 });
    const entered = runProgram(booted.machine, RAM_BASE, {
      frames: 60,
      keys: typed('10p1\n'), // K-mode P = PRINT: `10 PRINT 1`
      border: booted.io.borderColor(),
      resume: true,
    });
    expect(entered.status).toBe('ok');
    const ran = runProgram(entered.machine, RAM_BASE, {
      frames: 150,
      keys: typed('r\n'), // K-mode R = RUN
      border: entered.io.borderColor(),
      resume: true,
    });
    expect(screenText(ran)).toContain('0 OK, 10:1');
    expect(ran.status).toBe('ok');
    expect(ran.hang).toBeUndefined();
  });
});

describe('a BASIC error report is BASIC, a program faulting into the ROM is rom-error', () => {
  it('typing PRINT a into the editor reports "2 Variable not found": ok, not rom-error', () => {
    const booted = runProgram(bootFreshMachine(), RAM_BASE, { frames: 150 });
    const result = runProgram(booted.machine, RAM_BASE, {
      frames: 100,
      keys: typed('pa\n'), // K-mode P = PRINT, then the variable a
      border: booted.io.borderColor(),
      resume: true,
    });
    expect(result.status).toBe('ok');
    expect(screenText(result)).toContain('2 Variable not found');
  });

  it('a RAM program executing RST 8 is a definite rom-error', () => {
    const result = runAsm('    ORG 0x8000\n    rst 8\n    defb 1\n', 50);
    expect(result.hang?.kind).toBe('rom-error');
    expect(result.hang?.confidence).toBe('definite');
  });

  it('a RAM program that CALLs a ROM routine raising a report is a definite rom-error', () => {
    // 0x1BB0 is REPORT-0 (RST 8 / DEFB 0xFF): the error restart is reached from ROM code
    // the program called and never returned from.
    const result = runAsm('    ORG 0x8000\n    call 0x1BB0\nback:\n    jr back\n', 50);
    expect(result.hang?.kind).toBe('rom-error');
    expect(result.framesRun).toBe(1);
  });
});

describe('real hangs keep their verdicts', () => {
  it('di + jr $ is a tight-loop', () => {
    const result = runAsm('    ORG 0x8000\n    di\nself:\n    jr self\n', 120);
    expect(result.hang?.kind).toBe('tight-loop');
  });

  it('di + halt is a definite di-halt', () => {
    const result = runAsm('    ORG 0x8000\n    di\n    halt\n', 120);
    expect(result.hang?.kind).toBe('di-halt');
    expect(result.hang?.confidence).toBe('definite');
  });

  it('an ei busy loop in RAM (IM 1) is still a tight-loop: the exemption is for the ROM only', () => {
    const result = runAsm('    ORG 0x8000\n    im 1\n    ei\nself:\n    jr self\n', 120);
    expect(result.frameBudget.interruptFrames).toBeGreaterThan(50);
    expect(result.hang?.kind).toBe('tight-loop');
  });

  it('a program stuck in a ROM routine with interrupts off is pc-in-rom', () => {
    // LD-BYTES (0x0556) waits for a tape signal with DI; there is no tape.
    const source = [
      '    ORG 0x8000',
      '    ld ix, 0x9000',
      '    ld de, 17',
      '    xor a',
      '    scf',
      '    call 0x0556',
      'back:',
      '    jr back',
      '',
    ].join('\n');
    const result = runAsm(source, 120);
    expect(result.hang?.kind).toBe('pc-in-rom');
    expect(result.frameBudget.interruptFrames).toBe(0);
  });

  it('a program that resets the machine is pc-in-rom, although the 48K then idles in BASIC', () => {
    const source = ['    ORG 0x8000', '    ld a, 2', '    out (0xfe), a', '    jp 0', ''].join('\n');
    const result = runAsm(source, 300);
    expect(screenText(result)).toContain('1982 Sinclair Research Ltd');
    expect(result.status).toBe('hang');
    expect(result.hang?.kind).toBe('pc-in-rom');
    expect(result.hang?.detail).toMatch(/0x0000/);
    expect(result.hang?.detail).toMatch(/frame 1\b/);
  });

  it('running off the end of the code into empty RAM wraps to 0x0000: also a reset', () => {
    // NOPs to 0xFFFF, then PC wraps to the reset vector.
    const result = runAsm('    ORG 0xFF00\n    nop\n', 300);
    expect(result.hang?.kind).toBe('pc-in-rom');
  });
});

describe('the CLI and MCP surfaces report an idle boot as ok', () => {
  async function cli(argv: string[]): Promise<{ code: number; env: Record<string, unknown> }> {
    const out: string[] = [];
    const prev = process.cwd();
    process.chdir(dir);
    try {
      const code = await runCli([...argv, '--json'], {
        streams: { out: (t) => out.push(t), err: () => {} },
      });
      return { code, env: JSON.parse(out.join('')) as Record<string, unknown> };
    } finally {
      process.chdir(prev);
    }
  }

  it('state reset --blank then run --state exits 0 (it used to exit 2, pc-in-rom)', async () => {
    expect((await cli(['state', 'reset', '--blank'])).code).toBe(0);
    const run = await cli(['run', '--state', '.zxs/state.zxstate']);
    expect(run.code).toBe(0);
    expect(run.env.status).toBe('ok');
    // Continuing the idle session is still idle.
    const again = await cli(['run', '--state', '.zxs/state.zxstate']);
    expect(again.code).toBe(0);
  });

  it('a --bin program that resets the machine still exits 2', async () => {
    const asm = assemble('    ORG 0x8000\n    jp 0\n');
    writeFileSync(join(dir, 'reset.bin'), asm.bytes);
    const run = await cli(['run', '--bin', 'reset.bin']);
    expect(run.code).toBe(2);
    expect((run.env.hang as { kind: string }).kind).toBe('pc-in-rom');
  });

  it('MCP zx_run { fresh: true } boots to an ok status', () => {
    const session = new McpSession(dir);
    const tools = new Map(buildCatalog(session).map((t) => [t.name, t]));
    const result = tools.get('zx_run')!.handler({ fresh: true, frames: 300 }) as {
      content: Array<{ text: string }>;
    };
    const env = JSON.parse(result.content[0]!.text) as { status: string };
    expect(env.status).toBe('ok');
  });
});
