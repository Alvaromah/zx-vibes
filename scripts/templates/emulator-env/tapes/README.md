# Tapes & snapshots — host assets (not part of the DNA)

Drop sample game files here to exercise loading and play:

```
tapes/
  *.z80     # snapshots — loaded via the DNA-proven readZ80 codec
  *.tap     # tape images — loader-defined shell work (no DNA fixture)
  *.tzx     # tape images — loader-defined shell work (no DNA fixture)
```

## What each format proves

- **`.z80`** — the reliable, **DNA-proven** load path. The `.z80` byte layout is
  authoritative in `dna/domain/snapshot-z80.md` and covered by
  `dna/conformance/formats/`. Prefer a `.z80` for the first "load a game" milestone.
- **`.tap` / `.tzx`** — **loader-defined** (`dna/product/file-formats.md` FF-TAPE-001):
  the DNA pins no byte layout and ships no fixture. The loader is Layer-3 shell work,
  implemented from public ZX Spectrum knowledge and verified by observation only.

## Sourcing

Use freely-redistributable or public-domain titles, or files you own, from a
reputable ZX Spectrum archive (e.g. World of Spectrum). Record each file's title and
provenance in `NOTES.md`. Do not commit copyrighted games you do not have the right to
redistribute.
