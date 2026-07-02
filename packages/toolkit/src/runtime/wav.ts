// Beeper edge stream → PCM → WAV — toolkit-runtime.md RT-PROD-OUT-002 ("the WAV …
// artifacts are written to caller-specified paths; their byte content is a function of
// the deterministic run"), cli.md CLI-PROD-RUN-004 (`run --wav <file>` output capture).
//
// `run --wav` renders the run's beeper EDGE STREAM (HostIo.edges — the port-`0xFE` bit-4
// transitions with instruction-start machine clocks, HOST-IO-PORTFE-BEEPER-001) to a mono
// 16-bit PCM square wave and wraps it in a RIFF/WAVE container. The resampling policy is
// the DNA's beeper-output.md (BEEPER-PCM-*):
//   - BEEPER-PCM-CLOCK-001: the 48K Z80 runs at CPU_CLOCK_HZ = 3_500_000 Hz; a PCM sample
//     at rate R spans CPU_CLOCK_HZ / R T-states (a non-integer count).
//   - BEEPER-PCM-FRACTIONAL-001: a GLOBAL sample grid anchored at capture start — output
//     sample k has CPU time sampleTime(k) = floor(k·CPU_CLOCK_HZ / R) and takes the level
//     in effect then (the latest edge with edge.t ≤ sampleTime(k); rest 0 before the first
//     edge). The count is the fractional-exact floor(T·R / CPU_CLOCK_HZ) — NOT a rounded
//     samples-per-frame (which drifts ≈28 ms/min).
//   - BEEPER-PCM-LEVEL-001: the 1-bit level maps to a symmetric amplitude pair (0 → −A,
//     1 → +A). The exact amplitude and the WAV byte layout are Incidental host choices.
//
// The edge stream carries the timing WAV needs (a chronological machine clock per edge),
// so this is BUILT, not deferred: no W4-GAP is required.

import type { BeeperEdge } from './io-device.js';
import { CPU_CLOCK_HZ } from './run.js';

/** A sane default PCM sample rate (CLI-PROD-RUN-004 "~44100 Hz"). */
export const DEFAULT_SAMPLE_RATE = 44_100;
/** The symmetric square-wave amplitude for a 16-bit sample (level 1 → +A, level 0 → −A). */
export const BEEPER_AMPLITUDE = 12_000;

/**
 * The fractional-exact number of PCM samples spanning `tStates` CPU T-states at `sampleRate`
 * (BEEPER-PCM-FRACTIONAL-001): `floor(tStates · sampleRate / CPU_CLOCK_HZ)`.
 */
export function samplesForDuration(tStates: number, sampleRate: number): number {
  return Math.floor((tStates * sampleRate) / CPU_CLOCK_HZ);
}

/** The CPU T-state time of global output sample index `k` (BEEPER-PCM-FRACTIONAL-001). */
export function sampleTime(k: number, sampleRate: number): number {
  return Math.floor((k * CPU_CLOCK_HZ) / sampleRate);
}

export interface BeeperPcmOptions {
  sampleRate?: number | undefined;
  /** Symmetric amplitude (level 1 → +amplitude, level 0 → −amplitude). */
  amplitude?: number | undefined;
}

/**
 * Render the beeper edge stream to a 16-bit signed PCM sample array over the capture span
 * `[startT, startT + durationT)` (BEEPER-PCM-FRACTIONAL-001 / -LEVEL-001). `edges` carry
 * ABSOLUTE machine clocks; the global grid is anchored at `startT`. Edges are chronological,
 * so the walk advances a single edge cursor as the (monotonic) sample time increases.
 */
export function renderBeeperPcm(
  edges: readonly BeeperEdge[],
  startT: number,
  durationT: number,
  options: BeeperPcmOptions = {},
): Int16Array {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amplitude = options.amplitude ?? BEEPER_AMPLITUDE;
  const count = Math.max(0, samplesForDuration(Math.max(0, durationT), sampleRate));
  const pcm = new Int16Array(count);

  let cursor = 0; // index of the next edge not yet applied
  let level: 0 | 1 = 0; // rest level before the first edge (BEEPER-PCM-EDGE-SOURCE-001)
  for (let k = 0; k < count; k += 1) {
    const t = startT + sampleTime(k, sampleRate);
    // Advance through every edge whose (absolute) time has been reached.
    while (cursor < edges.length && edges[cursor]!.t <= t) {
      level = edges[cursor]!.level;
      cursor += 1;
    }
    pcm[k] = level === 1 ? amplitude : -amplitude;
  }
  return pcm;
}

/** Wrap a 16-bit signed mono PCM sample array in a canonical RIFF/WAVE (PCM) container. */
export function encodeWav(pcm: Int16Array, sampleRate: number = DEFAULT_SAMPLE_RATE): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataBytes = pcm.length * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4); // RIFF chunk size
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size (PCM)
  buffer.writeUInt16LE(1, 20); // audio format 1 = PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i += 1) buffer.writeInt16LE(pcm[i]!, 44 + i * 2);
  return buffer;
}

export interface BeeperWavOptions extends BeeperPcmOptions {}

/**
 * Render the beeper edge stream over a capture span to a complete `.wav` file's bytes
 * (RT-PROD-OUT-002). `startT`/`durationT` are the run's absolute start clock and its
 * T-state span (`machine.tStatesTotal - tstatesRun` and `tstatesRun`).
 */
export function renderBeeperWav(
  edges: readonly BeeperEdge[],
  startT: number,
  durationT: number,
  options: BeeperWavOptions = {},
): Buffer {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const pcm = renderBeeperPcm(edges, startT, durationT, options);
  return encodeWav(pcm, sampleRate);
}
