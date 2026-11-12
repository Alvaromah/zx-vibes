---
"@zx-vibes/cpu": minor
"@zx-vibes/machine": minor
---

Make the 48K core behave like the real machine in five places it did not.

- `DD 76` / `FD 76` execute as `HALT` (8 T-states, PC left on the `76`, halted
  until an interrupt, which returns past the `76`). They were decoded as
  `LD (IX+d),(IX+d)`: 19 T-states, three bytes and a memory write.
- New opt-in read-only ROM: `createMachine({ romWriteProtect: true })` drops every
  write below `0x4000` (instructions, interrupt and NMI pushes, instant tape loads)
  while keeping the write cycle's timing. The CPU takes the same limit as
  `step({ romTop })`. The default is unchanged (flat 64 KB RAM).
- `instantLoad` returns what the ROM's `LD-BYTES` returns for every block: VERIFY
  (`load: false`) compares each byte and stops at the first difference; a block
  shorter than `DE` takes its own checksum byte as data and fails (it could report
  success before); a longer block loads `DE` bytes and reads the next as the
  checksum. Each case is checked against the real ROM loading the same block.
- `readZ80` throws (`readZ80: …`) on a file that is not a complete 48K snapshot
  (too short, truncated, an unknown extra-header length, a 128K-class hardware mode,
  a page that expands short, or a missing 48K page) instead of decoding it into a
  partly zeroed machine, so a 128K snapshot no longer loads scrambled. A flag byte
  of 255 now gives border 0, as the format specifies.
- `parseTzx` reads the TZX v1.20 control blocks (`0x23`–`0x28`, `0x2A`, `0x2B`)
  and informational blocks (`0x31`–`0x33`, `0x35`, `0x5A`) instead of rejecting the
  whole file, and `serializeTzx` writes them back byte for byte. They have no `data`
  field, so code that loads the data blocks skips them.
