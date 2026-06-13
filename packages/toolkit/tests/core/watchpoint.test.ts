import { describe, expect, it } from 'vitest';
import { Watchdog } from '../../src/core/detect.js';
import { Machine } from '../../src/core/machine.js';
import { WatchpointMonitor } from '../../src/core/trace.js';

describe('WatchpointMonitor', () => {
  it('stops on a write to the watched range, reporting the triggering PC', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    // LD A,7 ; LD (0x5800),A ; JR $
    m.loadBinary(new Uint8Array([0x3e, 0x07, 0x32, 0x00, 0x58, 0x18, 0xfe]), 0x8000);
    const beforeFrameOffset = m.tStatesIntoFrame;

    const monitor = new WatchpointMonitor([{ id: 1, type: 'write', from: 0x5800, to: 0x5aff }]);
    monitor.attach(m);
    const outcome = m.run({ frames: 10, watchpoints: monitor });
    monitor.detach();

    expect(outcome.reason).toBe('watchpoint');
    expect(outcome.watchpointHit).toMatchObject({
      id: 1,
      type: 'write',
      addr: 0x5800,
      value: 0x07,
      pc: 0x8002, // the LD (0x5800),A instruction
    });
    expect(m.tStatesIntoFrame - beforeFrameOffset).toBe(outcome.tstatesRun);
  });

  it('read watchpoints fire on data reads', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    // LD A,(0xBF00) ; JR $
    m.loadBinary(new Uint8Array([0x3a, 0x00, 0xbf, 0x18, 0xfe]), 0x8000);

    const monitor = new WatchpointMonitor([{ id: 2, type: 'read', from: 0xbf00, to: 0xbf00 }]);
    monitor.attach(m);
    const outcome = m.run({ frames: 10, watchpoints: monitor });
    monitor.detach();

    expect(outcome.reason).toBe('watchpoint');
    expect(outcome.watchpointHit).toMatchObject({ id: 2, type: 'read', addr: 0xbf00 });
  });

  it('instruction budget stops exactly', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    m.loadBinary(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0xfe]), 0x8000); // NOP×3, JR $
    const outcome = m.run({ instructions: 3 });
    expect(outcome.reason).toBe('instructions');
    expect(outcome.pc).toBe(0x8003);
  });

  it('composes watchdog and watchpoint write observers and restores memory.write', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    m.loadBinary(new Uint8Array([0x3e, 0x07, 0x32, 0x00, 0x58, 0x18, 0xfe]), 0x8000);
    const originalWrite = m.memory.write;
    const watchdog = new Watchdog();
    const monitor = new WatchpointMonitor([{ id: 1, type: 'write', from: 0x5800, to: 0x5aff }]);

    watchdog.attach(m);
    monitor.attach(m);
    const outcome = m.run({ frames: 10, watchdog, watchpoints: monitor });
    monitor.detach();
    watchdog.detach();

    expect(outcome.reason).toBe('watchpoint');
    expect(watchdog.metrics.lastScreenWriteFrame).toBe(0);
    expect(m.memory.write).toBe(originalWrite);
  });
});
