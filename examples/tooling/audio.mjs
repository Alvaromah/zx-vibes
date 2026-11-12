// Beeper -> audio samples. Pure (browser-safe): no Web Audio, no Node APIs, so it
// bundles for the web and tests headlessly. The Spectrum's speaker is driven by the
// port 0xFE output lines; a program (or the ROM key-click / BEEP) makes sound by
// flipping them, so the "waveform" is just the sequence of level changes over time.
// We capture those changes with their T-state in the frame, then resample the level
// onto evenly spaced audio samples.

/** 48K frame length in T-states (matches @zx-vibes/ula FRAME_T_STATES). */
export const FRAME_T_STATES = 69888;
/** The 48K Z80 clock (dna/product/beeper-output.md BEEPER-PCM-CLOCK-001). */
export const CPU_HZ = 3_500_000;
/**
 * One 48K frame in milliseconds: 69888 T-states at 3.5 MHz = 19.968 ms (≈ 50.08 Hz),
 * not a rounded 20 ms — the machine (and so every beeper pitch) runs at this rate.
 */
export const FRAME_MS = (FRAME_T_STATES * 1000) / CPU_HZ;

/**
 * Audio samples one 48K frame spans at `sampleRate`: fractional (≈ 958.46 at 48 kHz,
 * ≈ 880.59 at 44.1 kHz). Rounding it per frame drifts (BEEPER-PCM-FRACTIONAL-001), so
 * the resampler below carries the fraction from frame to frame instead.
 */
export function samplesPerFrame(sampleRate) {
  return (sampleRate * FRAME_T_STATES) / CPU_HZ;
}

/**
 * A continuous beeper resampling stream: the state carried from one span to the next
 * — the speaker level in force and the partly filled output sample (how many T-states
 * of it are covered, and their level-weighted sum). Start one at the level in effect.
 */
export function createBeeperStream(level = 0) {
  return { level, partialT: 0, partialArea: 0 };
}

/**
 * Resample one span of beeper output onto ONE continuous sample grid
 * (dna/product/beeper-output.md BEEPER-PCM-FRACTIONAL-001 / -CONTINUITY-001): every
 * output sample covers exactly `sampleT` T-states, and a sample that straddles the end
 * of the span is finished by the next call — so frames never re-anchor the grid, the
 * sample count over any run is the fractional-exact floor(T·R / CPU_HZ), and splitting a
 * span in two renders the same samples as one call.
 *
 * `log` is a flat [t0, level0, t1, level1, ...] of speaker-level changes with their
 * T-state from the start of the span (ascending); levels are 0..1 and may be
 * fractional (the ULA speaker is a weighted EAR+MIC mix, so MIC-only = 0.2). `spanT`
 * is the span's length in T-states (a frame's real length: tStatesTotal after minus
 * before). `sampleT` is the T-states per output sample — CPU_HZ / sampleRate, which the
 * page's drift controller may nudge by a few percent. Complete samples are written to
 * `out` as values in [-amp, amp]; the function returns how many it wrote.
 *
 * Each sample is the level integrated over its own window (a box filter), not
 * point-sampled: a beeper square wave has harmonics past the audio Nyquist, and point
 * sampling folds them back as inharmonic tones. A window straddling an edge takes the
 * time-weighted average of the two levels.
 */
export function renderBeeperSpan(stream, log, spanT, sampleT, amp, out) {
  let level = stream.level;
  let covered = stream.partialT; // T-states of the open sample already integrated
  let area = stream.partialArea; // level·T-states integrated into it
  let cursor = 0; // T-state within this span
  let next = 0; // index into log
  let written = 0;
  const integrateTo = (t) => {
    while (next + 1 < log.length && log[next] <= t) {
      const edgeT = Math.max(cursor, log[next]);
      area += level * (edgeT - cursor);
      covered += edgeT - cursor;
      cursor = edgeT;
      level = log[next + 1];
      next += 2;
    }
    area += level * (t - cursor);
    covered += t - cursor;
    cursor = t;
  };
  for (;;) {
    const sampleEnd = cursor + (sampleT - covered);
    if (sampleEnd > spanT) break; // the open sample continues into the next span
    integrateTo(sampleEnd);
    out[written] = amp * (2 * (area / sampleT) - 1);
    written += 1;
    covered = 0;
    area = 0;
  }
  integrateTo(spanT);
  // An edge stamped at (or past) the very end of the span still sets the level the
  // next span starts with.
  while (next + 1 < log.length) {
    level = log[next + 1];
    next += 2;
  }
  stream.level = level;
  stream.partialT = covered;
  stream.partialArea = area;
  return written;
}
