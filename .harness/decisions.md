# Decisions (ADR) and provenance log

Accepted decisions and the `UNKNOWN` backlog. Each shipped behavior must trace to
an external authority or to a decision recorded here (constraint C5).

## Provenance enumeration

`hardware` | `z80-spec` | `zexall` | `zexdoc` | `fuse` | `contract` | `manual` |
`decision:<id>` | `UNKNOWN`

Every `UNKNOWN` must be resolved before its package is cut over, to one of:
**ratify** (→ `decision:<id>`), **re-derive** (find external authority), or
**redesign** (intentionally change).

## Method notes

### Method calibration — scale rigor to slice risk (2026-06-29, user-ratified)

The ratified method (read `dna/` only → spec → fixture → blind regeneration →
conformance; never fabricate, `UNKNOWN` over a guess) is the project's core and is
unchanged. What is calibrated is the **amount of verification machinery per slice**,
which must scale with the *plausibility of misinterpreting the spec*, not be applied at
maximum to every slice. This was prompted by W10.4 (`.scr`), where a raw memcpy of a
fixed region got a dedicated runner + a four-model adversarial self-test (incl. a
reconstructed de-interleave) + two blind regenerations — scaffolding heavier than the
truth it proves.

- **Trivial tier** (mechanical, near-impossible to misread — e.g. `.scr` raw copy,
  power-on/reset register table, a format index): spec + **one** fixture + a minimal
  self-test that proves the row isn't trivially-passing, then commit. **Skip** the
  double-blind-regen and the multi-model adversarial battery.
- **Fidelity tier** (genuine ambiguity where a competent implementer would plausibly
  diverge — e.g. tape→EAR pulse timing, I/O-port contention, floating bus, or any slice
  carrying a flagged method call): keep the full machinery — two blind regenerations +
  adversarial broken models.

C5 (no silent debt) is unaffected: every behavior still traces to authority or a recorded
decision regardless of tier. W10.4 was completed at full rigor before this call and stays
as-is; the lighter bar starts at W10.5.

## Accepted decisions

### ADR-0001 — DNA is the source of truth; conformance suite decides
The versioned, reviewed artifact is the DNA (`dna/`). An implementation is
correct iff it passes `dna/conformance/`. The legacy code is an oracle, not an
authority.

### ADR-0002 — Oracle for the Fidelity tier is documented hardware, not the old code
For emulator hardware accuracy and assembler emitted bytes, the oracle is the Z80
ISA / ULA timing / zexall-zexdoc / FUSE, captured into `dna/domain/`. The legacy
emulator is a derivative that may contain bugs. Where legacy ≠ external truth,
external truth wins. This is what lets timing (e.g. the legacy display-latch /
interrupt behavior) be redesigned instead of fossilized.

### ADR-0003 — Two-worktree layout; DNA harness tracked
Oracle/mine = `../zx-vibes` on `main` (keeps its legacy modification harness).
Factory = this worktree on `reconstruction`. The DNA and its harness are tracked
in git here because the DNA is now the product and must be versioned and shared.
`reconstruction` is long-lived; package cutovers merge to `main` to preserve C1.

### ADR-0004 — Domain reference is self-contained; legacy code is a curation cross-check
`dna/domain/` is a complete normative technical reference written by us; external
sources appear only as `provenance`, never as a runtime dependency (C2). The
legacy code is mined as a secondary source to locate resolved hardware
ambiguities, which become decisions or `UNKNOWN`s.

### ADR-0005 — RESOLVED (2026-06-30, by ADR-0027 + `dna/product/knowledge-pack.md`): reference docs + agent skills
The oracle ships `docs/reference/` (13 docs) and `docs/agents/skills/` (13 skills)
into generated projects. Much of the reference content (memory-map, timing,
rom-routines, ...) is domain knowledge rendered for agents. **Proposal (now
adopted):** generate the hardware/domain reference docs **from `dna/domain/`**
(single source) and author agent skills + pedagogical content in `dna/product/`.
**Resolution:** ratified as part of ADR-0027 (toolkit v2) and pinned by the new
product spec `dna/product/knowledge-pack.md` (Phase 0.6) — the sourcing model
(`KP-PROD-SOURCE-*`), native-skills packaging (`KP-PROD-PKG-001`), the
traceability rule (`KP-PROD-RULE-TRACE-001`), and the D6 growth order (scrolling +
collision first, `KP-PROD-GROW-001`). The W5 (scaffolding/gallery) cutover is no
longer blocked on this decision.

### ADR-0006 — CPU zex fidelity rows require a portable passing reference run
`CPU-ZEXDOC-001` and `CPU-ZEXALL-001` may move to `covered` only after the
verified zexdoc/zexall payloads run to completion and report pass through an
independent CPU reference that is reproducible from the repository or an
explicitly documented toolchain dependency. Machine-local binaries, the current
project emulator, candidates that fail any zex group, or bounded runs that stop
before `Tests complete` are not acceptable coverage evidence.

R-W0-05f is therefore blocked as of 2026-06-27. Candidate probes found that the
local CP/M monitor can execute zex-style COM programs but is not independent;
`z80-emulator@2.3.0` completed zexdoc but reported a failing `ld
<bcdexya>,<bcdexya>` group; `@dcorp80/z80cpu@0.1.3` is independent and current
but did not complete a practical full-suite run within the tested bounds; and
the installed `z88dk-ticks.exe` can run a patched CP/M image but is a
machine-local binary, not a portable gate. The fidelity rows remain uncovered
until this decision's acceptance bar is met.

**Update (2026-06-28) — the independent reference now exists; acceptance run is
offline.** With the regenerated `@zx-vibes/cpu` complete (whole FUSE single-step +
multi-instruction ISA, ADR-0009), it is a valid independent, repository-
reproducible CPU reference for this gate — not the legacy emulator, not a
machine-local binary. `dna/conformance/cpu/zex-cpm-cpu-adapter.mjs` wraps it in
the same minimal CP/M monitor as the legacy `zex-cpm-adapter.mjs` (load COM at
0x100, trap BDOS 9/2 at 0x0005, warm boot at 0x0000) and speaks the
external-adapter protocol, so `run-zex.mjs` can drive it
(`pnpm external-suites:zex-reference`). A fast synthetic-COM self-test
(`zex-cpm-cpu-adapter-self-test.mjs`) is wired into `conformance:check`; a bounded
zexdoc probe confirms correctness — the first groups print `OK` (CRC match):
`<adc,sbc> hl,<...>`, `add hl,<...>`, `add ix,<...>`, `add iy,<...>`.

The legacy `zex-cpm-adapter.mjs` (backed by `packages/emulator`) is now superseded
by `zex-cpm-cpu-adapter.mjs` and is the last conformance file importing legacy
emulator code. It is kept green only by its own self-test and **retires together with
`packages/emulator` at Phase 5** (`handoff.md` §NEXT.4) — not migrated in the W7 split.

The remaining blocker is **performance, not correctness or independence**: this
pure-JS, per-instruction reference runs ≈7M instructions/s, so a COMPLETE zexdoc
or zexall run (billions of T-states) takes on the order of 15–30 min each — fine
as an **offline acceptance run**, unacceptable as a CI gate. Therefore the gate
carries only the fast harness self-test; the acceptance bar (a complete run that
reaches `Tests complete` with no `ERROR`) is met by an offline run of
`zex-cpm-cpu-adapter.mjs` over the pinned payload. `CPU-ZEXDOC-001` /
`CPU-ZEXALL-001` flip to `covered` only when such a complete passing run is
recorded here; until then they stay uncovered.

**Acceptance run — zexdoc PASSED (2026-06-28).** A complete offline run of the
pinned zexdoc payload through `zex-cpm-cpu-adapter.mjs` (@zx-vibes/cpu) reached
`Tests complete` with **all 67 groups `OK`, 0 `ERROR`** (5,764,169,474
instructions, ~885 s at ~6.5M inst/s). The acceptance bar is met for the
documented-flag suite: **`CPU-ZEXDOC-001` → covered.** Reproduce with
`node "$TEMP/zex-full.mjs"`-style driver, or
`pnpm external-suites:zex-reference --suite zexdoc --max-instructions <large>`
(allow ~15 min). zexall (undocumented flags) result is tracked separately below.

**Acceptance run — zexall PASSED (2026-06-28).** A complete offline run of the
pinned zexall payload through the same reference reached `Tests complete` with
**all 67 groups `OK`, 0 `ERROR`** (5,764,169,474 instructions, ~875 s). This
validates the **undocumented** flag behavior (the `5`/`3` bits) end-to-end:
**`CPU-ZEXALL-001` → covered.** With ADR-0009 (whole FUSE ISA) and both zex
exercisers now passing through the regenerated `@zx-vibes/cpu`, the CPU-execution
fidelity is fully met by an independent, repository-reproducible reference; the
ADR-0006 block is lifted. (As noted in ADR-0009, the Patrik-Rak PC-derived 5/3
*repeat* correction is still unmodeled, but zex CRCs only the final post-repeat
state, where the per-iteration flags this CPU computes are correct — hence the
clean pass.)

### ADR-0007 — Compressed, data-driven opcode table parsed as real YAML
The `z80-opcodes.yaml` domain table is authored in a compressed schema and parsed
with a real YAML library; its conformance validator is data-driven. Three parts:

- **(a) Compressed schema + defaults.** Each encoding is one terse row carrying
  only what conformance proves: `syntax`, `bytes`, timing (`t`/`m`, or
  `[taken, notTaken]` for conditional forms), `conformance` ids, and a `flags`
  clause **only** on the rows that change condition bits. The loader's
  `normalizeTable` is the single point that derives the rest: `lengthBytes` from
  the byte count, default "no flags changed" (all eight unchanged), the
  hex-string→`value`/`hex` byte split, `caseInsensitive`/`provenance` file
  defaults, conditional-timing expansion, and family-row template substitution.
  Operand metadata removed from the table (roles, kinds, `widthBits`,
  `cycleBreakdown`, `opcodePattern`, `operation`, the `value`+`hex` duplication)
  now lives in the `z80-opcodes.md` prose per family; re-add to the table only
  when a real consumer needs it. Measured effect on this 139-row slice:
  **11,180 → 365 lines (~30.6×)**, encodings unchanged (201 of them verified
  byte-for-byte identical to the verbose table).

- **(b) Real YAML via `js-yaml`.** This **reverts** the earlier "JSON-compatible
  YAML so tooling parses it without a YAML dependency" note. `js-yaml@4.2.0` (the
  version already pinned in `pnpm.overrides`) is now a declared `devDependency`,
  and `z80-opcodes-check.mjs` parses with `yaml.load` instead of `JSON.parse`.
  The table can use comments and terse flow syntax. `js-yaml` is the only added
  parser; the other DNA tooling keeps its hand-rolled parsers.

- **(c) Data-driven validator.** The ~45 bespoke per-family validators collapsed
  into one generic checker over the normalized rows: it validates structural
  integrity (unique ids, byte structure, derived length, timing shape, the
  eight-flag partition, conformance references, provenance) plus two minimal
  special cases — the `LD (HL)` `0x76`/HALT exclusion and conditional timing.
  The exact opcode/immediate byte **values** are no longer re-asserted here
  against a hand-kept oracle; they are witnessed externally by the `ASM-EMIT-*`
  assembler fixtures (source → bytes), which is the conformance net the
  compression deliberately leans on (C3).

The opcode-space split (`base/cb/ed/dd/fd/ddcb/fdcb`) and re-anchoring every
self-validated detail to an external fixture remain follow-ups, not part of this
decision.

### ADR-0008 — Reserved lowercase slot-token grammar in the opcode table (pilot finding F-1)
A pilot differential regeneration of the opcode encoder — two blind readers of `dna/`,
417 boundary cases over all 201 encodings (see `pilot/REPORT.md`) — found exactly one
real DNA gap. Agreement was 94.72% with **zero** table bugs and zero
byte-order/sign/row-selection gaps; the entire non-agreement (22 cases) traced to a
single root cause.

- **Gap.** The table's parameter slots are the lowercase tokens `n`, `nn`
  (`nn-low`/`nn-high`), `e`, distinguished from register identifiers only by case —
  yet `z80-opcodes.yaml` sets `defaults.caseInsensitive: true`, and neither the YAML
  nor `z80-opcodes.md` states that slot-token recognition is case-sensitive. The only
  Z80 register that collides is `E` ↔ `e`.
- **Divergence.** Regen-A applied case-insensitivity uniformly and mis-read the
  register `E` as the relative-displacement slot, dropping every register-`E` form
  (`LD E,*`, `LD *,E`, `OUT (C),E`, `IN E,(C)`, `LD E,(HL)`, `LD (HL),E`). Regen-B
  detected slot tokens case-sensitively and matched the table. The legacy assembler
  oracle confirms regen-B / the table (e.g. `LD B,E` → `0x43`, `OUT (C),E` → `0xED 0x59`).

**Decision (provenance: z80-spec).** The lowercase tokens `n`/`nn`/`e` are a reserved
slot grammar, distinct from register names; `caseInsensitive` governs user-facing
mnemonics/operands, not slot-token recognition (which is case-sensitive).

**Resolution — fix applied** (uncommitted, for review):
1. **Prose (done).** `dna/domain/z80-opcodes.md` now documents the reserved
   lowercase slot-token grammar as a tracked claim `[id: Z80-OPC-SLOT-TOKENS-001]`
   (provenance `z80-spec`) and in the authoring section: `n`/`nn`/`e` are
   case-sensitive slots distinct from register names; `caseInsensitive` governs
   user-facing spelling only.
2. **Gate-level pin (done).** `dna/conformance/domain/z80-opcodes-check.mjs` gained
   `validateSlotGrammar`, which cross-checks every row's canonical-syntax slots
   (recognized **case-sensitively**) against its byte-template parameters, with a
   matching negative case in the domain self-test. A table consumer that folds
   `E`→`e` is now provably inconsistent with the gated grammar. (A plain assembler
   fixture cannot catch this — the gate runs the shipped assembler, not a
   regeneration — and the register-`E` byte values are already witnessed by
   `assembler/ld-register-register.json`.)
3. (Not taken) wrapping slot tokens as `<n>`/`<nn>`/`<e>` remains a stronger
   schema option if the prose + gate pin ever prove insufficient.

`pnpm run conformance:check` stays green after the fix.

This is a **regeneration-only** hazard: the shipped assembler and the table encode
register `E` correctly, so no `coverage.yaml` row is currently failing and none is
downgraded to `partial`. The gap is in the DNA's self-description and applies to all
families, including the ~465 unwritten encodings.

