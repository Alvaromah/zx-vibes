import { BeeperResampler } from '../../src/spectrum/beeper-dsp.js';

describe('BeeperResampler PAL frame clock', () => {
  it('emits exactly one second of 48 kHz audio for 50 48K PAL frames', () => {
    const sampleRate = 48000;
    const frameTStates = 69888;
    const resampler = new BeeperResampler(sampleRate, frameTStates * 50);
    const edges = new Float64Array([0, 0]);
    const out = new Float32Array(1024);
    let samples = 0;

    for (let frame = 0; frame < 50; frame++) {
      samples += resampler.renderFrame(edges, 1, frameTStates, out);
    }

    expect(samples).toBe(sampleRate);
  });
});
