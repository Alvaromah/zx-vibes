# .z80 Snapshot Format (48K ZX Spectrum)

The normative reference for the `.z80` machine-state snapshot format as the
regenerated machine reads and writes it (`@zx-vibes/machine` `readZ80` /
`writeZ80`). A snapshot captures the full observable machine state — the Z80
register file, the 64 KB memory image, and the border colour — so that writing a
running machine to a `.z80` and reading it back reproduces it exactly
(FMT-Z80-V3-001).

`.z80` is the de-facto community ZX Spectrum snapshot format (originally Gerton
Lunter's `Z80` emulator). It is an external file-format convention, not hardware;
its layout is therefore a **contract** the regenerated machine adopts, pinned here
and witnessed by `dna/conformance/formats/z80-v3-roundtrip.json`. This document
specifies the 48K subset: the machine **writes** version 3 and **reads** versions
1, 2 and 3.

## Header

<!-- provenance: contract -->
- [id: FMT-Z80-HEADER-001] The first 30 bytes are the version-1 header (all
  multi-byte values little-endian): byte 0 `A`, 1 `F`, 2–3 `BC`, 4–5 `HL`, 6–7 the
  v1 `PC`, 8–9 `SP`, 10 `I`, 11 `R` (low 7 bits), 12 a flag byte, 13–14 `DE`,
  15–16 `BC'`, 17–18 `DE'`, 19–20 `HL'`, 21 `A'`, 22 `F'`, 23–24 `IY`, 25–26 `IX`,
  27 `IFF1`, 28 `IFF2`, 29 the interrupt-mode/flags byte (bits 0–1 = `IM`). Flag
  byte 12: bit 0 is the high bit of `R`, bits 1–3 are the border colour, bit 5 is
  the v1 "RAM is RLE-compressed" flag; a stored value of 255 is read as 1.

<!-- provenance: contract -->
- [id: FMT-Z80-VERSION-001] A v1 `PC` (bytes 6–7) of `0` is the marker for version
  2/3: the real `PC` then lives in the extra header. The extra header begins at
  byte 30 with its own little-endian length (bytes 30–31): `23` ⇒ version 2,
  `54`/`55` ⇒ version 3. Bytes 32–33 are `PC`; byte 34 is the hardware mode (`0` =
  48K). The writer emits version 3 with extra length `54` and hardware mode `0`.

## Memory

<!-- provenance: contract -->
- [id: FMT-Z80-PAGES-001] In versions 2/3 the memory follows the extra header as a
  sequence of page blocks, each `[length(2, little-endian), page(1), data]`. A
  length of `0xFFFF` means the 16384-byte page is stored uncompressed; otherwise
  `data` is `length` RLE-compressed bytes. On a 48K machine the page numbers map to
  addresses: page `8` ⇒ `0x4000`–`0x7FFF`, page `4` ⇒ `0x8000`–`0xBFFF`, page `5`
  ⇒ `0xC000`–`0xFFFF`. The writer emits exactly these three pages; the reader maps
  blocks by page number, requires all three (FMT-Z80-VALIDATE-001) and ignores pages
  outside the 48K map. In a version-1 file
  the 48 KB RAM follows the 30-byte header as a single image from `0x4000`,
  RLE-compressed iff flag-byte bit 5 is set, terminated by the marker `00 ED ED 00`.

<!-- provenance: contract -->
- [id: FMT-Z80-RLE-001] The RLE encoding marks a run with the two-byte prefix
  `ED ED`, followed by a count byte (1–255) and the repeated value:
  `ED ED count value`. A run of 5 or more equal bytes is compressed; a run of 2 or
  more equal `ED` bytes is compressed (a literal `ED ED` in the stream would
  otherwise be misread as the marker). A lone `ED` is emitted with its following
  byte verbatim so it can never begin a spurious marker. Decoding expands every
  `ED ED count value` and copies all other bytes literally.

## Validation

<!-- provenance: contract -->
- [id: FMT-Z80-VALIDATE-001] The reader **rejects** (throws) a file that is not a
  complete 48K snapshot, instead of decoding it into a partly zeroed machine that
  would then run: a file shorter than the 30-byte header; a version-1 RAM image
  shorter than 49152 bytes, or a compressed one that expands to fewer; a
  version-2/3 extra-header length other than `23`, `54` or `55`, or a file that ends
  inside the extra header; a hardware mode (byte 34) that is not a 48K machine; a
  page block whose data runs past the end of the file, or that expands to fewer
  than 16384 bytes; and a version-2/3 file missing any of pages `8`, `4`, `5`. The
  48K hardware modes are `0` (48K), `1` (48K + Interface 1) and `2` (SamRam) in
  version 2, plus `3` (48K + M.G.T.) in version 3. Higher modes are 128K-class or
  later machines, whose page numbers mean different RAM banks (page `5` is bank 2,
  page `8` bank 5, and `0xC000` holds the paged bank), so they would load scrambled
  into the 48K map. Bit 7 of byte 37 ("modify hardware") turns a 48K mode into a
  16K Spectrum, which stores only page `8`, so such a file fails the page check.
  Still accepted: page blocks outside the 48K map (an add-on's ROM or RAM), which
  are skipped, and fewer than 3 trailing bytes after the last block (too short for
  a page header), which are ignored. The flag-byte rule of FMT-Z80-HEADER-001
  (`255` reads as `1`) applies to every field that byte carries, so such a file has
  border `0`.

## Acceptance criteria

A regenerated `.z80` reader/writer satisfies these facts iff it passes, through
`dna/conformance/formats/run-format-fixtures.mjs`:

- `dna/conformance/formats/z80-v3-roundtrip.json` (FMT-Z80-V3-001) — writing a 48K
  state (registers + sparse RAM including page boundaries and `ED`-heavy runs +
  border) and reading it back preserves the RAM, registers, and border.
- the `FMT-Z80-V3-DECODE-001` fixture in the same file — decoding a pinned,
  hand-authored version-3 48K blob yields the expected registers, border, version,
  and RAM cells, pinning the header offsets (FMT-Z80-HEADER-001), the v2/3 marker
  and extra header (FMT-Z80-VERSION-001), the page-block layout (FMT-Z80-PAGES-001),
  and the RLE (FMT-Z80-RLE-001) to the documented format rather than to the writer's
  own inverse.
- the `FMT-Z80-VALIDATE-001` fixture in the same file — five files the reader must
  accept (48K + M.G.T., a version-2 SamRam file, flag byte 255, a skipped foreign
  page, trailing bytes) and eleven it must reject with a matching message
  (FMT-Z80-VALIDATE-001); the self-test proves a reader that never rejects fails it.
