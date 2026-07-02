// Slice 7b — input commands (key/type), session mutation (regs set / mem write /
// mem load), the persistent debug store (break/watch), and the `.zxstate` session
// format (cli.md CLI-PROD-INPUT/STATE/BREAK/WATCH-*, toolkit-runtime.md
// RT-PROD-SESSION-*, file-formats.md FF-ZXSTATE-001, mcp-tools.md
// MCP-PROD-RULE-INTEROP-001 / MCP-PROD-AC-INTEROP-001).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemble } from '@zx-vibes/asm';
import { createMachine, parseTap, readZ80 } from '@zx-vibes/machine';
import { runCli } from '../src/cli.js';
import { ExitCode, type OutputStreams } from '../src/output/envelope.js';
import { deserializeZxState, serializeZxState } from '../src/state/zxstate.js';
import { addBreakpoint, addWatchpoint, emptyDebugStore } from '../src/state/debug-store.js';
import { loadDebugStore, loadSession } from '../src/state/persist.js';
import { runStateExportZ80, runStateReset, runStateSave } from '../src/state/state-command.js';
import { runRegsSet } from '../src/observe/regs-command.js';
import { runMemLoad, runMemWrite } from '../src/observe/memory.js';
import { runKey, runType } from '../src/input/input-command.js';
import { readRegisters } from '../src/observe/registers.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zxs-state-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function capture(): { streams: OutputStreams; out: () => string; err: () => string } {
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  return {
    streams: { out: (t) => outChunks.push(t), err: (t) => errChunks.push(t) },
    out: () => outChunks.join(''),
    err: () => errChunks.join(''),
  };
}

/** Assemble a program to bytes (throws on error). */
function asm(source: string): Uint8Array {
  const r = assemble(source);
  if (!r.ok) throw new Error(`asm failed: ${r.errors.map((e) => e.message).join('; ')}`);
  return r.bytes;
}

const STATE = '.zxs/state.zxstate';

// Polls row 5 (BC=0xDFFE) for the O key; when O is pressed (bit 1 = 0) it stores
// 0x99 at 0x9000 and spins — a clean "the keypress reached execution" sentinel.
const KEY_PROG = [
  'ORG 0x8000',
  'start:',
  '  ld bc, 0xDFFE',
  '  in a, (c)',
  '  bit 1, a',
  '  jr nz, start',
  '  ld a, 0x99',
  '  ld (0x9000), a',
  'done:',
  '  jr done',
  '',
].join('\n');

// ld a,1 / nop / spin@0x8003 — PC reaches 0x8003 within frame 0.
const BREAK_PROG = ['ORG 0x8000', '  ld a, 1', '  nop', 'spin:', '  jr spin', ''].join('\n');

// Writes 0xAB to 0x9000, then spins — the write trips a write watchpoint.
const WATCH_PROG = ['ORG 0x8000', '  ld a, 0xAB', '  ld (0x9000), a', 'spin:', '  jr spin', ''].join('\n');

// EI / HALT / JR loop — the interrupt-paced 50 Hz substrate (halt-synced, not a hang).
const HALT_PROG = ['ORG 0x8000', '  ei', 'loop:', '  halt', '  jr loop', ''].join('\n');

// =========================================================================
// The .zxstate format — round-trip (the CLI↔MCP interop contract)
// =========================================================================

