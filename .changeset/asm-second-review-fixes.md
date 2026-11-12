---
"@zx-vibes/asm": minor
---

Report source that used to assemble to the wrong bytes without a word, and fix
several misleading diagnostics. Every source that assembled correctly before still
produces the same bytes (checked over 512 sources), but some sources that were
silently wrong now fail, so this is a minor release.

Now errors instead of wrong output:

- `IF`/`ELSEIF` conditions and `DUP`/`REPT` counts that use `$` or a code label
  (they were evaluated as 0 before layout). EQU constants and defines still work.
- A backwards `ORG` over bytes already emitted, or code before the first `ORG`
  (the bytes landed at the wrong address). A forward-referenced first `ORG`
  (`ORG BASE` with `BASE EQU` below) now sets the origin instead of emitting 32 KB
  of zeros.
- An EQU redefined with a different value, or a code label and an EQU/DEFL with the
  same name. DEFL and `=` stay redefinable.
- A literal `0xFFFF` in an 8-bit slot (`db 0xFFFF`, `ld a,65535`); `DB 1==1` and
  negative constants still fit.
- A macro call with too few arguments, an empty list element (`DB 1,`), a
  non-numeric `-D` value (`-D NAME=true`), a `DEVICE` other than `ZXSPECTRUM48`,
  missing or extra operands (a bare `RST` was `RST 0`), and an `INCBIN` range past
  the end of the file.

Also fixed:

- `0B0h` is hex, `7%10` is modulo, `( hl )` means `(HL)`.
- An unresolved branch target gives one error; errors inside a macro name the call
  site; a missing operand no longer leaks a JavaScript error.
- `label: Macro args` and `label: INCLUDE "file"` work (the include was skipped).
- `--sandbox` compares real paths, ignoring case on Windows.
- SLD source-line records cover data directives, so breakpoints can target them.
- The disassembler no longer decodes four or more `DD`/`FD` prefixes as `CALL nn`.
- A failed `zxasm assemble` prints its hints and warnings, and `zxasm doctor`
  really assembles a probe instruction.
