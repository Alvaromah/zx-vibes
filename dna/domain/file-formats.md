# File formats — byte-level layouts (domain)

The byte-level, normative layout of the standard files zx-vibes reads and writes.
Self-contained (constraint C2): every offset and field is stated here, not deferred
to an external PDF. The product-level *index* of formats (which spec owns which
format, and its tier) is [`../product/file-formats.md`](../product/file-formats.md);
this file is the byte authority it points to for the screen/tape family.

> Authoring status: this file is populated slice by slice (roadmap W10). `.scr`
> (W10.4), `.tap` (W10.6) and `.tzx` (W10.7) are below. The `.z80`/`.sna` snapshot
> byte layouts already live in [`snapshot-z80.md`](snapshot-z80.md).

## `.scr` — raw screen dump (6912 bytes)

A `.scr` file is the de-facto ZX Spectrum screen-snapshot format: a **raw, headerless
copy of the screen memory region** `0x4000`–`0x5AFF` — the 6144-byte display file
immediately followed by the 768-byte attribute file, exactly the bytes a real 48K
machine holds. It carries no header, no footer, no compression, and no reordering: the
display portion keeps the hardware non-linear "thirds" layout precisely as it sits in
memory (see [`memory-map.md`](memory-map.md) `MM-SCREEN-ADDR-001`). It is therefore the
exact 6912-byte image the gallery framebuffer consumes
([`../product/screen-render.md`](../product/screen-render.md) `SCREEN-FRAMEBUFFER-001`,
whose `screen` input has offset 0 = address `0x4000`).

<!-- provenance: hardware -->
- [id: FMT-SCR-SIZE-001] A `.scr` file is exactly **6912 bytes** = 6144 (display file,
  `0x4000`–`0x57FF`) + 768 (attribute file, `0x5800`–`0x5AFF`). A file of any other
  length is not a valid 48K `.scr`. (`memory-map.md` `MM-LAYOUT-001` /
  `MM-SCREEN-DISPLAY-FILE-001` / `MM-ATTR-FILE-001`.)

<!-- provenance: hardware -->
- [id: FMT-SCR-LAYOUT-001] The file is a flat memory image: file offset `o`
  (`0 ≤ o ≤ 6911`) is memory address `0x4000 + o`. So offsets `0`–`6143` are the
  display file and offsets `6144`–`6911` are the attribute file, in address order.
  Worked points: offset `0` → `0x4000` (first display byte), offset `6143` → `0x57FF`
  (last display byte), offset `6144` → `0x5800` (first attribute byte), offset `6911`
  → `0x5AFF` (last attribute byte). There is **no** scanline re-ordering: a loader that
  deinterleaves the display file into linear top-to-bottom rows corrupts the image.

<!-- provenance: hardware -->
- [id: FMT-SCR-LOAD-001] Loading a `.scr` writes its 6912 bytes into memory at
  `0x4000 + o` and touches **no** address outside `0x4000`–`0x5AFF`: `memory[0x3FFF]`
  and `memory[0x5B00]` are unchanged. (A loader that assumes a header offset, or that
  writes past `0x5AFF` into the system variables, fails.)

<!-- provenance: hardware -->
- [id: FMT-SCR-SAVE-001] Saving reads exactly `0x4000`–`0x5AFF` into a 6912-byte file
  in address order (`file[o] = memory[0x4000 + o]`). No header is prepended and no
  attribute byte is dropped (a 6144-byte "display-only" save is not a `.scr`).

<!-- provenance: hardware -->
- [id: FMT-SCR-ROUNDTRIP-001] The format is a pure copy, so it round-trips byte for
  byte: `save(load(f)) = f` for every 6912-byte `f`, and `load` then `save` reproduces
  the `0x4000`–`0x5AFF` region unchanged. There is no lossy normalization step.

### Model contract (the regeneration target)

The screen-region copy is modeled in `@zx-vibes/ula`
(`packages/ula/src/scr-format.mjs`, re-exported from the package index), reusing the
W10.1 region constants (`DISPLAY_FILE_BASE` = `0x4000`, the display/attribute sizes):

```text
export const SCR_SIZE = 6912            // 6144 display + 768 attribute
export const SCR_BASE = 0x4000          // first byte's address
export function saveScr(memory) -> Uint8Array  // length 6912 = memory[0x4000..0x5AFF]
export function loadScr(memory, scr) -> void   // writes scr (length 6912) into 0x4000..; region only
```

