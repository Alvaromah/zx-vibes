# @zx-vibes/toolkit

## 0.6.0

### Minor Changes

- 1324148: Observability and preview pass: frame-budget telemetry, T-state profiling, declarative
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

## 0.5.0

### Minor Changes

- 9a681a6: Agent-feedback pass: watchdog liveness, state reset semantics, verify tests dir, `--scale`.

  - `run`: ULA output (border/beeper/port-0xFE counts) is folded into the hang watchdog's
    per-frame fingerprint, and `pc-in-rom` now requires ROM residence across the whole frame
    rather than a frame-edge sample — a static key-wait title no longer reads as `tight-loop`.
    Adds `run --no-detect-hangs` and `run --scale`.
  - `verify`: optional `zx.config.json` `"tests"` field, so the gate can run a project's real
    suite wherever it lives; adds `verify --scale`.
  - `state reset`: now reloads the built program (CLI and MCP `zx_state`), so
    `reset → run --state → mem read` sees the program again instead of blank RAM. Pass
    `--blank` (`blank: true` over MCP) for the previous bare clean-ROM boot. This is a
    behaviour change to an existing command.
  - `setup`: installs the knowledge pack — a generated `reference/`, 7 skills, and 2 CI-gated
    recipes, leaving only `examples/` deferred.

## 0.4.0

### Minor Changes

- First release from the regenerated repository. The toolkit is regenerated
  slice-by-slice from its DNA product specs (`dna/product/`) and verified by
  the executable conformance suite: the full `zxs` CLI (build, run, test,
  verify, screen, debug/inspect, state, preview, new/init/clean, doctor,
  setup, gfx), the `zxs-mcp` MCP server, the `.zxstate` session contract, and
  the `ZXS_REVENG` reverse-engineering add-on. It replaces the previous
  implementation published up to `0.3.1`, whose history lives in the original
  repository; version numbering continues above that line.

### Patch Changes

- Updated dependencies
  - @zx-vibes/asm@0.3.0
  - @zx-vibes/machine@0.1.0
  - @zx-vibes/ula@0.1.0
