import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/core/machine.js';

// The 48K ROM RAM-tests for ~2.5s of emulated time before showing the
// copyright banner; 250 frames = 5s emulated leaves comfortable margin.
const BOOT_FRAMES = 250;

describe('Machine.boot', () => {
  it('boots the 48K ROM to the copyright screen', () => {
    const m = Machine.boot();
    const outcome = m.run({ frames: BOOT_FRAMES });

    expect(outcome.reason).toBe('frames');
    expect(outcome.framesRun).toBe(BOOT_FRAMES);
    expect(m.frameCount).toBe(BOOT_FRAMES);

    // The copyright banner renders into the bottom third of the bitmap.
    const screen = m.memory.getScreenMemory();
    const bottomThird = screen.subarray(0x1000, 0x1800);
    const setBytes = bottomThird.reduce((n, b) => n + (b !== 0 ? 1 : 0), 0);
    expect(setBytes).toBeGreaterThan(20);

    // Boot leaves white paper / black ink everywhere.
    const attrs = m.memory.getAttributeMemory();
    expect(attrs.every((a) => a === 0x38)).toBe(true);

    // ROM sets IM 1 once booted. (iff1 is unreliable here: runs stop at the
    // frame boundary, immediately after an interrupt was accepted, so iff1 is
    // false until the ISR's EI executes.)
    const regs = m.getRegisters();
    expect(regs.im).toBe(1);
  });

  it('boots deterministically', () => {
    const runOnce = () => {
      const m = Machine.boot();
      m.run({ frames: 100 });
      return Buffer.from(m.memory.ram).toString('base64');
    };
    expect(runOnce()).toBe(runOnce());
  });
});

describe('Machine.loadBinary', () => {
  it('injects and executes machine code, stopping at until-pc', () => {
    const m = Machine.boot();
    m.run({ frames: BOOT_FRAMES });

    // LD A,0x42 ; LD (0x9000),A ; JR $
    const program = new Uint8Array([0x3e, 0x42, 0x32, 0x00, 0x90, 0x18, 0xfe]);
    m.loadBinary(program, 0x8000);

    const outcome = m.run({ untilPC: 0x8005, maxFrames: 10 });
    expect(outcome.reason).toBe('until-pc');
    expect(outcome.pc).toBe(0x8005);
    expect(m.memory.read(0x9000)).toBe(0x42);
    expect(m.getRegisters().af >> 8).toBe(0x42);
  });

  it('rejects binaries that do not fit in RAM', () => {
    const m = Machine.boot();
    expect(() => m.loadBinary(new Uint8Array(16), 0x3fff)).toThrow(/RAM/);
    expect(() => m.loadBinary(new Uint8Array(2), 0xffff)).toThrow(/RAM/);
  });

  it('reports beeper activity from port 0xFE writes', () => {
    const m = Machine.boot();
    // LD A,0x10 ; OUT (0xFE),A ; XOR A ; OUT (0xFE),A ; EI ; HALT ; JR HALT
    const program = new Uint8Array([0x3e, 0x10, 0xd3, 0xfe, 0xaf, 0xd3, 0xfe, 0xfb, 0x76, 0x18, 0xfd]);
    m.loadBinary(program, 0x8000);

    m.resetAudioActivity();
    m.run({ frames: 2 });
    expect(m.getAudioActivity()).toMatchObject({
      portFEWrites: 2,
      beeperEdges: 2,
      beeperLevel: 0,
      lastPortFE: 0,
    });

    m.resetAudioActivity();
    m.run({ frames: 1 });
    expect(m.getAudioActivity()).toMatchObject({
      portFEWrites: 0,
      beeperEdges: 0,
      beeperLevel: 0,
    });
  });
});