Acceptance: `dna/conformance/formats/scr-format.json` (`FMT-SCR-*`, `FORMAT-SCR-001`)
via `dna/conformance/formats/run-scr-fixtures.mjs` against the shipped `@zx-vibes/ula`.
The self-test rejects a loader that assumes a header offset, a save that drops the
attribute file (wrong size), a deinterleaving (scanline-reordering) copy, and a load
that writes outside the screen region. The *render* of a loaded `.scr` is already
pinned by `SCREEN-FRAMEBUFFER-001` (the `.scr` is byte-identical to that row's `screen`
input), so this slice adds no new gallery row.

## `.tap` — tape image (block stream)

A `.tap` file is the de-facto community ZX Spectrum **tape image**: a flat
concatenation of **blocks**, with **no** file header, no footer, no global length,
and no compression. Each block is the *payload* of one ROM tape block (the leading
type byte plus the data plus the trailing checksum) prefixed by a 2-byte length —
the pilot tone, sync pulses and pulse-level encoding a real tape carries are
stripped, leaving only the bytes. It is an external file-format convention, not
hardware (the bytes *inside* a block mirror the ROM tape block; the 2-byte length
prefix and the block concatenation are the container), so — like `.z80`/`.sna`
([`snapshot-z80.md`](snapshot-z80.md)) — its layout is a **contract** the toolkit
adopts, pinned here and witnessed by `dna/conformance/formats/tap-format.json`.

A single block, in order on disk:

```text
[ length   : 2 bytes, little-endian ]   ; L = number of bytes that follow in THIS block
[ flag     : 1 byte                 ]   ; block type: 0x00 = header, 0xFF = data (standard ROM)
[ data     : L - 2 bytes            ]   ; the block payload (may be empty)
[ checksum : 1 byte                 ]   ; XOR of the flag byte and every data byte
```

<!-- provenance: contract -->
- [id: FMT-TAP-BLOCK-001] A `.tap` file is **zero or more blocks concatenated with no
  separator, header or footer**. Reading walks the file front to back: read the 2-byte
  length `L`, consume the next `L` bytes as that block's body, then repeat from the byte
  after it. The file ends exactly at the end of the last block — there is no trailing
  padding and no global count. An **empty file (0 bytes) is a valid `.tap` with zero
  blocks**. A block body is `[flag][data…][checksum]`: the first body byte is the flag,
  the last is the checksum, and the `L − 2` bytes between them are the data (which may be
  empty when `L = 2`).

<!-- provenance: contract -->
- [id: FMT-TAP-LENGTH-001] The 2-byte length is **little-endian** (`file[o]` is the low
  byte, `file[o+1]` the high byte: `L = file[o] + (file[o+1] << 8)`) and counts the
  **flag byte + data bytes + checksum byte** — everything after the length, **including**
  the checksum and **excluding** the length bytes themselves. So a block carrying `n` data
  bytes has `L = n + 2` and occupies `2 + L = n + 4` bytes on disk. Worked points: the
  standard 17-byte header (`n = 17`) is `L = 19` → on disk `13 00 00 …` (21 bytes); the
  **smallest** possible block is `L = 2` (flag + checksum, **no** data), 4 bytes on disk,
  written `02 00`. A reader that counts the length bytes in `L`, or that omits the
  checksum from `L`, mis-frames every block after the first.

<!-- provenance: contract -->
- [id: FMT-TAP-FLAG-001] The first body byte is the **flag (block-type) byte**. The
  de-facto standard, following the 48K ROM, uses **`0x00` for a header block** and
  **`0xFF` for a data block** (the ROM treats flag `< 0x80` as a header, `≥ 0x80` as
  data, and `LD-BYTES` matches the requested flag against it). The `.tap` container itself
  imposes no constraint on the value — any byte `0x00`–`0xFF` is carried verbatim — and the
  flag **participates in the checksum**.

