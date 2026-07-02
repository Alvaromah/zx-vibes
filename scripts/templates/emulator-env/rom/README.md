# ROM — host asset (not part of the DNA)

To boot BASIC the emulator needs the **ZX Spectrum 48K ROM**: a 16 KB (16384-byte)
binary that maps to memory `0x0000–0x3FFF`.

Place it here as:

```
rom/48.rom        # exactly 16384 bytes
```

## Why it is not in the genome

The DNA documents the ROM's *addresses and observable behavior* (it is the normative
spec the CPU/ULA/machine are judged against), but the **ROM binary itself is a
copyrighted host asset**, not a regenerable phenotype. It is therefore supplied
separately, like the test games in `../tapes/`.

## Provenance / copyright

The 48K ROM is © 1982 Sinclair Research Ltd; its copyright is now held by Amstrad,
which has granted permission for redistribution for emulation use. Obtain it from a
reputable ZX Spectrum emulator distribution or archive, verify it is exactly 16384
bytes, and keep this notice. Record the source and SHA-256 you used in `NOTES.md`.

The agent must **not** fabricate or stub a fake ROM. If `48.rom` is absent, the shell
should say so plainly rather than boot a placeholder.
