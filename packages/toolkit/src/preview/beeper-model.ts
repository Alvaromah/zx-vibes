/**
 * Pure streaming beeper resampler used by the browser preview.
 *
 * It integrates the speaker drive level over one global PCM sample grid. The
 * state carries a partially filled sample across chunk/frame boundaries, so
 * splitting the same edge stream into frames is sample-for-sample equivalent
 * to rendering it as one continuous span.
 *
 * Levels are 0..1 and may be fractional: the audible ULA speaker is the
 * weighted EAR+MIC mix (BEEPER-PCM-MIX-001, see {@link speakerMixLevel}), so
 * intermediate levels exist — a MIC-only `SAVE` tone sits at 0.2, not 0/1.
 */

/** EAR (port 0xFE b4) share of the audible speaker drive (BEEPER-PCM-MIX-001). */
export const EAR_MIX_WEIGHT = 0.8;
/** MIC (port 0xFE b3) share of the audible speaker drive (BEEPER-PCM-MIX-001). */
export const MIC_MIX_WEIGHT = 0.2;

/**
 * The audible speaker drive 0..1 for a port-0xFE write byte: the ULA mixes BOTH
 * output lines into the speaker — EAR (b4) strongly and MIC (b3) weakly, a
 * roughly 4:1 measured hardware ratio (BEEPER-PCM-MIX-001). The audible level is
 * a weighted SUM, not an XOR: game beeper routines that toggle both bits in
 * phase (OUT 0x18 / OUT 0x00) get a full-swing tone, while the ROM SAVE routine
 * — which toggles only MIC — stays audible but soft.
 */
export function speakerMixLevel(portByte: number): number {
  return EAR_MIX_WEIGHT * ((portByte >> 4) & 1) + MIC_MIX_WEIGHT * ((portByte >> 3) & 1);
}

export interface PreviewBeeperEdge {
  /** T-state offset from the start of this chunk. */
  t: number;
  /** Speaker drive 0..1 after the edge (fractional: the EAR+MIC mix). */
  level: number;
}

export interface PreviewBeeperPcmState {
  /** Total T-states consumed since this stream was started. */
  elapsedTStates: number;
  /** Number of complete PCM samples emitted on the global grid. */
  sampleIndex: number;
  /** Integrated drive-level area in the current, incomplete sample. */
  partialArea: number;
  /** Speaker drive 0..1 in effect at `elapsedTStates`. */
  level: number;
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
  level: number = 0,
): PreviewBeeperPcmState {
  return {
    elapsedTStates: 0,
    sampleIndex: 0,
    partialArea: 0,
    level,
  };
}

/**
 * Render one chronological chunk. Drive 0 maps to -1 and drive 1 to +1 (a
 * fractional drive maps linearly between); browser-side filtering/gain remain
 * output-device policy.
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