<!-- provenance: contract -->
- [id: FMT-TAP-CHECKSUM-001] The last body byte is a **checksum = the bitwise XOR of the
  flag byte and every data byte** (equivalently, the XOR of the first `L − 1` body bytes;
  the checksum excludes itself and the length). This mirrors the 48K ROM tape parity byte
  (`SA-BYTES` accumulates it on save, `LD-BYTES` recomputes and compares it on load), so a
  reader that recomputes the XOR over flag+data and finds it ≠ the stored checksum must
  **reject the block as corrupt**. Edge case: a block with **no** data (`L = 2`) has
  `checksum = flag` (the XOR of the flag alone). A checksum taken over the data **only**
  (omitting the flag) is wrong for any block with a non-zero flag (e.g. a `0xFF` data
  block).

<!-- provenance: contract -->
- [id: FMT-TAP-ROUNDTRIP-001] Serialization is the exact inverse of parsing: writing a
  block computes its checksum from flag+data, prepends `L = dataLength + 2` as a
  little-endian 2-byte length, and concatenates the blocks in order; so
  `serialize(parse(file)) = file` for every well-formed `file`, and
  `parse(serialize(blocks))` recovers each block's flag, data and (recomputed) checksum.
  There is no lossy normalization: the byte stream is preserved exactly.

### Model contract (the regeneration target)

The block stream is modeled in `@zx-vibes/machine`
(`packages/machine/src/tap-format.mjs`, re-exported from the package index) —
alongside the `.z80`/`.sna` snapshot codecs, since tape, like a snapshot, is a file
the **machine** loads:

```text
export function tapChecksum(flag, data) -> number        // XOR of flag and all data bytes (0..255)
export function parseTap(bytes) -> Array<{ flag, data: Uint8Array, checksum }>
                                                         // splits the file into blocks; validates each
                                                         // checksum; throws on a truncated block or mismatch
export function serializeTap(blocks) -> Uint8Array        // blocks: [{ flag, data }]; emits [len LE][flag][data][cksum]
```

Acceptance: `dna/conformance/formats/tap-format.json` (`FMT-TAP-*`, `FORMAT-TAP-001`)
via `dna/conformance/formats/run-tap-fixtures.mjs` against the shipped
`@zx-vibes/machine`. Because the byte layout has **genuine ambiguity** (checksum
scope, what the length field counts, endianness — fidelity-tier per the harness method
calibration), the self-test runs the full machinery: the real fixture is validated
against an **independent reference** re-derived from this spec, and adversarial broken
models — a **big-endian** length, a length that **omits the checksum** (off-by-one), a
checksum taken over the **data only** (dropping the flag), and a parser that **skips
checksum validation** — are each rejected. Two blind regenerations from this spec agreed
byte-for-byte (no DNA gap).

## `.tzx` — tape image (versioned block stream)

