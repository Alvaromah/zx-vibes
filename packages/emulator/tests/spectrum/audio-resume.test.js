import { ZXSpectrum } from '../../src/spectrum/spectrum.js';

describe('audio resume gestures', () => {
    it('resumes a suspended audio context on pointer gestures', async () => {
        const canvas = document.createElement('canvas');
        const spectrum = new ZXSpectrum(canvas, {
            rom: null,
            autoStart: false,
            sound: true,
            handleKeyboard: false,
            touchKeyboard: false,
        });
        const context = {
            state: 'suspended',
            resume: jest.fn().mockImplementation(async () => {
                context.state = 'running';
            }),
        };
        spectrum.sound.audioContext = context;

        document.dispatchEvent(new Event('pointerdown'));
        await Promise.resolve();

        expect(context.resume).toHaveBeenCalledTimes(1);
        await expect(spectrum.resumeAudio()).resolves.toBe(true);

        spectrum.destroy();
    });

    it('removes gesture listeners on destroy', () => {
        const canvas = document.createElement('canvas');
        const spectrum = new ZXSpectrum(canvas, {
            rom: null,
            autoStart: false,
            sound: true,
            handleKeyboard: false,
            touchKeyboard: false,
        });
        const context = {
            state: 'suspended',
            resume: jest.fn().mockResolvedValue(undefined),
        };
        spectrum.sound.audioContext = context;

        spectrum.destroy();
        document.dispatchEvent(new Event('pointerdown'));

        expect(context.resume).not.toHaveBeenCalled();
    });
});