describe('.zxstate codec (FF-ZXSTATE-001, MCP-PROD-AC-INTEROP-001)', () => {
  it('round-trips registers + 64K memory + border + halted + the debug stores', () => {
    const machine = createMachine();
    machine.registers.pc = 0x8042;
    machine.registers.sp = 0x7ffe;
    machine.registers.h = 0x12;
    machine.registers.l = 0x34; // HL = 0x1234
    machine.registers.a = 0x56;
    machine.registers.iff1 = 1;
    machine.registers.im = 2;
    machine.halted = true;
    machine.memory[0x9000] = 0xab;
    machine.memory[0xbeef] = 0xcd;

    const debug = emptyDebugStore();
    addBreakpoint(debug, 0x8003, '0x8003');
    addWatchpoint(debug, 'write', 0x9000, 0x9001, '0x9000-0x9001');

    const text = serializeZxState({ machine, border: 4, debug });
    const back = deserializeZxState(text);

    expect(back.machine.registers.pc).toBe(0x8042);
    expect(back.machine.registers.sp).toBe(0x7ffe);
    expect(readRegisters(back.machine).hl).toBe(0x1234);
    expect(back.machine.registers.a).toBe(0x56);
    expect(back.machine.registers.iff1).toBe(1);
    expect(back.machine.registers.im).toBe(2);
    expect(back.machine.halted).toBe(true);
    expect(back.machine.memory[0x9000]).toBe(0xab);
    expect(back.machine.memory[0xbeef]).toBe(0xcd);
    expect(back.border).toBe(4);
    expect(back.debug.breakpoints).toHaveLength(1);
    expect(back.debug.breakpoints[0]!.addr).toBe(0x8003);
    expect(back.debug.watchpoints[0]!.type).toBe('write');
  });

  it('carries an emulatorId + format tag and rejects a foreign file (no silent mis-load)', () => {
    const text = serializeZxState({ machine: createMachine(), border: 7, debug: emptyDebugStore() });
    const env = JSON.parse(text);
    expect(env.emulatorId).toBe('zx-vibes');
    expect(env.format).toBe('zxstate');
    expect(() => deserializeZxState(JSON.stringify({ format: 'other', emulatorId: 'x' }))).toThrow();
  });
});

// =========================================================================
// state save / load / reset / export-z80
// =========================================================================

