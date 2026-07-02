# Recipes & Declarative Assertions Product Surface

The declarative test/recipe DSL run by `zxs test` (`cli.md`) and `verify`'s test
stage (`toolkit-runtime.md`): a JSON spec that assembles a program, runs it under a
fixed budget with scheduled input, and asserts observable machine state. The core
schema + assertions were mined once from the oracle
(`packages/toolkit/src/cli/commands/test-cmd.ts` in the legacy oracle repo and `recipes/`)
and stay `contract`; the **v2 additions** (temporal/checkpoint assertions, memory
delta/range assertions, `screenDiff` visual regression, the Kempston `joy` input
schedule, and the dropped `coloredCells` alias) are `decision:ADR-0027`.

## Purpose

- [id: REC-PROD-SCOPE-001] The declarative test DSL lets a program's behavior be asserted from outside the machine — assemble, run, then check screen/memory/registers/audio — so tests are executable documentation that cannot rot. [provenance: contract]
- [id: REC-PROD-SCOPE-002] The assertion vocabulary mirrors the agent observation primitives (screen, mem, regs, audio), so the same checks an agent makes interactively can be frozen as a test. [provenance: contract]
- [id: REC-PROD-SCOPE-003] A "recipe" is an organizational unit (a `recipe.asm` reusable routine + a `demo.asm` + a `test.json`), not a separate DSL; the test spec is the recipe's executable proof. [provenance: contract]

## Public Behavior — test spec format

- [id: REC-PROD-SPEC-001] A test spec is a single JSON object in a `test.json` or `*.test.json` file (one spec per file, not an array). [provenance: contract]
- [id: REC-PROD-SPEC-002] `zxs test [path]` discovers spec files by recursively walking the path (default `.`), skipping `node_modules`, `.git`, `.zxs`, `build`, and `dist`. [provenance: contract]
- [id: REC-PROD-SPEC-003] The spec fields are: `build` (required — path to the `.asm` entry to assemble, relative to the spec file), `org` (optional load address, default `0x8000`), `frames` (optional frame budget, default `120`), `keys` (optional keyboard input schedule), `joy` (optional Kempston input schedule, v2), `detectHangs` (optional boolean, default `true`), and `assert` (required array of assertions). [provenance: contract]
- [id: REC-PROD-SPEC-004] The `keys` schedule uses the `"frame:KEY*hold,..."` form (default hold 3 frames; frame relative to run start), the same grammar as `zxs run --keys`. [provenance: contract]
- [id: REC-PROD-SPEC-005] The `joy` schedule uses the same `"frame:VALUE*hold,..."` grammar as `zxs run --joy`, where each `VALUE` is any subset of `UDLR` + `F` mapping to the active-high Kempston byte `000FUDLR` on port `0x1F` (peripherals.md `JOY-KEMPSTON-*`, W10.13). [provenance: decision:ADR-0027]

## Run semantics

- [id: REC-PROD-RUN-001] Each spec runs in isolation: assemble `build` to a temp output, boot a cached clean-ROM machine, load the binary at `org`, snapshot the screen hash, apply the `keys` plan, then run the machine. [provenance: contract]
- [id: REC-PROD-RUN-002] The run length is `max(frames ?? 120, planFrames)`, where `planFrames` is one past the last scheduled key event — so scheduled input always has time to play. [provenance: contract]
- [id: REC-PROD-RUN-003] A hang watchdog is attached unless `detectHangs: false`; a detected hang makes the run `status` `"hang"`. [provenance: contract]
- [id: REC-PROD-RUN-004] Assertions are evaluated against the post-run machine state (and, for `screenChanged`, the pre/post screen hash). [provenance: contract]
- [id: REC-PROD-RUN-005] For the v2 temporal/delta assertions the runner captures, in one run, the **start-of-run** state (referenced memory + screen) and **per-checkpoint** snapshots at each `at`-frame, so `at`/`memDelta` evaluate without re-running; an `at`-frame past the run length fails the assertion (no snapshot). [provenance: decision:ADR-0027]

## Assertion catalog

Each entry of `assert` is `{ type, ...params }`. Range assertions (`min?`/`max?`)
pass when the measured value is within the given bounds (an omitted bound is
unbounded). The full vocabulary:

