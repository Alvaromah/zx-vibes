# Conformance — the decider

The executable acceptance gate. **This decides correctness, not the prose.** A
regeneration is accepted iff the suite is green for its slice (`../../specs-plan.md`
§6).

## Fixture contract

Each fixture MUST declare: `id`, `tier` (contract | fidelity | incidental),
`provenance`, `input`, `expected`, and a normalization profile for
non-deterministic fields.

The executable schema lives at `schema/fixture.schema.json`. The runner currently
validates JSON fixtures in `assembler/`, `cli/`, `cpu/`, `formats/`, `machine/`,
and `timing/`; an empty suite is valid during W0 bootstrap.

```bash
pnpm run conformance
pnpm run conformance:self-test
pnpm run conformance:normalization-self-test
pnpm run external-suites:check
pnpm run external-suites:self-test
pnpm run external-suites:adapters-self-test
pnpm run external-suites:payloads-self-test
pnpm run external-suites:fuse-reference-self-test
pnpm run external-suites:zex-cpm-self-test
pnpm run oracle:capture-self-test
pnpm run distribution:check
pnpm run domain:z80-opcodes-check
pnpm run domain:z80-opcodes-self-test
pnpm run assembler:cli-fixtures
pnpm run assembler:cli-fixtures-self-test
pnpm run assembler:api-fixtures
pnpm run assembler:api-fixtures-self-test
pnpm run assembler:corpus-fixtures
pnpm run assembler:corpus-fixtures-self-test
pnpm run coverage:check
pnpm run coverage:self-test
pnpm run provenance:check
pnpm run provenance:self-test
```

## Deterministic profile and CLI snapshots

`profiles/deterministic-run.json` is the W0 deterministic run profile. It fixes
`TZ=UTC`, `LC_ALL=C`, disables color, and provides a fixed RNG seed, frame count,
and T-state budget for fixture authors. `determinism.mjs` exposes helpers for
running child processes with that environment.

`normalization.mjs` normalizes CLI snapshot output. The `cli-snapshot` profile
redacts version strings, absolute paths, timestamps, build hashes, ports, and
temporary directories so two equivalent runs can be compared byte-for-byte.

## Coverage gate

`coverage-check.mjs` validates `coverage.yaml` in CI. Default mode validates the
ledger shape and enforces that rows already marked `covered` reference real
fixtures. It also enforces the inverse: every `.json` fixture the runner would
discover under the fixture directories MUST be referenced by at least one ledger
row, so a fixture can never sit on disk with no behavior pointing at it (an
orphan). Cutover mode is stricter:

```bash
node dna/conformance/coverage-check.mjs --cutover assembler
node dna/conformance/coverage-check.mjs --cutover all
```

In cutover mode every matching `contract` or `fidelity` row MUST be `covered`,
have non-`UNKNOWN` provenance, and reference at least one existing fixture.

## Provenance lint

`provenance-lint.mjs` checks that coverage rows, JSON fixtures, and authored
`domain/` / `product/` Markdown claims carry an approved provenance tag. Markdown
claims are explicit `[id: ...]` records with inline `[provenance: ...]` tags or
a preceding `<!-- provenance: ... -->` directive. Any `UNKNOWN` provenance must
be tracked in `.harness/decisions.md` using `UNKNOWN:<area>:<id>`, and any
`decision:<id>` provenance must point to an accepted ADR.

## Determinism

- Runs MUST be deterministic: fixed frame counts / T-states, seeded RNG, fixed
  `TZ` / `LC_ALL`.
- CLI snapshots MUST normalize version strings, absolute paths, timestamps, build
  hashes, ports, and temp dirs before comparison.

## Layout

```text
cpu/         zexall/zexdoc harness, flag-computation tests   (provenance: zexall/zexdoc/fuse)
timing/      contention, INT timing, frame structure          (provenance: hardware/fuse)
machine/     interrupt acceptance + per-access/M-cycle contention (provenance: hardware/fuse)
assembler/   golden emitted bytes + diagnostics               (provenance: contract)
cli/         stdout / stderr / exit-code snapshots            (provenance: contract/manual)
formats/     round-trips: .z80 v1/v2/v3, .zxstate, zx.config  (provenance: contract)
```

The suite also validates the DNA itself: if `../domain/` is wrong, the external
suites (zexall, FUSE timing) fail here.

## External suite registry

`external/*.manifest.json` pins third-party suite sources by repository URL,
commit, license, artifact path, byte size, and SHA-256. These manifests are not
fixture JSON files and do not make CPU/timing fidelity rows covered by
themselves.

`external-suites.mjs` validates those manifests and hashes any artifact that a
manifest explicitly marks as vendored. A manifest with
`execution.status: "manifest-only"` reports registry pass/fail only; the
corresponding fidelity coverage rows remain open until a reference adapter runs
the external suite and reports semantic pass/fail.

