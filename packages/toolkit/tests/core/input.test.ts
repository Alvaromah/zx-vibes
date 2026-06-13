import { describe, expect, it } from 'vitest';
import { KeyPlanRunner, compileTypeText, parseKeysSpec } from '../../src/core/input.js';
import { Machine } from '../../src/core/machine.js';

describe('parseKeysSpec', () => {
  it('parses frame:KEY*hold lists', () => {
    const events = parseKeysSpec('60:O*30, 120:SPACE*5');
    expect(events).toEqual([
      { frame: 60, key: 'O', action: 'down' },
      { frame: 90, key: 'O', action: 'up' },
      { frame: 120, key: 'SPACE', action: 'down' },
      { frame: 125, key: 'SPACE', action: 'up' },
    ]);
  });

  it('defaults hold to 3 frames and validates keys', () => {
    expect(parseKeysSpec('10:Q')).toHaveLength(2);
    expect(() => parseKeysSpec('10:BADKEY')).toThrow(/Unknown Spectrum key/);
    expect(() => parseKeysSpec('nonsense')).toThrow(/Invalid key spec/);
    expect(() => parseKeysSpec('10:Q*0')).toThrow(/at least 1/);
  });
});

describe('compileTypeText', () => {
  it('maps letters, digits and symbol-shift combos', () => {
    const events = compileTypeText('A1"');
    const downs = events.filter((e) => e.action === 'down').map((e) => e.key);
    expect(downs).toEqual(['A', '1', 'SYMBOL_SHIFT', 'P']); // " = SYM+P
  });

  it('rejects untypeable characters', () => {
    expect(() => compileTypeText('€')).toThrow(/Cannot type/);
  });
});

describe('frame-accurate key injection', () => {
  // loop: LD BC,0xDFFE ; IN A,(C) ; CPL ; AND 0x1F ; JR Z,loop ;
  //       LD A,2 ; OUT (0xFE),A ; spin: JR spin
  // Polls the O half-row; sets border red when O is pressed.
  const BORDER_KEY = [
    0x01, 0xfe, 0xdf, 0xed, 0x78, 0x2f, 0xe6, 0x1f, 0x28, 0xf6, 0x3e, 0x02, 0xd3, 0xfe, 0x18,
    0xfe,
  ];

  it('a scheduled O keypress turns the border red', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    m.loadBinary(new Uint8Array(BORDER_KEY), 0x8000);

    const runner = new KeyPlanRunner(parseKeysSpec('10:O*20'), m);
    runner.applyDue(0);
    m.run({ frames: 40, onFrame: (f) => runner.applyDue(f) });

    expect(m.ula.getBorderColor()).toBe(2); // red
  });

  it('without the keypress the program keeps polling', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    m.loadBinary(new Uint8Array(BORDER_KEY), 0x8000);
    m.run({ frames: 40 });
    expect(m.ula.getBorderColor()).not.toBe(2);
  });
});
