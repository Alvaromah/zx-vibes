/**
 * @jest-environment node
 *
 * Headless (Node, no DOM) smoke tests: the emulator must be constructible
 * and runnable without HTMLCanvasElement / document / ImageData.
 */
import { ZXSpectrum } from '../../src/spectrum/spectrum.js';
import { SpectrumDisplay } from '../../src/spectrum/display.js';

function stubCanvas() {
    return {
        tagName: 'CANVAS',
        width: 0,
        height: 0,
        style: {},
        getContext: () => ({
            putImageData: () => {},
            fillRect: () => {},
        }),
        addEventListener: () => {},
    };
}

describe('headless Node environment', () => {
    it('has no DOM globals (sanity)', () => {
        expect(typeof document).toBe('undefined');
        expect(typeof HTMLCanvasElement).toBe('undefined');
        expect(typeof ImageData).toBe('undefined');
    });

    it('constructs with a canvas-like object without touching browser globals', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null });
        expect(spectrum.cpu).toBeDefined();
        expect(spectrum.memory).toBeDefined();
    });

    it('ignores explicit touch keyboard setup without a DOM', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null, touchKeyboard: true });
        expect(spectrum.touchKeyboard).toBeNull();
    });

    it('runs frames headless once a ROM is loaded', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null });
        spectrum.loadROM(new Uint8Array(16384)); // zero-filled ROM: NOPs
        const before = spectrum.cpu.cycles;
        spectrum.runFrame();
        expect(spectrum.cpu.cycles).toBeGreaterThan(before);
    });

    it('rejects selector strings with a clear error instead of a ReferenceError', () => {
        expect(() => new ZXSpectrum('#screen', { sound: false, rom: null }))
            .toThrow(/Canvas selectors need a DOM/);
    });

    it('display.getImageData() explains itself instead of throwing a ReferenceError', () => {
        const display = new SpectrumDisplay();
        expect(() => display.getImageData()).toThrow(/displayBuffer/);
    });
});
