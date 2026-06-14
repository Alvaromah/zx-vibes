# sjasmplus compatibility and migration notes

Read this only when a project explicitly uses external `sjasmplus` or when you
are porting existing sjasmplus code. For normal `zx-vibes` projects, start with
the embedded assembler reference: [assembler-syntax.md](assembler-syntax.md).

By default `zx-vibes` uses the embedded `@zx-vibes/asm` backend, so the starter
and recipe workflow does not require an external assembler:

```bash
zxs build src/main.asm
zxs test recipes
```

Use `--assembler sjasmplus` or `ZXS_ASSEMBLER=sjasmplus` for advanced
sjasmplus-only features such as Lua, snapshot/tape emission, or syntax outside
the embedded starter-game subset.

## External sjasmplus skeleton

```asm
    DEVICE ZXSPECTRUM48     ; enables SAVESNA/SAVETAP and SLD debug output
    ORG 0x8000
start:
    ; ... code ...
    ; optional sjasmplus-only outputs:
    SAVESNA "build/game.sna", start
```

`zxs build file.asm` adds `--raw` (plain binary) and `--sld` (debug symbols
— this is what makes `zxs break add my_label` work) automatically.

## Syntax you'll actually use

```asm
SCORE   equ 0xBF00          ; constant / address
start:                      ; global label (column 0, colon optional)
.loop:  djnz .loop          ; local label — scoped to the previous global
    ld a, 0x12              ; hex: 0x12, $12 or #12 — all accepted
    ld b, %1010             ; binary
    db 1, 2, "TEXT", 0      ; bytes / strings (also DEFB)
    dw start, 0x1234        ; words, little-endian (also DEFW)
    ds 32                   ; reserve 32 zero bytes (also DEFS)
    ALIGN 256               ; pad to next page boundary (IM2 tables!)
    INCLUDE "lib/keys.asm"  ; path relative to THIS file
```

Most of this syntax is also supported by `@zx-vibes/asm`; check
[assembler-syntax.md](assembler-syntax.md) before assuming a sjasmplus feature
is available in the embedded backend. Lua, `SAVESNA`, and tape/snapshot output
remain external sjasmplus workflows.

## Error messages decoded

| Message | Actual meaning |
|---|---|
| `Label not found: x` | Typo (zxs adds a did-you-mean hint), or a `.local` referenced from another global's scope |
| `Unrecognized instruction` | Typo'd mnemonic — or a label not at column 0 being parsed as an opcode |
| `Illegal instruction` | Valid mnemonic, impossible operands (`ld bc, de` doesn't exist — go via memory or push/pop) |
| `Value out of range` | Byte > 255, JR/DJNZ target further than ±128 → use JP, or word > 65535 |
| `Duplicate label` | Same global label twice — locals need the `.` prefix |

## Z80 facts the assembler won't fix for you

- No `LD BC,DE`: move 16-bit values via `push de / pop bc` or two `LD r,r`.
- No memory-to-memory moves; everything goes through a register.
- `JR` reaches ±128 bytes only; `DJNZ` likewise. Long jumps: `JP`.
- `CP n` sets flags as A-n but discards the result: `JR Z` = equal,
  `JR C` = A < n (unsigned), `JR NC` = A ≥ n.
- 8-bit only ALU (mostly): 16-bit compares are `OR A / SBC HL,DE` (then
  `ADD HL,DE` to restore), 16-bit add to A doesn't exist.

## Gotchas

- Instructions must be INDENTED; anything at column 0 is a label. The error
  for getting this wrong is the confusing "Unrecognized instruction".
- `INCLUDE` paths are relative to the including FILE, not the build cwd.
- Without `DEVICE ZXSPECTRUM48`, SAVESNA/SAVETAP fail and no SLD symbols
  are emitted (zxs break by label stops working).
- sjasmplus is case-insensitive for mnemonics, case-SENSITIVE for labels.
