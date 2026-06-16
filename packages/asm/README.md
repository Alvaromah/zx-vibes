# @zx-vibes/asm

zx-vibes Z80 assembler/disassembler for ZX Spectrum 48K projects.

This is an MVP package intended to remove the hard dependency on an external
assembler for the zx-vibes starter-game workflow. It deliberately targets the
current zx-vibes recipes/templates/examples before broader sjasmplus
compatibility.

## MVP Surface

- Z80 raw binary assembly.
- SLD-compatible label and source-line output for zx-vibes debugging.
- `DEVICE ZXSPECTRUM48`, `ORG`, `EQU`, `INCLUDE`, `DB`, `DW`, `DS/BLOCK`,
  `ALIGN`, `ASSERT`, `DISPLAY`, `INCBIN`, `INSERT`, `BINARY`, and `SAVEBIN`.
- Optional fill operands for `DS`/`DEFS`/`BLOCK` and `ALIGN`, such as
  `DS 8,0xAA` and `ALIGN 16,0xFF`.
- Data aliases including `DEFM`/`DM`, `DZ`, `DC`, `D24`, and
  `DEFD`/`DD`/`DWORD`.
- Constant assignments with `name = expression`.
- Global and local labels.
- Comparison expressions for compile-time checks.
- Sjasmplus-style expression helpers/operators including `LOW`/`HIGH`,
  `&&`/`||`/`!`, `SHL`/`SHR`/`MOD`, `0b1010`, and `1010b`.
- Include search paths and command-line-style defines through the API and CLI.
- Source-level `DEFINE`/`UNDEFINE` for sjasmplus-style conditional assembly
  and expression values.
- Conditional assembly with `IF`, `IFDEF`, `IFNDEF`, `ELSEIF`, `ELSE`, and
  `ENDIF`.
- `END` source termination, including label-prefixed forms such as `stop END`.
- Source repetition with `DUP`/`REPT` blocks, `EDUP`/`ENDR` terminators, and
  optional counter symbols.
- Macro expansion with `Name MACRO ...` / `ENDM` and indented
  `MACRO Name ...` / `ENDM`, parameters, and per-expansion dotted local
  labels.
- `MODULE`/`ENDMODULE` scoped labels and module-relative references.
- `SAVEBIN "file", start[, length]` binary output artifacts.
- Indexed CB copy-register forms such as `SET 3,(IX+4),A`.
- `SLI` as a sjasmplus-compatible alias for the undocumented `SLL` shift.
- Common sjasmplus instruction aliases such as `IN (C)`, `IN F,(C)`,
  `ADD n`, `ADC n`, `SBC n`, `JP HL`/`JP IX`/`JP IY`, `EXA`, and `EXD`.
- Sjasmplus `LD rr,rr` pseudo-copy forms among `BC`/`DE`/`HL`/`IX`/`IY`.
- Sjasmplus index-half aliases `XH`/`XL`/`YH`/`YL` and
  `HX`/`LX`/`HY`/`LY`, with illegal `H`/`L` and memory mixes rejected.
- Square-bracket memory operands such as `LD A,[HL]`, `LD [0x4000],A`,
  and `SET 3,[IX+4],A`.
- Table-driven disassembly compatible with zx-vibes debugger output.

```bash
zxasm assemble src/main.asm -I lib -DDEBUG=1 --out-dir build
```

`spectral-asm` remains a compatibility bin alias for older projects.

Unsupported sjasmplus features should fail clearly instead of silently
misassembling code.
