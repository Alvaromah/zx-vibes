// The preview player's tape autoload + program boot, proven in Node against the REAL
// 48K ROM with the very modules the browser player runs (player/main.js imports
// autoload.ts, frame-step.ts, key-latch.ts and player-boot.ts): the `LOAD ""` typing
// schedule, the LD-BYTES trap, the frame stepper, and the decode/validation path the
// server also uses (program.ts). toolkit-runtime.md RT-PROD-FORMATS-001 /
// RT-PROD-PREVIEW-001; keyboard-input.md KBD-LATCH-001; machine-execution.md
// MACHINE-FRAME-LOOP-001 / MACHINE-ROM-READONLY-001.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMachine, RESET_REGISTERS, serializeTap, type Machine } from '@zx-vibes/machine';
import { loadRom } from '../src/runtime/rom.js';
import {
  AUTOTYPE_PRESS_FRAMES,
  AUTOTYPE_RELEASE_FRAMES,
  AUTOTYPE_START_FRAME,
  LOAD_KEYSTROKES,
  createLdBytesTrap,
  loadTypeSchedule,
  scheduledKeys,
  type AutotypeSchedule,
  type TapeCursor,
} from '../src/preview/autoload.js';
import { createPreviewMachine, stepFrame } from '../src/preview/frame-step.js';
import { KEY_NAMES, PreviewKeyLatch } from '../src/preview/key-latch.js';
import { bootMemory, bootPreviewProgram } from '../src/preview/player-boot.js';
import { resolvePreviewProgram } from '../src/preview/program.js';
import { CliError } from '../src/output/envelope.js';

// The sample tape the demos ship (examples/full.html SAMPLE_B64): a BASIC program
// "zxvibes" that autostarts at line 10 — BORDER 1, PAPER 1, INK 6, CLS, two PRINTs, a loop.
const SAMPLE_TAP = Uint8Array.from(
  Buffer.from(
    'EwAAAHp4dmliZXMgICCPAAoAjwBDkQD/AAoKAOcgMQ4AAAEAAA0AFAoA2iAxDgAAAQAADQAeCgDZIDYOAAAGAAANACgCAPsNADIgAPUgrCA4DgAACAAALDExDgAACwAAOyJaWCBWSUJFUyINADwoAPUgrCAxMA4AAAoAACw4DgAACAAAOyJsb2FkZWQgZnJvbSB0YXBlIg0ARgsA7CA3MA4AAEYAAA1j',
    'base64',
  ),
);

const E_LINE = 0x5c59; // system variable: address of the line being edited
const ERR_NR = 0x5c3a; // system variable: report code - 1 (0xFF = OK)

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** The bytes of the ROM's edit line (up to its ENTER). */
function editLine(m: Machine): number[] {
  const start = m.memory[E_LINE]! | (m.memory[E_LINE + 1]! << 8);
  const out: number[] = [];
  for (let a = start; a < start + 64; a += 1) {
    const b = m.memory[a]!;
    if (b === 0x0d) break;
    out.push(b);
  }
  return out;
}

/** A player-like rig: the latch as the keyboard, border writes recorded, one frame per tick. */
function rig(m: Machine) {
  const keys = new PreviewKeyLatch();
  const state = { border: 7 };
  m.io = {
    read: (port) => ((port & 1) === 0 ? keys.keyBits((port >> 8) & 0xff) | 0xe0 : 0xff),
    write: (port, value) => {
      if ((port & 1) === 0) state.border = value & 0x07;
    },
  };
  /** Hold exactly `pressed` for the next frame (as applyAutotype does), then run it. */
  const frame = (pressed: readonly string[], trap: ((m: Machine) => void) | null): void => {
    for (const k of KEY_NAMES) {
      if (pressed.includes(k)) keys.down(k);
      else keys.up(k);
    }
    keys.beginScan();
    stepFrame(m, trap);
  };
  return { keys, state, frame };
}

/** Drive the typing schedule from power-on through frame `until` (exclusive). */
function runSchedule(
  m: Machine,
  schedule: AutotypeSchedule,
  until: number,
  frame: ReturnType<typeof rig>['frame'],
  trap: ((m: Machine) => void) | null,
  from = 0,
): void {
  for (let f = from; f < until; f += 1) frame(scheduledKeys(schedule, f), trap);
}

