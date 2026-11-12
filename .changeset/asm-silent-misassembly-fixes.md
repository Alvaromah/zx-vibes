---
"@zx-vibes/asm": patch
---

Fix several cases where valid source assembled to the wrong bytes without an
error, and two crashes.

- `call end`, `jp end`, `dw end` (any instruction or directive whose operand is a
  label named `end`) no longer end the source there and drop every later line.
- `FOO: EQU 5`, `FOO: DEFL 7` and `FOO: = 3` define a constant, like the
  colon-less forms; the label used to take the current address.
- `db 'a'-'A'` is an expression (0x20), not the five raw characters; a DB/DISPLAY
  argument is a string only when it is exactly one quoted literal.
- `ld a,(ixcount)` (a label starting with `ix`/`iy`) is an absolute address, not
  `ld a,(ix+count)`.
- `ex af,af'` followed by a `;` comment assembles; the `'` of `AF'` no longer opens
  a string.
- A large `DS`/`INCBIN` no longer overflows the call stack, and `INCLUDE`/`INCBIN`
  of a directory is a "file not found" diagnostic instead of an EISDIR crash.
- `assemble(source, { cwd })` resolves `entryPath` and quoted includes against
  `cwd`, like `assembleFile`.
- `zxasm` with no command prints its help instead of `error: (outputHelp)`.
