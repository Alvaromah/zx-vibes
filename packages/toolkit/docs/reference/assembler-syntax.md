# Embedded assembler syntax

This reference covers the `@zx-vibes/asm` assembler used by zx-vibes by
default. It is a Spectral-oriented Z80 assembler for ZX Spectrum 48K projects,
not a complete sjasmplus replacement. Unsupported sjasmplus features should
fail clearly rather than silently misassemble.

For external sjasmplus migration notes, see `sjasmplus-cheatsheet.md`. In a
repository checkout, treat `packages/asm/README.md` and current tests as the
implementation source of truth; in generated projects, use this local reference
and the installed `zxasm` command.

## File Skeleton

```asm
    DEVICE ZXSPECTRUM48
    ORG 0x8000

start:
    ld a, 2
    call 0x1601
    ret
```

- `DEVICE ZXSPECTRUM48` enables ZX Spectrum 48K layout metadata and is required
  for `SAVEBIN` artifacts.
- `ORG expression` sets the assembly address and output origin.
- The assembler emits raw bytes and SLD-compatible debug symbol data.

## Labels And Constants

Labels can use `label:`, column-0 `label`, and local dotted labels:

```asm
start:
    ld b, 10
.loop:
    djnz .loop
done
    ret
```

Local labels beginning with `.` are scoped to the previous global label.
Inside `MODULE`, global labels are qualified with the module scope.

Constants support `EQU`, `DEFL`, and equals assignments:

```asm
SCREEN  EQU 0x4000
counter DEFL 10
MASK = %11110000
```

`name = expression` is parsed as a `DEFL`-style assignment. `IFDEF` checks
source/API defines, not `EQU` labels.

## Expressions

Expressions support labels, `$` for the current PC, numbers, character/string
first-character literals, unary operators, arithmetic, bitwise operators,
comparisons, and boolean operators.

Common number forms:

```asm
    db 0x12, $12, #12, 12h
    db %1010, 0b1010, 1010b
    db 'A', "B"
```

Supported helpers and operators include:

- `LOW expr`, `HIGH expr`, and `low(...)` / `high(...)`.
- `+`, `-`, `*`, `/`, `%`, `MOD`.
- `<<`, `>>`, `SHL`, `SHR`.
- `&`, `|`, `^`, `~`.
- `==`, `!=`, `<`, `<=`, `>`, `>=`.
- `&&`, `||`, `!`.

## Includes And Defines

```asm
    INCLUDE "lib/math.asm"
    INCLUDE <shared.asm>
```

Quoted includes are resolved relative to the including file first, then include
search paths. Angle-bracket includes search include paths only.

Build/API defines can be supplied by the CLI:

```bash
zxasm assemble src/main.asm -I lib -DDEBUG=1 --out-dir build
```

Source defines are order-sensitive:

```asm
    DEFINE DEBUG 1
    DEFINE FLAG
    UNDEFINE FLAG
```

`DEFINE NAME expression` gives the symbol an expression value. `DEFINE NAME`
defaults to true. `DEFINE NAME=1` is not supported syntax.

## Conditional Assembly

```asm
    IFDEF DEBUG
        db 1
    ELSEIF MODE == 2
        db 2
    ELSE
        db 0
    ENDIF

    IFNDEF RELEASE
        DISPLAY "debug build"
    ENDIF
```

Supported directives are `IF`, `IFDEF`, `IFNDEF`, `ELSEIF`, `ELIF`, `ELSE`,
and `ENDIF`.

## Macros

Both sjasmplus-style macro forms are supported:

```asm
Pair MACRO left,right
    db left, right
ENDM

    MACRO Emit value
        db value
    ENDM

    Pair 1,2
    Emit 3
```

Macro parameters are textual replacements. Dotted local labels inside macro
bodies are renamed per expansion so repeated macro use does not duplicate the
same local label.

## Modules

```asm
    MODULE Player
start:
.loop:
    jr .loop
    ENDMODULE

    dw Player.start, Player.start.loop
```

`MODULE name` and `ENDMODULE` scope labels. Module names cannot contain dots,
and `ENDMODULE` does not take a name argument. Nested modules qualify labels
with dotted module paths.

## Repetition

```asm
COUNT EQU 2

    DUP COUNT + 1, idx
        db idx
      REPT 2
        db 0
      ENDR
    EDUP
```

`DUP` and `REPT` repeat source blocks. `EDUP`, `ENDR`, and `ENDW` terminate a
repeat block. An optional counter symbol receives the zero-based iteration
index. Repeat counts can be zero but not negative.

## Data Directives

