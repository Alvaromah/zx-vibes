// The preview player's keyboard: the 48K matrix read (keyboard-input.md KBD-MATRIX-001)
// and the quick-tap latch (KBD-LATCH-001), replayed against the DNA conformance
// fixture the reference model passes (dna/conformance/keyboard/keyboard-latch.json).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KEY_MATRIX, PreviewKeyLatch, keyBitsFor, rowMasksFor } from '../src/preview/key-latch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LATCH_FIXTURE = join(HERE, '..', '..', '..', 'dna', 'conformance', 'keyboard', 'keyboard-latch.json');

interface LatchCase {
  name: string;
  events: Array<{ op: 'down' | 'up' | 'scan'; key?: string }>;
}

/** The keys a frame's reads see, recovered through the matrix read itself. */
function keysSeenByReads(latch: PreviewKeyLatch): string[] {
  const seen: string[] = [];
  for (const [key, [row, bit]] of Object.entries(KEY_MATRIX)) {
    const highByte = ~(1 << row) & 0xff; // select only this half-row
    if ((latch.keyBits(highByte) & (1 << bit)) === 0) seen.push(key);
  }
  return seen.sort();
}

describe('KBD-MATRIX-001 — the IN (0xFE) key bits', () => {
  it('reads the selected half-rows active-low and ANDs several selected rows', () => {
    const masks = rowMasksFor(['Z']);
    expect(keyBitsFor(masks, 0xfe)).toBe(0x1d); // Z = row 0 bit 1
    expect(keyBitsFor(masks, 0xfd)).toBe(0x1f); // row 1 not holding Z
    expect(keyBitsFor(rowMasksFor(['CAPS_SHIFT']), 0xfe)).toBe(0x1e);
    // "Any key" (0x00 selects all rows): A (row 1 bit 0) and M (row 7 bit 2) AND together.
    expect(keyBitsFor(rowMasksFor(['A', 'M']), 0x00)).toBe(0x1f & ~0x01 & ~0x04);
    expect(keyBitsFor(rowMasksFor([]), 0x00)).toBe(0x1f);
  });

  it('serves every read of a frame from one precomputed matrix', () => {
    const latch = new PreviewKeyLatch();
    latch.down('SYMBOL_SHIFT');
    latch.down('P');
    latch.beginScan();
    expect(latch.keyBits(0x7f)).toBe(0x1d); // row 7: SYMBOL SHIFT is bit 1
    expect(latch.keyBits(0xdf)).toBe(0x1e); // row 5: P is bit 0
    expect(latch.keyBits(0xfe)).toBe(0x1f); // row 0: nothing
    // A key held across the scan stays in this frame's frozen set and releases at the
    // next scan boundary; a key that goes down is seen at once.
    latch.up('P');
    latch.down('Q');
    expect(latch.keyBits(0xdf)).toBe(0x1e);
    expect(latch.keyBits(0xfb)).toBe(0x1e); // row 2: Q is bit 0
    latch.beginScan();
    expect(latch.keyBits(0xdf)).toBe(0x1f);
    expect(latch.keyBits(0xfb)).toBe(0x1e);
  });
});

describe('KBD-LATCH-001 — the quick-tap latch (DNA fixture replay)', () => {
  const fixture = JSON.parse(readFileSync(LATCH_FIXTURE, 'utf8')) as {
    input: { cases: LatchCase[] };
    expected: { cases: Array<{ name: string; scans: string[][] }> };
  };

  for (const testCase of fixture.input.cases) {
    it(testCase.name, () => {
      const expected = fixture.expected.cases.find((c) => c.name === testCase.name)!.scans;
      // The player's host side: a key that APPEARS is down + tapped; a release is up.
      const latch = new PreviewKeyLatch();
      const scans: string[][] = [];
      for (const event of testCase.events) {
        if (event.op === 'down') {
          latch.down(event.key!);
          latch.tap(event.key!);
        } else if (event.op === 'up') {
          latch.up(event.key!);
        } else {
          latch.beginScan();
          const visible = [...latch.visibleKeys()].sort();
          expect(keysSeenByReads(latch)).toEqual(visible);
          scans.push(visible);
        }
      }
      expect(scans).toEqual(expected.map((s) => [...s].sort()));
    });
  }

  it('keeps a tapped row-7 key visible to every half-row read of its frame', () => {
    // The ROM reads rows 0..7 in turn; a latch cleared by the first read would hide B.
    const latch = new PreviewKeyLatch();
    latch.down('B');
    latch.tap('B');
    latch.up('B');
    latch.beginScan();
    for (let row = 0; row < 7; row += 1) latch.keyBits(~(1 << row) & 0xff);
    expect(latch.keyBits(0x7f) & 0x10).toBe(0); // B = row 7 bit 4, still down
    latch.beginScan();
    expect(latch.keyBits(0x7f)).toBe(0x1f); // exactly one scan
  });
});
