#!/usr/bin/env node
// Reference beeper edge -> PCM renderer, authored straight from
// dna/product/beeper-output.md (the gallery's audio capture policy, ADR-0016) over
// the hardware-truth beeper edge stream (HOST-IO-PORTFE-BEEPER-001 + the
// chronological timestamps of S2). It is the conformance MODEL for the gallery's
// deterministic PCM capture route (C9): the default --module of
// run-audio-fixtures.mjs. The fixtures are the authority; the self-test rejects a
// per-frame-rounded resampler (C6) and a per-frame-reset (grid-realigning)
// resampler (C8).
//
// Edge stream: [{ t, level }] in CHRONOLOGICAL CPU T-state order (S2), level 0/1.
// `initialLevel` is the speaker level before the first edge (rest 0 at power-on).

// 48K Z80 clock: 14 MHz / 4 = 3.5 MHz exactly. The ULA frame rate is
// CPU_CLOCK_HZ / FRAME_T_STATES = 3_500_000 / 69888 ~= 50.08 Hz, which is why a
// rounded integer samples-per-frame drifts (C6).
export const CPU_CLOCK_HZ = 3_500_000;

// Fractional-exact sample count for a capture spanning `tStates` CPU T-states at
// `sampleRate` Hz: floor(tStates * sampleRate / clock). The count tracks the exact
// real value to within one sample with NO per-frame rounding, so a multi-second
// capture does not drift (C6).
export function samplesForDuration(tStates, sampleRate, clockHz = CPU_CLOCK_HZ) {
  return Math.floor((tStates * sampleRate) / clockHz);
}

// The CPU T-state time of global output sample index k. The grid is anchored at
// the start of the capture (index 0), NOT realigned per frame — this is what makes
// chunked rendering continuous across frame boundaries (C8).
export function sampleTime(k, sampleRate, clockHz = CPU_CLOCK_HZ) {
  return Math.floor((k * clockHz) / sampleRate);
}

// The 0/1 speaker level in effect at CPU T-state time `t`, given the chronological
// edge stream and the level before the first edge. Edges are monotonic in t (S2).
export function levelAt(t, edges, initialLevel = 0) {
  let level = initialLevel;
  for (const edge of edges ?? []) {
    if (edge.t <= t) level = edge.level;
    else break;
  }
  return level;
}

// Render PCM samples for the GLOBAL sample-index range [startSample, endSample)
// from the edge stream. The 1-bit level maps to amplitude: 0 -> level0, 1 -> level1.
// Carrying (startSample, edges, initialLevel) across calls renders a continuous
// stream chunk by chunk with no boundary discontinuity (C8).
export function renderRange(edges, { sampleRate, startSample, endSample, initialLevel = 0, level0 = -1, level1 = 1, clockHz = CPU_CLOCK_HZ }) {
  const samples = [];
  for (let k = startSample; k < endSample; k += 1) {
    const level = levelAt(sampleTime(k, sampleRate, clockHz), edges, initialLevel);
    samples.push(level ? level1 : level0);
  }
  return samples;
}

// Capture [0, tStatesTotal) at sampleRate: global sample indices 0 .. N-1 where
// N = samplesForDuration(tStatesTotal). Deterministic; the conformance route (C9).
export function capture(edges, { sampleRate, tStatesTotal, initialLevel = 0, level0 = -1, level1 = 1, clockHz = CPU_CLOCK_HZ }) {
  const n = samplesForDuration(tStatesTotal, sampleRate, clockHz);
  return renderRange(edges, { sampleRate, startSample: 0, endSample: n, initialLevel, level0, level1, clockHz });
}

// Build a stable square-wave edge stream: a rising/falling edge every `halfPeriodT`
// CPU T-states over [0, tStatesTotal). Used for the jitter metric (a faithful
// capture reproduces a stable tone with sub-sample jitter, C9).
export function squareWaveEdges(halfPeriodT, tStatesTotal) {
  const edges = [];
  let level = 1;
  for (let t = 0; t < tStatesTotal; t += halfPeriodT) {
    edges.push({ t, level });
    level = level ? 0 : 1;
  }
  return edges;
}

// Jitter metric: the rising-edge sample indices of a rendered capture should be
// evenly spaced; the jitter is the max absolute deviation (in samples) of each
// measured rising-edge spacing from the mean spacing. A faithful fractional capture
// keeps this within one sample.
export function risingEdgeJitter(samples, { level1 = 1 } = {}) {
  const risings = [];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] === level1 && samples[i - 1] !== level1) risings.push(i);
  }
  if (risings.length < 3) return 0;
  const spacings = [];
  for (let i = 1; i < risings.length; i += 1) spacings.push(risings[i] - risings[i - 1]);
  const mean = spacings.reduce((a, b) => a + b, 0) / spacings.length;
  return Math.max(...spacings.map((s) => Math.abs(s - mean)));
}