function assertSampleRan(m: Machine, border: number): void {
  expect(border).toBe(1); // BORDER 1
  let bluePaper = 0;
  for (let a = 0x5800; a < 0x5b00; a += 1) if (((m.memory[a]! >> 3) & 0x07) === 1) bluePaper += 1;
  expect(bluePaper).toBeGreaterThan(700); // PAPER 1 : CLS
  let ink = 0;
  for (let a = 0x4000; a < 0x5800; a += 1) ink += m.memory[a]!.toString(2).replace(/0/g, '').length;
  expect(ink).toBeGreaterThan(100); // the two PRINTed lines
}

// ===========================================================================

describe('the LOAD "" typing schedule', () => {
  it('starts once the ROM reads keys, primes with CAPS SHIFT and releases between keystrokes', () => {
    const schedule = loadTypeSchedule();
    expect(schedule.steps[0]!.from).toBe(AUTOTYPE_START_FRAME);
    expect(AUTOTYPE_START_FRAME).toBeGreaterThanOrEqual(100);
    expect(schedule.steps.map((s) => [...s.keys])).toEqual(LOAD_KEYSTROKES.map((k) => [...k]));
    expect(schedule.steps[0]!.keys).toEqual(['CAPS_SHIFT']);
    for (let i = 0; i < schedule.steps.length; i += 1) {
      const step = schedule.steps[i]!;
      expect(step.to - step.from).toBe(AUTOTYPE_PRESS_FRAMES);
      // Every keystroke is followed by a gap with no key down at all.
      for (let f = step.to; f < step.to + AUTOTYPE_RELEASE_FRAMES; f += 1) {
        expect(scheduledKeys(schedule, f)).toEqual([]);
      }
    }
    // The schedule ends after ENTER has been released: nothing is held from then on.
    expect(schedule.end).toBe(schedule.steps.at(-1)!.to + AUTOTYPE_RELEASE_FRAMES);
    expect(scheduledKeys(schedule, schedule.end)).toEqual([]);
    expect(scheduledKeys(schedule, schedule.end + 1000)).toEqual([]);
    expect(scheduledKeys(schedule, 0)).toEqual([]);
  });

  it('types LOAD "" into the real ROM edit line (and the old frame-40 schedule typed nothing)', () => {
    const rom = loadRom();
    const schedule = loadTypeSchedule();
    const enter = schedule.steps.at(-1)!;
    expect(enter.keys).toEqual(['ENTER']);

    const m = createPreviewMachine(bootMemory(rom));
    const { frame } = rig(m);
    runSchedule(m, schedule, enter.from, frame, null);
    // K mode: J is the LOAD token (0xEF), SYMBOL SHIFT + P is `"` (0x22).
    expect(editLine(m)).toEqual([0xef, 0x22, 0x22]);

    // The previous schedule (J at 40, `"` at 60/80) ran before the ROM read keys.
    const old: AutotypeSchedule = {
      steps: [
        { from: 40, to: 48, keys: ['J'] },
        { from: 60, to: 68, keys: ['SYMBOL_SHIFT', 'P'] },
        { from: 80, to: 88, keys: ['SYMBOL_SHIFT', 'P'] },
      ],
      end: 100,
    };
    const o = createPreviewMachine(bootMemory(rom));
    const oldRig = rig(o);
    runSchedule(o, old, 100, oldRig.frame, null);
    expect(editLine(o)).toEqual([]);
  });

  it('autoloads a BASIC tape end to end: LOAD "" runs, the trap serves both blocks, the program runs', () => {
    const booted = bootPreviewProgram('tap', SAMPLE_TAP, 0, loadRom());
    expect(booted.autotype).not.toBeNull();
    expect(booted.tape).toEqual({ blocks: expect.any(Array), next: 0 });
    expect(booted.status).toContain('LOAD ""');
    const m = booted.machine;
    const { state, frame } = rig(m);
    const served: Array<{ ok: boolean; remaining: number }> = [];
    const trap = createLdBytesTrap(booted.tape!, (s) => served.push(s));
    const schedule = booted.autotype!;
    runSchedule(m, schedule, schedule.end, frame, trap);
    // The typing is over (the player hands the keyboard back here); the load goes on.
    for (let f = 0; f < 150; f += 1) frame([], trap);
    expect(served).toEqual([
      { ok: true, remaining: 1 }, // the header
      { ok: true, remaining: 0 }, // the BASIC program
    ]);
    expect(booted.tape!.next).toBe(2);
    assertSampleRan(m, state.border);
  });
});

