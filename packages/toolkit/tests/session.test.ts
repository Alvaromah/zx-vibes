import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError, ExitCode } from '../src/output/envelope.js';
import {
  bootFreshMachine,
  createSession,
  FRESH_SOURCE,
  Session,
} from '../src/runtime/session.js';
import { loadRom, ROM_SIZE, romBootMemory } from '../src/runtime/rom.js';

describe('ROM loader (RT-PROD-RULE-ROMCACHE-001)', () => {
  it('loads the 16384-byte 48K ROM starting with DI (0xF3)', () => {
    const rom = loadRom();
    expect(rom.length).toBe(ROM_SIZE);
    expect(rom[0]).toBe(0xf3);
  });

  it('returns the same cached instance on repeated loads', () => {
    expect(loadRom()).toBe(loadRom());
  });

  it('maps the ROM at 0x0000 and zeroes RAM in a fresh 64KB image', () => {
    const memory = romBootMemory();
    expect(memory.length).toBe(0x10000);
    expect(memory[0x0000]).toBe(0xf3);
    expect(memory[0x4000]).toBe(0x00);
    expect(memory[0xffff]).toBe(0x00);
  });

  it('returns an independent buffer each call (no shared boot state)', () => {
    const a = romBootMemory();
    const b = romBootMemory();
    a[0x4000] = 0x99;
    expect(b[0x4000]).toBe(0x00);
  });
});

describe('fresh boot (RT-PROD-SESSION-001/002)', () => {
  it('boots a clean ROM machine with PC=0 and the ROM mapped', () => {
    const machine = bootFreshMachine();
    expect(machine.registers.pc).toBe(0x0000);
    expect(machine.memory[0x0000]).toBe(0xf3);
    expect(machine.memory.length).toBe(0x10000);
  });

  it('gives each boot an independent machine (stateless default)', () => {
    const first = bootFreshMachine();
    first.memory[0x8000] = 0x42;
    first.registers.pc = 0x8000;
    const second = bootFreshMachine();
    expect(second.memory[0x8000]).toBe(0x00);
    expect(second.registers.pc).toBe(0x0000);
  });
});

describe('createSession (RT-PROD-SESSION-002/003)', () => {
  it('defaults to a fresh source and is non-persistent', () => {
    const session = createSession();
    expect(session).toBeInstanceOf(Session);
    expect(session.source).toEqual(FRESH_SOURCE);
    expect(session.persistent).toBe(false);
    expect(session.statePath).toBeUndefined();
    expect(session.machine.memory[0x0000]).toBe(0xf3);
  });

  it('marks a session persistent when a --state file is given', () => {
    const session = createSession({ state: '.zxs/state.zxstate' });
    expect(session.persistent).toBe(true);
    expect(session.statePath).toBe('.zxs/state.zxstate');
  });

  it('save() is a no-op under the stateless default', () => {
    expect(() => createSession().save()).not.toThrow();
  });

  it('save() on a persistent session fails loudly (deferred to a later slice)', () => {
    try {
      createSession({ state: 's.zxstate' }).save();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
    }
  });

  it('rejects a still-unimplemented machine source rather than mis-booting', () => {
    try {
      createSession({ source: { kind: 'z80', file: 'game.z80' } });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as CliError).exitCode).toBe(ExitCode.USER_ERROR);
    }
  });

  it('boots a bin source: loads bytes at org and sets PC to the entry (RT-PROD-SESSION-002)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'zxs-bin-')), 'prog.bin');
    writeFileSync(file, Uint8Array.from([0x3e, 0x01, 0xc9])); // ld a,1 / ret
    const session = createSession({ source: { kind: 'bin', file, org: 0x8000 } });
    expect(session.machine.registers.pc).toBe(0x8000);
    expect(session.machine.memory[0x8000]).toBe(0x3e);
    expect(session.machine.memory[0x0000]).toBe(0xf3); // ROM still mapped
  });
});
