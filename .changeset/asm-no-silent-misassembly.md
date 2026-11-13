---
"@zx-vibes/asm": minor
---

Source that used to assemble to the wrong bytes with no diagnostic now fails or warns, so
a few sources that assembled before are now errors; each of them was being misassembled.

- `EQU`, `DEFL`, `=` and define values keep their full value in expressions:
  `CPU_HZ EQU 3500000` / `dw CPU_HZ/1000` is 3500 (it was 26), and `N EQU -3` /
  `IF N < 0` is true. A constant that does not fit the slot it is used in (`dw CPU_HZ`)
  is a range error instead of its low 16 bits. Exported symbol values and the SLD keep
  16 bits.
- `ei : ret` is an error: the colon made `ei` a label and only `ret` was assembled. Put
  one instruction per line.
- An unclosed `(` (`db (1+2`, `ld hl,(buf`) and a unary operator with no operand
  (`db -`, `db ~`) are errors; `ld a,'\0'` reports the unsupported escape.
- `bit 0,ixh`, `rlc ixh`, `in ixh,(c)` and `out (c),iyl` are errors (they dropped the
  index prefix), as are `in (hl),(c)`, `out (c),(hl)`, `srl a,2` and
  `rlc (ix+1),zzz`.
- Macro arguments are substituted in one pass, and parameters and DUP counters are not
  substituted inside numbers (`1b`). A column-0 macro call with the argument `end` is a
  call.
- A source `DEFINE` is not visible above its line, and `DEFINE FLAG` reads as 1 in
  `IF FLAG`, as `-D FLAG` does.
- `ld a,(1+2)*(3+4)` assembles as an immediate; `ld b,(5)` and `cp (5)` warn that the
  parentheses are grouping.
- `INCLUDE` without a file name and `EQU`/`DEFL` without a name are errors.
