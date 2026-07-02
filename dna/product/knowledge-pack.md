# Knowledge Pack (skills · reference · recipes) Product Surface

The **P1 moat** of `@zx-vibes/toolkit`: the skills, reference docs, recipes,
examples, and agent playbook that teach a code agent to build, run, **see**, and
**prove** a ZX Spectrum 48K game. The CLI is the delivery mechanism for a tight
loop; the durable, most-defensible value is this knowledge — and v2 **sources it
from the DNA** so it cannot silently rot. This spec **resolves the pending
ADR-0005** (how to model reference docs + agent skills).

## Purpose

- [id: KP-PROD-SCOPE-001] The knowledge pack is the toolkit's core P1 asset — the skills, reference docs, recipes, examples, and the generated agent playbook — packaged with the toolkit and installable into a project or an agent. [provenance: decision:ADR-0027]
- [id: KP-PROD-SCOPE-002] Its value is delivery-mechanism-independent: the moat is the knowledge, and it MUST trace to the DNA so a domain change propagates rather than leaving the docs to drift (C5 — no silent debt). [provenance: decision:ADR-0027]

## Public Behavior — what the pack contains

- [id: KP-PROD-CONTENT-SKILLS-001] `skills/` — a hub-and-spoke INDEX router pointing at per-skill `SKILL.md` files that decide *when/why* to apply a technique; authored in the native agent-skill format. [provenance: contract]
- [id: KP-PROD-CONTENT-REF-001] `reference/` — the unchanging *what/how* hardware + domain docs (memory map, screen/attribute decode, ULA timing, the opcode set, file formats, tape loading, Kempston, host-I/O). [provenance: contract]
- [id: KP-PROD-CONTENT-RECIPES-001] `recipes/` — the CI-tested corpus: each recipe is a reusable routine + a demo + a `test.json`, dual-purpose as assertion-engine regression *and* the copy-paste few-shot the skills point at. [provenance: contract]
- [id: KP-PROD-CONTENT-EXAMPLES-001] `examples/` — the worked tutorial (arkanoid) plus the **pong-by-agent** proof-of-mission artifact (an agent caught a crash because it ran and looked). [provenance: contract]
- [id: KP-PROD-CONTENT-PLAYBOOK-001] The generated `AGENT_PLAYBOOK` → `AGENTS.md`/`CLAUDE.md` operating manual that encodes the rule *"never report success without running and looking."* [provenance: contract]

## Sourcing (resolves ADR-0005)

- [id: KP-PROD-SOURCE-REF-001] Hardware/domain reference docs are **generated from `dna/domain/`** (the single source) — not hand-copied — so they cannot drift from the conformance-gated truth. Mapping: `memory-map.md`, `ula-timing.md`, `z80-opcodes.md`, `file-formats.md`, `tape-loading.md`, `peripherals.md`, `host-io-port-fe.md`, `machine-execution.md`; plus the product render/policy specs (`screen-render.md` + `palette.yaml`, `raster-border.md`, `keyboard-input.md`, `beeper-output.md`). [provenance: decision:ADR-0027]
- [id: KP-PROD-SOURCE-SKILLS-001] Agent skills + pedagogical content are **authored in `dna/product/`** (the teaching layer) and **cite** the generated reference; they are not domain truth — they are how-to-use-it knowledge. [provenance: decision:ADR-0027]
- [id: KP-PROD-SOURCE-RECIPES-001] Recipes are gated by the declarative test DSL (`recipes-and-assertions.md`): a recipe whose `test.json` fails is a red build, so the few-shot the skills cite is always green. [provenance: decision:ADR-0027]

## Packaging

- [id: KP-PROD-PKG-001] The pack is packaged as **native agent skills** (Claude Code `/skills`, Codex config) and installed by `zxs setup` (`cli.md` CLI-PROD-SETUP-001), so the moat is discoverable without first scaffolding a project. [provenance: decision:ADR-0027]

## Growth order (ADR-0027 D6)

- [id: KP-PROD-GROW-001] Knowledge grows in this order: (1) **scrolling + collision** systems FIRST — the blockers for real games beyond the paddle/pong class; (2) level/map data; (3) genre skills — maze/chase, flip-screen exploration, isometric; (4) a text-adventure starter. [provenance: decision:ADR-0027]
- [id: KP-PROD-GROW-002] Scope is **48K-only** (ADR-0027 D1): 128K + AY sound is explicitly OUT for v2 and recorded as a v3 candidate — never an unstated absence (C5). [provenance: decision:ADR-0027]

## Rules

- [id: KP-PROD-RULE-TRACE-001] Every reference claim traces to a `dna/domain` (or `dna/product` render) id, and every skill cites the reference it teaches; an orphan claim with no DNA source is a provenance failure, not shipped knowledge. [provenance: decision:ADR-0027]

## Degrees of freedom

- [id: KP-PROD-FREE-001] The prose, ordering, and pedagogical voice of skills/examples are Incidental; only the sourcing/traceability rule and the growth order are fixed. [provenance: decision:ADR-0001]

## Provenance

- The moat *contents* (skills/reference/recipes/examples/playbook) are `contract`
  — the oracle ships `docs/reference/` (13 docs) + `docs/agents/skills/` (13
  skills) into generated projects. The v2 *sourcing model* (generate reference
  from `dna/domain/`, author skills in `dna/product/`, gate recipes by the DSL),
  the native-skills packaging, the traceability rule, and the D6 growth order are
  `decision:ADR-0027` — **resolving the pending ADR-0005**. One row is
  `decision:ADR-0001` (Incidental). No `UNKNOWN`. Cross-references: `dna/domain/*`
  (reference source), `cli.md` (`setup`), `recipes-and-assertions.md` (the recipe
  gate), the scaffolding spec (W5; carries the playbook into projects).

## Acceptance criteria

- [id: KP-PROD-AC-TRACE-001] A regenerated knowledge pack MUST have every reference doc generated from a `dna/domain` (or product render) source — no hand-authored hardware claim — and every skill cite the reference it uses; a knowledge-trace check asserts there is no orphan reference claim. [provenance: decision:ADR-0027]
- [id: KP-PROD-AC-GROW-001] The first knowledge growth MUST be the **scrolling + collision** skills/recipes (D6 step 1), present and test-green, before any genre skill. [provenance: decision:ADR-0027]
