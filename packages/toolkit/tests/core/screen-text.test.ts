import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/core/machine.js';
import { screenText } from '../../src/core/screen-text.js';

describe('screenText (ROM-font OCR)', () => {
  it('reads the boot copyright banner', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    const text = screenText(m);

    expect(text.rows).toHaveLength(24);
    expect(text.rows.every((r) => r.length === 32)).toBe(true);
    const banner = text.rows.find((r) => r.includes('© 1982 Sinclair Research Ltd'));
    expect(banner).toBeDefined();
  });

  it('reports attributes and non-blank cells', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    const text = screenText(m);

    expect(text.nonBlankCells).toBeGreaterThan(20); // the banner
    expect(text.nonBlankCells).toBeLessThan(100);
    // Boot screen: a single attribute everywhere (white paper, black ink).
    expect(text.attrs[0]).toMatchObject({ attr: 0x38, ink: 0, paper: 7, count: 768 });
  });

  it('renders unknown graphics as density glyphs', () => {
    const m = Machine.boot();
    m.run({ frames: 250 });
    // Paint a dense 8x8 blob at cell (0,0): lines of 0xFF in the bitmap.
    for (let l = 0; l < 8; l++) {
      m.memory.write(0x4000 + (l << 8), 0xff);
    }
    const text = screenText(m);
    expect(text.rows[0]![0]).toBe('█');
  });
});
