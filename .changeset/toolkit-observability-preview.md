---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Observability and preview pass: frame-budget telemetry, T-state profiling, declarative
scenario anchors, browser audio, and install diagnostics.

- `run`: every run reports `frameBudget` — `frameTStates`, HALT-synchronized
  `measuredFrames`, accepted `interruptFrames`, `overrunFrames`, aggregate HALT-idle
  T-states, and the busiest `worstFrame`. Measurement starts once an interrupt first
  resumes `HALT`, so boot work is excluded, and every later boundary is checked, so an
  intermittent (or final-frame) missed deadline stays visible even when the majority-based
  `haltSynced` heuristic is `true`. `haltSynced` and `frameBudget` are now part of the
  `run --json` envelope.
- `test`: a 17th assertion, `frameBudget` `{ maxOverrunFrames?, requireMeasured? }`, which
  by default requires at least one measured deadline and zero overruns. Specs also gain
  `setup` (address- or label-keyed memory writes applied before the run) and `waitFor`
  (a `memEquals` readiness warm-up that runs without scenario input, then restarts input
  frames, checkpoints, delta/screen baselines, and observable counters at frame zero while
  keeping live machine state). Results carry `readyAtFrame` when `waitFor` is used.
- `trace --profile`: actual contended T-states grouped by nearest preceding SLD function
  label, with repeated-HALT idle and interrupt-acknowledge time reported separately.
  Attribution is explicitly heuristic; code without matching debug data is `<unmapped>`.
- `preview`: the bundled player renders port-`0xFE` bit-4 edges through Web Audio after a
  user gesture, over a continuous PCM grid that does not accumulate per-frame rounding
  drift. Emulation now runs on a Worker-backed clock at the exact 48K frame duration and is
  independent of `requestAnimationFrame`, so a hidden tab keeps emulating while rendering
  pauses; overdue catch-up is bounded and excess backlog is discarded rather than replayed
  as fast-forward.
- `doctor`: a new `zxs-path` check that groups npm's extensionless/`.cmd`/`.ps1` wrappers
  by canonical package root, then fails on multiple distinct installations or a resolved
  package missing `dist/cli.js`. The `zxs` and `zxs-mcp` bins now load their built runtime
  dynamically and fail loudly with an incomplete-install message pointing at a rebuild or
  reinstall, instead of a bare module-resolution stack.
