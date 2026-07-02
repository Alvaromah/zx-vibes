# DNA — the project genome

This directory is the **source of truth** for zx-vibes. An implementation is a
regenerable phenotype; it is correct iff it passes `conformance/`. The model and
authoring rules come from `specs-plan.md`, an internal factory document that is
not part of this repository; `§` citations in these docs refer to it.

## Layers

- `domain/` — Z80, ULA, Spectrum, ROM, standard file formats. Truth from external
  standards, rewritten by us as a **self-contained, normative** technical
  reference (machine-readable where tabular). External sources appear only as
  `provenance`, never as a dependency to fetch. (C2)
- `product/` — the surface invented by this project (`zxs`/`zxasm` CLI, MCP
  tools, `.zxstate`, `zx.config.json`, recipe DSL, assertions, exit codes,
  generated-project contract, starters, gallery). Mined **once** from the oracle.
- `appendix/` — non-normative aids: pseudocode, derivations, worked examples.
  Pseudocode is "one correct realization", except for facts with no design
  freedom (DAA flags, contention table, opcode tables, ROM addresses), which are
  data and therefore normative.
- `conformance/` — the executable decider and CI gate. Every fixture carries
  `tier`, `provenance`, `input`, `expected`, and a normalization profile.

## Provenance

`hardware | z80-spec | zexall | zexdoc | fuse | contract | manual |
decision:<id> | UNKNOWN`. Every normative claim and fixture is tagged. `UNKNOWN`
behavior is a backlog item (tracked in `../.harness/decisions.md`), never a
shipped default.

Authored `domain/` and `product/` Markdown claims use explicit claim markers:
`[id: ...] [provenance: z80-spec]`. A preceding
`<!-- provenance: z80-spec -->` directive may provide provenance for the next
`[id: ...]` claim. Claims justified only by old code use
`[provenance: UNKNOWN]` and must be tracked in `../.harness/decisions.md` as
`UNKNOWN:<area>:<id>`, where the id is the coverage row, fixture id, or Markdown
`[id: ...]` tag.
