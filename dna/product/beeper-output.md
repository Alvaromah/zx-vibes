# Beeper Output — edge stream → PCM (gallery audio)

The normative reference for the **gallery's audio rendering policy**: how the
hardware-truth beeper **edge stream** (the port-`0xFE` bit-4 edges,
[`../domain/host-io-port-fe.md`](../domain/host-io-port-fe.md)
HOST-IO-PORTFE-BEEPER-001, timestamped chronologically per
HOST-IO-PORTFE-EVENT-CHRONO-001) is resampled, conditioned, and captured to PCM for
playback and for deterministic conformance.

Per ADR-0016 this is **gallery rendering policy**, kept separate from the emulator's
hardware-truth event surface: the edge stream and the 48K clock are `hardware`; the
resampling, the 1-bit→amplitude mapping, the conditioning, and the capture route are
the gallery's choice (`decision:ADR-0016`), provisional and revisable. It is the
domain oracle for `dna/conformance/audio/`.

## Why a separate policy

A consumer's shell produced audible beeper output but its long captures slowly
deteriorated (C6/C7/C8): a rounded samples-per-frame drifts, sorting edges by the
ULA-frame modulo reorders them across the frame wrap (fixed in
HOST-IO-PORTFE-EVENT-CHRONO-001), and resetting the conditioning/sample state at
each 50 Hz frame boundary clicks. The capture path must also be **deterministic**:
the test browser reported WebAudio `suspended`, so audible playback cannot be the
conformance route. This file pins the policy that avoids those failures and makes
the capture conformance-checkable.

## The edge stream (consumed, not redefined)

<!-- provenance: hardware -->
- [id: BEEPER-PCM-EDGE-SOURCE-001] The input is the chronological beeper **edge
  stream**: a monotonic sequence `{ t, level }` of speaker-level changes, where `t`
  is the chronological CPU T-state time (HOST-IO-PORTFE-EVENT-CHRONO-001) and
  `level` is the 1-bit port-`0xFE` b4 value (HOST-IO-PORTFE-BEEPER-001). The speaker
  rest level is `0`. This is the emulator's hardware-truth surface; this file
  consumes it and does not redefine it.

<!-- provenance: hardware -->
- [id: BEEPER-PCM-CLOCK-001] The 48K Z80 runs at `CPU_CLOCK_HZ = 3_500_000` Hz
  (14 MHz ÷ 4). The ULA frame rate is `3_500_000 / 69888 ≈ 50.08 Hz`
  (ULA-TIME-FRAME-001). A PCM sample at rate `R` Hz therefore spans
  `CPU_CLOCK_HZ / R` T-states (≈ `79.4` T at 44.1 kHz), a **non-integer** count —
  which is the root of the drift policy below.

## Resampling (fractional accounting)

<!-- provenance: decision:ADR-0016 -->
- [id: BEEPER-PCM-FRACTIONAL-001] PCM is produced on a **global sample grid** anchored
  at the start of the capture: output sample `k` has CPU time
  `sampleTime(k) = floor(k · CPU_CLOCK_HZ / R)` and takes the speaker level in effect
  at that time (the latest edge with `edge.t ≤ sampleTime(k)`; the rest level before
  the first edge). The number of samples spanning a capture of `T` T-states is the
  **fractional-exact** `samplesForDuration(T, R) = floor(T · R / CPU_CLOCK_HZ)`. This
  uses **fractional sample accounting**, NOT a rounded integer samples-per-frame: a
  rounded `881` samples/frame at 44.1 kHz drifts ≈ `28 ms/min` (C6). The capture
  count stays within one sample of the exact real duration `T · R / CPU_CLOCK_HZ`.

<!-- provenance: decision:ADR-0016 -->
- [id: BEEPER-PCM-LEVEL-001] The 1-bit level maps to a PCM amplitude: level `0` →
  `level0`, level `1` → `level1` (a symmetric pair such as `−1 / +1` or `0 / peak`;
  the exact amplitudes are a host choice). This square 1-bit signal is the raw
  hardware-beeper truth. Any **conditioning** — edge slew, a gentle low-pass, a DC
  blocker — is host **speaker** policy layered on top and is kept distinct from the
  hardware edge truth; the conformance route fixes the raw mapping and the
  continuity rule, leaving the specific filter coefficients an Incidental host choice.

## Continuity across frame boundaries

<!-- provenance: decision:ADR-0016 -->
- [id: BEEPER-PCM-CONTINUITY-001] The sample grid and all conditioning state are
  **continuous across frame boundaries** — there is **no forced 50 Hz reset**. A
  capture rendered as two consecutive chunks (carrying the global sample index, the
  running speaker level, and any filter state from the first chunk into the second)
  is **sample-for-sample identical** to the same span rendered as one continuous
  capture (C8). Re-anchoring the sample grid to each frame, or resetting the level /
  filter state at the 50 Hz boundary, introduces a discontinuity (an audible click)
  and is wrong. Because the chunk boundary splits only the global sample **index**
  (`countA = samplesForDuration(splitT, R)`), not the grid, the two renderings agree.

## Deterministic capture (the conformance route)

<!-- provenance: decision:ADR-0016 -->
- [id: BEEPER-PCM-CAPTURE-001] The **conformance route is a deterministic PCM
  capture**: from a fixed edge stream and `(R, T)` the rendered sample array is fully
  determined (no wall-clock, no RNG, no live AudioContext). Audible browser playback
  is a **manual real-browser acceptance only** (C9) — it cannot gate, because the
  test environment reported WebAudio `suspended`. The deterministic capture is
  analysed by the metrics the fixtures assert: the **duration** (sample count, C6),
  **edge-order preservation** (each level transition lands at the right sample), and
  a **jitter** metric on a stable tone (the rising-edge sample spacing of a square
  wave stays within one sample — a faithful, stable capture). A WAV container is just
  a wrapper around this PCM; its byte layout is Incidental.

## Acceptance criteria

A gallery beeper-PCM renderer satisfies this policy iff, through
`dna/conformance/audio/run-audio-fixtures.mjs` against the reference model
`dna/conformance/audio/beeper-pcm-model.mjs`:

- `audio-duration.json` (BEEPER-PCM-FRACTIONAL-001) — a multi-second capture
  (200 frames) at 44.1 kHz and 48 kHz has the fractional-exact sample count
  (`176117` / `191692`); the self-test proves a rounded samples-per-frame resampler
  drifts and fails.
- `audio-edge-order.json` (BEEPER-PCM-LEVEL-001) — a short edge stream renders to the
  exact PCM sample array, each transition at the right sample; the self-test proves
  an edge-dropping renderer fails.
- `audio-continuity.json` (BEEPER-PCM-CONTINUITY-001) — a capture split into two
  chunks equals the continuous capture sample-for-sample; the self-test proves a
  per-chunk grid-reset renderer breaks continuity.
- `audio-jitter.json` (BEEPER-PCM-CAPTURE-001) — a stable square-wave tone captures
  with sub-sample rising-edge jitter at 44.1 kHz and 48 kHz.
