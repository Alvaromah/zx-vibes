import { Machine } from '../../core/machine.js';
import { TSTATES_PER_FRAME } from '../../core/run-loop.js';
import { EXIT, emit, parseCount } from '../output.js';

/** Real hardware: 50 frames/s at 3.5 MHz. */
const REAL_FPS = 50;

export function benchCommand(opts: { frames: string; json: boolean }): number {
  const frames = parseCount(opts.frames, 'frames');

  const m = Machine.boot();
  m.run({ frames: 50 }); // warmup + get past the memory-check busy phase

  const started = performance.now();
  m.run({ frames, maxFrames: frames });
  const elapsedMs = performance.now() - started;

  const fps = Math.round(frames / (elapsedMs / 1000));
  const tstatesPerSec = Math.round(fps * TSTATES_PER_FRAME);
  const speedup = Math.round((fps / REAL_FPS) * 10) / 10;

  const result = {
    ok: true,
    stage: 'bench',
    frames,
    elapsedMs: Math.round(elapsedMs),
    framesPerSecond: fps,
    tstatesPerSecond: tstatesPerSec,
    mhzEquivalent: Math.round(tstatesPerSec / 1e5) / 10,
    speedupVsRealHardware: speedup,
  };

  emit(result, opts.json, () =>
    [
      `${frames} frames in ${Math.round(elapsedMs)}ms`,
      `${fps} fps (${speedup}x real hardware), ~${result.mhzEquivalent} MHz equivalent`,
    ].join('\n')
  );

  return EXIT.OK;
}
