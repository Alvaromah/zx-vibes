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

function installInterruptDrivenHaltLoop(spectrum) {
    const rom = new Uint8Array(16384);
    rom[0x0038] = 0xfb; // EI
    rom[0x0039] = 0xc9; // RET
    spectrum.loadROM(rom);

    const program = [
        0xfb, // EI
        0x76, // HALT
        0x18, 0xfd, // JR 0x8001
    ];
    for (let i = 0; i < program.length; i++) {
        spectrum.memory.write(0x8000 + i, program[i]);
    }
    spectrum.cpu.registers.setPC(0x8000);
    spectrum.cpu.interruptMode = 1;
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

    it('advances ULA time for accepted interrupt acknowledge cycles', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null });
        installInterruptDrivenHaltLoop(spectrum);

        let ulaCycles = 0;
        const addCycles = spectrum.ula.addCycles.bind(spectrum.ula);
        spectrum.ula.addCycles = (cycles) => {
            ulaCycles += cycles;
            addCycles(cycles);
        };

        const beforeCycles = spectrum.cpu.cycles;
        spectrum.runFrame();

        expect(spectrum.cpu.cycles - beforeCycles).toBe(ulaCycles);
    });

    it('latches the display before late-frame sprite erases', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null });
        spectrum.reset();
        spectrum.memory.write(0x5800, 0x07);

        let calls = 0;
        spectrum.cpu.execute = () => {
            calls++;

            if (calls === 1) {
                spectrum.memory.write(0x4000, 0xff);
                const cycles = spectrum.DISPLAY_LATCH_TSTATES + 1;
                spectrum.cpu.cycles += cycles;
                return cycles;
            }

            spectrum.memory.write(0x4000, 0x00);
            const cycles = spectrum.TSTATES_PER_FRAME - (spectrum.cpu.cycles - spectrum.frameStartCycles);
            spectrum.cpu.cycles += cycles;
            return cycles;
        };

        spectrum.runFrame();

        const displayX = spectrum.display.borderLeft;
        const displayY = spectrum.display.borderTop;
        const offset = (displayY * spectrum.display.totalWidth + displayX) * 4;

        expect(spectrum.memory.read(0x4000)).toBe(0x00);
        expect(spectrum.display.displayBuffer[offset]).toBe(0xd7);
        expect(spectrum.display.displayBuffer[offset + 1]).toBe(0xd7);
        expect(spectrum.display.displayBuffer[offset + 2]).toBe(0xd7);
    });

    it('keeps the latch out of accurateVideo so beam-timed writes can change visible pixels', () => {
        const spectrum = new ZXSpectrum(stubCanvas(), { sound: false, rom: null, videoMode: 'accurateVideo' });
        spectrum.reset();
        spectrum.memory.write(0x5800, 0x07);

        let calls = 0;
        spectrum.cpu.execute = () => {
            calls++;

            if (calls === 1) {
                spectrum.memory.write(0x4000, 0xff);
                const cycles = spectrum.DISPLAY_LATCH_TSTATES + 1;
                spectrum.cpu.cycles += cycles;
                return cycles;
            }

            spectrum.memory.write(0x4000, 0x00);
            const cycles = spectrum.TSTATES_PER_FRAME - (spectrum.cpu.cycles - spectrum.frameStartCycles);
            spectrum.cpu.cycles += cycles;
            return cycles;
        };

        spectrum.runFrame();

        const displayX = spectrum.display.borderLeft;
        const displayY = spectrum.display.borderTop;
        const offset = (displayY * spectrum.display.totalWidth + displayX) * 4;

        expect(spectrum.getVideoMode()).toBe('accurateVideo');
        expect(spectrum.display.displayBuffer[offset]).toBe(0x00);
        expect(spectrum.display.displayBuffer[offset + 1]).toBe(0x00);
        expect(spectrum.display.displayBuffer[offset + 2]).toBe(0x00);
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