Byte data:

```asm
    DB 1, 2, "ZX", 0
    DEFB 3
    BYTE 4
    DEFM "TEXT"
    DM 'OK'
```

String escapes support `\n`, `\r`, `\t`, `\\`, and escaped matching quotes.

Terminated or marked strings:

```asm
    DZ "END"      ; appends 0
    DC "LAST"     ; sets bit 7 on the final emitted byte
```

Multi-byte data is little-endian:

```asm
    DW 0x1234
    DEFW start
    WORD 42
    D24 0x123456
    DEFD 0x12345678
    DD 0x01020304
    DWORD 0xAABBCCDD
```

Storage and alignment:

```asm
    DS 32
    DEFS 8,0xAA
    BLOCK 4,0xFF
    ALIGN 256
    ALIGN 16,0x55
```

`DS`/`DEFS`/`BLOCK` take a length and optional fill byte. `ALIGN` takes an
optional power-of-two boundary from 1 to 32768 and optional fill byte.

Diagnostics and termination:

```asm
    ASSERT start == 0x8000, "bad origin"
    DISPLAY "start=", start
    END
stop END
```

Indented `END` terminates source assembly. A label-prefixed `stop END` defines
the label and terminates. An unindented `END` alone is treated as a label.

## Binary Data And Output

Binary input:

```asm
    INCBIN "data.bin"
    INCBIN "data.bin", 1, 3
    INSERT <shared.bin>
    BINARY "sprite.bin", 0, 64
```

`INCBIN`, `INSERT`, and `BINARY` include bytes from a file. The optional second
argument is the offset, and the optional third argument is length. Quoted paths
try the including file directory first, then include paths; angle-bracket paths
search include paths only.

Binary output artifacts:

```asm
    DEVICE ZXSPECTRUM48
    ORG 0x8000
start:
    db 1,2,3,4
end:
    SAVEBIN "part.bin", start, end-start
```

`SAVEBIN "file", start[, length]` records an additional binary artifact
without advancing the PC. It requires `DEVICE ZXSPECTRUM48`. If length is
omitted, it saves through address `0xFFFF`.

## SLD Symbols

The assembler returns SLD-compatible debug data containing:

- `|SLD.data.version|1`.
- ZX Spectrum 48K page metadata when `DEVICE ZXSPECTRUM48` is present.
- Symbol records for labels/constants.
- Source-line records for emitted instruction/data addresses.

`zxs` uses this data for label-aware debugging such as breakpoints.

## Instruction Compatibility

The assembler supports the Z80 instruction forms needed by the zx-vibes
starter, recipes, examples, and tests, plus several sjasmplus-compatible
aliases.

Supported aliases include:

- `SLI` as an alias for undocumented `SLL`.
- `IN (C)` and `IN F,(C)`.
- `ADD n`, `ADC n`, and `SBC n` short forms for accumulator ALU operations.
- `JP HL`, `JP IX`, and `JP IY`.
- `EXA` and `EXD`.
- `LD rr,rr` pseudo-copy forms among `BC`, `DE`, `HL`, `IX`, and `IY`.
- Index-half aliases `IXH`/`IXL`/`IYH`/`IYL`, plus `XH`/`XL`/`YH`/`YL` and
  `HX`/`LX`/`HY`/`LY`.
- Indexed CB copy-register forms such as `SET 3,(IX+4),A`.

Illegal index-half mixes such as `LD H,IXH`, `LD XH,H`, `LD IXH,(HL)`, and
`LD (IX+1),XH` are rejected.

## Square-Bracket Memory Operands

Square brackets are accepted as memory operand aliases in common forms:

```asm
    LD A,[HL]
    LD [HL],A
    LD [0x4000],A
    LD A,[IX+4]
    INC [HL]
    ADD A,[HL]
    JP [HL]
    BIT 3,[HL]
    SET 3,[IX+4],A
```

This is equivalent to the corresponding parenthesized memory syntax where that
Z80 form is legal.

## Known Limitations

- This is not a complete sjasmplus implementation.
- `SAVESNA` is intentionally unsupported by `@zx-vibes/asm`; use sjasmplus for
  snapshot output.
- Tape/snapshot output, Lua, and advanced sjasmplus-only features require
  `sjasmplus`.
- Unsupported syntax should produce diagnostics instead of being ignored.
- `IFDEF`/`IFNDEF` check defines, not `EQU` labels.
- `DEFINE NAME=1` is invalid; use `DEFINE NAME 1`.
- `SAVEBIN` requires `DEVICE ZXSPECTRUM48` and quoted output paths.