describe('the LD-BYTES trap', () => {
  /** A tape whose first block is a stray data block, then the sample's header + program. */
  function strayDataFirst(): Uint8Array {
    const stray = serializeTap([{ flag: 0xff, data: Uint8Array.of(1, 2, 3, 4) }]);
    const out = new Uint8Array(stray.length + SAMPLE_TAP.length);
    out.set(stray, 0);
    out.set(SAMPLE_TAP, stray.length);
    return out;
  }

  it('consumes a block whose flag does not match, as a moving tape does, so the header search goes on', () => {
    const booted = bootPreviewProgram('tap', strayDataFirst(), 0, loadRom());
    const m = booted.machine;
    const { state, frame } = rig(m);
    const served: boolean[] = [];
    const trap = createLdBytesTrap(booted.tape!, (s) => served.push(s.ok));
    runSchedule(m, booted.autotype!, booted.autotype!.end, frame, trap);
    for (let f = 0; f < 150; f += 1) frame([], trap);
    // The ROM asked for a header, got the stray data block (flag mismatch, nothing
    // written), and the tape moved on to the real header and program.
    expect(served).toEqual([false, true, true]);
    assertSampleRan(m, state.border);
  });

  it('stands aside once the tape has run out, so the real loader waits and BREAK gets out', () => {
    // Only the header: after it the ROM asks for the program block that never comes.
    const headerOnly = SAMPLE_TAP.subarray(0, 21);
    const booted = bootPreviewProgram('tap', headerOnly, 0, loadRom());
    const m = booted.machine;
    const { frame } = rig(m);
    const trap = createLdBytesTrap(booted.tape!);
    runSchedule(m, booted.autotype!, booted.autotype!.end, frame, trap);
    for (let f = 0; f < 50; f += 1) frame([], trap);
    expect(booted.tape!.next).toBe(1);
    // Still waiting inside the ROM tape routines (LD-BYTES and its edge loops).
    expect(m.registers.pc).toBeGreaterThanOrEqual(0x0556);
    expect(m.registers.pc).toBeLessThan(0x0605);
    // CAPS SHIFT + SPACE (BREAK) leaves the loader with report D.
    for (let f = 0; f < 10; f += 1) frame(['CAPS_SHIFT', 'SPACE'], trap);
    for (let f = 0; f < 20; f += 1) frame([], trap);
    expect(m.memory[ERR_NR]).toBe(0x0c); // "D BREAK - CONT repeats"
  });
});

describe('the player machine', () => {
  it('stepFrame without a trap is step-for-step Machine.runFrame (parity)', () => {
    const rom = loadRom();
    const a = createPreviewMachine(bootMemory(rom));
    const b = createPreviewMachine(bootMemory(rom));
    for (let f = 0; f < 150; f += 1) {
      stepFrame(a, null);
      b.runFrame();
    }
    expect(a.tStatesTotal).toBe(b.tStatesTotal);
    expect(a.clock).toBe(b.clock);
    expect(a.frames).toBe(b.frames);
    expect(a.registers).toEqual(b.registers);
    expect(Buffer.compare(Buffer.from(a.memory), Buffer.from(b.memory))).toBe(0);
  });

  it('write-protects the ROM: LD (0x0010),A changes nothing there, RAM still takes writes', () => {
    const rom = loadRom();
    const memory = bootMemory(rom);
    // LD A,0x55 ; LD (0x0010),A ; LD (0x9000),A ; DI ; HALT
    memory.set([0x3e, 0x55, 0x32, 0x10, 0x00, 0x32, 0x00, 0x90, 0xf3, 0x76], 0x8000);
    const m = createPreviewMachine(memory);
    m.registers.pc = 0x8000;
    stepFrame(m, null);
    expect(m.romWriteProtect).toBe(true);
    expect(m.memory[0x0010]).toBe(rom[0x0010]);
    expect(m.memory[0x9000]).toBe(0x55);
    // Every boot path builds the same protected machine.
    expect(bootPreviewProgram('blank', new Uint8Array(0), 0, rom).machine.romWriteProtect).toBe(true);
    // (The flat-RAM twin would have stored it.)
    const flat = createMachine({ memory: memory.slice(), registers: { ...RESET_REGISTERS, pc: 0x8000 } });
    flat.runFrame();
    expect(flat.memory[0x0010]).toBe(0x55);
  });
});

