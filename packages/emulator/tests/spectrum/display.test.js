import { SpectrumDisplay } from '../../src/spectrum/display.js';

describe('SpectrumDisplay', () => {
    it('toggles FLASH every 16 emulated frames, not every render call', () => {
        const display = new SpectrumDisplay();
        const screen = new Uint8Array(6144);
        const attrs = new Uint8Array(768);

        display.render(screen, attrs, 1);
        expect(display.flashCounter).toBe(0);
        expect(display.flashPhase).toBe(false);

        for (let i = 0; i < 15; i++) {
            display.advanceFrame();
            expect(display.flashPhase).toBe(false);
        }

        display.advanceFrame();
        expect(display.flashCounter).toBe(0);
        expect(display.flashPhase).toBe(true);
    });
});
