# Assembler Product Surface

## Purpose

- [id: ASM-PROD-SCOPE-001] `@zx-vibes/asm` is the embedded Z80 assembler and disassembler package used by zx-vibes for ZX Spectrum 48K workflows. [provenance: contract]
- [id: ASM-PROD-SCOPE-002] Generated zx-vibes projects can use this embedded assembler without installing an external assembler by default. [provenance: contract]
- [id: ASM-PROD-SCOPE-003] The assembler targets the syntax needed by current starters, toolkit templates, recipes, examples, and tests before claiming full sjasmplus compatibility. [provenance: contract]
- [id: ASM-PROD-SCOPE-004] Unsupported sjasmplus features are part of the error surface: they must fail clearly instead of being silently ignored or misassembled. [provenance: contract]

## Public Behavior

- [id: ASM-PROD-PACKAGE-001] The package name is `@zx-vibes/asm`; it is published as an ESM package requiring Node.js 20 or newer. [provenance: contract]
- [id: ASM-PROD-PACKAGE-002] The package exposes `zxasm` as the canonical standalone CLI and `spectral-asm` as a compatibility alias. [provenance: contract]
- [id: ASM-PROD-PACKAGE-003] The umbrella `zx-vibes` package also exposes a `zxasm` bin that delegates to the assembler package. [provenance: contract]
- [id: ASM-PROD-PACKAGE-004] `zxasm --version` exits 0 and prints the `@zx-vibes/asm` package version with no extra text. [provenance: contract]
- [id: ASM-PROD-PACKAGE-005] `zxasm --help` exposes the top-level commands `assemble`, `disasm`, `doctor`, and `help`. [provenance: contract]
- [id: ASM-PROD-PACKAGE-006] `zxs build --assembler spectral` remains a supported embedded-backend spelling for compatibility with older configuration. [provenance: contract]
- [id: ASM-PROD-PACKAGE-007] Projects that intentionally need syntax outside this embedded assembler use the separate `sjasmplus` backend. [provenance: contract]

## Inputs

- [id: ASM-PROD-CLI-ASSEMBLE-001] `zxasm assemble <file>` accepts an entry `.asm` file and writes outputs under `--out-dir <dir>`, defaulting to `build`. [provenance: contract]
- [id: ASM-PROD-CLI-ASSEMBLE-002] `zxasm assemble` accepts repeatable include search paths via `-I` or `--inc`. [provenance: contract]
- [id: ASM-PROD-CLI-ASSEMBLE-003] `zxasm assemble` accepts repeatable build defines via `-D` or `--define`; each define is either a name or `NAME=value`. [provenance: contract]
- [id: ASM-PROD-CLI-ASSEMBLE-004] `zxasm assemble --sandbox` restricts `INCLUDE`, `INCBIN`, `INSERT`, and `BINARY` reads to the project root and include paths. [provenance: contract]
- [id: ASM-PROD-CLI-ASSEMBLE-005] `zxasm assemble --json` requests machine-readable command output. [provenance: contract]
- [id: ASM-PROD-CLI-DISASM-001] `zxasm disasm <bin>` accepts a raw binary file and supports `--org <addr>`, defaulting to `0x8000`. [provenance: contract]
- [id: ASM-PROD-CLI-DISASM-002] `zxasm disasm <bin> --count <n>` limits disassembly to a positive instruction count. [provenance: contract]
- [id: ASM-PROD-CLI-DOCTOR-001] `zxasm doctor` checks the embedded assembler runtime. [provenance: contract]
- [id: ASM-PROD-CLI-DOCTOR-002] `zxasm doctor --json` exits 0 and returns JSON containing `ok: true`, `assembler: "@zx-vibes/asm"`, and the package `version`. [provenance: contract]

## Assembly Language Surface

