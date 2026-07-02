# Errors (cross-cutting catalog)

The error model across assembler, CLI/toolkit, and emulator: the **shapes, exit
codes, and category set are contract**; the exact human message wording is
Incidental. Mined once from the oracle (`packages/asm/src/assembler.ts`,
`packages/toolkit/src/cli/output.ts`, `core/{detect,snapshot,state,machine}.ts`).

## Model

- [id: ERR-PROD-MODEL-001] No global error-code registry exists: diagnostics are identified by `severity` + message text, not by stable codes. The structured *shapes* below are the contract; message strings are not. [provenance: contract]
- [id: ERR-PROD-EXIT-001] Process outcomes map to the toolkit exit-code enum — `0` OK, `1` USER_ERROR, `2` HANG, `3` ENV_ERROR (`cli.md` CLI-PROD-EXIT-00x). [provenance: contract]
- [id: ERR-PROD-CLIERR-001] A CLI error carries `{ message, exitCode, stage? }`; `--json` mode emits `{ ok: false, stage, error: { message, exitCode } }`. Helpers: a user error → exit 1, an environment error → exit 3. [provenance: contract]
- [id: ERR-PROD-NOSILENT-001] No error is swallowed: every failure surfaces as a diagnostic, a thrown error caught by the CLI, or a non-zero exit (C5, no silent breakage). [provenance: contract]

## Assembler diagnostics

- [id: ERR-PROD-ASM-SHAPE-001] An assembler `Diagnostic` is `{ file, line, severity, message, sourceLine?, hint? }` with `severity` one of `error` | `warning`; the assembler returns `{ ok, errors: Diagnostic[], warnings: Diagnostic[], ... }`. [provenance: contract]
- [id: ERR-PROD-ASM-OK-001] `ok` is false iff there is ≥ 1 `error` diagnostic; `build` maps `ok: false` to exit 1 (USER_ERROR) and forwards `errors`/`warnings` into its JSON report (`errorCount`/`warningCount`). [provenance: contract]
- [id: ERR-PROD-ASM-CATS-001] The diagnostic categories are stable (the assembler reports, never silently mis-assembles): parse/syntax, duplicate label/define/macro, macro arity/nesting/unclosed, module scoping, conditional (`IF/ELSE/ENDIF`) balance, repeat (`DUP/REPT`) balance + count bounds, unsupported instruction/operand form, expression value/range (8-bit, 16-bit, index displacement, relative branch, `RST` target), include/sandbox path, `ASSERT` failure, data/`ALIGN`/`SAVEBIN` argument + range, and explicitly-unsupported sjasmplus features (e.g. `SAVESNA`). [provenance: contract]
- [id: ERR-PROD-ASM-WARN-001] `DISPLAY` emits a `warning` diagnostic; warnings do not fail assembly. [provenance: contract]
- [id: ERR-PROD-ASM-WORDING-001] The exact message strings (e.g. "Duplicate label: X", "8-bit value out of range: …") are Incidental wording — not a versioned contract; only the category, `severity`, and `file`/`line` are asserted. [provenance: decision:ADR-0001]

## Run hang verdicts

- [id: ERR-PROD-HANG-SHAPE-001] A run hang verdict is `{ kind, pc, detail, confidence, likelyCause? }` with `confidence` one of `definite` | `probable`; it appears as `run` JSON `hang` when `status: "hang"` (exit 2). [provenance: contract]
- [id: ERR-PROD-HANG-KINDS-001] The `HangKind` enum is stable: `di-halt`, `rom-error`, `tight-loop`, `sp-corrupt`, `pc-in-rom`. `di-halt` and `rom-error` are `definite` and stop the run immediately; `sp-corrupt`, `pc-in-rom`, and `tight-loop` are `probable` and decided at frame-budget exhaustion. [provenance: contract]
- [id: ERR-PROD-HANG-HEUR-001] The detection thresholds (PC-ring size, ROM-residence/static-frame counts, tight-loop address/byte spans) are Incidental heuristics; only the kind set and the definite/probable→exit behavior are contract. [provenance: decision:ADR-0001]

## Emulator / core errors

- [id: ERR-PROD-EMU-001] Core operations throw (never silently fail) on invalid input, and the CLI catches them as user errors (exit 1): snapshot decode (a `.z80` too small / a `.sna` not exactly the 48K size), a binary that does not fit RAM `0x4000–0xFFFF`, a corrupt or unsupported-version `.zxstate`, and an unknown Spectrum key. [provenance: contract]
- [id: ERR-PROD-EMU-WORDING-001] The specific throw messages are Incidental wording; the contract is that these conditions fail loudly (a thrown error surfaced as a non-zero exit), not the exact text. [provenance: decision:ADR-0001]

## Environment errors (`doctor`)

- [id: ERR-PROD-ENV-001] `doctor` returns ENV_ERROR (exit 3) when any check fails: Node < 20; `sjasmplus` not found while it is the configured backend; `@zx-vibes/asm` not importable while configured; or the 48K ROM missing or not exactly 16384 bytes. All pass → exit 0. [provenance: contract]

## Recovery

- [id: ERR-PROD-RECOVER-001] Recovery is exit-code-directed: USER_ERROR (1) → fix the source/args/config; HANG (2) → inspect the `hang` verdict's `kind`/`likelyCause`; ENV_ERROR (3) → fix the toolchain per `doctor`. The `--json` envelope gives the machine-readable failure for agents. [provenance: contract]

## Provenance

- The error model, exit codes, `Diagnostic`/`HangVerdict`/`CliError` shapes, the
  `HangKind` set, and the category lists are `contract`. The exact message wording
  and detection heuristics are `decision:ADR-0001` (Incidental). No `UNKNOWN`.
  Cross-references: `cli.md` (exit codes, envelopes), `assembler.md` (diagnostics),
  `toolkit-runtime.md` (the run watchdog).
