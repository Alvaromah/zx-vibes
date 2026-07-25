---
"@zx-vibes/toolkit": minor
"zx-vibes": minor
---

Agent-feedback pass: watchdog liveness, state reset semantics, verify tests dir, `--scale`.

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
