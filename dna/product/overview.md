# Overview

The top-level scope of zx-vibes and how its DNA is partitioned. Orientation for
any agent reading the genome; the normative detail lives in the per-area specs.

## Purpose

- [id: OV-SCOPE-001] zx-vibes is a vibe-coding toolchain for the ZX Spectrum 48K: it assembles Z80 source, runs it on a faithful emulator, and lets an agent or human build/observe/verify/preview a program from one CLI and one MCP server. [provenance: contract]
- [id: OV-SCOPE-002] The product is defined by its DNA (`dna/`), not its code: an implementation is correct iff it passes `dna/conformance/`. The legacy code is a one-time extraction oracle, then disposable (C4). [provenance: decision:ADR-0003]

## Products (ADR-0014)

- [id: OV-PROD-001] The reconstruction is five separately workable products over a shared core (`dna/core`): **Emulator** (`@zx-vibes/cpu` + `/ula` + `/machine`), **Assembler/Disassembler** (`@zx-vibes/asm`, bin `zxasm`), **Toolkit** (`@zx-vibes/toolkit`, bins `zxs`/`zxs-mcp`, umbrella `zx-vibes`), **Scaffolding** (`create-zx-vibes` + `starters/`), and **Gallery** (the site). [provenance: decision:ADR-0014]
- [id: OV-PROD-002] Inter-product dependencies are conformance contracts, never source: `toolkit` ⟂ {`asm`, `emulator`}, `scaffolding` ⟂ `toolkit`, `gallery` ⟂ {`emulator`, `toolkit`}, `machine` ⟂ {`cpu`, `ula`}. The core depends on no product. [provenance: decision:ADR-0014]
- [id: OV-PROD-003] Reference knowledge (docs + agent skills) is a generated OUTPUT of the DNA, not a sixth product. [provenance: decision:ADR-0014]

## DNA layout

- [id: OV-DNA-001] `dna/domain/` holds normative reference derived from external standards (Z80, ULA, FUSE, zexall) — the hardware/encoding truth, provenance `z80-spec`/`hardware`/`fuse`/`zexall`/`zexdoc`. [provenance: contract]
- [id: OV-DNA-002] `dna/product/` holds the surface invented by this project (CLI, MCP, runtime, assembler, recipes, config), mined once from the oracle, provenance typically `contract`. [provenance: contract]
- [id: OV-DNA-003] `dna/conformance/` is the decider: fixtures + the coverage ledger; a regeneration is accepted iff its slice is green. The shared core is `z80-opcodes.{md,yaml}` plus the conformance infrastructure. [provenance: contract]

## Constraints (specs-plan.md §2)

- [id: OV-CONS-001] C1 always shippable (monorepo stays green, cutover per package); C2 DNA self-contained (no normative claim depends on an external PDF); C3 conformance decides; C4 one-time extraction; C5 no silent debt / no silent breakage (every behavior traces to authority or a recorded decision; `UNKNOWN` is never a shipped default). [provenance: contract]

## Status pointer

- [id: OV-STATUS-001] Live completeness is the coverage ledger (`dna/conformance/coverage.{md,yaml}`); the emulator core is complete and the toolkit/scaffolding are the open slices. This document fixes scope, not progress. [provenance: contract]

## Provenance

- Product-scope claims are `contract`; the product partition and seams are
  `decision:ADR-0014`; the DNA-is-truth stance is `decision:ADR-0003`. No `UNKNOWN`.
  See `glossary.md` for terms and the per-area specs for normative detail.
