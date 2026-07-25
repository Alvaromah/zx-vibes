# zx-vibes

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

### Patch Changes

- Updated dependencies [1324148]
  - @zx-vibes/toolkit@0.6.0

## 0.4.0

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

### Patch Changes

- Updated dependencies [9a681a6]
  - @zx-vibes/toolkit@0.5.0

## 0.3.0

### Minor Changes

- First release from the regenerated repository. The umbrella package now
  delegates to the regenerated `@zx-vibes/toolkit` and `@zx-vibes/asm`
  (`@zx-vibes/emulator` is gone; the emulator lives in the
  `@zx-vibes/cpu`/`@zx-vibes/ula`/`@zx-vibes/machine` cores). It replaces the
  previous implementation published as `0.2.1`; earlier entries below describe
  that lineage.

### Patch Changes

- Updated dependencies
  - @zx-vibes/toolkit@0.4.0
  - @zx-vibes/asm@0.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [9b9fa51]
  - @zx-vibes/toolkit@0.3.1

## 0.2.0

### Minor Changes

- SCF/CCF undocumented-flag accuracy (Q register) and an opt-in INCLUDE/INCBIN sandbox.

  - **emulator:** model the Z80 "Q" latch so `SCF`/`CCF` derive their undocumented bits 3/5 as `((Q ^ F) | A)` — i.e. from `A` right after a flag-modifying instruction and from `F | A` otherwise.
  - **asm:** new opt-in `sandbox` assemble option (and `zxasm --sandbox`) that confines `INCLUDE`/`INCBIN`/`INSERT` reads to the project (cwd + include paths); absolute paths and `../` escapes are rejected. `SAVEBIN` output was already confined.
  - **toolkit:** `zxs build --sandbox`, and the MCP server sandboxes agent-driven builds by default (spectral backend).

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @zx-vibes/asm@0.2.0
  - @zx-vibes/toolkit@0.3.0

## 0.1.4

### Patch Changes

- 9ace69d: Align generated project contracts and public package surfaces across the repo.

  `create-zx-vibes` now creates the same MCP-ready project files as `zxs new`,
  installs dependencies by default with npm, and supports `--no-install`.
  Starter/template dependency floors now target the current `zx-vibes` release.

  `zxs play` now preserves `.tzx` filenames for browser tape parsing, preview
  records are written only by listening servers and stopped through an ownership
  token, and embedded assembler `SAVEBIN` artifact paths propagate through
  toolkit build output.

  Package metadata/version surfaces now derive from package manifests, gallery
  emulator bundles and starter/template drift are checked explicitly, and emulator
  README/API docs now describe the current `@zx-vibes/emulator` package, tape,
  snapshot, and callback APIs.

- Updated dependencies [9ace69d]
  - @zx-vibes/toolkit@0.2.1
  - @zx-vibes/asm@0.1.2

## 0.1.3

### Patch Changes

- a606951: Make generated projects runnable immediately by having `zxs new` install the
  local `zx-vibes` dependency by default, adding a `--no-install` escape hatch,
  and updating starter guidance for project-local `zxs` usage.
- Updated dependencies [ea0a2b7]
- Updated dependencies
- Updated dependencies [7cb76cd]
- Updated dependencies [a606951]
  - @zx-vibes/toolkit@0.2.0

## 0.1.2

### Patch Changes

- c813e18: Keep `zxs --version` synced with package metadata, document preview options in CLI regression tests, and let `zxs preview` fall forward to the next available port unless `--strict-port` is used.
- Updated dependencies [c813e18]
  - @zx-vibes/toolkit@0.1.2

## 0.1.1

### Patch Changes

- cf30399: Use source-controlled bin wrappers for CLI entrypoints so fresh workspace installs can create package shims before built `dist/` files exist, and document local clone and tarball workflows.
- Updated dependencies [5af5826]
- Updated dependencies [cf30399]
  - @zx-vibes/toolkit@0.1.1
  - @zx-vibes/asm@0.1.1
