/**
 * The package entry point must expose the public surface — consumers
 * should never need to know internal file paths.
 */
import * as zx from '../src/index.js';

describe('package entry point (src/index.js)', () => {
    it.each([
        'ZXSpectrum',
        'Z80',
        'Registers',
        'Flags',
        'SpectrumMemory',
        'SpectrumULA',
        'SpectrumDisplay',
        'SpectrumSound',
        'Z80SnapshotLoader',
        'Tape',
    ])('exports %s', (name) => {
        expect(typeof zx[name]).toBe('function');
    });

    it('exports the keyboard maps', () => {
        expect(zx.SPECTRUM_KEYS).toBeDefined();
        expect(zx.PC_KEY_MAP).toBeDefined();
    });
});