describe('state save/load/reset (CLI-PROD-STATE-001)', () => {
  it('save creates a .zxstate; a mutation against --state persists; load reflects it', () => {
    runStateSave(STATE, { cwd: dir });
    runRegsSet({ cwd: dir, state: STATE, reg: 'hl', value: 0x4321 });
    runMemWrite({ cwd: dir, state: STATE, addr: '0x9000', hex: 'AB CD' });

    const loaded = loadSession(STATE, dir);
    expect(readRegisters(loaded.machine).hl).toBe(0x4321);
    expect(loaded.machine.memory[0x9000]).toBe(0xab);
    expect(loaded.machine.memory[0x9001]).toBe(0xcd);
  });

  it('mem load --state loads a file into the session and persists it', () => {
    runStateSave(STATE, { cwd: dir });
    writeFileSync(join(dir, 'payload.bin'), Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));
    const env = runMemLoad({ cwd: dir, state: STATE, addr: '0x9100', file: 'payload.bin' });
    expect(env.persisted).toBe(true);
    expect(env.len).toBe(4);
    const loaded = loadSession(STATE, dir);
    expect([...loaded.machine.memory.slice(0x9100, 0x9104)]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('reset returns the session machine to a fresh clean-ROM boot', () => {
    runStateSave(STATE, { cwd: dir });
    runMemWrite({ cwd: dir, state: STATE, addr: '0x9000', hex: 'FF' });
    expect(loadSession(STATE, dir).machine.memory[0x9000]).toBe(0xff);

    runStateReset({ cwd: dir, state: STATE });
    const reset = loadSession(STATE, dir);
    expect(reset.machine.memory[0x9000]).toBe(0x00); // RAM cleared
    expect(reset.machine.memory[0x0000]).toBe(0xf3); // ROM mapped (DI)
    expect(reset.machine.registers.pc).toBe(0x0000);
  });

  it('a mutation without --state applies in-memory but does NOT persist', () => {
    const env = runRegsSet({ cwd: dir, reg: 'bc', value: 0x1111 });
    expect(env.persisted).toBe(false);
    expect(env.registers.bc).toBe(0x1111);
  });
});

describe('state export --z80 (CLI-PROD-STATE-001, file-formats.md)', () => {
  it('writes a .z80 VERSION 1 snapshot readable back via the machine readZ80 codec', () => {
    runStateSave(STATE, { cwd: dir });
    runMemWrite({ cwd: dir, state: STATE, addr: '0x9000', hex: 'AB' });
    runRegsSet({ cwd: dir, state: STATE, reg: 'pc', value: 0x8000 });
    runRegsSet({ cwd: dir, state: STATE, reg: 'bc', value: 0x1234 });

    const env = runStateExportZ80('out.z80', { cwd: dir, state: STATE });
    expect(env.format).toBe('z80');
    const raw = readFileSync(join(dir, 'out.z80'));
    // The v1 marker: a non-zero PC in header bytes 6–7 (PC=0 would mark v2/v3).
    expect(raw[6]! | (raw[7]! << 8)).toBe(0x8000);
    const snap = readZ80(raw);
    expect(snap.version).toBe(1); // CLI-PROD-STATE-001 mandates v1
    expect(snap.memory[0x9000]).toBe(0xab); // RAM is carried by the .z80
    expect(snap.memory[0x0000]).toBe(0x00); // ROM is implied by the format, not stored
    expect(snap.registers.pc).toBe(0x8000);
    expect(snap.registers.b).toBe(0x12); // registers round-trip through the v1 header
    expect(snap.registers.c).toBe(0x34);
  });

  it('refuses a v1 export of a PC=0 session (no silent malformed v1)', () => {
    runStateSave(STATE, { cwd: dir }); // fresh boot → PC = 0
    expect(() => runStateExportZ80('out.z80', { cwd: dir, state: STATE })).toThrow(/non-zero PC/i);
  });
});

// =========================================================================
// key / type affect execution (CLI-PROD-INPUT-001/002)
// =========================================================================

describe('key / type (CLI-PROD-INPUT-001/002)', () => {
  it('key presses into the matrix and the running program reacts', () => {
    writeFileSync(join(dir, 'key.bin'), asm(KEY_PROG));
    const env = runKey('O', 3, { cwd: dir, bin: 'key.bin', state: STATE });
    expect(env.stage).toBe('key');
    expect(env.input.keys[0]!.key).toBe('O');
    // The program stored its sentinel only because it actually saw the O keypress.
    expect(loadSession(STATE, dir).machine.memory[0x9000]).toBe(0x99);
  });

  it('type drives the program the same way (sugar over --keys)', () => {
    writeFileSync(join(dir, 'key.bin'), asm(KEY_PROG));
    runType('O', 3, { cwd: dir, bin: 'key.bin', state: STATE });
    expect(loadSession(STATE, dir).machine.memory[0x9000]).toBe(0x99);
  });

  it('type schedules one key per --frames-per-key, back-to-back', () => {
    const env = runType('AB', 4, { cwd: dir });
    expect(env.input.keys.map((k) => [k.frame, k.key, k.hold])).toEqual([
      [0, 'A', 4],
      [4, 'B', 4],
    ]);
  });

  it('type rejects an unmappable character (no silent drop)', () => {
    expect(() => runType('!', 3, { cwd: dir })).toThrow(/cannot map/i);
  });
});

// =========================================================================
// break / watch persistence across stateless CLI invocations
// =========================================================================

describe('break / watch persistence (CLI-PROD-BREAK/WATCH-001)', () => {
  let prevCwd: string;
  beforeEach(() => {
    prevCwd = process.cwd();
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(prevCwd);
  });

  async function cli(args: string[]): Promise<{ code: number; json: Record<string, unknown> }> {
    const cap = capture();
    const code = await runCli([...args, '--json'], { streams: cap.streams });
    return { code, json: JSON.parse(cap.out().trim()) };
  }

  it('break add then a SEPARATE list invocation sees it (shared .zxs/)', async () => {
    expect((await cli(['break', 'add', '0x8003'])).code).toBe(ExitCode.OK);
    // A second, independent process-equivalent invocation reads the same store.
    const list = await cli(['break', 'list']);
    expect(list.code).toBe(ExitCode.OK);
    expect((list.json.breakpoints as Array<{ addr: number }>).map((b) => b.addr)).toContain(0x8003);
    // It really hit disk under the project's `.zxs/`.
    expect(loadDebugStore(dir).breakpoints.map((b) => b.addr)).toContain(0x8003);
  });

  it('break rm removes by id; rm of a missing id exits 1 (CLI-PROD-EDGE-003)', async () => {
    const add = await cli(['break', 'add', '0x9000']);
    const id = (add.json.breakpoint as { id: number }).id;
    expect((await cli(['break', 'rm', String(id)])).code).toBe(ExitCode.OK);
    expect((await cli(['break', 'list'])).json.breakpoints).toHaveLength(0);
    expect((await cli(['break', 'rm', '999'])).code).toBe(ExitCode.USER_ERROR);
  });

  it('run --until-break stops at a stored breakpoint', async () => {
    writeFileSync(join(dir, 'brk.bin'), asm(BREAK_PROG));
    expect((await cli(['break', 'add', '0x8003'])).code).toBe(ExitCode.OK);
    const run = await cli(['run', '--bin', 'brk.bin', '--until-break']);
    expect(run.code).toBe(ExitCode.OK);
    expect(run.json.status).toBe('breakpoint');
    expect((run.json.exit as { pc: number }).pc).toBe(0x8003);
  });

  it('watch add + run --until-watch stops on a write', async () => {
    writeFileSync(join(dir, 'wtc.bin'), asm(WATCH_PROG));
    expect((await cli(['watch', 'add', '--write', '0x9000-0x9000'])).code).toBe(ExitCode.OK);
    const run = await cli(['run', '--bin', 'wtc.bin', '--until-watch']);
    expect(run.code).toBe(ExitCode.OK);
    expect(run.json.status).toBe('watchpoint');
  });

  it('watch add --read fails loud (W4-GAP-01, ENV_ERROR)', async () => {
    const res = await cli(['watch', 'add', '--read', '0x9000-0x9000']);
    expect(res.code).toBe(ExitCode.ENV_ERROR);
    expect((res.json.error as { message: string }).message).toMatch(/read watchpoints/i);
  });

  it('run --watch-read still fails loud (the existing run guard, W4-GAP-01)', async () => {
    const res = await cli(['run', '--watch-read', '0x9000-0x9000']);
    expect(res.code).toBe(ExitCode.ENV_ERROR);
  });

  it('state save then run --state resumes the saved session (end-to-end smoke)', async () => {
    writeFileSync(join(dir, 'halt.bin'), asm(HALT_PROG));
    expect((await cli(['state', 'save', '--bin', 'halt.bin'])).code).toBe(ExitCode.OK);
    const run = await cli(['run', '--state', STATE, '--frames', '10']);
    expect(run.code).toBe(ExitCode.OK);
    expect((run.json.boot as { source: string }).source).toBe('state');
  });

  it('state export --z80 <file> (the spec command shape) writes a v1 snapshot', async () => {
    writeFileSync(join(dir, 'halt.bin'), asm(HALT_PROG));
    await cli(['state', 'save', '--bin', 'halt.bin']); // session PC = 0x8000 (non-zero)
    const exp = await cli(['state', 'export', '--z80', 'out.z80', '--state', STATE]);
    expect(exp.code).toBe(ExitCode.OK);
    expect(exp.json.format).toBe('z80');
    expect(readZ80(readFileSync(join(dir, 'out.z80'))).version).toBe(1);
  });

  it('state export --tap / --scr now emit loadable artifacts (Slice 8a)', async () => {
    const tap = await cli(['state', 'export', '--tap', 'out.tap']);
    expect(tap.code).toBe(ExitCode.OK);
    expect(tap.json.format).toBe('tap');
    // A CODE tape: a 17-byte header block (flag 0x00) + the 48K RAM data block (flag 0xFF).
    const blocks = parseTap(readFileSync(join(dir, 'out.tap')));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.flag).toBe(0x00);
    expect(blocks[0]!.data.length).toBe(17);
    expect(blocks[1]!.flag).toBe(0xff);
    expect(blocks[1]!.data.length).toBe(0xc000);

    const scr = await cli(['state', 'export', '--scr', 'out.scr']);
    expect(scr.code).toBe(ExitCode.OK);
    expect(scr.json.format).toBe('scr');
    expect(readFileSync(join(dir, 'out.scr')).length).toBe(6912);
  });
});
