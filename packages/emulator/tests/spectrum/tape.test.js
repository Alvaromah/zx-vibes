import { Tape } from '../../src/spectrum/tape.js';

/** Tape only touches spectrum.cpu/ula at playback time; a stub is enough for parsing. */
function makeTape() {
  return new Tape({ cpu: { cycles: 0 }, ula: {} });
}

function tzxHeader() {
  return [...'ZXTape!'].map((c) => c.charCodeAt(0)).concat([0x1a, 0x01, 0x14]);
}

describe('Tape parsing — malformed input', () => {
  describe('readDWord', () => {
    it('returns an unsigned 32-bit value for high bytes >= 0x80', () => {
      const tape = makeTape();
      tape.data = new Uint8Array([0xfb, 0xff, 0xff, 0xff]);
      // Signed `<< 24` would give -5 here and drive parse offsets backwards.
      expect(tape.readDWord(0)).toBe(0xfffffffb);
    });
  });

  describe('parseTZX', () => {
    it('terminates on an unknown block whose size would be negative if read signed', () => {
      // Unknown block id 0x99 with length 0xFFFFFFFB (= -5 signed). With the old
      // signed readDWord, `pos += 4 + size` moved backwards and looped forever.
      const buf = new Uint8Array([...tzxHeader(), 0x99, 0xfb, 0xff, 0xff, 0xff]);
      const tape = makeTape();
      tape.load(buf, 'evil.tzx');
      // No playable block, and crucially: load() returned (did not hang).
      expect(tape.blocks).toHaveLength(0);
    });

    it('does not over-read when an unknown block claims a huge size', () => {
      const buf = new Uint8Array([...tzxHeader(), 0x99, 0xff, 0xff, 0xff, 0xff]);
      const tape = makeTape();
      expect(() => tape.load(buf, 'evil.tzx')).not.toThrow();
      expect(tape.blocks).toHaveLength(0);
    });
  });
});
