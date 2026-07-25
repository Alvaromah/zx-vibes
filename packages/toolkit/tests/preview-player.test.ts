import { describe, expect, it } from 'vitest';
import {
  createPreviewBeeperState,
  renderPreviewBeeperChunk,
  type PreviewBeeperEdge,
} from '../src/preview/beeper-model.js';
import {
  advancePreviewFrameClock,
  createPreviewFrameClock,
} from '../src/preview/frame-clock.js';

const CPU_HZ = 3_500_000;
const FRAME_T_STATES = 69_888;
const FRAME_MS = (FRAME_T_STATES / CPU_HZ) * 1000;

describe('preview beeper streaming model', () => {
  it('uses one continuous fractional sample grid without long-run frame drift', () => {
    let state = createPreviewBeeperState();
    let samples = 0;
    for (let frame = 0; frame < 200; frame += 1) {
      const rendered = renderPreviewBeeperChunk(state, [], FRAME_T_STATES, {
        sampleRate: 44_100,
        cpuHz: CPU_HZ,
      });
      state = rendered.state;
      samples += rendered.samples.length;
    }
    expect(samples).toBe(Math.floor((200 * FRAME_T_STATES * 44_100) / CPU_HZ));
  });

  it('is sample-for-sample continuous when the same edge stream is split', () => {
    const edges: PreviewBeeperEdge[] = [
      { t: 10_000, level: 1 },
      { t: 65_000, level: 0 },
      { t: 75_000, level: 1 },
      { t: 110_000, level: 0 },
    ];
    const options = { sampleRate: 48_000, cpuHz: CPU_HZ };
    const whole = renderPreviewBeeperChunk(
      createPreviewBeeperState(),
      edges,
      FRAME_T_STATES * 2,
      options,
    );

    const first = renderPreviewBeeperChunk(
      createPreviewBeeperState(),
      edges,
      FRAME_T_STATES,
      options,
    );
    const second = renderPreviewBeeperChunk(
      first.state,
      first.carryEdges,
      FRAME_T_STATES,
      options,
    );

    expect([...first.samples, ...second.samples]).toEqual([...whole.samples]);
    expect(second.state).toEqual(whole.state);
  });
});

describe('preview emulation clock', () => {
  it('uses the exact 48K frame duration instead of a rounded 20 ms interval', () => {
    let state = createPreviewFrameClock(0);
    let frames = 0;
    for (let tick = 1; tick <= 200; tick += 1) {
      const advanced = advancePreviewFrameClock(state, tick * FRAME_MS, {
        frameDurationMs: FRAME_MS,
        maxCatchUpFrames: 8,
      });
      state = advanced.state;
      frames += advanced.frames;
    }
    expect(frames).toBe(200);
    expect(state.remainderMs).toBeLessThan(1e-8);
  });

  it('bounds catch-up and drops a hidden/suspended backlog without fast-forward', () => {
    const advanced = advancePreviewFrameClock(
      createPreviewFrameClock(0),
      1000,
      { frameDurationMs: FRAME_MS, maxCatchUpFrames: 8 },
    );
    expect(advanced.frames).toBe(8);
    expect(advanced.droppedFrames).toBeGreaterThan(40);
    expect(advanced.state.remainderMs).toBeLessThan(FRAME_MS);
  });
});
