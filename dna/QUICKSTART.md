# DNA Quickstart — regenerate a product from `dna/`

This genome is **self-contained and its own judge**: an implementation is correct
**iff** it passes `dna/conformance/`. This guide is the consumer-facing "how to run
it" — copy `dna/`, write the implementation, prompt an agent, and verify against the
gate. The normative detail lives in the per-area specs; this file does not restate
them.

> Honest scope: only the **emulator** is regenerable end-to-end today. The matrix
> says exactly what is ready. A recipe appears here only once its conformance can
> actually prove it.

## Readiness matrix

| Product | DNA state | Conformance | Quickstart recipe |
| --- | --- | --- | --- |
| **Emulator** (`cpu`+`ula`+`machine`) | authored + **regenerated twice, green** | emulator rows all covered | **✅ below** |
| Assembler (`asm`) | authored, **parked** (ADR-0008) | assembler rows covered | partial — DNA ready, recipe TBD |
| Toolkit (`zxs`/`zxs-mcp`) | specs authored (W4) | **uncovered**, no runner yet | ⏳ after R-W4-05 |
| Scaffolding / Gallery | pending (W5) | uncovered | ⏳ after W5 |

Live truth, not this table: `node dna/conformance/coverage-check.mjs --by-area`.

## Recipe — regenerate the emulator

**The DNA is an executable spec + a judge, not a prebuilt emulator.** You (or an
agent) write three packages; `dna/conformance/` decides if they are correct. The
conformance runners drive your code by **dynamically importing fixed module paths**,
so your implementation must live where they look (or be passed via `--module`).

### 1. Lay out a fresh repo

```
your-repo/
  dna/                         # copied whole — the genome + the conformance judge
  package.json                 # minimal, below (Node>=20, ESM, 0 deps)
  packages/                    # YOU create these; the runners import them
    cpu/src/z80-step.mjs
    ula/src/index.mjs
    machine/src/index.mjs
```

Copy `dna/` whole (it is self-contained — no network, the FUSE suite is committed
JSON, runners use only `node:` builtins). Do **not** copy `AGENTS.md`,
`specs-plan.md`, or `.harness/` — those are factory scaffolding, not the DNA. (The
exact core-vs-emulator file split is in `.harness/migration-w7.md` if you want to
slim `dna/`; copying it whole needs nothing else.)

### 2. The import surface the runners expect (this is the contract)

Each conformance runner has a default module path and rejects a missing/wrong module
with **exit 2** — so the gate genuinely fails if your code is absent or mis-shaped:

| Runner | Imports (default `--module`) | Your module must export |
| --- | --- | --- |
| `cpu/run-fuse-suite.mjs` + `cpu/run-cpu-exec-fixtures.mjs` | `packages/cpu/src/z80-step.mjs` | `step({ registers, memory })` → next CPU state |
| `timing/run-timing-fixtures.mjs` | `packages/ula/src/index.mjs` | the ULA timing API the runner invokes |
| `machine/run-machine-fixtures.mjs` | `packages/machine/src/index.mjs` | the integrated 48K machine API the runner invokes |
| `formats/run-format-fixtures.mjs` | `packages/machine/src/index.mjs` | the `.z80` read/write API the runner invokes |

The runner **source is the precise contract** — open the one you are implementing
against; its argument parsing and the calls it makes define the exact surface (the
DNA documents the surface in the runner, so there is nothing to guess). Any path
can be overridden with `--module <path>`.

### 3. Minimal `package.json` (ESM, Node ≥ 20, no deps)

```json
{
  "name": "emu-regen", "private": true, "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "conformance:emulator": "node dna/conformance/cpu/run-cpu-exec-fixtures-self-test.mjs && node dna/conformance/cpu/run-fuse-suite.mjs --quiet && node dna/conformance/timing/run-timing-fixtures.mjs --quiet && node dna/conformance/machine/run-machine-fixtures.mjs --quiet && node dna/conformance/formats/run-format-fixtures.mjs --quiet",
    "coverage:emulator": "node dna/conformance/coverage-check.mjs --area emulator"
  }
}
```

(`run-*-fixtures-self-test.mjs` validate the fixtures against an independent
reference; the non-self-test runners above test **your** packages. The full gate,
incl. all self-tests + the zexdoc/zexall belt, is `conformance:check:emulator` in
the source repo.)

### 4. Prompt the agent (implementer role — reads `dna/` only)

> The DNA in `dna/` is the source of truth. Implement `packages/cpu`, `packages/ula`,
> and `packages/machine` (a Z80 core, ULA timing, and the integrated 48K), **deriving
> the structure from the DNA invariants, not from any existing code**. Your code is
> correct **iff** it passes `dna/conformance/`. The runners
> `dna/conformance/{cpu,timing,machine,formats}/run-*-fixtures.mjs` dynamically import
> `packages/cpu/src/z80-step.mjs` (exporting `step({registers,memory})`),
> `packages/ula/src/index.mjs`, and `packages/machine/src/index.mjs` — read each
> runner for the exact API it calls and satisfy it. On any ambiguity, **stop and
> record the gap — do not guess.**

Authority the agent reads: `dna/domain/{z80-cpu-execution, ula-timing,
machine-execution, snapshot-z80, z80-opcodes}.md` + `z80-opcodes.yaml`.

### 5. Verify — iterate until green

```bash
npm run conformance:emulator
npm run coverage:emulator        # expect: Coverage: 23/23 contract+fidelity rows covered [emulator]
```

The self-tests reject a wrong reference, and the runners exit 2 on a missing/wrong
module — so green means a faithful implementation, not merely "it ran". Two
independent blind regenerations already agreed: the acid-test of independence
(`specs-plan.md` §9) passing for real.

### 6. (Optional) deep fidelity

zexdoc/zexall + FUSE timing against external references run your CPU through the
`external-suites:*` payloads (registry in `dna/conformance/external/*.manifest.json`
+ a cache). Not required for a working, conformant emulator — it is the extra belt.

## Keeping this honest

`dna/conformance/quickstart-self-test.mjs` checks that every path and script this
guide names actually exists (the emulator module paths, the runner files, the
referenced scripts), so the recipe cannot rot silently. New recipes are added here
only when their product's conformance can prove them.
