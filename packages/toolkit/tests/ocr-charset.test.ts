// The Spectrum character set is ASCII except for three codes: 0x5E is an up arrow,
// 0x60 the pound sign and 0x7F the copyright sign. The ROM-font OCR reported them as
// `^`, a backtick and a raw DEL control character, so the ROM's own boot line came back
// as "\u007f 1982 Sinclair Research Ltd".

import { describe, expect, it } from 'vitest';
import { ocrScreenRows, readScreenImage, romFontGlyphs, screenIncludesText } from '../src/observe/screen.js';
import { runProgram } from '../src/runtime/run.js';
import { bootFreshMachine, RAM_BASE } from '../src/runtime/session.js';

/** A blank 6912-byte screen with one ROM glyph drawn in the top-left cell. */
function screenWithGlyph(code: number): Uint8Array {
  const image = new Uint8Array(6912);
  const glyph = romFontGlyphs()[code - 0x20]!;
  // Character row 0, column 0: pixel line n of the cell is display-file byte n * 256.
  for (let line = 0; line < 8; line += 1) image[line * 256] = glyph[line]!;
  return image;
}

describe('ROM-font OCR uses the Spectrum character set', () => {
  it('the boot screen reads "© 1982 Sinclair Research Ltd" with no control character', () => {
    const result = runProgram(bootFreshMachine(), RAM_BASE, { frames: 150 });
    const rows = ocrScreenRows(readScreenImage(result.machine));
    expect(rows.join('\n')).toContain('© 1982 Sinclair Research Ltd');
    const controlCharacters = [...rows.join('')].filter((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);
    expect(controlCharacters).toEqual([]);
  });

  it('codes 0x5E, 0x60 and 0x7F are the up arrow, the pound sign and the copyright sign', () => {
    expect(ocrScreenRows(screenWithGlyph(0x5e))[0]![0]).toBe('↑');
    expect(ocrScreenRows(screenWithGlyph(0x60))[0]![0]).toBe('£');
    expect(ocrScreenRows(screenWithGlyph(0x7f))[0]![0]).toBe('©');
    expect(ocrScreenRows(screenWithGlyph(0x41))[0]![0]).toBe('A');
  });

  it('screenIncludes accepts both the glyph and the ASCII character at its code', () => {
    const pound = screenWithGlyph(0x60);
    expect(screenIncludesText(pound, '£')).toBe(true);
    expect(screenIncludesText(pound, '`')).toBe(true);
    expect(screenIncludesText(screenWithGlyph(0x5e), '^')).toBe(true);
    expect(screenIncludesText(screenWithGlyph(0x7f), '©')).toBe(true);
    expect(screenIncludesText(pound, '©')).toBe(false);
  });
});