describe('program boot + validation (bootPreviewProgram, shared by the player and the server)', () => {
  const rom = (): Uint8Array => loadRom();
  const codeTape = (dest: number, data: Uint8Array, declared = data.length): Uint8Array => {
    const header = new Uint8Array(17);
    header[0] = 3; // CODE
    header.set([...'code      '].map((c) => c.charCodeAt(0)), 1);
    header[11] = declared & 0xff;
    header[12] = declared >> 8;
    header[13] = dest & 0xff;
    header[14] = dest >> 8;
    header[15] = 0x00;
    header[16] = 0x80;
    return serializeTap([{ flag: 0x00, data: header }, { flag: 0xff, data }]);
  };

  it('boots a CODE tape at its address, with later blocks left on the tape', () => {
    const program = Uint8Array.of(0xf3, 0x76); // DI ; HALT
    const extra = serializeTap([{ flag: 0xff, data: Uint8Array.of(9, 9) }]);
    const tape = new Uint8Array([...codeTape(0x8000, program), ...extra]);
    const booted = bootPreviewProgram('tap', tape, 0, rom());
    expect(booted.machine.registers.pc).toBe(0x8000);
    expect([...booted.machine.memory.subarray(0x8000, 0x8002)]).toEqual([0xf3, 0x76]);
    expect(booted.autotype).toBeNull();
    expect(booted.tape).toEqual({ blocks: expect.any(Array), next: 2 });
    expect(booted.status).toContain('CODE @ 0x8000');
  });

  it.each([
    ['a .tzx without the ZXTape! signature', 'tzx', Uint8Array.from(Buffer.from('NotATape!\x1a\x01\x14', 'latin1')), /ZXTape|signature/i],
    ['a truncated .tap block', 'tap', Uint8Array.of(0x13, 0x00, 0x00, 0x03), /parseTap/],
    ['an empty .tap', 'tap', new Uint8Array(0), /no loadable data blocks/],
    ['a 10-byte .z80', 'z80', new Uint8Array(10), /smaller than the 30-byte/],
    ['a .bin below RAM', 'bin', Uint8Array.of(0xc9), /below RAM/],
  ] as const)('rejects %s with a message naming the problem', (_label, kind, bytes, pattern) => {
    const org = kind === 'bin' ? 0x3000 : 0;
    expect(() => bootPreviewProgram(kind, bytes, org, rom())).toThrow(pattern);
  });

  it('rejects images that would run past 0xFFFF (a .bin and a CODE tape header)', () => {
    expect(() => bootPreviewProgram('bin', new Uint8Array(0x2000), 0xf000, rom())).toThrow(/overrun the 64K/);
    expect(() => bootPreviewProgram('tap', codeTape(0xf000, new Uint8Array(0x2000)), 0, rom())).toThrow(
      /CODE block does not fit RAM: 8192 bytes at 0xF000 overrun/,
    );
    // A CODE block shorter than its header announces is what LD-BYTES rejects.
    expect(() => bootPreviewProgram('tap', codeTape(0x8000, new Uint8Array(4), 64), 0, rom())).toThrow(
      /CODE block did not load/,
    );
  });

  it('fails `zxs preview <file>` loud (USER_ERROR) before serving a bad file', () => {
    const dir = tmp('zxs-preview-badfile-');
    writeFileSync(join(dir, 'bad.tzx'), 'definitely not a tape');
    writeFileSync(join(dir, 'short.z80'), new Uint8Array(12));
    writeFileSync(join(dir, 'empty.tap'), new Uint8Array(0));
    writeFileSync(join(dir, 'huge.bin'), new Uint8Array(0x9000)); // 36K at the default 0x8000
    for (const file of ['bad.tzx', 'short.z80', 'empty.tap', 'huge.bin']) {
      let err: unknown;
      try {
        resolvePreviewProgram({ cwd: dir, file });
      } catch (e) {
        err = e;
      }
      expect(err, file).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode, file).toBe(1);
      expect((err as CliError).message, file).toContain(`cannot load "${file}"`);
    }
    // A good tape still resolves.
    writeFileSync(join(dir, 'ok.tap'), SAMPLE_TAP);
    expect(resolvePreviewProgram({ cwd: dir, file: 'ok.tap' }).kind).toBe('tap');
  });
});

describe('tape cursor bookkeeping', () => {
  it('a trap on an exhausted tape leaves the machine untouched', () => {
    const m = createPreviewMachine(bootMemory(loadRom()));
    m.registers.pc = 0x0556;
    const before = { ...m.registers };
    const cursor: TapeCursor = { blocks: [], next: 0 };
    createLdBytesTrap(cursor)(m);
    expect(m.registers).toEqual(before);
  });
});