A `.tzx` file is the de-facto community ZX Spectrum **tape archive**: a fixed
file header followed by a flat sequence of **typed blocks**, each introduced by a
1-byte **block ID**. Unlike `.tap` (which carries only the bytes inside each ROM
block, [`.tap` — tape image](#tap--tape-image-block-stream)), `.tzx` records the
*pulse-level* structure of a tape — pilot/sync/bit pulse lengths, pure tones,
pauses — plus archival metadata (group names, text). It is an external file-format
**contract** (like `.z80`/`.sna`/`.tap`): the layout is pinned by the published TZX
specification, not by hardware, so these claims are provenance `contract`.

**Pinned version (self-contained, constraint C2):** this slice authors **TZX v1.20**
(major `1`, minor `20`; dated 2006-12-19), the current revision of the format
specification. Spec reference (authority for the byte layout transcribed here, *not*
a runtime dependency): `https://worldofspectrum.net/TZXformat.html`. Every offset,
size and default below is restated in full so no normative claim depends on fetching
that page.

**Scope of this slice.** The header plus the most common nine block IDs are
modeled: `0x10` standard-speed data, `0x11` turbo-speed data, `0x12` pure tone,
`0x13` pulse sequence, `0x14` pure data, `0x20` pause/stop-the-tape, `0x21` group
start, `0x22` group end, `0x30` text description. The remaining v1.20 IDs (`0x15`
direct recording, `0x18`/`0x19` CSW/generalized, `0x23`–`0x28` flow control,
`0x2A`/`0x2B`, `0x31`–`0x35` metadata) are **out of scope** for this slice; a parser
that meets this contract rejects an unmodeled block ID rather than guessing its
length (later slices may extend the set — see roadmap W10.9+).

### Header (10 bytes)

```text
offset  size  field
0x00    7     signature: ASCII "ZXTape!"  (5A 58 54 61 70 65 21)
0x07    1     end-of-text marker: 0x1A
0x08    1     major version  (this slice: 0x01)
0x09    1     minor version  (this slice: 0x14 = 20)
```

<!-- provenance: contract -->
- [id: FMT-TZX-HEADER-001] A `.tzx` file **begins with a 10-byte header**: the 7
  ASCII bytes `ZXTape!` (`5A 58 54 61 70 65 21`), then the byte `0x1A` (the classic
  DOS end-of-text marker), then a 1-byte **major** version and a 1-byte **minor**
  version, in that order (major **before** minor). A file whose first 8 bytes are not
  exactly `ZXTape!\x1A`, or that is shorter than 10 bytes, is **not** a valid `.tzx`
  and must be rejected. The blocks (if any) begin at offset `0x0A`, immediately after
  the header; a header with no following blocks is a valid, empty tape.

<!-- provenance: contract -->
- [id: FMT-TZX-ENDIAN-001] Every multi-byte integer field in the header and in every
  block below is **little-endian** (least-significant byte first). A `WORD` is 2
  bytes (`v = b0 + (b1 << 8)`); the data-length field of the turbo (`0x11`) and pure-data
  (`0x14`) blocks is a **3-byte** little-endian value (`v = b0 + (b1 << 8) + (b2 << 16)`),
  **not** a 2-byte `WORD` — reading it as 2 bytes mis-frames every following block.

### Block stream

<!-- provenance: contract -->
- [id: FMT-TZX-BLOCK-STREAM-001] After the header the file is a **flat sequence of
  blocks with no separator, count or footer**. Reading walks front to back: read the
  1-byte **block ID**, then consume exactly that block's body (whose size is fixed by
  the ID and that block's own length fields), then repeat from the byte after the body.
  The file ends at the end of the last block; there is no trailing padding. A block
  whose body (per its declared length) runs past end-of-file is **truncated** and must
  be rejected. A block ID outside the modeled set (above) is **unsupported** and must
  be rejected (the parser cannot safely skip a block whose length rule it does not
  know).

### Block `0x10` — Standard-speed data

```text
offset  size  field                          default
0x00    2     pause after this block (ms)    {1000}
0x02    2     length of data that follows N  —
0x04    N     data bytes
```

<!-- provenance: contract -->
- [id: FMT-TZX-DATA-0x10-001] Block ID `0x10` is a standard-speed (ROM-timed) data
  block. Its body is a 2-byte little-endian **pause** (milliseconds of silence after
  the block; default `1000`), then a **2-byte little-endian** data length `N`, then `N`
  data bytes. The block occupies `1 + 4 + N` bytes on disk (ID + 4 fixed + data). The
  data bytes are the raw ROM block payload (flag + data + checksum, as in `.tap`); this
  slice carries them verbatim and does not re-interpret them. The length here is a
  **2-byte** `WORD` (contrast the turbo block `0x11`, whose length is 3 bytes).

### Block `0x11` — Turbo-speed data

```text
offset  size  field                              default
0x00    2     pilot pulse length (T-states)      {2168}
0x02    2     sync first pulse length            {667}
0x04    2     sync second pulse length           {735}
0x06    2     zero-bit pulse length              {855}
0x08    2     one-bit pulse length               {1710}
0x0A    2     pilot tone length (pulse count)    {8063 header / 3223 data}
0x0C    1     used bits in the last byte (0-8)   {8}
0x0D    2     pause after this block (ms)        {1000}
0x0F    3     length of data that follows N      —      (3-byte little-endian)
0x12    N     data bytes
```

<!-- provenance: contract -->
- [id: FMT-TZX-TURBO-0x11-001] Block ID `0x11` is a turbo-speed (custom-timed) data
  block. Its fixed body is **18 bytes**: six 2-byte little-endian pulse-timing `WORD`s
  (pilot, sync-1, sync-2, zero-bit, one-bit, pilot-tone pulse count), then a 1-byte
  **used-bits-in-last-byte** (0-8), then a 2-byte little-endian **pause**, then a
  **3-byte little-endian** data length `N` at offset `0x0F`. `N` data bytes follow at
  offset `0x12`. The block occupies `1 + 18 + N` bytes on disk. The defining hazard of
  this block is the **3-byte** length: a reader that takes it as a 2-byte `WORD` (and
  jumps to offset `0x11` for the data) mis-frames the block and everything after it.

### Block `0x12` — Pure tone

```text
offset  size  field
0x00    2     pulse length (T-states)
0x02    2     number of pulses
```

<!-- provenance: contract -->
- [id: FMT-TZX-TONE-0x12-001] Block ID `0x12` is a pure tone: a fixed **4-byte** body
  of two 2-byte little-endian `WORD`s — the length of one pulse (in T-states) and the
  number of pulses — with no data section. The block occupies `1 + 4` bytes on disk.

### Block `0x13` — Pulse sequence

```text
offset  size    field
0x00    1       number of pulses N
0x01    2 * N   pulse lengths (N little-endian WORDs)
```

<!-- provenance: contract -->
- [id: FMT-TZX-PULSES-0x13-001] Block ID `0x13` is a sequence of individually-timed
  pulses: a 1-byte **count** `N`, then `N` 2-byte little-endian pulse lengths (each in
  T-states). The block occupies `1 + 1 + 2·N` bytes on disk. The body length is driven
  by the count byte, so a reader that misreads `N`, or that treats the pulses as bytes
  rather than `WORD`s, mis-frames the next block.

### Block `0x14` — Pure data

```text
offset  size  field                            default
0x00    2     zero-bit pulse length            —
0x02    2     one-bit pulse length             —
0x04    1     used bits in the last byte (0-8) {8}
0x05    2     pause after this block (ms)      {1000}
0x07    3     length of data that follows N    —      (3-byte little-endian)
0x0A    N     data bytes
```

<!-- provenance: contract -->
- [id: FMT-TZX-PUREDATA-0x14-001] Block ID `0x14` is a pure data block (data with no
  pilot/sync — the bit-timing only). Its fixed body is **10 bytes**: a 2-byte
  little-endian zero-bit pulse length, a 2-byte little-endian one-bit pulse length, a
  1-byte used-bits-in-last-byte, a 2-byte little-endian pause, then a **3-byte
  little-endian** data length `N` at offset `0x07`. `N` data bytes follow at offset
  `0x0A`. The block occupies `1 + 10 + N` bytes on disk. As with `0x11`, the data
  length is **3 bytes**, not a 2-byte `WORD`.

### Block `0x20` — Pause (silence) / stop the tape

```text
offset  size  field
0x00    2     pause duration (ms); 0 = "stop the tape"
```

<!-- provenance: contract -->
- [id: FMT-TZX-PAUSE-0x20-001] Block ID `0x20` is a pause: a fixed **2-byte**
  little-endian duration in milliseconds, with no data section. A duration of **0**
  carries the special meaning "stop the tape" (the player halts until the user
  restarts it); any non-zero value is a silence of that many milliseconds. The block
  occupies `1 + 2` bytes on disk.

### Blocks `0x21` / `0x22` — Group start / group end

```text
0x21:  offset  size  field
       0x00    1     length of group-name string L
       0x01    L     group name (ASCII)

0x22:  (no body)
```

<!-- provenance: contract -->
- [id: FMT-TZX-GROUP-0x21-0x22-001] Block ID `0x21` (group start) names a run of
  blocks: a 1-byte **name length** `L`, then `L` ASCII bytes of the group name. It
  occupies `1 + 1 + L` bytes on disk. Block ID `0x22` (group end) has **no body** and
  occupies a single byte (just the ID). Groups are bracketing metadata for players;
  they carry no tape signal. A reader must consume `0x22` as a complete, zero-length
  block (advancing exactly one byte), not look for a length field that is not there.

### Block `0x30` — Text description

```text
offset  size  field
0x00    1     length of the text string N
0x01    N     description text (ASCII)
```

<!-- provenance: contract -->
- [id: FMT-TZX-TEXT-0x30-001] Block ID `0x30` is a free-text description: a 1-byte
  **text length** `N`, then `N` ASCII bytes. It occupies `1 + 1 + N` bytes on disk.
  Multiple lines within the text are separated by ASCII `0x0D` (carriage return); this
  slice carries the text bytes verbatim and does not normalize line endings.

### Round-trip

<!-- provenance: contract -->
- [id: FMT-TZX-ROUNDTRIP-001] Serialization is the exact inverse of parsing: emit the
  10-byte header, then each block as its ID byte followed by the body bytes laid out
  above (little-endian length/timing fields, data verbatim). So
  `serialize(parse(file)) = file` for every well-formed `file`, and
  `parse(serialize(blocks))` recovers each block's ID and fields. There is no lossy
  normalization step: a parsed-then-serialized file is byte-identical to the original.

### Model contract (the regeneration target)

The header + block stream is modeled in `@zx-vibes/machine`
(`packages/machine/src/tzx-format.mjs`, re-exported from the package index) —
alongside the `.tap`/`.z80`/`.sna` codecs, since tape, like a snapshot, is a file the
**machine** loads:

```text
export const TZX_SIGNATURE = "ZXTape!"               // 7 ASCII bytes (excludes the 0x1A marker)
export const TZX_VERSION   = { major: 1, minor: 20 } // the pinned v1.20

export function parseTzx(bytes) -> { version: { major, minor }, blocks: [ <block> ] }
                                  // validates the signature; walks blocks; throws on a
                                  // bad signature, a truncated block, or an unsupported ID
export function serializeTzx(tzx) -> Uint8Array
                                  // tzx: { version?, blocks }; emits header + each block's bytes
```

Each parsed block is `{ id, … }` with the per-ID fields named above (e.g. `0x10` →
`{ id, pause, data }`; `0x11` → `{ id, pilot, sync1, sync2, zero, one, pilotPulses,
usedBits, pause, data }`; `0x12` → `{ id, pulseLength, pulseCount }`; `0x13` →
`{ id, pulses: [...] }`; `0x14` → `{ id, zero, one, usedBits, pause, data }`; `0x20` →
`{ id, pause }`; `0x21` → `{ id, name }`; `0x22` → `{ id }`; `0x30` → `{ id, text }`).
Data sections are `Uint8Array`; group name / text are ASCII (Latin-1) strings.

Acceptance: `dna/conformance/formats/tzx-format.json` (`FMT-TZX-*`, `FORMAT-TZX-001`)
via `dna/conformance/formats/run-tzx-fixtures.mjs` against the shipped
`@zx-vibes/machine`. Because the byte layout has **genuine ambiguity** (the 3-byte vs
2-byte length fields, per-block fixed-header sizes, little-endianness, major/minor
order — fidelity-tier per the harness method calibration), the self-test runs the full
machinery: the real fixtures are validated against an **independent reference**
re-derived from this spec, and adversarial broken models — a **big-endian** word
reader, a model that reads the turbo/pure-data length as a **2-byte `WORD`** (dropping
the third length byte), a **version-swap** (minor/major) model, and a parser that
**skips the signature check** — are each rejected. Two blind regenerations from this
spec agreed byte-for-byte (no DNA gap).

## Provenance

The `.scr` claims are `hardware`: the byte layout is the documented screen memory image
(`memory-map.md`), and `.scr` is universally defined as a raw, headerless dump of that
region (grounded by `docs/reference/screen-layout.md` + `docs/reference/memory-map.md`).
The `.tap` claims are `contract`: like `.z80`/`.sna`, `.tap` is an external community
file-format convention (the 2-byte length prefix and block concatenation are the
container), not a hardware mandate — its layout is the contract the toolkit adopts. The
bytes *inside* a block (flag byte, XOR checksum) mirror the 48K ROM tape block; that
ROM-level encoding (`SA-BYTES`/`LD-BYTES`, pilot/sync/bit pulse timing) is authored in
[`tape-loading.md`](tape-loading.md) (`TAPE-PULSE-*`, `TAPE-EAR-PULSES-001`, W10.9): a
`.tap` block body is transmitted as exactly that pulse stream.
The `.tzx` claims are `contract` for the same reason: `.tzx` is an external,
community-published file-format specification (header signature, per-ID block layout),
not a hardware mandate. Its byte layout is transcribed in full from the **pinned TZX
v1.20** spec (`https://worldofspectrum.net/TZXformat.html`), so the DNA stays
self-contained (C2): the URL is the authority for *where the contract came from*, never
a runtime fetch. The pulse-timing values a `0x11`/`0x14` block carries (pilot/sync/bit
T-state lengths) describe the same ROM tape encoding as above; this slice records the
container layout that transports them, and the EAR pulse model that turns block bytes
into that pulse stream is authored in [`tape-loading.md`](tape-loading.md)
(`TAPE-PULSE-*`, W10.9). No invented values, no `UNKNOWN`.
