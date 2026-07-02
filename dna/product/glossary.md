# Glossary

Shared vocabulary for the zx-vibes DNA. Domain terms cite the hardware/standard;
project terms cite the product or a decision. One entry, one meaning.

## Project & method

- [id: GL-DNA-001] **DNA** — the self-contained genome in `dna/` that is the source of truth; an implementation is correct iff it passes `dna/conformance/`. [provenance: decision:ADR-0003]
- [id: GL-ORACLE-001] **Oracle** — the legacy running product (`../zx-vibes` on `main`), a one-time extraction source and point tie-breaker, never an authority (C4). [provenance: decision:ADR-0003]
- [id: GL-CONF-001] **Conformance** — the fixture suite + coverage ledger that decides correctness; the CI gate (`conformance:check`). [provenance: contract]
- [id: GL-TIER-001] **Tier** — a behavior's enforcement level: `contract` (public surface, must hold), `fidelity` (hardware-accurate behavior, must hold), `incidental` (explicitly unspecified, implementer's choice). [provenance: contract]
- [id: GL-PROV-001] **Provenance** — the authority tag on each claim/fixture (`hardware`, `z80-spec`, `zexall`, `zexdoc`, `fuse`, `contract`, `manual`, `decision:<id>`, or `UNKNOWN`). [provenance: contract]
- [id: GL-UNKNOWN-001] **UNKNOWN** — a behavior justified only by legacy code; a backlog item to resolve, never a shipped default (C5). [provenance: contract]
- [id: GL-CUTOVER-001] **Cutover** — the point a regenerated package replaces the legacy one; its slice's contract+fidelity rows must all be covered first. [provenance: contract]

## Hardware (ZX Spectrum 48K)

- [id: GL-Z80-001] **Z80** — the 8-bit CPU; its documented + undocumented instruction behavior is the `cpu` fidelity target (zexdoc/zexall). [provenance: z80-spec]
- [id: GL-ULA-001] **ULA** — the custom chip generating video/timing; owns the frame (69888 T-states), contention, the border, and port `0xFE`. [provenance: hardware]
- [id: GL-TSTATE-001] **T-state** — one CPU clock cycle (~3.5 MHz); the unit of all timing fidelity. [provenance: hardware]
- [id: GL-CONTENTION-001] **Contention** — ULA-induced CPU stalls when accessing contended memory/ports during the display window; modeled per-access and M-cycle-exact. [provenance: hardware]
- [id: GL-FLOATBUS-001] **Floating bus** — the value read from an unmapped/contended port reflecting the byte the ULA is fetching; a timing-sensitive read. [provenance: hardware]
- [id: GL-BEEPER-001] **Beeper** — the 1-bit speaker driven by port `0xFE` bit 4; `beeperEdges` counts its transitions. [provenance: hardware]
- [id: GL-MEMPTR-001] **MEMPTR / WZ** — the internal Z80 register whose bits leak into `BIT n,(HL)` flag 5/3; modeled as an input register (`UNKNOWN:emulator:CPU-WZ-001` tracks full output semantics). [provenance: z80-spec]
- [id: GL-IM-001] **Interrupt mode (IM 0/1/2)** — the Z80 interrupt-vectoring mode; the 48K uses the maskable 50 Hz frame interrupt (~32 T-state window). [provenance: z80-spec]

## Formats & data

- [id: GL-SNA-001] **`.sna`** — a 48K snapshot format (registers + 48K RAM). [provenance: contract]
- [id: GL-Z80FMT-001] **`.z80`** — a snapshot format with v1/v2/v3 headers; the toolkit targets the 48K variant (`snapshot-z80.md`). [provenance: contract]
- [id: GL-TAP-001] **`.tap` / `.tzx`** — tape image formats loaded/played by the toolkit. [provenance: contract]
- [id: GL-SLD-001] **SLD** — the source-level-debug data the assembler emits (symbols + source-line records) that drives `break`/`disasm`/`trace` label resolution. [provenance: contract]
- [id: GL-ZXSTATE-001] **`.zxstate`** — the toolkit's persistent session-machine file (`.zxs/state.zxstate`), shared between the CLI and MCP server. [provenance: contract]

## Toolkit

- [id: GL-ZXS-001] **`zxs`** — the toolkit CLI; `zxs-mcp` is its MCP server; `zx-vibes` is the umbrella package/alias bin. [provenance: contract]
- [id: GL-SESSION-001] **Session** — the persistent emulator machine successive commands observe and mutate (`session.report()` shape). [provenance: contract]
- [id: GL-RECIPE-001] **Recipe** — a reusable `recipe.asm` building block plus a `demo.asm` and a `test.json`; the test spec is its executable proof. [provenance: contract]
- [id: GL-ASSERTION-001] **Assertion** — a declarative check in a `*.test.json` spec (one of 13 types: `status`, `memEquals`, `beeperEdges`, …) evaluated against the post-run machine. [provenance: contract]
- [id: GL-SPECTRAL-001] **spectral** — the embedded `@zx-vibes/asm` assembler backend (default); `sjasmplus` is the external alternative. [provenance: contract]

## Provenance

- Domain terms cite `hardware`/`z80-spec`; project/method terms cite `contract` or
  a decision. No `UNKNOWN`. Definitive detail lives in the per-area domain/product
  specs; this file only fixes the vocabulary.
