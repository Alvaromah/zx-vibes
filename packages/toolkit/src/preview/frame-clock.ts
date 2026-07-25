/** Pure wall-clock accumulator for the browser preview's emulation scheduler. */

export interface PreviewFrameClockState {
  lastNowMs: number;
  remainderMs: number;
}

export interface PreviewFrameClockOptions {
  frameDurationMs: number;
  maxCatchUpFrames: number;
}

export interface PreviewFrameClockAdvance {
  state: PreviewFrameClockState;
  frames: number;
  /** Whole overdue frames intentionally discarded to prevent fast-forward. */
  droppedFrames: number;
}

export function createPreviewFrameClock(nowMs: number): PreviewFrameClockState {
  return { lastNowMs: nowMs, remainderMs: 0 };
}

/**
 * Convert elapsed wall time into a bounded number of emulated frames. Any whole
 * backlog above the cap is discarded while the fractional remainder survives.
 */
export function advancePreviewFrameClock(
  state: PreviewFrameClockState,
  nowMs: number,
  options: PreviewFrameClockOptions,
): PreviewFrameClockAdvance {
  if (!Number.isFinite(options.frameDurationMs) || options.frameDurationMs <= 0) {
    throw new RangeError('frameDurationMs must be a finite positive number');
  }
  if (!Number.isInteger(options.maxCatchUpFrames) || options.maxCatchUpFrames < 1) {
    throw new RangeError('maxCatchUpFrames must be a positive integer');
  }

  const elapsed = Number.isFinite(nowMs)
    ? Math.max(0, nowMs - state.lastNowMs)
    : 0;
  const available = state.remainderMs + elapsed;
  const due = Math.floor(available / options.frameDurationMs);
  const frames = Math.min(due, options.maxCatchUpFrames);

  return {
    state: {
      lastNowMs: Number.isFinite(nowMs) ? nowMs : state.lastNowMs,
      // Drop only whole overdue frames; retain sub-frame phase for long-run cadence.
      remainderMs: available - due * options.frameDurationMs,
    },
    frames,
    droppedFrames: due - frames,
  };
}