**Pilot go/no-go.** Fix F-1 (cheap; applies to all families), then NO-GO on the
full-table grind as a de-risking exercise — the assembler DNA is low-ambiguity — and
pivot regeneration effort to the emulator (the high-value slice, `specs-plan.md`
Phase 4 #3). Full rationale in `pilot/REPORT.md`.

### ADR-0009 — CPU regeneration hardening: FUSE-as-oracle and the first CPU DNA gaps

The emulator pivot scaled the ADR-0008 differential method to the CPU. Two devices:

- **FUSE as the whole-ISA oracle (provenance `fuse`).** `dna/conformance/cpu/build-fuse-fixtures.mjs`
  (an authoring tool, not gated) transcribes the hash-pinned FUSE z80 suite
  (`tests.in`/`tests.expected`) into per-opcode CPU-step fixtures under
  `dna/conformance/cpu/fuse/{base,cb,ed,dd,fd,ddcb,fdcb}.json`: input state → output
  registers + T-states + memory deltas. This is legitimate fidelity coverage and is
  **not** blocked by ADR-0006 (which gates only the full zexdoc/zexall ROM runs).
  Excluded and logged, never silent (each is a tracked follow-up, not coverage):
  - **Multi-instruction / run-to-budget (23 cases):** FUSE `<tstates>` budget > one
    instruction, so the case executes several instructions (`DJNZ` looping, the
    `LDIR`/`CPIR`-family block ops `edb*`, extended-NOP timing `dd00`/`ddfd00`). These
    need a run-to-N-T-states execution contract the single-step runner does not model.
  - **MEMPTR/WZ:** originally not asserted (the G-2 relaxation). **Lifted
    2026-06-29 (ADR-0020 / R-W9-04):** the full WZ-output rules are now modeled and
    MEMPTR is asserted on output across all FUSE cases. See gap G-2 below.
  In-scope single-step cases: **1284** (base 283, cb 269, ed 50, dd 85, fd 85,
  ddcb 256, fdcb 256).

- **Differential regeneration (workflow `cpu-fuse-regen`).** Per opcode group, two
  blind implementers wrote a `step({registers,memory})` from `dna/` only (no legacy
  emulator), iterating against that group's FUSE fixture; a diff agent then compared
  them. The run was cut off by a session limit after `fd`, `ddcb`, `fdcb` (and partial
  `cb`, `base`); `ed` and `dd` did not run.

**Result (re-verified locally by exit code, not agent self-report):**

| group | outcome |
| --- | --- |
| `fd` (85), `ddcb` (256), `fdcb` (256) | **two blind regens, both green, 100% identical output, no hardcoding** → DNA proven sufficient for these 597 cases |
| `cb` (269) | both blind regens fail the **same 4 cases** (`cb46_*`) identically → gap G-1 |
| `base` (283) | one regen reached 282/283, failing only `27_*` (`DAA`) → gap G-2's sibling, gap G-3 |
| `ed` (50), `dd` (85) | not run (session limit) |

**DNA gaps recorded (provenance to author: `z80-spec` corroborated by `fuse`):**

- **G-1 `UNKNOWN:emulator:CPU-FUSE-CB-001` — `BIT n,(HL)` undocumented flags 5/3.**
  Both independent regens produce `F` with only `H` set; FUSE expects bits 5/3 too
  (`0x38/0x18/0x30`). Per the FUSE README the 5/3 bits of `BIT n,(HL)` are copied from
  **MEMPTR/WZ-high**. `BIT y,(IX+d)`/`(IY+d)` pass because there 5/3 come from the
  effective-address high byte the impls already compute; plain `(HL)` needs the **WZ
  register modeled**. To resolve: author the WZ register + the `BIT n,(HL)` 5/3 rule in
  `z80-cpu-execution.md`; the impl must track WZ.
- **G-2 — WZ/MEMPTR output was a fixture relaxation. RESOLVED 2026-06-29 (ADR-0020 /
  R-W9-04).** The general WZ semantics were unspecified in the DNA and unasserted by the
  fixtures (G-1 was the first place it bit, via the BIT-(HL) 5/3 input). Now the full
  per-instruction WZ-output rules are authored (`Z80-EXEC-WZ-UPDATE-*`) and MEMPTR is
  asserted on output across the whole FUSE ISA; the relaxation is lifted.
- **G-3 `UNKNOWN:emulator:CPU-FLAG-DAA-001` — `DAA` semantics unauthored.** The regen
  guessed `DAA` wrong (`27_*`); the DNA has a seed coverage row but no execution rule.
  Author the DAA table/algorithm (S Z H P/V C + 5/3) in `z80-cpu-execution.md`.

These three are tracked in the UNKNOWN backlog below. No coverage row is downgraded:
the `CPU-FUSE-*` rows are `uncovered` (awaiting a regenerated step in the gate), so the
gaps block their move to `covered`, exactly as intended (C3/C5).

**Method note.** This validates the FUSE-differential loop end to end: where two blind
regens agree green, the DNA is sufficient; where they agree-fail, the DNA has a precise,
located gap. Throwaway regen modules live in the session scratchpad (`cpu-regen/`), out
of the gate, as in ADR-0008.

**Round 2 + completion (all 7 groups regenerate green).** After authoring the G-1/G-3
DNA (BIT-(HL)/WZ and DAA) a second workflow round confirmed, re-verified locally by
exit code:
- `base` 283/283 and `cb` 269/269 — **two blind regens each, both green** → confirms the
  authored DAA (G-3) and BIT-(HL)/WZ (G-1) DNA is sufficient.
- `dd` 85/85 — two blind regens, both green.
- `ed` 50/50 — authored **directly** (not via subagent: ADC/SBC HL, NEG, RETN/RETI, IM,
  LD I/R/A, RRD/RLD, LDI/CPI/LDD/CPD), passed first run. A single clean decoder, no
  hardcoding.
Combined with round 1 (`fd`/`ddcb`/`fdcb`), **all 7 groups pass, 1284/1284 in-scope
single-step cases**; 6 of 7 groups by independent double-blind regeneration.

**Generator bug fixed during round 2 (FUSE state I/R are hex).** The FUSE state line
`I R IFF1 IFF2 IM <halted> <tstates>` has **hex** `I`/`R` but `build-fuse-fixtures.mjs`
parsed the whole line base-10, silently corrupting `I`/`R` whenever they held a hex digit
(`"1e" → 1`). It was self-consistent for most cases (input and expected corrupted alike)
but genuinely broke `LD A,I`/`LD A,R` (`ed57`/`ed5f`), where `I`/`R` flows into `A` and is
compared against a correctly-parsed `A`. Fixed (`parseState`: `I`/`R` hex, `tstates`
decimal); fixtures regenerated; the 6 already-green groups stay green (the bug never bit
them — their `R` stays ≤ 0x09). This is exactly the kind of silent fault the FUSE-oracle
approach surfaces. The two LD A,I/R cases are now correct.

**Status:** de-risking complete — the DNA provably regenerates the whole single-step ISA.

**Cutover done (Phase 4 for the CPU single-step slice).** Rather than enshrine the six
blind-agent modules, a single coherent decoder was authored at
`packages/cpu/src/z80-step.mjs` (`@zx-vibes/cpu`): one octal (x/y/z) decode with shared
ALU/flag/rotate helpers and an index-mode (DD/FD) path — not a per-opcode table, not a
collage. It passes **all 1294 committed cpu-step cases** (1284 FUSE groups + the 10 INC r
boundary cases). `dna/conformance/cpu/run-fuse-suite.mjs` runs it over `conformance/cpu/`
and is wired into `conformance:check`; the 7 `CPU-FUSE-*` rows and `CPU-EXEC-INC-R-001`
are now `covered` (coverage 78/87). Authoring it surfaced more real bugs the FUSE oracle
caught (all in our new code, none in FUSE): the `x=0,z=2` indirect-load mapping, the R
refresh double-count for CB, R-register live-increment ordering for `LD A,R`/`LD R,A`,
`EXX` wrongly swapping AF, the `(IX+d)` displacement/operand fetch order, the index-half
vs (IX+d) operand rule, and the `SCF`/`CCF` undocumented 5/3 bits coming from `A | F`
(not `A` alone). Legacy `packages/emulator` was not read (implementer isolation) and is
not yet deleted (Phase 5).

**Honest scope note (the prose-vs-oracle point).** `dna/domain/z80-cpu-execution.md`
documents only the families that needed disambiguation (INC r, BIT/WZ, DAA); the rest of
the single-step ISA is pinned by the FUSE fixtures (provenance `fuse`), the conformance
decider per ADR-0001 — the same "fixtures witness, prose covers the corners" stance as
ADR-0007(c) for the assembler. The Z80 is a fixed public standard, so this leans on the
oracle by design; it is NOT a self-contained prose reference for every instruction, and
FUSE (~1 case/opcode) under-determines untested operand ranges. Fuller fidelity (operand
sweeps, zexdoc/zexall) remains blocked by ADR-0006.

**Port I/O + HALT slice (extends the cutover).** The step contract gained an `io`
interface (`io.read(port)` / `io.write(port, value)`); the generator now emits port
fixtures from the FUSE `PR`/`PW` events (a read returns the port-address high byte per the
FUSE convention; writes are asserted), and the runner records/compares them. `@zx-vibes/cpu`
now implements `OUT (n),A`, `IN A,(n)`, `IN r,(C)`/`OUT (C),r`, the single block I/O
`INI/OUTI/IND/OUTD` (Patrik-Rak undocumented flags: `N=data>>7`; `k=data+((C±1)&0xff)` for
INI/IND or `data + L`-after-update for OUTI/OUTD; `H=C=k>0xff`; `P/V=parity((k&7)^B)`;
`S Z 5 3` from B — derived from FUSE `eda2`/`eda3_01`), and `HALT` (PC stays on the
instruction). The fixtures grew to **1343 in-scope cases** (base 293, cb 269, ed 89, dd 85,
fd 85, ddcb 256, fdcb 256); **only the 23 repeating multi-instruction block ops remain
excluded** (run-to-budget contract, still a follow-up). `conformance:check` green.

**Run-to-budget slice (closes the last 23 cases).** FUSE's per-test `<tstates>` field is a
**run budget**: the harness executes whole opcodes while `tstates < budget` (a normal test
has budget `1`, so exactly one opcode runs; 23 tests carry budget > 1 and run several). A
new fixture kind `cpu-run` carries that budget; the runner loops `step()` until the
accumulated T-states reach it, threading the same registers/memory/io across iterations —
the faithful mirror of FUSE's `while (tstates < budget) z80_do_opcode()`. `step()` gained:
(a) the eight **repeating block ops** `LDIR/LDDR/CPIR/CPDR/INIR/INDR/OTIR/OTDR` as ONE
iteration each that rewinds `PC` by 2 and reports 21 T when it must repeat (16 T when it
completes), so the budget driver reproduces the full loop including the `R += 2`/iteration
re-fetch; and (b) correct **prefix NONI timing** — a redundant `DD`/`FD` (one not selecting
an index half or `(IX+d)`) costs +4 T (`t4`), and a prefix immediately followed by another
prefix/`ED` is a 4 T NONI that abandons itself and re-fetches the next byte (so its `R` is
counted once). The generator now routes budget cases to `conformance/cpu/fuse-budget/{base,
dd,ed}.json` instead of excluding them. Key finding: **this FUSE suite predates Patrik-Rak's
PC-derived 5/3 repeat correction** — all six mid-repeat cut-off cases (`edb1_2`/`edb2_1`/
`edb3_1`/`edb9_2`/`edba_1`/`edbb_1`) match the *per-iteration* (non-repeating) flags exactly
(verified by recomputation against the recorded port data), so no PC-based 5/3 override is
needed. `@zx-vibes/cpu` passes all **1366** cpu cases (1333 single-step + 23 run-to-budget +
10 INC r); three `CPU-FUSE-BUDGET-*` rows covered (coverage **81/90**). `conformance:check`
green.

### ADR-0010 — ULA timing as a pure model; contention pinned to canonical early-timing

**Status:** accepted.

The first machine-level timing slice (`TIM-FRAME-001`, `TIM-CONTENTION-001`) is authored as
a **pure timing model** — deterministic functions of a frame T-state and a memory address —
not as a CPU-coupled machine. DNA: `dna/domain/ula-timing.md` (provenance `hardware`).
Implementation: a new `@zx-vibes/ula` package (`packages/ula`, mirroring `@zx-vibes/cpu`):
`FRAME_T_STATES = 69888` (312×224), `INTERRUPT_T_STATES = 32`, `interruptActive(t)`,
`isContendedAddress(addr)` (0x4000–0x7FFF), and `contentionDelay(t)` over the documented
period-8 pattern `6,5,4,3,2,1,0,0`. Gate: `dna/conformance/timing/run-timing-fixtures.mjs`
(+ self-test) runs the model against `frame-length.json`/`contention.json`, wired into
`conformance:check`; both rows flip to `covered` (coverage **83/90**).

Two decisions recorded here, not silently baked:

1. **Contention geometry is pinned to the canonical 48K early-timing model:** the contended
   window starts at frame T-state **14335** and spans 192 display lines (224 T apart), the
   first 128 T of each line contended. Other machines/late-timing variants differ; this is
   the standard 48K reference value. If a later slice needs another model it is a new
   decision, not a silent change.

2. **`TIM-CONTENTION-001` provenance changed `fuse` → `hardware`.** The coverage row was
   tagged `fuse`, but **no per-case FUSE contention/timing payload is pinned** (only the
   fuse-z80 per-opcode suite, zexall, zexdoc exist). The contention pattern is documented
   hardware behavior (the `fuse` tag reflected the widely-used FUSE *implementation* of it,
   not an external oracle). Tagging it `hardware` keeps provenance honest (C5).

**Deferred (not this slice):** threading `contentionDelay`/`isContendedAddress` into the
executed instruction stream (per-access contention) and modeling interrupt *acceptance*
(the CPU honoring `INT`: finish instruction, push PC, IM 0/1/2 dispatch). These need the
machine loop and are tracked follow-ups, not coverage.

### ADR-0011 — Machine layer: interrupt acceptance + per-access contention via a clock-threaded CPU

**Status:** accepted.

The machine-layer slice joins `@zx-vibes/cpu` (single-step ISA) and `@zx-vibes/ula`
(pure timing model) into a running 48K machine — the next emulator layer above the
CPU. DNA: `dna/domain/machine-execution.md` (provenance `z80-spec` for the CPU
interrupt response, `hardware` for the 48K timing, `decision:ADR-0011` for the pins
below). Implementation: a new **`@zx-vibes/machine`** package (`packages/machine`,
mirroring `@zx-vibes/cpu`/`@zx-vibes/ula`): `acceptInterrupt()`, `createMachine()` /
`Machine` (`stepInstruction()`, `runFrame()`). Gate:
`dna/conformance/machine/run-machine-fixtures.mjs` (+ self-test) over
`interrupt-accept.json` / `contention.json` / `frame-loop.json`, wired into
`conformance:check`. **`MACHINE-INT-ACCEPT-001`, `MACHINE-CONTENTION-001`,
`MACHINE-FRAME-001` covered** (coverage **88/93**). The whole CPU FUSE/zex ISA stays
green: `step()` is unchanged for callers that pass no clock (1366 cases identical).

This delivers BOTH halves the previous slice (ADR-0010) deferred — interrupt
acceptance AND per-access contention — by making the CPU core clock-threaded rather
than lump-timed only.

**How the CPU became clock-threaded (no regression to the 1366 cases).** `step()`
gained an optional `clock` argument: when supplied, the shared `rd`/`wr` closures
invoke `clock.access(address)` for every memory bus access (opcode/operand fetches,
data reads, writes) in execution order. `step()` still returns the **uncontended**
T-states; the machine adds the accumulated contention itself. When no `clock` is
passed the behavior is byte-for-byte identical, so the FUSE single-step / zex oracles
(which pass no clock) are untouched — verified green after the change.

Decisions pinned here, not silently baked:

1. **Interrupt acceptance is the documented Z80 response (provenance `z80-spec`).**
   Accept at an instruction boundary iff `IFF1` and `INT` asserted
   (`interruptActive`, ULA-TIME-INT-001); clear `IFF1`/`IFF2`; bump `R`; leave HALT
   with the return address after the HALT; push PC; dispatch IM 1 → `0x0038` (13 T),
   IM 2 → `[(I<<8)|databus]` (19 T), IM 0 = IM 1 on the 48K. Acceptance is delayed
   one instruction after `EI`. At most one maskable interrupt per frame.

2. **48K interrupt-acknowledge data bus = `0xFF` (`decision:ADR-0011`).** Nothing
   drives the bus during acknowledge, so it floats high: IM 0 = `RST 38h`, IM 2
   vector low byte = `0xFF`. A machine that drives it differently is a separate
   decision. (`acceptInterrupt` still takes a `dataBus` override for completeness.)

3. **Per-access contention sampling model (`decision:ADR-0011`).** Each contended
   access samples `contentionDelay` at `(instruction-start clock + contention
   accumulated so far) mod FRAME_T_STATES`. This is the canonical per-access model
   reference 48K emulators use; it pins contention to the already-conformed
   `@zx-vibes/ula` functions (TIM-CONTENTION-001, geometry from frame T 14335 per
   ADR-0010 — **not** the legacy display-latch geometry, which the cross-check showed
   starts ≈14384 and which ADR-0002/0010 supersede) without requiring the CPU to
   expose a per-M-cycle base-T schedule.

**Deferred (tracked, not coverage; no silent debt):** a fully **M-cycle-exact**
contention model that also charges contention on internal no-MREQ cycles (e.g.
`ADD HL,rr`'s padding, the read-modify-write extra cycle) and offsets each access by
its exact in-instruction base T-state. The current model is genuinely per-access
(the thing programs hit when running in or addressing contended RAM), not a
per-instruction approximation, but it is not per-M-cycle exact; that refinement would
need the CPU to emit a cycle schedule and is recorded here as the next contention
follow-up. I/O-port contention and floating-bus reads also remain out of scope
(consistent with `ula-timing.md`).

**Oracle cross-check (domain-author / gap-resolver role).** The legacy emulator was
read only as a tie-breaker (UNKNOWN backlog candidate "legacy runFrame() …"): it
confirmed the interrupt sequence (IM 0/1/2 totals 13/13/19, data bus 0xFF, HALT exit,
EI delay) and the per-access contention shape (contention applied at each memory
read/write, sampled at instruction-start + accumulated). It was **not** copied; its
contention *geometry* (14384/late-timing) was rejected in favor of the DNA's pinned
14335.

### ADR-0012 — M-cycle-exact memory contention via a CPU-emitted bus-cycle schedule

**Status:** accepted.

This is the contention follow-up ADR-0011 deferred: a genuinely **M-cycle-exact**
model that also charges contention on internal no-MREQ cycles and samples each
access at its exact in-instruction T-offset. It is the contained slice (not a full
CPU rewrite): additive, opt-in, oracle-validated, and zero-regression. DNA:
`dna/domain/machine-execution.md` (MACHINE-CONTENTION-MCYCLE-001 / -SCHEDULE-001 /
-MCYCLE-SCOPE-001). Coverage: `MACHINE-CONTENTION-MCYCLE-001` covered (89/94).

**The CPU emits a bus-cycle schedule (provenance `fuse`).** `step()` gained three
optional `clock` hooks invoked in execution order: `mcycle(address, tStates)` for
each memory M-cycle and its length (opcode fetch 4 T, operand/data 3 T),
`internal(address, n)` for `n` internal no-MREQ cycles holding `address` on the
bus, and `inexact()` to flag a not-yet-complete schedule. The schedule is validated
against the **pinned FUSE per-instruction memory timeline** (the `MC` contention
points in `tests.expected`, which `build-fuse-fixtures.mjs` otherwise drops) by
`dna/conformance/cpu/validate-mcycle-schedule.mjs`: of the single-step cases,
**1265 are schedule-identical to FUSE, 80 are flagged `inexact()`, 0 are silently
wrong** (11 multi-instruction cases emit a correct prefix). This is the same
"FUSE-as-oracle" device as ADR-0009, now applied to timing geometry.

**The machine adds an exact contention clock (provenance `hardware`).**
`createMachine({ exactContention: true })` selects `_exactClock`, which threads a
running uncontended T-offset through the schedule and samples `@zx-vibes/ula`
`contentionDelay` at `(t0 + base + extra)` per cycle (MACHINE-CONTENTION-MCYCLE-001).
The textbook effects the per-access model missed are now charged: an opcode in
uncontended code reading contended RAM is sampled at offset 4 (not 0), and
`ADD HL,rr` with `I` in a contended page pays for all seven IR cycles (20 T at frame
T 14335, vs the per-access model's 0). Fixture:
`dna/conformance/machine/contention-mcycle.json` (9 cases, expected delays computed
by an independent schedule-replay reference and cross-checked against the impl).

Decisions pinned here, not silently baked:

1. **Per-access stays the default and the fallback (`decision:ADR-0012`).** The
   conformed per-access model (MACHINE-CONTENTION-CLOCK-001) is unchanged and remains
   the default. `exactContention` is opt-in. The legacy `clock.access` hook is still
   emitted, so a clock implementing only `access` behaves exactly as before, and the
   **no-clock path is byte-for-byte identical — the 1366 FUSE/zex single-step cases
   and the 16 per-access machine cases stay green** (re-verified).

2. **Scope is explicit; un-modeled internal cycles fall back, never silently
   mis-time (C5).** The exact model is complete for every no-internal instruction
   and for the internal-cycle classes listed in MACHINE-CONTENTION-MCYCLE-SCOPE-001
   (ADD/ADC/SBC HL, ADD IX/IY, INC/DEC ss, LD SP,HL/IX/IY, INC/DEC (HL)/(IX+d),
   CB (HL)/(IX+d), RRD/RLD, LD I/R/A, LDI/LDD/CPI/CPD + repeats, RET cc, CALL/CALL cc,
   PUSH, RST, JR/JR cc). The remaining internal-cycle forms — `EX (SP),HL/IX/IY`, the
   `(IX+d)` operand index-calc cycles of the general load/ALU group, `LD (IX+d),n`,
   `DJNZ`, and block I/O `INI/OUTI/IND/OUTD` (+ repeats) — call `inexact()` and fall
   back to the per-access value; the validator proves none is silently wrong.

3. **PUSH/CALL/RST now write high-byte-first (`decision:ADR-0012`).** To match the
   documented Z80 push order (and FUSE's MC timeline), the stack pushes write the
   high byte to `SP-1` before the low byte to `SP-2`. The memory result and the
   uncontended T-states are unchanged; only the contended-access order (hence the
   exact contention) is affected. The 1366/16 cases stay green.

4. **I/O-port contention and floating-bus reads remain out of scope** (consistent
   with `ula-timing.md` and ADR-0011); the block-I/O forms therefore fall back.

**Validation is offline (provenance honesty).** `validate-mcycle-schedule.mjs`
needs the pinned FUSE payload (the event timeline is not in the committed
per-opcode fixtures), so like the zex acceptance runs it is offline, not a CI gate;
the gated proof is `contention-mcycle.json` + the machine self-test (which rejects a
per-access value under `exactContention`). The 1265/80/0 result is recorded here.

### ADR-0013 — Toolkit/scaffolding coverage rows deferred to the toolkit regeneration phase

**Status:** accepted.

After the M-cycle-exact contention slice (ADR-0012), the DAA fidelity row, and the
`.z80` v3 snapshot slice, the **entire emulator area is covered** and the only
remaining uncovered contract/fidelity rows are three toolkit/scaffolding rows:

- `CLI-EXIT-VERIFY-001` (toolkit) — `zxs verify` exits 0 on pass, non-zero on fail.
- `RUN-BEEPER-001` (toolkit) — run JSON reports `audio.beeperEdges` as an integer ≥ 0.
- `SCAFFOLD-VERIFY-001` (scaffolding) — a generated `game` project passes verify with
  the regenerated toolchain.

These are W4/W5 behaviors of the regenerated `zxs` CLI and `create-zx-vibes`
scaffolder, **neither of which exists yet**: `@zx-vibes/toolkit` and
`create-zx-vibes` are still the *legacy* packages, not regenerated from `dna/`. The
regenerated cores so far are `@zx-vibes/cpu` / `@zx-vibes/ula` / `@zx-vibes/machine`
(plus the assembler DNA); the toolkit does not yet depend on them (Phase 5,
cut-the-cord, is still pending in `handoff.md`).

**Decision.** The three rows stay `uncovered` with provenance `contract` (not
`UNKNOWN`) — the behavior is specified, only its regenerated implementation is not
yet built. Covering them now is explicitly out of scope, for two reasons:

1. **Building the regenerated `zxs`/run/verify pipeline is a whole phase**, premature
   while the toolkit has not even cut over to the regenerated emulator packages.
2. **Pinning the three rows against the *legacy* CLI as a contract oracle is
   rejected** — it would fossilize legacy behavior, contrary to ADR-0001/0002 and the
   cut-the-cord protocol; the legacy code is a tie-breaker, not an authority.

This is a recorded deferral, not silent debt (C5): the coverage cutover gate
(`coverage-check.mjs --cutover toolkit|scaffolding`) still enforces these rows **at
the toolkit/scaffolding slice cutover**, which has not happened; the default ledger
gate (bootstrap mode) reports them as the known remaining work (coverage **92/95**).
They are picked up by the toolkit regeneration phase, not before.

### ADR-0014 — Product/DNA boundaries: five products over a shared core; slice isolation

**Status:** accepted (planning ratified by the user, 2026-06-28).

How the reconstruction is partitioned into separately workable / publishable
products, and how far each can be isolated from the DNA. Decided after the
coupling audit (only `z80-opcodes` crosses domain slices; product specs are
per-slice; the conformance runner/ledger/normalizer are cross-cutting).

**1. Five products over a shared core (`decision:ADR-0014`).**

| # | Product | Package(s) / artifact | bin | DNA module |
| --- | --- | --- | --- | --- |
| 1 | Emulator | `@zx-vibes/cpu` + `/ula` + `/machine` | (libs) | `dna/emulator` |
| 2 | Assembler/Disassembler | `@zx-vibes/asm` | `zxasm` | `dna/assembler` |
| 3 | Toolkit | `@zx-vibes/toolkit` (+ umbrella `zx-vibes`) | `zxs`, `zxs-mcp`, `zx-vibes` | `dna/toolkit` |
| 4 | Scaffolding | `create-zx-vibes` + `starters/` | `create-zx-vibes` | `dna/scaffolding` |
| 5 | Gallery | `gallery/` (site) | (site) | `dna/gallery` |

**Reference knowledge** (`docs/reference` + agent skills) is **not** a sixth
product: it is a generated OUTPUT of `dna/core` + `dna/domain` (ADR-0005 proposal),
rendered, not authored as a separate genome.

**2. Shared core (`dna/core`).** The one genome shared across products: the
`z80-opcodes.{md,yaml}` table (single source for assembler *encode* ↔ CPU
*decode* — duplicating it would drift, violating C2) plus the conformance
infrastructure (runner, schema, normalization, provenance lint, coverage ledger,
external-suite registry/resolver, determinism profiles, oracle capture). Every
product depends on the core; the core depends on no product.

**3. Seam = conformance contract, never source.** A product depends on another
product's conformance-defined observable behavior (its contract), not its code:
`toolkit` ⟂ {`asm`, `emulator`}, `scaffolding` ⟂ `toolkit`, `gallery` ⟂
{`emulator`, `toolkit`}, `machine` ⟂ {`cpu`, `ula`}. This is the implementer
isolation `roles.md` already enforces ("`dna/` only"); it is what makes isolated
per-product work possible. Leaves (`cpu`/`ula`/`asm`) are already standalone npm
libs; orchestrators (`toolkit`/`gallery`/`scaffolding`) are separable in DNA but
runtime-coupled via contract.

**4. Emulator ships as a lib family.** `@zx-vibes/cpu` and `@zx-vibes/ula` are
published as reusable standalone libraries (Z80 core / ULA timing);
`@zx-vibes/machine` is the integrated 48K face. One DNA module (`dna/emulator`)
covers all three.

**5. Topology = monorepo (core + per-product modules).** One repo, one install,
one integration gate — C1 preserved. Polyrepo (a versioned `@zx-dna/core` consumed
by per-product repos) is **deferred**, taken only if product release cadences
diverge; it trades the single-monorepo "always green" for physical isolation.

**6. Sequencing (`decision:ADR-0014`).** **Level 1 now** — per-product conformance
gates + coverage shards (cheap, moves no DNA files) so W4/W5 are worked in
isolation from the start. **Level 2 after coverage 95/95** — the physical
`dna/core` + `dna/<product>/` split (moving files), kept green by both the
per-product and the integration gate. **Polyrepo later**, only if needed.

Execution is tracked as **W7** in `tasks/roadmap.md`. This decision sets
boundaries only; it moves no file yet (Level 1 adds gates/shards, not moves).

**7. Core/edge manifest (`decision:ADR-0014`, R-W7-03, 2026-06-28).** The exact
file-level partition of `dna/` into `dna/core` + the five `dna/<product>/` modules
is enumerated in [`migration-w7.md`](migration-w7.md) — the checklist R-W7-04 will
execute. Summary: `dna/core` = `z80-opcodes.{md,yaml}` + the cross-cutting
conformance infra (runner/schema, normalization, determinism, provenance, coverage
ledger, external-suite **registry/manifests**, oracle capture, distribution
bootstrap, z80-opcodes check); `dna/emulator` = the cpu/ula/machine/snapshot domain
+ `conformance/{cpu,timing,machine,formats}` (incl. the zex/fuse **adapters**, which
are product-owned even though the manifests are core); `dna/assembler` =
`product/assembler.md` + `conformance/assembler` (domain is the shared core table);
`dna/{toolkit,scaffolding,gallery}` = their W4/W5 product specs + conformance (not
yet authored). No files moved by R-W7-03.

### ADR-0015 — W4 CLI conformance asserts the contract, run against the regenerated toolkit

**Status:** accepted (2026-06-28).

How `conformance/cli/` is sequenced relative to the toolkit regeneration, resolving
the ADR-0013 deferral of `CLI-EXIT-VERIFY-001` / `RUN-BEEPER-001` without guessing.

**Decision (`decision:ADR-0015`).**

1. **Contract, not legacy bytes.** CLI fixtures assert contract-level observables —
   exit-code semantics and JSON field types/shapes — normalized via the
   `cli-snapshot` profile. They do **not** pin byte-for-byte legacy output (that
   would freeze incidental wording and violate C5 / the implementer's oracle
   isolation). This is what "not pinned against legacy" (ADR-0013) means in practice.
2. **Run against the regenerated toolkit.** The execution runner
   (`conformance/cli/run-cli-fixtures.mjs` + self-test) is authored in **R-W4-05**
   and executes the **regenerated** `@zx-vibes/toolkit` (the implementer's output),
   wired into `conformance:check:toolkit` and the aggregate at that point. The
   implementer stays sealed from the legacy code (`roles.md`).
3. **Fixtures-first (TDD), honest coverage.** R-W4-04 authors the fixtures as the
   regeneration target (schema-valid, validated by `runner.mjs`); the two rows stay
   `uncovered` and project coverage stays **92/95** until the regenerated toolkit
   actually passes them — no `partial`/legacy-pinned status in between (C5: no silent
   debt, no silent breakage).

**Consequence.** Adding the fixture files now is additive and gate-green; the
coverage move to 94/95 happens at R-W4-05 when there is a real implementation to
prove the behavior. See `conformance/cli/README.md` for the runner contract.

### ADR-0016 — Host-I/O enters the DNA as a new workstream (W8); event-surface vs rendering split

**Status:** accepted (scope ratified by the user 2026-06-28); execution PLANNED in
`plan-w8-host-io.md`, authored in matched domain+conformance+coverage slices.

A consumer built a working browser emulator from this DNA and found that the core
gate (CPU/ULA/machine/`.z80`) proves nothing host-visible, so a shell passed it while
rendering `SAVE "pp"` with no tape bands. The full triage is
`intake-consumer-2026-06-28.md` §C (10 verified pin candidates C1–C10). The user chose
**"new host-I/O DNA area now"** over folding into W5 or documenting out-of-scope.

**Decision.**

1. **Host-I/O is in DNA scope, as workstream W8** (`tasks/roadmap.md`). It is NOT part
   of the core emulator gate; it is a new area with its own domain + conformance +
   coverage, so "core conformance green" is never confused with "host-I/O proven".

2. **Event-surface vs rendering-policy split (product mapping, ADR-0014).** The
   **emulator** product owns the hardware-truth *observable event surface* — port `0xFE`
   read/write semantics, the border-bit (b0–2) and beeper-bit (b4) **event stream** with
   frame-relative chronological timestamps, keyboard half-row reads. The **gallery**
   product owns *host rendering policy* — visible raster geometry (T-state→border pixel)
   and audio resampling/conditioning/capture. Hardware truth is pinned with provenance
   `hardware`/`z80-spec`; rendering policy is pinned as `decision:ADR-0016` (it is a
   product choice, not hardware).

3. **Determinate semantics that are pinned now (consumer-verified + documented
   hardware):** border is a *timed event stream* not one colour/frame (C1); the I/O
   side effect fires at the CPU's I/O-cycle time, which `@zx-vibes/cpu` already reports
   and the FUSE port fixtures already pin (C2); the event timestamp must be a
   **chronological frame-relative offset**, NOT a ULA-frame modulo position — the
   consumer proved modulo reorders edges across the frame wrap once the machine clock
   drifts off zero (C7); fractional sample accounting, not a rounded samples/frame (C6);
   conditioning-state continuity across frame boundaries (C8); a deterministic PCM/WAV
   capture path is the conformance route, audible browser playback is manual acceptance
   only (C9).

4. **Two modeling sub-decisions — DEFAULT resolutions ACCEPTED to enable autonomous W8
   execution (user directive 2026-06-28).** Both leans on existing DNA authority; both
   are recorded as `decision:ADR-0016` and are **provisional/revisable** — a session
   authors with the default and flags it at W8 review; if the user supplies different
   constants, only that slice's fixtures change.
   - **`UNKNOWN:host-io:PORT-FE-CONTENTION-001` → RESOLVED (default).** Keep port-`0xFE`
     I/O contention OUT of scope (consistent with `ula-timing.md` / ADR-0011 / ADR-0012,
     which already scope I/O-port contention + floating bus out). The event time is
     **contended-machine time at the I/O cycle** — the machine time including the memory
     contention accumulated before the I/O cycle (what the shell produces with
     `exactContention`), NOT host-ULA I/O-port time. Strong default: it matches the
     existing scope decision and a working shell.
   - **`UNKNOWN:host-io:RASTER-GEOMETRY-001` → RESOLVED (default, flag at review).** Pin
     the active-display + border *timing* from documented 48K hardware — the display
     anchor is `ula-timing.md`'s contended-display start (frame T 14335, ADR-0010), lines
     224 T apart, 192 display lines; the **visible-border margins** (32 px horizontal /
     24 lines vertical, a 320×240 canvas) are the gallery's rendering choice, pinned as
     `decision:ADR-0016`. So the visible-line-start is *derived* (display start − 24
     lines), not copied from the shell. Author S4 LAST and surface the chosen geometry +
     the `SAVE "pp"` golden pixels for the user to confirm.

5. **`.tap`/`.tzx`** stays a separate format/backlog item (roadmap R-W3-04 lists it
   undone); it is referenced by W8 but not gated by it.

This decision sets the boundary and the determinate pins; the normative
`dna/domain/host-io-port-fe.md`, the gallery rendering specs, and their
`conformance/{host-io,raster,audio}/` fixtures are authored slice-by-slice per
`plan-w8-host-io.md`, each landing green (C1).

## Completeness instrument

Coverage is tracked in `../../dna/conformance/coverage.{md,yaml}`. The CI gate
(`R-W0-03`) forbids any `contract`/`fidelity` behavior from being
`uncovered`/`partial`/`unknown` at its slice cutover. The full task breakdown is
`tasks/roadmap.md`.

## UNKNOWN backlog

Populated by the extraction and domain-authoring passes. The CPU gaps below are
found by the ADR-0009 differential regeneration and block their `CPU-FUSE-*`
coverage rows from moving to `covered`.

- `UNKNOWN:emulator:CPU-FUSE-CB-001` (G-1) — **RESOLVED.** `BIT n,(HL)` 5/3 from
  WZ-high; rule [Z80-EXEC-BIT-001]/[Z80-EXEC-BIT-UNDOC-53-001] authored, `memptr`
  fed as input, and `@zx-vibes/cpu` passes the cb group in the gate (`CPU-FUSE-CB-001`
  covered).
- `UNKNOWN:emulator:CPU-WZ-001` (G-2) — **RESOLVED 2026-06-29 (ADR-0020 / R-W9-04).** The
  full per-instruction WZ (MEMPTR) **output**-update rules are now modeled in `@zx-vibes/cpu`
  (`z80-step.mjs`) and authored in `dna/domain/z80-cpu-execution.md` (`Z80-EXEC-WZ-UPDATE-*`),
  and MEMPTR is asserted on output across the whole FUSE ISA (`build-fuse-fixtures.mjs` no
  longer drops it; `fuse/*.json` + `fuse-budget/*.json` regenerated). All 1390 cpu-exec cases
  pass with memptr asserted; the relaxation is lifted. This was the **last open `UNKNOWN` in
  the emulator's core ISA**. Provenance `z80-spec` corroborated by the FUSE MEMPTR column
  (no fabrication). See ADR-0020.

- `UNKNOWN:emulator:IO-CONTENTION-001` (E1 / W10.14, ADR-0023) — **OPEN — DEFERRED (2026-06-30,
  the ADR-0023 two-blind-regen GUARD fired).** I/O-port contention (the C:1/N:3 stall pattern on
  `IN`/`OUT` by port range + A0) cannot ship as `hardware`: (1) there is **no within-repo per-case
  oracle** (FUSE times memory contention only — ADR-0023); (2) the **only in-repo discriminator is
  the legacy code** (`packages/emulator` `io-interface.js` / `ula.js` `getPortContentionDelay`),
  non-authoritative on two counts — it anchors the frame T-state at the **rejected 14384** display
  geometry (ADR-0002/0010/0011, off by 49 T) and models only a simplified
  even-port-reuses-the-memory-delay pattern, not the documented four-case range×A0 table; and
  (3) the prerequisite `HOST-IO-PORTFE-IO-OFFSET-001` (the intra-instruction I/O-cycle T-offset) is
  **unresolved and not computable** in the current `step()`/`io.write` contract, which does not
  expose it. A two-blind regeneration is therefore not viable — with no authority to read it would
  only prove spec-clarity, not hardware-correctness (the floating-bus problem, ADR-0026). Per
  ADR-0023's no-fabrication guard the slice is **deferred, not fabricated**: the shipped default
  stays I/O-contention-OFF (`HOST-IO-PORTFE-IO-CONTENTION-001`, the green 11T/21T
  `port-fe-iotime.json`), which is correct and unchanged — so this is a **tracked deferral, not
  silent debt** (C5) and deliberately **not a coverage row** (an `unknown`-status row would break the
  gate; tracked here, exactly like R-W9-05). Unblocked only when BOTH (a) the CPU step contract
  exposes the I/O-cycle T-offset (`HOST-IO-PORTFE-IO-OFFSET-001` lands) AND (b) a citable per-case
  authority/oracle for the 48K contended-I/O pattern is pinned — or a real consumer needs it. This is
  the planned outcome ADR-0023 flagged to the user.

- **Patrik-Rak PC-derived 5/3 *repeat* correction (R-W9-05) — OUT OF SCOPE (decision,
  2026-06-29).** Not an `UNKNOWN` provenance entry (no DNA artifact tags it): a tracked scope
  decision. For repeating block ops the *intermediate* 5/3 flags are PC-derived on later
  silicon ("The Undocumented Z80 Documented" SS5.6), but the project pins no oracle that
  witnesses it — the pinned FUSE commit **predates** the correction (ADR-0009 verified its six
  mid-repeat cases match the per-iteration flags `@zx-vibes/cpu` already produces) and zexall
  CRCs only the final post-repeat state. A discriminating fixture would need hand-fabricated
  expected values (forbidden by the R-W9-05 GUARD). **Decision:** keep the per-iteration model
  (correct against every pinned oracle); revisit only if a witnessing oracle is re-pinned or a
  consumer needs cycle-exact mid-repeat 5/3. Low value. See `handoff.md` GUARDED OUTCOMES.
- `UNKNOWN:emulator:CPU-FLAG-DAA-001` (G-3) — **RESOLVED for single-step.** `DAA`
  algorithm + flags [Z80-EXEC-DAA-001]/[Z80-EXEC-DAA-FLAGS-001] authored;
  `@zx-vibes/cpu` passes the base group in the gate (`CPU-FUSE-BASE-001` covered).
  Full operand-range validation still awaits the ADR-0006-blocked zex suites.

- _candidate_: legacy `runFrame()` display-latch + interrupt-acknowledge timing —
  investigate against documented ULA timing; do not copy as-is.
- `UNKNOWN:emulator:CPU-FUSE-BUDGET-001` — **RESOLVED.** The run-to-budget contract
  for the 23 multi-instruction FUSE cases (repeating block ops / DJNZ loop / prefix
  NONI timing) is implemented (`cpu-run` fixtures + `step()` block-op-iteration and
  prefix-timing rules); `@zx-vibes/cpu` passes the three `CPU-FUSE-BUDGET-*` rows in
  the gate (ADR-0009 run-to-budget slice).
- `UNKNOWN:emulator:CPU-PREFIX-DDED-001` (consumer feedback 2026-06-28) — **RESOLVED.**
  `DD ED xx` / `FD ED xx` (a `DD`/`FD` prefix immediately followed by `ED`) is a 4 T
  NONI: the prefix is abandoned and `ED xx` executes. Our reference CPU was already
  **correct** (`packages/cpu/src/z80-step.mjs:176-186`) but **no fixture pinned it** —
  the budget set covered only `dd00`/`ddfd00`, and upstream FUSE has no `DDED`/`FDED`
  case — so a blind regeneration was free to mis-decode it, which a real consumer's
  shell did (routed `ED` into the index/base fallback → `PUSH`-like). Closed by
  authoring `conformance/cpu/prefix/ddfd-ed.json` (4 `cpu-run` cases: DD/FD ED 44 = NEG,
  DD/FD ED 57 = LD A,I; provenance `z80-spec` for the decode rule + FUSE 4 T NONI timing,
  expected values from the zex-validated reference as in-repo oracle) + coverage row
  `CPU-PREFIX-DDED-001` (covered, emulator 23/23, project 93/96). Additive, no code
  change beyond the witnessing comment. See `intake-consumer-2026-06-28.md` §A1.
- **host-I/O surface** — border raster event stream, beeper edges, port `0xFE` I/O
  timing, keyboard, browser audio. **Scope decision TAKEN (ADR-0016, 2026-06-28):** it
  enters the DNA as workstream **W8**, emulator event-surface + gallery rendering split.
  Full design input (C1–C10) in `intake-consumer-2026-06-28.md` §C; slice plan in
  `plan-w8-host-io.md`. Two modeling sub-decisions remain open (below).
- `UNKNOWN:host-io:RASTER-GEOMETRY-001` (ADR-0016) — **RESOLVED (default, revisable).**
  Timing anchored to documented 48K hardware (display start frame T 14335, ADR-0010);
  visible-border margins 32 px H / 24 lines V (320×240 canvas) pinned as
  `decision:ADR-0016`; visible-line-start derived (display − 24 lines), not copied from
  the shell. S4 authored last + the geometry/`SAVE "pp"` pixels surfaced for user
  confirmation. See ADR-0016 §4.
- `UNKNOWN:host-io:PORT-FE-CONTENTION-001` (ADR-0016) — **RESOLVED (default).** Port-`0xFE`
  I/O contention stays OUT of scope (consistent with `ula-timing.md`/ADR-0011/0012); event
  time = contended-machine time at the I/O cycle. See ADR-0016 §4.
- `UNKNOWN:gallery:KBD-LATCH-PRECOND-001` (W8 blind differential regen, 2026-06-28) —
  **RESOLVED.** A blind differential regeneration of the whole W8 host-I/O surface (two
  independent implementers writing a host-I/O module from `dna/{domain,product}` ONLY —
  sealed from `dna/conformance/` and the oracle) validated the DNA: **11 of 12 functions
  agreed byte-for-byte across both impls AND the shipped reference over thousands of probe
  inputs the fixtures never pin** (port-`0xFE` events, chrono offsets, PCM capture,
  `matrixByte`, browser map, `KEY_MATRIX`, raster geometry/pixel/RGB, constants). The lone
  divergence: `createKeyboard`'s quick-tap latch. `KBD-LATCH-001` said a key released
  "before any scan has observed it pressed" is latched, but did **not** state that a
  `keyUp` only latches a key that was actually pressed (a live `keyDown`); one impl read it
  literally and latched a release with no matching press → a **phantom key**. The shipped
  model was already correct (it required the key to be down) but **no fixture pinned it** —
  the same hole shape as `CPU-PREFIX-DDED-001`. Closed by tightening `KBD-LATCH-001` (the
  precondition is now explicit) + adding fixture case `release-without-press-ignored` to
  `conformance/keyboard/keyboard-latch.json` (a release with no matching press registers
  nothing; a real tap after still works). Additive, no code change; the buggy impl now
  fails the fixture, gate green (coverage unchanged 105/108, `KBD-LATCH-001` already
  covered). Provenance `decision:ADR-0016`. The jitter metric (`BEEPER-PCM-CAPTURE-001`)
  was also noted as a *bounded* (≤1), not exact, contract — both impls returned 1 vs the
  reference's 0.806, all within bound; intentional, no change.

### ADR-0017 — Emulator regeneration environment is a packaged, drift-gated template

**Status:** accepted + implemented 2026-06-29.

Hand-assembling an isolated clean-room environment to regenerate the emulator from the
DNA (copy `dna/`, author an AGENTS.md, wire the conformance gates, lay down host-asset
placeholders) is slow and easy to get subtly wrong. A consumer wanted to spin up
**several isolated environments** (and on other machines, e.g. macOS, to drive Codex)
without re-deriving the scaffold each time, and without contaminating the experiment by
copying a prior build's phenotype.

**Decision.**

1. **One-command generator.** `scripts/new-emulator-env.mjs <dir>` packages the
   **current** `dna/` genome + a frozen harness template into a fresh folder: it copies
   `dna/` whole, drops the template (a three-layer emulator AGENTS.md, the layered
   conformance gate `package.json`, README, `rom/`+`tapes/` host-asset placeholders,
   `.gitignore`), substitutes the project name, and **stamps provenance**
   (`dna.provenance.json` + README: the source repo, commit, commit date, branch, dirty
   flag). Portable: Node-only, paths resolved relative to the script, no shell. Exposed
   as `npm run new:emulator-env`.

2. **The template is the single source, kept out of the genome.** It lives at
   `scripts/templates/emulator-env/` (factory scaffolding, not DNA — generated envs get
   `dna/` but never the template/generator/harness, matching QUICKSTART's "don't copy
   AGENTS.md/.harness"). The env's AGENTS.md is a *consumer* contract (build a playable
   emulator) distinct from this repo's own reconstruction AGENTS.md.

3. **Drift is gated, not trusted.** The template hard-codes paths into the live genome
   (conformance runners, coverage areas `emulator`/`gallery`, the `packages/*` import
   surface, the host-shell reference models). `scripts/check-emulator-env-template.mjs`
   (`npm run check:emulator-env-template`, wired into `check:drift`) fails **red** if the
   template references anything the genome no longer provides: a missing runner path, an
   `--area` not in `coverage.yaml`, a runner whose default module path drifted, a missing
   reference model, a smoke gate (`conformance:self-test`) that references a
   non-package-free runner (would be red on a fresh env), or a `KNOWN_ABSENT` path the
   doc claims is missing that has since been authored. This is the QUICKSTART anti-drift
   guard's sibling: **the harness now knows the template must be refreshed whenever the
   DNA conformance surface moves.**

**Maintenance contract.** When a slice changes the conformance layout (new/renamed
runners, a new package-free self-test, a new coverage area, a changed import surface, or
authoring `dna/product/emulator.md`), update `scripts/templates/emulator-env/` AND, where
applicable, the `PACKAGE_FREE_SELFTESTS` / `IMPORT_SURFACE` / `KNOWN_ABSENT` sets in the
checker, in the **same** commit. The gate enforces it; a green `check:drift` means the
packaged template still regenerates a working environment.

### ADR-0018 — RETI restores IFF1 from IFF2 (silicon); a discriminating fixture closes the FUSE net hole

**Status:** accepted + implemented 2026-06-29.

The DNA's `Z80-OPC-RETN-RETI-001` followed the Zilog UM0080 letter: only `RETN`
restores `IFF1` from `IFF2`, and `RETI` merely signals interrupt completion to a
Z80 peripheral. But real Z80 silicon copies `IFF2 → IFF1` on `RETI` too, exactly
like `RETN`. Both the shipped `@zx-vibes/cpu` core (`z80-step.mjs` groups `ED45`
and `ED4D` under one `(eop & 0xc7) === 0x45` arm and assigns `iff1 = iff2`) and
the FUSE/zexall oracles the project conforms to already implement the silicon
behavior. So the **DNA was the lone artifact disagreeing with its own oracle** —
a faithful regeneration of the old DNA would have diverged from hardware. The
disagreement was masked because the pinned FUSE `ed4d` case enters with
`IFF2 = 0`, so it cannot distinguish a `RETI` that restores `IFF1` from one that
leaves it unchanged.

**Decision.**

1. **DNA follows silicon, not the manual.** Rewrote `Z80-OPC-RETN-RETI-001`
   (`dna/domain/z80-opcodes.md`) so **both** `RETN` and `RETI` restore `IFF1`
   from `IFF2`, with the Zilog-manual caveat in prose. Provenance `z80-spec →
   hardware` (verified silicon behavior, not in the official manual). The
   canonical core was already correct and is **unchanged**; the `.yaml` encoding
   table is untouched (it stays `z80-spec` and carries no IFF field).

2. **Close the net hole with a hand-authored fixture.** Added `CPU-RETI-IFF-001`
   (`dna/conformance/cpu/reti-iff.json`, provenance `hardware`): two `ED4D` cases
   entered with `IFF1 != IFF2` in both directions, so a non-restoring `RETI`
   fails at least one. The discriminator lives **outside** `fuse/`, which
   `build-fuse-fixtures.mjs` regenerates verbatim from the pinned FUSE payload;
   this mirrors the `CPU-PREFIX-DDED-001` "FUSE net hole" precedent. A coverage
   row references it (required by the orphan-fixture check).

3. **Sweep recorded.** Audited the rest of the DNA for the same pattern
   (prose-follows-Zilog while the core follows silicon). `RETI` was the **only**
   contradiction. Related silicon-divergent behaviors remain *unauthored gaps,
   not contradictions*: `SCF`/`CCF` undocumented `5`/`3` = `(A | F)` (witnessed
   only by FUSE fixtures, not stated in execution semantics), the `OUT (C),0` /
   `IN F,(C)` reg-code-6 forms, the `LD A,I`/`LD A,R` "interrupted → P/V reset"
   boundary case (out of single-step scope), and full `MEMPTR/WZ` update rules
   (ADR-0009 G-2). `DI`/`EI` already states the silicon EI-delay correctly. **(W9
   update 2026-06-29: the first three gaps are now authored to prose — SCF/CCF
   `(A | F)` in R-W9-02, `OUT (C),0`/`IN (C)` in R-W9-03, the `LD A,I/R` P/V
   boundary in R-W9-06; only the WZ output gap (G-2) remains, tracked as R-W9-04.)**

**Consequences.** A future regeneration from the corrected DNA produces the
silicon `RETI`, and the conformance suite now catches a non-restoring one
(proven: the fixture fails a non-restoring candidate and passes `@zx-vibes/cpu`;
`run-fuse-suite` 1390 cases). The gaps in point 3 are candidate hardening targets
for later slices.

### ADR-0019 — NMI: implement at the machine layer (48K)

**Status:** accepted (Option B) + **implemented 2026-06-29** (R-W9-01). NMI is now
in scope for the 48K product; `acceptNmi()` ships in `@zx-vibes/machine` and
`MACHINE-NMI-ACCEPT-001` is covered (emulator 29/29, project 107/110).

A consumer/LLM review of the regenerated CPU flagged that the non-maskable
interrupt (NMI) is not modeled. Confirmed: neither `packages/cpu` nor
`packages/machine` handles the NMI line or the `0x0066` vector;
`acceptInterrupt` (`packages/machine/src/interrupt.mjs`, ADR-0011) implements
only the maskable ULA INT (IM 0/1/2). `RETN` (and now `RETI`, ADR-0018) already
restore `IFF1` from `IFF2`, so the *return* side is in place — only acceptance
is missing.

The earlier hygiene task R-HYG-1 proposed recording NMI as **explicitly
out-of-scope** for the 48K product (defensible: stock 48K software rarely uses
NMI). The consumer-completeness goal points the other way (implement it so the
chip is whole). These are mutually exclusive; pick one.

- **Option A — declare out-of-scope (cheap).** A scope note in
  `dna/domain/machine-execution.md` (interrupt section) + a `decisions.md` line,
  provenance `decision`. No new coverage row. (This is the current R-HYG-1 plan.)
- **Option B — implement (recommended for completeness).** Add NMI acceptance at
  the machine layer (mirror `acceptInterrupt`): on an NMI edge, `IFF1 ← 0` (IFF2
  preserved), bump R, push PC, jump `0x0066`, leave HALT, ~11 T. Author the NMI
  semantics in `dna/domain/machine-execution.md` + a `MACHINE-NMI-ACCEPT-001`
  fixture (mirror `conformance/machine/interrupt-accept.json`) + coverage row.
  Self-contained: no CPU-step change beyond HALT-exit, which the machine layer
  already does for the maskable INT.

**Recommendation:** Option B — it closes the one gap a rigorous reviewer will
legitimately flag, it is small, and an emulator emulates the chip. But it sets a
product-scope boundary, so it is the user's call. Resolve here, then execute
R-W9-01.

**Decision (2026-06-29):** **Option B accepted** by the user. NMI is now IN SCOPE
for the 48K product. Execute R-W9-01: author NMI acceptance semantics in
`dna/domain/machine-execution.md`, implement `acceptNmi(...)` in
`packages/machine/src/interrupt.mjs` (mirror `acceptInterrupt`), add
`conformance/machine/nmi-accept.json` + `MACHINE-NMI-ACCEPT-001` coverage row, and
supersede the R-HYG-1 out-of-scope note. NMI acceptance: edge-triggered,
non-maskable; `IFF1 ← 0`, IFF2 preserved, R bumped, HALT-exit, push PC, `PC ←
0x0066`, 11 T.

**Implementation (2026-06-29, R-W9-01).** Done in one commit:
- **Domain:** `dna/domain/machine-execution.md` — new "Non-maskable interrupt
  (NMI) acceptance" section, claims `MACHINE-NMI-SAMPLE-001` (edge-triggered,
  non-maskable, instruction-boundary, priority over INT; `z80-spec`),
  `MACHINE-NMI-ACCEPT-001` (the sequence: HALT-exit, `IFF1←0` / IFF2 **preserved**,
  R bump, push PC high-first, `PC←0x0066`, `11 T = 5+3+3`; `hardware`) and
  `MACHINE-NMI-RETN-001` (RETN/RETI restore `IFF1←IFF2`; `z80-spec`).
- **Impl:** `acceptNmi({ registers, memory, halted })` in
  `packages/machine/src/interrupt.mjs` (+ `NMI_VECTOR`/`NMI_T_STATES`), mirroring
  `acceptInterrupt` but with no IFF1 mask and IFF2 left untouched; exported from
  `packages/machine/src/index.mjs`.
- **Conformance:** `dna/conformance/machine/nmi-accept.json` (4 cases: accept with
  IFF1=1 and IFF1=0; IFF2 preserved when it differs from IFF1; HALT-exit return
  address). New runner kind `machine-nmi` → `acceptNmi` in
  `run-machine-fixtures.mjs`; the self-test rejects a model that masks on IFF1,
  clears IFF2, or fails to push PC + vector to `0x0066`. Coverage row
  `MACHINE-NMI-ACCEPT-001` (emulator/fidelity/hardware) covered. **Supersedes
  R-HYG-1** (NMI out-of-scope note — NMI is now in scope). No CPU-step change
  (HALT-exit is the machine layer's job, as for the maskable INT). emulator 29/29,
  project 107/110; full `conformance:check` + `machine:fixtures` + self-test +
  `check:emulator-env-template` green.

### ADR-0020 — WZ (MEMPTR) output modeled across the ISA; ADR-0009 G-2 relaxation lifted

**Status:** accepted + **implemented 2026-06-29** (R-W9-04). Closes
`UNKNOWN:emulator:CPU-WZ-001` (G-2) — the last open `UNKNOWN` in the emulator's
core ISA.

**Context.** WZ (MEMPTR) is the Z80's internal 16-bit pointer latch, observable
only through `BIT n,(HL)`'s undocumented 5/3 flags. ADR-0009 G-1 modeled it as an
**input** (so `BIT n,(HL)` could take its 5/3 bits from WZ-high), but its
per-instruction **output**-update rules were a deliberate fixture relaxation
(**G-2**): `build-fuse-fixtures.mjs` fed MEMPTR as input and `delete`d it from the
expected block. The oracle was never missing — FUSE `tests.expected` carries
MEMPTR as its 13th register word for every case — so this was a modeling gap, not
a fabrication risk.

**Decision.** Model the full per-instruction WZ-update algorithm in the canonical
core (`packages/cpu/src/z80-step.mjs`) and assert MEMPTR on output across the FUSE
ISA. The update rules (authored in `dna/domain/z80-cpu-execution.md` as
`Z80-EXEC-WZ-UPDATE-*`, provenance `z80-spec` corroborated by the FUSE MEMPTR
column) by class:

- **8-bit acc. memory:** `LD A,(BC/DE/nn)` → `WZ = addr+1`; `LD (BC/DE/nn),A` →
  `WZ_low = (addr+1)&0xFF`, `WZ_high = A` (the **NMOS quirk**, same silicon split
  as `OUT (C),0` in R-W9-03).
- **16-bit / arithmetic:** `LD (nn),rp`/`LD rp,(nn)` (base + ED) → `nn+1`;
  `ADD/ADC/SBC HL,rp`, `ADD IX/IY,rp` → `HL(orIX/IY)+1` (pre-add); `RRD`/`RLD` →
  `HL+1`; `EX (SP),HL/IX/IY` → the value loaded into the register.
- **Control transfer:** `JP nn`/`JP cc,nn` and `CALL nn`/`CALL cc,nn` → `nn`
  (taken **or not**); taken `JR`/`JR cc`/`DJNZ` → destination (not-taken: unchanged);
  `RET`/taken `RET cc`/`RETI`/`RETN` → popped address; `RST p` → `p`.
- **Port I/O:** `IN A,(n)` → `((A<<8)|n)+1`; `OUT (n),A` → low `(n+1)&0xFF`, high
  `A`; `IN r,(C)`/`IN (C)`/`OUT (C),r`/`OUT (C),0` → `BC+1`.
- **Block ops:** `CPI` → `WZ+1`, `CPD` → `WZ-1`; repeating `LDIR/LDDR/CPIR/CPDR`
  iteration → `PC+1` (the block instruction's own address +1); block I/O
  `INI/IND/OUTI/OUTD` (+repeats) → `BC(used)±1` (IN-forms use the pre-decrement
  BC, OUT-forms the post-decrement BC; `+1` for I-forms, `-1` for D-forms).
- **Everything else (incl. `(HL)` non-indexed forms, `BIT n,(HL)`, register/imm
  ops, `PUSH`/`POP`, `JP (HL)`):** WZ unchanged. Any `(IX+d)`/`(IY+d)` access
  (incl. DDCB/FDCB) → `WZ = effective address`.

**Implementation (one coherent commit, plan step 1–3).** `z80-step.mjs` sets
`reg.memptr` per the rules (the `(IX+d)` chokepoint is `ensureDisp`, which sets WZ
to the effective address for every base-decode indexed form; DDCB/FDCB set it at
the address calc). `build-fuse-fixtures.mjs` drops `delete outFull.memptr`;
`fuse/*.json` + `fuse-budget/*.json` were regenerated from the pinned payload. The
CPU runner already compared `memptr` when present, so **no runner change** was
needed. All 1390 cpu-exec cases pass with memptr asserted; a perturbation test
(JP nn → `nn+1`) confirmed the gate enforces it (`c3: memptr 0x7CEE != 0x7CED`).

**Consequences.** The CPU is now a genuinely complete single-step reference (no
relaxed observable in the core ISA). The no-`clock` path is otherwise
byte-identical, so the zex oracle (which does not read memptr) and the per-access
/ M-cycle machine model are unaffected (machine runner self-test green). Coverage
unchanged at 107/110 (a relaxation removed, no new row). Interrupt/NMI MEMPTR
effects remain machine-layer and out of the single-step contract (ADR-0019).
Provenance honest: `z80-spec` rules witnessed per case by `fuse`; no fabricated
values. The Patrik-Rak PC-derived *repeat* 5/3 correction (R-W9-05) stays out of
scope (no discriminating oracle) and is independent of this WZ-output work.

### ADR-0021 — W10–W12 DNA-completion: scope ratified + track shape (planning 2026-06-29)

**Status:** accepted (planning session 2026-06-29). The seeded brief
[`../plan-dna-completion.md`](../plan-dna-completion.md) is upgraded to a ratifiable
plan; this session resolves the six §3 scope decisions (user calls, C5) and pins
the track shape. The decisions are recorded across **ADR-0021..0025**: this ADR =
scope + shape; ADR-0022 screen/palette; ADR-0023 I/O contention; ADR-0024
ROM/tape/EAR; ADR-0025 W11/W12 one table.

**Scope decisions (§3), resolved by the user:**
- **Tape — FULL.** "Load real games" is in the bar: `.tap` (B1) + `.tzx` (B2) +
  ROM edge-loading (B3) + instant/trap load (B5). (Not the lighter
  `.tap`+instant-only option.)
- **Bus / peripherals — ALL.** Floating bus (E2), Kempston (F1), I/O-port
  contention (E1 — see ADR-0023), EAR issue 2/3 (E4 — see ADR-0024). E2/F1 are
  hardware facts (authored with provenance `hardware`, no separate ADR); E1 is the
  one reversal, handled in ADR-0023.
- **16K ROM — opaque blob** (C2): no `rom-entry-points.md`; the ROM executes as
  data, pinned by a manifest (ADR-0024).
- **Active-area pixel timing (A5) — deferred.** The border stays T-state-accurate;
  the screen is decoded from memory + FLASH. D4 residual contention also stays
  deferred.

**Track shape:**
- **W10 (emulator: screen / tape / ROM / bus / reset)** — 14 slices in 5 sub-tracks
  (A screen content, B reset, C file-format byte layouts, D ROM + EAR + edge-load,
  E bus / peripherals), detailed in `tasks/roadmap.md`. Sequencing: screen content
  first (THE gap), reset in parallel (cheap), then tape/ROM, then bus, with I/O
  contention dead last.
- **W11 + W12 (assembler + disassembler)** — planned as ONE track over one opcode
  table with round-trip as the joint oracle (ADR-0025), runnable in parallel with
  W10 (disjoint files).

**Scope-level default pinned here:** power-on/reset **RAM pattern = all-zero by
decision** — a real 48K is pseudo-random, so there is no oracle; provenance
`decision:ADR-0021`, explicitly **not** a hardware claim. Reset *registers*: the
Z80 `RESET`-defined control state (PC/I/R = 0, IM 0, IFF1 = IFF2 = 0) is `z80-spec`;
the registers the spec leaves **undefined** (SP, AF, and the GP/alternate/index
registers) power on **all-bits-set = 0xFFFF** as a `decision:ADR-0021` default (the
reference-emulator convention — `AF`/`SP` named here, the same all-bits-set default
applied to the rest of the uninitialised file). Gap D3; authored in
`machine-execution.md` (`MACHINE-RESET-CONTROL-001` / `-REGISTERS-001` / `-RAM-001`),
slice **W10.5 DONE 2026-06-29** (`MACHINE-RESET-001`).

**Deferred below this push (unchanged):** R-W4-05 toolkit regen → W5 scaffolding,
Phase 5 cutover (delete legacy emulator + assembler, merge to `main`), AY-3-8912 /
128K, A5 active-area timing, D4 residual contention, peripherals beyond §3.

**Coverage rows are added with their fixtures at authoring time** (the
`coverage.yaml` convention, header lines 9–10: *"real rows are added as
behaviors/fixtures are authored"*) — **not** pre-seeded as uncovered rows, which the
cutover gate would reject in the already-green emulator/assembler/gallery shards.
Each slice card in `tasks/roadmap.md` names the row IDs it will add.

### ADR-0022 — Screen host-visible split: emulator → palette index, gallery → RGB; one shared palette at level 205

**Status:** accepted (refines ADR-0016 for screen *content*). Gaps A2/A3/A4.

**Context.** The regenerated `@zx-vibes/ula`/`machine` decode no screen content;
legacy `display.js` pins INK/PAPER RGB at `0xD7 = 215` (bright-0) / `0xFF = 255`
(bright-1), while W8 `raster-border.md` pins the **border** at `205`
(`decision:ADR-0016`, noting "205 vs 215 is a rendering choice"). The exact RGB
triple is therefore **not** hardware truth (emulators disagree: 0xCD/0xD7/0xFF),
and two shipped levels would mismatch on one canvas.

**Decision.**
- The **host-visible split (ADR-0016) is refined for the screen**: the emulator
  boundary produces a **palette index 0–15** (hardware truth — hue, the BRIGHT bit,
  the FLASH ink/paper swap), decoded from the documented attribute bit layout
  (b0-2 ink, b3-5 paper, b6 bright, b7 flash) over the display-file thirds map
  (`dna/domain/memory-map.md`, slice W10.1). The **gallery** maps **index → RGB
  triple** (render policy).
- **One palette table** (8 hues × 2 bright levels) lives in
  `dna/product/palette.yaml`, **shared by border + screen**, default **level 205**
  (keeps the green W8 raster fixtures byte-identical). Legacy 215/255 is recorded as
  a cross-check, not adopted as hardware. The level is render policy (provenance
  `decision:ADR-0022`), revisable; a different level changes only the gallery
  fixtures.
- Fixtures split accordingly: emulator `attr-decode.json` (provenance `hardware`)
  asserts attribute + pixel + flash-phase → index 0–15 and FLASH (rejects a decoder
  that ignores BRIGHT or mis-swaps FLASH); gallery `screen-palette.json`
  (provenance `decision:ADR-0022`) asserts index → RGB via `palette.yaml`. New
  product spec `dna/product/screen-render.md` mirrors `raster-border.md`.

This is the no-fabrication move for the palette: the hue/bright/flash **decode** is
pinned as hardware; only the debated RGB **triple** is a recorded policy.

**APPLIED — W10.2 (2026-06-29).** The decode landed in `dna/domain/memory-map.md`
("Attribute & colour decode": `MM-ATTR-BITS-001`, `MM-ATTR-COLOUR-INDEX-001`,
`MM-ATTR-FLASH-001`, `MM-PIXEL-COLOUR-001`, all `hardware`) + `@zx-vibes/ula`
(`packages/ula/src/screen-attribute.mjs`: `attributeInk/Paper/Bright/Flash`,
`ink/paperColorIndex`, `flashPhase`, `pixelColorIndex`, `FLASH_FRAMES = 16`). The
palette landed in `dna/product/screen-render.md` (`SCREEN-PALETTE-001`) +
`dna/product/palette.yaml` (the single 16-entry table, shared with
`raster-border.md`; non-bright **205**, bright **255**). Fixtures: emulator
`attr-decode.json` (`SCREEN-ATTR-DECODE-001`, `hardware`, via `run-screen-fixtures.mjs`
kind `screen-decode-query`) + gallery `screen-palette.json` (`SCREEN-PALETTE-001`,
`decision:ADR-0022`, via `run-palette-fixtures.mjs` over `screen-palette-model.mjs`
reading `palette.yaml`). Two blind regenerations agreed byte-for-byte over all 256
attribute bytes × pixelOn × flash-phase + all 16 palette indices (no DNA gap). The
self-tests reject a BRIGHT-ignoring / FLASH-mis-swapping / INK-PAPER-swapped decoder
and a wrong-level (215) / BRIGHT-dropping palette. The non-bright 205 keeps the W8
raster border fixtures byte-identical; the level stays revisable render policy.
emulator **31/31**, gallery **9/9**, project **110/113**; all gates green. The 16K
FLASH-period (16 frames) + bit layout are grounded by
`docs/reference/attributes-and-colour.md`.

**ALSO APPLIED — W10.3 framebuffer (2026-06-29).** The same host-visible split governs the
`256 × 192` framebuffer assembly: `dna/product/screen-render.md` "Framebuffer assembly"
(`SCREEN-FRAMEBUFFER-001`, gallery, `decision:ADR-0022`) composes the SHIPPED `@zx-vibes/ula`
decode (the hardware-truth index) + the bitmap-bit extraction (`bit = 7 − (x&7)`) + the
`palette.yaml` RGB into the canvas. Reference `screen-framebuffer-model.mjs` +
`screen-framebuffer.json` via `run-framebuffer-fixtures.mjs` (kind `screen-framebuffer-query`)
+ self-test (rejects linear-addressing / LSB-first-bit / single-attribute / FLASH-ignored
renderers). It is the **integration** the per-decode rows (`SCREEN-ADDR-001` /
`SCREEN-ATTR-DECODE-001`) miss — the W8/consumer "broken screen" symptom. Two blind
regenerations agreed byte-for-byte with the shipped model over **4.1M pixels** (7 screens ×
12 frames), no DNA gap. gallery **10/10**, project **111/114**; all gates green.

### ADR-0023 — I/O-port contention: opt-in (default OFF) behind a two-blind-regeneration guard

**Status:** accepted. Brings gap **E1** into scope per the user's §3 call **without
reversing** the ADR-0011/0012/0016 defaults: supersedes their "explicitly out of
scope" stance → *"out of scope by default; opt-in available; witnessed by new
fixtures."*

**Context.** The user chose E1 (I/O-port contention — the C:1/N:3 pattern by port
parity/range) "in." But (a) there is **no within-repo per-case oracle** for it —
FUSE times *memory* contention only; ADR-0010 already had to tag the
memory-contention row `hardware` (not `fuse`) for exactly this reason — and (b)
ADR-0016's `HOST-IO-PORTFE-IO-CONTENTION-001` pins "no I/O-port stall" with the
green `port-fe-iotime.json` 11T/21T values; a naive reversal would break W8.

**Decision.**
- Model the documented 48K I/O-contention pattern as an **opt-in machine mode**,
  `createMachine({ ioContention: true })`, **default OFF**. Default-OFF keeps
  ADR-0011/0012/0016 and the W8 `port-fe-iotime.json` byte-identical and green (the
  ADR-0012 `exactContention` precedent). Provenance `hardware`.
- **No-fabrication guard (the ADR-0009 device):** the pattern ships as `hardware`
  only if a **two-blind regeneration** reproduces it identically from the DNA. If
  the two disagree and only the legacy code discriminates → **STOP, record
  `UNKNOWN:emulator:IO-CONTENTION-001`, defer** (never fabricate). This is the one
  place where C5 / no-fabrication can legitimately override the ratified "E1 in"
  scope; flagged to the user at planning.
- The intra-instruction I/O-cycle offset (`HOST-IO-PORTFE-IO-OFFSET-001`, a tracked
  refinement) may need to land first, since I/O contention depends on the exact
  I/O-cycle T-position.

**OUTCOME — W10.14 (2026-06-30): GUARD FIRED → DEFERRED (`UNKNOWN:emulator:IO-CONTENTION-001`).**
A read-only investigation confirmed the guard's defer condition. (1) **No within-repo per-case
oracle** (FUSE times memory contention only). (2) The **only in-repo discriminator** — legacy
`io-interface.js` `applyContention` over `ula.js` `getPortContentionDelay` — is non-authoritative
twice over: it anchors the frame T-state at the **rejected 14384** display geometry
(ADR-0002/0010/0011, off by 49 T from the DNA's 14335) and models only a simplified
even-port-reuses-the-memory-delay pattern, **not** the documented four-case range×A0 table.
(3) The `HOST-IO-PORTFE-IO-OFFSET-001` prerequisite is **unresolved** — the `step()`/`io.write`
contract does not expose the intra-instruction I/O-cycle T-offset that the pattern needs. A
two-blind regeneration would read no authority and so prove only spec-clarity, not correctness (the
ADR-0026 floating-bus problem). Per this ADR's no-fabrication clause the opt-in mode is **not
shipped**: the default stays I/O-contention-OFF (the green W8 `port-fe-iotime.json` 11T/21T,
byte-identical), and the gap is recorded as `UNKNOWN:emulator:IO-CONTENTION-001` (backlog above) — a
tracked deferral, not silent debt, deliberately not a coverage row. **Track E and W10 are thereby
complete** (13 slices shipped + this 1 tracked deferral). Unblocked when the I/O-cycle offset lands
AND a citable per-case authority is pinned, or a consumer needs it. The user was flagged this
possible outcome when ratifying ADR-0023.

### ADR-0024 — ROM as an opaque artifact (pinned manifest); tape layering; EAR issue 3

**Status:** accepted. Gaps **C2 / B1 / B2 / B3 / B5 / E4 / G1**; closes the deferred
C2 "ROM as artifact" decision now that ROM edge-loading makes the blob load-bearing.
**Progress:** C2 (W10.8), B1 (W10.6), B2 (W10.7), G1 (W10.4), **B3 + E4 (W10.10) DONE**,
**B5 instant/trap load (W10.11) DONE** — **all ADR-0024 gaps now closed.**

**Decision.**
- **ROM = opaque blob via a pinned manifest. DONE — W10.8 (2026-06-29, `ROM-ARTIFACT-001`,
  trivial-tier).** The 16384-byte ROM (sha256 `d55daa43…cb42`) is vendored DNA-side at
  `dna/conformance/rom/spectrum-48k.rom` (a DNA-owned copy so the conformance layer does
  **not** depend on the legacy `packages/emulator` or any product — it survives the Phase-5
  legacy deletion) and pinned by `dna/conformance/rom/spectrum-48k-rom.manifest.json`
  (size / sha256 / mapping 0x0000–0x3FFF / license / source / `LD-BYTES` 0x0556), provenance
  `decision:ADR-0024`. **Schema note:** the external-suites manifest validator requires
  `vcs:"git"` + a 40-char commit (designed for git-hosted test suites), which does **not** fit
  an Amstrad binary, so W10.8 uses a dedicated `dna/conformance/rom/` runner (`run-rom-fixtures.mjs`
  re-hashes the blob + checks mapping/entry-point; `run-rom-fixtures-self-test.mjs` is the guard)
  rather than the `external/` mechanism. The ROM stays **opaque** — no `rom-entry-points.md`; only
  `LD-BYTES` `0x0556` is referenced (by the W10.10 tape edge-load). Authored as `MM-ROM-ARTIFACT-001`
  in `dna/domain/memory-map.md`. **Licensing:** Amstrad permits free, unmodified redistribution as
  part of an emulator with the notice retained (kept in the manifest); commercial use needs written
  permission. Publish-time: per this ADR, published tarballs should resolve the ROM from a user path,
  not vendor it — the DNA copy is for the conformance layer (the W10.10 integration oracle) + this
  identity check only.
- **Tape layering.** `.tap` (B1) / `.tzx` (B2) / `.scr` (G1) **byte layouts** are
  authored in the new domain authority `dna/domain/file-formats.md` (the domain
  README's "planned, unwritten" file; provenance: published format specs, pin a
  version + URL; checksums derived) — tier contract. **`.scr` (G1) DONE** (W10.5 era,
  W10.4 slice, `FORMAT-SCR-001`, provenance `hardware`). **`.tap` (B1) DONE — W10.6
  (2026-06-29, `FORMAT-TAP-001`, fidelity-tier).** Block stream `[len:2 LE][flag][data][XOR]`
  in `dna/domain/file-formats.md` `FMT-TAP-*`; `tapChecksum`/`parseTap`/`serializeTap` in
  `@zx-vibes/machine` `tap-format.mjs` (beside the `.z80` codec). **Provenance pinned to
  `contract`, not "published-spec-with-URL":** following the `.z80`/`.sna` precedent in the
  same file, `.tap` is an external community file-format **convention** (the 2-byte LE length
  prefix + block concatenation are the container — no hardware mandates them and there is no
  single versioned `.tap` authority to URL-pin), so `contract` is the honest tag; the bytes
  *inside* a block (flag, XOR checksum) mirror the 48K ROM tape block and become `hardware`
  when the EAR pulse model lands (W10.9). The **version+URL pin** therefore applies to `.tzx`
  (W10.7 — a formally versioned spec), not `.tap`. Two blind regenerations agreed byte-for-byte
  (no DNA gap); the self-test rejects a big-endian length / a length omitting the checksum / a
  checksum over data only / a parser skipping validation. **ROM edge-loading** (B3) is
  hardware: the real ROM LD-BYTES consumes the EAR edge stream (pilot 2168T, sync
  667/735T, bit 855/1710T) fed into port 0xFE b6 (extends the W8 read model).
  **DONE — W10.10 (2026-06-29, `TAPE-EDGE-LOAD-001`, fidelity-tier):** the opaque ROM
  `LD-BYTES` (0x0556) is driven by a tape-deck `io` adapter (b6 from a **monotonic** tape
  cursor, `TAPE-EDGE-CLOCK-001`) with the register contract `IX`/`DE`/`A`/CARRY
  (`TAPE-EDGE-LDBYTES-001`); the model appends the inter-block pause's closing edge so the
  final bit terminates (`TAPE-EDGE-TRAILING-001`). `createTapeDeck`/`edgeLoad` in
  `@zx-vibes/machine` (`tape-edge-load.mjs`); `dna/domain/tape-loading.md` "Edge loading"
  `TAPE-EDGE-*`. CI smoke = a short data + header block; the self-test rejects a no-edge
  deck, a 0/1 bit-length swap, a dropped sync, and a frame-modulo clock. Two blind
  regenerations agreed on RAM-identity (no DNA gap).
  **Instant/trap load** (B5): **DONE — W10.11 (2026-06-30, `TAPE-INSTANT-LOAD-001`,
  fidelity-tier).** `instantLoad` (`@zx-vibes/machine` `tape-edge-load.mjs`, beside `edgeLoad`)
  reproduces the real ROM `LD-BYTES` result for the same block **without** running the ROM or
  the pulse stream, in **zero** machine time; `dna/domain/tape-loading.md` "Instant / trap
  loading" `TAPE-INSTANT-*` (the trap *mechanism* `TAPE-INSTANT-CONCEPT-001` = `decision:ADR-0024`;
  what it must *produce* `-RESULT-001`/`-FLAG-001`/`-EQUIV-001` = `hardware`, the LD-BYTES result).
  The oracle is **`instant == edge`** (`TAPE-INSTANT-EQUIV-001`): the CI runner
  `run-tape-instant-load-fixtures.mjs` loads each block **both** ways and asserts they agree on
  the observable `{ok, bytesLoaded, RAM}` and both equal the source bytes — a mutual cross-check
  against the real ROM, **fabrication-free** (only the observable triplet is the contract; the
  loaders' internal `reason` is not — the ROM may time out where instant names the cause). The
  self-test anchors `instant == edge` against the real ROM on 5 judge blocks (incl. the
  flag-mismatch and corrupt-checksum **failure** cases — instant matches there too), agrees with
  an independent reference over all 256 flags, and rejects four broken instant models
  (ignore-flag-mismatch / skip-checksum / store-flag-and-checksum / wrong-byte-count). **Two
  blind regenerations agreed with the shipped model AND the real ROM over 3584 cases + the
  real-ROM anchors (no DNA gap).** This was the last open ADR-0024 gap.
- **Integration oracle (fabrication-free)**, by closing a loop over already-conformed
  components: assemble program P with the conformed assembler → wrap to `.tap` with
  the conformed `.tap` writer → edge-load through the real ROM → **assert loaded RAM
  == P** (and a `.tap` that *is* a 6912-byte screen renders the expected pixels).
  **DONE — W10.10 offline acceptance (`TAPE-EDGE-LOAD-ACCEPT-001`):**
  `dna/conformance/tape/run-tape-edge-load-accept.mjs` assembles a 115-byte CODE program
  (org 0x8000) with `@zx-vibes/asm` + a 17-byte tape header, serializes to `.tap`,
  round-trips through `parseTap`, and edge-loads both blocks on one machine — **both load
  byte-identical** (header 17 B → 0x9000, code 115 B → 0x8000), `LD-BYTES` returns success.
  Recorded offline pass **2026-06-29** (every component conformed → the expected value is
  the assembled bytes, no fabrication). Offline like the zex rows; not in `conformance:check`.
- **EAR issue 2/3 (E4): DONE — W10.10 (2026-06-29).** Default **Issue 3** (the common later
  48K; idle b6 tracks the last b4 written), `decision:ADR-0024`; this revised
  `HOST-IO-PORTFE-READ-BITS-001` and added `HOST-IO-PORTFE-EARIN-IDLE-001`
  (`dna/domain/host-io-port-fe.md`) + `TAPE-EDGE-IDLE-001` (`tape-loading.md`), unit-checked
  in the edge-load self-test (write b4 → idle b6 reads it back). Issue 2 (idle b6 tracks the
  last b3/MIC write) recorded as the known alternative, **not** modeled. Gap **E4 drained**.

### ADR-0025 — W11/W12: one opcode table is the single authority; octal decoder is an offline generator; round-trip is the joint oracle

**Status:** accepted. Unparks the ADR-0008 grind and gives W11 (assembler encoding)
+ W12 (disassembler decoding) one shared design — they are the same
encoding ↔ mnemonic bijection.

**Context.** `dna/domain/z80-opcodes.yaml` is `status: partial` — even the base ISA
lacks the ALU group and **all** CB/DDCB/FDCB families (zero rows).
`packages/asm/assembler.ts` passes 52 ASM-EMIT rows for the authored subset;
`packages/asm/disasm.ts` is a self-contained octal decoder that does **not** read
the table. The CPU (`packages/cpu/src/z80-step.mjs`) is a computed octal decoder
that already proves *execution* of the whole ISA via FUSE.

**Decision.**
- **The table is the single authority (C2).** Complete `z80-opcodes.{md,yaml}` to
  the full documented ISA (CB/DDCB/FDCB families incl. the `SLL`/`SLI` alias and the
  undocumented DDCB result-copy forms; the base ALU group; ED block ops / NEG /
  RRD-RLD; DD/FD index + legal index-half forms). Then regenerate **both**
  `assembler.ts` (encode mnemonic → row → bytes) and `disasm.ts` (decode
  bytes → row → mnemonic) to consume the normalized table — eliminating the
  hardcoded decoder. The CPU's proven octal decoder + the current `disasm.ts` become
  an **offline generator** that emits candidate table rows, ratified by diff (the
  ADR-0008/0009 generator + differential device) — not a second runtime authority
  (no drift).
- **Round-trip is the joint oracle.** `conformance/asm/roundtrip.mjs`:
  `assemble → bytes → disasm → mnemonic → assemble → bytes'`, assert
  `bytes == bytes'`. DISASM mnemonics are validated by **re-assembly identity**, not
  hand-keyed (the table's canonical syntax disambiguates aliases, e.g. `JP (HL)` vs
  `JP HL`). **FUSE seeds byte coverage:** a build tool enumerates the distinct opcode
  byte-prefixes in `conformance/cpu/fuse/*.json` so every opcode the CPU *executes*
  is also encoded, decoded, and round-trips (FUSE carries bytes, **not** mnemonics —
  the round-trip supplies those). Extend `z80-opcodes-check.mjs` with a
  **decode-uniqueness** check (each byte sequence → exactly one canonical row).
- Out of scope: full sjasmplus compatibility (`ASM-PROD-SCOPE-003`).

### ADR-0026 — Floating bus (E2): scoped hardware facts now; the timing-exact in-window byte deferred with A5

**Status:** accepted. Gap **E2** (W10.12). Refines ADR-0021's assumption that E2 was
a clean, no-ADR "hardware fact" — on contact with the actual timing it is not.

**Context.** ADR-0021 admitted floating bus (E2) "in" as a `hardware` fact with no
separate ADR. Building it surfaced a real conflict: the floating-bus value during the
active display **is** the byte the ULA is fetching at that frame T-state, so it needs
the exact **T-state → fetched-byte** mapping — which is precisely the **A5 active-area
pixel timing that ADR-0021 deferred**. Three findings:
1. **No documented-hardware authority in the repo** pins the phase mapping (which of a
   character cell's four fetch T-states carries the display byte, which the attribute
   byte, which are idle). `docs/reference/` has nothing; `ula-timing.md` stops at the
   contention *delay* + window. The phase mapping is the most machine-variant detail in
   ULA timing.
2. The **only** in-repo code that computes it — legacy `floatingBusAddressForTstate`
   (`packages/emulator/src/spectrum/video-timing.js`) — anchors the first display fetch
   at frame T **14384** (`64×224+48`), the legacy display-latch geometry that
   **ADR-0010/0011 explicitly rejected** in favour of **14335**. So it is both
   non-authoritative (ADR-0002) and inconsistent with this project's pinned timing; its
   `reads.json` numbers (14384→`0x4000`) are off by 49 T under the DNA.
3. A two-blind-regeneration guard cannot rescue the in-window value: the regens read the
   spec, so agreement proves spec-clarity, not hardware-correctness. Pinning a
   reconstructed phase mapping as `hardware` would mislabel a from-memory reconstruction.

**Decision (user call, 2026-06-30 — "scope it: clean facts now, defer the value").**
- **Pin the oracle-backed facts** in `dna/domain/ula-timing.md` ("Floating bus"),
  provenance `hardware`:
  - `ULA-FLOATBUS-PORT-001` — the ULA decodes I/O on `A0`: it drives every **even**
    port (`A0=0`, the keyboard/EAR read); an `IN` from an **odd**, undriven port reads
    the floating bus (the canonical port is the odd `0xFF`). *This corrects the seeded
    roadmap's imprecise "unmapped **even**-port" phrasing — even ports are ULA-driven.*
  - `ULA-FLOATBUS-IDLE-001` — outside the active display-fetch window (= the contended
    window of `ULA-TIME-CONTENTION-WINDOW-001`, anchor **14335**) the idle bus floats
    high and a floating read returns **`0xFF`**.
  - `ULA-FLOATBUS-FETCH-001` — inside the window the value reflects the ULA-fetched
    display/attribute byte (the address per `memory-map.md`) — the concept that lets a
    program raster-sync off an odd port.
- **Defer the timing-exact in-window byte** (`ULA-FLOATBUS-DEFER-001`, provenance
  `decision:ADR-0026`): the exact T-state → byte phase mapping is the deferred A5 timing
  and is **not pinned**. A conformant model reports the in-window value as **unmodelled**
  (`{ value: null, modeled: false }`) rather than fabricating a byte. The window anchor is
  the DNA's **14335**, never the legacy **14384**. Unblocked when A5 is taken up.
- **Impl:** `portFloats` / `floatingBusByte` / `activeDisplayFetch` + `FLOATING_BUS_IDLE`
  in `@zx-vibes/ula` (`packages/ula/src/floating-bus.mjs`), re-exported from the ula index
  and the machine entry; the active-fetch window reuses the `ula-timing.mjs` contention
  constants (no new timing anchor). **Conformance:** `dna/conformance/timing/floating-bus.json`
  (`BUS-FLOATING-001` hardware = port-decode + idle-`0xFF` + window boundary;
  `BUS-FLOATING-DEFER-001` = the in-window deferral made executable) via
  `run-floating-bus-fixtures.mjs` + a self-test (an independent reference; four broken
  models rejected — always-idle which fabricates an in-window `0xFF`, even-floats,
  legacy-14384-anchor, whole-line-window; a full-frame shipped-vs-reference sweep).
- **Tier:** by scoping out the only ambiguous part, the residual slice is **trivial-tier**
  (the fidelity-tier double-blind-regen would have applied to the deferred in-window
  timing, which is not built). C5 holds: every shipped fact traces to `hardware`; the gap
  is a recorded deferral (alongside A5), not a silent debt and not an open `UNKNOWN`.

### W10.13 — Kempston joystick (F1): executes ADR-0021's ratified scope; no new ADR

**Status:** done (2026-06-30, `JOY-KEMPSTON-001`, trivial-tier). **No new ADR** — the
slice executes the scope ADR-0021 already ratified ("bus / peripherals — ALL …
Kempston (F1) … port `0x1F` active-high `000FUDLR`"), and unlike floating bus (E2 →
ADR-0026) it surfaced **no** conflict: the Kempston read is a clean, oracle-stable
hardware fact.

- **Pinned `hardware`** in NEW `dna/domain/peripherals.md` ("Kempston joystick"):
  `JOY-KEMPSTON-READ-001` — a read returns the **active-high** byte `000FUDLR`
  (bit0 R / bit1 L / bit2 D / bit3 U / bit4 F; bits 7-5 always `0`; idle `0x00`; the
  five controls independent, so Left+Right = `0x03` is not masked); and
  `JOY-KEMPSTON-PORT-001` — the canonical port is low byte **`0x1F`**, the high address
  byte **don't-care** (so any port whose low 8 bits are `0x1F` decodes). Because `0x1F`
  is **odd**, the Kempston, when fitted, is what carves `0x1F` out of the floating
  odd-port set (`ula-timing.md` ULA-FLOATBUS-PORT-001, W10.12).
- **Scope call (no ADR needed):** finer **incomplete decoding** (clones that respond to
  any `A5 = 0` port, aliasing `0x1F` across a wider range) is interface-specific and
  **out of scope** — ADR-0021 named only `0x1F`, so pinning exactly that low-byte decode
  (with high-byte don't-care, the standard `IN A,(C)` reality) executes the ratified
  scope rather than introducing a new decision. The active-high sense (opposite the
  keyboard's active-low even-port read) and bits 7-5 = `0` are the documented hardware.
- **Impl:** `kempstonByte` / `kempstonDecodes` + `KEMPSTON_PORT` and the five bit masks
  in `@zx-vibes/ula` (`packages/ula/src/kempston.mjs`) — shipped **beside** the
  floating-bus model (both resolve an `IN` from the I/O bus; the Kempston decode is the
  floating-bus carve-out) — re-exported from the ula index and the machine entry.
- **Conformance:** NEW area `dna/conformance/peripherals/` (registered in `runner.mjs` +
  `provenance-lint.mjs`, area `emulator`): `kempston.json` (`JOY-KEMPSTON-001`, 19 cases)
  via `run-kempston-fixtures.mjs` + a self-test (independent reference; four broken
  models rejected — active-low / ud-swap / dirty-top-bits / decode-shift; a full
  32-combination + 16-bit-port sweep, 256 decoding ports). emulator **42/42**, project
  **122/125**. C5 holds: every fact traces to `hardware`; no `UNKNOWN`, no deferral.

### ADR-0027 — Toolkit v2: rebuild from scratch on the reconstructed packages; six scope calls

**Status:** **ACCEPTED** — ratified 2026-06-30 via the `intake.html` scope form (export
pasted back). All recommended defaults adopted **except D4**, which the user overrode (see
**Ratification** below). Reframes R-W4-05 from a clean-room regeneration of the *existing* toolkit DNA into a
**product redesign**. Connects to ADR-0005 (skills/docs from DNA — resolved here),
ADR-0013 (deferred toolkit rows), ADR-0014 (product boundaries), ADR-0015 (CLI
conformance asserts the contract). Full analysis: `toolkit-redesign-review.md`.

**Context.** The user chose to rebuild `@zx-vibes/toolkit` from scratch rather than port
the legacy package. A review graded every capability against the mission — *a code agent
writes, runs, sees, and proves a ZX Spectrum 48K Z80 game headlessly* — along three
pillars: **P1 knowledge** (skills/docs/recipes, the moat), **P2 the loop**
(build→run→verify + the declarative test DSL), **P3 cheap observability** (the hang
watchdog with named verdicts + the "cheap eyes"). It produced a keep/modify/remove/add
matrix and surfaced six scope calls that change *what the product is*.

**Decision — product shape (adopted).** v2 is *"a knowledge pack + a tight, idempotent,
JSON-first loop"*: CLI-first and exit-code-first; **stateless/fresh by default** (session
resume is an explicit opt-in for interactive debugging); re-based on the reconstructed,
conformance-gated `@zx-vibes/{cpu,ula,machine,asm}` (legacy `@zx-vibes/emulator` deleted,
C4); the knowledge **derived from / tracing to the DNA** so it cannot rot. The review's
keep/modify/remove/add matrix is the target surface.

**Decision — the six scope calls (RECOMMENDED defaults; confirm or override each):**

- **D1 — 128K + AY sound: OUT for v2 (48K-only), explicitly documented.** The single
  largest hardware/knowledge gap (no AY-3-8912, no memory paging) excludes the whole 128K
  game class; bringing it in roughly doubles the surface. Ship a documented "48K-only"
  scope line now; revisit as a v3 theme. *(Override = in-scope now → adds AY emulation +
  paging + matching skills/recipes.)*
- **D2 — MCP server: KEEP, thin and optional; CLI is canonical.** Justified by exactly two
  wins — inline `image` content for vision models and a hot in-memory session for
  interactive debug. Close its one real advantage over the CLI by adding a CLI
  `screen --base64`/data-URI mode. *(Override = CLI-only, drop MCP.)*
- **D3 — External `sjasmplus` backend: DROP from the default story.** `@zx-vibes/asm` is
  now the single, table-driven, round-trip-verified, conformance-gated assembler (W11+W12);
  a second assembler is a second source of truth to keep green. Keep at most a documented
  escape hatch, not in the default narrative or the "spectral" naming lead. *(Override =
  retain as a first-class opt-in backend.)*
- **D4 — Browser player (`preview`/`boot`/`play`): collapse to ONE optional `preview`;
  relocate the player to the gallery product (ADR-0014).** Inherently interactive; the
  headless agent loop never needs it. *(Override = keep a player in the toolkit core.)*
  **→ RATIFIED AS THE OVERRIDE (2026-06-30):** the browser player stays a first-class
  **core** toolkit capability (it is *not* relocated to the gallery). The verb surface
  still collapses `boot`/`play` → one `preview` (per the adopted removals); the override
  changes only *where the player lives*, not the verb count. Rationale: the player is a
  cheap, useful human-handoff for the agent's operator and keeping it bundled avoids a
  cross-product hop for a capability the toolkit already owns.
- **D5 — Reverse-engineering surface (`snapshot`/`gfx find/font/sheet`/`scan`/`xref`):
  SPLIT into an optional add-on (e.g. `@zx-vibes/reveng` or a clearly-marked subcommand
  group), not core.** These inspect *third-party* games; an agent *building* its own rarely
  needs them. Keep the `zx-reverse-engineering` skill as knowledge. *(Override = keep in
  core.)*
- **D6 — Knowledge-moat growth order: scrolling + collision FIRST,** then level/map data,
  then new genre skills (maze/chase, flip-screen exploration, isometric), then a
  text-adventure starter. Today's skills stop at paddle/pong-class games; these are what
  make *real* games. *(Override = a different priority order.)*

**Additions adopted** (mission-driven, review §3.4): a `symbols`/`labels` SLD dump (the
biggest autonomous-debug gap); visual regression (golden-image capture + a `screenDiff`
assertion); **Kempston joystick input** in `run`/`test` (DNA W10.13 models it but the CLI
cannot drive it); `.tap`/`.scr`/`.z80` build outputs (DNA W10.4/6/7 + edge/instant load
W10.9–11); `init` (scaffold into an existing dir) + `clean`; a code-reached/coverage
report; and temporal/checkpoint + memory delta/range assertions in the test DSL.

**Method (two-level change).** Unlike W3/W9/W10 (clean-room regen of a *fixed* DNA), v2
re-authors the toolkit DNA first, then regenerates. **Phase 0** re-scopes
`dna/product/{cli,mcp-tools,toolkit-runtime,recipes-and-assertions,config-schema}.md` and
sets the skills/reference sourcing per **ADR-0005** (hardware/domain reference generated
from `dna/domain/`; agent skills + pedagogy authored in `dna/product/`). **Then** the
regeneration slices implement the new contract on the reconstructed cores. ADR-0015 still
holds — CLI conformance asserts the *contract*; the contract is the re-scoped DNA, never
legacy bytes (ADR-0001/0002). The clean-room-implementer rule (read `dna/` only) applies
to the *implementation* slices, not to this review/re-author phase.

**Consequences.** **Resolves ADR-0005** (skills/docs from DNA) as part of this workstream.
Revises `plan-w4-toolkit-regen.md` (adds Phase 0 DNA re-author; re-bases the architecture).
The dropped scope (D1, D3, D5) is recorded here so it is **not silent debt** (C5). The
three deferred toolkit/scaffolding rows (ADR-0013) still flip at the v2 cutover.

**Ratification (2026-06-30).** Confirmed via the `intake.html` intake form (export pasted
back). Product shape + stateless-default + **D1 / D2 / D3 / D5 / D6** + every adopted
addition and removal accepted at the recommended defaults. **Sole override: D4** — keep the
browser player as a first-class **core** capability instead of relocating it to the gallery
(the `boot`/`play` → `preview` verb collapse still stands; only the player's *home* changes).
ADR-0027 moves **PROPOSED → ACCEPTED**; `plan-w4-toolkit-regen.md` is accepted and **Phase 0
is unblocked**. First deliverable: **Phase 0.1 — re-scope `dna/product/cli.md`** to the v2
command set. Implementation slices (Phase 1+) stay clean-room (read `dna/` only).

### Tracking convention

Actual `UNKNOWN` provenance in DNA artifacts must be tracked with a stable key:
`UNKNOWN:<area>:<id>`. The area is the coverage row area, fixture area, or DNA
layer (`domain` / `product`) for Markdown claims. The id is the coverage row id,
fixture id, or Markdown `[id: ...]` tag. Candidate investigations that are not
yet DNA provenance may remain prose until they become actual `UNKNOWN` entries.

### ADR-0027 implementation gaps (W4 toolkit v2 regeneration)

Tracked so the regeneration's known limitations are **not silent debt (C5)**.

- **W4-GAP-01 — emulator memory-READ bus hook (read watchpoints).** Found in
  Slice 3 (`run`). `--watch-read <range>` is spec-mandated by CLI-PROD-RUN-003,
  but `@zx-vibes/cpu` / `@zx-vibes/machine` index memory as a raw `Uint8Array`
  with **no read-bus hook**, so a memory *read* cannot be observed. Write-side
  stops (`--watch-write` / `--until-write` / `--until-change`) work via
  per-instruction memory diffing; beeper/port writes are observable via the
  machine's settable `io.write` (so RUN-BEEPER-001 is satisfied — this gap is
  read-only). **Interim (shipped):** `--watch-read` fails loudly with
  `ENV_ERROR` (exit 3) naming the missing core capability and the working
  alternatives — never accept-and-never-fire. The toolkit-side `watchRead`
  plumbing is left dormant. **Proper fix:** add an additive, behavior-neutral
  `onMemoryRead`/bus-read hook to the emulator core surface (an *emulator*
  product change with its own conformance), then drop the two guards in
  `packages/toolkit/src/runtime/run.ts` to activate the dormant plumbing. Owner:
  emulator product; revisit at the Slice 7 `watch` command and/or a future
  emulator-surface pass.

- **W4-GAP-02 — core `.z80` v1 emission (`state export --z80`).** Found in Slice
  7b. CLI-PROD-STATE-001 (contract) mandates `state export --z80 <file>` emit a
  `.z80` **v1** snapshot, but the reconstructed core `writeZ80(snapshot)` takes a
  single argument and hardcodes **v3** (no version param). The `.z80` format is
  domain-authoritative (FF-Z80-001, `dna/domain/snapshot-z80.md`), so the toolkit
  should not own format serialization. **Interim (shipped):** the toolkit
  hand-rolls a v1 encoder (`exportZ80Bytes` in `state-command.ts`) from the
  documented v1 layout, **validated by round-tripping through the core's
  `readZ80` (which decodes v1/v2/v3) → version===1**; a PC=0 session fails loud
  (v1 cannot encode PC=0). The duplication risk is low (v1 is a frozen format,
  pinned by the readZ80 round-trip) but real. **Proper fix:** give the core
  `writeZ80` a version arg (add v1 emission with its own formats fixture), then
  have the toolkit delegate. Note `build --z80` (CLI-PROD-BUILD-003) is spec-silent
  on version and may keep the core's v3 — the two `.z80` paths can differ by
  contract. Owner: emulator product; revisit at the Slice 12 cutover or a future
  emulator-surface pass.

- **W4-GAP-03 — core `.sna` reader (`preview <file.sna>`, `.sna` sources).** Found
  in Slice 8a/8b. CLI-PROD-PREVIEW-002 lists `.sna` among the `preview <file>`
  image types, but `@zx-vibes/machine` ships **no `.sna` codec** (`readZ80`/
  `writeZ80` exist; no `readSna`/`writeSna`). FF-SNA-001 is contract-tier but the
  reader is unshipped. **Interim (shipped):** `preview <file.sna>` fails loud
  (USER_ERROR, exit 1) naming the missing core codec before any read — never a
  silent mis-load; `.z80`/`.tap`/`.tzx` images work. **Proper fix:** add a `.sna`
  reader to the emulator core (`readSna`, with its own formats fixture per
  `dna/domain`/`file-formats.md`), then wire `preview`/observe `.sna` sources to
  it. Owner: emulator product; revisit at a future emulator-surface pass. Until
  then CLI-PROD-PREVIEW-002's `.sna` type is intentionally unsatisfiable.

- **W4-GAP-04 — physical cutover DEFERRED (legacy still has live cross-product
  consumers).** Found at Slice 12 cutover. The v2 `@zx-vibes/toolkit` regeneration
  is COMPLETE and toolkit-scoped-green (Slices 1–11 + the pre-cutover reconciliation
  of the second-blind-audit divergences; build/typecheck/lint + 284 tests +
  `conformance:check:toolkit` 2/2 + cli/mcp/reveng self-tests). But **deleting the
  two legacy packages is not cleanly possible yet**, so the physical cutover
  (R-W4-07) is deferred and the legacy is kept excluded:
  1. **`@zx-vibes/emulator`** is still the **gallery's** live browser emulator
     (`gallery/zxgeneration.esm.js` + `gallery/**`), and is wired into `check:drift`
     (→ `verify`) via `check:gallery-bundles` + `check:emulator-env-template`. The
     v2 toolkit itself has **zero** emulator dependency (its player runs the
     reconstructed `@zx-vibes/machine`); only the gallery product still needs it.
  2. **`packages/toolkit-legacy`** still HOLDS the **knowledge-pack corpus**
     (`templates/`, `examples/`, `recipes/`) that v2 **defers** regenerating
     (KP-PROD; `setup` reports it under `deferred[]`). Four consumers reference that
     corpus at the *old* path `packages/toolkit/{templates,examples,recipes}/...`:
     `dna/conformance/assembler/corpus.json`, `packages/asm/tests/assembler.test.ts`
     (the "Spectral corpus compatibility" suite), `gallery/games/*/meta.json`
     (`sourcePath` for arkanoid-quickstart + pong-by-agent), and
     `scripts/check-version-consistency.js`. Because the Slice-1 **preflight rename**
     (`packages/toolkit` → `packages/toolkit-legacy`) moved that corpus, those four
     references have been broken since the preflight, so **the full-monorepo
     `pnpm test`/`verify` has been red since Slice 1** (the toolkit-scoped slice
     gates never exercised the asm corpus / gallery / drift). The surviving v2
     canonical templates are the root `starters/{game,platformer}/src/main.asm`
     (W5); the legacy `examples/`/`recipes/` have no v2 home yet.
  **Proper fix (a coordinated cross-product deliverable, NOT a toolkit slice):**
  regenerate/re-home the knowledge-pack corpus per KP-PROD (or re-point the four
  consumers to `starters/` + the regenerated recipes/examples), migrate the gallery
  off both the legacy example `sourcePath`s and `@zx-vibes/emulator` (onto the
  reconstructed cores), update `check:version-consistency`/`check:gallery-bundles`/
  `check:emulator-env-template`; THEN delete `packages/toolkit-legacy` +
  `@zx-vibes/emulator` and restore the `pnpm-workspace.yaml` glob. Owner: needs a
  user call on scope/sequencing (knowledge-pack + gallery workstreams). Interim:
  legacy kept excluded; the umbrella `zx-vibes` bins re-wired to the v2 barrel
  (`runCli`/`runMcp`) so the umbrella works against v2 (its smoke test is green).