`external-payloads.mjs` materializes non-vendored artifacts from each manifest's
pinned git commit into `.cache/external-suites/`, then verifies byte size and
SHA-256 before any adapter uses them. The cache is intentionally untracked; GPL
test payloads stay external while their exact identity remains reproducible.

```bash
node dna/conformance/external-payloads.mjs --suite zexdoc
node dna/conformance/external-payloads.mjs --suite zexall
node dna/conformance/external-payloads.mjs --suite fuse-z80-tests
```

`cpu/run-zex.mjs` and `timing/run-fuse-z80.mjs` define that reference-adapter
execution contract. The runner sends a JSON request on stdin to the adapter,
expects a JSON report on stdout, and exits `0` for pass, `1` for suite failure,
or `2` for not runnable / adapter errors.

```bash
node dna/conformance/cpu/run-zex.mjs --suite zexdoc --resolve-payloads --reference "<adapter command>"
node dna/conformance/cpu/run-zex.mjs --suite zexall --resolve-payloads --reference "<adapter command>"
node dna/conformance/timing/run-fuse-z80.mjs --resolve-payloads --reference "<adapter command>"
```

`timing/fuse-z80-reference-adapter.mjs` is the first real reference adapter. It
parses the FUSE `tests.in` and `tests.expected` payloads, validates that every
test case is aligned with its expected transcript, and reports pass/fail through
the timing runner. This proves the FUSE reference transcript is executable
conformance data; it still does not cover an emulator timing row until an
implementation comparison adapter consumes those cases.

`cpu/zex-cpm-cpu-adapter.mjs` provides the CP/M COM monitor used by
zexdoc/zexall, driven by the regenerated `@zx-vibes/cpu` core:
it loads a verified COM payload at `0x0100`, handles BDOS console functions 2
and 9 at `CALL 5`, and classifies the self-checking transcript as PASS, FAIL, or
NOT_RUN. The adapter self-test uses tiny COM payloads to prove the monitor
contract; the real zexdoc/zexall fidelity rows remain uncovered until the full
suites complete through an accepted CPU reference.

## Oracle capture harness

`oracle/oracle-capture.mjs` runs the pinned sibling oracle worktree
(`../zx-vibes` by default) and writes normalized command snapshots plus binary
hash captures into `.cache/oracle-captures/`. The default plan rejects dirty or
wrong-commit oracle worktrees so captures are reproducible from a pinned source.
Captured outputs are tie-breakers for extraction only; they become DNA only when
promoted into explicit fixtures or product specs with provenance.

## Distribution bootstrap gate

`distribution/distribution-bootstrap-check.mjs` validates the thin workspace and
CI bootstrap required before slice work: root scripts include the conformance
gate, the pnpm workspace still targets `packages/*`, and CI/release validation
runs `conformance:check` before build/typecheck/lint/test.

## Domain reference checks

