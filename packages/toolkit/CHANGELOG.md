# @zx-vibes/toolkit

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