- [id: ASM-PROD-SRC-SKELETON-001] `DEVICE ZXSPECTRUM48` enables ZX Spectrum 48K layout metadata and is required for `SAVEBIN` artifacts. [provenance: contract]
- [id: ASM-PROD-SRC-SKELETON-002] `ORG expression` sets the assembly address and output origin. [provenance: contract]
- [id: ASM-PROD-LABELS-001] Labels support `label:`, column-0 `label`, and local dotted labels scoped to the previous global label. [provenance: contract]
- [id: ASM-PROD-LABELS-002] `MODULE name` and `ENDMODULE` scope labels; nested modules qualify labels with dotted module paths. [provenance: contract]
- [id: ASM-PROD-CONSTANTS-001] Constants support `EQU`, `DEFL`, and `name = expression`, with equals assignment parsed as a `DEFL`-style assignment. [provenance: contract]
- [id: ASM-PROD-EXPR-001] Expressions support labels, `$` for current PC, numeric literals, first-character string or character literals, unary operators, arithmetic, bitwise operators, comparisons, and boolean operators. [provenance: contract]
- [id: ASM-PROD-EXPR-002] Number forms include `0x12`, `$12`, `#12`, `12h`, `%1010`, `0b1010`, and `1010b`. [provenance: contract]
- [id: ASM-PROD-EXPR-003] Expression helpers and operators include `LOW`, `HIGH`, `low(...)`, `high(...)`, `/`, `%`, `MOD`, `<<`, `>>`, `SHL`, `SHR`, `&`, `|`, `^`, `~`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`, and `!`. [provenance: contract]
- [id: ASM-PROD-INCLUDE-001] Quoted includes and binary inputs resolve relative to the including file first, then include paths. [provenance: contract]
- [id: ASM-PROD-INCLUDE-002] Angle-bracket includes and binary inputs search include paths only. [provenance: contract]
- [id: ASM-PROD-DEFINES-001] Source directives `DEFINE NAME expression`, `DEFINE NAME`, and `UNDEFINE NAME` are order-sensitive. [provenance: contract]
- [id: ASM-PROD-DEFINES-002] `DEFINE NAME` defaults the define value to true; `DEFINE NAME=1` is invalid source syntax. [provenance: contract]
- [id: ASM-PROD-COND-001] Conditional assembly supports `IF`, `IFDEF`, `IFNDEF`, `ELSEIF`, `ELIF`, `ELSE`, and `ENDIF`. [provenance: contract]
- [id: ASM-PROD-COND-002] `IFDEF` and `IFNDEF` check source or API defines, not `EQU` labels. [provenance: contract]
- [id: ASM-PROD-MACRO-001] Macro definitions support both `Name MACRO ... ENDM` and indented `MACRO Name ... ENDM` forms. [provenance: contract]
- [id: ASM-PROD-MACRO-002] Macro parameters are textual replacements, and dotted local labels inside macro bodies are renamed per expansion. [provenance: contract]
- [id: ASM-PROD-REPEAT-001] `DUP` and `REPT` repeat source blocks and may bind an optional zero-based counter symbol. [provenance: contract]
- [id: ASM-PROD-REPEAT-002] `EDUP`, `ENDR`, and `ENDW` terminate repeat blocks; repeat counts may be zero but not negative. [provenance: contract]
- [id: ASM-PROD-DATA-001] Byte data directives include `DB`, `DEFB`, `BYTE`, `DEFM`, and `DM`. [provenance: contract]
- [id: ASM-PROD-DATA-002] String escapes support `\n`, `\r`, `\t`, `\\`, and escaped matching quotes. [provenance: contract]
- [id: ASM-PROD-DATA-003] `DZ` emits a zero-terminated string, and `DC` sets bit 7 on the final emitted byte. [provenance: contract]
- [id: ASM-PROD-DATA-004] Multi-byte data directives emit little-endian values for `DW`, `DEFW`, `WORD`, `D24`, `DEFD`, `DD`, and `DWORD`. [provenance: contract]
- [id: ASM-PROD-DATA-005] `DS`, `DEFS`, and `BLOCK` take a length and optional fill byte. [provenance: contract]
- [id: ASM-PROD-DATA-006] `ALIGN` takes an optional power-of-two boundary from 1 through 32768 and an optional fill byte. [provenance: contract]
- [id: ASM-PROD-CHECKS-001] `ASSERT expression, "message"` reports an assembly error when the expression is false. [provenance: contract]
- [id: ASM-PROD-CHECKS-002] `DISPLAY` emits an assembler warning message. [provenance: contract]
- [id: ASM-PROD-END-001] Indented `END` terminates source assembly; a label-prefixed `stop END` defines the label and terminates; unindented `END` alone is treated as a label. [provenance: contract]
- [id: ASM-PROD-BINARY-001] `INCBIN`, `INSERT`, and `BINARY` include bytes from a file, with optional offset and optional length. [provenance: contract]
- [id: ASM-PROD-SAVEBIN-001] `SAVEBIN "file", start[, length]` records an additional binary artifact without advancing the PC. [provenance: contract]
- [id: ASM-PROD-SAVEBIN-002] `SAVEBIN` requires `DEVICE ZXSPECTRUM48`; if length is omitted, it saves through address `0xFFFF`. [provenance: contract]

## Outputs

- [id: ASM-PROD-OUTPUT-001] Successful assembly returns raw bytes. [provenance: contract]
- [id: ASM-PROD-OUTPUT-002] Successful assembly returns SLD-compatible debug data when labels or source-line records are available. [provenance: contract]
- [id: ASM-PROD-OUTPUT-003] SLD data includes `|SLD.data.version|1`, symbol records for labels/constants, and source-line records for emitted instruction or data addresses. [provenance: contract]
- [id: ASM-PROD-OUTPUT-004] SLD data includes ZX Spectrum 48K page metadata when `DEVICE ZXSPECTRUM48` is present. [provenance: contract]
- [id: ASM-PROD-OUTPUT-005] Successful assembly writes any requested `SAVEBIN` artifacts under the selected output directory. [provenance: contract]
- [id: ASM-PROD-OUTPUT-006] `SAVEBIN` artifact paths must remain within the selected output directory. [provenance: contract]
- [id: ASM-PROD-OUTPUT-007] Table-driven disassembly output must be compatible with zx-vibes debugger output. [provenance: contract]

## Instruction Compatibility

- [id: ASM-PROD-INST-001] Instruction coverage includes the Z80 forms needed by current zx-vibes starters, toolkit templates, recipes, examples, and tests. [provenance: contract]
- [id: ASM-PROD-INST-002] `SLI` is accepted as a sjasmplus-compatible alias for undocumented `SLL`. [provenance: contract]
- [id: ASM-PROD-INST-003] Sjasmplus-compatible aliases include `IN (C)`, `IN F,(C)`, `ADD n`, `ADC n`, `SBC n`, `JP HL`, `JP IX`, `JP IY`, `EXA`, and `EXD`. [provenance: contract]
- [id: ASM-PROD-INST-004] Sjasmplus `LD rr,rr` pseudo-copy forms among `BC`, `DE`, `HL`, `IX`, and `IY` are supported. [provenance: contract]
- [id: ASM-PROD-INST-005] Index-half aliases include `IXH`, `IXL`, `IYH`, `IYL`, `XH`, `XL`, `YH`, `YL`, `HX`, `LX`, `HY`, and `LY`. [provenance: contract]
- [id: ASM-PROD-INST-006] Illegal index-half mixes such as `LD H,IXH`, `LD XH,H`, `LD IXH,(HL)`, and `LD (IX+1),XH` are rejected. [provenance: contract]
- [id: ASM-PROD-INST-007] Indexed CB copy-register forms such as `SET 3,(IX+4),A` are supported. [provenance: contract]
- [id: ASM-PROD-INST-008] Square brackets are accepted as memory operand aliases in legal memory forms such as `LD A,[HL]`, `LD [0x4000],A`, and `SET 3,[IX+4],A`. [provenance: contract]
- [id: ASM-PROD-INST-009] Square-bracket I/O port forms such as `IN A,[0xFE]` and `OUT [0xFE],A` are rejected. [provenance: contract]

## Error Behavior

- [id: ASM-PROD-ERR-001] An unresolved label reports `Label not found: <name>` and may include a did-you-mean hint when a close label exists. [provenance: contract]
- [id: ASM-PROD-ERR-002] `SAVESNA` is intentionally unsupported by this assembler and must report a diagnostic instead of being ignored. [provenance: contract]
- [id: ASM-PROD-ERR-003] Malformed expressions report the parser error rather than silently truncating or defaulting the expression. [provenance: contract]
- [id: ASM-PROD-ERR-004] Empty `DEFB` and `DEFW` directives are errors. [provenance: contract]
- [id: ASM-PROD-ERR-005] Data and immediate values outside their target bit width are errors instead of silently truncating. [provenance: contract]
- [id: ASM-PROD-ERR-006] Unsupported string escapes are errors instead of being dropped. [provenance: contract]
- [id: ASM-PROD-ERR-007] Layout that does not converge after five passes is an error. [provenance: contract]
- [id: ASM-PROD-ERR-008] Negative `DS` lengths emit no bytes and produce a warning. [provenance: contract]
- [id: ASM-PROD-ERR-009] Malformed conditional, repeat, macro, module, binary-input, and `SAVEBIN` blocks report explicit diagnostics. [provenance: contract]
- [id: ASM-PROD-ERR-010] `zxasm disasm` exits 1 and writes a validation error for invalid `--org` or non-positive `--count` values. [provenance: contract]

## Fixture Candidate Matrix

These candidates are the extracted observable values to port into
`dna/conformance/assembler/` fixtures. They are product-contract candidates
unless explicitly marked as fidelity and are intentionally stated without any
legacy implementation structure.

- [id: ASM-FIX-CLI-HELP-001] CLI fixture candidate: `zxasm --help` exits 0, writes no stderr, and lists the top-level commands `assemble [options] <file>`, `disasm [options] <bin>`, `doctor [options]`, and `help [command]`. [provenance: contract]
- [id: ASM-FIX-CLI-ASSEMBLE-HELP-001] CLI fixture candidate: `zxasm assemble --help` exits 0 and documents `<file>`, `--out-dir <dir>` defaulting to `build`, `-I, --inc <path>`, `-D, --define <define>`, `--sandbox`, and `--json`. [provenance: contract]
- [id: ASM-FIX-CLI-DISASM-HELP-001] CLI fixture candidate: `zxasm disasm --help` exits 0 and documents `<bin>`, `--org <addr>` defaulting to `0x8000`, and `--count <n>`. [provenance: contract]
- [id: ASM-FIX-CLI-VERSION-001] CLI fixture candidate: `zxasm --version` exits 0 and prints the current `@zx-vibes/asm` package version exactly, normalized as `<ASM_VERSION>` in snapshots. [provenance: contract]
- [id: ASM-FIX-CLI-DOCTOR-001] CLI fixture candidate: `zxasm doctor --json` exits 0 and returns JSON with `ok: true`, `assembler: "@zx-vibes/asm"`, and `version: "<ASM_VERSION>"`. [provenance: contract]
- [id: ASM-FIX-CLI-DISASM-001] CLI fixture candidate: disassembling bytes `01 34 12` at origin `0xFFFF` with count `1` exits 0 and includes `LD BC,0x1234`, proving address wrapping across `0xFFFF`. [provenance: contract]
- [id: ASM-FIX-CLI-DISASM-ERR-001] CLI fixture candidate: `zxasm disasm <existing-bin> --org NaN` exits 1 and writes `Invalid origin: 'NaN' must be a 16-bit address`. [provenance: contract]
- [id: ASM-FIX-CLI-DISASM-ERR-002] CLI fixture candidate: `zxasm disasm <existing-bin> --count 0` exits 1 and writes `Invalid instruction count: '0' must be a positive integer`. [provenance: contract]
- [id: ASM-FIX-DIAG-LABEL-001] Diagnostic fixture candidate: assembling a source that calls `draw_sprtie` while defining `draw_sprite` fails with message `Label not found: draw_sprtie` and hint `Did you mean 'draw_sprite'?`. [provenance: contract]
- [id: ASM-FIX-DIAG-SAVESNA-001] Diagnostic fixture candidate: `SAVESNA "hello.sna", start` is rejected with a message containing `SAVESNA is not supported`. [provenance: contract]
- [id: ASM-FIX-DIAG-EXPR-001] Diagnostic fixture candidate: `ld a, 1+` is rejected with a message containing `Missing right operand after '+'`. [provenance: contract]
- [id: ASM-FIX-DIAG-DATA-001] Diagnostic fixture candidate: empty `DEFB` reports `DEFB expects at least one value`, and empty `DEFW` reports `DEFW expects at least one value`. [provenance: contract]
- [id: ASM-FIX-DIAG-RANGE-001] Diagnostic fixture candidate: out-of-range literals report exact bit-width diagnostics including `8-bit value out of range: 0x100`, `16-bit value out of range: 0x10000`, `24-bit value out of range: 0x1000000`, and `32-bit value out of range: 0x100000000`. [provenance: contract]
- [id: ASM-FIX-DIAG-ESCAPE-001] Diagnostic fixture candidate: unsupported string escape `\q` reports `Unsupported string escape: \q`. [provenance: contract]
- [id: ASM-FIX-DIAG-CONVERGE-001] Diagnostic fixture candidate: self-dependent layout reports `Layout did not converge after 5 passes`. [provenance: contract]
- [id: ASM-FIX-DIAG-ASSERT-001] Diagnostic fixture candidate: a false `ASSERT` reports `ASSERT failed: <message>`. [provenance: contract]
- [id: ASM-FIX-DIAG-BRACKET-IO-001] Diagnostic fixture candidate: square-bracket I/O forms are rejected with `Unsupported IN form: A, [0xFE]` and `Unsupported OUT form: [0xFE], A`. [provenance: contract]
- [id: ASM-FIX-DIAG-INDEX-001] Diagnostic fixture candidate: illegal index-half/memory `LD` combinations are rejected with `Unsupported LD form: ...`; `add ix, hl` is rejected with `Cannot ADD IX,HL`. [provenance: contract]
- [id: ASM-FIX-EMIT-HELLO-001] Emitted-byte fixture candidate: the documented hello-style program at `ORG 0x8000` emits hex `3E02CD01162112807EB72804D72318F818FE48454C4C4F205A5800` and SLD records containing `|32768|F|start`, `|32776|F|print_loop`, and a source-line record starting `|32768|T|`. [provenance: contract]
- [id: ASM-FIX-EMIT-FORMS-001] Emitted-byte fixture candidate: labels, negative immediates, `0Fh`, string bytes, and `ALIGN 8` emit hex `3EFF060F5A580000C9`, with symbols `main = 0x8000` and `next = 0x8008`. [provenance: contract]
- [id: ASM-FIX-EMIT-DATA-001] Emitted-byte fixture candidate: data aliases, equals assignment, `DZ`, `DC`, `D24`, `DD`, and `DWORD` emit hex `414243215A584F4B00454EC45634127856341204030201DDCCBBAA42`. [provenance: contract]
- [id: ASM-FIX-EMIT-DEFINE-001] Emitted-byte fixture candidate: command-line defines `SUM=1+2` and `SHIFTED=1<<4` emit hex `0310`, proving full expressions are evaluated. [provenance: contract]
- [id: ASM-FIX-ARTIFACT-SAVEBIN-001] Artifact fixture candidate: `SAVEBIN "early.bin", start, 4` before later bytes records artifact `early.bin` with start `0x8000`, length `4`, and bytes `01020000`; `SAVEBIN "nested/all.bin", start, end-start` records artifact `nested/all.bin` with start `0x8000`, length `4`, and bytes `01020304`, while primary output bytes are `01020304`. [provenance: contract]
- [id: ASM-FIX-ARTIFACT-SAVEBIN-ERR-001] Artifact diagnostic fixture candidate: `SAVEBIN` without `DEVICE ZXSPECTRUM48` reports `SAVEBIN requires DEVICE emulation mode`; too few args reports `SAVEBIN expects 2 or 3 argument(s), got 1`; angle-bracket path reports `SAVEBIN expects a quoted file path`; range overflow reports `SAVEBIN length out of range: 3`. [provenance: contract]
- [id: ASM-FIX-ARTIFACT-PATH-001] Artifact diagnostic fixture candidate: `SAVEBIN` paths `../evil.bin`, `/tmp/evil.bin`, and `nested/../../evil.bin` are rejected with a message matching `SAVEBIN path must stay within`. [provenance: contract]
- [id: ASM-FIX-SANDBOX-001] Sandbox fixture candidate: with sandbox enabled, `INCLUDE "../secret.asm"` outside the project fails with a message matching `outside the sandbox roots`; with sandbox omitted, the same source assembles successfully. [provenance: contract]
- [id: ASM-FIX-SANDBOX-002] Sandbox fixture candidate: with sandbox enabled, `INCBIN "../secret.bin"` outside the project fails with a message matching `outside the sandbox roots`. [provenance: contract]
- [id: ASM-FIX-SANDBOX-003] Sandbox fixture candidate: with sandbox enabled, an in-project quoted include and an angle-bracket include from an allowed include path emit bytes `1122`. [provenance: contract]
- [id: ASM-FIX-CORPUS-001] Corpus fixture candidate: all current root starters, toolkit templates, toolkit examples, and recipe demos listed by the oracle assembler corpus test must assemble successfully with the embedded assembler. [provenance: contract]
- [id: ASM-FIX-CORPUS-002] Corpus fixture candidate: when `sjasmplus` is available, corpus byte output and targeted feature clusters are expected to match sjasmplus bytes, but this comparison is evidence for fixture authoring rather than a mandatory portable CI dependency. [provenance: contract]

## Degrees Of Freedom

- [id: ASM-PROD-FREE-001] Internal parser, symbol-table, macro-expansion, disassembler-table, and output-writer structure is incidental and unspecified by this product DNA. [provenance: decision:ADR-0001]
- [id: ASM-PROD-FREE-002] Human wording not asserted by conformance fixtures is incidental; only fixture-pinned diagnostics and CLI snapshots are contract. [provenance: decision:ADR-0001]
- [id: ASM-PROD-FREE-003] Assembler performance is unspecified except that the repository verification suite must remain practical for CI. [provenance: decision:ADR-0001]

## Acceptance Criteria

- [id: ASM-PROD-ACCEPT-001] The assembler conformance suite must cover the CLI command surface, version output, doctor JSON, and disasm validation behavior. [provenance: decision:ADR-0001]
- [id: ASM-PROD-ACCEPT-002] The assembler conformance suite must cover source syntax groups for includes/defines, conditionals, macros, modules, repetition, data directives, binary inputs, `SAVEBIN`, and unsupported syntax diagnostics. [provenance: decision:ADR-0001]
- [id: ASM-PROD-ACCEPT-003] The assembler conformance suite must cover representative emitted bytes and SLD/artifact outputs; emitted opcode bytes are fidelity expectations and must be checked against the domain opcode tables when those tables exist. [provenance: decision:ADR-0001]
- [id: ASM-PROD-ACCEPT-004] The assembler conformance suite must include the current templates, examples, recipes, and root starters as corpus inputs before assembler cutover. [provenance: decision:ADR-0001]

## Provenance

The claims above were extracted in the extractor role from the oracle worktree:

- `../zx-vibes/packages/asm/package.json`
- `../zx-vibes/packages/zx-vibes/package.json`
- `../zx-vibes/packages/asm/README.md`
- `../zx-vibes/docs/reference/assembler-syntax.md`
- `../zx-vibes/packages/asm/tests/assembler.test.ts`
- Live oracle CLI observations: `zxasm --help`, `zxasm assemble --help`, `zxasm disasm --help`, `zxasm --version`, `zxasm doctor --json`, and invalid `disasm` flag runs.
