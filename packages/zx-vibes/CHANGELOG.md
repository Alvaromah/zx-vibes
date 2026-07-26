# zx-vibes

## 0.8.0

### Minor Changes

- b27ad35: Halve the preview's audio delay, and make human CLI output readable.

  - **Preview audio latency**: the AudioWorklet's queue ceiling was 100 ms, and
    because the producer slightly outpaces the audio hardware clock the queue
    always settled just under it — the ceiling _was_ the delay. Lowered to 40 ms,
    and the excess is now shed by advancing the read cursor (a few milliseconds)
    instead of dropping whole ~20 ms buffers (a frame-sized discontinuity).
    Measured standing queue: **~70 ms → ~18 ms**, stable across a 90-second run and
    a hidden-tab excursion. The remaining delay is the output device's own latency,
    which the page cannot change (34–74 ms here; Bluetooth output adds far more).
  - **Human CLI output**: `formatHuman` dumped every envelope field verbatim, so
    `zxs setup --agent codex` printed 27 absolute paths on one line and `zxs verify`
    printed three truncated JSON envelopes. Bulk lists now summarize to a count,
    lists whose items carry `ok` report the verdict, and nested envelopes collapse
    to pass/fail. `--json` is byte-identical — only the human line changed, whose
    wording is Incidental (CLI-PROD-FREE-001).

  ```
  setup: agent=codex mcpServer=zx-vibes global=false installed=27 skipped=1 deferred=1 next=2
  doctor: checks=4/4 ok
  test:   total=3 passed=3 failed=0 results=3/3 ok
  verify: build=ok run=ok tests=ok screenshot=.zxs/verify-screen.png
  ```

### Patch Changes

- Updated dependencies [b27ad35]
  - @zx-vibes/toolkit@0.8.0

## 0.7.0

### Minor Changes

- 302e27a: Preview player host fidelity (ADR-0028): audible SAVE, full symbol keymap, real
  raster border — parity with the emulator demos' host policies.

  - **Audio — the weighted EAR+MIC speaker mix** (`BEEPER-PCM-MIX-001`): the audible
    drive is `0.8·b4 + 0.2·b3`, a fractional level through the existing continuous
    PCM grid. The ROM `SAVE`'s MIC-only tone is now audible (soft, as on hardware);
    game beepers toggling both bits in phase stay full-swing. `run --wav` keeps the
    1-bit `b4` capture unchanged.
  - **Keyboard — printable symbol characters** (`KBD-BROWSERMAP-002`): `,` `.` `"`
    `;` `:` `-` `+` `=` `*` `/` `?` `'` `_` `<` `>` `!` … type as their 48K SYMBOL
    SHIFT chords, resolved from the produced character so any host layout works. A
    host Shift that produced a symbol keeps its CAPS suppressed for the rest of the
    hold, so staggered releases cannot trip EXTENDED mode. The whole pressed set is
    re-resolved from held physical keys, fixing chords stuck by asymmetric modifier
    release.
  - **Keyboard — the quick-tap latch is scan-granular** (`KBD-LATCH-001`): the scan
    is the 50 Hz frame, not one IN read. The old per-read latch clearing hid a
    latched tap from every half-row the ROM reads after row 0 (a tap on B/N/M/SPACE
    could vanish); taps are now frozen into exactly one full frame's scan.
  - **Border — the 320×240 bordered frame in-canvas** (`RT-PROD-PREVIEW-008`,
    `RASTER-GEOMETRY-001`): the 256×192 display inset by the standard 32-px/24-line
    visible border, rendered as canvas pixels with a per-scanline colour from the
    frame's border events — tape `SAVE`/`LOAD` paints its red/cyan bands
    (`RASTER-SAVE-PP-001`) instead of a small CSS-coloured page frame.

### Patch Changes

- Updated dependencies [302e27a]
  - @zx-vibes/toolkit@0.7.0

## 0.6.1

### Patch Changes

- cd4fd6c: `doctor`: resolve the `zxs` shims that `npm install -g zx-vibes` actually writes.

  The `zxs-path` check recognised only shims targeting `@zx-vibes/toolkit/bin/zxs.js`
  — the layout a monorepo `npm link` produces. A real global install of the umbrella
  package writes shims targeting `zx-vibes/bin/zxs.js` instead, so the check fell back
  to reporting the shim directory as the installation root and left `cliPresent` unset.
  The ambiguity check still worked, but the "incomplete installation (missing
  `dist/cli.js`)" branch could never fire for the documented install path.

  Both shim families now resolve to the toolkit root, whether npm nests the toolkit
  under the umbrella package or hoists it, so the completeness check applies to
  `npm install -g zx-vibes` as well.

- Updated dependencies [cd4fd6c]
  - @zx-vibes/toolkit@0.6.1

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
