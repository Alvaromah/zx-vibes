// Beeper -> audio samples. Pure (browser-safe): no Web Audio, no Node APIs, so it
// bundles for the web and tests headlessly. The Spectrum's speaker is a single
// bit (bit 4 of OUT (0xFE)); a program (or the ROM key-click / BEEP) makes sound
// by flipping it, so the "waveform" is just the sequence of level changes over
// time. We capture those flips with their frame T-state, then resample the level
// onto evenly-spaced audio samples for one frame.

// 48K frame length in T-states (matches @zx-vibes/ula FRAME_T_STATES).
export const FRAME_T_STATES = 69888;

/**
 * Resample one frame of beeper output to `count` mono float samples in [-amp,amp].
 * `log` is a flat [t0, level0, t1, level1, ...] of speaker-level changes captured
 * with their frame T-state (ascending); `carryLevel` is the level in force at the
 * top of the frame. Levels are 0..1 and may be fractional — the ULA speaker is a
 * weighted EAR+MIC mix, so intermediate levels exist (e.g. MIC-only = 0.2). Writes
 * into `out` (a Float32Array(count)) when provided so a render loop can avoid
 * per-frame allocation.
 *
 * We integrate the level over each output sample's time window (a box filter)
 * rather than point-sampling it. A ZX BEEP is a square wave, and a square wave has
 * harmonics stretching past the audio Nyquist; point-sampling folds those back
 * into the audible band as inharmonic tones — the "waves that shouldn't be there".
 * The 7 kHz low-pass in the audio graph can't remove them, because for high beeper
 * pitches the aliased partials land *below* the cutoff. Band-limiting here, while
 * we still have full T-state resolution, is what actually fixes it: a sample whose
 * window straddles an edge gets the time-weighted average of the two levels (an
 * intermediate value) instead of snapping to one, so the reconstructed edge no
 * longer jumps a full step between samples. Because each sample's value is the
 * exact integral over its own window (and the level carried across the frame
 * boundary is `carryLevel`), the result is continuous frame-to-frame — no 50 Hz
 * seam.
 */
export function beeperSamples(log, carryLevel = 0, count = 882, amp = 0.18, out) {
  const data = out ?? new Float32Array(count);
  const span = FRAME_T_STATES / count;
  let cursor = 0;
  let level = carryLevel || 0;
  for (let i = 0; i < count; i += 1) {
    const w0 = i * span;
    const w1 = w0 + span;
    let pos = w0;
    let high = 0; // level-weighted T-states within this sample's window
    while (cursor + 1 < log.length && log[cursor] < w1) {
      const edgeT = log[cursor];
      if (edgeT > pos) {
        high += level * (edgeT - pos);
        pos = edgeT;
      }
      level = log[cursor + 1];
      cursor += 2;
    }
    high += level * (w1 - pos);
    // high/span is the window's mean level (0..1); map it to [-amp,amp].
    data[i] = amp * (2 * (high / span) - 1);
  }
  return data;
}
