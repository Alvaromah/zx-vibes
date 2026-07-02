# CLI conformance (`conformance/cli/`)

Normalized CLI-snapshot fixtures for the toolkit product (`zxs` / `zxs-mcp`),
backing the `toolkit` coverage rows. DNA authority: `dna/product/cli.md`,
`toolkit-runtime.md`, `mcp-tools.md`, `recipes-and-assertions.md`.

## Status (W4)

The fixtures here are **authored as the regeneration target** (R-W4-04). They are
schema-valid and validated by `runner.mjs`, but there is **no execution runner in
the gate yet** — the regenerated `@zx-vibes/toolkit` does not exist until R-W4-05.
Per **ADR-0015**, these fixtures assert the **contract** (exit codes, JSON field
types/shapes), not byte-for-byte legacy output, and are made green by the
**regenerated** toolkit — never by pinning the legacy package (ADR-0013).

Until R-W4-05 wires the runner, the referencing coverage rows
(`CLI-EXIT-VERIFY-001`, `RUN-BEEPER-001`) stay `uncovered`; project coverage stays
92/95.

## Runner contract (to author in R-W4-05)

`run-cli-fixtures.mjs` (+ a `-self-test.mjs`) MUST:

- execute the **regenerated** `zxs` against each fixture case in a temp project,
- normalize stdout/exit via the `cli-snapshot` profile (`../normalization.mjs`,
  `../profiles/deterministic-run.json`) — strip versions, paths, timestamps,
  build hashes, ports, temp dirs,
- assert `expected` per case: exit code (`exitCode` / `exitNonZero`), JSON subset
  (`json`), or typed field (`field` + `type` + bound),
- be wired into `conformance:check:toolkit` **and** the aggregate `conformance:check`,
  then flip the two rows to `covered` in `coverage.yaml`.

## Fixtures

- `verify-exit.json` — `CLI-EXIT-VERIFY-001`: `zxs verify` exits 0 on pass /
  non-zero on failure.
- `run-beeper-edges.json` — `RUN-BEEPER-001`: `zxs run --json` reports
  `audio.beeperEdges` as an integer `>= 0`.
