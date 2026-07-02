# Coverage ledger

The instrument that makes "the DNA is complete and independent" **verifiable**
instead of a claim. It maps every public behavior to the fixture(s) that prove it
and to the authority (provenance) that justifies the expected value.

Without this ledger, under-specification is invisible: an implementation can pass
a weak suite and still differ observably. The ledger turns the Definition of Done
(`../../specs-plan.md` §9) into a CI-checkable gate.

## Data

The machine-readable ledger is `coverage.yaml`. This file documents its schema
and rules. `coverage-check.mjs` reads `coverage.yaml` in CI. Default mode keeps
the bootstrap ledger valid while slices are still open; `--cutover <area|all>`
enforces the strict gate below for a slice or the final project exit.

## Row schema

| field | meaning |
| --- | --- |
| `id` | stable id, e.g. `ASM-EMIT-001`, `CPU-FLAG-001`, `CLI-EXIT-001` |
| `area` | `assembler` \| `emulator` \| `toolkit` \| `scaffolding` \| `gallery` \| `reference` \| `cross` |
| `behavior` | one observable behavior, stated as a testable assertion |
| `tier` | `contract` \| `fidelity` \| `incidental` (`../../specs-plan.md` §3.4) |
| `provenance` | `hardware` \| `z80-spec` \| `zexall` \| `zexdoc` \| `fuse` \| `contract` \| `manual` \| `decision:<id>` \| `UNKNOWN` |
| `fixtures` | paths under `conformance/` that prove the behavior |
| `status` | `covered` \| `partial` \| `uncovered` \| `unknown` |
| `notes` | optional |

## Gate (enforced in CI)

- **No `contract` or `fidelity` row may be `uncovered`, `partial`, or `unknown`
  at its slice's cutover.** Each must be `covered` with at least one fixture and a
  non-`UNKNOWN` provenance.
- **Every `UNKNOWN` provenance** is a backlog item in `../../.harness/decisions.md`
  and MUST be resolved (ratify / re-derive / redesign) before cutover.
- **`incidental` rows** are allowed to have no fixture, but MUST be present and
  explicitly marked, so "unspecified" is a decision, not an oversight.

Run the strict gate with:

```bash
node dna/conformance/coverage-check.mjs --cutover assembler
node dna/conformance/coverage-check.mjs --cutover all
```

## Offline acceptance rows — zexdoc / zexall (ADR-0006)

Two CPU fidelity rows, **`CPU-ZEXDOC-001`** and **`CPU-ZEXALL-001`**, are covered
by an **offline acceptance run, not by the CI emulator gate.** A complete zexdoc /
zexall run is billions of T-states; through the pure-JS `@zx-vibes/cpu` reference
it takes ~15 min each — fine offline, unacceptable as a CI gate. So:

- `conformance:check` and `conformance:check:emulator` (emulator **28/28**) carry
  only the **fast adapter self-test** (`cpu/zex-cpm-cpu-adapter-self-test.mjs`),
  which proves the CP/M monitor + adapter wiring, not a full suite pass.
- The **CI fidelity net** for CPU execution is the **FUSE per-opcode suite**
  (`CPU-FUSE-*` via `run-fuse-suite.mjs`), which runs in-gate.
- The two rows flip to `covered` only when a **complete** offline run (`Tests
  complete`, 0 `ERROR`) is **recorded in `decisions.md`** (done 2026-06-28). They
  are acceptance evidence, never produced by the CI run.

This keeps "core conformance green" from being misread as "zexdoc/zexall ran in
CI" (R-HYG-2).

## Per-product shards (W7 Level 1, ADR-0014)

So each product is workable in isolation, the ledger reports per-`area` counts
without changing the aggregate:

```bash
node dna/conformance/coverage-check.mjs --area emulator   # one product's covered/gated
node dna/conformance/coverage-check.mjs --by-area         # aggregate + a per-area breakdown
pnpm run coverage:check:by-area                           # same breakdown
```

`--area` and `--by-area` only change reporting — validation still runs over the
whole ledger, and the default (no-flag) output and the aggregate 92/95 count are
unchanged. Each `conformance:check:<product>` gate appends its own `--area` shard.

## Independence test (project exit)

Coverage being full is necessary but not sufficient. The acid test is operational
(`../../specs-plan.md` §9): a fresh agent regenerates each core from `dna/` alone
with the suite green, and two independent regenerations agree. Divergences that
the suite did not catch are new ledger rows.

## How to update

When you author a behavior or a fixture, add/patch its row in `coverage.yaml` in
the same change. Status flows `uncovered → partial → covered`; provenance flows
`UNKNOWN → decision:<id>` or an external authority. Never delete a row to make the
gate pass.