- [id: ASSERT-PROD-STATUS-001] `status` `{ equals: "ok" | "hang" }` — the final run outcome (`"hang"` if the watchdog/CPU flagged a hang, else `"ok"`). [provenance: contract]
- [id: ASSERT-PROD-HALT-001] `haltSynced` `{ equals: boolean }` — whether the main loop aligned to the HALT/interrupt cadence (only meaningful when `detectHangs` is on). [provenance: contract]
- [id: ASSERT-PROD-SCREENINC-001] `screenIncludes` `{ text: string }` — passes if the ROM-font OCR of the screen contains `text` on some row. [provenance: contract]
- [id: ASSERT-PROD-CELLS-001] `cellsNonBlank` `{ min?, max? }` — count of 8×8 cells with ≥ 1 bitmap pixel set. [provenance: contract]
- [id: ASSERT-PROD-ATTR-001] `attrNonBlank` `{ min?, max? }` — count of attribute cells whose byte differs from the default `0x38`. (The legacy `coloredCells` alias is **dropped** in v2; use `attrNonBlank` — ADR-0027.) [provenance: contract]
- [id: ASSERT-PROD-SCRCHG-001] `screenChanged` `{ equals: boolean }` — whether the screen (bitmap + attributes) hash changed across the run. [provenance: contract]
- [id: ASSERT-PROD-MEM-001] `memEquals` `{ addr, hex }` — byte-for-byte compare of memory at `addr` against the whitespace-stripped `hex` (addr accepts `0x`/`$`/`h`/decimal forms). [provenance: contract]
- [id: ASSERT-PROD-REG-001] `regEquals` `{ reg, value }` — compares a register (`a,f,b,c,d,e,h,l,af,bc,de,hl,sp,pc,ix,iy,i,r,im`, case-insensitive) to a numeric or address-form `value`. [provenance: contract]
- [id: ASSERT-PROD-PIXEL-001] `pixelAt` `{ x, y, set }` — the bitmap pixel at `x` (0–255), `y` (0–191) is/!is set. [provenance: contract]
- [id: ASSERT-PROD-BORDER-001] `borderColor` `{ equals: 0..7 }` — the ULA border colour. [provenance: contract]
- [id: ASSERT-PROD-BEEPER-001] `beeperEdges` `{ min?, max? }` — count of port-`0xFE` bit-4 (speaker) edge transitions during the run. [provenance: contract]
- [id: ASSERT-PROD-PORTFE-001] `portFEWrites` `{ min?, max? }` — total writes to ULA port `0xFE` during the run. [provenance: contract]
- [id: ASSERT-PROD-AT-001] `at` `{ frame, assert: [...] }` — a **temporal/checkpoint** assertion: evaluates the nested `assert` array against the machine state captured at `frame` (relative to run start), so game logic can be asserted *over time* rather than only post-run. Nested `at` is not allowed (one level). [provenance: decision:ADR-0027]
- [id: ASSERT-PROD-MEMRANGE-001] `memInRange` `{ addr, size?: 1|2, min?, max? }` — the unsigned value at `addr` (1 byte default, or 2-byte little-endian when `size: 2`) is within `[min, max]` (e.g. "score in [10, 99]"). [provenance: decision:ADR-0027]
- [id: ASSERT-PROD-MEMDELTA-001] `memDelta` `{ addr, size?: 1|2, min?, max? }` — the **signed** change in the value at `addr` from start-of-run to end-of-run is within `[min, max]` (e.g. "score increased" → `min: 1`). [provenance: decision:ADR-0027]
- [id: ASSERT-PROD-SCREENDIFF-001] `screenDiff` `{ baseline, maxDiff?: 0 }` — **visual regression**: compares the post-run framebuffer against the golden PNG at `baseline` (path relative to the spec file) and passes when the difference metric (count of differing pixels) is `≤ maxDiff` (default `0` = exact). Mirrors `zxs screen --diff` (cli.md CLI-PROD-SCREEN-003); a missing baseline fails the assertion (regenerate with `screen --diff --update-baseline`). [provenance: decision:ADR-0027]
- [id: ASSERT-PROD-LIST-001] `zxs test --list-assertions` prints the assertion reference (`{ type, fields, description }` per entry; JSON under `--json`), including the v2 additions. [provenance: contract]

## Outputs

- [id: REC-PROD-REPORT-001] A spec result is `{ spec, ok, failures[] }`; `ok` is true iff every assertion passed, and each failure is a human-readable string naming the assertion and the expected-vs-actual mismatch. [provenance: contract]
- [id: REC-PROD-REPORT-002] The suite result is `{ ok, total, passed, failed, results[] }`; `ok` is true iff every spec passed. [provenance: contract]
- [id: REC-PROD-REPORT-003] `zxs test` exits `0` when the suite is green and `1` when any spec fails. [provenance: contract]

