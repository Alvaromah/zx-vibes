/**
 * Pure streaming beeper resampler used by the browser preview.
 *
 * It integrates the 1-bit speaker level over one global PCM sample grid. The
 * state carries a partially filled sample across chunk/frame boundaries, so
 * splitting the same edge stream into frames is sample-for-sample equivalent
 * to rendering it as one continuous span.
 */

export interface PreviewBeeperEdge {
  /** T-state offset from the start of this chunk. */
  t: number;
  level: 0 | 1;
}

export interface PreviewBeeperPcmState {
  /** Total T-states consumed since this stream was started. */
  elapsedTStates: number;
  /** Number of complete PCM samples emitted on the global grid. */
  sampleIndex: number;
  /** Integrated high-level area in the current, incomplete sample. */
  partialArea: number;
  /** Speaker level in effect at `elapsedTStates`. */
  level: 0 | 1;
}

export interface PreviewBeeperPcmOptions {
  sampleRate: number;
  cpuHz: number;
}

export interface PreviewBeeperChunk {
  samples: Float32Array;
  state: PreviewBeeperPcmState;
  /** Edges beyond this chunk, rebased for the next call. */
  carryEdges: PreviewBeeperEdge[];
}

export function createPreviewBeeperState(
  level: 0 | 1 = 0,
): PreviewBeeperPcmState {
  return {
    elapsedTStates: 0,
    sampleIndex: 0,
    partialArea: 0,
    level,
  };
}

/**
 * Render one chronological chunk. Level 0 maps to -1 and level 1 to +1;
 * browser-side filtering/gain remain output-device policy.
 */
export function renderPreviewBeeperChunk(
  state: PreviewBeeperPcmState,
  edges: readonly PreviewBeeperEdge[],
  durationTStates: number,
  options: PreviewBeeperPcmOptions,
): PreviewBeeperChunk {
  if (!Number.isFinite(durationTStates) || durationTStates < 0) {
    throw new RangeError('durationTStates must be a finite non-negative number');
  }
  if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0) {
    throw new RangeError('sampleRate must be a finite positive number');
  }
  if (!Number.isFinite(options.cpuHz) || options.cpuHz <= 0) {
    throw new RangeError('cpuHz must be a finite positive number');
  }

  const ordered = edges
    .map((edge, index) => ({ ...edge, index }))
    .sort((a, b) => a.t - b.t || a.index - b.index);
  const carryEdges: PreviewBeeperEdge[] = [];
  const samples: number[] = [];
  const sampleWidth = options.cpuHz / options.sampleRate;
  const chunkStart = state.elapsedTStates;
  const chunkEnd = chunkStart + durationTStates;
  let cursor = chunkStart;
  let sampleIndex = state.sampleIndex;
  let partialArea = state.partialArea;
  let level = state.level;

  const integrateTo = (target: number): void => {
    while (cursor < target) {
      const sampleEnd = (sampleIndex + 1) * sampleWidth;
      const segmentEnd = Math.min(target, sampleEnd);
      partialArea += level * (segmentEnd - cursor);
      cursor = segmentEnd;

      // Floating-point arithmetic can put an exact rational boundary a few ulps
      // either side of `cursor`; scale the tolerance to the sample width.
      if (cursor >= sampleEnd - sampleWidth * Number.EPSILON * 8) {
        const highShare = Math.max(0, Math.min(1, partialArea / sampleWidth));
        samples.push(highShare * 2 - 1);
        sampleIndex += 1;
        partialArea = 0;
        cursor = sampleEnd;
      }
    }
  };

  for (const edge of ordered) {
    if (!Number.isFinite(edge.t)) continue;
    if (edge.t > durationTStates) {
      carryEdges.push({ t: edge.t - durationTStates, level: edge.level });
      continue;
    }
    const edgeTime = chunkStart + Math.max(0, edge.t);
    integrateTo(edgeTime);
    level = edge.level;
  }
  integrateTo(chunkEnd);

  return {
    samples: Float32Array.from(samples),
    state: {
      elapsedTStates: chunkEnd,
      sampleIndex,
      partialArea,
      level,
    },
    carryEdges,
  };
}
