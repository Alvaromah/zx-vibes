---
"@zx-vibes/asm": patch
---

`zxasm disasm` stops at the end of the file. It used to read the bytes after the end as
`0x00`: a 3-byte file listed 30 `NOP`s after its two instructions, and a file ending in the
first byte of `CALL nn` listed `CALL 0x0000`. An instruction the file ends inside of is now
listed as the data bytes that exist (`DB 0xCD`). `--count` is still the most instructions
listed, and `disasm --help` shows its default (32).