## Rules

- [id: REC-PROD-RULE-DET-001] Because each spec rebuilds, reboots, and reloads deterministically before running a fixed budget, a passing/failing verdict is reproducible — the basis for `conformance/cli/` snapshot fixtures. [provenance: contract]
- [id: REC-PROD-RULE-BUILDFAIL-001] If `build` fails to assemble, the spec fails with the build diagnostics (no assertions are evaluated). [provenance: contract]

## Edge cases

- [id: REC-PROD-EDGE-001] A spec with no `keys` runs the bare `frames` budget; a spec whose key plan extends past `frames` runs to the end of the plan. [provenance: contract]
- [id: REC-PROD-EDGE-002] `haltSynced` is unasserted/meaningless when `detectHangs: false`. [provenance: contract]

## Degrees of freedom

- [id: REC-PROD-FREE-001] Failure-message wording and the text-mode (non-`--json`) layout (✓/✗ markers, indentation) are Incidental — only the JSON report shape and pass/fail verdict are contract. [provenance: decision:ADR-0001]
- [id: REC-PROD-FREE-002] The contents and naming of the shipped `recipes/` library are product assets, specified for scaffolding/starters elsewhere, not fixed by this DSL spec. [provenance: decision:ADR-0001]

## Provenance

- The CORE schema + assertions are `contract`, mined once from the oracle test
  runner (`src/cli/commands/test-cmd.ts`: the `TestSpec`/`Assertion` types, the
  evaluation logic, `ASSERTION_REFERENCE`) and the `recipes/` layout. The v2
  additions — the `joy` input schedule, the temporal `at` / `memInRange` /
  `memDelta` / `screenDiff` assertions, the start/checkpoint capture, and the
  dropped `coloredCells` alias — are `decision:ADR-0027` (additions citing
  `peripherals.md` for Kempston and `cli.md` for `screen --diff`). Two rows are
  `decision:ADR-0001` (Incidental). No `UNKNOWN`. Cross-references: `cli.md`
  (`zxs test`), `toolkit-runtime.md` (the run loop these assertions read).

## Examples

```json
{
  "build": "demo.asm",
  "frames": 60,
  "assert": [
    { "type": "status", "equals": "ok" },
    { "type": "haltSynced", "equals": true },
    { "type": "cellsNonBlank", "max": 0 },
    { "type": "memEquals", "addr": "0x5800", "hex": "28" }
  ]
}
```

```json
{
  "build": "../src/main.asm",
  "frames": 60,
  "assert": [
    { "type": "screenIncludes", "text": "SCORE 000010" },
    { "type": "pixelAt", "x": 148, "y": 59, "set": true },
    { "type": "beeperEdges", "min": 1 }
  ]
}
```

```json
{
  "build": "../src/main.asm",
  "frames": 200,
  "joy": "0:R*120,120:RF*20",
  "assert": [
    { "type": "memDelta", "addr": "0x6000", "size": 2, "min": 1 },
    { "type": "memInRange", "addr": "player_lives", "min": 1, "max": 3 },
    { "type": "at", "frame": 100, "assert": [
      { "type": "pixelAt", "x": 200, "y": 96, "set": true }
    ] },
    { "type": "screenDiff", "baseline": "golden/level1.png", "maxDiff": 0 }
  ]
}
```

## Acceptance criteria

- [id: REC-PROD-AC-BEEPER-001] The `beeperEdges` assertion (ASSERT-PROD-BEEPER-001) reading an integer edge count is the spec-level expression of coverage row `RUN-BEEPER-001`; a `conformance/cli/` test fixture asserts a known program's edge count. [provenance: contract]
- [id: REC-PROD-AC-EXIT-001] `zxs test` exiting `0`/`1` on suite pass/fail (REC-PROD-REPORT-003) is the contract a `conformance/cli/` snapshot relies on; it is the same exit discipline `verify` composes. [provenance: contract]
- [id: REC-PROD-AC-VOCAB-001] A regenerated `zxs test` MUST implement exactly the **16** assertion types above with these parameter shapes and semantics: the 12 core types (`status`, `haltSynced`, `screenIncludes`, `cellsNonBlank`, `attrNonBlank`, `screenChanged`, `memEquals`, `regEquals`, `pixelAt`, `borderColor`, `beeperEdges`, `portFEWrites`) plus the four v2 additions (`at`, `memInRange`, `memDelta`, `screenDiff`). The `coloredCells` alias is **not** implemented (dropped in v2). [provenance: decision:ADR-0027]