`domain/z80-opcodes-check.mjs` validates the structural integrity of the
machine-readable `domain/z80-opcodes.yaml` table — byte structure, loader-derived
length, timing shape, the eight-flag partition, conformance references, and the
`LD (HL)` `0x76` exclusion — over the compressed, data-driven schema (ADR-0007).
The specific opcode and timing values listed below are recorded in the table and
witnessed against source by the `ASM-EMIT-*` assembler fixtures (source → bytes),
not re-asserted against a hand-kept oracle here. The current partial slice records
the externally sourced `LD r,n` register-immediate rows for `B,C,D,E,H,L,A`: opcode pattern
`00 r 110`, immediate byte `n`, length 2, unaffected flags, and 2 machine
cycles / 7 T-states. It also locks the `LD dd,nn` register-pair immediate rows
for `BC,DE,HL,SP`: opcode pattern `00 dd 0001`, low-byte-first 16-bit immediate,
length 3, unaffected flags, and 3 machine cycles / 10 T-states. The accumulator
indirect `LD` rows lock `LD A,(BC)`, `LD A,(DE)`, `LD (BC),A`, and `LD (DE),A`
opcodes `0x0A,0x1A,0x02,0x12`, length 1, unaffected flags, and 2 machine cycles
/ 7 T-states. The absolute accumulator `LD` rows lock `LD A,(nn)` and
`LD (nn),A` opcodes `0x3A` and `0x32`, low-byte-first absolute address order,
length 3, unaffected flags, and 4 machine cycles / 13 T-states. The absolute
`HL` `LD` rows lock `LD HL,(nn)` and `LD (nn),HL` opcodes `0x2A` and `0x22`,
low-byte-first absolute address order, 16-bit low-then-high memory word order,
length 3, unaffected flags, and 5 machine cycles / 16 T-states. The `LD SP,HL`
row locks opcode `0xF9`, length 1, unaffected flags, and 1 machine cycle /
6 T-states. The `INC ss` / `DEC ss` rows lock `BC,DE,HL,SP` opcodes
`0x03,0x13,0x23,0x33` and `0x0B,0x1B,0x2B,0x3B`, length 1, unaffected flags,
and 1 machine cycle / 6 T-states. The `LD (HL)`
memory-family row locks `LD (HL),n`, `LD r,(HL)`, and `LD (HL),r` for
`B,C,D,E,H,L,A`, including the explicit exclusion of opcode `0x76` from this
load family. The `JP nn` row locks opcode `0xC3`, low-byte-first absolute
address order, length 3, unaffected flags, and 3 machine cycles / 10 T-states.
The `JP cc,nn` rows lock `NZ,Z,NC,C,PO,PE,P,M` condition opcodes
`0xC2,0xCA,0xD2,0xDA,0xE2,0xEA,0xF2,0xFA`, low-byte-first absolute address
order, length 3, unaffected flags, and 3 machine cycles / 10 T-states. The
`JP (HL)` row locks opcode `0xE9`, register-indirect target `HL`, length 1,
unaffected flags, and 1 machine cycle / 4 T-states. The `EX DE,HL` row locks
opcode `0xEB`, the register-pair exchange between `DE` and `HL`, length 1,
unaffected flags, and 1 machine cycle / 4 T-states. The `EXX` row locks opcode
`0xD9`, the `BC`/`DE`/`HL` shadow-register exchange, length 1, unaffected
flags, and 1 machine cycle / 4 T-states. The `CALL nn` row locks
opcode `0xCD`, low-byte-first absolute address order,
return-address stack byte order, length 3, unaffected flags, and 5 machine
cycles / 17 T-states. The `CALL cc,nn` rows lock `NZ,Z,NC,C,PO,PE,P,M`
condition opcodes `0xC4,0xCC,0xD4,0xDC,0xE4,0xEC,0xF4,0xFC`, low-byte-first
absolute address order, taken return-address stack byte order, taken timing of
5 machine cycles / 17 T-states, not-taken timing of 3 machine cycles /
10 T-states, and unaffected flags. The `RET` row locks opcode `0xC9`,
return-address stack byte order, length 1, unaffected flags, and 3 machine
cycles / 10 T-states. The `RET cc` rows lock `NZ,Z,NC,C,PO,PE,P,M` condition
opcodes `0xC0,0xC8,0xD0,0xD8,0xE0,0xE8,0xF0,0xF8`, taken return-address stack
byte order, taken timing of 3 machine cycles / 11 T-states, not-taken timing of
1 machine cycle / 5 T-states, and unaffected flags. The `RST p` rows lock
restart vectors `00H,08H,10H,18H,20H,28H,30H,38H`, opcodes
`0xC7,0xCF,0xD7,0xDF,0xE7,0xEF,0xF7,0xFF`, return-address stack byte order,
length 1, unaffected flags, and 3 machine cycles / 11 T-states. The `NOP` row
locks opcode `0x00`, length 1, unaffected flags, and 1 machine cycle /
4 T-states. The `JR e` row locks opcode `0x18`, signed 8-bit displacement from
the address after the instruction, length 2, unaffected flags, and 3 machine
cycles / 12 T-states. The `JR cc,e` rows lock `NZ,Z,NC,C` condition opcodes
`0x20,0x28,0x30,0x38`, the same displacement rule, unaffected flags, taken
timing of 3 machine cycles / 12 T-states, and not-taken timing of 2 machine
cycles / 7 T-states. The `DJNZ e` row locks opcode `0x10`, the same
displacement rule after decrementing register `B`, unaffected flags, taken
timing of 3 machine cycles / 13 T-states, and not-taken timing of 2 machine
cycles / 8 T-states.

## Assembler CLI fixtures

`assembler/run-assembler-cli-fixtures.mjs` executes the `assembler/cli-surface.json`
fixture against the workspace `zxasm` command. The default runner builds
`@zx-vibes/asm` when needed, runs declared CLI cases in a temp directory, applies
the standard CLI snapshot normalizer, and checks exit codes plus required stdout
or stderr snippets.

`assembler/run-assembler-api-fixtures.mjs` discovers API-level fixtures under
`assembler/` by default and skips non-API fixtures. It executes `assemble(...)`
and `assembleFile(...)` cases against the workspace `@zx-vibes/asm` module,
materializes declared temp files for file-backed cases, and checks normalized
result fields, diagnostics, warnings, symbols, SLD snippets, SAVEBIN artifacts,
written artifact files, and emitted bytes declared by each fixture.

`assembler/run-assembler-corpus-fixtures.mjs` executes
`assembler/corpus.json` against tracked repository source files. It verifies the
current starters, toolkit templates, examples, and recipe demos still assemble
successfully with the embedded assembler.
